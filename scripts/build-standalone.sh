#!/usr/bin/env bash
#
# Build the deployable artifact.
#
# WHY THIS SCRIPT EXISTS
#
# `output: 'standalone'` produces a server bundle that deliberately does NOT include `public/` or
# `.next/static`. Next.js documents this, and it is still the most common way a Next deployment
# arrives unstyled and image-less. Measured on this repository before this script was written:
#
#     .next/standalone/  ->  public/ MISSING, .next/static/ MISSING
#
# Starting that server gave 404s for every image, all 3,437 archived media files, the design's
# stylesheets, `a11y.css`, and every JS and CSS chunk. It compiles fine and deploys broken, which is
# the worst combination: the failure appears after the old site is already down.
#
# So the copies are part of the build, they are asserted afterwards, and the assertions are on the
# ARTEFACT rather than on the commands having run — because those are different things and only one of
# them is what matters.
#
# Usage:
#   ./scripts/build-standalone.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/ozikoro"
STANDALONE="$APP/.next/standalone"
TARGET="$STANDALONE/apps/ozikoro"

cd "$ROOT"

echo "==> Building"
npm -w @ozikoro/site run build

if [ ! -d "$STANDALONE" ]; then
  echo "FAIL: $STANDALONE does not exist. Is output:'standalone' still set in next.config.ts?" >&2
  exit 1
fi

echo "==> Copying the static assets Next does not include"
mkdir -p "$TARGET/.next"
rm -rf "$TARGET/public" "$TARGET/.next/static"
cp -r "$APP/public" "$TARGET/public"
cp -r "$APP/.next/static" "$TARGET/.next/static"

# Assert on the filesystem, not on the exit status of cp. A copy that silently did nothing is exactly
# the failure this script was written to prevent.
fail=0
check() {
  if [ -e "$2" ]; then
    echo "    ok    $1"
  else
    echo "    FAIL  $1 -> $2" >&2
    fail=1
  fi
}

echo "==> Verifying the artefact"
check "server entrypoint"      "$TARGET/server.js"
check "public/ directory"      "$TARGET/public"
check "the design stylesheets" "$TARGET/public/design/styles/main.css"
check "the accessibility CSS"  "$TARGET/public/a11y.css"
check "static chunks"          "$TARGET/.next/static"

# A directory existing is not the same as it having contents, which is how an empty copy passes a
# naive check.
chunks=$(find "$TARGET/.next/static" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "    static files copied: $chunks"
[ "$chunks" -gt 0 ] || { echo "    FAIL  .next/static is empty" >&2; fail=1; }

[ "$fail" -eq 0 ] || { echo "" >&2; echo "Build artefact is INCOMPLETE — do not deploy." >&2; exit 1; }

cat <<'EOF'

==> The artefact is complete.

Run it with:

    OZITUMA_DB_PATH=<repo>/.data/pg PORT=3100 \
      node apps/ozikoro/.next/standalone/apps/ozikoro/server.js

For a real deployment these must also be set, and the application will not work correctly without
the first two:

    DATABASE_URL      a server Postgres. Unset means PGlite, which would create an EMPTY cluster
                      and serve empty pages without erroring.
    S3_BUCKET         object storage for media. Unset means the local filesystem, which is ephemeral
                      on a container platform: a redeploy 404s every image.
    HEALTH_TOKEN      enables the detailed branch of /api/health.
    OZITUMA_SITE_URL  absolute URLs in the sitemap and structured data.
EOF
