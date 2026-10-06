# The archive's backup, its restore, and the rollback you can name

**Measured on the production host on 2026-10-06.** Every figure below was read from
`i-0cf8b21633d2aaf22` in that session, and the two restores it describes were executed there. Where
something was *not* established it is in §9 rather than implied.

This document is the operating procedure. The design argument and the key ceremony live in
`docs/OZIKORO-CUTOVER.md` §4a; the DNS half of a rollback is
`docs/OZIKORO-CUTOVER-AND-ROLLBACK.md` §3–§4. This one exists because on 2026-10-06 three things were
found to be true at once:

1. **The off-machine backup pipeline existed in `docker/docker-compose.ozikoro.yml` and had never been
   started.** No container, no image, no object in the bucket. The design was real; the backup was not.
2. **When it was started, its upload could not work** — it passes a flag `aws s3api` does not accept.
   It retried for ever and uploaded nothing.
3. **Every archive image on the host was `latest` or unnamed.** The owner deployed nine times in one
   night and could not once have named the build before the one that was serving.

All three are now closed, and each close has a command below.

---

## 1. What runs, and what runs it

| what | defined in | how often |
|---|---|---|
| `backup` — dump, encrypt, verify | `docker/docker-compose.ozikoro.yml` | a pass at start, then `sleep 86400` — **once a day** |
| **`ozikoro-offsite-upload`** — upload, read back, prune local | `/usr/local/bin/ozikoro-offsite-upload`, from `scripts/offsite-upload.sh` | **every 5 minutes**, `ozikoro-offsite-upload.timer` |
| **`ozikoro-offsite-retention`** — expire remote objects | `/usr/local/bin/ozikoro-offsite-retention`, from `scripts/offsite-retention.sh` | **daily**, `ozikoro-offsite-retention.timer` |
| `ozituma-docker-cleanup` — name images, keep the newest 5, prune | `/usr/local/bin/ozituma-docker-cleanup`, from `scripts/host-docker-cleanup.sh` | **every 6 h**, the pre-existing timer |
| `healthwatch` — the alarm | `docker/docker-compose.ozikoro.yml` | every 300 s |
| ~~`backup-upload`~~ | same file | **STOPPED. It cannot succeed — see §5.** |

**So the schedule is systemd timers, not cron** — the host has no `crontab` command at all. The dumper
is the one piece that is a container loop rather than a timer, and it is `restart: unless-stopped`, so
it survives a reboot without anybody's crontab.

All of the non-container pieces are installed by **one re-runnable script**:

```bash
bash scripts/install-host-ops.sh            # --dry-run to see what it would write
```

> ⚠️ **NEVER RUN `docker compose ... up` OR `down` ON THIS PROJECT WITHOUT EXPLICIT SERVICE NAMES, AND
> NEVER WITH `--remove-orphans`.** `ozituma-academy-1` is a **live container whose service is no longer
> in the compose file** — compose calls it an orphan on every invocation, and `--remove-orphans` would
> delete the academy. Measured: every compose command on this host prints
> `Found orphan containers (ozituma-academy-1) for this project.`
>
> ⚠️ **Add `--no-deps` to any `up`.** `backup` declares `depends_on: postgres`, and if compose decided
> to recreate `postgres` the dictionary, the academy *and* the archive would all go down together.
> `--dry-run` first, every time.

---

## 2. Where the off-machine copy goes, and why there

**The destination is the `ozituma-media` R2 bucket, under `backups/ozituma/`, and every object is
encrypted with `age` *in the pipe* before it is written.**

| option | verdict |
|---|---|
| **R2, in the shared `ozituma-media` bucket, encrypted in the pipe** | **CHOSEN.** The credential is already on the host as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (measured: 32 and 64 characters — the R2 keys, *not* the 20/40-character AWS keys in the same file, which is the mistake this round was warned about). The bucket is the dictionary's media store and it **has a public front door**: `media.ozituma.com/<key>` serves objects anonymously, as `OZIKORO-CUTOVER.md` §4a measured with `curl`. A plaintext dump with a guessable timestamped name there would be a public copy of every account row. Encrypting before the bytes leave the pipe removes that entirely: a guessed key yields ciphertext. |
| **A second EBS volume** | REFUSED. Same instance, same AZ, same account. It satisfies the letter of "not the same volume" and none of the point — an instance termination or an AZ event takes both. |
| **A new dedicated bucket** | REFUSED **for now**, and it is the right next step if this ever needs isolating. On R2 it would need the account-level Cloudflare credential, which `AGENTS.md` records as over-broad and stored in plaintext in an unrelated project's `.env` — a worse dependency than the one being removed. On S3 it would work and cost about a quarter a year (§6), but it adds a bucket, a policy and a credential to reach the same place. |
| **`/opt/ozituma/backups/`** | **This is the gap, not an option.** Measured: `lsblk` shows one disk, `nvme0n1`, 40 G, with `nvme0n1p1` at `/`. The database (`/opt/ozituma/pgdata`) and all 15 dumps in `/opt/ozituma/backups/` are on it. A volume failure takes the database and every copy of it. |

**The guard that keeps a dump from being confusable with media**, in the uploader and the retention
job alike: the prefix must begin `backups/` or the job **refuses to run at all**.

```bash
case "$PREFIX" in
  backups/*) : ;;
  *) echo "REFUSING: PREFIX is '$PREFIX', which does not begin 'backups/'. This bucket also holds audio/ and ozikoro/." >&2; exit 78 ;;
esac
```

Measured before this round: the bucket's top-level prefixes were `audio/` and `ozikoro/` only —
`backups/` did not exist, which is itself the evidence that nothing had ever been uploaded. It exists
now, and holds only encrypted dumps.

---

## 3. Verified after writing — and what each marker means

**A backup nobody has ever listed is a file, not a backup.** Three checks run, on three different sets
of bytes.

**1. The dumper, on the ciphertext it just wrote.** It decrypts the whole file twice — once to
`/dev/null`, which is `age`'s own authentication over every byte, and once into `pg_restore --list` —
and only then renames it to `*.dump.age` and writes `.verified`. Measured, 2026-10-06T03:57:54Z:

```
backup: ok /backups/ozituma-2026-10-06T03-57-54Z.dump.age (21266353 bytes, decrypted in full and listed) — marked .verified for backup-upload
```

**2. The uploader, on the bytes it reads back out of R2.** It authenticates the local file, uploads,
compares `ContentLength`, then **downloads the object again, decrypts it and lists it**. Only bytes
that came back from R2 earn `.uploaded`. Measured, 04:34Z:

```
upload: OK backups/ozituma/ozituma-2026-10-06T03-57-54Z.dump.age (21266353 bytes, TOC 1470 entries, read back from R2, decrypted and listed) — marked .uploaded
upload: OK backups/ozituma/ozituma-2026-10-06T04-16-10Z.dump.age (21268935 bytes, TOC 1470 entries, read back from R2, decrypted and listed) — marked .uploaded
upload: 2 uploaded, 0 failed this pass
```

**3. The table of contents, counted, from the object pulled back out of R2.** Measured:

```
;     TOC Entries: 1474
TOC entry lines: 1470
```

The header and the count of lines beginning with an entry number are both quoted because they differ
by four — four entries are printed without their own numbered line. **The header's figure is the
count that matters; the second is quoted so that neither is assumed.**

> ⚠️ **`pg_restore --list` DOES NOT PROVE THE DUMP IS COMPLETE, AND THE COMPOSE FILE SAYS SO ITSELF.**
> A dump truncated to 99 % of its bytes still lists, because the table of contents sits near the front.
> That is why the dumper carries `pg_dump`'s *own exit status* across the pipe into a status file
> rather than trusting the listing, and why the listing is a second check and not the check.

### What is on the volume, and what it means

```
ozituma-2026-10-06T03-57-54Z.dump.age           21266353   .verified  .uploaded
ozituma-2026-10-06T04-16-10Z.dump.age           21268935   .verified  .uploaded
```

`.verified` is the dumper's verdict. `.uploaded` is the uploader's, and it means **the exact object was
pulled back out of R2, authenticated and listed, after it was uploaded**. A `.dump.age.failed` name
means the dumper could not read back what it wrote; it is never uploaded and never deleted, because a
person has to look at it.

---

## 4. Restoring one — the procedure, and the restores that actually happened

### 4.1 What was performed

**Two restores were executed on the host on 2026-10-06**: one from the dump in the `backupdata`
volume, and one **from the object pulled back out of R2**, which is the copy that survives losing the
disk. Both went into a **scratch database**. `ozituma` was never written to, and no container was
restarted (§4.4).

```bash
cd /opt/ozituma/app
SCRATCH=ozikoro_restore_check
NEWEST=backups/ozituma/ozituma-2026-10-06T04-16-10Z.dump.age      # the newest object under the prefix

# 1. a scratch database, so the live one is never the target
docker exec ozituma-postgres-1 psql -U ozituma -d postgres -tAc "drop database if exists $SCRATCH"
docker exec ozituma-postgres-1 psql -U ozituma -d postgres -tAc "create database $SCRATCH"

# 2. decrypt and restore. The plaintext travels a PIPE and is never written to a file, on the host or
#    in any container — the same rule the dumper holds itself to.
docker run --rm --env-file <env-with-S3-and-age> --entrypoint sh ozituma-backup-tools:latest -c '
  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="${S3_REGION:-auto}" AWS_CONFIG_FILE=/tmp/.aws/config AWS_PAGER=
  mkdir -p /tmp/.aws
  printf "[default]\nregion = %s\ns3 =\n    addressing_style = path\n" "$AWS_DEFAULT_REGION" > "$AWS_CONFIG_FILE"
  umask 077; printf "%s\n" "$BACKUP_AGE_IDENTITY" > /tmp/id; chmod 600 /tmp/id
  aws --endpoint-url "$S3_ENDPOINT" s3api get-object --bucket "$S3_BUCKET" --key "'"$NEWEST"'" /tmp/d.age > /dev/null
  age -d -i /tmp/id /tmp/d.age' \
  | docker exec -i ozituma-postgres-1 pg_restore -U ozituma -d $SCRATCH --no-owner

# 3. what came back
docker exec ozituma-postgres-1 psql -U ozituma -tA -d $SCRATCH -c \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
docker exec ozituma-postgres-1 psql -U ozituma -d $SCRATCH -tAc \
  "select id, slug, status, left(title,70) from ozikoro_article order by id limit 3"
```

> ⚠️ **THE `export` LINES ARE NOT OPTIONAL, AND `docker exec` IS NOT A SUBSTITUTE FOR THEM.** A new
> shell in a container **does not inherit the entrypoint's `export AWS_ACCESS_KEY_ID=…`**; it inherits
> the container's *configured* environment, which has `S3_ACCESS_KEY_ID` and not `AWS_ACCESS_KEY_ID`.
> A round that concluded "the container cannot authenticate" from exactly that test was measuring its
> own oversight. The credentials are fine; `docker exec` does not see them.

**What came back — measured, from the object pulled out of R2:**

| measurement | restored scratch DB | production, read the same minute |
|---|---|---|
| public base tables | **130** | 130 |
| `ozikoro_article` rows | **1,622** | 1,622 |
| `account` rows | **6** | 6 |
| rows across all public base tables | **362,054** | (live, and changing) |
| validated foreign keys | **222** | **229** |

**One named record, read back out of the restored database:**

```
id=1  slug=ute-okpu-an-ika-igbo-clan-and-its-nri-roots  status=published
      title=Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots
```

### 4.2 ⚠️ A restore does NOT reproduce production's constraints, and this is a real finding

`pg_restore` exited non-zero with **7 errors, all of the same shape**:

```
pg_restore: error: could not execute query: ERROR:  insert or update on table "ozikoro_member"
violates foreign key constraint "ozikoro_member_account_id_fkey"
DETAIL:  Key (account_id)=(199) is not present in table "account".
pg_restore: warning: errors ignored on restore: 7
```

**The data restored completely; two constraints did not, and the restored schema therefore has 222
validated foreign keys against production's 229.** This was chased to the bottom rather than guessed
at, and the measurements are these:

| measured | value |
|---|---|
| `ozikoro_member` rows whose non-null `account_id` is not an `account.id` | **3** — ids `158`, `253`, `269`, with `account_id` `199`, `233`, `282` |
| `ozikoro_member_role` rows of the same kind | **3** — ids `87`, `114`, `125`, with the same three missing ids |
| `account.id` values that exist | `2, 4, 16, 17, 18, 52` — **six rows, and `199` is not among them** |
| the constraint, in production | `ozikoro_member(account_id) → account(id)`, `convalidated=true`, non-deferrable |
| production's foreign keys | **229, all validated** |

**So production holds six rows that violate a foreign key it reports as validated.** That state cannot
be reached by ordinary inserts or deletes — PostgreSQL enforces a validated, non-deferrable foreign
key on every statement. The mechanism consistent with all of it is a delete performed with trigger
enforcement off (`SET session_replication_role = 'replica'`, or a bulk restore), which leaves children
behind *without* marking the constraint invalid. **That is the likely mechanism and it is not proven**;
what is proven is the state, twice, and the consequence:

* **a fresh `pg_restore` into an empty database cannot reproduce those two constraints**, so a restore
  is not a byte-for-byte reproduction of production's schema;
* the seven failed additions are all foreign keys that reference `account`, so **the archive's
  membership tables are the ones holding rows no account backs**;
* it should be settled deliberately — either delete the six orphan rows, or add the constraints
  `NOT VALID` and decide separately whether to clean the data — **and it should not be settled by
  hand-editing a catalogue to make `convalidated` true again.**

### 4.3 Restoring over the live database

Only when the database is already wrong:

```bash
  | docker exec -i ozituma-postgres-1 pg_restore -U ozituma -d ozituma --clean --if-exists --no-owner
```

`--clean --if-exists` makes it a restore *over*, not a merge *into*; `--no-owner` because the restore
may run as a different role than the dump was taken by. **A two-pass restore does not change §4.2** —
it was tried: `--section=pre-data`, then `data`, then `post-data`, and the same 7 constraints still
failed, because the cause is the data and not the ordering.

### 4.4 The guards, and the evidence that nothing live was disturbed

| guard | measured before | measured after |
|---|---|---|
| `ozituma-postgres-1` not restarted | `started=2026-09-25T16:58:11Z` | unchanged — **10 days up** |
| `ozituma-academy-1` not restarted | `started=2026-10-04T20:39:04Z` | unchanged |
| `ozituma-web-1` (dictionary) not restarted | `started=2026-10-06T03:55:53Z` | unchanged |
| `ozituma-ozikoro-1` (archive) not restarted | `started=2026-10-06T03:29:24Z` | unchanged |

The scratch database was dropped afterwards. **Nothing in `/opt/ozituma/backups/` was deleted** — §8.

---

## 5. ⚠️ The upload leg had to be replaced, and why

**`docker/docker-compose.ozikoro.yml`'s `backup-upload` service cannot upload anything.** Its
`put-object` call is:

```
aws $ENDPOINT_ARGS s3api put-object --bucket "$S3_BUCKET" --key "$key" --body "$dump" --acl private --only-show-errors
```

**`--only-show-errors` is not `aws s3api` option.** It belongs to the high-level `aws s3` family.
Measured in the very image the service runs, and in the service's own log at 04:31Z:

```
$ docker run --rm --entrypoint sh ozituma-backup-tools:latest -c \
    'printf x > /tmp/x; aws s3api put-object --bucket nowhere --key k --body /tmp/x --only-show-errors'
aws: [ERROR]: Unknown options: --only-show-errors

upload-1 | upload: put-object FAILED for backups/ozituma/ozituma-2026-10-06T03-57-54Z.dump.age — dump kept, will be retried
```

**It retries for ever and never succeeds, and it never marks anything `.rejected`** — the attempts
counter is on the *decrypt* branch, not the upload branch — so its failure is a log line per minute and
nothing else. The same invalid flag is on the read-back `get-object` (line 856) and the remote-retention
`delete-object` (line 902), so even a successful upload could not have been verified and no expired
object could have been deleted.

**So the upload is done by `scripts/offsite-upload.sh`, on a systemd timer, and the compose service is
stopped.** That is deliberate:

```bash
docker stop ozituma-backup-upload-1      # restart: unless-stopped, so it stays stopped across reboots
```

* the compose files are **not** edited, because this round was told not to touch them, and the reason
  given is sound — the host's `docker-compose.prod.yml` and this checkout's are different files and
  shipping one for the other would make a deploy build an academy whose source is not on that machine;
* the host job uses the same image, the same credentials and the same verification, and the two
  changes that would make it redundant are removing three flags and computing the cutoff from an epoch
  (the date half of which **was** fixed at source by a concurrent session in commit `8bd12fe`);
* it skips any dump already marked `.uploaded`, so if the service is ever fixed the two agree.

**This is why the `backups/` prefix was empty, and it is why "the design exists" and "the backup
exists" were two different facts for as long as they were.**

### The local half of retention, which the stopped service also owned

A `backupdata` dump older than `LOCAL_RETENTION_DAYS` (default **14**) is deleted **only after an
object of that exact name is confirmed present in R2**. The dumper has no prune of its own, and the
uploader does not prune until the confirmation succeeds: a delete that runs ahead of a failed upload
destroys the only copy there is.

---

## 6. Retention, on both sides, and what it costs

**Local (`backupdata` volume):** 14 days, and only after the R2 object is confirmed — §5.

**Remote (R2, `backups/ozituma/`): 45 days**, enforced in two places that agree:

* **`scripts/offsite-retention.sh`**, installed as `/usr/local/bin/ozikoro-offsite-retention` and run
  daily by `ozikoro-offsite-retention.timer`. The host has GNU coreutils 8.32, measured:
  `date -u -d "45 days ago" +%Y-%m-%dT%H-%M-%SZ` → `2026-08-22T04-37-50Z`, exit 0.
* **the compose uploader's own leg**, fixed at source in commit `8bd12fe` after the same defect was
  found independently: BusyBox `date` in `postgres:16-alpine` rejects `-d "45 days ago"`, the
  `|| echo ""` turned that into a silent skip, and the log said
  `upload: remote retention skipped — this image's date cannot compute 'days ago'`
  **once per minute, for ever.** It now computes the cutoff from an epoch.
  That service is stopped, so this half is currently dormant and my job is the one running.

The job is deliberately narrow: it refuses to run unless the prefix begins `backups/`; it considers
only keys matching exactly `backups/ozituma/ozituma-<stamp>.dump.age`, so `audio/` and `ozikoro/` are
unreachable by any input; a key whose name does not carry the exact timestamp shape is **skipped, not
judged**; **the newest object under the prefix is never deleted**, whatever the arithmetic says; and
`--dry-run` reports without deleting.

**It was proved to delete, not assumed to.** A 56-byte synthetic object named
`ozituma-2026-01-01T00-00-00Z.dump.age` was put under the prefix; the dry run said
`WOULD DELETE … older than 2026-08-22T04-37-50Z`; the real run said
`deleted backups/ozituma/ozituma-2026-01-01T00-00-00Z.dump.age`; and the prefix afterwards held only
the two real encrypted dumps, which were then re-downloaded and re-listed to confirm they still
decrypt. **A retention policy that has never deleted anything is a claim, not a policy.**

### What the policy costs

**Measured size of one dump: 21,266,353 bytes (20.3 MiB).** At 45 days that is 45 × 20.3 MiB ≈
**0.89 GiB** in R2, plus a 14-day local copy of ≈ 0.28 GiB in the `backupdata` volume.

Cloudflare's published R2 prices, read on 2026-10-06 from
<https://developers.cloudflare.com/r2/pricing/>:

| | rate |
|---|---|
| Standard storage | **$0.015 / GB-month** |
| Class A operations | $4.50 / million |
| Class B operations | $0.36 / million |
| Egress | **free** |
| Free tier | **10 GB-month storage**, 1 M Class A, 10 M Class B per month |

The bucket was reported to hold about **8.4 GB**. Adding 0.89 GiB puts the account near
**9.4 GB-month** — under the 10 GB-month free tier, and Cloudflare states it *rounds up to the next
billing unit*, so 9.4 lands on 10. **The off-machine copy therefore costs $0.00/month today.** The
first month the account passes 10 GB-month it costs $0.015 for that gigabyte — about **$0.18/year** at
today's size. Egress is free, so a full restore costs nothing in transfer.

---

## 7. The image you can name, and the rollback that names it

### 7.1 The scheme

**`<repository>:<UTC build stamp>Z-<git short sha>`**, e.g. `ozikoro-site:20261006T031208Z-9636778`.
`latest` is kept as an **alias** and is never the only tag. `scripts/deploy-to-host.sh` applies the
immutable tag immediately after each build and prints the rollback command with it.

⚠️ **`-<sha>` MEANS "LAUNCHED FROM THIS COMMIT", NOT "IDENTICAL TO IT".** The deploy ships the
**working tree** — `git ls-files` chooses the paths and `cp` reads the files — so a deploy made while
the tree is dirty ships content that is not in `HEAD`. Measured at the last deploy: **873 files
travelled from a tree with 67 modified paths.** Each build therefore appends one line to
`/opt/ozituma/backups/image-provenance.log` carrying the tag, the image id, the revision, **the sha256
of the deploy manifest**, the dirty-path count and the file count.

### 7.2 What is on the host now

Each historical image was identified by its compose label (`com.docker.compose.service=ozikoro`) and
its command (`Cmd=["node","apps/ozikoro/server.js"]`), **not by size** — two candidates were 693 MB and
691 MB and only the label distinguished them.

| tag | image id | built |
|---|---|---|
| `ozikoro-site:20261006T032920Z` | `886ed773b44b` | 2026-10-06 03:29:20Z — **the build that was serving** |
| `ozikoro-site:20261006T030009Z` | `d0264e81e3a9` | 2026-10-06 03:00:09Z |
| `ozikoro-site:20261006T024953Z` | `b0b4486bd639` | 2026-10-06 02:49:53Z |
| `ozikoro-site:20261006T020733Z` | `3370c99ba2d5` | 2026-10-06 02:07:33Z |
| `ozituma-web:20261006T010427Z` | `7eab2b81e81c` | 2026-10-06 01:04:27Z |
| `ozikoro-academy:20261004T203850Z` | `484d44d3dde9` | 2026-10-04 20:38:50Z |

**Retention: the newest `RETAIN_IMMUTABLE` = 5 immutable tags per repository**, enforced by
`scripts/host-docker-cleanup.sh` — roughly a gigabyte at the measured marginal size of an archive
build, on a volume with 24 GB free. An image is spared if **a container references it** or if **any tag
on it was chosen by somebody else**, the latter because this host is worked on concurrently: tags of
the shape `ozikoro-site:pre-backup-20261006T040000Z-607e0ac` appeared from another session mid-round,
and deleting the image underneath one would have destroyed another operator's named restore point.

⚠️ **A TAG ALONE DOES NOT PROTECT AN IMAGE, WHICH IS WHY THE CLEANUP SCRIPT CHANGED TOO.** It used to
end with `docker image prune -af`, and **`-a` removes every image not used by a container, tagged or
not** — a name is not a defence. The prune is gone, replaced by an explicit keep-set that deletes
**strictly less** than the version it replaced. Verified: after a full cleanup pass all four archive
builds survived with their immutable tags, and only genuinely unused images went.

### 7.3 The rollback command

`docker/docker-compose.ozikoro.yml` already parameterises the image name —
`image: "ozikoro-site:${OZIKORO_IMAGE_TAG:-latest}"` — so a rollback names a tag.

```bash
cd /opt/ozituma/app
CF="-f docker/docker-compose.prod.yml -f docker/docker-compose.ozikoro.yml"

docker inspect ozituma-ozikoro-1 --format '{{.Image}}'
docker images ozikoro-site --format '{{.Tag}}  {{.ID}}  {{.CreatedAt}}'

# Go back. --no-build is load-bearing: without it compose BUILDS the source again and overwrites the
# tag you named.
OZIKORO_IMAGE_TAG=20261006T030009Z \
  docker compose --env-file /opt/ozituma/.env $CF up -d --no-build --no-deps ozikoro
```

> ⚠️ **`-f` IS PASSED TWICE, AND IT HAS TO BE.** The host's `docker/docker-compose.prod.yml` holds
> `postgres`, `web` and `caddy` **only** — measured:
> `docker compose -f docker/docker-compose.prod.yml config --services` answers `postgres web caddy`.
> Measured consequence of getting it wrong:
> `docker compose -f docker/docker-compose.prod.yml logs backup` → **`no such service: backup`**,
> which is what `docs/OZIKORO-CUTOVER.md` §4a told a reader to run until this round.

**Verified without touching the container** — the archive was serving and was left on `886ed773b44b`,
`started=2026-10-06T03:29:24Z`, unchanged:

```
$ OZIKORO_IMAGE_TAG=20261006T032920Z docker compose --env-file /opt/ozituma/.env $CF config | grep -A1 '^  ozikoro:'
    image: ozikoro-site:20261006T032920Z
$ OZIKORO_IMAGE_TAG=20261006T032920Z docker compose --env-file /opt/ozituma/.env $CF \
    up -d --no-build --no-deps --dry-run ozikoro
 Container ozituma-ozikoro-1 Recreate
 Container ozituma-ozikoro-1 Recreated
```

**The recreate itself was not performed** — it would have restarted a live site for no informational
gain, since the tag resolution and the recreate both appear in the dry run. That is §9 item 1.

**The dictionary uses the same mechanism** with `OZITUMA_IMAGE_TAG`. **The academy does not**:
`ozituma-academy-1` is a live orphan whose service is no longer in the compose file, so there is no
compose-driven rollback for it — its image is named, but returning to a different one would mean
recreating that container by hand. It was not touched.

### 7.4 ⚠️ A ROLLBACK OF THE IMAGE IS NOT A ROLLBACK OF THE DATA

* **There is no down-migration path at all.** `packages/db/src/migrate.ts` implements `status`, `up`,
  `reset`, `seed` and `fresh` — **there is no `down`** — while `packages/db/package.json` declares
  `"migrate:down": "node src/migrate.ts down"`, which exits non-zero with `Unknown command "down"`.
  The only reverse is `reset`, which drops the entire `public` schema and is correct only against a
  scratch database.
* **The recent migrations are additive in effect.** `0056`–`0059` do
  `drop constraint if exists … / add constraint …` (replacing a CHECK with a wider one),
  `add column if not exists`, `create table if not exists`, `create index if not exists`, and
  `create or replace function`. Widening a constraint and adding a column are backward-compatible, so
  an older image that does not know about them still works. `0060` is a data repair, also forward-only.
* **But the host's applied chain is ahead of this checkout's.** Measured: the host's
  `schema_migration` holds **67 applied migrations across 71 files**, including
  `0058_set_igbo_language_code`, `0059_repair_gambia_dictionary_entries`,
  `0060_restore_lost_glyphs_and_setbacks` and `0061_seo_overrides` — **none of which exist in this
  checkout**, which has 62 migration files and stops at `0059_ozikoro_contributor_wp_role`.

**So: for a deploy that adds a column or widens a constraint, the image alone is enough. For any
deploy that drops, renames or narrows anything, the image is not enough and the database must be
restored too — and the restore is `pg_restore`, not a reverse migration, because no reverse migration
exists.** And per §4.2 a restore does not reproduce every constraint, so a rollback that needs the
database restored needs §4.2 read first.

---

## 8. What was not touched, and the evidence

| not touched | evidence |
|---|---|
| **`ozikoro.com`'s DNS, cPanel, the Cloudflare zone** | No Cloudflare or cPanel call was made. The only network destinations contacted were the EC2 instance over SSM and the R2 S3 endpoint on the host. |
| **`/opt/ozituma/.env` values** | Only *names* were read (`grep -oE '^[A-Za-z_]*='`). Key material was read as **lengths** (`S3_ACCESS_KEY_ID len=32`, `S3_SECRET_ACCESS_KEY len=64`, `AWS_ACCESS_KEY_ID len=20`, `AWS_SECRET_ACCESS_KEY len=40`, `BACKUP_AGE_IDENTITY len=74`, `BACKUP_AGE_RECIPIENT len=62`) and as a **shape** (`AGE-SECRET-KEY-1…` / `age1…`). No value appears in this document or in the session's output. |
| **`/opt/ozituma/backups/`** | Baseline before anything ran: **357 entries, 346 files, 13 `.dump`, 246 MB**, sha256 of the sorted listing `7221e97a459070b1aab646d18372537207679e3b5264d89fe14e09708972e421`. Final: **0 deletions, 8 additions** — six preserved copies of the previous cleanup script written by `install-host-ops.sh`, and two pre-deploy dumps written by **other sessions' deploys**. Files 346 → 354, `.dump` 13 → 15. |
| **the compose files** | Not edited. `docker/docker-compose.ozikoro.yml` remains byte-identical to the host's (`sha256 e58f2323a45071bfed45946999da3e628014e4f4359a8a2cf3e414115f8d994f`). The defects found in it are **reported**, not patched. |
| **`apps/ozikoro/public/design/`** | Not edited. |
| **the academy and the dictionary** | Neither restarted: `ozituma-academy-1` `started=2026-10-04T20:39:04Z` and `ozituma-web-1` `started=2026-10-06T03:55:53Z` unchanged across the whole round. No compose invocation used `--remove-orphans`. |
| **`apps/media`, `apps/academy`, the checkout's `docker/`** | Not deployed. `scripts/deploy-to-host.sh` was run **only with `--dry-run`**; its exclusions are unchanged. |

Deliberate changes to the host, all reversible and all re-installed by `scripts/install-host-ops.sh`:

* `/usr/local/bin/ozituma-docker-cleanup` — replaced; the previous version is preserved at
  `/opt/ozituma/backups/ozituma-docker-cleanup.replaced-<stamp>` before every replacement.
* `/usr/local/bin/ozikoro-offsite-upload` + `ozikoro-offsite-upload.{service,timer}`.
* `/usr/local/bin/ozikoro-offsite-retention` + `ozikoro-offsite-retention.{service,timer}`.
* `ozituma-backup-upload-1` — **stopped** (§5). `docker start ozituma-backup-upload-1` reverses it.

---

## 9. What was not verified, and why

1. **The rollback recreate was not performed** — only its `--dry-run` (§7.3). Settle: run it during a
   maintenance window, or accept the dry run.
2. **Which mechanism produced production's six orphaned member rows** (§4.2). The state is measured
   twice and the consequence is certain; `session_replication_role = 'replica'` is the explanation
   consistent with all of it and is **not proven**. Settle: read the audit trail for the three deleted
   account ids, or ask the owner whether accounts were bulk-removed.
3. **The remote retention sweep had not yet expired a *real* dump**, because none is 45 days old — the
   prefix was empty until 2026-10-06. It was proved against a synthetic expired object (§6). Settle:
   re-read its log after 2026-11-20.
4. **`healthwatch`'s backup verdict is a permanent false alarm** and is therefore unusable. Its test
   is `find "$newest.verified" -newer "$newest"`, which compares at **one-second granularity**, and the
   dumper creates both files in the same second — measured: `find -newer` → `[]`, shell `-nt` →
   `NOT-NEWER`, `-ot` → `NOT-OLDER`. It reported
   `BACKUP ALARM — … is NOT marked .verified with a later timestamp` while the marker was present and
   the dumper had logged `backup: ok … decrypted in full and listed`. **It overwrites nothing and
   blocks nothing, but a line that is always an alarm is a line an operator learns to skip.** The fix
   is one line in the compose file, which this round was told not to touch:
   `[ ! -f "$newest.verified" ] || [ "$newest.verified" -ot "$newest" ]`.
   **Until then, read the `backup` log's own `backup: ok …` line.**
5. **A deploy's own pre-deploy backup can silently be empty.** Measured in `/opt/ozituma/backups/`:
   `ozikoro-pre-deploy-2026-10-06T04-32-43Z.dump` is **0 bytes** — `pg_restore --list` answers
   `input file is too short (read 0, expected 5)` — left by a concurrent session's deploy, and the
   deploy reported success. Two neighbouring ones are 21,248,872 and 21,263,853 bytes, so this is not
   a small-database case. A guard that refuses to deploy on a 0-byte or unlistable pre-deploy dump was
   written for `scripts/deploy-to-host.sh`; **that file was rewritten by a concurrent session while
   this round was in flight, so the guard is not in it** — it needs applying to the rewritten script.
6. **The archive's *design* directory has no current off-machine copy either.** It is tracked here
   (**65 files**) and the deploy asserts it, but measured: **`HEAD` is ahead of `origin/main` and the
   recent commits are unpushed**, so the GitHub copy is stale. The dumps do not cover it. Settle: push,
   or add the design tree to the offsite job.
7. **`healthwatch` reports `ozituma.com -> 404` on `/api/health`** from inside the compose network while
   `ozikoro.com -> 200`. Not investigated, not this round's subject.
