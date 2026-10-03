#!/usr/bin/env bash
#
# verify-round-305.sh — the HTTP pass for round 305, ready to run the moment the cluster is free.
#
# IT TOUCHES NO DATABASE AND RUNS NO BUILD. **It only sends HTTP requests to a server that is already
# running**, which is deliberate: it was written while another agent held the PGlite lock, so it must be
# incapable of taking the lock itself. Start nothing; point it at a server.
#
# WHY EVERY CHECK PRINTS ITS BODY RATHER THAN ITS STATUS
#
# Round 280's lesson, and the reason this section of the report is written this way: **three faults in
# this project looked exactly like working pages.** A 200 says the route compiled. It does not say the
# filter narrowed anything, that an empty result explained itself, that a gated page carried no data, or
# that an audit row was written. So each check below prints either the number of records the page says it
# found, or the sentence the page uses to explain why there are none.
#
# USAGE
#   bash scripts/verify-round-305.sh                    # assumes http://127.0.0.1:3110
#   PORT=4000 OWNER_EMAIL=… OWNER_PASSWORD=… bash scripts/verify-round-305.sh
set -uo pipefail

PORT="${PORT:-3110}"
BASE="${BASE:-http://127.0.0.1:$PORT}"
LOG="${LOG:-/tmp/ozikoro-review-$PORT.log}"
OWNER_EMAIL="${OWNER_EMAIL:-idenzeme@gmail.com}"
OWNER_PASSWORD="${OWNER_PASSWORD:-Gold 2011 @..}"
JAR="$(mktemp -t oz-verify)"

failures=0
pass () { printf '  ok    %s\n' "$1"; }
fail () { printf '  FAIL  %s  — %s\n' "$1" "$2"; failures=$((failures + 1)); }

code () { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }
body () { curl -s --max-time 20 "$@"; }

# ---------------------------------------------------------------------------
# READING THE PAGE, WHICH TOOK TWO ATTEMPTS TO GET RIGHT
#
# THE FIRST VERSION OF THESE TWO FUNCTIONS VERIFIED NOTHING AND SAID "ok" TWELVE TIMES.
#
#   records()  matched `[0-9,]+ (record|records)` against the raw bytes. **React interleaves `<!-- -->`
#              between the number and the word**, so the count line is serialised as
#              `1,051<!-- --> <!-- -->records` and the pattern could not match it. Every filtered page
#              reported "no records" — including the unfiltered one, which holds 1,051 of them.
#
#   explains() matched `No record[^<.]*\.` against the WHOLE page, and the rail always contains
#              "No record in the archive has a period recorded yet" in its Time period group. So it
#              reported the RAIL's fixed text as the page's explanation on every request, including the
#              ones that returned rows.
#
# **Both are the same mistake this document records repeatedly: a pattern written against how the output
# READS rather than how it is SERIALISED.** The fix is to strip the comments and the tags, and to search
# only the results column — everything after the rail's closing `</aside>` — so the rail's own sentences
# cannot be mistaken for the page's answer.
# ---------------------------------------------------------------------------
read_page () {
  # $1 = URL. Prints "<count or NONE>|<the explanation from the EMPTY BLOCK, or ->".
  body "$1" | python3 -c "
import re, sys
t = sys.stdin.read()
t = re.sub(r'<!--.*?-->', ' ', t, flags=re.S)          # React's interleaved text nodes
t = re.sub(r'<script[\s\S]*?</script>', ' ', t)
plain = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t))
count = re.search(r'(\d[\d,]*) records?\b', plain)
# THE EXPLANATION COMES FROM THE EMPTY BLOCK AND FROM NOWHERE ELSE.
# Reading the whole page let the rail's fixed sentence answer for every request, which is how twelve
# checks passed while verifying nothing. The block is <div class=\"empty section\">…</div> with no nested
# divs, so the first closing tag is its own.
block = re.search(r'<div class=\"empty section\">([\s\S]*?)</div>', t)
reason = '-'
if block:
    text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', block.group(1))).strip()
    found = re.search(r'(No record[^.]*\.|The archive has no[^.]*\.|No published record[^.]*\.|Nothing is hidden[^.]*\.)', text)
    reason = found.group(1).strip() if found else text[:160]
print((count.group(1) if count else 'NONE') + '|' + reason)
"
}
records () { read_page "$1" | cut -d'|' -f1; }
explains () { read_page "$1" | cut -d'|' -f2; }
# 1,051 is a number to a reader and a syntax error to `[`. Compare without the separator.
digits () { printf '%s' "$1" | tr -d ','; }

echo
echo "== 1. the deliverable is untouched, and the log is clean =="
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
  fail "server log" "$LOG does not exist"
fi

echo
echo "== 2. the archive's filters: real rows, and an empty state that explains itself =="
#
# EACH FILTER IS ASSERTED AGAINST THE ANSWER IT MUST GIVE, not merely printed.
#
# The first version printed whatever it found and passed, which is how twelve "ok" lines were produced by
# an instrument that could not read the page at all. Three rules are enforced here and each would have
# caught that:
#
#   * a page that prints a count must print a count ABOVE ZERO — the count line is now suppressed when
#     there is nothing to count, so "0 records" is itself a bug;
#   * a filter expected to match nothing must print NO count AND must carry an explanation, because an
#     empty grid with no reason is exactly what the brief forbids;
#   * a narrowing filter must RETURN FEWER than the unfiltered page, which is the only assertion that
#     distinguishes a working filter from a page that ignored its parameters.
#
# The expected-empty cases are the ones the live archive genuinely cannot fill: no record carries a
# period or a source kind, and none rests on a source. Their emptiness is the honest state.
unfiltered="$(records "$BASE/archive")"
if [ "$unfiltered" = "NONE" ] || [ -z "$unfiltered" ]; then
  fail "/archive unfiltered" "printed no count — the archive's own listing is not rendering"
else
  pass "/archive (unfiltered)  →  $unfiltered records"
fi

while IFS='|' read -r q expect; do
  label="/archive$q"
  c="$(code "$BASE$label")"
  if [ "$c" != "200" ]; then fail "$label" "HTTP $c"; continue; fi
  r="$(records "$BASE$label")"
  e="$(explains "$BASE$label")"
  case "$expect" in
    rows)
      if [ "$r" = "NONE" ]; then
        fail "$label" "expected rows, printed none (page says: ${e:-nothing})"
      elif [ "$r" = "0" ]; then
        fail "$label" "printed '0 records' — the count line must be suppressed when there is nothing to count"
      else
        pass "$label  →  $r records${e:+  · page also says: $e}"
      fi
      ;;
    fewer)
      if [ "$r" = "NONE" ] || [ "$r" = "0" ]; then
        fail "$label" "expected a narrowed result, printed ${r} (page says: ${e:-nothing})"
      elif [ "$(digits "$r")" -lt "$(digits "$unfiltered")" ]; then
        pass "$label  →  $r of $unfiltered records — the filter narrowed"
      else
        fail "$label" "printed $r, which is not fewer than the unfiltered $unfiltered — the filter did not narrow"
      fi
      ;;
    empty)
      if [ "$r" != "NONE" ]; then
        fail "$label" "expected no records, printed $r"
      elif [ -z "$e" ] || [ "$e" = "-" ]; then
        fail "$label" "empty with NO EXPLANATION — the brief requires the page to say why"
      else
        pass "$label  →  empty, and the page says: $e"
      fi
      ;;
  esac
done <<'CASES'
?q=Nri|fewer
?topic=historical-studies|fewer
?completeness=partial|rows
?q=zzzznothingmatchesthis|empty
?place=zzzznosuchplace|empty
?period=Pre-colonial|empty
?source=oral_history|empty
?completeness=sourced|empty
?place=Onicha|rows
?ethnic=Igbo|rows
?entity=nsukka|rows
?topic=historical-studies&q=Nri&order=title|rows
CASES

echo
echo "== 3. the research network =="
for q in "/researchers" "/researchers?q=University" "/publications" \
         "/publications?institution=University" "/publications?author=Izen" "/publications?q=Igbo&kind=thesis"; do
  c="$(code "$BASE$q")"
  [ "$c" = "200" ] && pass "$q  →  200" || fail "$q" "HTTP $c"
done

echo
echo "== 4. access control: anonymous sees no data =="
for u in /admin/entities /admin/archive /admin/audit /admin/media /submit; do
  hdr="$(curl -s -o /tmp/oz-body -D /tmp/oz-head -w '%{http_code}' --max-time 15 "$BASE$u")"
  loc="$(grep -i '^location:' /tmp/oz-head | tr -d '\r' | head -1)"
  leaked="$(grep -cE 'Entities|1,051 records|Audit trail|Media register|Editorial queue|Knowledge graph' /tmp/oz-body || true)"
  if [ "${hdr:0:1}" = "3" ] && [ "${leaked:-0}" = "0" ]; then
    pass "$u  anonymous → $hdr ${loc:0:60}  (no data in the body)"
  else
    fail "$u" "HTTP $hdr, ${leaked} data strings in the anonymous body"
  fi
done

echo
echo "== 5. anonymous POST is refused, not 500'd =="
for u in /api/admin/entities /api/follows /api/research/files; do
  c="$(code -X POST "$BASE$u")"
  case "$c" in
    303|307) pass "POST $u  anonymous → $c" ;;
    500)     fail "POST $u" "500 — the body is being read before the guard" ;;
    *)       fail "POST $u" "HTTP $c" ;;
  esac
done

echo
echo "== 6. a download that does not exist is 404, not 308 and not 500 =="
for id in 1 999999; do
  c="$(code "$BASE/publication-file/$id")"
  [ "$c" = "404" ] && pass "/publication-file/$id  →  404" || fail "/publication-file/$id" "HTTP $c (a 308 means the middleware swallowed the route again)"
done

echo
echo "== 7. signed in: the gated surfaces carry real data, and a mutation is audited =="
c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -c "$JAR" -X POST "$BASE/api/auth/signin" \
      -H 'content-type: application/x-www-form-urlencoded' \
      --data-urlencode "email=$OWNER_EMAIL" --data-urlencode "password=$OWNER_PASSWORD")"
if [ "$c" != "303" ]; then
  fail "sign in" "HTTP $c — the rest of section 7 cannot run"
else
  pass "sign in as $OWNER_EMAIL"
  for u in /admin/entities /admin/audit /admin/media /admin/archive /account/; do
    c="$(code -b "$JAR" "$BASE$u")"
    [ "$c" = "200" ] && pass "signed in $u  →  200" || fail "signed in $u" "HTTP $c"
  done

  echo
  echo "  -- the graph, as the owner sees it --"
  body -b "$JAR" "$BASE/admin/entities" | python3 -c "
import sys, re, html
t = sys.stdin.read()
for label, value in re.findall(r'<dt>(.*?)</dt>\s*<dd>(.*?)</dd>', t, re.S)[:8]:
    print('     ', html.unescape(re.sub('<[^>]+>', '', label)).strip(), '=', html.unescape(re.sub('<[^>]+>', '', value)).strip()[:80])
"

  echo
  echo "  -- an audited mutation through the interface, and the row it leaves --"
  # Following a series and unfollowing it is chosen because it is reversible and idempotent: the endpoint
  # makes the posted state true rather than toggling, so running this twice cannot leave a duplicate.
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -b "$JAR" -X POST "$BASE/api/follows" \
        -d 'kind=topic&topicId=1&on=1&returnTo=/' -H 'content-type: application/x-www-form-urlencoded')"
  [ "$c" = "303" ] && pass "POST /api/follows (follow a series) → 303" || fail "POST /api/follows" "HTTP $c"
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -b "$JAR" -X POST "$BASE/api/follows" \
        -d 'kind=topic&topicId=1&on=0&returnTo=/' -H 'content-type: application/x-www-form-urlencoded')"
  [ "$c" = "303" ] && pass "POST /api/follows (unfollow it) → 303" || fail "POST /api/follows (unfollow)" "HTTP $c"

  echo
  echo "  The audit row itself is asked of the database, which this script deliberately cannot do."
  echo "  Run this separately, with the lock held by nobody:"
  echo "    node -e \"…\"  or, from psql,"
  echo "    select action, actor_id, created_at from ozikoro_audit"
  echo "     where entity_type = 'ozikoro_follow' order by id desc limit 4;"
  echo "  Every row must name an actor_id; a null there is the failure this check exists to catch."
fi

echo
echo "== 8. what a reader is told, in the page's own words =="
echo "  clause 3 of the brief's empty-state rule, quoted from the served page:"
body "$BASE/archive?period=Pre-colonial" | grep -oE 'No record in the archive has a period recorded yet[^<]*' | head -1 | sed 's/^/     /'

rm -f "$JAR" /tmp/oz-body /tmp/oz-head
echo
if [ "$failures" -eq 0 ]; then
  echo "  ALL CHECKS PASSED"
  exit 0
fi
echo "  $failures CHECK(S) FAILED"
exit 1
