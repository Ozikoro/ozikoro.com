# Ozikoro Academy — `@ozikoro/academy`

The Academy at **academy.ozikoro.com**: structured courses in Igbo language, African history,
culture and cultural research. It is the successor to `learn.ozituma.com`, which was retired entire
on 2026-10-04, and it sits inside the Ozikoro project as the learning layer beside the archive
(`ozikoro.com`) and the dictionary (`ozituma.com`).

The interface follows the approved design handoff: editorial serif and sans typography, warm gold
accents on deep charcoal-green surfaces, archival imagery, sharp rules and generous whitespace.
There is deliberately no XP, streak, leaderboard or marketplace economy.

## What is real, and what is still representative

**Accounts, enrolment and progress are real and persisted.** A learner registers against the shared
`account` table — the same one the dictionary uses — signs in, enrols in a course, and their progress
and assessment attempts survive a reload and follow them between devices. "My Learning" reads that
record; the lesson reader shows their actual position and offers completion only when a lesson is not
already done.

**The rest of the front end is still representative content**, and it is worth being precise about
which parts, because the pages look equally finished:

- **Mastery, certificates and the academic record** are illustrative. The spec's mastery engine has
  not been built. `academy_attempt` is deliberately a log rather than a single mutable score, so it
  is the history that engine will read.
- **The catalogue lives in code** (`src/data/academy.ts`), not in the database, so enrolment
  references courses by slug. Moving it into `learn_course` is a migration and a foreign key, and
  enrolments do not change meaning when it happens.
- **Onye Ozi answers from a fixed reply**, not from approved sources.
- **Sources, culture profiles, maps, timelines, comparisons and the classroom system** are the
  spec's remaining entities; none is persisted.
- Several controls are presentational: the sort selector, the certificate download, the reading-list
  save and the class assignment form.
- The home page's "24 Structured courses / 8 Learning pathways / 12 Academic instructors" does not
  match the data behind it (6 / 10 / 3). It is placeholder copy that should be corrected or wired to
  real counts.

`AGENTS.md` requires the Academy to use Ozikoro's **single shared authentication, profile, role and
admin data source, so that registration applies everywhere**. That is now true of authentication: the
account table is shared. Profiles, roles and admin are shared by virtue of being the same table, but
nothing in the Academy yet reads a role or exposes an administration surface.

### How the backend is wired

- `src/backend/` holds the server side. It is not under `src/server/` because TanStack Start's
  import-protection plugin denies any client import from a `**/server/**` path.
- `src/backend/functions.ts` is the only place a session is read and the only place authorisation is
  decided. `src/backend/academy.ts` takes an `accountId` it cannot obtain itself, so a route cannot
  read another learner's progress by forgetting a check.
- The Academy authenticates against the shared tables but **cannot share the session cookie**: a
  cookie may only be shared within one registrable domain, and `ozikoro.com` and `ozituma.com` are
  different registrable domains. It therefore issues its own session scoped to `.ozikoro.com`. The
  shared thing is the account, not the session.
- `src/backend/passwords.ts` and `src/backend/session.ts` are ports of the canonical implementations
  in `packages/db`, not imports — see the header of `src/backend/db.ts` for why. They are
  cross-verified in both directions by `.academy-work/cross-check-passwords.mjs`, because drift there
  would mean an account created on the dictionary could not sign in here.
- Schema changes live in `db/migrations/` and are applied by `db/migrate.mjs`, tracked in the
  Academy's own `academy_migration` ledger. **The Academy deliberately does not use the dictionary's
  migration chain**, because production and this repository diverged after migration `0033` — see the
  header of `0001_academy.sql`.

## Running it

```sh
npm install                          # from the repository root; this is an npm workspace
npm -w @ozikoro/academy run dev      # http://localhost:3000
npm -w @ozikoro/academy run build    # -> .output/
npm -w @ozikoro/academy run test
```

## Build target

`vite.config.ts` names the Nitro preset explicitly:

```ts
nitro: { preset: "node-server" }
```

**This is load-bearing.** The `@lovable.dev/vite-tanstack-config` wrapper supplies
`{ defaultPreset: "cloudflare-module" }`, so without that line the build emits a Cloudflare Worker —
an artefact `node` cannot run and no container on the Ozikoro host can serve. `node-server` also
serves the client assets itself and listens on `PORT`, defaulting to 3000, which is the port Caddy
proxies to.

The build must not run with `LOVABLE_SANDBOX=1` or `DEV_SERVER__PROJECT_PATH` set; inside a Lovable
sandbox the wrapper pins the output back to `dist/` and the Cloudflare preset regardless of this
config.

## The brand

The Ozikoro mark is drawn, not spelled. `src/components/ozikoro-mark.tsx` inlines the owner's master
artwork (`public/brand/ozikoro-mark.svg`) as a component rather than referencing it with `<img>`, for
one reason: the artwork fills with `currentColor`, so a single asset renders in the header's ink and
the footer's gold without a second file or a theme branch. The path data is the identity — handle it
as an asset, not as code to tidy.

The icon set (`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`) is generated from the same
artwork. The file this replaced was a generic placeholder shipped by the site builder.

## Deployment

Built and run as one container behind the host's Caddy, which terminates TLS and proxies to port
3000. See `docker/Dockerfile` (target `academy`) and the `academy` service in
`docker/docker-compose.prod.yml`. That service deliberately names every variable it reads: Compose
passes a service only the variables it names, so adding one to `/opt/ozituma/.env` is never enough
on its own.
