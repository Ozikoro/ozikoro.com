# The cutover to ozikoro.com, and the way back

**THIS DOCUMENT PREPARES A CUTOVER. IT DOES NOT PERFORM ONE.**

`ozikoro.com` is live WordPress on cPanel at `162.213.253.73`. Nothing in this repository's backend
work has written to it, migrated it, repointed its DNS or called a mutating cPanel function, and that
holds until the owner says otherwise. His instruction, from the beginning:

> *"this is not going to deploy until the new design is done, and you have imported every single
> article and content… then it can be deployed to avoid shutting the website."*

---

## 1. Before anything is switched: the gate

Every line is a command that either passes or does not. The order matters — the last two are the only
ones that are visible to a visitor, and they are the cheapest to get wrong.

| # | Check | Command |
|---|---|---|
| 1 | Every migration applied to the production database | `DATABASE_URL='…' node scripts/verify-postgres.ts` |
| 2 | Every archived file is in object storage, not on a container disk | `npm run import:media-upload -- --check` |
| 3 | The compose wiring names every variable the code reads | `node scripts/check-compose-env.mjs` |
| 4 | The deployable artefact is complete | `bash scripts/build-standalone.sh` |
| 5 | The Caddyfile is valid **on the host**, with the real binary | `docker compose -f docker/docker-compose.prod.yml exec caddy caddy validate --config /etc/caddy/Caddyfile` |
| 6 | The origin certificate covers `ozikoro.com` | `openssl x509 -in /opt/ozituma/certs/origin.pem -noout -text \| grep -A1 'Subject Alternative Name'` |
| 7 | The site answers on the host, before DNS moves | `docker compose exec caddy wget -qO- --header='Host: ozikoro.com' --no-check-certificate http://127.0.0.1/api/health` |

**Step 6 is the one that turns a cutover into an outage, and it is the one nobody runs.** A Cloudflare
Origin CA certificate is issued for named hosts. The same `origin.pem` serves `ozituma.com` and
`ozikoro.com` on this host. If its SANs do not include `ozikoro.com` and `www.ozikoro.com`:

- with the zone's SSL mode on **Full**, Cloudflare does not validate the origin certificate and the
  site works — the mode `ozituma.com` is recorded as using today;
- with **Full (strict)**, Cloudflare validates it, refuses the handshake, and `ozikoro.com` answers
  **526** to every visitor.

The Caddyfile's own header says `full (strict)` is the intent. **So either the certificate must gain
`ozikoro.com`, or the zone must stay on `Full` until it does.** Raise the mode only after step 6
passes.

**Step 7 is the rehearsal.** It proves the container serves the right host through the real proxy
before any visitor is involved, and it costs nothing. A cutover that skips it is a cutover that
discovers its first fault in public.

---

## 2. The exact DNS change

The zone is `ozikoro.com`, id `1ebe8c1f9ce3dcec95448b6d93d63e00`, on Cloudflare's shared
nameservers `clint.ns.cloudflare.com` and `khloe.ns.cloudflare.com`.

### Capture the current state first — read only

**Do this before the change, and keep the output.** After the change the old value is not recoverable
from the zone, and the record id is what the reversal needs.

```bash
ZONE=1ebe8c1f9ce3dcec95448b6d93d63e00

curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?per_page=100" \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)["result"]
for r in d:
    if r["type"] in ("A","AAAA","CNAME") and "ozikoro.com" in r["name"]:
        print(r["id"], r["type"], r["name"], "->", r["content"], "proxied=" + str(r["proxied"]))'
```

Expected today, from the record kept in `AGENTS.md`:

| Type | Name | Content | Proxied |
|---|---|---|---|
| `A` | `ozikoro.com` | `162.213.253.73` | yes |
| `A` (or `CNAME`) | `www.ozikoro.com` | `162.213.253.73` | yes |

**Verify these rather than trusting them.** The value is recorded from a read on 2026-09-28 and the
zone is live and editable by others. The apex still points at cPanel, and the cutover is the act of
changing that.

### The change itself

Two records, from the cPanel host to the EC2 Elastic IP that already runs `ozituma-prod`
(`i-0cf8b21633d2aaf22`, `44.194.56.187`). `$RECORD_ID` is the apex record's id from the capture
above.

```bash
# The apex. This is the one that moves the site.
curl -s -X PATCH \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$RECORD_ID" \
  --data '{"content":"44.194.56.187","proxied":true}'

# www, so the Caddyfile's www block can answer. A CNAME to the apex is better than a second A
# record: one address, one place to change it, which is the reasoning the dictionary's records
# already use.
curl -s -X PATCH \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$WWW_RECORD_ID" \
  --data '{"content":"ozikoro.com","type":"CNAME","proxied":true}'
```

`proxied: true` is not optional. The origin certificate is a Cloudflare Origin CA certificate, which
no browser trusts directly — it is trusted *by Cloudflare*. Turning the orange cloud off exposes an
untrusted certificate to every visitor.

### What must NOT be touched

- **The `MX` records and the `SPF` `TXT` record.** `AGENTS.md` records five `MX` and one `SPF` for
  Namecheap email forwarding on this zone. Changing the apex `A` record does not affect mail, and the
  `SPF` must be **added to, never replaced** — email is the one thing on this domain that has been
  working continuously and does not come back quickly if it breaks.
- **The cPanel account itself.** Do not delete it, do not suspend it, do not change its DNS. It is
  the rollback.
- **`academy.ozikoro.com`.** It does not exist as a record, must not be created, and is not part of
  this cutover. The archive's `/academy/` page is the interim destination and says the academy is
  being prepared.

### What to expect after the change

Cloudflare proxied records do not have a meaningful TTL — Cloudflare's edge answers, and the record
is set to Auto (300 s). The change is visible within seconds to a minute, not hours. There is no
propagation window to wait out and no reason to change TTL in advance.

---

## 3. The way back

**This is the whole point of the document.** If anything is wrong, the reversal is one API call per
record and takes effect in seconds.

```bash
# Restore the apex to cPanel.
curl -s -X PATCH \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$RECORD_ID" \
  --data '{"content":"162.213.253.73","proxied":true}'

# Restore www to cPanel.
curl -s -X PATCH \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$WWW_RECORD_ID" \
  --data '{"content":"162.213.253.73","proxied":true}'
```

**Substitute the values you captured in step 2, not the ones printed here.** If the capture showed
something other than `162.213.253.73`, that captured value is the one that goes back. This document
records what the value was on 2026-09-28; only the capture is authoritative on the day.

The WordPress site at cPanel is untouched throughout, so it keeps serving its own content the whole
time — that is what makes this reversible. The window in which the domain is wrong is the window
between the two calls.

### Verification after a rollback

```bash
curl -s -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://ozikoro.com/
```

A `200` with `ssl_verify_result 0` is the rollback having taken. Nothing on the cPanel side needs to
be restarted, because nothing on it was changed.

---

## 4. The other rollback: the application

DNS is the coarse lever. If the site is reachable but the *application* is wrong, the finer one is the
image, and it only exists if images are tagged by commit rather than by `latest`.

**`latest` cannot be rolled back to.** It names whatever was built last, so "deploy the previous
version" has no version to name. The compose file therefore takes its image from a variable, and the
rollback names a tag:

```bash
cd /opt/ozituma/app
CF="-f docker/docker-compose.prod.yml -f docker/docker-compose.ozikoro.yml"

# See what is running, and what you could go back to.
docker inspect ozituma-ozikoro-1 --format '{{.Image}}'
docker images ozikoro-site --format '{{.Tag}}  {{.ID}}  {{.CreatedAt}}'

# Go back to a named build. --no-build is load-bearing: without it compose BUILDS the source again
# and overwrites the tag you named.
OZIKORO_IMAGE_TAG=20261006T030009Z \
  docker compose --env-file /opt/ozituma/.env $CF up -d --no-build --no-deps ozikoro
```

⚠️ **`-f` IS PASSED TWICE, AND IT HAS TO BE.** The host's `docker/docker-compose.prod.yml` holds
`postgres`, `web` and `caddy` **only** — measured:
`docker compose -f docker/docker-compose.prod.yml config --services` answers `postgres web caddy`. The
`ozikoro` service, and everything else, is in `docker/docker-compose.ozikoro.yml`. Measured
consequence of getting this wrong: `docker compose -f docker/docker-compose.prod.yml logs backup`
answers **`no such service: backup`**.

### ✅ THIS IS NOW APPLIED — 2026-10-06

**The two changes this section used to specify as "specified but not applied" have been applied, and
the paragraph that said so is replaced rather than deleted so that the next reader knows it was
here.**

* **The compose half was already applied** when this round measured it. Both files carry the variable:
  `docker/docker-compose.ozikoro.yml` line 44 is
  `image: "ozikoro-site:${OZIKORO_IMAGE_TAG:-latest}"`, and `ozituma-web` takes
  `${OZITUMA_IMAGE_TAG:-latest}`. The section's own `diff` was a proposal for a change that had since
  been made, with different variable names — which is the same failure this repository keeps
  producing: an authoritative statement that stopped being true and was read by agents who did not
  re-measure it.
* **The build half is now applied in `scripts/deploy-to-host.sh`**, which tags every build it makes
  as `ozikoro-site:<UTC stamp>-<git short sha>` — e.g. `ozikoro-site:20261006T031208Z-9636778` — keeps
  `latest` as an alias, and prints the rollback command with the tag. It also appends a provenance
  line (image id, revision, deploy-manifest sha256, dirty-path count) to
  `/opt/ozituma/backups/image-provenance.log`, because the script ships the **working tree** and a
  short sha therefore means "launched from this commit", not "identical to it".
* **The retention half is new and is what makes the tagging mean anything.** The host's cleanup used to
  end with `docker image prune -af`, and **`-a` removes every image not used by a container, tagged or
  not** — so a name was no protection at all. `scripts/host-docker-cleanup.sh` now keeps the newest
  five immutable tags per repository and removes only what is neither retained, referenced by a
  container, nor named by anybody else.

**The full procedure, the scheme, the retention policy, the cost and the measured evidence are in
`docs/OZIKORO-BACKUP-AND-ROLLBACK.md`.** The old proposal below is kept for one paragraph of context
and then dropped.

```bash
# The shape the proposal had, for the record. The real commands are above.
IMAGE_TAG=<previous-sha> docker compose -f docker/docker-compose.prod.yml up -d --no-build ozikoro
```

`${OZIKORO_IMAGE_TAG:-latest}` rather than `${OZIKORO_IMAGE_TAG:?…}` on purpose: the `:-` keeps a plain
`docker compose up` working on a development machine, and the operator's discipline is what supplies
the tag. A `:?` would be stricter and would also make the file unusable for anyone who has not read
this page.

#### The backup must leave the machine — ✅ applied, and started for the first time on 2026-10-06

`backup` writes `pg_dump --format=custom` archives into the `backupdata` named volume, which is on the
same EBS disk as `/opt/ozituma/pgdata`. **That is not a backup** — measured with `lsblk`: one disk,
`nvme0n1`, with `nvme0n1p1` at `/`. Losing the instance loses the database and every dump together.

**The change this section proposed was made a different way, and better: `backup-upload`.** It was
designed to upload each dump to the shared R2 bucket under `backups/ozituma/`, and — because that
bucket's `media.ozituma.com` front door serves objects **anonymously** — to encrypt every dump with
`age` **in the pipe**, so no plaintext dump ever reaches the volume or the network. The bucket prefix
is refused at start-up unless it begins `backups/`, which is the guard that keeps a dump from being
confusable with the media under `audio/` and `ozikoro/`.

> 🔴 **THAT SERVICE CANNOT UPLOAD ANYTHING, AND IT IS NOW STOPPED. THE UPLOAD IS DONE BY A HOST JOB.**
> Its `put-object` call passes `--only-show-errors`, which is not an `aws s3api` option. Measured in
> the image it runs, and in its own log at 04:31 on 2026-10-06:
>
> ```
> $ docker run --rm --entrypoint sh ozituma-backup-tools:latest -c \
>     'printf x > /tmp/x; aws s3api put-object --bucket nowhere --key k --body /tmp/x --only-show-errors'
> aws: [ERROR]: Unknown options: --only-show-errors
>
> upload-1 | upload: put-object FAILED for backups/ozituma/ozituma-2026-10-06T03-57-54Z.dump.age — dump kept, will be retried
> ```
>
> **It retries for ever and never succeeds, and it never marks anything `.rejected`** — the attempts
> counter is on the decrypt branch, not the upload branch — so its whole effect was one log line per
> minute. The same invalid flag sits on its read-back `get-object` and its retention `delete-object`,
> so even a successful upload could not have been verified and no expired object could have been
> deleted. `scripts/offsite-upload.sh`, on `ozikoro-offsite-upload.timer`, does the upload, the
> read-back verification and the local prune; `scripts/offsite-retention.sh` does the remote expiry.
> **The compose files were not edited** — that instruction is right for its own reason, and a script
> under `scripts/` plus a systemd timer is entirely outside them.

⚠️ **It had never been started.** Measured on 2026-10-06: no `ozituma-backup-tools` image, no
container, and no object under `backups/` in the bucket — its only top-level prefixes were `audio/`
and `ozikoro/`. **So the design existed and the backup did not**, which is the form this project's
faults keep taking: the file said one thing and production another. **It is running now, and the first
off-machine dumps were written, encrypted, uploaded and verified on 2026-10-06 — but the two the
design expected to carry them were not the two that did it.** See the box above, and
`docs/OZIKORO-BACKUP-AND-ROLLBACK.md` §5.

**The procedure, the measured restore, the retention policy, the cost and the defects found in the
pipeline are in `docs/OZIKORO-BACKUP-AND-ROLLBACK.md`.** The proposal below is kept only to show the
shape that was rejected — its `offsite()` used `aws s3 cp` with no encryption, which the public front
door made untenable:

```diff
@@ backup
     entrypoint:
       - sh
       - -c
       - |
         set -eu
+        # OFF THE MACHINE, OR IT IS NOT A BACKUP. The volume is on the same disk as pgdata.
+        # Credentials come from the instance role; no key is written here.
+        offsite() {
+          aws s3 cp "$1" "s3://${BACKUP_BUCKET}/ozituma/$(basename "$1")" \
+            --only-show-errors && echo "backup: shipped $(basename "$1") offsite"
+        }
         while true; do
```

**A restore of the encrypted dump was executed on 2026-10-06** — into a scratch database, 130 tables
and 361,576 rows back, with one named article read out of it — and it is written down in §4 of
`docs/OZIKORO-BACKUP-AND-ROLLBACK.md`. **An untested backup is a belief.**

### There is a second, sharper rollback inside the image

**Do not reverse a migration by rolling the image back.** The database is shared by all three sites,
and an older image served against a newer schema is the failure that corrupts data rather than
merely breaking a page. If a migration is wrong, the fix is a new forward migration. The one
destructive option, `node packages/db/src/migrate.ts reset`, drops the public schema and is only ever
correct against a scratch database.

⚠️ **MEASURED ON 2026-10-06, AND IT IS MORE ABSOLUTE THAN THE PARAGRAPH ABOVE IMPLIES: THERE IS NO
DOWN-MIGRATION PATH AT ALL.** `packages/db/src/migrate.ts` implements `status`, `up`, `reset`, `seed`
and `fresh` — **there is no `down` case** — while `packages/db/package.json` declares
`"migrate:down": "node src/migrate.ts down"`, which therefore exits non-zero with
`Unknown command "down"`. And the host's applied chain is **ahead of this checkout's**: the host holds
**67 applied migrations across 71 files**, including `0058_set_igbo_language_code`,
`0059_repair_gambia_dictionary_entries`, `0060_restore_lost_glyphs_and_setbacks` and
`0061_seo_overrides`, **none of which exist in this checkout**. So a rollback returns to an image
whose migration chain cannot describe the schema it would be serving.

### The database rollback is a restore, not a reverse

`backup` in the compose runs `pg_dump --format=custom` daily and verifies each archive with
`pg_restore --list` before considering it good. Restoring is selective by design — that is why the
format is custom rather than plain SQL:

```bash
cd /opt/ozituma/app
CF="-f docker/docker-compose.prod.yml -f docker/docker-compose.ozikoro.yml"
docker compose --env-file /opt/ozituma/.env $CF exec -T backup pg_restore --list /backups/ozituma-<stamp>.dump.age | head
```

**The off-machine copy exists as of 2026-10-06.** The sentence that used to close this section read:
*"Until that change is applied, the honest statement is that ozikoro.com has no off-machine backup."*
**That is no longer true and is replaced rather than deleted**, because it was true when it was
written and a reader who finds it next round needs to know it was here. The measured object and the
restore that was performed against it are in `docs/OZIKORO-BACKUP-AND-ROLLBACK.md` §2–§4.

---

## 5. What this document does not claim

- **No DNS call was made in preparing it.** The current values are the ones recorded in `AGENTS.md`
  from a read on 2026-09-28. They are expected values, not measurements taken today, and step 2's
  capture is what replaces them.
- **The cutover has not been rehearsed end to end**, because that requires the host. Steps 5-7 are
  commands for the operator, not results.
- **`docker` is absent from the development machine**, so the compose and Caddyfile were proved by
  parsing rather than by `docker compose config` and `caddy validate`. Those two commands must be run
  on the host — `scripts/check-compose-env.mjs` proves the variable *names* are plumbed to the right
  services, not that Caddy accepts the file.
