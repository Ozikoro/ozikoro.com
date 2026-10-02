#!/usr/bin/env bash
#
# check-grounding.sh — the archive must answer what it holds and refuse what it does not.
#
# WHY THIS EXISTS
#
# The grounding gate took three rounds to get right, and each round's predecessor looked correct:
#
#   round 261   the gate existed and its unit test passed — and the test used a question whose words
#               happened not to be common in the corpus, so it passed while /api/ask answered
#               "Explain quantum chromodynamics" with six passages and trust: verified
#   round 262   requiring most of the question's terms to match refused two of three
#   round 263   measuring term rarity refused all three
#
# **A unit test with hand-chosen words cannot catch this class of fault**, because the fault is about the
# CORPUS: which words are common in a thousand articles is not a property any fixture knows. So this asks the
# running endpoint, with questions chosen to exercise the boundary — real subjects from the archive, and
# questions about subjects it certainly does not hold.
#
# IT ALSO CHECKS THE NEGATIVE CASE, WHICH IS THE ONE THAT MATTERS
#
# An archive that refuses everything and one that answers everything both pass a test that only checks one
# direction. The brief's rule is that **no AI answer may sit above primary evidence**, and the mechanical form
# of that rule is: a question the archive cannot ground must return no passages at all.
#
# Usage: bash scripts/check-grounding.sh [BASE_URL]   (a server must be running)
set -uo pipefail
BASE="${1:-http://127.0.0.1:3100}"
LANG_CODE="${LANG_CODE:-eng}"

# Questions the archive genuinely holds material for. These MUST be grounded.
ANSWERABLE=(
  "What is the New Yam Festival about?"
  "Tell me about Igbo clans"
  "What is Nwaezinmadu?"
  "Akwa-Ocha cloth"
)

# Questions about subjects outside the archive, phrased in ordinary English so their words look plausible.
# These MUST NOT be grounded.
REFUSABLE=(
  "Explain quantum chromodynamics"
  "What is the capital of France?"
  "Who won the 1994 World Cup?"
)

ask() {
  curl -s --max-time 60 -G --data-urlencode "q=$1" --data-urlencode "lang=$LANG_CODE" "$BASE/api/ask"
}

json_field() {
  python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
except Exception:
  print('PARSE_ERROR'); raise SystemExit
print(d.get('$1'))
"
}

passed=0
failed=0

echo ""
echo "  Grounding boundary on $BASE"

for q in "${ANSWERABLE[@]}"; do
  body="$(ask "$q")"
  grounded="$(printf '%s' "$body" | json_field grounded)"
  n="$(printf '%s' "$body" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(0); raise SystemExit
print(len(d.get('passages') or []))")"
  if [ "$grounded" = "True" ] && [ "$n" -gt 0 ]; then
    printf '  \033[32mPASS\033[0m  grounded   %-42s %s passages\n' "$q" "$n"
    passed=$((passed + 1))
  else
    printf '  \033[31mFAIL\033[0m  grounded   %-42s grounded=%s passages=%s\n' "$q" "$grounded" "$n"
    failed=$((failed + 1))
  fi
done

for q in "${REFUSABLE[@]}"; do
  body="$(ask "$q")"
  grounded="$(printf '%s' "$body" | json_field grounded)"
  n="$(printf '%s' "$body" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(0); raise SystemExit
print(len(d.get('passages') or []))")"
  if [ "$grounded" = "False" ] && [ "$n" -eq 0 ]; then
    printf '  \033[32mPASS\033[0m  refused    %-42s 0 passages\n' "$q"
    passed=$((passed + 1))
  else
    printf '  \033[31mFAIL\033[0m  refused    %-42s grounded=%s passages=%s — the archive claimed grounding\n' \
      "$q" "$grounded" "$n"
    failed=$((failed + 1))
  fi
done

echo ""
if [ "$failed" -eq 0 ]; then
  echo "  The archive answers what it holds and refuses what it does not ($passed checks)."
else
  echo "  $failed grounding check(s) FAILED."
fi
echo ""
exit $((failed > 0))
