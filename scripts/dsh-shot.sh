#!/usr/bin/env bash
# Round 342 verification helper: screenshot a served page through real Chrome.
#
#   bash scripts/dsh-shot.sh <url> <out.png> [width] [height]
#
# WHY OLD `--headless` AND NOT `--headless=new`: measured on this machine, `--headless=new` starts, loads
# the page and never writes the screenshot — with and without `--virtual-time-budget`. The older `--headless`
# writes it. `--disable-crash-reporter`/`--disable-breakpad` are here because the sandbox denies Chrome's
# own crash directory and it otherwise spends the run retrying.
set -u
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL="$1"; OUT="$2"; W="${3:-1440}"; H="${4:-1500}"
PROFILE="$(mktemp -d /tmp/dsh-shot-XXXXXX)"

"$CHROME" --headless --disable-gpu --no-sandbox --no-first-run \
  --disable-crash-reporter --disable-breakpad --hide-scrollbars \
  --user-data-dir="$PROFILE" \
  --window-size="$W,$H" --screenshot="$OUT" "$URL" >/tmp/dsh-shot.log 2>&1 &
PID=$!

for _ in $(seq 1 20); do
  sleep 4
  [ -s "$OUT" ] && break
  kill -0 "$PID" 2>/dev/null || break
done

kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
rm -rf "$PROFILE"

if [ -s "$OUT" ]; then
  echo "wrote $OUT ($(wc -c <"$OUT" | tr -d ' ') bytes)"
else
  echo "NO SCREENSHOT: $OUT"
  grep -iv 'cv_display\|allocator\|ssl_client\|crashpad\|keychain\|trust_store' /tmp/dsh-shot.log | tail -6
  exit 1
fi
