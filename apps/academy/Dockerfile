# syntax=docker/dockerfile:1
#
# Ozikoro Academy — academy.ozikoro.com
#
# Built from THIS DIRECTORY, not from the repository root, and that is deliberate.
#
# The other apps in this monorepo (`web`, `ozikoro`) are Next.js workspaces that share one root
# lockfile and one `npm ci`, so they build from the root context. The Academy is a TanStack Start /
# Vite application on a different major of React and a different bundler, and folding it into that
# shared install would put its dependency graph in the same resolution as the two Next apps — where a
# peer conflict in one becomes a failed build in all three, and where the shared `deps` layer means a
# change here invalidates the cached install for the live dictionary and archive.
#
# So it is its own image built from its own directory and its own lockfile. It has no dependency on
# `packages/`, so nothing is lost by the separation, and a fault in this build cannot fail theirs.
#
#   docker build -t ozikoro-academy:latest apps/academy
#
# The build MUST NOT run with LOVABLE_SANDBOX=1 or DEV_SERVER__PROJECT_PATH set. Inside a Lovable
# sandbox the config wrapper pins the output back to `dist/` and the Cloudflare preset regardless of
# what `vite.config.ts` says, and the resulting artefact cannot be run by node. See `vite.config.ts`
# for why the `node-server` preset is load-bearing.

# ---------------------------------------------------------------------------
# Dependencies — cached separately from source so a code edit does not reinstall
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime — the Nitro node-server bundle and nothing else.
#
# Nitro traces and bundles what the server imports, so `.output` is self-contained: it carries no
# `node_modules` of its own and runs against a bare Node runtime. Measured at 3 MB, against a
# dependency tree of a few hundred megabytes, which is the whole reason this stage is worth having.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# A non-root runtime. The same reasoning as the other images here: a container that does not need
# root should not have it.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 academy

COPY --from=builder --chown=academy:nodejs /app/.output ./.output

USER academy
EXPOSE 3000

# The health check now asks the app's own health endpoint, which reports whether the database is
# reachable as well as whether the process answers. The previous version asked `/`, which proves the
# SSR handler and the asset layer loaded but says nothing about the database — so a container whose
# connection string was wrong stayed healthy while every page failed. `wget` is in the alpine base;
# `curl` is not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", ".output/server/index.mjs"]
