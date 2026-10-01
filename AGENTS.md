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

**This changed.** The single-application design previously described here was replaced by the owner.
It is summarised at the end of this section, because the Next.js course routes still exist.

- **ozituma.com** — the dictionary. Next.js on the EC2 host, PostgreSQL, its own scrypt auth and
  `ozituma_session` cookies. Unchanged.
- **learn.ozituma.com** — Ozituma Learn. **No longer the same container.** A TanStack Start app
  deployed to **Cloudflare Workers** (worker `tanstack-start-ts-learn`, source in `staging/learn/`),
  with its own **Supabase** project for accounts, content and progress.

### What that means in practice

| | Where it lives now |
|---|---|
| `learn.ozituma.com` | Cloudflare Worker via a **Worker custom domain** — not a CNAME to the EC2 host |
| The old `learn` CNAME | **Deleted.** `dig learn.ozituma.com` answers with Cloudflare Worker IPs |
| Courses database | Supabase `kouczrxrsdjykxoyxzgi` (`eu-west-2`) |
| `ozituma.com/learn/*` | **301 redirects** — the Next.js course routes are not what the subdomain serves |
| `ozituma-learn-1` container | Legacy; serving nothing once the DNS moved |

### Accounts are shared, in both directions

One account works on either site with the same password.

- **ozituma.com → Supabase** — `packages/db/src/supabase-mirror.ts`, called from `registerAccount`.
  `backfillAccounts` is idempotent and repairs accounts that were never mirrored.
- **learn → ozituma.com** — `POST /api/learn-bridge/account` in `apps/web`, called from the learn
  app on signup. Gated by a shared secret (`LEARN_BRIDGE_SECRET`) and **fails closed with 503 when
  unset** — an unauthenticated account-creation endpoint on a public dictionary would let anyone mint
  accounts.

Both are fire-and-forget: if the other system is unreachable the registration still succeeds and the
gap is repaired later. Registration must never depend on the other host being up.

**The compose file matters here.** Compose passes a service only the variables it names, so adding a
variable to `/opt/ozituma/.env` is not enough — it must also be listed under the service in
`docker/docker-compose.prod.yml`, or the container never sees it and the endpoint returns 503.

**Existing accounts cannot share a password.** The dictionary stores a scrypt hash, which is
irreversible, so those accounts need one password reset on the side they were not created on. A real
cost of two systems that predate the requirement.

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

### The older design, for reference

The Next.js course routes remain in `apps/web`, and the app still picks chrome and rewrites paths from
the `Host` header (`apps/web/middleware.ts`, `apps/web/lib/learn-host.ts`). They serve
`ozituma.com/learn/*` only if something stops redirecting. Universal SSL still covers
`*.ozituma.com`, which now matters only if the subdomain is ever pointed back at the EC2 host.

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



## Working agreements

- `npm run verify` and the test suites are the gate. A change that fails them is
  not finished, however good it looks.
- Imported corpus data is attributed per source and stays `draft` unless its
  licence permits publication. See `docs/DATA-SOURCES.md`.
- Never commit third-party scans, corpora or media. See `.gitignore`.

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
