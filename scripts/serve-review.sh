#!/usr/bin/env bash
#
# serve-review.sh — make http://127.0.0.1:3110 serve the current source, without taking the site down
# to do it.
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
# WHY HOSTNAME=0.0.0.0 AND NOT A LOOPBACK ADDRESS
#
# Setting HOSTNAME=127.0.0.1 makes the server bind IPv4 only, while `localhost` resolves to ::1 first — so
# Next's own internal proxying fails with ECONNRESET and every route except the index returns 500. The
# Dockerfile sets 0.0.0.0 for this reason; this script matches it.
#
# ── WHAT WENT WRONG, AND WHY THIS FILE IS NOT THE SCRIPT IT WAS THIS MORNING ──────────────────────────
#
# Several agents share one checkout, one `apps/ozikoro/.next` and one port 3110, and nothing serialised
# them. Measured on one day, each of these took the review site down:
#
#   1. TWO `next build` PROCESSES IN THE SAME `.next` destroyed each other's output — `Cannot find
#      module '…/.next/server/pages-manifest.json'`, `ENOENT … next-font-manifest.json`, and once
#      `next-server.js.nft.json` — leaving the directory half-written so the server would not start.
#   2. `rm -rf apps/ozikoro/.next` WHILE A SERVER WAS RUNNING deleted files the live process was
#      reading, and mid-build it left the directory unusable for the next build too.
#   3. THE OLD SCRIPT WAS NOT IDEMPOTENT. It SIGTERMed whatever held 3110, rebuilt unconditionally, and
#      started again — so **every run took the site down for 60–120 seconds even when the build it
#      needed was already current.** It was run several times an hour all day. This is the fault the
#      owner was asking about.
#   4. A STANDALONE BUILD MISSING `public/` produced a working-looking site with every design screen
#      404ing: `standalone/…/public/design/screens/` held 0 files where it must hold 52, and
#      `/researchers/` kept working, which makes it look like a routing bug and not a missing copy.
#   5. `next build` EMPTIES ITS OUTPUT DIRECTORY BEFORE IT WRITES, so building in place is not merely a
#      risk of shipping a bad build: it takes the running server's files away at the first second of
#      the build. Measured here — after one build that FAILED on another agent's type error, `.next`
#      had no `BUILD_ID` and no `standalone/` at all, and the site answered 404 for eight minutes
#      while the build output scrolled past. Building into a second directory and swapping it in is
#      what makes a failed build harmless.
#
# Five changes answer those five, and the rest of the header says why each is what it is.
#
# ── 1. A LOCK ON THE BUILD, BESIDE THE BUILD DIRECTORY ───────────────────────────────────────────────
#
# `scripts/lib/next-build-lock.sh` is taken before anything is built, copied or stopped. It is the same
# guard `packages/db/src/cluster-lock.ts` is for the PGlite cluster, in shell, and for the same reason:
# a rule that a caller has to remember is not a guard. In particular it lives at
#
#     apps/ozikoro/.next.lock          NOT  apps/ozikoro/.next/lock
#
# because a lock inside the build directory is deleted by the very `rm -rf` that needs it most — the
# reasoning that put the database lock beside the cluster rather than inside it. The path is derived from
# the build directory by the library; this script passes its own explicitly so an operator can see the
# file to remove.
#
# ── 2. NO REBUILD WHEN THE BUILD IS CURRENT ──────────────────────────────────────────────────────────
#
# The check is "is `.next/BUILD_ID` newer than every source file that goes into it?", over `apps/ozikoro`
# (minus `.next`, `node_modules` and `public`) and `packages/{ozikoro,db,core}/src`. It costs about
# 0.15 s, measured, which is 500× cheaper than the rebuild it avoids. **When in doubt it builds**: a
# false "rebuild" costs 90 seconds, a false "skip" serves the wrong site, and only one of those is
# recoverable by running the command again. `--rebuild` forces one when an agent knows it needs one.
#
# ── 2b. THE BUILD GOES SOMEWHERE ELSE, AND IS SWAPPED IN WHEN IT IS COMPLETE ──────────────────────────
#
# `OZIKORO_DIST_DIR=.next-next` makes `next build` write `.next-next` (see the distDir note in
# `apps/ozikoro/next.config.ts`). The running server keeps serving out of `.next` for the whole build,
# so the site is up through it, and **a build that fails changes nothing**: the message says so and the
# old site keeps answering. Only after the build has succeeded AND its artefact has been asserted
# complete are the two directories swapped: `rm -rf .next` then `mv .next-next .next`, both of which
# are fast, and both of which happen after the server has been stopped. The swap is why `BUILD_ID` is
# touched afterwards — the freshness check must not read the staging directory's build time as newer
# than the sources, or a second run would rebuild work that is already live.
#
# ── 3. A BUILD THAT WOULD RACE ANOTHER ONE REFUSES, IT DOES NOT WAIT ─────────────────────────────────
#
# Two agents starting at once is the actual failure, and the choice between waiting and refusing matters:
# **a build that silently waits 90 seconds and then runs on a half-written directory is worse than one
# that refuses in a second.** So a second builder is refused immediately, by name, with the holder's pid
# and command, and told to run the command again. The one exception is a holder that is already past its
# build and restarting the server, which takes seconds — that case waits, boundedly, because a wait
# shorter than the thing it waits for is safe and saves a refusal. The stage is written into the lock
# record precisely so the two cases can be told apart. `NEXT_WAIT=<seconds>` makes the wait explicit.
#
# ── 4. THE STANDALONE IS ASSERTED COMPLETE, OR THE SCRIPT FAILS LOUDLY ───────────────────────────────
#
# After the copy, the artefact is measured rather than assumed: `server.js` must exist and
# `standalone/…/public/design/screens/` must hold **exactly as many files as
# `apps/ozikoro/public/design/screens/`** (52 today — counted, not hard-coded, so it cannot drift). The
# count the source holds is the assertion, because a fixed 52 would go stale silently the day a screen
# is added. If the artefact is short the incomplete standalone is **deleted** and the script exits
# non-zero with both numbers, because a build that fails loudly is worth more than a site that serves
# 404s. This runs on the fresh-build path *and* as a pre-flight check on the fast path, so a standalone
# damaged by anything else is caught **before** the running server is touched — the site stays up and
# the operator gets an exact reason.
#
# ── WHAT IS UNCHANGED, AND MUST STAY UNCHANGED ───────────────────────────────────────────────────────
#
# The SIGTERM-and-wait, and the **refusal to force-kill a process holding `.data/pg`.** PGlite is a WASM
# Postgres in the same process as the server and it writes WAL as it opens its cluster; a SIGKILL in that
# window leaves `pg_control` pointing at a WAL segment that no longer exists. That destroyed seven
# clusters in a day and each one cost a restore plus the imports replayed on top of it. A process that
# will not leave is reported rather than shot, because a stubborn process is a solvable problem and a
# corrupt database is not.
#
# USAGE
#   bash scripts/serve-review.sh              # build only if the source is newer, then restart
#   bash scripts/serve-review.sh --rebuild    # build whether or not it looks current
#   bash scripts/serve-review.sh --check      # report what would happen; change nothing
#   PORT=4000 bash scripts/serve-review.sh    # another port
#
#   NEXT_WAIT=60 bash scripts/serve-review.sh # wait up to 60s for a holder that is only restarting
#
# EXIT STATUS
#   0  the site is up (or, with --check, the artefact is complete)
#   1  refusal (another build holds the lock), an incomplete artefact, or the server did not answer
set -euo pipefail

PORT="${PORT:-3110}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/apps/ozikoro"
NEXT_DIR="$APP/.next"
# The build is written here and moved into $NEXT_DIR when it is complete. See the header, 2b, and the
# distDir note in apps/ozikoro/next.config.ts: building in place empties the directory the running
# server is reading, which is what took the site down on 2026-10-04 even when the build then failed.
STAGING_DIR="$APP/.next-next"
SD="$NEXT_DIR/standalone"
TARGET="$SD/apps/ozikoro"
BUILD_ID="$NEXT_DIR/BUILD_ID"
# The design screens are the artefact whose absence is invisible to the server's own logs: with them
# missing the site answers 200 everywhere and renders a 404 page for every screen.
SCREENS_SRC="$APP/public/design/screens"
SCREENS_DST="$TARGET/public/design/screens"

# shellcheck source=lib/next-build-lock.sh
. "$ROOT/scripts/lib/next-build-lock.sh"

MODE="serve"
REBUILD=0
WAIT="${NEXT_WAIT:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --check)   MODE="check"; shift ;;
    --rebuild) REBUILD=1; shift ;;
    --wait)    WAIT="${2:-0}"; shift 2 ;;
    -h|--help) sed -n '2,120p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)
      echo "unknown argument: $1" >&2
      echo "usage: bash scripts/serve-review.sh [--rebuild] [--check] [--wait <seconds>]" >&2
      exit 2
      ;;
  esac
done
case "$WAIT" in ''|*[!0-9]*) WAIT=0 ;; esac

cd "$ROOT"

# ── the freshness check ──────────────────────────────────────────────────────────────────────────────
#
# `NEXT_BUILD_STALE` is set to the newest source file when the build is older than the source, and to
# the empty string when the build is current. The reason is printed either way, because "it rebuilt" and
# "it did not" are both things the next agent needs to be able to read afterwards.
NEXT_BUILD_STALE=""
NEXT_BUILD_REASON=""

next_build_check() {
  NEXT_BUILD_STALE=""
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
  local newer
  # A false "rebuild" is safe and a false "skip" is not, so every source file that can reach the build
  # is compared. `public/` is deliberately NOT compared: it is copied beside the standalone at serve
  # time by this script, so a change under it is served without a rebuild, and including it would
  # rebuild the site for a stylesheet that the copy already picks up.
  #
  # `*.tsbuildinfo` is excluded for a measured reason: `npm run typecheck` (which every commit runs, via
  # the pre-commit hook) rewrites `apps/ozikoro/tsconfig.tsbuildinfo` every time. It is tsc's cache, not
  # a source file, and counting it made the build look stale immediately after every commit and every
  # typecheck — so the "restart only" path was almost never the path taken, which is precisely the fault
  # this check exists to remove. It cannot change what `next build` emits: tsc's incremental cache is
  # read by `tsc`, and `next build` runs its own type check.
  #
  # `.next.lock` is excluded for the same kind of reason and was measured too: the lock's own record is
  # written a second before the build starts, so counting it made every run report "STALE" and made a
  # hand-written lock look like a source change. It is this script's own plumbing.
  newer="$(find "$APP" \
      -type d \( -name .next -o -name .next-next -o -name node_modules -o -name public -o -name .next.lock \) -prune -o \
      -type f ! -name '*.tsbuildinfo' -newer "$BUILD_ID" -print -quit 2>/dev/null || true)"
  if [ -z "$newer" ]; then
    newer="$(find "$ROOT/packages/ozikoro/src" "$ROOT/packages/db/src" "$ROOT/packages/core/src" \
        -type f ! -name '*.tsbuildinfo' -newer "$BUILD_ID" -print -quit 2>/dev/null || true)"
  fi
  if [ -n "$newer" ]; then
    NEXT_BUILD_REASON="newer than the current build: ${newer#"$ROOT/"}"
    NEXT_BUILD_STALE="$newer"
  else
    NEXT_BUILD_REASON="every source file is older than $BUILD_ID"
  fi
}

# ── the artefact assertion ───────────────────────────────────────────────────────────────────────────
#
# Measured on the artefact, not on the exit status of `cp`: a copy that silently did nothing is exactly
# the failure this catches. Short counts are the dangerous case, but a LONG count is also wrong — it is
# how `public/public/` happened once, and it means the directory is not the one the server expects.
standalone_screens_expected() {
  find "$SCREENS_SRC" -type f 2>/dev/null | wc -l | tr -d ' '
}

standalone_incomplete_reason() {
  local expected got
  if [ ! -f "$TARGET/server.js" ]; then
    printf 'the standalone entry point %s does not exist' "$TARGET/server.js"
    return 0
  fi
  if [ -n "$SCREENS_EXPECTED" ] && [ "$SCREENS_EXPECTED" -gt 0 ]; then
    got="$(find "$SCREENS_DST" -type f 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$got" -ne "$SCREENS_EXPECTED" ]; then
      printf 'the design screens are incomplete: %s holds %s files where %s holds %s' \
        "${SCREENS_DST#"$ROOT/"}" "$got" "${SCREENS_SRC#"$ROOT/"}" "$SCREENS_EXPECTED"
      return 0
    fi
  fi
  printf ''
}

# Fail an incomplete artefact loudly.
#
# WHO IS ALLOWED TO DELETE, AND WHY IT IS ONLY EVER THE BUILD
#
# The first version of this deleted the incomplete standalone from every caller, including the
# pre-flight — and the pre-flight runs while the server is serving OUT OF THAT DIRECTORY. Measured:
# the guard was right about the artefact and wrong about the consequence, and deleting it took the
# running site from 200 to 404 on `/`, `/about/` and `/igbo-calendar/` while the refusal was printing.
# The check had become an outage.
#
# So deletion is the build's job and nobody else's. It happens on the artefact the build just copied,
# in the staging directory, where nothing is being served — and when the artefact is incomplete the
# whole standalone goes, because a half-written server bundle is what the next `next build` would read.
#
# The pre-flight never deletes. It still refuses, because an incomplete artefact must not be served —
# but it leaves the directory exactly as it found it, so a human can look at it, and the
# `--rebuild` it prints is what replaces it.
fail_incomplete() {
  local reason="$1"
  [ -n "$NEXT_BUILD_STALE" ] && return 0
  printf '\n  REFUSING TO SERVE: THE STANDALONE ARTEFACT IS INCOMPLETE.\n\n'
  printf '    %s\n\n' "$reason"
  printf '  A standalone missing its design screens serves 200 for every page and a 404 page for\n'
  printf '  every screen, which reads like a routing fault and is a missing copy.\n\n'
  printf '  Nothing has been stopped, deleted or rebuilt: the running server is untouched and the\n'
  printf '  directory is left where you can look at it.\n\n'
  printf '  Run this to build a complete artefact and swap it in:\n\n'
  printf '    bash scripts/serve-review.sh --rebuild\n\n'
  exit 1
}

# The build path's own failure: the copy it just made into staging is short. Deleting is safe and correct
# here because nothing is serving that directory, and the live `.next` is still whole.
fail_incomplete_after_build() {
  local reason="$1"
  printf '\n  THE BUILD PRODUCED AN INCOMPLETE ARTEFACT, SO IT WILL NOT BE SWAPPED IN.\n\n'
  printf '    %s\n\n' "$reason"
  printf '  The running server is untouched and still serving the previous build. The incomplete\n'
  printf '  output is deleted so the next build cannot start from it:\n\n'
  printf '    %s\n\n' "${SD#"$ROOT/"}"
  printf '  Run this command again:\n\n'
  printf '    bash scripts/serve-review.sh --rebuild\n\n'
  rm -rf "$SD"
  exit 1
}

# ── --check: report, change nothing ─────────────────────────────────────────────────────────────────
SCREENS_EXPECTED="$(standalone_screens_expected)"
if [ "$MODE" = "check" ]; then
  next_build_check
  echo "==> --check, nothing is changed"
  echo "    port          $PORT"
  echo "    build         $( [ -n "$NEXT_BUILD_STALE" ] && echo 'STALE — a run would rebuild' || echo 'current — a run would restart only' )"
  echo "    why           $NEXT_BUILD_REASON"
  echo "    screens       source $SCREENS_EXPECTED files"
  if [ -d "$TARGET" ]; then
    echo "    standalone    $(find "$SCREENS_DST" -type f 2>/dev/null | wc -l | tr -d ' ') files, $( [ -f "$TARGET/server.js" ] && echo 'server.js present' || echo 'server.js MISSING' )"
  else
    echo "    standalone    absent$( [ -n "$NEXT_BUILD_STALE" ] && echo ' — a run would build' || echo ' — NOTHING WOULD BUILD, and a run would refuse' )"
  fi
  echo "    lock          $APP/.next.lock $( [ -d "$APP/.next.lock" ] && echo '(held)' || echo '(free)' )"
  echo "    port $PORT    $(lsof -ti "tcp:$PORT" >/dev/null 2>&1 && echo 'answering' || echo 'nothing listening')"
  reason="$(standalone_incomplete_reason)"
  [ -z "$reason" ] || fail_incomplete "$reason"
  exit 0
fi

# ── the plan, printed before anything is touched ────────────────────────────────────────────────────
next_build_check
echo "==> the build is $( [ -n "$NEXT_BUILD_STALE" ] && echo 'STALE' || echo 'CURRENT' ): $NEXT_BUILD_REASON"
echo "==> screens: $SCREENS_EXPECTED in ${SCREENS_SRC#"$ROOT/"}"
if [ -d "$TARGET" ]; then
  reason="$(standalone_incomplete_reason)"
  if [ -n "$reason" ]; then
    # Nothing has been stopped, so the site is still up while this is reported.
    fail_incomplete "$reason"
  fi
fi

# ── the lock ────────────────────────────────────────────────────────────────────────────────────────
#
# Taken before the build, the copy or the stop. The wait is bounded and only applies to a holder that is
# already restarting the server: a holder that is building is refused at once, because waiting 90 seconds
# behind a build and then running is the failure mode, not the cure.
if [ "$WAIT" -gt 0 ]; then
  next_lock_acquire "$NEXT_DIR" build --paths "$APP/.next.lock" --wait "$WAIT" \
    "bash scripts/serve-review.sh${REBUILD:+ --rebuild}" || exit 1
else
  next_lock_acquire "$NEXT_DIR" build --paths "$APP/.next.lock" \
    "bash scripts/serve-review.sh${REBUILD:+ --rebuild}" || exit 1
fi
echo "==> build lock taken: $APP/.next.lock (pid $$)"

# Re-check UNDER the lock. A second caller that waited for a builder to finish should discover that the
# build it wanted is now current and restart rather than build again. This is what makes the wait worth
# having at all.
if [ -n "$NEXT_BUILD_STALE" ] && [ "$REBUILD" -eq 0 ]; then
  previous="$NEXT_BUILD_STALE"
  next_build_check
  if [ -z "$NEXT_BUILD_STALE" ]; then
    echo "==> the build that was in flight ($previous) has finished; this run will restart only"
  fi
fi

# ── build into staging, copy, assert, and only then stop the server ─────────────────────────────────
#
# **EVERYTHING THAT CAN FAIL HAPPENS BEFORE THE RUNNING SERVER IS TOUCHED.** The old script stopped the
# port first, and the first time another agent left a type error in the tree that took the whole review
# site down for the duration of the failure — and it stayed down, because a failed in-place build had
# already emptied `.next`.
#
# So the build writes `$STAGING_DIR` with `OZIKORO_DIST_DIR`, the running server keeps serving out of
# `$NEXT_DIR` untouched, and a failure here exits with the site still up. The swap at the end is
# `rm -rf $NEXT_DIR && mv $STAGING_DIR $NEXT_DIR`, which is milliseconds, and it happens with the
# server stopped so PGlite never sees an inconsistent tree.
BUILD_SECONDS=0
if [ -n "$NEXT_BUILD_STALE" ]; then
  echo "==> building into ${STAGING_DIR#"$ROOT/"} (standalone output) — the site stays up through it"
  # An earlier run may have died mid-build. `next build` empties its output directory itself, but a
  # half-written staging directory from a killed build is not worth trusting, and it costs nothing to
  # remove.
  rm -rf "$STAGING_DIR"
  BUILD_START="$(date +%s)"
  if ! OZIKORO_DIST_DIR=.next-next NODE_ENV=production npm -w @ozikoro/site run build; then
    printf '\n  THE BUILD FAILED, AND THE RUNNING SERVER HAS NOT BEEN TOUCHED.\n\n'
    printf '  The site on port %s is still serving the previous build, and %s has not been\n' "$PORT" "${NEXT_DIR#"$ROOT/"}"
    printf '  modified. Fix the error above and run this command again — nothing was stopped and the\n'
    printf '  database was not touched. The failed output is left at %s for inspection.\n\n' "${STAGING_DIR#"$ROOT/"}"
    exit 1
  fi
  BUILD_SECONDS=$(( $(date +%s) - BUILD_START ))
  echo "==> build finished in ${BUILD_SECONDS}s"
  SD="$STAGING_DIR/standalone"
  TARGET="$SD/apps/ozikoro"
  SCREENS_DST="$TARGET/public/design/screens"
else
  echo "==> skipping the build: $NEXT_BUILD_REASON"
  SD="$NEXT_DIR/standalone"
  TARGET="$SD/apps/ozikoro"
  SCREENS_DST="$TARGET/public/design/screens"
fi

echo "==> copying what standalone output omits, exactly as the Dockerfile does"
# BOTH PARENTS MUST EXIST, and the first version of this script only created the second.
#
# `verify-all` rebuilds, which deletes the whole standalone directory. Running this afterwards then failed at
# the first copy — the parent `$SD/apps/ozikoro` did not exist — and with `set -e` the script exited before
# starting a server. **The visible symptom was different and worse than a crash**: a stale server kept
# answering on the port with a build whose stylesheets were gone, so every page rendered as unstyled HTML.
# That is what "scattered" means, and it is why both mkdirs are here.
mkdir -p "$TARGET" "$TARGET/.next"
# REMOVE THE DESTINATION FIRST. `cp -R src dst` with `dst` already present copies src INTO dst, so a second
# run produced `public/public/` and left `/design/styles/main.css` missing — which the guard below now catches
# rather than starting a server that renders unstyled.
rm -rf "$TARGET/public" "$TARGET/.next/static"
cp -R "$APP/public" "$TARGET/public"
cp -R "$( [ -n "$NEXT_BUILD_STALE" ] && printf '%s' "$STAGING_DIR" || printf '%s' "$NEXT_DIR" )/static" "$TARGET/.next/static"

# Prove the copy happened rather than assuming it. The stylesheets are the thing whose absence is invisible
# from the server's own logs and obvious to a reader.
for asset in "$TARGET/public/design/styles/main.css" "$TARGET/.next/static"; do
  if [ ! -e "$asset" ]; then
    echo "  the copy did not produce $asset — refusing to start a server that would render unstyled" >&2
    echo "  the running server has not been stopped; fix the copy and run this command again" >&2
    exit 1
  fi
done

# And prove the whole artefact, not just the two files above. A standalone with 51 of 52 design screens is
# the failure that produces a working-looking site with 404s for every screen.
reason="$(standalone_incomplete_reason)"
[ -z "$reason" ] || fail_incomplete_after_build "$reason"
echo "==> artefact complete: server.js present, ${SCREENS_EXPECTED} design screens"

# ── stop and restart ────────────────────────────────────────────────────────────────────────────────
#
# The stage is written before the server is touched so a caller refused during this window is told to
# wait seconds rather than minutes, and so the wait it is allowed is a safe one.
next_lock_set_stage serve

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

# ── the swap ────────────────────────────────────────────────────────────────────────────────────────
#
# Only reached when the build succeeded and its artefact was asserted above, and only after the server
# has left and PGlite has closed. Two fast operations: delete the directory the server was serving, and
# move the finished one into its place. Doing the swap while the old server was still running would be
# faster still and is deliberately not done — the old process would answer 404 for every chunk in the
# window between the delete and the move, and a few seconds of honest downtime is better than a few
# seconds of a site that looks broken.
#
# BUILD_ID is touched afterwards so the freshness check has a reference point later than every source
# file it just built from. Without it the next run would compare the sources against the staging
# directory's build time — which is now the same file, but the check must not depend on the order in
# which two writes landed.
if [ -n "$NEXT_BUILD_STALE" ]; then
  echo "==> swapping the new build into ${NEXT_DIR#"$ROOT/"}"
  rm -rf "$NEXT_DIR"
  mv "$STAGING_DIR" "$NEXT_DIR"
  SD="$NEXT_DIR/standalone"
  TARGET="$SD/apps/ozikoro"
  SCREENS_DST="$TARGET/public/design/screens"
  touch "$BUILD_ID"
fi

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

READY_START="$(date +%s)"
for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    echo
    echo "  READY  ->  http://127.0.0.1:$PORT"
    echo "             build ${BUILD_SECONDS}s, restart $(( $(date +%s) - READY_START ))s, total $(( BUILD_SECONDS + $(date +%s) - READY_START ))s"
    echo "             log: /tmp/ozikoro-review-$PORT.log"
    exit 0
  fi
  sleep 2
done

echo "  the server did not answer within 80s; see /tmp/ozikoro-review-$PORT.log" >&2
exit 1
