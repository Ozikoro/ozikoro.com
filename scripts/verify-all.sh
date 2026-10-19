#!/usr/bin/env bash
#
# Everything, in one command.
#
# WHY THIS EXISTS
#
# Every round of this work has ended by running the same ten suites by hand, from memory, in a
# particular order. That is slow, it is easy to skip one, and a suite that is not run is a suite that
# does not exist. CI runs the database-free half (`.github/workflows/ci.yml`); this runs ALL of it,
# including the suites that assert against the real imported archive.
#
# It is also the thing CI would call once the import chain can run there. See the note at the end of
# `docs/OZIKORO-REMAINING.md` for why it cannot yet: the integration suites assert real numbers from
# the archive, and CI would need either 72 MB of extracted JSON committed, live access to the
# WordPress site being replaced, or a seeded fixture.
#
# It does NOT import. The archive, dictionary and research data are assumed present — use
# `npm run db:migrate` and the `import:*` scripts for that. This only verifies.
#
# Usage:
#   ./scripts/verify-all.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# A dev server holds the PGlite lock and every suite would fail with a mutex timeout that looks
# nothing like its cause.
if lsof -ti tcp:3100 >/dev/null 2>&1; then
  echo "FAIL: something is listening on 3100. Stop the dev server first — it holds the database lock," >&2
  echo "      and the suites will fail with a mutex timeout rather than a real error." >&2
  exit 1
fi

failures=0
report() {
  local name="$1" status="$2"
  if [ "$status" -eq 0 ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$name"
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$name"
    failures=$((failures + 1))
  fi
}

run() {
  local name="$1"; shift
  local out
  out=$("$@" 2>&1)
  report "$name" $?
  if [ "${VERBOSE:-0}" = "1" ]; then echo "$out" | sed 's/^/        /'; fi
}

echo ""
echo "  Database hygiene"
# No credential is committed. Answered by hand once and answered correctly — which is not the same as
# being guarded. A single `git add -A` after a local experiment puts a .env in the history.
# The resume block's countable claims, re-derived from the system. verify-all checks twenty things about
# the code and nothing about the block it exists to keep honest; round 174 counted eight corrections to
# that block, seven of them made in a LATER round than the change they described.
# Rounds 196, 201 and 202: a Suspense boundary above a page that decides its own 404 defers the status
# and turns a 404 into a 200. The rule was broken twice, so it is a program now.
run "loading boundaries sit where the router resolves" npm run check:boundaries
run "the handover still matches" npm run check:handover
run "no committed credentials" npm run check:secrets
run "no test residue" npm run check:residue
run "every capability is granted" npm run check:capabilities
# The archive renders the design's own CSS, not a generator's scaffold. Installing Tailwind and
# importing src/styles.css would silently swap the institution palette for a generic slate.
run "the approved design is the one rendered" npm run check:design
# The database and the application must agree on what a capability set is, for every role.
run "capabilities agree with the database" npm run check:capability-fn
# Links written inside article prose. Different in kind from the other two link checks: these were typed
# by the original authors against a site that no longer exists, and no walk reaches them unless it opens
# the article containing them. Round 74 found 40 dead targets this way. Three are waived in the tool, and
# the waiver prints on every run rather than being silent.
run "links inside article bodies" npm run check:body-links

echo ""
echo "  Typecheck"
run "typecheck" npm run typecheck

echo ""
echo "  Database-free suites"
run "unit (sanitiser)" npm -w @ozikoro/platform run test
run "redirects and same-origin" npm -w @ozikoro/platform run test:redirects
run "application" npm -w @ozikoro/site run test

echo ""
echo "  Suites that need the imported archive"
run "archive" npm -w @ozikoro/platform run test:archive
run "members and roles" npm -w @ozikoro/platform run test:members
run "editorial" npm -w @ozikoro/platform run test:editorial
run "publications" npm -w @ozikoro/platform run test:publications
run "rights" npm -w @ozikoro/platform run test:rights
run "search" npm -w @ozikoro/platform run test:search
run "spotify connection" npm -w @ozikoro/platform run test:connection

echo ""
echo "  The served pages, held to the design"
#
# ⚠️ WHY `check:design-parity` IS HERE AND NOT IN CI, AND WHY THAT IS A MEASUREMENT RATHER THAN A PREFERENCE.
#
# It was found failing on three routes — `/documents`, `/clan-towns` and `/about` — and NOTHING RAN IT, which
# is how it went on failing unseen. The obvious fix is to put it in `.github/workflows/ci.yml`. **That fix
# does not work, and this was driven rather than reasoned about.**
#
# The check fetches the RENDERED pages and compares their structure and headings with the design screens. The
# pages hold the archive's real data, so they are only structurally complete when the archive is imported:
# `renderDocument` draws `.sx-document-actions` only on a real document card, and `/listen` and `/clan-towns`
# render their sections from published rows. Measured in a scratch standalone against a freshly migrated,
# EMPTY cluster on 2026-10-15 — which is exactly what a CI runner has:
#
#     /documents    FAIL       the real document cards, and so `.sx-document-actions`, are absent
#     /listen       FAIL       no episode is deposited
#     /clan-towns   HTTP 500   the register query has no rows to page
#     /submit       HTTP 500
#     5 ROUTE(S) DO NOT MATCH THEIR DESIGN
#
# **So a CI job running this fails on every commit for a reason that is not the commit**, which is the fault
# this repository keeps recording: a check that is red for the weather gets ignored, and then it is not a
# check. Making it pass there would need the imported corpus (447 MB of `data/ozikoro-wp/` plus the media
# store) committed or a seeded fixture — the same three options, and the same absence of a fixture, that
# `ci.yml` already records for the integration suites. That option belongs to the owner, and is named in the
# comment added to `ci.yml` so the next reader does not re-litigate it.
#
# The condition is IMPOSSIBLE TO ACCIDENTALLY SKIP, which is the property the CI job would have bought. The
# probe below refuses to run the check against a server that is not on 3110, and refuses to pass when it is
# not, so a run of `verify:all` on a machine without the review server is a FAILURE that names the command —
# never a silent green. What it does not buy is a run on every push, and that is stated rather than implied.
if ! curl -s -o /dev/null --max-time 5 "http://127.0.0.1:3110/" 2>/dev/null; then
  printf '  \033[31mFAIL\033[0m  the served pages are held to the design\n'
  printf '        nothing is answering on http://127.0.0.1:3110, so the parity check cannot run.\n'
  printf '        Start it first — it is the only way to serve this checkout:\n\n'
  printf '            bash scripts/serve-review.sh\n\n'
  failures=$((failures + 1))
else
  run "the served pages are held to the design" npm run check:design-parity
fi

echo ""
echo "  Shared suites (the dictionary and the other two sites)"
for suite in test test:admin test:accounts test:contributions test:donations; do
  run "$suite" npm run "$suite"
done

echo ""
if [ "$failures" -eq 0 ]; then
  echo "  All suites passed."
else
  echo "  $failures suite(s) FAILED."
fi
echo ""
exit $((failures > 0))
