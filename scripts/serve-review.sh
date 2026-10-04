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
# Six changes answer those five and one more, and the rest of the header says why each is what it is.
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
# The check is "is any source file newer than **the moment the build began**?", over `apps/ozikoro`
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
# ── 6. THE STATIC TREE IS ASSERTED TOO, AND "READY" NOW MEANS A PAGE THAT WORKS ──────────────────────
#
# THE FAULT THIS ANSWERS, MEASURED 2026-10-04, AND THE WORST ONE OF THE SIX. **Every React page served
# unstyled and with no JavaScript for an afternoon, and every assertion in this script passed.**
#
# `next build` bakes `distDir` into the standalone's OWN generated entry point. This script builds with
# `OZIKORO_DIST_DIR=.next-next`, so `standalone/apps/ozikoro/server.js` was generated holding
# `"distDir":"./.next-next"` and passes that object straight to `startServer`. The swap renames the OUTER
# `.next-next`; nothing renames the path inside the generated server, and the copy below wrote the static
# tree to a **hard-coded `$TARGET/.next/static`**. So the running process served its pages and manifests
# from `standalone/apps/ozikoro/.next-next/` — which existed, hence correct HTML and correct asset hashes —
# and looked for every `/_next/static/*` request in `…/.next-next/static`, which did not exist. Measured:
#
#     /_next/static/css/857f377877293320.css  ->  404  text/plain; charset=utf-8
#
# while 127 real files, including that exact stylesheet, sat unused in `…/.next/static`. The browser said
# it best: *"Refused to apply style … because its MIME type ('text/plain') is not a supported stylesheet
# MIME type"*, plus eight aborted chunks.
#
# **THE GATE THAT SHOULD HAVE CAUGHT IT COULD NOT FAIL.** Readiness waited on `GET /` for 200 — and `/` is
# a design screen served from `public/design/screens/`, whose HTML references **zero** `/_next/static`
# assets (measured). A broken build answers 200 there forever. *A 200 is not a working page*, so the gate
# now fetches a React route, requires it to reference built assets, and requires every one of them to
# answer 200 with a MIME type a browser will apply or run.
#
# The copy destination is no longer a guess either: the standalone's own embedded `distDir` is READ, and
# the artefact is NORMALISED to `.next` — the shape the Dockerfile ships — by renaming that directory and
# rewriting the one string the generated server passes to `startServer`. On the fast path the artefact
# being normalised is the one the running server is serving from, so it is not touched: it is reported as
# incomplete and `--rebuild` replaces it. And the static tree is now counted and checked against the
# build's own manifest, because the assertion that was here — `server.js` present, 52 design screens —
# **passed on this broken artefact**, and an assertion a broken artefact passes is how this reached the
# owner.
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
# WHEN THE LAST BUILD BEGAN, WHICH IS WHAT THE FRESHNESS CHECK COMPARES AGAINST.
#
# It sits beside `.next` rather than inside it, because the swap's `rm -rf .next` would take a marker inside
# it away with the very build it describes. It is touched immediately before `next build` and never on the
# fast path, so it names the start of the build that produced `BUILD_ID`.
#
# WHY A START IS THE RIGHT REFERENCE AND AN END IS NOT: a source file edited WHILE a build runs is older than
# the `BUILD_ID` written at the end of that build, so comparing against the end calls the tree current while
# the artefact holds the pre-edit code — measured here, and invisible to every later run. See
# `scripts/lib/next-build-freshness.sh` for the fault, the fix and the two edge cases, and
# `scripts/test-build-freshness.sh` for the case that fails without it.
BUILD_STARTED="$APP/.next.build-started"
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
#
# THE RULE LIVES IN `scripts/lib/next-build-freshness.sh`, NOT HERE, AND THE REASON IS THAT IT WAS WRONG.
#
# It compared every source against `BUILD_ID`, which is touched at the END of a build — so **a source file
# edited WHILE the build was running was never rebuilt afterwards**, and every later run reported "the build
# is CURRENT" while the artefact held the pre-edit code. Measured on 2026-10-04: a fix at 14:33:30, `BUILD_ID`
# at 14:35:26, the site still serving the old code at 14:41.
#
# A rule about timestamps cannot be proved by reading it, so it was moved somewhere it can be exercised with
# timestamps it chooses: `scripts/test-build-freshness.sh` builds a scratch tree and asserts the old
# behaviour was wrong and the new behaviour is right. **A rule that has been wrong once should be a rule with
# a test rather than a rule with a comment.**
NEXT_BUILD_STALE=""
NEXT_BUILD_REASON=""

# shellcheck source=lib/next-build-freshness.sh
. "$ROOT/scripts/lib/next-build-freshness.sh"

# ── the artefact assertion ───────────────────────────────────────────────────────────────────────────
#
# Measured on the artefact, not on the exit status of `cp`: a copy that silently did nothing is exactly
# the failure this catches. Short counts are the dangerous case, but a LONG count is also wrong — it is
# how `public/public/` happened once, and it means the directory is not the one the server expects.
standalone_screens_expected() {
  find "$SCREENS_SRC" -type f 2>/dev/null | wc -l | tr -d ' '
}

# ── WHICH DIRECTORY THE STANDALONE'S OWN SERVER READS ────────────────────────────────────────────────
#
# The generated `$TARGET/server.js` embeds a whole `nextConfig` object and hands it to `startServer`, so
# the `distDir` **string in that file** — not `next.config.ts`, not the name of the directory on disk — is
# what decides where the running process looks for `server/` and `static/`. This reads it. It is a
# separate function from the normaliser below because the pre-flight must be able to ask the question
# without changing the answer: the pre-flight runs against the artefact the live server is serving from.
#
# Prints the value, or nothing when there is no generated entry point to read it from; the reason function
# reports that case separately.
standalone_embedded_dist_dir() {
  python3 - "$1" <<'PY' 2>/dev/null || true
import json, os, re, sys

server = os.path.join(sys.argv[1], 'server.js')
try:
    text = open(server, encoding='utf-8').read()
except OSError:
    sys.exit(0)

# The line is a single `const nextConfig = {…};` — JSON.stringify emits no newlines, so one line is the
# whole object and `json.loads` can read it rather than a regular expression guessing at its contents.
m = re.search(r'^const nextConfig = (\{.*\});?[ \t]*$', text, re.M)
if not m:
    sys.exit(0)
try:
    print(json.loads(m.group(1)).get('distDir') or '.next')
except ValueError:
    sys.exit(0)
PY
}

# Normalise the standalone's embedded build directory to the name the Dockerfile ships, `.next`.
#
# WHY THIS IS NOT COSMETIC. The review artefact and the production artefact must be the same shape, or the
# review server is verifying a layout the container will never have. This script builds into `.next-next`
# so the running site survives the build; that is a property of the *outer* directory and has no business
# inside the artefact. See the header, 6.
#
# IT RUNS ONLY ON THE BUILD PATH, on the directory under `$STAGING_DIR` that nothing is serving. The
# fast path is refused by `standalone_incomplete_reason` instead, because normalising there would rename
# directories out from under the running server.
#
# It fails loudly rather than guessing: the generated server must contain exactly one `"distDir":<old>`,
# and that is checked BEFORE anything is moved, so a Next.js change that alters this shape stops the run
# with the artefact still where it was.
standalone_normalise_dist_dir() {
  python3 - "$1" <<'PY'
import json, os, re, shutil, sys

target = sys.argv[1]
server = os.path.join(target, 'server.js')
required = os.path.join(target, 'required-server-files.json')


def die(message):
    print('  NORMALISE FAILED: %s' % message, file=sys.stderr)
    print('  Nothing has been swapped in. The running server is untouched.', file=sys.stderr)
    sys.exit(1)


try:
    text = open(server, encoding='utf-8').read()
except OSError as exc:
    die('cannot read %s: %s' % (server, exc))

m = re.search(r'^const nextConfig = (\{.*\});?[ \t]*$', text, re.M)
if not m:
    die('%s has no `const nextConfig = {…}` line, so the directory it reads cannot be known' % server)
try:
    config = json.loads(m.group(1))
except ValueError as exc:
    die('the nextConfig embedded in %s is not JSON: %s' % (server, exc))

dist = config.get('distDir') or '.next'
if os.path.normpath(dist) == '.next':
    print('  the standalone already reads its build from .next')
    sys.exit(0)
if os.path.isabs(dist) or '..' in dist.split('/'):
    die('refusing to normalise an absolute or escaping distDir: %r' % dist)

new_dist = './.next' if dist.startswith('./') else '.next'
needle = '"distDir":' + json.dumps(dist)
if text.count(needle) != 1:
    die('expected exactly one %s in %s, found %d' % (needle, server, text.count(needle)))

inner = os.path.join(target, dist)
final = os.path.join(target, '.next')
if not os.path.isdir(inner):
    die('the generated server reads its pages from %s, which does not exist' % inner)

# A `.next` holding no server bundle is the placeholder an earlier run left behind with
# `mkdir -p "$TARGET/.next"` and its static copy — never a build. Removed so the move cannot nest.
if os.path.isdir(final):
    if os.path.isdir(os.path.join(final, 'server')):
        die('%s already holds a server bundle, so the artefact is ambiguous' % final)
    shutil.rmtree(final)

shutil.move(inner, final)
open(server, 'w', encoding='utf-8').write(text.replace(needle, '"distDir":' + json.dumps(new_dist)))

# Kept consistent so the file describes the directory it sits in. The running process does not read it —
# it uses the embedded config above — but every later reader, including the assertions here, does.
if os.path.isfile(required):
    try:
        data = json.load(open(required, encoding='utf-8'))
    except ValueError:
        data = None
    if isinstance(data, dict):
        data.setdefault('config', {})['distDir'] = new_dist
        prefix = dist.rstrip('/') + '/'
        for key in ('files', 'ignore'):
            entries = data.get(key)
            if isinstance(entries, list):
                data[key] = [
                    new_dist + '/' + e[len(prefix):]
                    if isinstance(e, str) and e.startswith(prefix) else e
                    for e in entries
                ]
        with open(required, 'w', encoding='utf-8') as handle:
            json.dump(data, handle)

print('  the standalone read its pages from %s and its static tree from %s/static; both are .next now'
      % (dist, dist))
PY
}

# ── THE STATIC TREE, WHICH NOTHING WAS CHECKING ──────────────────────────────────────────────────────
#
# The count the source holds is the assertion, as it is for the design screens, so it cannot go stale the
# day a chunk is added. `$TARGET/.next/static` is where the copy below puts it AND where the generated
# server reads it once normalised — those were two different directories on 2026-10-04, which is the
# whole fault.
static_tree_expected() {
  find "$1" -type f 2>/dev/null | wc -l | tr -d ' '
}

# THE FILES THE BUILD'S OWN PAGES ASK FOR, read from the build's own manifest rather than written down
# here: every name carries a content hash, so a hard-coded list would be wrong at the next build — the
# exact way the design-screen count avoided going stale. `/layout` is the App Router root layout, so its
# list is the CSS and the entry chunks **every** React page requests; a standalone missing any of them
# renders unstyled or without JavaScript while still answering 200.
build_manifest_assets() {
  python3 - "$1/app-build-manifest.json" <<'PY' 2>/dev/null || true
import json, sys

try:
    data = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception:
    sys.exit(0)

for entry in data.get('pages', {}).get('/layout', []) or []:
    if isinstance(entry, str) and (entry.endswith('.css') or entry.endswith('.js')):
        print(entry)
PY
}

# The reason the static tree is not servable, or the empty string. One reason, the first found, because
# the first one is the one an operator has to act on.
#
# IT TAKES THE BUILD DIRECTORY, NOT THE STATIC ONE. The first version of this took `…/static` and then
# asked for `…/static/app-build-manifest.json`, which does not exist — so `build_manifest_assets` printed
# nothing, the loop below never ran, and **half of the assertion I added to stop a vacuous pass was itself
# vacuous.** Measured by driving it with a scratch tree before trusting it: the count check fired and the
# name check silently did not. That is the same shape as the fault this round exists to remove, which is
# why the guard is exercised with a tree it should reject rather than only a tree it should accept.
static_tree_incomplete_reason() {
  local build="$1" src="$1/static" dst="$TARGET/.next/static" expected got missing="" asset
  expected="$(static_tree_expected "$src")"
  got="$(static_tree_expected "$dst")"
  if [ "$expected" -gt 0 ] && [ "$got" -ne "$expected" ]; then
    printf 'the static tree is incomplete: %s holds %s files where %s holds %s' \
      "${dst#"$ROOT/"}" "$got" "${src#"$ROOT/"}" "$expected"
    return 0
  fi
  # Present in the right COUNT is not present with the right NAMES: a tree built for a different page
  # graph has the same size and none of the hashes the HTML asks for.
  while IFS= read -r asset; do
    [ -n "$asset" ] || continue
    if [ ! -f "$dst/${asset#static/}" ]; then
      missing="$missing ${asset#static/}"
    fi
  done <<EOF
$(build_manifest_assets "$1")
EOF
  if [ -n "$missing" ]; then
    printf "the build's own pages ask for assets that are not in the standalone:%s" "$missing"
    return 0
  fi
  printf ''
}

standalone_incomplete_reason() {
  local expected got dist
  if [ ! -f "$TARGET/server.js" ]; then
    printf 'the standalone entry point %s does not exist' "$TARGET/server.js"
    return 0
  fi
  # THE GENERATED SERVER MUST READ THE DIRECTORY THE STATIC TREE IS COPIED INTO. On 2026-10-04 it read
  # `.next-next` while everything was copied to `.next`, and this function — the guard whose whole job is
  # to refuse an artefact that would serve 404s — passed the artefact that served them. See the header, 6.
  dist="$(standalone_embedded_dist_dir "$TARGET")"
  if [ -n "$dist" ] && [ "$(basename "$dist")" != ".next" ]; then
    printf "the standalone's own server reads its build from %s, not .next, so it cannot find the static tree this script copies; %s" \
      "$dist" "a run that builds it normalises that, which --rebuild does"
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
  # NOT "MISSING ITS DESIGN SCREENS" ANY MORE. That was the only shape this guard knew, and on 2026-10-04
  # the artefact was short of its static tree instead — the stylesheet and every chunk — while all 52
  # screens were present. **The message named the wrong fault, which is part of how the right fault stayed
  # hidden for an afternoon.** It describes the class now rather than one instance of it.
  printf '  An artefact short of what it serves answers 200 on every page it still has and 404 for the\n'
  printf '  files those pages ask for. That reads like a routing fault, or a design that is simply\n'
  printf '  broken, rather than a copy that did not finish.\n\n'
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
  printf '  The running server is untouched and still serving the previous build.\n\n'
  # WHO MAY DELETE, ONCE MORE. On the BUILD path `$SD` is the staging directory and deleting it is the
  # point: a half-written server bundle is what the next build would read. **On the fast path `$SD` is the
  # directory the running server is serving from**, and deleting it there is the measured outage this
  # script's own refusal message documents — `rm -rf` under a live server took `/`, `/about/` and
  # `/igbo-calendar/` from 200 to 404 while the refusal printed. So the fast path reports and leaves it.
  if [ -n "$NEXT_BUILD_STALE" ]; then
    printf '  The incomplete output is deleted so the next build cannot start from it:\n\n'
    printf '    %s\n\n' "${SD#"$ROOT/"}"
    rm -rf "$SD"
  else
    printf '  This run is serving from %s, so nothing is deleted — look at it where it is.\n\n' "${SD#"$ROOT/"}"
  fi
  printf '  Run this command to replace it:\n\n'
  printf '    bash scripts/serve-review.sh --rebuild\n\n'
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
    # THE TWO NUMBERS THAT WERE NOT PRINTED, AND THE ONE THAT DECIDES WHERE THEY ARE READ FROM. On
    # 2026-10-04 this line would have shown 127 static files in the build, 127 in the standalone, and
    # `reads from ./.next-next` — the mismatch in one line instead of an afternoon.
    echo "    static        $(static_tree_expected "$TARGET/.next/static") files in the standalone, $(static_tree_expected "$NEXT_DIR/static") in ${NEXT_DIR#"$ROOT/"}/static"
    echo "    reads from    $(standalone_embedded_dist_dir "$TARGET" || true) (the generated server's own distDir; must be .next)"
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
  # THE MARKER GOES DOWN BEFORE THE BUILD, NOT AFTER IT. This single line is the difference between a check
  # that notices a source edited during the build and one that reports "CURRENT" about an artefact that does
  # not contain it — see `scripts/lib/next-build-freshness.sh`. It is written here rather than on the fast
  # path, so a run that skips the build cannot advance the reference and hide a change.
  touch "$BUILD_STARTED"
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

# THE ONE DIRECTORY THIS RUN'S BUILD WROTE, and the source of the two trees copied below. Named once so
# the copy, the assertions and the readiness probe cannot disagree about which build is being served.
BUILD_OUT="$( [ -n "$NEXT_BUILD_STALE" ] && printf '%s' "$STAGING_DIR" || printf '%s' "$NEXT_DIR" )"

# ── normalise the standalone's own build directory BEFORE anything is copied into it ─────────────────
#
# The generated `$TARGET/server.js` embeds the `distDir` the build ran with — `.next-next` here — and hands
# it to `startServer`. The copy below writes the static tree to `.next/static`, so unless the two agree the
# running process serves every `/_next/static/*` request out of a directory that does not exist and answers
# **404 `text/plain`** for the whole asset tree while the pages keep returning 200 with the right hashes in
# them. That is exactly what the review site did for an afternoon. See the header, 6.
#
# It runs on the BUILD path, against the staging copy nothing is serving. On the fast path this would be
# renaming directories out from under the live server, so the pre-flight above refuses that instead.
if [ -n "$NEXT_BUILD_STALE" ]; then
  standalone_normalise_dist_dir "$TARGET" || exit 1
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
cp -R "$BUILD_OUT/static" "$TARGET/.next/static"

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

# ── AND THE STATIC TREE, WHICH IS THE ASSERTION THAT WAS MISSING ─────────────────────────────────────
#
# **Every assertion in this script passed on the artefact that had no servable assets at all.** `server.js`
# was present and 52 design screens were present, because the design screens come from `public/` and were
# copied correctly — the stylesheet and the eight chunks every React page asks for were somewhere else. So
# the tree the pages actually load is now measured against the build that produced it, by count and by the
# build's own hashed names. See the header, 6.
reason="$(static_tree_incomplete_reason "$BUILD_OUT")"
[ -z "$reason" ] || fail_incomplete_after_build "$reason"
STATIC_FILES="$(static_tree_expected "$TARGET/.next/static")"

echo "==> artefact complete: server.js present, ${SCREENS_EXPECTED} design screens, ${STATIC_FILES} static files"

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
# `BUILD_ID` is touched here, at the end, because it is the mark of a *complete* artefact: its presence is
# what tells the next run that `.next` came from a build that finished and had its output asserted. **It is
# no longer the freshness reference** — that is `$BUILD_STARTED`, touched before the build, because an end
# cannot notice a source edited during its own build. `next_build_check` uses `BUILD_ID` only to tell whether
# a marker belongs to a finished build (a marker NEWER than it means a build started and did not finish, and
# the artefact on disk is from an older one).
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

# ── READY MEANS A PAGE THAT WORKS, NOT A PAGE THAT ANSWERS ───────────────────────────────────────────
#
# WHY THE OLD GATE WAS WORTHLESS, MEASURED 2026-10-04. It waited for `GET /` to answer 200 — and `/` is a
# **design screen** served from `public/design/screens/`, whose HTML references **zero** `/_next/static`
# assets (counted: no match for `_next/static` in its body). So the gate reported READY all afternoon while
# every React page loaded with no stylesheet and no JavaScript. `/about/` is the same shape. **A 200 is not
# a working page, and a probe that cannot fail is not a check.**
#
# This fetches a React route, requires its HTML to reference built assets at all, and requires every one of
# them to answer 200 with a MIME type a browser will actually apply or run. `text/plain` is what a Next.js
# 404 for a missing static file looks like, and it is precisely what the browser refused.
#
# Prints the first reason the build is not being served, or nothing when it is.
asset_probe_reason() {
  local base="http://127.0.0.1:$PORT" page html refs ref line code ctype
  for page in /towns/ /researchers/; do
    html="$(curl -s --max-time 10 "$base$page" 2>/dev/null || true)"
    refs="$(printf '%s' "$html" | grep -oE '/_next/static/[A-Za-z0-9._/-]+\.(css|js)' | sort -u)"
    [ -n "$refs" ] && break
  done
  if [ -z "$refs" ]; then
    printf 'no React route referenced a built asset, so nothing here can tell a styled page from an unstyled one'
    return 0
  fi
  for ref in $refs; do
    line="$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 10 "$base$ref" 2>/dev/null || echo 000)"
    code="${line%% *}"
    ctype="${line#* }"
    if [ "$code" != "200" ]; then
      printf '%s answered %s while the build being served asks for it' "$ref" "$code"
      return 0
    fi
    case "$ref" in
      *.css) case "$ctype" in
               text/css*) ;;
               *) printf '%s answered 200 with MIME type %s, which a browser will refuse to apply as a stylesheet' "$ref" "$ctype"; return 0 ;;
             esac ;;
      *.js)  case "$ctype" in
               *javascript*) ;;
               *) printf '%s answered 200 with MIME type %s, which a browser will not run as a script' "$ref" "$ctype"; return 0 ;;
             esac ;;
    esac
  done
  printf ''
}

READY_START="$(date +%s)"
for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    reason="$(asset_probe_reason)"
    if [ -n "$reason" ]; then
      echo "  THE SERVER IS UP AND ITS BUILD IS NOT BEING SERVED: $reason" >&2
      echo "  this is the fault where every page answers 200 and none of them is styled; see /tmp/ozikoro-review-$PORT.log" >&2
      exit 1
    fi
    echo
    echo "  READY  ->  http://127.0.0.1:$PORT"
    echo "             build ${BUILD_SECONDS}s, restart $(( $(date +%s) - READY_START ))s, total $(( BUILD_SECONDS + $(date +%s) - READY_START ))s"
    echo "             assets: every /_next/static file a React page asks for answers 200 with a usable MIME type"
    echo "             log: /tmp/ozikoro-review-$PORT.log"
    exit 0
  fi
  sleep 2
done

echo "  the server did not answer within 80s; see /tmp/ozikoro-review-$PORT.log" >&2
exit 1
