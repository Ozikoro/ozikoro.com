#!/usr/bin/env bash
#
# verify-round-308.sh — the HTTP pass for the pronunciation pipeline and the credit planner.
#
# IT TOUCHES NO DATABASE AND RUNS NO BUILD. **It only sends HTTP requests to a server that is already
# running**, which is deliberate: migration 0050 may not be applied yet and another process holds the
# cluster, so this script must be incapable of taking the lock itself. Start nothing; point it at a server.
#
# WHY EVERY CHECK PRINTS WHAT IT READ RATHER THAN ITS STATUS
#
# Round 280's lesson, restated by round 305's own script: **three faults in this project looked exactly like
# working pages.** A 200 says the route compiled. It does not say the planner printed a real character count,
# that the rate's verification sentence matches reality, that the queue listed a word and the records it
# appears in, or that an approval with nothing behind it was refused. So each check below prints the number
# or the sentence it found.
#
# THE ONE THING THIS SCRIPT CANNOT PROVE, AND SAYS SO
#
# **No ElevenLabs credit may be spent, so the render is never called.** The approval gate's DECISION is
# proven in `test-pronunciation.ts`, which is a database test on a copy; what is checked here is that the
# page and the refusal exist and read correctly over HTTP. A green run here is not evidence that a render
# works, and this script does not claim it.
#
# USAGE
#   bash scripts/verify-round-308.sh                    # assumes http://127.0.0.1:3110
#   PORT=4000 bash scripts/verify-round-308.sh
#
# THE PASSWORD IS NOT DEFAULTED HERE, ON PURPOSE.
#
# A sibling script in this directory carries the owner's password as a shell default, which puts a working
# credential in a tracked file. **This one does not.** The signed-in sections are skipped with a message when
# `OWNER_PASSWORD` is not in the environment, so the script is useful without it (the signed-out checks run)
# and a credential never has to exist on disk for a verification pass:
#
#   OWNER_PASSWORD='…' bash scripts/verify-round-308.sh
set -uo pipefail

PORT="${PORT:-3110}"
BASE="${BASE:-http://127.0.0.1:$PORT}"
LOG="${LOG:-/tmp/ozikoro-review-$PORT.log}"
OWNER_EMAIL="${OWNER_EMAIL:-idenzeme@gmail.com}"
# Read from the environment and NOT defaulted. See the note above.
OWNER_PASSWORD="${OWNER_PASSWORD:-}"
JAR="$(mktemp -t oz-verify-308)"

failures=0
pass () { printf '  ok    %s\n' "$1"; }
fail () { printf '  FAIL  %s  — %s\n' "$1" "$2"; failures=$((failures + 1)); }
info () { printf '        %s\n' "$1"; }

code () { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }
body () { curl -s --max-time 25 "$@"; }

# The page as a person reads it: React's interleaved comment nodes removed, scripts removed, tags stripped.
plain () {
  python3 -c "
import re, sys, html
t = sys.stdin.read()
t = re.sub(r'<!--.*?-->', ' ', t, flags=re.S)
t = re.sub(r'<script[\s\S]*?</script>', ' ', t)
t = re.sub(r'<style[\s\S]*?</style>', ' ', t)
print(re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t))))
"
}
# A number as a person reads it, without the thousands separator — 1,051 is a syntax error to `[`.
digits () { printf '%s' "$1" | tr -d ','; }

echo
echo "== 1. the deliverable is untouched =="
parity="$(python3 - <<'PY'
import hashlib, pathlib
src = pathlib.Path('design/calm-comfort-construct/public/design')
dst = pathlib.Path('apps/ozikoro/public/design')
s = d = m = 0
for f in src.rglob('*'):
    if f.is_dir():
        continue
    x = dst / f.relative_to(src)
    if not x.exists():
        m += 1
    elif hashlib.sha256(f.read_bytes()).hexdigest() == hashlib.sha256(x.read_bytes()).hexdigest():
        s += 1
    else:
        d += 1
print(f'identical {s} differing {d} missing {m}')
PY
)"
[ "$parity" = "identical 63 differing 0 missing 0" ] && pass "design parity: $parity" || fail "design parity" "$parity"

if [ -f "$LOG" ]; then
  n="$(grep -c 'design fill failed' "$LOG" 2>/dev/null || true)"
  [ "${n:-0}" = "0" ] && pass "0 'design fill failed' lines in $LOG" || fail "design-fill failures" "$n in $LOG"
else
  info "no log at $LOG — not treated as a failure, the server may be logging elsewhere"
fi

echo
echo "== 2. signed out, the queue is not handed to anybody with the URL =="
c="$(code "$BASE/admin/pronunciation")"
case "$c" in
  303|307|302) pass "signed out /admin/pronunciation  →  $c (a redirect, as /admin requires)" ;;
  404)
    # A 404 here means the route is not in the build that is serving. It is not a leak, and it is not a pass
    # either — it means NOTHING about this round has been verified over HTTP.
    fail "signed out /admin/pronunciation" "HTTP 404 — the running build predates this round's page, so nothing below can be verified. Rebuild and serve (scripts/build-and-serve-once.sh), then re-run."
    ;;
  200)
    # A redirect status is not a guarantee the body is empty — the note in `lib/access.ts` records a
    # measured case where a guarded page streamed 32 KB of real rows behind a 307. So a 200 is checked for
    # leaked content rather than assumed to be a fallback.
    leaked="$(body "$BASE/admin/pronunciation" | plain | grep -c -i 'cannot say\|recorded\|pronunciation queue' || true)"
    fail "signed out /admin/pronunciation" "HTTP 200 with $leaked content signal(s) — the page rendered for an anonymous request"
    ;;
  *) fail "signed out /admin/pronunciation" "HTTP $c" ;;
esac

echo
echo "== 3. signed in as the owner =="
if [ -z "$OWNER_PASSWORD" ]; then
  info "OWNER_PASSWORD is not set, so the signed-in sections are SKIPPED rather than faked."
  info "Re-run as:  OWNER_PASSWORD='…' bash scripts/verify-round-308.sh"
  info "Sections 4 to 7 are the ones that matter and none of them has run."
  rm -f "$JAR"
  echo
  echo "INCOMPLETE — the signed-out checks passed, the rest did not run"
  echo
  exit 1
fi
c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -c "$JAR" -X POST "$BASE/api/auth/signin" \
      -H 'content-type: application/x-www-form-urlencoded' \
      --data-urlencode "email=$OWNER_EMAIL" --data-urlencode "password=$OWNER_PASSWORD")"
if [ "$c" != "303" ]; then
  fail "sign in" "HTTP $c — sections 3 to 6 cannot run"
else
  pass "sign in as $OWNER_EMAIL"

  echo
  echo "== 4. the planner reads, and prints real numbers =="
  c="$(code -b "$JAR" "$BASE/admin/pronunciation")"
  if [ "$c" = "500" ]; then
    fail "/admin/pronunciation" "HTTP 500 — the most likely cause is that migration 0050 is NOT applied to this cluster; the page reads ozikoro_pronunciation"
  elif [ "$c" = "404" ]; then
    fail "/admin/pronunciation" "HTTP 404 — the route is not in the running build; rebuild and re-run"
  elif [ "$c" != "200" ]; then
    fail "/admin/pronunciation" "HTTP $c"
  else
    pass "signed in /admin/pronunciation  →  200"
    page="$(body -b "$JAR" "$BASE/admin/pronunciation" | plain)"

    # THE PLAN — a real tier and allowance, or the honest sentence saying it could not be read. **Both are
    # acceptable and the check says which it found**, because "the API refused" is a true state and a test
    # that demanded numbers would fail on a deployment with no key rather than on a fault.
    if printf '%s' "$page" | grep -qi 'could not be read'; then
      pass "the plan says it could not be read, rather than showing zeros"
      info "$(printf '%s' "$page" | grep -o 'The ElevenLabs subscription could not be read[^.]*\.' | head -1)"
    else
      tier="$(printf '%s' "$page" | grep -o 'Tier [A-Za-z]*' | head -1)"
      [ -n "$tier" ] && pass "the plan names its tier: $tier" || fail "the plan" "no tier printed"
    fi

    # THE CORRECTION, which is the point of the planner. Both figures must be present and the spoken one
    # must be the SMALLER — if they were ever equal the transform has stopped doing anything.
    spoken="$(printf '%s' "$page" | grep -o 'Counted from [0-9,]* published records: [0-9,]* characters of spoken script, against [0-9,]* characters of page markup' | head -1)"
    if [ -z "$spoken" ]; then
      fail "the archive's spoken length" "the page does not print the spoken-versus-markup comparison"
    else
      a="$(digits "$(printf '%s' "$spoken" | sed -n 's/.*: \([0-9,]*\) characters of spoken.*/\1/p')")"
      b="$(digits "$(printf '%s' "$spoken" | sed -n 's/.*against \([0-9,]*\) characters of page markup.*/\1/p')")"
      if [ -z "$a" ] || [ -z "$b" ]; then
        fail "the archive's spoken length" "could not parse both figures from: $spoken"
      elif [ "$a" -lt "$b" ]; then
        pass "spoken $a < markup $b — the billed length is smaller, as it must be"
      else
        fail "the archive's spoken length" "spoken $a is NOT smaller than markup $b — the transform is doing nothing"
      fi
    fi

    records_month="$(printf '%s' "$page" | grep -o '[0-9,]* records a month' | head -1)"
    [ -n "$records_month" ] && pass "the allowance expressed in records: $records_month" \
      || info "no 'records a month' figure — the plan is unknown on this deployment, which the page states"

    # THE RATE. Either it has been checked or it has not, and the page must not claim the first without the
    # second. This is the check that keeps "one credit per character" from reading as verified when it is not.
    if printf '%s' "$page" | grep -q 'has never been checked against a real charge'; then
      pass "the rate is reported as UNVERIFIED, which is the true state until a render is measured"
    elif printf '%s' "$page" | grep -q 'It has been checked against'; then
      m="$(printf '%s' "$page" | grep -o 'It has been checked against [0-9,]* real renders\?: [0-9,]* credits charged against an estimate of [0-9,]* — [0-9.]*× the estimate' | head -1)"
      pass "the rate is reported as VERIFIED: $m"
      info "confirm this figure against the account before believing it — measured_credits is only as good as the render that wrote it"
    else
      fail "the rate" "the page says neither that the rate is verified nor that it is unchecked"
    fi

    echo
    echo "== 5. the queue prints the words AND the records that need them =="
    if printf '%s' "$page" | grep -q 'Words the archive cannot say'; then
      heading="$(printf '%s' "$page" | grep -o 'Words the archive cannot say ([0-9,]* blocking)' | head -1)"
      pass "the queue is on the page: $heading"
      # THE ARTICLE LIST IS THE POINT — the owner's "worth recording" test. A queue that printed a count and
      # no records would pass a status check and be useless.
      if printf '%s' "$page" | grep -q 'record[s]* this appears in\|this appears in'; then
        pass "the queue lists the records each word appears in"
      elif printf '%s' "$page" | grep -qi 'Nothing is waiting'; then
        pass "the queue is honestly empty and says so"
      else
        info "the word list is present; the per-word record list was not detected (it may be inside a <details>)"
      fi
    else
      fail "the queue" "the page has no words-the-archive-cannot-say section"
    fi

    # THE EVIDENCE GRADES, so an editor can see what a hit means.
    if printf '%s' "$page" | grep -q 'a recording held by the archive and approved'; then
      pass "the page explains what each grade of evidence means"
    else
      fail "the grades" "the grade table is missing"
    fi

    echo
    echo "== 6. the approval gate's refusal exists over HTTP =="
    # AN APPROVAL WITH NOTHING BEHIND IT MUST BE REFUSED, and this changes nothing: it names a word that has
    # no recording and no respelling, so the platform refuses before any write. The notice is what a person
    # would see.
    out="$(curl -s -o /tmp/oz-308-post -w '%{http_code}' --max-time 20 -b "$JAR" -X POST "$BASE/api/admin/pronunciation" \
            -H 'content-type: application/x-www-form-urlencoded' \
            --data-urlencode 'action=approve' --data-urlencode 'id=1' --data-urlencode 'returnTo=/admin/pronunciation/')"
    location="$(curl -s -o /dev/null -D - --max-time 20 -b "$JAR" -X POST "$BASE/api/admin/pronunciation" \
            -H 'content-type: application/x-www-form-urlencoded' \
            --data-urlencode 'action=approve' --data-urlencode 'id=1' --data-urlencode 'returnTo=/admin/pronunciation/' \
            | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | head -1)"

    if [ "$out" = "303" ]; then
      case "$location" in
        *error=*)
          pass "approving a word with nothing behind it is refused with a notice"
          info "$(python3 -c "
import sys, urllib.parse
q = urllib.parse.urlparse('''$location''').query
print(urllib.parse.parse_qs(q).get('error', [''])[0][:200])
")"
          ;;
        *saved=*)
          fail "the approval gate" "an approval with NO recording and NO respelling was ACCEPTED: $location"
          ;;
        *) info "303 to $location — no notice parameter, which the form caller always sets" ;;
      esac
    elif [ "$out" = "404" ]; then
      # No row with id 1 in the queue is a legitimate state on a fresh database, and it must be a refusal.
      pass "approving a word that is not in the queue  →  404, a refusal rather than a write"
    else
      fail "the approval gate" "HTTP $out (expected 303 with an error notice, or 404)"
    fi

    # A LONE POST WITH NO ACTION IS REFUSED, not a 500. Round 305 found a bare POST answering 500 on seven
    # routes because `request.formData()` throws on a bodyless request; this route reads the body itself, so
    # the same fault is checked here.
    c="$(code -b "$JAR" -X POST "$BASE/api/admin/pronunciation" -H 'content-type: application/x-www-form-urlencoded' --data 'action=')"
    [ "$c" = "400" ] && pass "an unknown action  →  400" || fail "an unknown action" "HTTP $c (400 expected)"

    # Cross-origin POST is refused by `sameOrigin`. Nothing is written.
    c="$(code -b "$JAR" -X POST "$BASE/api/admin/pronunciation" \
          -H 'content-type: application/x-www-form-urlencoded' -H 'origin: https://evil.example' \
          -H "host: 127.0.0.1:$PORT" --data 'action=digest&dryRun=1')"
    if [ "$c" = "303" ] || [ "$c" = "403" ]; then
      pass "a cross-origin POST  →  $c (refused, and no mail is sent)"
    else
      fail "cross-origin POST" "HTTP $c — expected a refusal"
    fi

    echo
    echo "== 7. the digest can be composed without sending it =="
    loc="$(curl -s -o /dev/null -D - --max-time 25 -b "$JAR" -X POST "$BASE/api/admin/pronunciation" \
          -H 'content-type: application/x-www-form-urlencoded' \
          --data-urlencode 'action=digest' --data-urlencode 'dryRun=1' --data-urlencode 'returnTo=/admin/pronunciation/' \
          | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | head -1)"
    if printf '%s' "$loc" | grep -q 'saved='; then
      notice="$(python3 -c "
import urllib.parse
q = urllib.parse.urlparse('''$loc''').query
print(urllib.parse.parse_qs(q).get('saved', [''])[0][:240])
")"
      case "$notice" in
        *'Nothing was sent'*) pass "a dry run composes and sends nothing"; info "$notice" ;;
        *'Sent to'*) fail "the dry run" "a dry run SENT the message: $notice" ;;
        *) info "dry run answered: $notice" ;;
      esac
    else
      fail "the digest dry run" "no saved= notice; location was: ${loc:-none}"
    fi
  fi
fi

rm -f "$JAR" /tmp/oz-308-post
echo
if [ "$failures" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "$failures CHECK(S) FAILED"
fi
echo
exit $(( failures > 0 ? 1 : 0 ))
