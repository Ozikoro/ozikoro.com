#!/usr/bin/env bash
#
# Is the build on disk older than the source it was made from?
#
# WHY THIS IS A LIBRARY AND NOT FOURTEEN LINES INSIDE `serve-review.sh`
#
# The check is the only thing standing between the review site and serving last hour's code, and it was
# wrong in a way that no run could reveal: **a source file edited WHILE a build was running was never
# rebuilt afterwards.** It is a rule about timestamps, and a rule about timestamps cannot be proved by
# reading it — it has to be exercised with timestamps. So the rule lives here, where
# `scripts/test-build-freshness.sh` can drive it over a scratch tree with times it chooses, rather than
# inside a 500-line script that can only be exercised by running a real 90-second build and hoping.
#
# ── THE FAULT, AND WHY IT WAS INVISIBLE ──────────────────────────────────────────────────────────────
#
# The check was `find <sources> -newer "$BUILD_ID"`. **`BUILD_ID` is touched at the END of the run** — the
# swap step does it, deliberately, so that the reference is later than every source the build read. That
# makes it correct for every source edited AFTER the build and blind to every source edited DURING it:
#
#     build starts at T0 and reads sources
#     a source is edited at T1, T0 < T1
#     the build finishes and `BUILD_ID` is touched at T2, T1 < T2
#     every later check: "is any source newer than T2?" — no. **"The build is CURRENT."**
#
# The artefact contains the code as it was at T0, and no run will ever say otherwise. Measured in this
# checkout: a refusal sentence was fixed at 14:33:30, the build touched `BUILD_ID` at 14:35:26, and at
# 14:41 the site still answered the old sentence while two runs reported *"the build is CURRENT"*. **The
# check reported success about something it had not looked at**, which is the same shape as the two faults
# this round sat beside — a relative `?page=2` that `curl` cannot see, and a `Secure` cookie the browser
# silently refuses.
#
# ── THE FIX: COMPARE AGAINST WHEN THE BUILD STARTED ──────────────────────────────────────────────────
#
# `serve-review.sh` touches `$BUILD_STARTED` immediately before it invokes `next build`, and the reference
# becomes that marker. Anything modified at or after the build began MAY be missing from the artefact, so
# it is treated as missing — the script's own rule, *"when in doubt it builds: a false rebuild costs 90
# seconds, a false skip serves the wrong site, and only one of those is recoverable by running the command
# again."*
#
# The marker must outlive the swap, so it sits BESIDE `.next` rather than inside it: `rm -rf .next` in the
# swap would take a marker inside it away with the very build it describes. **It needs no exclusion from the
# source scan**, because the scan's reference IS this file and the comparison is strict (`-newer` is true
# only for a file strictly later than the reference): a file cannot be newer than itself, so the marker can
# never be the source that forces a rebuild. That is a property of the construction rather than a rule to
# remember, and `scripts/test-build-freshness.sh` exercises the ordinary case with the marker present.
#
# ── TWO EDGE CASES THAT MATTER ───────────────────────────────────────────────────────────────────────
#
# 1. **A marker NEWER than `BUILD_ID` means a build started and did not finish** — a failed build, or one
#    running now. `BUILD_ID` is touched only after the artefact has been asserted complete, so the artefact
#    on disk is from an older, successful build and cannot be trusted to contain the sources that provoked
#    the failed one. Reported as stale, which forces the rebuild that resolves it. *A naive reading of "the
#    marker is the reference" would use the failed build's start and call the tree current.*
# 2. **No marker at all** — an artefact built before this change. The reference falls back to `BUILD_ID`,
#    which is the old behaviour: correct for everything except the mid-build case, and no worse than what
#    it replaced. The first run after this change writes a marker and the stronger rule takes over.
#
# ── WHAT IS NOT COMPARED ─────────────────────────────────────────────────────────────────────────────
#
# `public/` is not compared: `serve-review.sh` copies it beside the standalone at serve time, so a change
# under it is served without a rebuild. `*.tsbuildinfo` is not compared, for a measured reason — the
# pre-commit hook's `npm run typecheck` rewrites `apps/ozikoro/tsconfig.tsbuildinfo` on every commit, so
# counting it made the build look stale after every commit and the "restart only" path was almost never
# taken, which is the fault the check exists to remove.
#
# The variables this reads are the caller's: `REBUILD`, `BUILD_ID`, `BUILD_STARTED`, `APP`, `ROOT`. It sets
# `NEXT_BUILD_STALE` to the file that forced the rebuild (empty when the build is current) and
# `NEXT_BUILD_REASON` to a sentence for the operator, because "it rebuilt" and "it did not" are both things
# the next agent needs to be able to read afterwards.

# The marker `serve-review.sh` touches before it builds, and this check compares against.
next_build_started_marker() {
  printf '%s' "$APP/.next.build-started"
}

next_build_check() {
  NEXT_BUILD_STALE=""
  NEXT_BUILD_REASON=""

  if [ "$REBUILD" -eq 1 ]; then
    NEXT_BUILD_REASON="--rebuild was passed"
    NEXT_BUILD_STALE="(forced)"
    return 0
  fi

  if [ ! -f "$BUILD_ID" ]; then
    NEXT_BUILD_REASON="there is no $BUILD_ID"
    NEXT_BUILD_STALE="(no build)"
    return 0
  fi

  local reference="$BUILD_ID"
  if [ -f "$BUILD_STARTED" ]; then
    if [ "$BUILD_STARTED" -nt "$BUILD_ID" ]; then
      # A build began after this artefact was published and never finished. See edge case 1 above.
      NEXT_BUILD_REASON="a build started at $BUILD_STARTED and did not finish, so $BUILD_ID describes an older artefact"
      NEXT_BUILD_STALE="$BUILD_STARTED"
      return 0
    fi
    reference="$BUILD_STARTED"
  fi

  local newer
  newer="$(find "$APP" \
      -type d \( -name .next -o -name .next-next -o -name node_modules -o -name public -o -name .next.lock \) -prune -o \
      -type f ! -name '*.tsbuildinfo' -newer "$reference" -print -quit 2>/dev/null || true)"
  if [ -z "$newer" ]; then
    newer="$(find "$ROOT/packages/ozikoro/src" "$ROOT/packages/db/src" "$ROOT/packages/core/src" \
        -type f ! -name '*.tsbuildinfo' -newer "$reference" -print -quit 2>/dev/null || true)"
  fi

  if [ -n "$newer" ]; then
    NEXT_BUILD_REASON="newer than the build's own start: ${newer#"$ROOT/"}"
    NEXT_BUILD_STALE="$newer"
  else
    NEXT_BUILD_REASON="every source file is older than $reference"
  fi
}
