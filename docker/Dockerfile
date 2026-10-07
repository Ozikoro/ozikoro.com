# syntax=docker/dockerfile:1
#
# Ozituma — production images.
#
# Built from the REPOSITORY ROOT, not from an app directory, because this is an npm workspace
# monorepo and the apps consume packages/core and packages/db as TypeScript source:
#
#   docker build -f docker/Dockerfile --target web     -t ozituma-web:latest     .
#   docker build -f docker/Dockerfile --target ozikoro -t ozikoro-site:latest    .
#
# ONE TARGET PER APP, AND WHY THAT MATTERS MORE THAN THE SAVING
#
# An earlier version of this file built several apps into ONE image and ran them as separate
# services. That was cheaper, and it looked like separation, but it was not: shipping one app
# required rebuilding another, because one image means one build. §6.1 chose a separate deployment
# precisely so that a change to one app is not a risk to the others, and a single image quietly
# re-created the coupling the arrangement was meant to remove.
#
# **THERE WERE THREE TARGETS AND THERE ARE TWO.** The third was `learn`, which built the legacy
# Next.js courses app in `apps/learn` for `learn.ozituma.com`. That app, its directory and its target
# are gone — the host was already answering from a Cloudflare Worker and is now being retired in
# favour of `academy.ozikoro.com`. See the note where the target used to be.
#
# Both images are built from one checkout, so the shared `packages/` they carry are the same schema
# and the same orthography rules as each other.
#
# Node 24 is deliberate: it strips TypeScript types natively, so the schema, migration runner and
# importers run straight from source with no build step and no ts-node/tsx dependency. That is also
# why the source in those packages avoids non-eraseable TypeScript (no enums, no parameter
# properties).

# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
# Dependencies — cached separately from source so code edits do not reinstall
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY apps/web/package.json ./apps/web/
# The archive. THIS LINE AFFECTS ALL THREE IMAGES: this layer is shared, so adding a workspace here
# invalidates the cached `npm ci` for web and ozikoro alike. That is the cost of one lockfile
# and one install, and it is why this is not an "ozikoro-only" change — round 152 recorded that the
# Dockerfile work is five parts across two files rather than one service definition.
COPY packages/ozikoro/package.json ./packages/ozikoro/
COPY apps/ozikoro/package.json ./apps/ozikoro/
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# Build — one builder per app, so neither can build the other.
# ---------------------------------------------------------------------------
FROM base AS builder-web
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The web app reads no database at build time (every route is dynamic), so the build needs no
# DATABASE_URL. If a route ever becomes statically rendered, this is where a build-time database
# would be wired in.
RUN npm -w @ozituma/web run build

# The archive — ozikoro.com
#
# Its own builder for the same reason web has its own: `docker build --target builder-ozikoro` must
# not build the dictionary, so a fault in it cannot fail this app's image.
FROM base AS builder-ozikoro
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Like the dictionary, every route here is dynamic and reads the database at request time, so the build
# needs no DATABASE_URL. If a route ever becomes statically rendered, this is where a build-time
# database would be wired in.
RUN npm -w @ozikoro/site run build

# ---------------------------------------------------------------------------
# Runtime base — everything both images need and neither app produces.
#
# One stage so the two targets cannot drift in what they ship alongside their app.
# ---------------------------------------------------------------------------
FROM base AS runtime-base

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The migration runner and the importers need the workspace source plus their dependencies, so they
# can run against either image. The standalone bundle brings its own traced node_modules; this copy
# is what lets `node packages/db/src/migrate.ts up` work inside the container.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs packages ./packages
COPY --chown=nextjs:nodejs package.json ./package.json

# The curated knowledge — where each Igbo personal name is BORNE, the forms it takes in the
# neighbouring varieties, the meanings and examples we add to entries the corpora left thin, and the
# English renderings written for proverbs no publication translated.
#
# This is the part of `data/` that belongs in the image rather than on a mounted volume. Everything
# else under data/ is a third-party corpus that is large, re-downloadable and gitignored, and
# `.dockerignore` keeps those directories out of the build context entirely — so copying `data`
# brings the curated folders and nothing else.
#
# It copies the DIRECTORY rather than naming folders one at a time, and that is a correction rather
# than a preference: the word-additions importer died in production with ENOENT on a file that had
# been on the host all along, and then the proverb-renderings importer did exactly the same thing,
# because each new curated file needed a line here and the line was forgotten twice. A list that has
# to be maintained by hand goes stale silently; copying the directory cannot.
COPY --chown=nextjs:nodejs data ./data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ---------------------------------------------------------------------------
# The dictionary — ozituma.com
# ---------------------------------------------------------------------------
FROM runtime-base AS web

# Standalone server bundle produced by next.config.ts `output: 'standalone'`.
COPY --from=builder-web --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder-web --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# The public folder, which standalone output does NOT include.
#
# Next's docs are explicit that `public` and `.next/static` must be copied by hand in standalone
# mode, and only the latter was. Nothing noticed, because until now there was nothing in public/.
# The Ndebe font is the first thing to live there, and without this line every word entry would
# render its script as a row of empty boxes — a failure that looks like a broken font rather than a
# missing COPY.
#
# It lands at apps/web/public and not at ./public because the server resolves it relative to its own
# directory: the standalone entry point is apps/web/server.js, so `dir` is apps/web and it looks for
# apps/web/public.
COPY --from=builder-web --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------
# THE `learn` TARGET IS GONE, AND `apps/learn` WITH IT.
#
# `FROM runtime-base AS learn` built the legacy Next.js courses app into `ozituma-learn:latest`. That
# app served `learn.ozituma.com`, the `learn` CNAME was deleted when the Cloudflare Worker took the
# subdomain, and **the host is now being retired in favour of `academy.ozikoro.com`** — so the app,
# its source directory and this target are all removed together.
#
# A target with no source directory does not fail politely: `docker build --target learn` would fail
# on the `COPY apps/learn/package.json` in the `deps` stage above. That is why the workspace line, the
# builder stage and this target were removed in one change.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# The archive — ozikoro.com
#
# `public` is copied by hand for the same reason it is for the dictionary, and here it matters more: the
# archive's whole approved design handoff lives in `apps/ozikoro/public/design/` — 51 screens, the
# stylesheets and the five progressive-enhancement scripts. Without this line every page would render
# unstyled HTML, which is a failure that looks like a broken design rather than a missing COPY.
# ---------------------------------------------------------------------------
FROM runtime-base AS ozikoro

COPY --from=builder-ozikoro --chown=nextjs:nodejs /app/apps/ozikoro/.next/standalone ./
COPY --from=builder-ozikoro --chown=nextjs:nodejs /app/apps/ozikoro/.next/static ./apps/ozikoro/.next/static
COPY --from=builder-ozikoro --chown=nextjs:nodejs /app/apps/ozikoro/public ./apps/ozikoro/public

CMD ["node", "apps/ozikoro/server.js"]

# ---------------------------------------------------------------------------
# The backup tools — `age`, the AWS CLI and the Postgres client, in one image
#
# THIS TARGET EXISTS BECAUSE ONE OF THE TWO SERVICES THAT NEEDS IT WAS ALREADY CALLING A TOOL ITS
# IMAGE DID NOT CONTAIN.
#
# Measured this round by listing the file names in each upstream image's own layers (linux/arm64, the
# architecture this host is), anonymously, with no credentials:
#
#   postgres:16-alpine        /usr/local/bin/pg_dump, pg_restore, psql, pg_isready
#                             NO openssl CLI, NO gpg, NO age, NO aws
#   amazon/aws-cli:2.37.9     /usr/local/bin/aws, /usr/bin/gpg
#                             NO pg_restore, NO pg_dump, NO psql, NO openssl, NO age
#
# The second line is a fault rather than a gap: the `backup-upload` entrypoint runs
# `pg_restore --list` on every dump before it uploads it, and that image has never contained
# `pg_restore`. Nothing ever asked the image whether it had the tool, so the service starts cleanly,
# prints its AWS CLI version, finds every dump unlistable — an exit 127 from the shell, not a verdict
# on the file — marks each one `.rejected` after five attempts, and uploads nothing. **The pipeline
# fails closed and it is inert, which is the worst of both: nothing leaks, and nothing leaves the
# machine.** This stage is therefore not a convenience for adding encryption; it is the fix for a
# call that was never possible, and the encryption rides in the same image.
#
# WHY `postgres:16-alpine` IS THE BASE AND NOT `alpine`. The dumper needs a `pg_dump` whose version
# is never older than the server's, or `pg_dump` refuses outright with a version mismatch. Building
# from the SAME TAG the `postgres` service runs makes the two the same image, so they cannot drift, at
# the cost of carrying a server this target never starts. A hand-picked Alpine
# `postgresql16-client` package would be frozen at whatever the Alpine branch held and could fall
# behind the server image on a later pull.
#
# WHY `age` AND NOT `openssl`. `openssl` was the first candidate because it is "everywhere" — and it
# is not in `postgres:16-alpine`, so an image change is needed either way and that argument buys
# nothing. What is left is the cryptography: `age` is authenticated encryption (X25519 +
# ChaCha20-Poly1305), so a ciphertext that has been altered or truncated fails to decrypt and says
# so; `openssl enc -aes-256-cbc` has no MAC at all even with `-pbkdf2` and an explicit `-iter`, so a
# damaged file decrypts to garbage and the only thing that ever notices is `pg_restore` at restore
# time. `gpg --symmetric` would be defensible cryptography and needs a passphrase in the environment
# and a keyring in the image; `age` needs one 32-byte key and no keyring.
#
# THE PACKAGES COME FROM THE ALPINE 3.20 INDEX AND ARE NOT VERSION-PINNED HERE. Measured against
# pkgs.alpinelinux.org for branch v3.20, x86_64, on 2026-10-05: `age` 1.2.1-r0 and `aws-cli` 2.15.57-r0,
# both in `community`. Pinning `=1.2.1-r0` would make a security update to `age` require an edit to
# this file before it could reach the backup, which is the wrong trade for a tool whose whole job is
# to be trustworthy. What replaces the pin is the assertion at the start of both entrypoints: each
# logs `age --version` and `aws --version`, so the versions that actually ran are lines in the log
# rather than assumptions about the build.
# ---------------------------------------------------------------------------
FROM postgres:16-alpine AS backup-tools

# ⚠️ `curl` IS HERE FOR THE IMAGE-IMPORTER SCRIPT, AND ITS ABSENCE COST AN IMPORT RUN.
#
# `scripts/import-inbody-images.ts:172` does `spawn('curl', args)` — *it fetches every image a record's
# body names, from whatever host still holds it.* **The runtime image had no `curl`, so the import ran
# until it reached the first URL needing one and then died with a bare `Node.js v24.21.0` and a dump of
# the argument list** — *which reads like a crash rather than a missing binary, and is why it took two
# runs and a `which curl` to find.*
#
# ⚠️ **AND `wget` WAS ALREADY PRESENT, WHICH IS WHAT MADE IT CONFUSING.** *The image is `node:24-alpine`,
# which ships busybox `wget` and no `curl`, so a script that shells out to `curl` fails on exactly the
# hosts the archive needs.*
#
# **Measured: 1,389 images were imported across four runs — 803, then 221, then 368, each stopping at the
# same kind of URL — and `ozikoro_media` went from 3,443 rows with bytes to 4,832.** *The runs before
# `curl` was installed each ended early; the one after it completed its pass with zero errors.*
RUN apk add --no-cache age aws-cli curl
