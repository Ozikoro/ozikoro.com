# The ozikoro.com cutover — prepared, and reversible

> **What this document is.** A plan. It records exactly what would change, what must be true
> before it changes, what has to be synchronised in the same window, and how every part of it is
> undone. **Nothing in it has been executed, and nothing in it may be executed from this
> checkout.**
>
> **What this round did and did not do.** It read the `ozikoro.com` zone through the Cloudflare
> API (GET only), and it read the production host through AWS Systems Manager (read-only shell
> commands: `ls`, `openssl … -noout`, `docker ps`, `docker inspect`, `grep`, `du`, `ss`, and one
> `ListObjectsV2`). **No DNS record was written, no cPanel function was called, no WordPress
> write was made, and no request was sent to ozikoro.com or any hostname beneath it.** The
> previous audit that made no DNS calls at all was the smaller step; this one reads the zone and
> says which reads it made.
>
> **Owner's instruction, which is the authority for all of it:** *"this is not going to deploy
> until the new design is done, and you have imported every single article and content like
> images and videos in ozikoro.com … and then it can be deployed to avoid shutting the
> website."*

---

## 1. The change itself, as one sentence and one record

**One sentence.** Point the apex `A` record for `ozikoro.com` at the archive's own host,
`44.194.56.187`, instead of the cPanel server that runs WordPress today, leaving the `www` CNAME
exactly as it is and touching nothing that carries mail.

**One record.** Read from the zone this round, quoted verbatim from the API response:

```json
{
  "id": "3a735aa8c89c032f7f8a5957192e19ae",
  "zone_id": "1ebe8c1f9ce3dcec95448b6d93d63e00",
  "zone_name": "ozikoro.com",
  "name": "ozikoro.com",
  "type": "A",
  "content": "162.213.253.73",
  "proxied": true,
  "ttl": 1
}
```

`ttl: 1` is Cloudflare's **Auto**, which for a proxied record is 300 seconds and is not consulted
by any resolver — see §4.2.

### 1.1 The records that move, and the records that must not

Read this round. The zone holds **36 records**, not the 27 an earlier note recorded; that note is
stale and should be corrected wherever it is repeated.

**Moves (the whole of the change):**

| name | type | content | proxied | id |
|---|---|---|---|---|
| `ozikoro.com` | A | `162.213.253.73` → **`44.194.56.187`** | true | `3a735aa8c89c032f7f8a5957192e19ae` |
| `www.ozikoro.com` | CNAME | `ozikoro.com` — **unchanged** | true | `4ae4a46bc5af16b37ad934c7027e5343` |

`www` is a CNAME to the **name** `ozikoro.com`, not to an address. It follows the apex
automatically, in both directions, and must be left alone. **If anyone converts `www` into an `A`
record or a CNAME to the EC2 host, the rollback stops being one change and becomes two.** That
single fact is worth more than any other line in this table.

**Does not move — the mail:**

| name | type | content | id |
|---|---|---|---|
| `ozikoro.com` | MX | `mx.zoho.com` (prio 0), `mx2.zoho.com`, `mx3.zoho.com` | `27373c33…`, `70987ee7…`, `b93667de…` |
| `ozikoro.com` | TXT | `"v=spf1 include:zohomail.com include:spf.web-hosting.com ~all"` | `7bac2ccad02a9b29475c0c7c94cbf782` |
| `ozikoro.com` | TXT | `"zoho-verification=zb62267155.zmverify.zoho.com"`, `"…zb42371172…"` | `02f63393…`, `7393541e…` |
| `zmail._domainkey`, `default._domainkey`, `27165056._domainkey`, `resend._domainkey` | TXT | DKIM, one per sender | — |
| `_dmarc.ozikoro.com` | TXT | `v=DMARC1; p=none; rua=mailto:hello@ozikoro.com; fo=1` | `6a8192ca…` |
| `bounce-zem.ozikoro.com` | CNAME | `cluster89.zeptomail.com` (not proxied) | `d8e048e7…` |
| `send.ozikoro.com`, `rsend.ozikoro.com` | CNAME | `send.forge.rmta.net`, `rsend-euw1.forge.rmta.net` (not proxied) | `2ed97f35…`, `fda34794…` |

**A correction to the brief, established by reading rather than assumed.** The archive's mail is
**not** Namecheap email forwarding. It is **Zoho Mail**: three `MX` records at `*.zoho.com`, Zoho
DKIM and Zoho domain verification, plus `include:zohomail.com` in the SPF. The Namecheap
forwarding note in `AGENTS.md` describes `ozituma.com`, and it was carried across to
`ozikoro.com` in error. The rule is unaffected and is exactly as stated: **do not replace the
SPF, only add.** `include:spf.web-hosting.com` authorises the cPanel host to send as this domain;
after the apex moves it is *unnecessary* but it is not *wrong*, and removing it during a cutover
window would be a second, unrelated change to mail. Leave it.

**Does not move — the cPanel service hostnames:** `cpanel`, `webmail`, `whm`, `ftp`, `mail`,
`autoconfig`, `autodiscover`, `cpcalendars`, `cpcontacts`, `webdisk` — all `A` to
`162.213.253.73`. The owner keeps every mailbox, every cPanel login and every webmail address
after the apex moves, because none of them is the apex.

**Does not move — the media tunnel:** `media.ozikoro.com` is a `CNAME` to
`9f050fdf-0c19-4260-ac5b-d2f47a10677b.cfargotunnel.com` (proxied). It is a **Cloudflare Tunnel**
to somewhere that is not this EC2 host, and nothing in this plan uses it. The archive's media is
served by the application itself at `/media/<key>`, not from this hostname. **Leave it alone, and
do not "tidy" it by pointing it at the EC2 host** — see §3.6 for where the bytes actually are.

**Does not move — the calendar records:** the `SRV` and `TXT` pairs for `_caldav`, `_caldavs`,
`_carddav`, `_carddavs` and `_autodiscover._tcp`, which point at cPanel's 2079/2080/443
services. Unchanged; they are what keeps the owner's calendar and contacts working.

### 1.2 Proxied, or not — and the certificate that decides it

**It must stay proxied, and the reason is the origin certificate, which does not cover this
domain.** Read from the host this round:

```
/opt/ozituma/certs/origin.pem   1668 bytes, mode 0600, root
/opt/ozituma/certs/origin.key   1705 bytes, mode 0600, root

subject = O=CloudFlare, Inc., OU=CloudFlare Origin CA, CN=CloudFlare Origin Certificate
issuer  = C=US, O=CloudFlare, Inc., OU=CloudFlare Origin SSL Certificate Authority
notBefore = Sep 25 16:01:00 2026 GMT
notAfter  = Sep 21 16:01:00 2041 GMT
X509v3 Subject Alternative Name:
    DNS:*.ozituma.com, DNS:ozituma.com
```

**The certificate is for `ozituma.com` and `*.ozituma.com`. It carries no `ozikoro.com` name.**
That one fact settles three questions:

1. **Cloudflare's Universal SSL covers `ozikoro.com` at the edge.** The certificate a *visitor*
   sees is issued by Cloudflare for the zone and is unaffected by the origin certificate. Turning
   the proxy off would remove that certificate and the site would be served over whatever the
   origin presents — which is a certificate for a different domain. **So the record stays
   proxied.**
2. **The zone is on `full` today** (read this round: `settings/ssl → "full"`), and **`full` does
   not validate the origin certificate.** Under `full`, the Cloudflare-to-origin hop is encrypted
   but unverified, so a certificate that does not name `ozikoro.com` will not stop the site
   working. **This is the only reason the cutover can proceed before a new certificate is
   issued.** It is not a good state to remain in.
3. **`full (strict)` would take the site down, and the Caddyfile's own header says `full
   (strict)` is the intent.** Raising the mode before the certificate carries `ozikoro.com` and
   `www.ozikoro.com` would produce a `526 Invalid SSL certificate` on every request. So:

   > **The order is: raise the zone to `full (strict)` *after* a certificate that names
   > `ozikoro.com` and `www.ozikoro.com` is in `/opt/ozituma/certs/`, never before it.**
   >
   > The check, before the raise, is one line on the host:
   > ```bash
   > openssl x509 -in /opt/ozituma/certs/origin.pem -noout -ext subjectAltName \
   >   | grep -Eo 'DNS:[^, ]+' | grep -x -e 'DNS:ozikoro.com' -e 'DNS:*.ozikoro.com' \
   >   && echo 'certificate covers the archive'
   > ```

   A Cloudflare Origin CA certificate is free and is issued for up to 15 years, so obtaining one
   is a task rather than a project. **It is a precondition of the *strict* raise, not of the
   cutover**, and this document deliberately does not make the cutover wait for it.

**Nothing about `flexible`.** The zone is on `full`; `flexible` would be a downgrade (plain HTTP
from Cloudflare to the origin) and is not acceptable. It is named here only so that a later reader
who "fixes" a certificate problem by lowering the mode can see that it was considered and
refused.

**What must be true before the record changes, stated positively:**

- the origin certificate does **not** have to name `ozikoro.com`, **because the zone is on
  `full`** — and this is why the mode must not be raised in the same window;
- the Caddy container must carry both `ozituma.com` and `ozikoro.com` site blocks **and must
  load** — see §2, item 6;
- the `ozikoro` container must be running and healthy on `ozikoro:3000` — see §2, item 5.

---

## 2. What must be true before the switch

Each item is a check with a command. An item without a command is an intention, and this project
has already paid twice for intentions that read like checks.

The twelve faults in round 338 are the reason every item here reads a **destination** rather than
a status code: a `200` is not a working page, and the archive has produced unusable pages that
answered `200` and correct `text/html` on three separate occasions.

### Condition 1 — the site serves, and renders

| # | what must be true | the check |
|---|---|---|
| 1.1 | every page answers and renders | `node scripts/verify-round-338.mjs http://127.0.0.1:3110 --json /tmp/inventory.json` — inventory from three sources, then every address fetched |
| 1.2 | **every `/_next/static` asset a React page asks for answers with a usable MIME type** | `bash scripts/serve-review.sh --check` prints `artefact complete: server.js present, 52 design screens, N static files`; then `bash scripts/verify-live.sh <base>` includes `assets a page must load` |
| 1.3 | the build's own pages ask for assets the build contains | `bash scripts/serve-review.sh --check` — the assertion added in `32dd563`, which fails on a stale or partial static tree |
| 1.4 | the site is a **production** build, not `next dev` | `bash scripts/serve-review.sh --rebuild` and read its build line; the record already warns that reviewing the dev server "tells nothing about production performance or the error boundaries that only production exercises" |
| 1.5 | the artefact is not stale relative to its sources | `bash scripts/test-build-freshness.sh` — this is a regression test for the mid-build edit that the old freshness rule could not see |
| 1.6 | offline suites, all of them | `./scripts/verify-all.sh` with the server **stopped** (it takes the PGlite lock) |
| 1.7 | the 404 a reader lands on renders server-side | `bash scripts/check-not-found.sh <base>` — **still waived**; the check prints the waiver every run rather than passing silently. Recorded as open, not as passing |

### Condition 2 — every nav item, menu, footer link and control reaches the page its label promises

| # | what must be true | the check |
|---|---|---|
| 2.1 | every `href`, `src`, `action` and meta-refresh target on every page resolves **to the page the label named** | `node scripts/verify-round-338.mjs <base>` — it reads the **destination's `<h1>`**, not the status, which is the whole point: four of round 338's faults were links that answered `200` and led somewhere other than the label promised |
| 2.2 | no relative target survives in served markup; exactly one `<base>` per screen | same run, assertion D |
| 2.3 | links a reader can click | `bash scripts/check-links.sh <base> 120` |
| 2.4 | pages a crawler is told about | `bash scripts/check-sitemap.sh <base> 300` |
| 2.5 | links written in article bodies | `bash scripts/check-body-links.mjs` |
| 2.6 | every design screen has a route | `node scripts/check-screen-coverage.mjs` — built because its own `ROUTE` map once held no entry for fourteen dashboards and so reported `NO ROUTE` for exactly those, on every commit |
| 2.7 | each page still has the design's structure, not merely its files | `node scripts/check-design-parity.mjs <base>` — reads section classes and headings from the design screen and from the rendered route, and requires every intended omission to be declared in `EXPECTED_OMISSIONS` |

### Condition 3 — the data is complete

| # | what must be true | the check |
|---|---|---|
| 3.1 | **`docs/IMPORT-RECONCILIATION.md` exists — and every item in its §7 is resolved or individually accepted** | **it now EXISTS** (32,394 bytes, produced by round 339, in the working tree at the time of writing). **This is still a BLOCKING item, for a different reason than when this document was begun** — see below |
| 3.2 | the WordPress dump reconciles against the cluster, table by table | the reconciliation agent's own scripts under `.scratch/recon/` (`parse-dump.py`, `cluster-counts.json`, `media-recon.ts`, `id-diff.ts`) — a read-only comparison against a **copy** of the cluster at `.data/scratch-recon/pg` |
| 3.3 | the dump's own integrity | `python3 scripts/verify-wp-dump.py data/ozikoro-wp/dbdump/sql/ozikbfpe_ozikoro.sql` |
| 3.4 | every media record the live site holds is either imported or explained | `docs/IMPORT-RECONCILIATION.md` §§4.4–4.5 — the discrepancy is itemised there, and the numbers below are superseded by it |
| 3.5 | the record of what was imported | `data/ozikoro-wp/import-report.json` (last written `2026-10-03T22:32:53.595Z`) |

> **BLOCKING — and now it is a list rather than a missing file.**
>
> When this document was begun, `docs/IMPORT-RECONCILIATION.md` **did not exist**
> (`ls docs/IMPORT-RECONCILIATION.md` → `No such file or directory`), and that absence was the
> blocking item. It was written during this round, by the agent whose round-339 entry is in
> `docs/OZIKORO-REMAINING.md`, and it is a genuine reconciliation: **2,616 `INSERT` statements and
> 202,743 tuples parsed with 0 failures, every category counted on both sides, and the article
> arithmetic closing completely** — 1,051 published + 39 drafts + 6 published pages all carry a
> `wp_post_id` in the cluster, and **not one cluster `wp_post_id` exists that the dump does not
> hold**, so nothing was invented either.
>
> **Its §7, "What is genuinely missing", is eleven numbered differences that are not a duplicate,
> an orphan, a placeholder or a merge. That list is the blocking item now, and two of its entries
> sit directly on the owner's launch condition — "every functions and link or menu is functional":**
>
> - **§7.1 — the draft page "Contact Us"** (`wpc9_posts` 3591, 200 words, `contact@ozikoro.com`,
>   `stories@ozikoro.com`) is **the only WordPress page or post of any status that was not
>   imported**, `apps/ozikoro/app` has **no `/contact` route**, so `/contact/` answers **404** —
>   **and three published WordPress menu items pointed at it.**
> - **§7.10 — four of the six published pages' WordPress addresses answer 404**: `/authors/`,
>   `/privacy-policy/` (the content is served at `/privacy/`), `/nze/` and `/construction/`. The
>   content is in the cluster for all six; the *published addresses* are not all served.
> - §7.3 is the largest by volume: **3,061 revisions holding 30,007,462 bytes (28.6 MiB) of text
>   that appears in no surviving post**, with no `ozikoro_article_revision` table to hold it.
> - §7.2 is 51 comments and 248 `commentmeta` rows: no table and no importer.
>
> **The cutover does not proceed until each of the eleven is either resolved or accepted by the
> owner in writing.** A 404 at `/contact/` with three menu items pointing at it is precisely the
> class of fault the launch condition names, and this document will not treat "the reconciliation
> exists" as equivalent to "the reconciliation is clean".

### Condition 4 — the design is byte-identical

Run from a directory where both trees are reachable:

```bash
python3 -c "
import hashlib,pathlib
src=pathlib.Path('design/calm-comfort-construct/public/design'); dst=pathlib.Path('apps/ozikoro/public/design')
s=d=m=0
for f in src.rglob('*'):
    if f.is_dir(): continue
    x=dst/f.relative_to(src)
    if not x.exists(): m+=1
    elif hashlib.sha256(f.read_bytes()).hexdigest()==hashlib.sha256(x.read_bytes()).hexdigest(): s+=1
    else: d+=1
print(f'identical {s} differing {d} missing {m}')"
```

**Measured this round, verbatim: `identical 63 differing 0 missing 0`.** The design trees under
`design/` and `apps/ozikoro/public/design/` are also clean in `git status --porcelain`, and
nothing in this round wrote to either. `check-design-system.sh` and `check-design-parity.mjs`
(item 2.7) are the second, weaker half of the same question — files identical, *and* the rendered
page using them.

### Condition 5 — the backend

| # | what must be true | the check |
|---|---|---|
| 5.1 | **Postgres** — all migrations apply from an empty schema, idempotently, with matching checksums | `node scripts/verify-postgres.ts` against a real server. **Already done: 55 migrations, exit 0, a second `up()` applied 0, every checksum matched, 119 tables, 9 generated columns, 16 GIN indexes, 5 SQL functions, `createDb({url})` reported driver `postgres`** |
| 5.2 | **and the version gap is named, not hidden** | the compose pins `postgres:16-alpine` (`docker/docker-compose.prod.yml` line 21) and that run was on **PostgreSQL 18.4**. **The gap is NOT covered.** Either re-run `verify-postgres.ts` against a 16 image before the cutover, or record the 18 run as evidence about the code and not about the pinned server |
| 5.3 | the production database is reachable and migrated | on the host: `docker compose -f /opt/ozituma/app/docker/docker-compose.prod.yml exec -T postgres psql -U ozituma -d ozituma -tAc "select count(*) from ozikoro_article"` must return a plausible count and not an error |
| 5.4 | **media in object storage** | `node packages/ozikoro/src/import/media-upload.ts --check` must print `driver s3`, `uploaded 0`, and `alreadyStored` equal to `rowsWithKey`. **It will fail today — see §3.6. This is a BLOCKING item.** |
| 5.5 | the object store actually holds the archive's keys | on the host, read-only, no secret printed: the `ListObjectsV2` under `ozikoro/` must return the expected count. **Measured today: `KeyCount = 0`.** |
| 5.6 | the episodes are in object storage too — they are a **separate key path and a separate command** | `node scripts/restore-episodes.ts --check` then `--apply`; then `ListObjectsV2` under `ozikoro/episodes/` must return 3 (or 4, if the owner's own recording is the live one). **Measured today: `KeyCount = 0`.** |
| 5.7 | **secrets are named so the containers receive them** | `node scripts/check-compose-env.mjs --service ozikoro` and `--service caddy`. This is the fault `AGENTS.md` records and commit `bfbc6b5` fixes: compose passes a service **only the variables the service names**, so a value in `/opt/ozituma/.env` is not the same thing as a variable in the container |
| 5.8 | the host's `.env` carries a value for every name the compose now requires | read **names only**. Measured this round, the host `.env` holds `S3_*`, `MEDIA_PUBLIC_BASE_URL`, `POSTGRES_PASSWORD`, `OZITUMA_SMTP_*`, `OZITUMA_MAIL_FROM`, `NOWPAYMENTS_*`, `PAYSTACK_*`, `LEARN_BRIDGE_SECRET`, `AWS_*`, `OZITUMA_DOMAIN`, `OZITUMA_SITE_URL`. **It does NOT hold `OZIKORO_DOMAIN`** (the compose default `:-ozikoro.com` supplies it), **nor `RESEND_API_KEY`, `ELEVENLABS_*`, `SPOTIFY_*`, `SUPABASE_*`, `OZITUMA_AUTH_COOKIE_DOMAIN` or `HEALTH_TOKEN`** — each of which is a feature that will be **off** rather than broken, which is the intended behaviour but should be a decision rather than a surprise |
| 5.9 | the health check passes, and proves the database rather than the socket | `curl -s -o /dev/null -w '%{http_code}\n' http://<host>:3000/api/health` → `200`, and the body's `"database":"reachable"`; the route runs a real query against `ozikoro_article` |
| 5.10 | the containers are up and the healthcheck has not restarted them | `docker compose ps` on the host — an `ozikoro` service in `Up (healthy)` |

### Condition 6 — this document, and the reversibility it describes

| # | what must be true | the check |
|---|---|---|
| 6.1 | the record's present value is quoted here and matches the zone **at the moment of the switch** | re-read the record immediately before changing it (§4.1) and diff against the table in §1.1. **A quoted value from an earlier day is not the same as a verified value at the switch.** |
| 6.2 | the rollback command is written out and its record id is the live one | §4.1 |
| 6.3 | the tree that is deployed is a **committed** revision, not a working copy | see "the deployment source", below |

### The two that catch people

**6a. The Caddyfile must LOAD — and a fault here takes `ozituma.com` down as well.**

The Caddyfile interpolates `{$OZIKORO_DOMAIN}`. An interpolation that resolves to the **empty
string** leaves a site block with no address, and Caddy refuses to load the **whole file** —
which means the dictionary goes down with the archive. Commit `bfbc6b5` fixed the cause (the
`caddy` service was never given `OZIKORO_DOMAIN` and never depended on `ozikoro`) and added a
`:-ozikoro.com` default so an unset value cannot reach the interpolation. **The check comes
before the reload, never after:**

```bash
# 1. compose resolves the interpolation for the caddy service, and reports the value it will use
docker compose -f /opt/ozituma/app/docker/docker-compose.prod.yml config | \
  sed -n '/^  caddy:/,/^  [a-z]/p' | grep -E 'OZIKORO_DOMAIN|OZITUMA_DOMAIN'

# 2. Caddy itself agrees the file is loadable — BEFORE any restart
docker exec ozituma-caddy-1 caddy validate --config /etc/caddy/Caddyfile
```

`caddy validate` is the authoritative check and `--config` is the same path the container has
mounted. **It exits non-zero on an empty site address, before anything is restarted, which is
the entire point of running it in this order.** The `caddy` container's health is also
`ozituma.com`'s health; treat any failure here as a stop, not a warning.

**6b. The CSP must admit the media origin — or every image and every player is blocked in a
browser while `curl` returns `200`.**

Measured on the production host this round:

```
MEDIA_PUBLIC_BASE_URL  scheme=https  host=media.ozituma.com
S3_ENDPOINT            scheme=https  host=ea4b95012b9f4252ff61c9393a87287f.r2.cloudflarestorage.com
```

So the media base **is** an absolute cross-origin URL, and the condition the brief describes is
live rather than hypothetical. The app's own policy is built in `apps/ozikoro/next.config.ts`:

```
img-src 'self' data: https://i.ytimg.com<mediaSources>
media-src 'self'<mediaSources>
```

and today `mediaSources` is derived from `MEDIA_PUBLIC_BASE_URL` **in the working tree, in an
uncommitted change** (`git status --short apps/ozikoro/next.config.ts` → ` M`; the expression
`mediaOrigin`/`mediaSources` is **not in `HEAD`**). With that derivation in place the origin is
admitted automatically. Without it — that is, in any image built from `HEAD` — the policy is
`img-src 'self' data: https://i.ytimg.com` and `media-src 'self'`, and **any page that emits an
absolute `https://media.ozituma.com/...` address in an `<img>`, `<audio>` or `<video>` would be
refused by the browser while every `curl` returned `200`.**

Two facts reduce the risk and neither removes it. The archive builds its media addresses
**relatively** (`/media/<key>`, from `mediaPath` in `packages/ozikoro/src/media.ts`), so `'self'`
covers them; and `publicUrl()` — the only method that honours `MEDIA_PUBLIC_BASE_URL` — has no
caller under `apps/ozikoro` or `packages/ozikoro`. But a single `<img src>` built from the
environment, in a page or a design fill that nobody re-read, is the whole failure.

**Both must be checked before the switch:**

```bash
# 1. what policy the built artefact actually sends
curl -sI http://127.0.0.1:3110/ | tr ';' '\n' | grep -iE "content-security-policy|img-src|media-src"

# 2. does any served page emit an absolute cross-origin media address at all
node scripts/verify-round-338.mjs http://127.0.0.1:3110 --json /tmp/inv.json
python3 -c "
import json,re,sys
inv=json.load(open('/tmp/inv.json'))
hits=[(p,t) for p,v in inv.items() for t in v.get('targets',[])
      if re.search(r'https?://(media\.ozituma\.com|media\.ozikoro\.com|[\w.-]*r2\.dev)', t)]
print('absolute media targets found:', len(hits))
for h in hits[:20]: print('   ', h)"
```

If (2) finds any, the policy must name that origin (`mediaSources`) **and the guard must be
committed before the image is built** — an uncommitted derivation is not in any artefact.

### The deployment source — an item this round found and the brief did not expect

**The host's checkout is not this checkout, its revision is not in this repository, and the two
checkouts name different remotes.**

```
host:  /opt/ozituma/app   →  git rev-parse HEAD = 7ae48084625fa10a4b6bc4e59023b00ae1e5d08e
                             "feat(entries): two examples per page, as the owner asked"
                             git status --short | wc -l  =  234
                             git remote -v  →  https://github.com/oziikoro/Ozikoro.git
                             git log --oneline -1 origin/main  →  c32876e
                                 "fix(public): the language cards and the contribute note"
here:  git cat-file -t 7ae48084625fa10a4b6bc4e59023b00ae1e5d08e  →  fatal: could not get object info
       git remote -v  →  git@github.com:Ozikoro/ozikoro.com.git
```

This clone holds **384 commits on `main` only**, is not shallow, and has **one** remote. The host's
revision is not among them. **The repository names differ** — `oziikoro/Ozikoro` on the host,
`Ozikoro/ozikoro.com` here — and `AGENTS.md` names `github.com/oziikoro/Ozikoro` as *the correct
remote for this project*. So the two checkouts may not be the same repository at all, which would
explain the missing object completely. **This is not established either way and it is the first
thing to settle before anything is built.** What is certain is the consequence: the host's checked-out
tree is not the tree this document describes.

**And the host's own checkout is behind its own remote**: `origin/main` there is `c32876e`, while the
working tree is at `7ae4808`. So the host has a newer revision available to it and is not on it.

The host's compose file and mounted Caddyfile come from that tree, and **the Caddyfile it mounts has
no `ozikoro` block at all** (`grep -n ozikoro /opt/ozituma/app/docker/Caddyfile` returned nothing
this round).

Consequences, stated plainly:

- **Nothing here may be assumed to be what the host will deploy.** The compose and Caddyfile
  changes in `bfbc6b5` exist in *this* checkout and are not on the host's tree.
- **The cutover therefore includes a deploy step that this document cannot fully specify**:
  reconciling the host tree with a committed revision, then building `ozikoro-site:latest`. **That
  image does not exist on the host** — verified by listing them, not inferred:

  ```
  $ docker images
  ozituma-web:latest    685MB  58 minutes ago
  <none>:<none>         685MB  15 hours ago
  ozituma-learn:latest  681MB  3 days ago
  caddy:2-alpine        60.4MB  2 weeks ago
  postgres:16-alpine    288MB  2 weeks ago
  ```

  No `ozikoro-site`. So the archive has never been built or started on that host.
- **89 paths are dirty in this checkout right now** (four agents are working in it), including
  `apps/ozikoro/next.config.ts`, whose uncommitted change is item 6b above. **The image must be
  built from a committed revision, not from a working tree.** Pin the SHA, and build that.

Check before the deploy:

```bash
# on the host, after reconciling the tree
cd /opt/ozituma/app && git remote -v | head -2
cd /opt/ozituma/app && git rev-parse HEAD && git log --oneline -1 origin/main
cd /opt/ozituma/app && git status --short | wc -l
```

The two SHAs must be the same one that was reviewed, and the dirty count must be 0 — or every dirty
path must be individually accounted for. **If the remotes name different repositories, stop and
settle that first**: it decides what "deploying the reviewed revision" even means.

### The link scan, and where it sits in this deploy

The owner's instruction: *"then scan every link when you deploy the website to be sure they are all
working."* **There is no deploy script in this repository to add a step to** — the deploy is the manual
sequence above, run on the host, and §1 records that the host's own tree is not this one. So the scan is a
command, and this is where it belongs:

```bash
# against the CANDIDATE, before anything is switched over — not against the live site afterwards
BASE=http://127.0.0.1:3110 ./scripts/verify-live.sh      # every live check, one of them the link scan
```

`scripts/verify-live.sh` is this project's runner for "the things that need a running server", so the checks
are wired there rather than into a fourth script. Three of them are the instruments that see what a status
cannot, and each was measured on 2026-10-04 against a running review server:

| command | what only it can see | time |
|---|---|---|
| `scripts/check-link-destinations.mjs` | status **and content-type** for every control on the listen and film pages, cross-origin included — a `btn` that answered 200 with `text/plain` is the fault it exists for | 4m47s, mostly YouTube latency |
| `scripts/check-page-variants.mjs --no-articles --crawl 40` | a bare address against its parameterised form; every fragment against the page that must own it; **the identity rule** — a control carrying a record's id in a `data-` attribute whose address no longer carries it | 1m18s |
| `scripts/verify-round-344.mjs --sample 24 --gate` | the breadth: the front page's own navigation and everything one step behind it, every address followed once, with `--gate` making a problem an exit code | 124s (21 pages, 1,768 references, 457 addresses) |

**A non-zero exit means do not switch over.** Two things are stated rather than hidden:

- **`--full` is the release sweep, not the deploy sweep.** `verify-round-344.mjs` with no `--sample` walks all
  112 pages and ~879 addresses and takes **ten to twelve minutes** — the right tool before a release and the
  wrong one on every deploy, because a gate people skip is not a gate. `check-page-variants.mjs` without
  `--no-articles` adds the whole article family and is slower again.
- **None of them clicks.** A control wired by a script is measured by
  `scripts/verify-round-344-chrome.mjs` in a real browser, which needs Chrome and is a separate pre-release run.

---

## 3. The delta sync

This is the part that decides whether anything is lost, and it exists because **the live site is
still being published to**. The archive is a copy, and a copy of a moving thing is wrong the
moment it is taken.

### 3.1 Where the copy stands, and how far behind it is

| source | taken | counts |
|---|---|---|
| REST extraction (`data/ozikoro-wp/manifest.json`) | **2026-10-02T04:03:30Z** | articles 1,051 · pages 6 · media 3,488 · users 11 · categories 14 · tags 11,056 |
| database import (`data/ozikoro-wp/import-report.json`) | **2026-10-03T22:32:53Z** | contributors 15 · topics 14 · labels 11,056 · media 3,488 · articles 1,057 · drafts 39 · articleLabels 18,496 · articleMedia 1,050 |
| cPanel SQL dump (`…/sql/ozikbfpe_ozikoro.sql`) | **2026-10-04T00:52:30** | 121,468,815 bytes · 13,327,554 gzipped · 111 `CREATE TABLE` · 41 tables hold rows |
| live site, as measured in round 213 | 2026-10-02 | posts 1,051 · media 3,582 → **94 media newer than our snapshot** |

From the dump's own row counts (`data/ozikoro-wp/dbdump/sql/ozikbfpe_ozikoro.rowcounts.txt`),
which were the strongest statement available when this document was begun, and **which round 339's
reconciliation has since superseded** — its tokeniser parsed 9,144 rows where the earlier file
parsed 9,139, and its like-for-like article count is 1,051 against this file's 1,050:

```
wpc9_posts total rows parsed   9,139     ← round 339: 9,144
  post_status:  7,844 inherit · 1,220 publish · 43 draft · 27 email_failed · 2 auto-draft · 1 private
  post_type:    4,263 revision · 3,582 attachment · 1,091 post · 33 nav_menu_item · 7 page · …
  post_type=post by post_status:  1,050 publish · 39 draft · 2 auto-draft   ← round 339: 1,051 publish
```

**That one-record difference is why `docs/IMPORT-RECONCILIATION.md` is the authority and this
section is not.** Round 339's table shows Articles (publish) **1,051 = 1,051, difference 0**, and
the article arithmetic closing completely. The earlier count was five rows short because it was a
less complete parse, not because a record is missing. **Do not re-derive these numbers; read round
339's table and re-run its scripts.**

**What the reconciliation itemises, where this section previously left it open:**

- **3,583 `attachment` rows against 3,488 `ozikoro_media` rows — 95.** 94 are the images the 39
  WordPress drafts carry and **1 is a WordPress database-export `.txt` uploaded by mistake**. Of
  the 95, **15 have the identical file held under a duplicate attachment; 80 have no file
  anywhere.** The `attachment` count is 3,583, not the 3,582 the API reported.
- **51 `storage_key` NULL rows** — their files exist in neither store, and the live site answers
  `404` for them too. The record survives with its original size and rights; the bytes are gone
  from both sides and are not recoverable from the dump.
- **80 draft images** recoverable only by fetching them from `ozikoro.com` — named as §7.5 of the
  reconciliation.

### 3.2 Two channels, and what each one is for

| channel | command | what it brings | what it cannot bring |
|---|---|---|---|
| **WordPress REST API** (no credentials) | `npm -w @ozikoro/platform run import:wordpress -- --refresh --binaries` | every published post, page, media record and binary, author, category, tag | **drafts, pending, private and future posts** — the public route answers `400 rest_invalid_param` for `status=draft`. Those came in through `cms/` and `recovered.ts` from an **authenticated Chrome session** (rounds 187–190), because `wp-login.php` sits behind a Cloudflare JavaScript challenge. A refresh that only uses the public route would silently not see a new draft |
| **cPanel / phpMyAdmin export** (credentialled) | `./scripts/export-wp-db.sh` | the whole database: draft rows, revisions, postmeta, usermeta, comments, options — everything the API omits | nothing, but it is a **115.8 MiB** read against a shared host |

The dump is consumed today by three things only — `scripts/derive-media-rights.ts`,
`packages/ozikoro/src/ops/backfill-author-portraits.ts`, and `scripts/verify-wp-dump.py`. **There
is no importer that loads the dump into Postgres as rows.** The archive's rows come from the REST
extraction. That is worth saying because it changes what a "re-export" is for: **the dump is the
authority for the reconciliation and for the fields the API will not serve; it is not itself a
load path.**

### 3.3 Idempotency — confirmed by reading the code, not repeated

The importers are described as idempotent. Read, they are:

- `packages/ozikoro/src/import/archive.ts` → `upsertBatch()` emits
  `insert into <table> (…) values … on conflict (<conflictColumn>) do update set <col> = excluded.<col>`
  and de-duplicates rows on the conflict target **first**, because Postgres refuses an
  `ON CONFLICT` statement that would touch the same row twice. Join tables use
  `insert … on conflict do nothing` (their keys are composite, so a single-column conflict target
  is not expressible). Redirects use `on conflict (from_path) do update set to_path = excluded.to_path`.
- The conflict keys are the preserved WordPress ids: `wp_id`, `wp_media_id`, `wp_term_id`,
  `wp_user_id`. **Every row keeps its WordPress id**, which is what makes "update the same row"
  true rather than aspirational. `import-report.json` records `"conflicts": []`.
- `packages/ozikoro/src/import/media-store.ts` sets `storage_key` only where the file exists on
  disk, and skips rows that already have one — resumable and re-runnable.
- `packages/ozikoro/src/import/media-upload.ts` asks the driver whether each key is already
  present and skips it — "the same objects can be written concurrently … a repeated `PUT` of an
  identical object is harmless".
- `scripts/restore-episodes.ts` writes a pointer and is check-then-apply.

**So a re-run of the same import against a fresh extraction updates rows and duplicates none.
That claim is confirmed, and two limits on it are not in the claim and matter more:**

1. **There are no deletes anywhere in this path.** A post deleted in WordPress after the import
   keeps its row, and the archive keeps serving it. A re-run cannot notice, because the fresh
   extraction simply will not mention it and nothing compares the two sets. **The reconciliation
   is the only place this can be caught, and it must compare in both directions** — records the
   dump has that the cluster lacks, *and* records the cluster has that the dump no longer
   mentions. `id-diff.ts` already prints both.
2. **`--refresh` re-fetches published records only.** A post unpublished after the import stays
   `published` in the archive. Same class, same place to catch it.

### 3.4 What has to be re-exported, how, and how long it takes

**Measured, not estimated.** The existing dump was produced by `scripts/export-wp-db.sh` in
**per-table mode** — one phpMyAdmin request per table, because a single request for all 111 dies
halfway with `#2006 … gone away` and the truncated gzip *looks* like a successful `200`. The
evidence on disk:

```
.scratch/cpanel/parts/  112 parts
first part  2026-10-04T00:16:04
last part   2026-10-04T00:52:30
elapsed     36 minutes 26 seconds
output      121,468,815 bytes uncompressed · 13,327,554 gzipped
```

The script resumes: a part already on disk that verifies (valid gzip, carries its own
`CREATE TABLE`, ends in phpMyAdmin's epilogue, no `gone away` in the tail) is kept. **So a second
run is cheaper than the first by however much is still valid — and it is still the same script
and the same mode that must be used.**

The REST refresh has no measured duration in this repository. What is known:

```
requests       ~170 (1,051 posts and 3,582 media at 100/page, 11,056 tags at 100/page, 6 pages, 11 users)
binaries       3,751 files currently on disk, 888,068 KB (867 MiB), for 3,582 records
disk evidence  files span 2026-10-01T16:25 to 2026-10-02T22:43 — two passes, so this is not a
               single-run duration and is not quoted as one
```

**So the honest answer to "how long does it take" is: 36m26s for the database export, measured;
and for the media pass, size the window from a dry run rather than from a guess.** The instrument
is `--limit`: `node src/import/media-upload.ts --apply --limit 20`, timed, multiplied by the
outstanding count — a measurement rather than a plausible substitute. And the REST refresh is
resumable by design (every API page is cached on disk, keyed by endpoint and page number, and
`--binaries` skips a file already present), so **an interrupted window costs only the part it did
not finish**, not the whole run.

### 3.5 The sequence at the moment of the switch, and the window

**The window is invisible to readers, and that is the design.** The apex still points at cPanel
until the last step, so while the export, the import and the media upload run, **every visitor is
on the old WordPress site, unchanged**. There is no maintenance page and no degraded state. The
new site is not reachable by name until the record changes; it is reachable by address (§4.4).

| step | who | what | the window |
|---|---|---|---|
| T−1 | owner | **freeze writing in WordPress.** This is the only step a human must take, and it is the step that bounds everything else | starts the clock |
| T0 | operator | `./scripts/export-wp-db.sh` (cPanel, per-table) | **36m26s measured** |
| T0 | operator | `npm -w @ozikoro/platform run import:wordpress -- --refresh --binaries` | sized by the dry run, §3.4 |
| T0 | operator | `media-store.ts --apply` → `archive.ts --apply` → `media-upload.ts --apply` → `restore-episodes.ts --apply` | resumable |
| T0 | operator | reconciliation: dump vs cluster, both directions | report |
| T0 | operator | build `ozikoro-site:latest` from a pinned SHA, `docker compose up -d ozikoro`, **`caddy validate`, then reload caddy** | minutes |
| T0 | operator | the pre-flight checks of §2, against the archive **at the origin**, reached by `--resolve` | — |
| **T1** | operator | **the one DNS change**: `PATCH` the apex record (§4.1) | **the switch** |
| T1+ | operator | verify through Cloudflare; keep the rollback command open in a shell | ~5 minutes to be sure |

**What a reader sees during the window:** the old site, exactly as it is. Nothing else. If the
window is opened and then abandoned, **nothing has changed and nothing needs undoing** — the apex
is still at `162.213.253.73`. This is what makes the plan safe to start and safe to stop.

**How the owner knows the sync is complete** — three printed numbers, none of them a status code:

1. the reconciliation report from `docs/IMPORT-RECONCILIATION.md`'s instrument: records in the
   dump and not in the cluster, and records in the cluster not in the dump, both **0** (or each
   one named and accepted);
2. `media-upload.ts --check` printing `driver s3`, `uploaded 0`, `missingOnDisk 0`, and
   `alreadyStored` equal to `rowsWithKey`;
3. a read-only `ListObjectsV2` on the bucket showing `ozikoro/` and `ozikoro/episodes/` at the
   expected object counts — the same probe that reads `0` today.

### 3.6 The media — the hard blocker, verified empty

**This is not a risk. It is a measured absence, and it stops the cutover.**

The compose passes the same object store to all three sites. Read this round, on the production
host, through the running `ozituma-web-1` container's own storage driver (**`LIST` only —
`ListObjectsV2`, no `PUT`, no `DELETE`; no secret printed**) against
`S3_ENDPOINT = https://ea4b95012b9f4252ff61c9393a87287f.r2.cloudflarestorage.com`:

```
top-level prefixes:
    audio/
root objects: 0
prefix ozikoro/           KeyCount = 0
prefix ozikoro/episodes/  KeyCount = 0
prefix ozikoro            KeyCount = 0
prefix audio/             KeyCount = 3   (the dictionary's corpus; proof the listing works)
```

**The bucket holds one top-level prefix, `audio/`, and nothing else. Not one of the archive's
3,437 media files has ever been uploaded.** The 838 MB the brief names is on **this development
machine**, in the local storage driver's root:

```
.data/media/ozikoro        3,441 files   858,372 KB  (838 MiB)   ← LOCAL_MEDIA_ROOT (.data/media)
  └─ episodes/                 4 files   (the spoken records — §3.7)
data/media/ozikoro-wp      3,751 files   888,068 KB  (867 MiB)   ← the WordPress extraction
```

What this means in production, precisely. `apps/ozikoro/app/media/[...key]/route.ts` tries object
storage first and then the local archive copy, and **refuses the local copy in production,
loudly**:

```js
if (process.env.NODE_ENV === 'production') {
  console.warn(`[media] ${key} is not in object storage and the local archive copy is not served in production. …`);
  return new NextResponse('Not found', { status: 404 });
}
```

And the image cannot rescue it either: `.dockerignore` excludes `.data` and `data/media` from the
build context, so **the container carries no copy of these files at all**, and the host has no
such directories (`du -sh /opt/ozituma/app/.data/media` → *No such file or directory*; likewise
`data/media`). **So on the new host every one of the archive's images, documents and videos would
return `404` while every page around them answered `200`** — the exact shape of fault this
project has now paid for four times.

Two things follow, and the second is the one that costs a day:

- **The upload is a blocking precondition**, with its own verification (5.4–5.6 above).
- **The bytes and the credentials are on different machines.** The 838 MiB is here; `S3_BUCKET`,
  `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are in `/opt/ozituma/.env` on the
  host and are not in this checkout. So the upload runs either **(a)** from here, with the host's
  `S3_*` injected into the environment for the duration of the run, **(b)** on the host, after
  copying 838 MiB to it (the host has 26 GB free — measured: `40G` total, `15G` used, `38%`), or
  **(c)** in a container here with the media directory mounted and the `S3_*` supplied. **Whichever
  is chosen, `media-upload.ts` is the instrument**, because it goes through `getStorage()` — the
  same code path that serves the file — so the local run proves the production read.

One more trap, already handled and worth not re-breaking: `assertStorageIsSeparate()` refuses to
run if the archive directory sits inside the storage root, because that would copy each file onto
itself. The two are different directories today (`.data/media` vs `data/media/ozikoro-wp`) and
**that must stay true.**

### 3.7 The audio — a separate key path, and a separate command

**The brief asked whether the episodes are covered by the same move. They are not.**

The four MP3s live at `.data/media/ozikoro/episodes/`, inside the local driver's root, and they
are addressed by a **second, narrower key pattern** in the media route:

```js
const EPISODE_PATTERN = /^ozikoro\/episodes\/[A-Za-z0-9._\-]{1,180}$/;
```

They are not `ozikoro_media` rows, and `media-upload.ts` walks `select storage_key from
ozikoro_media …` and matches filenames with a **top-level `readdir(MEDIA_DIR)`** — which cannot
see into `episodes/` even if the rows existed. **So running `media-upload.ts` alone uploads 3,437
images and zero episodes, and the three players would 404 on the new host while every image
worked.**

The instrument for the audio is `scripts/restore-episodes.ts`, which reads the bytes from
`.data/media/ozikoro/episodes/` and puts them through `getStorage()` under
`ozikoro/episodes/<slug>.mp3`:

```
ute-okpu-an-ika-igbo-clan-and-its-nri-roots.mp3                    8,029,457 bytes
igbo-folklore-twelve-timeless-tales-of-wisdom-wonder-and-moral-heritage.mp3  8,541,919 bytes
how-tortoise-got-his-bumpy-shell.mp3                               2,310,522 bytes
ute-okpu-an-ika-igbo-clan-and-its-nri-roots.owner-recording.mp3   10,672,389 bytes  ← a fourth file
```

**Three episodes are recorded in the script's own `EPISODES` list; the fourth file is the owner's
own recording** (`scripts/adopt-episode-recording.ts`, which writes
`ozikoro/episodes/<slug>.owner-recording.mp3` and *deliberately does not overwrite* the generated
file). Which one a given episode row points at is a database question. **Do not infer it from the
filenames — ask the row**, and upload **both** keys, because a repeated `PUT` of an identical
object is harmless and a missing key is a silent `404`:

```bash
node scripts/restore-episodes.ts --check      # names the rows, the files and the keys
node scripts/restore-episodes.ts --apply
node scripts/adopt-episode-recording.ts --check   # the owner-recording path, if it is the live one
# then: ListObjectsV2 under ozikoro/episodes/ must return 3 (or 4)
```

---

## 4. The rollback

### 4.1 The exact change, the exact record, the exact previous value, the exact command

**The record as it is now** (quoted in §1; re-read it immediately before the switch, because the
substitution must be against the live value rather than against this page):

```
zone     ozikoro.com
zone id  1ebe8c1f9ce3dcec95448b6d93d63e00
record   3a735aa8c89c032f7f8a5957192e19ae
type     A
name     ozikoro.com
content  162.213.253.73      ← the previous value, to be restored verbatim
proxied  true
ttl      1                   ← Auto
```

**The change (forward), and it is the only write this plan makes:**

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"A","name":"ozikoro.com","content":"44.194.56.187","proxied":true,"ttl":1}' \
  "https://api.cloudflare.com/client/v4/zones/1ebe8c1f9ce3dcec95448b6d93d63e00/dns_records/3a735aa8c89c032f7f8a5957192e19ae"
```

**The rollback, and it is the same call with one string changed — a substitution, not a
reconstruction:**

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"A","name":"ozikoro.com","content":"162.213.253.73","proxied":true,"ttl":1}' \
  "https://api.cloudflare.com/client/v4/zones/1ebe8c1f9ce3dcec95448b6d93d63e00/dns_records/3a735aa8c89c032f7f8a5957192e19ae"
```

**`www` is not in either command, and must not be.** It is a CNAME to the name `ozikoro.com`, so
it follows the apex in both directions with no second change and no second chance to get it
wrong.

Two operational notes on the commands themselves:

- **`PATCH` with the full desired state is preferred over `PUT`.** `PUT` replaces the record and
  silently drops any field not supplied; `PATCH` changes what is named. The payload above names
  every field the record has, so the two are equivalent *as written* — the preference is so that a
  later edit that omits a field does not become a behaviour change.
- **Never `DELETE` and re-create.** A new record gets a new id, and the rollback above — and this
  document — would then be pointing at a record that no longer exists. `PUT`/`PATCH` on the
  existing id preserves both.
- The token is the shared, account-wide one described in `AGENTS.md`. **Read it, never print it.**
  Its DNS-write capability is recorded there as verified (an empty body to
  `/zones/{id}/dns_records` returns `9000 "DNS name is invalid"`, which is content validation,
  where a non-DNS:Edit token returns `403/9109`). **That probe was deliberately not re-run this
  round**: it is a `POST` to a mutating endpoint on a live zone, and the standing rule for this
  task is that no mutating call of any kind is made. Read access was proven by the `GET`s that
  produced §1.

### 4.2 The timing — and why a proxied record is not like an unproxied one

**The rollback is fast, and the reason is worth stating exactly.**

Both records are **proxied**. A proxied record's answer, as far as any resolver is concerned, is
Cloudflare's anycast address — and that answer **does not change at all** when the origin behind
it changes. What changes is Cloudflare's edge configuration, which is central, not distributed by
TTL. So:

| | proxied (this case) | unproxied |
|---|---|---|
| what a resolver caches | the Cloudflare anycast address | the origin address itself |
| does that cached value change? | **no** | yes |
| what governs propagation | Cloudflare's edge config rollout — Cloudflare documents changes to proxied records as taking effect **within about 5 minutes** globally, and typically in seconds | the record's **TTL** |
| the `ttl` field | `1` = Auto = 300s, **and it is not consulted by resolvers** | Auto = 300s, honoured by resolvers |
| rollback feels like | a switch, not a wait | up to one TTL of stale answers |

**So: the rollback of a proxied record is effectively a switch, and the "wait for DNS" instinct
does not apply.** Two caveats that do:

1. **Cloudflare's cache is a separate thing from its DNS**, and it is not purged by a DNS change.
   Pages are safe — the Caddyfile now forces `Cache-Control: private, no-cache, no-store,
   max-age=0, must-revalidate` on both sites, and the archive sends `no-store` itself, so there is
   no page cache to purge. **The cached exceptions are `/_next/static/*`, `/assets/*`, `/fonts/*`
   and `/design/*`**, which are given `public, max-age=31536000, immutable`. Three of those four
   are content-hashed. **`/design/*` is not** — its paths are stable (`/design/styles/main.css`)
   and its content can change. A rollback that leaves a cached `/design/*` object at the apex
   could serve the new archive's stylesheet for a path the old WordPress answers `404` on. If that
   matters, purge `/design/*` (and `/media/*`) as part of the rollback. **It is a Cloudflare cache
   operation, not a DNS one, and it is the one thing in the rollback that does not undo itself.**
2. **The visitor's browser** caches the same things under the same rules. A reader who loaded the
   archive and is then sent back to WordPress may serve a cached `/design/...` from their own
   cache. Content-hashed assets are safe; `/design/*` is not.

### 4.3 What the rollback does **not** restore

**Rolling DNS back moves the readers. It does not move the data, and it does not empty the
archive's database.** Stated as state, so a later reader does not have to work it out:

| state | after a rollback | reconciled how |
|---|---|---|
| the old WordPress site | **untouched, and it always was.** Every cPanel export in this plan is a `SELECT`; no WordPress write and no cPanel function is called | nothing to reconcile |
| the archive's Postgres `ozikoro_*` rows | **still there, still populated.** The import wrote them; a DNS change does not un-write them | they are invisible while the old site serves. Re-running the import when the archive serves again is **safe and non-duplicating** — the upserts are keyed on the preserved WordPress ids (§3.3) |
| **records created only on the new host** — accounts, contributor claims, donations, narration revisions, audit rows | **still there, and with no counterpart on the old site.** A person who signed up during the window is not on WordPress; a donation recorded during the window exists only here | **not discarded.** They are correct records of things that really happened, and they reappear when the archive serves again. **The rule is: do not roll the database back. Roll the DNS back and leave the data where it is.** |
| media uploaded to the object store | **still there.** Harmless — the old WordPress site does not read this bucket | nothing |
| the archive's image on the host | still built and still running; the container simply stops receiving traffic by name | reversible in place |
| the Cloudflare edge cache | **not restored** — see §4.2, caveat 1 | purge `/design/*`, `/media/*` if needed |

**The one inconsistency worth naming out loud:** for as long as the rollback stands, the archive's
database holds rows derived from a WordPress snapshot that WordPress itself has since moved past —
because the owner resumed writing. **That is not corruption; it is a stale copy, which is what it
was before the cutover too.** The next attempt re-runs §3 and re-synchronises; the idempotent
upserts make that a re-run rather than a repair. **A rollback does not create work to undo. It
creates a snapshot to re-take.**

### 4.4 A second rollback path that does not depend on DNS at all

The apex record is not the only way to reach either site, and this is the part worth having
written down before it is needed.

**1. Verify — and keep working — against the origin, by overriding the name instead of the
record.** The EC2 security group is `sg-0ac0065eb9c7725b4` (`ozituma-web`) and it permits
**`tcp/443` and `tcp/80` from `0.0.0.0/0`** — read this round. Caddy holds a site block for
`{$OZIKORO_DOMAIN}` = `ozikoro.com`, so the origin answers for that Host header directly:

```bash
# the pre-flight, before the record moves
curl -sS --resolve ozikoro.com:443:44.194.56.187 -kI https://ozikoro.com/ | head -5
curl -sS --resolve www.ozikoro.com:443:44.194.56.187 -kI https://www.ozikoro.com/ | head -5

# and the same instrument while the record is wrong
curl -sS --resolve ozikoro.com:443:44.194.56.187 -k https://ozikoro.com/ | grep -o '<h1[^>]*>[^<]*'
```

**`-k` is required today and the reason is §1.2: the origin certificate names `ozituma.com`, not
`ozikoro.com`.** With `--resolve` this is a deliberate, local override; without it, a browser
would refuse the certificate. **It is the strongest single check in this document**: it proves
the archive serves at the address the record will point to, *before* the record points there, and
it keeps proving it afterwards whether or not the record is right.

**2. Put one reader back on the old site without touching Cloudflare.** The old platform was never
stopped, never migrated and never written to. Its address is `162.213.253.73`. A hosts-file entry
restores it for that machine while the record is fixed:

```
162.213.253.73   ozikoro.com   www.ozikoro.com
```

**One thing about this path was not established**: whether cPanel presents a certificate that
validates for `ozikoro.com`, which decides whether that entry gives a working HTTPS site or a
certificate warning. Establishing it needs a request to `ozikoro.com`, which this round was not
allowed to make — see §5. It is a fallback for the owner's own machine first and for everyone
second; do not describe it as a general-purpose mitigation until that is known.

**3. Leave the apex where it is and serve the archive at a second name.** Adding
`archive.ozikoro.com` pointing at `44.194.56.187`, with the proxy on, gives the archive a real
hostname that does not disturb the apex, the mail or the cPanel hostnames. **This is a DNS write,
so it is not a "no DNS" path** — it is named here because it is *additive*: it changes nothing
that currently works, and it can be removed on its own. It is the right answer if the owner wants
to invite readers onto the archive before committing the apex.

**4. If Cloudflare itself is the fault**, the registrar is Namecheap (recorded: renews
2027-07-24) and holds the nameservers (`clint.ns.cloudflare.com`, `khloe.ns.cloudflare.com`).
**Moving nameservers is a far larger change than the one this document describes and is not a
rollback** — it is the last resort, it has its own propagation measured in hours, and it should
not be reached for. It is listed so that "we have no other option" is never said.

---

### 4a. The encrypted database backup: the key, and what a lost key costs

**This section is new in round 360, and it has to say first that this document did not describe the
database backup pipeline at all.** Every "dump" above is the *WordPress* SQL dump (`§3.4`), a different
artefact with a different lifecycle. The production database backup — `backup` and `backup-upload` in
`docker/docker-compose.prod.yml`, dumping to `backupdata` and uploading to `backups/ozituma/` in R2 —
was documented only in that compose file's own comments. **It is here now because the key's offline
copy is an operator step, and an operator step that lives in a compose comment is an operator step
nobody performs.** It sits beside the rollback deliberately: this is the other thing that has to be
right on the day something has gone wrong.

#### Why it changed, in one measurement

`media.ozituma.com` is the R2 bucket's custom domain and it serves objects **anonymously**. Measured
this round, with no credentials at all:

```bash
curl -sI https://media.ozituma.com/ozikoro/9274-osm-intl8aa250x200@2x.png
# HTTP/2 200
# content-type: image/png
# content-length: 47361
```

The R2 endpoint's own door refuses the same object (`400`, round 353), so the bucket is private in
front of one door and open behind another. A dump holds **every account row, every session, every
password hash and every audit entry**, and `backups/ozituma/ozituma-<timestamp>.dump` is a key someone
can guess. Dumps are now named `ozituma-<timestamp>.dump.age` and are encrypted with `age` inside the
pipe that produces them, so a guessed key returns ciphertext. **That is the whole fix**: the public
front door stops mattering, because the bytes behind it are useless without the identity below.

#### The command

Nothing to install: `age` is in the image both backup services run, built by `docker/Dockerfile`'s
`backup-tools` target from `postgres:16-alpine` plus the Alpine `age` and `aws-cli` packages. The
dumper runs this on every pass, and it is written out here so that what happens nightly is not a
mystery:

```bash
# what the dumper does, once a day, on the host, in /opt/ozituma/app
docker compose -f docker/docker-compose.prod.yml logs --tail 20 backup
#   backup: ok /backups/ozituma-2026-10-06T03-00-00Z.dump.age (…) — marked .verified for backup-upload

# and what the uploader does, every minute, until it succeeds
docker compose -f docker/docker-compose.prod.yml logs --tail 20 backup-upload
#   upload: ok backups/ozituma/ozituma-2026-10-06T03-00-00Z.dump.age (… , read back from R2, decrypted
#           and listed) — marked .uploaded
```

The pipeline's own rules, in the file those commands read: the dump is verified by **decrypting it and
listing it** (`pg_restore --list`) before it is given its final name; the uploader repeats both checks
on the local file *and* on the object it pulls back out of R2; and no plaintext dump is ever written to
the volume. A pass that cannot encrypt produces no `*.dump.age` file at all — the failure mode is a
missing backup, loudly logged, and never a plaintext one quietly uploaded.

#### Where the key lives

The identity is `BACKUP_AGE_IDENTITY` (private, `AGE-SECRET-KEY-1…`) and the recipient is
`BACKUP_AGE_RECIPIENT` (public, `age1…`). They are read from `/opt/ozituma/.env`, which is mode 600
root:root and **written at boot from the `APP_SECRET` JSON in AWS Secrets Manager** — see
`infrastructure/ozituma-stack.yaml`. Both names are listed under both `backup` and `backup-upload` in
the compose file, because *compose passes a service only the variables it names* (`AGENTS.md`), and the
symptom of forgetting is a service that starts cleanly and does nothing.

So there are three copies, and the host's is the least important of them:

| # | where | what it survives | who puts it there |
|---|---|---|---|
| 1 | `/opt/ozituma/.env` on the host | a container restart, a `docker compose up` | written at boot from copy 2 |
| 2 | the `APP_SECRET` JSON in AWS Secrets Manager | the host being rebuilt or replaced | **the operator, once, by hand** |
| 3 | off the box — printed, or a password manager, or a sealed envelope | the AWS account, the laptop, and everything else | **the operator, once, by hand** |

#### If the key is lost

**Every dump it encrypted is unreadable forever.** `age` has no recovery path and no back door: without
the identity there is no way to read the file, by design. There is no tool, no Cloudflare support
route, no AWS support route and no future round of this project that can produce one. An encrypted
backup with no key is not a backup; it is a file.

The reverse is also true and worth saying: **a key that is leaked is not a leak of the dumps.** The
identity reads; it does not let anyone write a dump the dumper would accept as its own, and it is not
the credential to the bucket.

#### The host steps, numbered, because they are the point of this section

1. Generate the key on the host, in `/opt/ozituma/app`:

   ```bash
   docker compose -f docker/docker-compose.prod.yml run --rm -T --entrypoint age-keygen backup
   ```

2. Put the `# public key:` line into the `APP_SECRET` secret as `BACKUP_AGE_RECIPIENT`, and the
   `AGE-SECRET-KEY-1…` line as `BACKUP_AGE_IDENTITY`. **Never the other way round** — a recipient
   pasted into the identity variable is a private key written into a transcript, which
   `AGENTS.md` records as the incident that cost a full credential rotation on 2026-10-05. The names
   only; never print the values into a session.

3. Make copy 3 off the box — printed, or the password manager, or a sealed envelope — and **label it
   `ozituma backup key`**, because a bare `age` key on a piece of paper is unidentifiable in a year.

4. Rebuild `.env` from the secret and confirm the two halves match before you trust a night's run:

   ```bash
   sudo install -m 600 /dev/null /opt/ozituma/.env   # then re-run the boot step, or re-apply the stack
   cd /opt/ozituma/app
   docker compose -f docker/docker-compose.prod.yml up -d backup backup-upload
   docker compose -f docker/docker-compose.prod.yml logs --tail 5 backup      # must NOT say REFUSING TO START
   docker compose -f docker/docker-compose.prod.yml logs --tail 5 healthwatch | grep -i backup
   ```

5. **One-time cleanup, only if an earlier revision ever uploaded a plaintext dump.** It could not have:
   the old uploader image had no `pg_restore`, so it refused every dump. Confirm anyway, and delete
   only after listing:

   ```bash
   # list first. Any *.dump key here (no .age) is plaintext and readable by anyone.
   docker compose -f docker/docker-compose.prod.yml run --rm -T --entrypoint sh backup-upload -c '
     aws s3api list-objects-v2 --endpoint-url "$S3_ENDPOINT" --bucket "$S3_BUCKET" \
       --prefix "$BACKUP_UPLOAD_PREFIX" --query "Contents[].Key" --output text'
   # then, for each plaintext key you saw, and not before:
   docker compose -f docker/docker-compose.prod.yml run --rm -T --entrypoint sh backup-upload -c '
     aws s3api delete-object --endpoint-url "$S3_ENDPOINT" --bucket "$S3_BUCKET" --key "$BACKUP_UPLOAD_PREFIX/<the key>"'
   ```

#### Restoring one, which is the only reason any of this exists

Run on the host, in `/opt/ozituma/app`. `--entrypoint sh` is passed because this service's own
entrypoint is the upload loop, and `docker compose run` uses an entrypoint unless it is replaced.

```bash
# 1. list what is there, then fetch one dump by its own timestamped name
docker compose -f docker/docker-compose.prod.yml run --rm -T --entrypoint sh backup-upload -c '
  aws s3api list-objects-v2 --endpoint-url "$S3_ENDPOINT" --bucket "$S3_BUCKET" \
    --prefix "$BACKUP_UPLOAD_PREFIX" --query "Contents[].Key" --output text'
docker compose -f docker/docker-compose.prod.yml run --rm -T --entrypoint sh backup-upload -c '
  aws s3api get-object --endpoint-url "$S3_ENDPOINT" --bucket "$S3_BUCKET" \
    --key "$BACKUP_UPLOAD_PREFIX/ozituma-2026-10-06T03-00-00Z.dump.age" /dev/stdout' > /tmp/restore.dump.age

# 2. DECRYPT IT. A wrong key fails here and says so — there is no way to mistake that for a good dump.
docker compose -f docker/docker-compose.prod.yml run --rm -T --entrypoint sh backup-upload -c '
  umask 077; printf "%s\n" "$BACKUP_AGE_IDENTITY" > /tmp/k
  age -d -i /tmp/k /dev/stdin' < /tmp/restore.dump.age > /tmp/restore.dump

# 3. read what it holds BEFORE touching the database
docker compose -f docker/docker-compose.prod.yml exec -T postgres \
  pg_restore --list < /tmp/restore.dump | head -40

# 4. put it back. --clean --if-exists makes this a restore OVER the live database, not a merge into it;
#    --no-owner because the restore may run as a different role than the dump was taken by.
docker compose -f docker/docker-compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner -U ozituma -d ozituma < /tmp/restore.dump
```

The round trip this describes was taken locally in round 360 — encrypt, decrypt, list, and a real
restore into a second database — and the numbers are in `docs/OZIKORO-REMAINING.md` ROUND 360. **What
was not taken is any of it against R2**, because the S3 credential is on the host and not in this
checkout.

#### The monitor

`healthwatch` reads the backup volume read-only on every pass and logs its verdict. It did **not** look
at the backups at all until round 360, which meant nothing watched the one thing whose absence is
discovered on the worst day. It now says one of:

```bash
docker compose -f docker/docker-compose.prod.yml logs --tail 50 healthwatch | grep -i backup
#   healthwatch: backup ok — … is fresh, decrypts and lists, and was read back out of R2 after upload
#   healthwatch: BACKUP ALARM — there is no encrypted dump in /backups at all. …
#   healthwatch: BACKUP ALARM — the newest encrypted dump is … and it is more than 26 hours old. …
#   healthwatch: BACKUP ALARM — … arrived and is NOT marked .verified with a later timestamp, which means
#                the dumper could not decrypt it and list it. A wrong or lost key produces exactly this …
#   healthwatch: BACKUP WARNING — … decrypts and lists, but no confirmed upload to R2 is marked beside it.
```

**The alarm is a line in that container's log and it does not page anybody.** Nothing on this host does.
Wiring it to something that reaches a person is outstanding, and it is the one gap that makes the rest
of this section less than it looks.

---

## 5. What could not be established, and why

Stated rather than substituted. Each entry names what is missing and what would settle it.

1. **Whether the WordPress site is being written to *right now*.** The record says it was as of
   rounds 212–213 and the assessment rests on that. **Re-measuring needs a request to
   `ozikoro.com`, which this round was not permitted to make.** Settle: the owner says so, or one
   authenticated look at the post list. This matters because it is the clock the window runs
   against.
2. **Whether cPanel serves a valid certificate for `ozikoro.com`.** Needed to know if the
   hosts-file fallback (§4.4.2) gives a working site or a warning. **It needs a request to
   `ozikoro.com` or to `162.213.253.73` with that Host header.** This round made neither.
3. **Whether `ozikoro-site:latest` builds and starts on the host.** **The image does not exist
   there** — verified by listing them (`docker images` holds `ozituma-web`, `ozituma-learn`,
   `caddy:2-alpine`, `postgres:16-alpine` and one dangling image; **no `ozikoro-site`**), so the
   archive has never been built or started on that host. There is no `docker` binary on this machine,
   so the build itself cannot be rehearsed here. Settle: reconcile the host tree, build from a pinned
   SHA, and watch `docker compose up -d ozikoro`.
3b. **Whether the host's checkout and this checkout are the same repository at all.** The host's
   remote is `https://github.com/oziikoro/Ozikoro.git`; this clone's is
   `git@github.com:Ozikoro/ozikoro.com.git`. **The repository names differ**, and `AGENTS.md` names
   `github.com/oziikoro/Ozikoro` as the correct remote for this project — which is the host's, not
   this clone's. That would explain why the host's `7ae4808` is not an object here. **Not
   established either way, and it decides what "deploy the reviewed revision" means.** Settle: read
   both remotes' `origin/main` tips and compare a commit hash; or one `git ls-remote` from a machine
   holding the GitHub token.
4. **Whether Cloudflare's `full` mode will accept an origin certificate that does not name the
   hostname, end to end.** The documented behaviour is that `full` encrypts without validating,
   and the zone is read as `full`; **it was not exercised**, because the origin is not serving
   `ozikoro.com` yet. The `--resolve` checks in §4.4 will show the origin half before the record
   moves; the Cloudflare half is proven by the first request after it does.
5. **The duration of a full `--refresh --binaries` pass.** No run in this repository recorded one.
   The disk evidence spans two passes over ~30 hours and is not a single-run figure, so it is not
   quoted as one. Settle: `--limit <n>` timed, multiplied by the outstanding count (§3.4).
6. **Which episode key each published episode row actually points at** — the generated
   `ozikoro/episodes/<slug>.mp3` or the owner's `…owner-recording.mp3`. **A database question,
   deliberately not answered here**: reading the PGlite cluster would take the lock while four
   other agents are working in this checkout, and killing a process that holds `.data/pg` is how
   seven clusters were destroyed in one day. Settle: `node scripts/restore-episodes.ts --check`,
   which prints the rows and the keys without writing.
7. **The Postgres 16-versus-18.4 gap.** The compose pins `postgres:16-alpine`; the 55-migration
   run that proves the schema was against **18.4 on this machine**. **The run is evidence about
   the code and is not evidence about the pinned server.** Settle: re-run
   `scripts/verify-postgres.ts` against a `postgres:16-alpine` instance.
8. **Every registered WordPress user, not just the authors.** The dump has 15 `wpc9_users` rows;
   the public API can only ever list 11, because it omits anyone without a published post. Any
   subscriber, editor or administrator who never published is in the dump and in nothing else.
   Whatever accounts matter, they are a `SELECT` away — **and no account is invented, and no
   WordPress password hash is usable here.**
9. **The one-post discrepancy I read out of `rowcounts.txt`, which has since been settled in the
   other direction.** That file gives 1,050 published `post` rows; the REST API gave 1,051; round
   339's reconciliation gives **1,051 = 1,051, difference 0**, because its tokeniser parsed 9,144
   rows where the earlier file parsed 9,139. **Resolved — and recorded here as an instance of the
   rule this document keeps repeating: an earlier file that reads like the record is not the
   record.**
10. **Whether the 80 draft images and the 15 duplicate-held ones are on disk, and whether the 94
    newer records have been downloaded at all.** Round 214 established that their URLs work when
    the spaces are encoded, so they are retrievable; **whether a given one is already on disk was
    not counted this round.** Round 339 names the 80 as recoverable only by fetching them, and the
    15 as held under a duplicate attachment's row. Settle: `node
    src/import/media-store.ts --check`, which reports `filesOnDisk`, `linked` and `missing`.
11. **What the shared Cloudflare token can do, re-verified.** `AGENTS.md` records DNS write as
    verified via the empty-body `POST` probe. **That probe was not re-run** — it is a `POST` to a
    mutating endpoint on a live zone, and the rule for this round is no mutating call of any kind.
    **Read access is proven** by the calls that produced §1. Settle: the probe, in a round
    authorised to make it, or a token scoped to this project kept in this project's own store —
    which `AGENTS.md` already recommends and which is the right fix.
12. **The live counts, today.** Every count in §3.1 is as of its own date and none was re-measured
    this round, because that needs `ozikoro.com`. **The reconciliation agent is the instrument,
    not this document.**

---

## Appendix — the walk order, for the operator

Not authorised by this document. It exists so that the switch is not also a discovery session.
Every line has a check beside it, and **every check happens before the line it guards.**

```
A. RECONCILE THE SOURCE
   0.1  host: cd /opt/ozituma/app && git rev-parse HEAD && git status --short | wc -l   → clean, pinned
   0.2  here: commit the tree; record the SHA that will be built

B. SATISFY THE BLOCKERS
   1.1  docs/IMPORT-RECONCILIATION.md exists; its gaps are empty or accepted       (§2 cond. 3)
   1.2  node scripts/verify-postgres.ts against postgres:16-alpine                  (§2 5.2)
   1.3  upload the media: media-upload.ts --check → driver s3, uploaded 0           (§2 5.4, §3.6)
   1.4  upload the episodes: restore-episodes.ts --apply [+ owner recording]        (§2 5.6, §3.7)
   1.5  ListObjectsV2 ozikoro/ and ozikoro/episodes/ → expected counts              (§2 5.5)

C. BUILD AND SERVE, WITHOUT DNS
   2.1  build ozikoro-site:latest from the pinned SHA; docker compose up -d ozikoro
   2.2  docker exec ozituma-caddy-1 caddy validate --config /etc/caddy/Caddyfile    (§2 6a)  ← STOP if it fails
   2.3  reload caddy
   2.4  curl --resolve ozikoro.com:443:44.194.56.187 -kI https://ozikoro.com/       (§4.4.1)
   2.5  the §2 checklist, run against that --resolve base
   2.6  the CSP check, against the built artefact                                   (§2 6b)
   2.7  design parity: identical 63 differing 0 missing 0                           (§2 cond. 4)
   2.8  keep the rollback command (§4.1) in a shell, pasted and unexecuted

D. FREEZE, SYNC, SWITCH
   3.1  owner stops writing in WordPress
   3.2  ./scripts/export-wp-db.sh                                    (36m26s measured)
   3.3  npm -w @ozikoro/platform run import:wordpress -- --refresh --binaries
   3.4  media-store.ts --apply · archive.ts --apply · media-upload.ts --apply
   3.5  restore-episodes.ts --apply
   3.6  reconcile: both directions, zero unexplained                        ← STOP if not
   3.7  PATCH the apex record to 44.194.56.187                              (§4.1)
   3.8  verify through Cloudflare; watch for ~5 minutes; keep the rollback ready

E. IF ANYTHING IS WRONG
   4.1  PATCH the apex record back to 162.213.253.73                        (§4.1)
   4.2  do NOT roll the database back                                       (§4.3)
   4.3  purge /design/* (and /media/*) if a stale object is suspected        (§4.2)
   4.4  if Cloudflare itself is the fault, use --resolve (§4.4.1) or the hosts entry (§4.4.2)
```

**The one sentence to keep.** The change is one string in one DNS record, the way back is the same
string, the old site is never touched, and **the thing that actually decides whether this is
safe — the media — is empty today and is verified rather than assumed.**
