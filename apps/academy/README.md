# Ozikoro Academy — `@ozikoro/academy`

The Academy at **academy.ozikoro.com**: structured courses in Igbo language, African history,
culture and cultural research. It is the successor to `learn.ozituma.com`, which was retired entire
on 2026-10-04, and it sits inside the Ozikoro project as the learning layer beside the archive
(`ozikoro.com`) and the dictionary (`ozituma.com`).

The interface follows the approved design handoff: editorial serif and sans typography, warm gold
accents on deep charcoal-green surfaces, archival imagery, sharp rules and generous whitespace.
There is deliberately no XP, streak, leaderboard or marketplace economy.

## What this application is, and what it is not

**It is a complete front end.** Every one of the 34 routes renders, navigates and carries its own
metadata, and the catalogue, culture profiles, timelines, maps, comparisons, lesson readers and the
Onye Ozi panel are all driven from one data module.

**It has no backend.** This is the important thing to know before reading the code as if it were
finished:

- enrolment, progress, mastery, accounts, certificates and the academic record are **representative
  content, not recorded state**;
- nothing persists across a reload, and there is no database, no session and no server function;
- Onye Ozi answers from a fixed reply, not from approved sources;
- several controls are presentational — the sort selector, the certificate download, the
  reading-list save and the class assignment form.

The originating plan states this plainly: *"Keep interactions front-end only with representative
content and UI states; enrolment, accounts, saved progress, certificates, search, and Onye Ozi will
be demonstrations until a connected backend is requested."*

The repository's own `AGENTS.md` sets the requirement that follows: **the Academy must use Ozikoro's
single shared authentication, profile, role and admin data source, so that registration applies
everywhere.** That work has not been done.

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
