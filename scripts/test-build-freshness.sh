#!/usr/bin/env bash
#
# Does the freshness check notice a source file that was edited WHILE the build was running?
#
# WHY THIS EXISTS
#
# The check was `find <sources> -newer "$BUILD_ID"`, and `BUILD_ID` is touched at the END of a build. **A
# source edited during the build is therefore older than the reference and the check calls the tree
# current** — the artefact keeps the code from before the edit, and no run ever says otherwise. Measured in
# this checkout: a fix at 14:33:30, `BUILD_ID` touched at 14:35:26, and the site still serving the old code
# at 14:41 while two runs reported *"the build is CURRENT"*.
#
# A rule about timestamps cannot be proved by reading it. This drives it over a scratch tree with times it
# chooses, so the mid-build case is a case rather than a hope — and **the third case below fails against
# the check as it was**, which is what makes this a regression test rather than an assertion.
#
# Run: bash scripts/test-build-freshness.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/next-build-freshness.sh
. "$ROOT/scripts/lib/next-build-freshness.sh"

PASS=0
FAIL=0

# A scratch checkout: the two trees the check scans, and the two plumbing files it reads.
#
# `ROOT` is repointed at the scratch tree AS WELL AS `APP`, because the check scans `packages/*/src` as well
# and a scratch that borrowed the real root would be judged against this repository's own files — which is
# the first thing this test caught about itself.
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/ozikoro-freshness-XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT
APP="$SCRATCH/apps/ozikoro"
mkdir -p "$APP/app" "$SCRATCH/packages/ozikoro/src" "$SCRATCH/packages/db/src" "$SCRATCH/packages/core/src"
ROOT="$SCRATCH"
BUILD_ID="$APP/.next/BUILD_ID"
BUILD_STARTED="$(next_build_started_marker)"
mkdir -p "$APP/.next"
REBUILD=0

# Fixed times, so the ordering is stated rather than raced. `touch -t` takes [[CC]YY]MMDDhhmm[.SS].
OLDER=202001010000.05      # a source the build certainly read
MIDBUILD=202001010000.15   # a source edited between the build's start and its end
AFTER=202001010000.25      # a source edited after the build finished
STARTED=202001010000.10    # the build began here
FINISHED=202001010000.20   # BUILD_ID was touched here

SOURCE="$APP/app/page.tsx"
PACKAGE_SOURCE="$SCRATCH/packages/ozikoro/src/thing.ts"

reset_tree() {
  rm -f "$SOURCE" "$PACKAGE_SOURCE" "$BUILD_ID" "$BUILD_STARTED"
  printf 'export default function Page() { return null }\n' > "$SOURCE"
  printf 'export const thing = 1\n' > "$PACKAGE_SOURCE"
}

# A build that ran to completion: the marker says when it started, BUILD_ID when it ended.
complete_build() {
  touch -t "$STARTED" "$BUILD_STARTED"
  touch -t "$FINISHED" "$BUILD_ID"
}

check() {
  local name="$1" want="$2"
  next_build_check
  local got="current"
  [ -n "$NEXT_BUILD_STALE" ] && got="stale"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS + 1))
    printf '  ok    %-58s %s\n' "$name" "$got"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  %-58s wanted %s, got %s\n' "$name" "$want" "$got"
    printf '        %s\n' "$NEXT_BUILD_REASON"
  fi
}

echo "freshness check:"

# 1. Everything the build read is older than the build's start. The ordinary case, and it must STAY
#    current — a check that always rebuilds is the fault this check was written to remove. The start marker
#    is present in this case, which is also what proves the marker is not counted as a source: it is the
#    reference, and a file cannot be newer than itself.
reset_tree
complete_build
touch -t "$OLDER" "$SOURCE" "$PACKAGE_SOURCE"
check "a source older than the build's start" current

# 2. THE REGRESSION. The source was edited after the build began and before BUILD_ID was written, so the
#    artefact on disk may not contain it. The old rule compared against BUILD_ID and said CURRENT.
#
#    The old rule is run here as well as the new one, and the case asserts that the two DISAGREE. That is
#    what makes this a regression test: revert the fix and this case fails, and the old verdict printed
#    beside it is the evidence for why the fix exists rather than an argument in a comment.
reset_tree
complete_build
touch -t "$MIDBUILD" "$SOURCE"
old_verdict="current"
[ -n "$(find "$APP" -type f -newer "$BUILD_ID" -print -quit 2>/dev/null || true)" ] && old_verdict="stale"
printf '  note  the rule as it was (compare against BUILD_ID) would say: %s\n' "$old_verdict"
if [ "$old_verdict" != "current" ]; then
  FAIL=$((FAIL + 1))
  printf '  FAIL  %-58s the old rule no longer misses this case, so this test proves nothing\n' "the mid-build case"
fi
check "a source edited WHILE the build was running" stale

# 3. The same, in a package the build reads rather than in the app.
reset_tree
complete_build
touch -t "$MIDBUILD" "$PACKAGE_SOURCE"
check "a package source edited WHILE the build was running" stale

# 4. Edited after the build finished. The old rule caught this one, and it must keep being caught.
reset_tree
complete_build
touch -t "$AFTER" "$SOURCE"
check "a source edited after the build finished" stale

# 5. An artefact from before this change has no marker: the reference falls back to BUILD_ID.
reset_tree
touch -t "$FINISHED" "$BUILD_ID"
touch -t "$OLDER" "$SOURCE" "$PACKAGE_SOURCE"
check "no marker at all, everything older than BUILD_ID" current
touch -t "$AFTER" "$SOURCE"
check "no marker at all, a source newer than BUILD_ID" stale

# 6. A build that started and failed leaves a marker NEWER than the artefact. The artefact is from the last
#    successful build and cannot be trusted to contain what provoked the failure.
reset_tree
touch -t "$FINISHED" "$BUILD_ID"
touch -t "$AFTER" "$BUILD_STARTED"
touch -t "$OLDER" "$SOURCE"
check "a marker newer than BUILD_ID (a build that did not finish)" stale

# 7. No build at all.
reset_tree
rm -f "$BUILD_ID"
check "no BUILD_ID" stale

# 8. --rebuild is honoured whatever the times say.
reset_tree
complete_build
touch -t "$OLDER" "$SOURCE"
REBUILD=1
check "--rebuild was passed" stale
REBUILD=0

echo
if [ "$FAIL" -gt 0 ]; then
  echo "  ${FAIL} of $((PASS + FAIL)) case(s) FAILED — the freshness check is not trustworthy."
  exit 1
fi
echo "  all ${PASS} cases pass"
