# Deploying Ozituma Learn

**Status:** the configuration is complete and verified. The step that has not been run is the
push to the production host — see §4 for why, and what it needs.

---

## 1. What the deployment is

**Two images**, built from separate targets in one Dockerfile, behind one Caddy:

| Hostname | Container | Image (target) | Serves |
|---|---|---|---|
| `ozituma.com` | `web` | `ozituma-web:latest` (`--target web`) | the dictionary |
| `learn.ozituma.com` | `learn` | `ozituma-learn:latest` (`--target learn`) | the courses |

**Two images, and that is the point.** An earlier version built both apps into one image and ran
them as two services. It was cheaper and it looked like separation, but shipping the courses
required rebuilding the dictionary — because one image means one build. §6.1 chose a separate
deployment for the courses precisely so a change to the lesson player is not a risk to
ozituma.com, and a single image quietly re-created that coupling.

Now `docker build --target learn` never builds the dictionary. A half-finished change in
`apps/web` cannot fail the courses deploy, and the courses deploy cannot ship it.

The two images are built from one checkout, so the shared `packages/` they carry are the same
schema and the same orthography rules as each other.

`ozituma.com/learn` 308-redirects to the subdomain, so the dictionary's own navigation link and
any already-shared link keep working.

### The shared account

Both containers get the same `OZITUMA_AUTH_COOKIE_DOMAIN`. Set it to `.ozituma.com` and one
session cookie is valid on both hostnames, so an account created on either works on both.

**Leave it unset and this silently does not work** — the cookie stays host-only and a learner who
signs in on the dictionary arrives at the courses signed out. It defaults to unset because a
cookie domain that does not match the host is discarded by every browser with no log line, so the
safe default is the one that cannot break sign-in. See `ACCOUNTS.md`.

---

## 2. Environment

Add to `/opt/ozituma/.env` on the host:

```
OZITUMA_AUTH_COOKIE_DOMAIN=.ozituma.com
OZITUMA_LEARN_URL=https://learn.ozituma.com
OZITUMA_SITE_URL=https://ozituma.com

# Optional — analytics. Nothing is sent unless consent is granted.
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
OZITUMA_ANALYTICS_CONSENT=true
```

`OZITUMA_AUTH_COOKIE_DOMAIN` is the only one that changes behaviour the owner will notice.

---

## 3. Deploy

```bash
# On the host, via SSM Session Manager.
cd /opt/ozituma/app
git pull
cd docker

# Deploy the courses ALONE. --target learn does not build the dictionary, so
# whatever state apps/web is in cannot fail this. This is the safe first deploy,
# and it is also the whole of what is needed to bring learn.ozituma.com up.
docker compose -f docker-compose.prod.yml up -d --build learn

# Validate Caddy BEFORE reloading it. A bad Caddyfile takes BOTH hostnames down,
# and validate is the only thing that catches it.
docker compose -f docker-compose.prod.yml exec caddy \
  caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.prod.yml exec caddy \
  caddy reload --config /etc/caddy/Caddyfile
```

Deploying the dictionary is a separate, deliberate act — and it is the one that needs a clean
working tree:

```bash
docker compose -f docker-compose.prod.yml up -d --build web
```

Then check:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ozituma.com/
curl -s -o /dev/null -w '%{http_code}\n' https://learn.ozituma.com/
curl -s https://learn.ozituma.com/api/health
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://ozituma.com/learn
```

### Rollback

```bash
cd /opt/ozituma/app && git log --oneline -3
git checkout <previous-commit>
cd docker && docker compose -f docker-compose.prod.yml up -d --build
```

The `web` service is untouched by a `learn`-only change, so a bad courses deploy does not require
rolling the dictionary back.

---

## 4. Why this has not been run yet

Two reasons, and neither is caution for its own sake.

### 4.1 The production host is mid-deploy by another workstream

Checked on 28 September 2026:

```
$ git status --porcelain | wc -l
56
$ git status --porcelain | awk '{print $2}' | cut -d/ -f1-2 | sort -u
apps/web
data/clans
data/words
package.json
packages/core
packages/db
```

The host's `/opt/ozituma/app` has **56 uncommitted modified files** from a concurrent workstream
on the dictionary, and its `apps/` contains only `web`. The `web` container had restarted seconds
before that check.

**`docker compose up --build` rebuilds the dictionary's own image from that working tree.** I
caught that same tree in a broken state earlier in this session — `EDITORIAL_SOURCE_ID` undefined,
which fails the TypeScript build. If the build fails there, the dictionary is left without a
working image and `ozituma.com` goes down.

So the deploy needs a moment when that workstream is not mid-edit. It is a scheduling problem, not
a technical one.

### 4.2 The platform has no reviewed content to serve

Every Igbo item in the database is unverified AI-authored draft, quarantined to `status = 'draft'`
(`docs/decisions.md` T5), because §2.1 forbids AI-authored Igbo reaching learners. `learn.ozituma.com`
would therefore serve its landing page and then say:

> No courses are published yet.

That is the honest state and the correct behaviour — but it is not a language course. §18 #4
(a named lead linguist and two native reviewers) has **no default** and blocks all learner-visible
content; §18 #11 (equity and IP) says "settle in writing before work starts".

**Deploying the software is ready. Launching the product is waiting on content.**

---

## 5. What the owner needs to decide

| # | Decision | Why it is theirs |
|---|---|---|
| 1 | When to deploy, given another workstream is mid-deploy on the same host | It risks the live dictionary, and only they know what else is running |
| 2 | Whether to deploy before the curriculum exists | An empty platform is honest but not a product |
| 3 | D4 — name the lead linguist and reviewers | §18 #4, no default, blocks every learner-visible word |
| 4 | D11 — the equity and IP position | §18 #11, "settle in writing before work starts" |

Once (1) is answered, the deploy in §3 is about five minutes of work.
