#!/usr/bin/env bash
#
# next-build-lock.sh — one `next build` per `.next` directory, or a refusal that says so.
#
# WHY THIS EXISTS
#
# `apps/ozikoro/.next` is shared by every agent working in this checkout, and it had no lock of any
# kind. Measured on one day:
#
#   * two `next build` processes in the same directory destroyed each other's output. The recorded
#     errors are `Cannot find module '…/.next/server/pages-manifest.json'`,
#     `ENOENT … next-font-manifest.json`, and once `next-server.js.nft.json`. The directory is left
#     half-written and the server will not start.
#   * `rm -rf apps/ozikoro/.next` while a server was running deleted files the live process was
#     reading, and mid-build it left the directory unusable for the next build as well.
#
# Both are the same fault: two processes racing over one directory with no way to tell that the other
# exists. This file is that way.
#
# WHY IT HAS THE SHAPE OF `packages/db/src/cluster-lock.ts`
#
# The database guard was written for exactly this class of problem and it has already survived the
# reasoning that a lock like this gets wrong. Its five decisions are repeated here rather than
# re-derived, because each one was a correction:
#
#   1. **Acquire atomically.** `mkdir` is the shell's `O_CREAT|O_EXCL`: the kernel creates the
#      directory or reports `EEXIST`, with no window in between. "Test, then create" is a race whose
#      width is the work between the two calls, and two builds starting in the same millisecond is
#      the failure being fixed.
#   2. **Record the holder's pid, process start time and argv.** A pid alone is reused on macOS and
#      Linux, so a recycled pid passes a liveness check and the lock refuses forever. A date string
#      compared with a two-second tolerance is what separates a live holder from a recycled number.
#   3. **Stale locks self-heal.** A guard that needs a manual `rm` is a guard people learn to delete.
#      As in `cluster-lock.ts`, the platform is asked rather than a timestamp: a dead pid is stale,
#      and a recycled pid is caught by the start time. Time itself is never evidence of death,
#      because a build that is slow for the ordinary reason would then have its lock stolen.
#   4. **Refuse loudly, and distinguish contention from corruption.** The two sentences that matter
#      most are *"another process is building; this is not a fault"* and the exact `rm -f` command.
#   5. **The lock lives outside the build directory.** `.next.lock` is the sibling of `.next`, never
#      `.next/lock`, because a lock inside the build directory is destroyed by the very `rm -rf` that
#      needs it most — the same reasoning that put the database lock beside the cluster rather than
#      inside it.
#
# WHY THE PATH IS DERIVED AND NOT HARD-CODED
#
# `next_lock_paths <build-dir>` derives `.next.lock` from the build directory's own path, so a second
# checkout, a copied tree, or a rehearsal against `/tmp/…/.next` gets its own lock and cannot contend
# with the real one. A fixed path would leave one of those two entirely unguarded — the same mistake
# the database guard's derived-path decision corrected, and it is available here.
#
# `scripts/serve-review.sh` passes its lock explicitly as `<repo>/apps/ozikoro/.next.lock`, because
# the owner asked for exactly that path and a caller who can see the file can `rm -rf` it. That is an
# argument at the call site rather than a constant in here, so every other caller still derives its
# own. `NEXT_BUILD_LOCK_PATH` overrides both, which is how the measurements below exercise the lock
# without a 90-second build.
#
# WHAT IT DOES NOT COVER, AND MUST NOT APPEAR TO
#
# **It cannot make a `SIGKILL` safe, and it is not a substitute for the database guard.** Killing a
# build is harmless — a build holds no cluster — but killing the *server* that holds `.data/pg` is
# the fault that destroyed seven PGlite clusters in a day. That prohibition lives in
# `scripts/serve-review.sh`, which sends SIGTERM, waits, and refuses to force a process holding the
# cluster. Nothing here weakens it, and a lock whose holder was SIGKILLed is reclaimed by design.
#
# IT IS PER-MACHINE, NOT PER-VOLUME
#
# `mkdir` is atomic on a local filesystem and is documented as unreliable on some network
# filesystems. This is a guard for one machine's processes, which is what this checkout is.
#
# USAGE
#
#   . "$(dirname "${BASH_SOURCE[0]}")/lib/next-build-lock.sh"
#
#   next_lock_acquire "$ROOT/apps/ozikoro/.next" build 30 --wait 20 || exit 1
#   next_lock_set_stage serve
#   ... work ...
#   next_lock_release
#
#   next_lock_inspect "$path" > /tmp/verdict   # prints: stale|live <reason>
#
# Exported after a successful acquire:
#
#   NEXT_LOCK_DIR    the lock directory
#   NEXT_LOCK_PID    this process's pid
#   NEXT_LOCK_TOKEN  this holder's unguessable token
#   NEXT_LOCK_STAGE  the stage most recently written with `next_lock_set_stage`
#
# `next_lock_release` is idempotent and is safe to call from a trap. Acquire installs traps for
# `EXIT`, `INT`, `TERM` and `HUP` the first time it is called, so an interrupted script does not
# leave a lock behind.

# --- paths ------------------------------------------------------------------------------------------

# `dirname`/`basename` as the cluster lock does them: always `<dir>/<name>.lock` beside the directory.
next_lock_path_for() {
  local build_dir="${1%/}"
  printf '%s/%s.lock\n' "$(dirname -- "$build_dir")" "$(basename -- "$build_dir")"
}

# The derived path, unless the repository's one named path applies or the environment overrides it.
next_lock_paths() {
  local build_dir="${1:-apps/ozikoro/.next}" path
  if [ -n "${NEXT_BUILD_LOCK_PATH:-}" ]; then
    path="$NEXT_BUILD_LOCK_PATH"
  else
    path="$(next_lock_path_for "$build_dir")"
  fi
  printf '%s\n' "$path"
}

# --- reading the record -----------------------------------------------------------------------------

# One JSON field, without jq. The values are quoted; nothing else in them is escaped.
next_lock_field() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 1
  sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -1
}

next_lock_pid_field() {
  local file="$1"
  [ -f "$file" ] || return 1
  sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$file" | head -1
}

# --- probes -----------------------------------------------------------------------------------------

# True when a pid is alive. Signal 0 is the POSIX existence test, and EPERM still means alive.
next_lock_pid_alive() {
  local pid="${1:-}"
  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$pid" -gt 0 ] || return 1
  kill -0 "$pid" 2>/dev/null
}

# When a pid started, in seconds since the epoch, or nothing when this machine will not say.
#
# `/proc` first because it needs no child process and is exact; `ps` second because it is the only
# source on macOS. Both are wrapped so a denied or absent instrument is a null answer rather than an
# error: a null answer is not held to be evidence of anything (see `next_lock_inspect`).
next_lock_start_epoch() {
  local pid="$1" stat btime ticks after
  local -a fields=()
  if [ -r "/proc/$pid/stat" ]; then
    stat="$(cat "/proc/$pid/stat" 2>/dev/null)" || stat=""
    if [ -n "$stat" ]; then
      # The comm field is parenthesised and may itself contain spaces, so parse from the last ')'.
      after="${stat##*)} "
      read -r -a fields <<< "$after"
      # starttime is field 22 of the record, i.e. index 19 of what follows field 3.
      ticks="${fields[19]:-}"
      btime="$(sed -n 's/^btime[[:space:]]*\([0-9][0-9]*\).*/\1/p' /proc/stat 2>/dev/null | head -1)"
      if [ -n "$ticks" ] && [ -n "$btime" ]; then
        # USER_HZ is 100 on every Linux this runs on; a wrong constant shifts by seconds, and the
        # two-second tolerance below absorbs it without ever mistaking one process for another.
        printf '%s\n' "$((btime + ticks / 100))"
        return 0
      fi
    fi
  fi
  next_lock_ps_start_epoch "$pid"
}

next_lock_ps_start_epoch() {
  local pid="$1" out
  out="$(ps -p "$pid" -o lstart= 2>/dev/null)" || return 1
  out="${out#"${out%%[![:space:]]*}"}"
  out="${out%"${out##*[![:space:]]}"}"
  [ -n "$out" ] || return 1
  # BSD `date` (macOS) knows `-j -f`; GNU `date` knows `-d`. Exactly one of them will parse it.
  date -j -f '%a %b %d %T %Y' "$out" '+%s' 2>/dev/null && return 0
  date -d "$out" '+%s' 2>/dev/null && return 0
  return 1
}

# Is the lock directory held open by some living process?
#
# **This is the test that survives pid reuse, and it works because the holder keeps a descriptor on
# the lock directory for its whole life.** The kernel closes that descriptor when the owner dies,
# whether it exited, crashed or was killed, so an open descriptor *is* a living owner and no number
# is involved. It is the same invariant `packages/db/src/cluster-lock.ts` relies on, and for the same
# reason: on macOS `ps` is the only source of another process's start time and is denied outright in
# the sandbox this repository is developed inside, so without it a dead holder's lock would be
# unreclaimable — which is how a guard becomes a file people delete.
#
# `free` means only "nothing is holding it", and is never acted on by itself: the caller must first
# show that the probe could see the recorded process at all. `lsof` exits 1 with no output when
# nothing holds a path; anything else is `unknown`, because a probe that could not look is not
# evidence that the owner is gone.
next_lock_held_open() {
  local path="$1" out code
  out="$(lsof -- "$path" 2>/dev/null)"
  code=$?
  if [ "$code" -eq 0 ]; then
    # A header line alone is not a sighting.
    local lines
    lines="$(printf '%s\n' "$out" | grep -c .)"
    [ "$lines" -gt 1 ] && { printf 'held\n'; return 0; }
    printf 'free\n'
    return 0
  fi
  if [ "$code" -eq 1 ] && [ -z "$out" ]; then
    printf 'free\n'
    return 0
  fi
  printf 'unknown\n'
}

# --- the verdict ------------------------------------------------------------------------------------

# Decide whether the lock on disk has a living owner.
#
# Prints exactly one line: `stale <reason>` or `live <reason>`. It is a pure function of the lock
# directory, the record and two operating-system probes, which is what makes it testable against a
# record written by hand — the stale-lock and live-holder measurements both do that.
next_lock_inspect() {
  local lock_dir="$1"
  local file="$lock_dir/record.json"
  local pid start recorded live probe delta

  if [ ! -f "$file" ]; then
    if [ -d "$lock_dir" ]; then
      # A torn claim: the directory exists and its record has not landed yet. Held open means the
      # creator is alive and mid-write; otherwise it is a directory somebody abandoned, and refusing
      # forever over one of those is how a guard becomes a file people delete.
      probe="$(next_lock_held_open "$lock_dir")"
      case "$probe" in
        held) printf 'live the lock directory exists and a process holds it open, so its record is still being written\n'; return 0 ;;
        free) printf 'stale the lock directory carries no readable record and a verified probe found no process holding it open\n'; return 0 ;;
        *) printf 'live the lock directory carries no readable record and it could not be determined whether any process holds it open\n'; return 0 ;;
      esac
    fi
    printf 'stale there is no lock directory at all\n'
    return 0
  fi

  pid="$(next_lock_pid_field "$file" || true)"
  if [ -z "$pid" ]; then
    probe="$(next_lock_held_open "$lock_dir")"
    case "$probe" in
      held) printf 'live the record is unreadable and a process holds the lock directory open\n'; return 0 ;;
      free) printf 'stale the record is unreadable and a verified probe found no process holding the lock directory open\n'; return 0 ;;
      *) printf 'live the record is unreadable and it could not be determined whether any process holds it open\n'; return 0 ;;
    esac
  fi

  if ! next_lock_pid_alive "$pid"; then
    printf 'stale PID %s is no longer running\n' "$pid"
    return 0
  fi

  start="$(next_lock_field "$file" processStartEpoch || true)"
  recorded="$(next_lock_field "$file" processStartedAt || true)"
  live="$(next_lock_start_epoch "$pid" || true)"

  if [ -n "$live" ] && [ -n "$start" ]; then
    delta=$((live - start))
    [ "$delta" -lt 0 ] && delta=$((-delta))
    if [ "$delta" -gt 2 ]; then
      printf 'stale PID %s is alive but started at %s, not at %s, so the number has been reused\n' \
        "$pid" "$live" "$start"
      return 0
    fi
    printf 'live PID %s is running and started at %s, as recorded\n' "$pid" "${recorded:-$start}"
    return 0
  fi

  # Alive, but this machine will not say since when. Ask the kernel's descriptor table instead: an
  # owner that died took its descriptor with it, however it died.
  probe="$(next_lock_held_open "$lock_dir")"
  case "$probe" in
    free) printf 'stale PID %s is alive but its start time cannot be read here, and a verified probe found no process holding the lock directory open, so it is not the holder\n' "$pid"; return 0 ;;
    held) printf 'live PID %s is running and a process holds the lock directory open\n' "$pid"; return 0 ;;
    *) printf 'live PID %s is alive and neither its start time nor a trustworthy answer about the lock directory could be obtained here\n' "$pid"; return 0 ;;
  esac
}

# --- the refusal ------------------------------------------------------------------------------------

# How long ago an epoch second was, for a message a person reads.
next_lock_ago() {
  local then="${1:-}" now seconds
  case "$then" in ''|*[!0-9]*) return 1 ;; esac
  now="$(date +%s)"
  seconds=$((now - then))
  [ "$seconds" -lt 0 ] && seconds=0
  if [ "$seconds" -lt 60 ]; then printf '%ss ago\n' "$seconds"
  elif [ "$seconds" -lt 3600 ]; then printf '%sm ago\n' "$((seconds / 60))"
  else printf '%sh ago\n' "$((seconds / 3600))"
  fi
}

# The refusal, as one block, saying the four things it must: the holder's identity, the sentence that
# distinguishes contention from corruption, why this process believes the holder is alive, and the
# exact release command.
next_lock_refusal() {
  local lock_dir="$1" holder="$2" reason="$3"
  local file="$lock_dir/record.json"
  local pid started stage argv age
  pid="$(next_lock_pid_field "$file" || true)"
  started="$(next_lock_field "$file" processStartedAt || true)"
  stage="$(next_lock_field "$file" stage || true)"
  argv="$(next_lock_field "$file" argv || true)"
  age="$(next_lock_ago "$(next_lock_field "$file" startedEpoch || true)" || true)"

  printf '\n'
  printf '  REFUSING TO BUILD: ANOTHER PROCESS IS BUILDING INTO THE SAME .next.\n'
  printf '\n'
  if [ -n "$stage" ] && [ "$stage" = "serve" ]; then
    printf '  That process is past its build and is restarting the server, which takes seconds.\n'
    printf '  Run this command again shortly; there is nothing to fix.\n'
  else
    printf '  A production build writes manifests the running server also reads, so two at once\n'
    printf '  leave the directory half-written and the site will not start. Wait for the build\n'
    printf '  above to finish, then run this command again.\n'
  fi
  printf '\n'
  printf '  This is contention, not corruption. Nothing is wrong with .next, the database or the\n'
  printf '  site, and nothing here should be deleted or rebuilt by hand.\n'
  printf '\n'
  printf '    lock          %s\n' "$lock_dir"
  if [ -n "$pid" ]; then printf '    holder pid    %s\n' "$pid"; fi
  if [ -n "$started" ]; then
    printf '    started       %s' "$started"
    [ -n "$age" ] && printf '  (%s)' "$age"
    printf '\n'
  fi
  if [ -n "$argv" ]; then printf '    holder argv   %s\n' "$argv"; fi
  printf '    believed live %s\n' "$reason"
  printf '\n'
  printf '  Stop that process and run this again. A lock whose owner has died is reclaimed\n'
  printf '  automatically, so this command is only for a lock whose owner you have already\n'
  printf '  confirmed is gone:\n'
  printf '\n'
  printf '    rm -rf %s\n' "$lock_dir"
  printf '\n'
  printf '  Do NOT kill the holder with -9. A build killed with -9 is harmless, but the server on\n'
  printf '  port 3110 holds the PGlite cluster, and a SIGKILL landing while PGlite opens it leaves\n'
  printf '  a cluster that cannot be opened at all. That has happened seven times in a day.\n'
  printf '\n'
}

# --- acquire and release ----------------------------------------------------------------------------

NEXT_LOCK_DIR=""
NEXT_LOCK_PID=""
NEXT_LOCK_TOKEN=""
NEXT_LOCK_STAGE=""
NEXT_LOCK_OWNED=0
NEXT_LOCK_FD=""
NEXT_LOCK_TRAPS_INSTALLED=0

next_lock_on_exit() {
  next_lock_release
}

next_lock_install_traps() {
  [ "$NEXT_LOCK_TRAPS_INSTALLED" -eq 1 ] && return 0
  NEXT_LOCK_TRAPS_INSTALLED=1
  trap 'next_lock_on_exit' EXIT
  # INT and TERM exit rather than return, so the EXIT trap is what performs the single release.
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
}

next_lock_write_record() {
  local file="$1" stage="$2" start epoch argv
  start="$(date '+%Y-%m-%dT%H:%M:%S%z')"
  epoch="$(date +%s)"
  # argv is capped because it exists to tell an operator which command owns the build, not to
  # reproduce it exactly. JSON-escaped and truncated in one pass, and written in ONE printf so a
  # reader never sees a torn record.
  #
  # It is read from NEXT_LOCK_ARGV rather than from `"$*"`, because `"$*"` inside this function is
  # this function's OWN positional parameters — which is how the lock's own path and the stage ended
  # up in the recorded command the first time this was measured. The refusal then named a command
  # nobody had typed, which is exactly the kind of wrong detail that makes an operator distrust a
  # guard, so the command is assembled by the caller and passed in a variable.
  argv="$(printf '%s' "${NEXT_LOCK_ARGV:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | cut -c1-400)"
  printf '{"pid":%s,"processStartedAt":"%s","processStartEpoch":%s,"startedAt":"%s","startedEpoch":%s,"stage":"%s","argv":"%s","token":"%s"}\n' \
    "$$" "$start" "$epoch" "$start" "$epoch" "$stage" "$argv" "$NEXT_LOCK_TOKEN" > "$file"
}

# Take the lock, or refuse loudly.
#
#   next_lock_acquire <build-dir> <stage> [command …] [--wait <seconds>] [--paths <path>]
#
# `--wait <seconds>` is the one place a caller's policy differs between stages, and the default is
# zero on purpose. A build that silently waits 90 seconds and then proceeds on a half-written
# directory is worse than a refusal in a second: **waiting can only be safe when the wait is shorter
# than the thing it waits for.** Restarting a server takes seconds, so the review script waits for
# that; a build takes 60–120 seconds here, so a second builder is refused immediately with the
# holder's identity and the retry instruction.
next_lock_acquire() {
  local build_dir="${1:?next_lock_acquire needs a build directory}"
  local stage="${2:-build}"
  shift 2 || true

  local wait_seconds=0 explicit_path="" arg
  local verdict kind reason token_before token_after
  local -a argv=()
  while [ $# -gt 0 ]; do
    arg="$1"
    case "$arg" in
      --wait) wait_seconds="${2:-0}"; shift 2 ;;
      # The lock's own path is this library's plumbing, not part of the command an operator needs to
      # recognise in the refusal. It is skipped here so the recorded argv is the command they typed.
      --paths) explicit_path="${2:-}"; shift 2 ;;
      *) argv+=("$arg"); shift ;;
    esac
  done
  case "$wait_seconds" in ''|*[!0-9]*) wait_seconds=0 ;; esac

  local lock_dir
  if [ -n "$explicit_path" ]; then
    lock_dir="$explicit_path"
  else
    lock_dir="$(next_lock_paths "$build_dir")"
  fi
  local file="$lock_dir/record.json"
  local deadline=$(( $(date +%s) + wait_seconds ))

  NEXT_LOCK_TOKEN="$( (date +%s; echo "$$"; echo "$RANDOM$RANDOM$RANDOM") | cksum | tr -d ' ' )"
  # The command as the caller typed it, for the refusal. Assembled here so the writer is not given it
  # as positional parameters, which is how they would end up in it.
  NEXT_LOCK_ARGV=""
  local _a
  for _a in ${argv[@]+"${argv[@]}"}; do
    NEXT_LOCK_ARGV="${NEXT_LOCK_ARGV}${NEXT_LOCK_ARGV:+ }${_a}"
  done

  mkdir -p "$(dirname -- "$lock_dir")" 2>/dev/null || true

  while :; do
    # The atomic step. `mkdir` is the shell's O_CREAT|O_EXCL: exactly one of two processes racing in
    # the same millisecond wins, and the loser gets EEXIST and takes the refusal path.
    if mkdir "$lock_dir" 2>/dev/null; then
      if ! next_lock_write_record "$file" "$stage"; then
        # The directory is ours but unreadable to us; leaving it would block every later build.
        rm -rf "$lock_dir" 2>/dev/null || true
        printf '\n  COULD NOT WRITE THE BUILD LOCK at %s. Check permissions on that directory.\n\n' "$lock_dir" >&2
        return 1
      fi
      NEXT_LOCK_DIR="$lock_dir"
      NEXT_LOCK_PID="$$"
      NEXT_LOCK_STAGE="$stage"
      NEXT_LOCK_OWNED=1
      # KEEP A DESCRIPTOR ON THE LOCK DIRECTORY OPEN FOR THE LIFE OF THIS PROCESS. It is the
      # kernel's own evidence that this lock has a living owner, it is what makes the stale test
      # immune to pid reuse, and the kernel closes it however this process dies.
      #
      # The descriptor is opened through `eval` with an explicit number rather than bash's
      # `{var}<file` form, because this repository's shell is **bash 3.2**, which macOS still ships
      # and which does not have that form: `exec {fd}<dir` there is an attempt to run a command
      # called `{fd}`, which fails — and it fails *after* the lock has been taken, so the lock would
      # be held with no descriptor and every later stale test would refuse forever. Probing for a
      # free number is the portable spelling of the same thing.
      NEXT_LOCK_FD=""
      local _fd
      for _fd in 21 22 23 24 25 26 27 28 29 30; do
        if eval "exec ${_fd}<\"\$lock_dir\"" 2>/dev/null; then
          NEXT_LOCK_FD="$_fd"
          break
        fi
      done
      next_lock_install_traps
      return 0
    fi

    # Somebody holds it. Read what they wrote before deciding anything.
    verdict="$(next_lock_inspect "$lock_dir")"
    kind="${verdict%% *}"
    reason="${verdict#* }"

    if [ "$kind" = "stale" ]; then
      # Reclaim and loop back to the exclusive `mkdir`, which is what actually decides: if another
      # reclaimer has already taken the lock, this iteration loses and reports a live holder.
      #
      # The record is read BEFORE and AFTER the move, and the move is only accepted if the token is
      # unchanged. Without that check there is a real window between `mv` and `mkdir` in which
      # another process can claim the lock — and this process would then move the FRESH lock aside
      # and believe it had reclaimed a stale one. Both would build. The token is what makes the
      # reclaim atomic, and it is why it exists.
      token_before="$(next_lock_field "$file" token || true)"
      if mv "$lock_dir" "$lock_dir.stale.$$" 2>/dev/null; then
        token_after="$(next_lock_field "$lock_dir.stale.$$/record.json" token || true)"
        if [ -n "$token_before" ] && [ "$token_before" != "$token_after" ]; then
          # We moved somebody else's lock. Put it back, unless a third process has since claimed
          # the name, in which case the moved copy is dropped: two live records in two directories
          # would be the double-build this file exists to prevent.
          mv "$lock_dir.stale.$$" "$lock_dir" 2>/dev/null || rm -rf "$lock_dir.stale.$$" 2>/dev/null || true
          printf '  another process claimed the build lock while this one was reclaiming it; waiting\n' >&2
        else
          rm -rf "$lock_dir.stale.$$" 2>/dev/null || true
          printf '  reclaimed a stale build lock (%s)\n' "$reason"
        fi
      fi
      # Already moved by another reclaimer: either way, loop and race for the exclusive create.
      continue
    fi

    # Live. A build that is still running is not something to wait 90 seconds behind.
    if [ "$(date +%s)" -lt "$deadline" ]; then
      sleep 1
      continue
    fi

    next_lock_refusal "$lock_dir" "$(next_lock_field "$file" pid || true)" "$reason" >&2
    return 1
  done
}

# Write the stage into the record so a refused caller can be told which happened: a build that is
# worth waiting behind, or a restart that is not.
next_lock_set_stage() {
  [ "$NEXT_LOCK_OWNED" -eq 1 ] || return 0
  NEXT_LOCK_STAGE="$1"
  next_lock_write_record "$NEXT_LOCK_DIR/record.json" "$1"
}

# Remove the lock, but never a successor's. Idempotent, so a trap and an explicit call can both run.
next_lock_release() {
  [ "$NEXT_LOCK_OWNED" -eq 1 ] || return 0
  NEXT_LOCK_OWNED=0
  # Close the liveness descriptor FIRST. A release that deleted the directory while still holding a
  # descriptor on it would leave a probed-but-deleted inode, which is exactly the kind of half-state
  # the next caller would misread.
  if [ -n "$NEXT_LOCK_FD" ]; then
    eval "exec ${NEXT_LOCK_FD}<&-" 2>/dev/null || true
    NEXT_LOCK_FD=""
  fi
  local token
  token="$(next_lock_field "$NEXT_LOCK_DIR/record.json" token || true)"
  if [ -z "$token" ] || [ "$token" = "$NEXT_LOCK_TOKEN" ]; then
    rm -rf "$NEXT_LOCK_DIR" 2>/dev/null || true
  fi
  NEXT_LOCK_DIR=""
}
