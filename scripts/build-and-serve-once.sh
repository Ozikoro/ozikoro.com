#!/usr/bin/env bash
#
# build-and-serve-once.sh — build the site into `.next`, serve the standalone output on 3110, and stop.
#
# WHY THIS IS A SCRIPT AND NOT A SEQUENCE OF TOOL CALLS
#
# Two agents are working in this checkout at the same time and both run `next build`. **`next build`
# writes into `apps/ozikoro/.next`, and two of them at once corrupt each other's output** — measured
# here: `ENOENT: no such file or directory, rename '.next/export/500.html'`, then
# `Cannot find module '…/.next/server/middleware-manifest.json'`, then a standalone directory with no
# `server.js` in it at all. Each failure reads like a code fault and none of them is one.
#
# So the whole sequence runs with no tool call in the middle:
#
#   1. wait until no other `next build` is running;
#   2. stop anything on 3110 with SIGTERM — never SIGKILL, because a SIGKILL during a PGlite boot has
#      destroyed this cluster twice;
#   3. build;
#   4. copy `public/` and `.next/static` beside the standalone output, exactly as the Dockerfile does,
#      and PROVE the stylesheets arrived rather than assuming they did;
#   5. start the server detached with `nohup` — `setsid` does not exist on this macOS machine and a
#      background process group dies when the tool call ends;
#   6. refuse to report success unless the server answers.
#
# USAGE
#   bash scripts/build-and-serve-once.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3110}"
SD="$ROOT/apps/ozikoro/.next/standalone"
LOG="/tmp/ozikoro-review-$PORT.log"

cd "$ROOT"

echo "==> waiting for any other build to finish"
for _ in $(seq 1 180); do
  pgrep -f "next build" > /dev/null 2>&1 || break
  sleep 5
done
if pgrep -f "next build" > /dev/null 2>&1; then
  echo "  another build is still running after 15 minutes; not starting a second one" >&2
  exit 1
fi
echo "  clear"

echo "==> stopping anything on port $PORT (SIGTERM only)"
PIDS="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  # shellcheck disable=SC2086
  kill -TERM $PIDS 2>/dev/null || true
  for _ in $(seq 1 20); do
    [ -z "$(lsof -ti "tcp:$PORT" 2>/dev/null || true)" ] && break
    sleep 1
  done
  if [ -n "$(lsof -ti "tcp:$PORT" 2>/dev/null || true)" ]; then
    echo "  a process on $PORT did not answer SIGTERM. Not forcing it: a SIGKILL while PGlite holds" >&2
    echo "  its cluster corrupts the database. Stop it yourself if you are sure." >&2
    exit 1
  fi
fi
rm -f "$ROOT/.data/pg/postmaster.pid"

echo "==> building"
rm -rf "$ROOT/apps/ozikoro/.next"
NODE_ENV=production npm -w @ozikoro/site run build || { echo "  the build failed; see /tmp/dsh-build.log" >&2; exit 1; }

echo "==> copying what standalone omits, exactly as the Dockerfile does"
mkdir -p "$SD/apps/ozikoro" "$SD/apps/ozikoro/.next"
rm -rf "$SD/apps/ozikoro/public" "$SD/apps/ozikoro/.next/static"
cp -R "$ROOT/apps/ozikoro/public" "$SD/apps/ozikoro/public"
cp -R "$ROOT/apps/ozikoro/.next/static" "$SD/apps/ozikoro/.next/static"

for asset in "$SD/apps/ozikoro/server.js" \
             "$SD/apps/ozikoro/public/design/styles/main.css" \
             "$SD/apps/ozikoro/.next/static"; do
  if [ ! -e "$asset" ]; then
    echo "  the build did not produce $asset — refusing to serve an incomplete output" >&2
    exit 1
  fi
done

echo "==> serving on http://127.0.0.1:$PORT"
(
  cd "$SD"
  PORT="$PORT" HOSTNAME=0.0.0.0 OZITUMA_DB_PATH="$ROOT/.data/pg" \
    nohup node apps/ozikoro/server.js > "$LOG" 2>&1 &
)

for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    echo "  READY  ->  http://127.0.0.1:$PORT"
    echo "             log: $LOG"
    exit 0
  fi
  sleep 2
done

echo "  the server did not answer within 80s; see $LOG" >&2
exit 1
