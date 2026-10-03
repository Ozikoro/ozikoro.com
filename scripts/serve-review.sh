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
#
# A `kill -9` HERE DESTROYED THE DATABASE TWICE, SO IT IS NO LONGER DONE.
#
# This line used to be `lsof -ti tcp:$PORT | xargs -r kill -9`. **PGlite is a WASM Postgres in the same process
# as the server, and it writes WAL while it opens its cluster.** A SIGKILL that lands during that window leaves
# `pg_control` pointing at a WAL segment that no longer exists, and the cluster is then unopenable:
#
#     PANIC: could not locate a valid checkpoint record
#
# That happened twice in one day — once when a server was racing a CLI script, and once when this script killed
# a server that was still booting. Each time the remedy was to discard the cluster and restore a backup.
#
# So: ask first, wait, and **never SIGKILL a process that holds the cluster.** A process that will not leave is
# reported rather than shot, because a stubborn process is a solvable problem and a corrupt database is not.
DATA_DIR="$ROOT/.data/pg"
PIDS="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  HOLDING=""
  for pid in $PIDS; do
    if lsof -p "$pid" 2>/dev/null | grep -q "$DATA_DIR"; then HOLDING="$HOLDING $pid"; fi
  done

  # SIGTERM, which a Node server handles by closing the database and exiting.
  # shellcheck disable=SC2086
  kill $PIDS 2>/dev/null || true
  for _ in $(seq 1 20); do
    sleep 1
    [ -z "$(lsof -ti "tcp:$PORT" 2>/dev/null || true)" ] && break
  done

  if [ -n "$(lsof -ti "tcp:$PORT" 2>/dev/null || true)" ]; then
    if [ -n "$HOLDING" ]; then
      echo "  REFUSING TO FORCE: PID(s)$HOLDING still hold $DATA_DIR and port $PORT." >&2
      echo "  A SIGKILL while PGlite holds its cluster corrupts it, and the cluster has had to be restored twice." >&2
      echo "  Stop it yourself if you are sure:  kill -9$HOLDING" >&2
      exit 1
    fi
    echo "  a process on port $PORT did not answer SIGTERM and does not hold the cluster; forcing it"
    # shellcheck disable=SC2086
    kill -9 $PIDS 2>/dev/null || true
    sleep 2
  fi
fi
sleep 1

# A PGlite cluster that was not shut down cleanly leaves this behind and the next open refuses.
rm -f "$ROOT/.data/pg/postmaster.pid"

echo "==> building (standalone output)"
NODE_ENV=production npm -w @ozikoro/site run build

echo "==> copying what standalone output omits, exactly as the Dockerfile does"
# BOTH PARENTS MUST EXIST, and the first version of this script only created the second.
#
# `verify-all` rebuilds, which deletes the whole standalone directory. Running this afterwards then failed at
# the first copy — the parent `$SD/apps/ozikoro` did not exist — and with `set -e` the script exited before
# starting a server. **The visible symptom was different and worse than a crash**: a stale server kept
# answering on the port with a build whose stylesheets were gone, so every page rendered as unstyled HTML.
# That is what "scattered" means, and it is why both mkdirs are here.
mkdir -p "$SD/apps/ozikoro" "$SD/apps/ozikoro/.next"
# REMOVE THE DESTINATION FIRST. `cp -R src dst` with `dst` already present copies src INTO dst, so a second
# run produced `public/public/` and left `/design/styles/main.css` missing — which the guard below now catches
# rather than starting a server that renders unstyled.
rm -rf "$SD/apps/ozikoro/public" "$SD/apps/ozikoro/.next/static"
cp -R "$ROOT/apps/ozikoro/public" "$SD/apps/ozikoro/public"
cp -R "$ROOT/apps/ozikoro/.next/static" "$SD/apps/ozikoro/.next/static"

# Prove the copy happened rather than assuming it. The stylesheets are the thing whose absence is invisible
# from the server's own logs and obvious to a reader.
for asset in "$SD/apps/ozikoro/public/design/styles/main.css" "$SD/apps/ozikoro/.next/static"; do
  if [ ! -e "$asset" ]; then
    echo "  the copy did not produce $asset — refusing to start a server that would render unstyled" >&2
    exit 1
  fi
done

echo "==> serving on http://127.0.0.1:$PORT"
(
  cd "$SD"
  # OZITUMA_SITE_URL is what decides whether the session cookie carries Secure: the shared helper
  # derives it from this URL and falls back to NODE_ENV when it is unset. A standalone build runs
  # with NODE_ENV=production, so leaving this unset makes `secure = true`, and a browser silently
  # DISCARDS a Secure cookie received over http:// — sign-in returns 303, appears to work, and the
  # masthead still reads "Sign in / Sign up" on the next page. Setting the real origin makes the
  # helper set secure = false, which is correct for a plain-HTTP review server.
  PORT="$PORT" HOSTNAME=0.0.0.0 OZITUMA_DB_PATH="$ROOT/.data/pg" \
    OZITUMA_SITE_URL="http://127.0.0.1:$PORT" \
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
