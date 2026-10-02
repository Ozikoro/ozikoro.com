#!/usr/bin/env bash
#
# serve-review.sh — build the archive and serve it for review, in that order and no other.
#
# WHY THIS SCRIPT EXISTS
#
# `apps/ozikoro/next.config.ts` sets `output: 'standalone'`, which changes two things that are easy to get
# wrong and were both got wrong during the build:
#
#   1. `next start` REFUSES to run. It prints "next start does not work with output: standalone
#      configuration. Use node .next/standalone/server.js instead." So the server is started by running
#      the standalone entry point directly — which is also what the Docker image's CMD does.
#
#   2. `public/` and `.next/static` are NOT included in the standalone output. They have to be copied
#      beside it, which is exactly what the two COPY lines in docker/Dockerfile do. Without them every
#      page renders as unstyled HTML and requests for /design/* return 400 — a failure that looks like a
#      broken design rather than a missing copy.
#
# And a third, discovered the hard way: **`scripts/verify-all.sh` rebuilds, which destroys the standalone
# directory.** Running it after a build means the server will not start at all, because
# `apps/ozikoro/server.js` no longer exists. So the order is: verify-all FIRST, then this script.
#
# WHY HOSTNAME=0.0.0.0 AND NOT A LOOPBACK ADDRESS
#
# Setting HOSTNAME=127.0.0.1 makes the server bind IPv4 only, while `localhost` resolves to ::1 first — so
# Next's own internal proxying fails with ECONNRESET and every route except the index returns 500. The
# Dockerfile sets 0.0.0.0 for this reason; this script matches it.
#
# USAGE
#   bash scripts/serve-review.sh            # port 3110
#   PORT=4000 bash scripts/serve-review.sh  # another port
set -euo pipefail

PORT="${PORT:-3110}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SD="$ROOT/apps/ozikoro/.next/standalone"

cd "$ROOT"

echo "==> stopping anything on port $PORT"
lsof -ti "tcp:$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 1

# A PGlite cluster that was not shut down cleanly leaves this behind and the next open refuses.
rm -f "$ROOT/.data/pg/postmaster.pid"

echo "==> building (standalone output)"
NODE_ENV=production npm -w @ozikoro/site run build

echo "==> copying what standalone output omits, exactly as the Dockerfile does"
cp -R "$ROOT/apps/ozikoro/public" "$SD/apps/ozikoro/public"
mkdir -p "$SD/apps/ozikoro/.next"
cp -R "$ROOT/apps/ozikoro/.next/static" "$SD/apps/ozikoro/.next/static"

echo "==> serving on http://127.0.0.1:$PORT"
(
  cd "$SD"
  PORT="$PORT" HOSTNAME=0.0.0.0 OZITUMA_DB_PATH="$ROOT/.data/pg" \
    node apps/ozikoro/server.js > /tmp/ozikoro-review-$PORT.log 2>&1 &
)

for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    echo
    echo "  READY  ->  http://127.0.0.1:$PORT"
    echo "             log: /tmp/ozikoro-review-$PORT.log"
    exit 0
  fi
  sleep 2
done

echo "  the server did not answer within 80s; see /tmp/ozikoro-review-$PORT.log" >&2
exit 1
