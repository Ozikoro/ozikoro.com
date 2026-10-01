#!/usr/bin/env bash
#
# The three checks that need a RUNNING server.
#
# WHY THIS IS SEPARATE FROM verify-all.sh
#
# `verify-all.sh` runs against a STOPPED server, because the test suites take the PGlite lock and the
# database is single-process — a dev server holding it makes every suite fail with a mutex timeout rather
# than a real error.
#
# The three checks below cannot run that way: they are about what the running site actually serves, so
# they need it up. Round 89 recorded the grouping; this is it.
#
#   verify-all.sh    stopped server, 19 steps    typecheck, suites, residue, capabilities, body links
#   verify-live.sh   running server,  3 checks   links a reader can click, pages a crawler is told
#                                                about, and assets a page needs to render
#
# It does NOT start or stop a server. Starting one from inside a checker means the checker owns a process
# and a database lock, and killing that wrongly is what corrupted the cluster once. Point it at a server
# you started.
#
# Usage:
#   npm -w @ozikoro/site run dev &          # or a standalone build
#   ./scripts/verify-live.sh [BASE_URL]
set -uo pipefail

BASE="${1:-http://127.0.0.1:3100}"

echo ""
echo "  Live checks against $BASE"

if ! curl -s -o /dev/null --max-time 10 "$BASE/"; then
  echo "  $BASE is not responding. Start a server first — this runner deliberately does not." >&2
  echo "  (and never 'pkill -9 -f node': kill by port, or you take the media download with it)" >&2
  exit 2
fi

failed=0

run_check() {
  local label="$1"; shift
  local out
  out=$(mktemp)
  # Output to a file and the status read from the command itself — NEVER through a pipe. Three rounds
  # have discarded a checker's verdict that way (31, 70, 86).
  if "$@" > "$out" 2>&1; then
    printf '  PASS  %s\n' "$label"
  else
    printf '  FAIL  %s\n' "$label"
    sed 's/^/          /' "$out" | tail -20
    failed=$((failed + 1))
  fi
  rm -f "$out"
}

run_check "links a reader can click"   bash scripts/check-links.sh   "$BASE" 120
run_check "pages a crawler is told of" bash scripts/check-sitemap.sh "$BASE" 300
run_check "assets a page must load"    bash scripts/check-assets.sh  "$BASE" 10
run_check "the 404 a reader lands on" bash scripts/check-not-found.sh "$BASE"

echo ""
if [ "$failed" -eq 0 ]; then
  echo "  All live checks passed."
else
  echo "  $failed live check(s) FAILED."
fi
echo ""
exit $((failed > 0))
