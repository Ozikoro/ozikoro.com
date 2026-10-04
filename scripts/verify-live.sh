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
# ── THE OWNER'S SECOND INSTRUCTION: "scan every link when you deploy the website" ─────────────────────
#
# THE THREE INSTRUMENTS THAT SEE WHAT A STATUS CANNOT, AND THEY ARE ALREADY IN THE REPOSITORY. A 200 is not
# evidence: a `btn` led to a `text/plain` file, a link discarded its own `?v=` and showed another record, and
# a tile named six towns and opened one address — all three answered 200. Each of those has its own check,
# and the gap this closes is not a fourth check but the fact that none of them was in the sequence a person
# runs before a deploy.
#
# The modes are chosen so the gate is minutes rather than tens of minutes, and each is stated with the time
# it was measured at (2026-10-04, on this machine, against a running review server):
#
#   check-link-destinations.mjs              status AND content-type for every control on the listen and
#                                            film pages, cross-origin addresses included — 4m47s, most of
#                                            it YouTube's latency
#   check-page-variants.mjs --no-articles     the bare/parameterised families, every fragment against the page
#     --crawl 40                              that must own it, the identity rule and a 40-page link crawl
#                                            — 1m18s
#   verify-round-344.mjs --sample 24 --gate   the broad sweep: the front page's own navigation and everything
#                                            one step behind it — 124s measured (21 pages, 1,768 references,
#                                            457 addresses). `--full` is the release sweep and takes ten to
#                                            twelve minutes; it is not run here.
run_check "a control lands where it promises"  node scripts/check-link-destinations.mjs
run_check "bare and parameterised agree"       node scripts/check-page-variants.mjs --no-articles --crawl 40
run_check "every link on the sampled sweep"    node scripts/verify-round-344.mjs "$BASE" --sample 24 --gate
run_check "pages a crawler is told of" bash scripts/check-sitemap.sh "$BASE" 300
run_check "assets a page must load"    bash scripts/check-assets.sh  "$BASE" 10
run_check "the 404 a reader lands on" bash scripts/check-not-found.sh "$BASE"
run_check "the auth boundary"       bash scripts/check-auth-boundary.sh "$BASE"
# The design screens against the pages that should be rendering them. It belongs here rather than in
# verify-all because it fetches the running site, and because a page that is the right shape for the
# wrong reason is only visible once something is serving it.
run_check "pages match their design" node scripts/check-design-parity.mjs "$BASE" 300
# The assistant must answer what the archive holds and refuse what it does not. The brief puts no AI
# answer above primary evidence, and the mechanical form of that is: an ungroundable question returns
# no passages at all.
run_check "the archive refuses what it cannot ground" bash scripts/check-grounding.sh "$BASE" 180

echo ""
if [ "$failed" -eq 0 ]; then
  echo "  All live checks passed."
else
  echo "  $failed live check(s) FAILED."
fi
echo ""
exit $((failed > 0))
