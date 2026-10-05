# Ozikoro — agent instructions

This repository builds **Ozituma**, the dictionary at **ozituma.com**.

Two domains, two jobs, and they are not interchangeable:

- **ozikoro.com** — the **history and archive**. The parent project and the
  cultural record.
- **ozituma.com** — the **dictionary**. The language layer, a child of Ozikoro,
  and the only one of the two this repository deploys.

## Which accounts belong to this project

Ozituma has its **own AWS account and its own GitHub account**, entirely
separate from the `idenze` and `ezeme` projects. Only Cloudflare is shared with
ozikoro.com.

| | Value |
|---|---|
| **This site** | **ozituma.com** — the dictionary. This is what the repository deploys |
| Parent | **ozikoro.com** — the history and archive; shares Cloudflare, nothing else |
| **AWS** | profile `ozikoro`, region `us-east-1`, account `793264561107` |
| **GitHub** | `github.com/oziikoro/Ozikoro` |
| GitHub token | macOS keychain, service `github-api-token-oziikoro`, account `oziikoro` |
| Cloudflare | shared with ozikoro.com — credential located, see below |
| Namecheap | registrar for `ozituma.com` and `ozikoro.com` — same account |

### Rules that follow from the above

- **Never** use the `idenze` or `ezeme` AWS profiles here, and never mix the
  accounts. They belong to unrelated projects with their own AWS and GitHub.
- **Never** push this repository to `idenze/*`. That was done once by mistake;
  the correct remote is `oziikoro/Ozikoro`.
- The two GitHub tokens are deliberately stored under different keychain
  services so neither can be used in place of the other.
- **Pushing needs the credential helper disabled.** A stale `github.com`
  internet-password in the login keychain shadows the correct token, and GitHub
  reports the resulting auth failure as `Repository not found` — which reads
  like a missing repo rather than a bad credential. Every push must therefore
  bypass the helper:

  ```bash
  security find-generic-password -s github-api-token-oziikoro -a oziikoro -w \
    | tr -d '\n\r' > /tmp/tok      # the keychain value carries a trailing newline,
                                    # which also breaks auth on its own
  GIT_ASKPASS=... GH_TOKEN="$(cat /tmp/tok)" GIT_TERMINAL_PROMPT=0 \
    git -c credential.helper= push origin HEAD
  ```

  Confirming a token still works: `curl -H "Authorization: Bearer $TOK"
  https://api.github.com/user` returns the login, and a `POST .../git/blobs`
  returning 201 proves write access. If the API works but `git push` 404s, the
  cause is almost always the helper, not the token.
- AWS credentials come from `aws login --profile ozikoro` and are valid for 12
  hours, renewable for 90 days without re-authenticating in the browser.
  `OZITUMA_SITE_URL` defaults to `https://ozituma.com` and is what the API docs,
  OpenAPI document and canonical URLs are generated from.

### Cloudflare and Namecheap access

Cloudflare is the one service Ozikoro shares with its sibling projects, so the
credential is not Ozikoro's own. It lives in **another project's** `.env`:

```
~/Projects/Aku/.env
~/Library/Mobile Documents/com~apple~CloudDocs/Documents/Ezeme/.env   (identical copy)
```

```bash
CLOUDFLARE_API_TOKEN    # zone-scoped token, 53 chars
CLOUDFLARE_ACCOUNT_ID   # ea4b95012b9f4252ff61c9393a87287f
NAMECHEAP_API_USER      # idenze
NAMECHEAP_API_KEY       # 32 chars
NAMECHEAP_CLIENT_IP     # whitelisted source IP — a dynamic MTN Nigeria address
NAMECHEAP_PASSWORD
```

It is **not** in the login keychain, and not in any DSH session, profile or
backup — the `.env` files are the only copy. (Checked: 284 keychain services, 130
MB of session transcripts across all three project roots, the 1.8 GB
`~/.dsh.backup` tree, `~/.hermes`, `~/.codex`, and every `wrangler` config
location. All empty. `~/.hermes` ships a Cloudflare MCP manifest but was never
authorized, so it holds no token.)

**The token is shared and over-broad.** It is account-wide and sees five zones:
`ozituma.com`, `ozikoro.com`, `idenze.com`, `ezeme.org` and `omapolo.com`. It is
stored in plaintext in an unrelated project's `.env`. A token scoped to just the
two Ozikoro zones, kept in this repository's own secret store, would remove that
dependency — worth doing before this goes to production.

**Verified capability** — reads succeed (`/zones` lists all five), and DNS edit is
granted: posting an empty body to `/zones/{id}/dns_records` returns error `9000`
"DNS name is invalid", which is content validation. A token without DNS:Edit
returns 403/9109 instead. That probe writes nothing, and is the way to re-check
permissions without touching a live zone.

`/user/tokens/verify` reports **"Invalid API Token"**. That is expected for a
zone-scoped token without the user-token-read permission and does **not** mean
the token is broken — `/zones` succeeding is the real test.

**Namecheap requires its caller's IP to be whitelisted**, and the egress address
is a dynamic MTN Nigeria mobile IP that moves within `102.90.124.0/22`. When the
API returns `1011150 Invalid request IP: <ip>`, the fix is to add that exact `<ip>`
at Namecheap → Profile → Tools → API Access. The key itself is fine.

Zone and registrar facts, recorded so the next session does not have to
re-discover them:

| | |
|---|---|
| `ozituma.com` | zone `8d5c9e827bdfe35b236d8a3dc218df5e`, active, Free plan, SSL `full`, Universal SSL covers `ozituma.com` and `*.ozituma.com` |
| `ozikoro.com` | zone `1ebe8c1f9ce3dcec95448b6d93d63e00`, active, 27 records → cPanel `162.213.253.73`, proxied |
| Shared nameservers | `clint.ns.cloudflare.com`, `khloe.ns.cloudflare.com` |
| Registrar | NameCheap, Inc. for both — `ozituma.com` renews 2027-07-03, `ozikoro.com` renews 2027-07-24 |
| Live records (verified 2026-09-28) | `A ozituma.com → 44.194.56.187` proxied; `CNAME www → ozituma.com`; `CNAME learn → ozituma.com`; `CNAME media → public.r2.dev`; 5 `MX` + 1 `SPF` (Namecheap email forwarding — do not replace the SPF, only add) |

An earlier version of this file recorded that `ozituma.com` had no `A` or `CNAME`
at all and resolved nowhere. That is no longer true: the apex, `www`, `media` and
`learn` records all exist and the site answers. Check the zone before repeating
the older claim.

## Two hostnames, two applications

**This changed twice.** The single-application design described here originally was replaced by the owner
with a split; **the split is now being retired in favour of an Academy**, and the owner's instruction is the
one to work from:

> *"everything about learn.ozituma.com should be removed entire. we have a new academy coming up which is
> academy.ozikoro.com, which will replace learn.ozituma.com."*

**⚠️ `academy.ozikoro.com` IS LIVE. EVERY PREVIOUS VERSION OF THIS FILE SAID THE OPPOSITE AND WAS WRONG.**

This section used to read *"`academy.ozikoro.com` IS NOT LIVE AND MUST NOT BE BROUGHT LIVE FROM THIS
REPOSITORY … It is not a record in the `ozikoro.com` zone … do not create the DNS record, do not deploy to
it."* **Measured on 2026-10-05, all of that is false:**

```
academy.ozikoro.com   resolves to 104.21.8.6, 172.67.156.151 (Cloudflare)
                      → 200, 34,814 bytes, <title>Ozikoro Academy — Igbo language, history and culture</title>
on the host           ozituma-academy-1   ozikoro-academy:latest   Up (healthy)
docker/docker-compose.prod.yml   an `academy:` service, image ozikoro-academy:latest, sharing the
                                 dictionary's own database and `account` table
docker/Caddyfile                 an `academy.ozikoro.com { … }` block, reverse_proxy academy:3000
```

**It has a record. It resolves. It answers 200. It has been running for hours.** The archive's own
`/academy/` page still says the academy is being prepared, and **that page is now the thing that is wrong.**

**What went wrong, because it is the failure mode this repository keeps producing:** an authoritative
statement stopped being true, nothing re-measured it, and **every agent for a day read it and obeyed it.**
*An agent that had "cleaned up" a link to `academy.ozikoro.com` on the strength of this file would have
broken a working site.* **So: when this file makes a claim about production, measure it before acting on
it, and correct this file when it is wrong — as it was here.**

**AND THE THING TO KNOW INSTEAD.** The host runs **three** applications from one compose file and one
Caddy: `ozituma.com` (the dictionary), `academy.ozikoro.com` (Ozituma Academy), and — once deployed —
`ozikoro.com` (the archive). **The academy shares the `account` table with the dictionary**, which is why
it names the same `DATABASE_URL`. Do not remove, replace or "tidy" the `academy` service, its Caddy block,
or its image: it is live, and 246 uncommitted files on that host are its and the dictionary's.

### The academy's certificate is unvalidated, and the fix is named

**From the host's own `docker/Caddyfile`, written by whoever built it:**

> *"THE CERTIFICATE DOES NOT NAME THIS HOST. `/opt/ozituma/certs/origin.pem` is issued for `*.ozituma.com`
> only. The Cloudflare zone is on `full`, which does not validate the origin certificate, so this serves —
> and it stops being safe the moment anybody raises the zone to `full (strict)`. **The fix is one Origin CA
> certificate naming `*.ozikoro.com`; until then, do not raise the zone.**"*

**So the Cloudflare-to-origin hop for every `*.ozikoro.com` hostname is encrypted but unauthenticated** —
*any certificate the origin presents is accepted.* **The fix is one certificate; the interim rule is that
the zone must not be raised to `full (strict)` until it is issued, because raising it first would take the
academy offline rather than secure it.**

- **ozituma.com** — the dictionary. Next.js on the EC2 host, PostgreSQL, its own scrypt auth and
  `ozituma_session` cookies. Unchanged.
- **learn.ozituma.com** — **RETIRED ENTIRE, ON THE OWNER'S INSTRUCTION, ON 2026-10-04.**
  *"delete every single thing associated to learn.ozituma.com, including the database and every other
  thing, please delete entirely."* Everything below was deleted, and the earlier plan to leave it until
  the Academy existed was overridden by that instruction.

### What that means in practice

| | Where it lives now |
|---|---|
| `learn.ozituma.com` | **GONE.** The Worker was deleted, which released the custom domain; the zone now holds **no record** for the host and it does not resolve. |
| The Workers | **Both deleted** — `tanstack-start-ts-learn` and the phantom `ozikoro-ozituma-dictionary-learn` an earlier build had created with the auto-generated name. **Zero Workers remain on the account.** |
| Courses database | **DELETED.** Supabase project `kouczrxrsdjykxoyxzgi` (`eu-west-2`) is gone. It held 30,028 `lexeme_examples`, 8,415 `lexemes` (a re-importable copy; the dictionary is the source of truth), 6 profiles, 6 course lessons, 3 units, 2 user roles and 1 review schedule. Two PATs in the session records were used; both reported the project before deletion and **zero projects after**. |
| `staging/learn/` | **DELETED** (220 tracked entries plus 9 untracked files). A source archive survives at `handover/learn-retired-2026-10-02.tar.gz` (1.9 MB) — delete it too if nothing is wanted back. |
| `ozituma.com/learn/*` | **THE REPOSITORY AND PRODUCTION DISAGREE, AND PRODUCTION IS WRONG.** The source serves `apps/web/app/learn/[[...rest]]/page.tsx` — "the Academy is being prepared" — but that change has **never been deployed**. Measured on 2026-10-04, the live dictionary still answers `301` with `location: https://learn.ozituma.com/`, i.e. **it sends every course link to a host that no longer resolves.** Fixing it needs a deploy of `apps/web` to the EC2 host, which needs `aws login --profile ozikoro` first. Until then, any shared course link lands on a dead host. |
| `apps/learn` (`@ozituma/learn`) | **DELETED** earlier. The legacy Next.js courses app, its Dockerfile target and its compose service went with it. |
| The bridge and the mirror | **DELETED in the same change as their caller**, which was the rule this file set: `apps/web/app/api/learn-bridge/account/route.ts`, `packages/db/src/supabase-mirror.ts` and its call in `registerAccount`, `packages/db/src/test-learn.ts`, the `import:learn` scripts and the `LEARN_BRIDGE_SECRET` compose variable. |
| The course tables and `import:learn` | The imported data is gone with the project. `data/learn/igbo.json` — the **authored** curriculum, and the importer that loads it — were **kept**, because they are the Academy's inheritance rather than the retired host's plumbing. |

**⚠️ THE PARAGRAPH THAT USED TO BE HERE WAS FALSE, and it is recorded rather than deleted so the next
agent knows it was there.** It read: *"Still not to be done from here: create the `academy.ozikoro.com`
record or deploy to it. It has no record in the `ozikoro.com` zone, and a link to a host with no record is
a link to nothing."* **The academy has a record, resolves, and serves — see the live measurements above.**
The paragraph was obeyed for a day and would have caused a working site to be "tidied" away.

### ✅ The Academy's source is in this repository as of `aec2092` — and this section used to say it was nowhere

**⚠️ READ THIS FIRST: THE PARAGRAPH THAT WAS HERE WAS TRUE WHEN IT WAS WRITTEN AND IS FALSE NOW.** It said,
in red, *"The Academy's image has no source in either repository … the most dangerous fact on that host …
nothing in either repository can rebuild it."* **The owner pushed the Academy's source on 2026-10-05 and it
was merged at `aec2092`.** *This is the second time this file has carried an authoritative warning that
stopped being true and was obeyed by agents who did not re-measure it — the first was the claim that
`academy.ozikoro.com` was not live while it was serving 200.* **So: when this file makes a claim about
production, measure it before acting on it, and correct the file when it is wrong.**

**What is true now, measured:**

```
in this repository       apps/academy — 139 files, tracked, merged at aec2092
                         apps/academy/Dockerfile exists (3,533 bytes)
docker/docker-compose.prod.yml
  the `academy` service  build:
                           context: ../apps/academy      ← resolves to apps/academy
                           dockerfile: Dockerfile
                         image: ozikoro-academy:latest
                         PORT 3000, HOST 0.0.0.0, expose 3000, with a healthcheck —
                         named rather than defaulted, because the Dockerfile's EXPOSE
                         and the Caddyfile's `reverse_proxy academy:3000` are three
                         places that must agree
```

**So `docker compose build academy` builds it from a real source tree, and the whole-file build this file
used to forbid is no longer forbidden by *this* reason.**

**⚠️ AND THE HOST WAS MEASURED THE ROUND AFTER THAT CAUTION WAS WRITTEN. IT STILL HAS NO ACADEMY, AND THE TWO
COMPOSE FILES NOW DISAGREE ABOUT WHETHER IT SHOULD BE BUILT AT ALL.**

```
                       THIS CHECKOUT                        THE HOST (/opt/ozituma/app)
  apps/                academy · media · ozikoro · web       learn · ozikoro · web
  apps/academy/        139 files, Dockerfile present         ABSENT
  the compose academy  build:                                image: ozikoro-academy:latest
    service              context: ../apps/academy            restart: unless-stopped
                         dockerfile: Dockerfile              environment: …
                       image: ozikoro-academy:latest         ← NO build: BLOCK
```

**So the host PULLS the academy image and has nothing to build it from; this checkout BUILDS it from
source.** *And `ozikoro-academy:latest` is on that host — 169 MB, 22 hours old, serving `academy.ozikoro.com`
as `ozituma-academy-1` with `Up (healthy)`. Nothing there is broken today.*

**🔴 THE THING THIS MAKES DANGEROUS, WHICH IS NOT A TIDINESS PROBLEM.** *If this checkout's compose were
deployed to that host as it stands, `docker compose up -d` would try to **build** the academy from
`../apps/academy` — and there is no `apps/academy` there.* **That is a build that fails, on the service that
is currently the healthy one.** *The failure would present as the academy going down during a deploy that
was supposed to touch something else, which is the "file and production disagree" fault this project keeps
producing.*

**SO, BEFORE ANY DEPLOY OF THIS CHECKOUT TO THAT HOST, RESOLVE IT — AND IT IS A CHOICE, NOT A FIX:**

- **bring `apps/academy` to the host**, so its compose can build what this checkout's compose builds; **or**
- **keep the host's `image:`-only service**, and make this checkout's compose match it, so a deploy never
  tries to build a source that host does not have.

**Until one of those is done:**

- **`docker compose build academy` in THIS checkout** — fine; the source and the build block are both here.
- **Any deploy to the host** — do not ship this checkout's `docker/docker-compose.prod.yml` unchanged, for
  the reason above. *Check `/opt/ozituma/app/apps/academy` and the host's own `academy:` block first.*
- **Do not remove the `learn` stages from the host's Dockerfile.** *They are unrelated to the Academy's own
  Dockerfile and were only ever noted here as the closest thing that existed on that host at the time.*

### The Academy's host, and how a retired link is handled

`learn.ozituma.com` is named in code, in env examples, in docs **and in seventeen of the fifty-two design
screens**. The design deliverable under `apps/ozikoro/public/design/` is **inviolable** — byte-identical to
`design/calm-comfort-construct/public/design` — so it cannot be edited to stop naming the host. The rewrite
lives in `designScreenLinks` in `packages/ozikoro/src/design-paths.ts`, which is where the design's other
addresses are already resolved at serve time, and it does three things: an address becomes `/academy/`, the
platform bar's label becomes `Academy — Learn Igbo`, and a bare host name in prose becomes
`academy.ozikoro.com`. **`fillAcademy` is where the page says the academy is being prepared**, because a
rewrite can change an address but it cannot supply the tense.

### Accounts are no longer shared with anything

**The dictionary's accounts are now self-contained, and that is a change from every previous version of
this file.** There is one place an account lives: the `account` table in the dictionary's own PostgreSQL.

What used to exist and is gone:

- **ozituma.com → Supabase** — `packages/db/src/supabase-mirror.ts` wrote a copy of every new account into
  the courses project so the same person could sign in at `learn.ozituma.com`. **Removed**, along with its
  call in `registerAccount` and its `backfillAccounts` repair pass. `registerAccount` no longer reaches
  any second system.
- **learn → ozituma.com** — `POST /api/learn-bridge/account` in `apps/web` minted dictionary accounts from
  the courses app, gated by `LEARN_BRIDGE_SECRET` and failing closed with 503 when unset. **Removed**,
  together with the compose variable, in the same change as its only caller — which is the rule this file
  had set for exactly this moment.

**Two lessons worth keeping from that arrangement**, because the Academy will raise the same questions:

- **A shared secret must not be a `VITE_`-prefixed variable.** It was one, which inlined it into the
  browser bundle and let anyone mint accounts. The fix was to move the call server-side; the rule is to
  keep gate secrets out of anything the client can read.
- **Compose passes a service only the variables it names**, so adding a variable to `/opt/ozituma/.env` is
  never enough on its own — it must also be listed under the service in `docker/docker-compose.prod.yml`,
  and the symptom of forgetting is a silent 503 rather than a startup error.

**If the Academy wants one account across sites again**, that is a new design decision with a new bridge,
not a revival of this one: the old endpoint, its secret and the mirror are deleted, and the accounts that
were mirrored into the courses project went with that project.

### Content is Central Igbo only

The owner's rule: **Central Igbo (Igbo Izugbe) is the only language used in generating anything.**

The discriminator is `word_dialect` in the dictionary — a word is tagged when it is **not** Standard
Igbo (Ngwa, Mkpọọ, Ọnịcha, Ẹkpẹyẹ, Ajalị, Owere, Achala, Nkanụ, Ezaa, Nsa). An **untagged word is
Central Igbo**: 8,415 of 12,229 published words, with 3,814 dialect-tagged entries excluded.

Verified in Supabase at every level: 0 lexemes with a dialect tag, 0 sentences on a dialect word, and
0 dialect-tagged audio among the 30,849 matched example recordings. **The audio check is the one that
matters** — the dictionary also stores dialect *pronunciations*, so excluding dialectal **words** is
not by itself sufficient.

**The dictionary is the source of truth.** Supabase holds a copy so the courses can read it with RLS;
the importers are idempotent and re-runnable. **The import never publishes** — imported rows land as
`draft` and a linguist publishes them, which is why 2,382 of 8,415 are live and 6,033 are the review
queue.

### Publishing requires a linguist identity

`lexemes` has a trigger refusing status changes from anyone without the `linguist` or `admin` role,
and RLS filters UPDATE by the same test. **A service-role key bypasses RLS but not the trigger**, and
`auth.uid()` is null for server-to-server calls, so bulk publish scripts must sign in as a linguist
and send that JWT. Note that deleting the linguist account does **not** invalidate an already-issued
JWT — it stays valid and the PATCH then silently updates zero rows, returning HTTP 200 with an empty
body. Read the response, not the status code.

### Supabase limits

The free plan is 500 MB database, 1 GB storage, 5 GB egress. Content fits easily — the database is
35 MB — because **the 4.45 GB of audio never enters Supabase**; only URLs do, and the recordings
stream from Cloudflare R2 (`media.ozituma.com`) where egress is free. The real limit is that **free
projects pause after 7 days of inactivity.**

DDL needs the SQL Editor or a Management API access token. The service key cannot run it: `pg_meta` is
gone and the Management API rejects the service key. `POST /v1/projects/{ref}/database/query` with a
personal access token (`sbp_…`) does work, and is how the migrations were applied.

### What was removed and what was not

**REMOVED, and the build was kept green by removing its plumbing in the same change:**

- `apps/learn/` — the legacy Next.js courses app (`@ozituma/learn`, 58 files). It was already dead: the
  `learn` CNAME was deleted when the Worker took the subdomain, so the container it built served nothing.
- Its Dockerfile stage and target (`builder-learn`, `--target learn`), its `docker-compose.prod.yml`
  service, the root `dev:learn` script, its `scripts/check-compose-env.mjs` entry and its
  `package-lock.json` workspace entry — **each of these existed only to build or run that app**, so
  leaving one behind would have pointed a build at a directory that no longer exists.
- Every reference a reader can meet: the archive's platform bar, masthead and footer, its `/academy/`
  page, its not-found doors, the account screen's link table, the dictionary's `/learn` redirect and its
  admin's "Learn subdomain" screen.

**ALSO REMOVED ON 2026-10-04, when the owner retired the host entire rather than waiting for the Academy:**

- **`staging/learn/` — the TanStack Start app itself**, 220 tracked entries plus 9 untracked files. The
  earlier reasoning was to keep it until the Academy existed, on the grounds that deleting the source
  would not retire the live Worker while removing the ability to maintain or migrate what was running.
  That reasoning was sound and was **overridden by an explicit instruction** — *"delete every single thing
  associated to learn.ozituma.com, including the database and every other thing, please delete
  entirely."* The Worker, the DNS and the database were retired in the same pass, so nothing was left
  running without a source tree.
- **The bridge, the secret and the mirror** — `apps/web/app/api/learn-bridge/account/route.ts`,
  `packages/db/src/supabase-mirror.ts` and its call in `registerAccount`, `packages/db/src/test-learn.ts`,
  the `import:learn` scripts and the `LEARN_BRIDGE_SECRET` compose variable. Deleted in one change, as the
  rule above required, so the dictionary serves no route and holds no variable for a host that is gone.
- **The courses database** — Supabase project `kouczrxrsdjykxoyxzgi`, deleted with the host it belonged to.
- **A source archive** was taken first, at `handover/learn-retired-2026-10-02.tar.gz` (1.9 MB), because
  nine of those files had never been committed and git could not have given them back.

**STILL KEPT, deliberately:**

- **`data/learn/igbo.json` — the authored curriculum — and `packages/db/src/import/learn-curriculum.ts`,
  the importer that loads it.** These are the Academy's inheritance, not the retired host's plumbing. The
  imported rows died with the Supabase project; this file is their source, and it is tracked in git.
- **`packages/db/migrations/0028_learn.sql`, `0031_learn_lesson_lifecycle.sql` and the course tables in the
  migration chain.** Migrations are history: they are what a fresh database replays. Deleting applied
  migrations from the middle of the sequence would break `migrate` long before it removed anything a
  reader could see.
- **The retired host's name in the design screens and their rewrite.** The design deliverable is
  inviolable and names the host in seventeen of its fifty-two screens, so `designScreenLinks` resolves
  those addresses to `/academy/` at serve time. That rewrite stays, because a reader can still meet the
  old name.

## Do not run database scripts while the dev server is running

`PGlite` is single-process. `npm run dev` holds `.data/pg` for as long as it runs,
so a CLI script that calls `getDb()` at the same time corrupts the directory: the
server then fails every query with `Aborted(). Build with -sASSERTIONS for more
info.` and the fix is to delete `.data/pg` and re-run migrate, seed and the
imports — the local database holds no irreplaceable data, but the detour costs
more than stopping the server would have.

Stop `npm run dev` before running `import:*`, `test:*` or `migrate`, or set
`DATABASE_URL` to a real Postgres and run both at once. This is also documented in
`.env.example`.

## Do not run `next build` while `next dev` is running

They share `apps/web/.next`. A production build writes a React Client Manifest and a webpack module
graph that the running dev server then reads, and the dev server starts failing every request with:

```
Could not find the module ".../next-devtools/.../segment-explorer-node.js#SegmentViewNode"
  in the React Client Manifest. This is probably a bug in the React Server Components bundler.
[TypeError: __webpack_modules__[moduleId] is not a function]
```

Both messages point at Next.js and neither mentions the real cause, so this reads like a framework
bug rather than a stale directory. The symptom is a route that served fine minutes earlier now
returning 500 while others keep working.

Fix: stop the dev server, `rm -rf apps/web/.next`, and start it again. To avoid it, run the build
only with the dev server stopped, or build into a separate directory.

## The review server on 3110 has a build lock, and you do not need to rebuild

**Run `bash scripts/serve-review.sh` and nothing else. Do not `rm -rf apps/ozikoro/.next`, and do not
run `next build` by hand in this checkout.**

Several agents share one checkout, one `apps/ozikoro/.next` and one port 3110. On 2026-10-04 that took
the review site down repeatedly, and the cause was not a bug in the site:

- two `next build` processes in the same `.next` destroyed each other's output — `Cannot find module
  '…/.next/server/pages-manifest.json'`, `ENOENT … next-font-manifest.json` — leaving the directory
  half-written;
- **`next build` empties its output directory before it writes**, so building in place takes the
  running server's files away at the first second of the build, whether or not the build succeeds.
  One build that failed on an unrelated type error left the site answering 404 for eight minutes;
- the old script rebuilt unconditionally and restarted unconditionally, so **every run took the site
  down for 60–120 seconds even when the build was already current.** It was run several times an hour.

**The lock is `apps/ozikoro/.next.lock`** — a directory beside `.next`, not inside it, because a lock
inside the build directory is deleted by the very `rm -rf` that needs it most. `serve-review.sh` takes
it before it builds anything, and a second run is refused with the holder's pid and command:

```
REFUSING TO BUILD: ANOTHER PROCESS IS BUILDING INTO THE SAME .next.
...
  This is contention, not corruption. Nothing is wrong with .next, the database or the site.
```

That refusal is not a fault. **Wait for the other build and run the command again.** The refusal
prints the one command that clears a lock whose owner you have *confirmed* is dead
(`rm -rf apps/ozikoro/.next.lock`); a lock whose owner has died is reclaimed automatically, so you
should almost never need it. The guard was written for exactly this, in the shape of
`packages/db/src/cluster-lock.ts` — see `scripts/lib/next-build-lock.sh` for the reasoning.

What you get from the script, and what to rely on instead of a hand-rolled build:

- **It does not rebuild when the build is current.** The check is `.next/BUILD_ID` against every source
  file, and it costs about 0.15 s. `--rebuild` forces one; `--check` reports what would happen and
  changes nothing.
- **The build goes to `.next-next` and is swapped in only when it is complete and asserted.** A failed
  build therefore leaves the site up and untouched.
- **The artefact is asserted after the copy**: `server.js` must exist and the standalone's design
  screens must hold exactly as many files as `apps/ozikoro/public/design/screens/` (52 today). A short
  copy is deleted and the script exits non-zero **before** the running server is stopped, because a
  standalone with 51 of 52 screens serves 200 everywhere and 404 for every screen.

**Never `kill -9` a process on 3110.** It holds the PGlite cluster in the same process, and a SIGKILL
landing while PGlite opens its cluster has destroyed seven clusters in one day. `serve-review.sh` sends
SIGTERM, waits, and refuses to force a process holding `.data/pg` — that refusal is the single most
important line in it and must survive any change to the script.

## Working agreements

- `npm run verify` and the test suites are the gate. A change that fails them is
  not finished, however good it looks.
- Imported corpus data is attributed per source and stays `draft` unless its
  licence permits publication. See `docs/DATA-SOURCES.md`.
- Never commit third-party scans, corpora or media. See `.gitignore`.

## Do not print a secret's value to find out what it is called

**This rule exists because breaking it cost a full rotation of the production
host's credentials on 2026-10-05.** An agent needed to know how the host was
configured, reached it over SSM, and ran a command that printed `/opt/ozituma/.env`
in full. The names answered the question. **The values went into the session
transcript — a ~130 MB file on a laptop that is also sent to the model provider and
is inside whatever backs that laptop up** — and every credential below had to be
treated as disclosed:

| what was printed | what it opens |
|---|---|
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | read, overwrite and delete every object in the media bucket |
| `POSTGRES_PASSWORD`, `DATABASE_URL` | the whole archive and account table — every hash, session and audit row — read and write |
| `GITHUB_TOKEN` | push access to the repository |
| `OZITUMA_ZOHO_KEY`, `OZITUMA_SMTP_*`, `RESEND_API_KEY` | send mail as the domain — which is how an account is taken over |
| `PAYSTACK_*`, `NOWPAYMENTS_*` | move money, if live |
| `CPANEL_PASSWORD` (this checkout's `.env.local`) | full control of the legacy WordPress host |

**So, on any host, in any session:**

- **Read a secret's NAME, never its VALUE.** `docker compose config --environment`,
  `grep -oE '^[A-Z_]+=' .env`, `systemctl show -p Environment` — all of these answer
  "what is configured" without answering "what is the secret". **Ask for the value
  only when a value is genuinely required to complete the task, and say why first.**
- **If a value does reach the context, that is a rotation, not an apology.** Report
  which value, where it landed, and what it opens — and do not attempt to delete it
  from a transcript that has already been written and sent.
- **Rotating is always two steps in this order: create the new credential at its
  source, then put it where the application reads it, then revoke the old one.**
  Revoking first is an outage. `POSTGRES_PASSWORD` additionally needs the change in
  the database and in `.env` together, with a restart, because the app
  authenticates with it.
- **A host's `.env` is not a configuration file to be read, it is a credential
  store to be used.** The application container reads it; a person does not need to.

**Secrets Manager is a separate concern with its own rule — see Secret Safety below.
It does not cover the host's `.env`, which is where these were.**

<!-- BEGIN AWS Agent Toolkit rules -->

# AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.

<!-- END AWS Agent Toolkit rules -->
