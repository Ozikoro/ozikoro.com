# Deployment

Ozituma is a portable container plus three managed services. Nothing in the codebase is tied to a
specific host: the image runs anywhere Docker runs, the database is standard Postgres, and media goes
to any S3-compatible bucket.

This document describes the AWS target the Ozikoro platform standardises on.

---

## Target architecture

```
                    Route 53  (ozituma.com)
                         │
                  ┌──────▼──────┐
                  │  CloudFront │  static assets + media cache
                  └──────┬──────┘
                         │
                  ┌──────▼──────────────┐
                  │  ALB                │  TLS termination, health checks
                  └──────┬──────────────┘
                         │
            ┌────────────▼─────────────┐
            │  ECS Fargate service     │  2+ tasks, autoscaling on CPU/RPS
            │  ozituma:latest          │  runs `node apps/web/server.js`
            └────────────┬─────────────┘
                         │
        ┌────────────────┼─────────────────┐
        │                │                 │
 ┌──────▼──────┐  ┌──────▼──────┐  ┌───────▼────────┐
 │ RDS Postgres│  │ S3 bucket   │  │ Secrets Manager│
 │ 16, Multi-AZ│  │ media       │  │ DB creds, keys │
 └─────────────┘  └─────────────┘  └────────────────┘
                         │
                  ┌──────▼───────┐
                  │ ECR          │  image registry
                  └──────────────┘
```

**Why Fargate rather than Lambda or App Runner.** The application holds a connection pool and relies
on Postgres' query planner; a long-lived container pools connections efficiently and costs
predictably. Lambda would push connection pooling to RDS Proxy and complicate the import jobs, which
are long-running and CPU-bound.

---

## 1. Build and push the image

The image builds from the **repository root**, because this is an npm workspace monorepo:

```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ozituma

aws ecr create-repository --repository-name ozituma --region $AWS_REGION || true
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$ECR"

docker build -f docker/Dockerfile -t "$ECR:$(git rev-parse --short HEAD)" -t "$ECR:latest" .
docker push "$ECR:latest"
docker push "$ECR:$(git rev-parse --short HEAD)"
```

Tag with the commit SHA as well as `latest`, so a rollback is a task-definition change rather than a
rebuild.

---

## 2. Provision the data layer

### RDS Postgres 16

| Setting | Value | Why |
|---|---|---|
| Engine | `postgres` 16 | Matches local development and PGlite exactly |
| Instance | `db.t4g.medium` to start | Burstable is enough for a dictionary read workload |
| Storage | `gp3`, 20 GB, autoscaling on | Corpora are small; audio lives in S3 |
| Multi-AZ | Enabled in production | A dictionary is read-only in practice, so a failover is cheap insurance |
| Public access | **No** | Private subnets only |
| Backups | 7-day retention minimum | Imports are reproducible, but editor and community contributions are not |
| Parameter group | `shared_preload_libraries` unset is fine | No custom extensions required |

Create the database and enable the one optional extension:

```sql
CREATE DATABASE ozituma;
\c ozituma
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- typo-tolerant search
```

If `pg_trgm` is unavailable, migration 0002 handles that gracefully and the API degrades to exact and
prefix matching rather than failing — but you lose typo tolerance, so check for it:

```bash
curl https://ozituma.com/api/health      # reports "trigram": true|false
```

### S3 bucket for media

```bash
aws s3api create-bucket --bucket ozikoro-ozituma-media --region $AWS_REGION
aws s3api put-bucket-versioning --bucket ozikoro-ozituma-media \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket ozikoro-ozituma-media \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

Keep the bucket private and serve audio through CloudFront with an Origin Access Control. That keeps
the media cacheable at the edge without making the bucket public.

Then set these on the service so the S3 driver is used instead of the local filesystem:

```
S3_BUCKET=ozikoro-ozituma-media
S3_REGION=us-east-1
MEDIA_PUBLIC_BASE_URL=https://media.ozituma.com
```

`MEDIA_PUBLIC_BASE_URL` is the CloudFront distribution in front of the bucket. Without it the API
returns raw S3 URLs, which do not work for a private bucket — and without `S3_BUCKET` at all the
application falls back to local filesystem storage, which is ephemeral on Fargate and will silently
lose every recording on the next deploy. It logs a warning in that case; check `/api/health` and the
startup logs after the first deploy.

**Task role, not static keys.** Give the ECS task a role with `s3:PutObject`, `s3:GetObject` and
`s3:DeleteObject` scoped to the one media bucket prefix (`arn:aws:s3:::ozikoro-ozituma-media/audio/*`),
and omit `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` entirely. The SDK falls back to the task role, so
no long-lived credential exists to leak or rotate.

---

## 3. Secrets

Put these in Secrets Manager and inject them as ECS secrets rather than environment values, so they
never appear in a task definition in plain text:

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | `postgres://ozituma:<pw>@<rds-endpoint>:5432/ozituma?sslmode=require` |
| `S3_BUCKET`, `S3_REGION` | Media locations |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Or, preferably, an ECS **task role** so no static keys exist at all |
| `OZITUMA_SITE_URL` | Canonical URL for the OpenAPI document and metadata |
| `PAYSTACK_SECRET_KEY` | Donations. `sk_live_…`, server-side only — see below |

No secret is required to *build* the image, and no secret is baked into it.

### Donations

Paystack's **redirect** flow is used rather than the inline widget, so the only
credential is the secret key and it never leaves the server: the amount is fixed
server-side before the donor is sent to Paystack's own checkout page, and the
public key is not needed at all.

Two things have to be set on the Paystack account, and both are dashboard changes
rather than anything this repository can do:

| Setting | Value |
|---|---|
| Callback URL | `https://ozituma.com/donate/thanks` |
| Webhook URL | `https://ozituma.com/api/webhooks/paystack` |

Until `PAYSTACK_SECRET_KEY` is present the donate page says donations are not open
yet and no donation can be started, so an absent key is a supported state rather
than a broken one. Rotating the key means changing this value and nothing else —
there is no public key to keep in step.

Every donation is confirmed against Paystack before it is recorded, from both the
redirect and the webhook, so neither a forged callback URL nor an unsigned webhook
can create one. `npm run test:paystack` exercises the signature check and both
confirmation paths against a stubbed gateway.

---

## 4. Run migrations as a one-off task

The image serves two roles, and migrations are the second. Run them before rolling out new
application code — never from application startup, because with two or more tasks running, every task
would race to migrate.

```bash
aws ecs run-task \
  --cluster ozituma \
  --task-definition ozituma-migrate \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=DISABLED}' \
  --overrides '{"containerOverrides":[{"name":"ozituma","command":["node","packages/db/src/migrate.ts","up"]}]}'
```

The same task definition runs the seed, the corpus import and the first-editor bootstrap:

```bash
# reference data (idempotent)
node packages/db/src/migrate.ts seed

# corpus import (idempotent; source files must be in the image or on EFS)
node packages/db/src/import/igbo.ts

# integrity gate — must exit 0 before the new version takes traffic
node packages/db/src/verify.ts

# first editor, so the review queue is usable. There is deliberately no
# bootstrap route in the web app: publishing rights require database access.
node packages/db/src/role.ts create editor@ozituma.com "$EDITOR_PASSWORD" "Editor Name"
node packages/db/src/role.ts promote editor@ozituma.com editor
```

Pass the editor password as a task override or read it from Secrets Manager — do not bake it into the
image or a task definition. Contributors create their own accounts at `/join`, and their submissions
land in the review queue at `/review` for an editor to approve or reject.

Because the importer, the seed and the role commands are all idempotent, running them twice is safe.
Verify explicitly afterwards; `verify.ts` exits non-zero on failure, so it works as a deployment gate.

---

## 5. ECS service

| Setting | Value |
|---|---|
| Launch type | Fargate, Linux/ARM64 (Graviton — cheaper for this workload) |
| CPU / memory | 0.5 vCPU / 1 GB per task; raise memory for the import task |
| Tasks | 2 minimum, spread across AZs |
| Health check | `GET /api/health` — returns 503 when the database is unreachable |
| Autoscaling | Target 60% CPU, 2–8 tasks |
| Deployment | Rolling, minimum healthy 100%, maximum 200% |

`/api/health` deliberately checks the database rather than just returning 200. A container that
cannot reach Postgres is not serving traffic and should be pulled from the load balancer.

### Environment

```
NODE_ENV=production
PORT=3000
DATABASE_URL=<from Secrets Manager>
DATABASE_POOL_MAX=10
OZITUMA_SITE_URL=https://ozituma.com
OZITUMA_VERSION=<git sha>
S3_BUCKET=ozikoro-ozituma-media
S3_REGION=us-east-1
```

**Pool sizing matters.** Each task opens up to `DATABASE_POOL_MAX` connections. With 8 tasks that is
80 connections; keep the total below your RDS `max_connections` (roughly
`LEAST({DBInstanceClassMemory/9531392}, 5000)` — about 200 on a `db.t4g.medium`). Either lower the
pool per task or front RDS with RDS Proxy.

---

## 6. DNS and TLS

Point `ozituma.com` at CloudFront, with the ALB as origin. Use an ACM certificate in `us-east-1`
(CloudFront requires that region regardless of where the ALB lives).

Two behaviours worth configuring:

- **Cache `/api/v1/*` briefly** — responses already set `Cache-Control: public, s-maxage=...`, so
  CloudFront honours it. Individual entries set `s-maxage=3600`.
- **Never cache `/api/health` or `POST /api/v1/developers`.**

### What the zone already looks like

Both domains are registered at Namecheap and delegated to a shared Cloudflare
account.

| | |
|---|---|
| `ozituma.com` | zone `8d5c9e827bdfe35b236d8a3dc218df5e` — active, Free plan, SSL **`full`** |
| Universal SSL | already `active`, covering `ozituma.com` and `*.ozituma.com` |
| Nameservers | `clint.ns.cloudflare.com`, `khloe.ns.cloudflare.com` |
| Registrar | NameCheap, Inc., auto-renew on, renews 2027-07-03 |

Verified live on 2026-09-28 — the origin records described in an earlier version
of this document as missing have since been added:

```
A      ozituma.com        44.194.56.187     proxied
CNAME  www.ozituma.com    ozituma.com       proxied
CNAME  learn.ozituma.com  ozituma.com       proxied   <- DELETED SINCE; see the next section
CNAME  media.ozituma.com  public.r2.dev     proxied
MX     ozituma.com        eforward1-5.registrar-servers.com
TXT    ozituma.com        "v=spf1 include:spf.efwd.registrar-servers.com ~all"
```

The mail records are Namecheap email forwarding and must be left alone — replacing
the SPF rather than adding to it breaks forwarding.

### The learn subdomain — RETIRED IN THIS REPOSITORY, STILL ANSWERING

**READ `AGENTS.md` FIRST.** `learn.ozituma.com` is being retired and `academy.ozikoro.com` replaces it;
`academy.ozikoro.com` has no record in the `ozikoro.com` zone and must not be created from here. What
follows describes the arrangement this file recorded while the subdomain was served **by this
application**, which it no longer is — the host is a Cloudflare Worker, and the legacy Next.js app that
built the fallback container (`apps/learn`) has been deleted.

**EVERYTHING FROM HERE TO THE END OF THIS SECTION IS HISTORY, AND TWO OF ITS INSTRUCTIONS ARE NOW
WRONG.** It is kept because it records what was built and why, not because it can be followed:

  * **`apps/web/lib/learn-host.ts` DOES NOT EXIST.** The file this section names twice was deleted when
    the courses stopped being served by the dictionary on a second hostname. A reader who goes looking
    for it will not find it, and `apps/web/middleware.ts` no longer decides chrome from the `Host`
    header.
  * **THE `learn` CNAME ABOVE WAS DELETED.** `dig learn.ozituma.com` answers with Cloudflare Worker
    addresses, not with this origin, and the `learn` service in `docker-compose.prod.yml` — which this
    section's Caddy block describes — has been removed along with `apps/learn`.

While it was true, it read as follows.

`learn.ozituma.com` served the Ozituma Learn courses. It was **not** a second
application: it was the same container, the same database and the same Next.js
process as the dictionary. The app decided which site it was serving from the
`Host` header, and rewrote `/` to `/learn` for requests that arrived on a
`learn.*` host. See `apps/web/middleware.ts` and `apps/web/lib/learn-host.ts`.

Two DNS facts make this cheap:

- **No new certificate.** Universal SSL already covers `*.ozituma.com`, so the
  subdomain is TLS-terminated by Cloudflare with nothing to issue. Verified: an
  HTTPS request to `learn.ozituma.com` completes with `ssl_verify_result: 0`.
- **No new origin.** The record is a `CNAME` to `ozituma.com` rather than an `A`
  to the Elastic IP, so it inherits the apex's address. If the instance or its
  Elastic IP is ever replaced, one record still points both hostnames correctly.

The one thing DNS cannot do is make Caddy answer for the new host. `docker/Caddyfile`
has a `learn.{$OZITUMA_DOMAIN}` block, so the subdomain starts serving **only after
the Caddy config on the host is updated and Caddy is reloaded**. Until then the
edge returns an empty `200` for `learn.ozituma.com`, because Cloudflare reaches the
origin and no Caddy site block claims the host.

To deploy it:

```bash
# On the instance, after pulling the new Caddyfile:
docker compose -f docker/docker-compose.prod.yml up -d --build
docker compose -f docker/docker-compose.prod.yml exec caddy \
  caddy validate --config /etc/caddy/Caddyfile
```

Validate before reloading. There is no `caddy` or `docker` binary in the
development environment, so this file's syntax is checked structurally at review
time and must be validated by the real binary on the host.

Expected after the reload:

| URL | Serves |
|---|---|
| `learn.ozituma.com/` | the course list, Learn chrome |
| `learn.ozituma.com/igbo` | the Igbo course, Learn chrome |
| `ozituma.com/learn` | the same pages under the dictionary chrome |
| `ozituma.com/` | unchanged |

Both routes work deliberately. The subdomain is canonical — it is what appears in
course canonical links and what should be shared — while the apex path exists so
the dictionary's own navigation can link to the courses without hard-coding a
second domain, and so the courses stay reachable if the subdomain's DNS is having
a bad day. `apps/web/lib/learn-host.ts` computes the right link prefix per request,
so neither form produces a broken link on the other host.

Three optional environment variables control this. All three have working defaults,
so no change is required to bring the subdomain up:

| Variable | Default | Effect |
|---|---|---|
| `OZITUMA_LEARN_URL` | `https://learn.ozituma.com` | Origin written into course canonical links |
| `OZITUMA_LEARN_HOST` | *(empty)* | Empty means "any `learn.*` host"; set it to `learn.ozituma.com` to accept only that one |

SSL mode is `full`, which is what the origin behind Cloudflare wants; `flexible`
would cause a redirect loop. The Caddyfile is written for `full (strict)` and
receives a Cloudflare Origin CA certificate, so raise the zone to `full (strict)`
once that hop is confirmed working.

The credential for this lives outside this repository — see *Cloudflare and
Namecheap access* in `AGENTS.md` before reaching for it.


---

## Local stack

`docker/docker-compose.yml` runs Postgres 16, MinIO (S3-compatible) and the app, so the
object-storage code path is exercised locally against the same API shape it will use in production:

```bash
docker compose -f docker/docker-compose.yml up -d
export DATABASE_URL=postgres://ozituma:ozituma@localhost:5432/ozituma
npm run db:migrate && npm run seed && npm run import:igbo
npm run dev
```

MinIO's console is at http://localhost:9001 (`ozituma` / `ozituma-dev-secret`).

---

## Running an import against the current data

**The container has no bind mount over `/app`.** It runs the copy of the repository that was baked
into the image, so a data file uploaded to `/opt/ozituma/app` is invisible to `docker exec` until the
image is rebuilt:

```bash
# WRONG — imports the file as it was at BUILD time, reports success, changes nothing
python3 tools/ssm_put.py --tar /opt/ozituma/app data/clans/clans.json
python3 tools/ssm.py <<'EOF'
docker exec -w /app ozituma-web-1 node packages/db/src/import/clans.ts --apply
EOF
```

That is not a hypothetical. It is what left a set of clan entries holding wording the file had
already had corrected: the import ran, printed the counts it always prints, and read the previous
copy of the file. Nothing about the output says the file was stale.

Copy the files in first:

```bash
# RIGHT — the running container gets the current files, then imports them
python3 tools/ssm_put.py --tar /opt/ozituma/app data/clans/clans.json
python3 tools/ssm_put.py tools/import-data-remote.sh /opt/ozituma/import-data-remote.sh
python3 tools/ssm.py - <<'EOF'
sh /opt/ozituma/import-data-remote.sh
EOF
```

`tools/import-data-remote.sh` does the `docker cp` for every curated data file and then runs the
imports, so it is safe to run at any time. A rebuild also carries the files, so both routes agree —
this one just does not cost twenty minutes.

## Operational checklist

Before the first production deploy:

- [ ] `npm run verify` passes against the production database
- [ ] `pg_trgm` installed; `/api/health` reports `"trigram": true`
- [ ] RDS is in a private subnet with no public access
- [ ] The S3 bucket blocks all public access; CloudFront uses OAC
- [ ] `DATABASE_URL` and other secrets come from Secrets Manager, not the task definition
- [ ] The ECS task role is scoped to the one media bucket, not `s3:*`
- [ ] Migrations have been run as a one-off task, **before** the service rollout
- [ ] At least one editor account exists (`role.ts list`) so the review queue is usable
- [ ] At least one free API key has been created and exercised against the deployed API
- [ ] `OZITUMA_SITE_URL` is set to the real `https://` URL, so session cookies are marked `Secure`
- [ ] CloudWatch alarms exist on ALB 5xx rate, ECS task failures and RDS free storage
- [ ] A rollback path is confirmed: previous task-definition revision pinning the previous image tag

Deliberately not deployed yet, and required before public launch:

- [ ] The registration endpoint's IP throttle is **in-process**. With more than one task, each task
      keeps its own counter, so move this to WAF rate-based rules or a shared store (ElastiCache)
      before exposing `/api/v1/developers` to the open internet.
- [ ] Same for the account sign-up and contribution-submission routes: they have no per-IP throttle
      at all yet, only the account-required check and the database's duplicate-pending constraint.
      Put WAF rate rules in front of them before launch.
- [ ] CloudFront/WAF rate limiting on the public API in front of per-key quotas, so an unauthenticated
      flood is rejected before it reaches the application.
