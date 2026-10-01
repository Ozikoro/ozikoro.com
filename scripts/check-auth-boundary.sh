#!/usr/bin/env bash
#
# Is every gated route gated, and does it remember where you were going?
#
# WHY THIS IS CHECKED
#
# Round 128 found the account table empty, so no one can sign in. Round 129 verified the boundary anyway —
# every gated route refuses a session-less request — and found the destination behind it wrong: all four
# `/admin/*` routes redirected with `next=%2Fadmin%2Fspotify`, regardless of what was asked for. A
# hardcoded literal at `app/admin/layout.tsx:35`, and `/admin/spotify` is the last entry in that layout's
# own nav, which is what a copy-paste looks like. An editor asking for `/admin/rights/` was sent to the
# Spotify page.
#
# The defect was invisible to every other check because it is a *destination*, not a status: the redirect
# was correct in kind and wrong in target, and only the sameness across four different requests gave it
# away. So this checks the pair — the status AND where it points — and it checks them per route, because a
# single route would have looked fine.
#
# Usage: ./scripts/check-auth-boundary.sh [BASE_URL]
set -uo pipefail

BASE="${1:-http://127.0.0.1:3100}"

echo ""
echo "  Auth boundary on $BASE"

if ! curl -s -o /dev/null --max-time 10 "$BASE/"; then
  echo "  $BASE is not responding. Start a server first." >&2
  exit 2
fi

GATED=("/admin/" "/admin/claims/" "/admin/rights/" "/admin/spotify/" "/admin/archive/" "/claims/" "/reviews/" "/submit/")
PUBLIC=("/" "/archive/" "/about/" "/documents/" "/folklore/")

failed=0
checked=0

for p in "${GATED[@]}"; do
  checked=$((checked + 1))
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 90 "$BASE$p")
  loc=$(curl -s -o /dev/null -w "%{redirect_url}" --max-time 90 "$BASE$p")
  if [ "$code" != "307" ] && [ "$code" != "302" ] && [ "$code" != "303" ]; then
    printf '  %-24s %s — expected a redirect to /signin\n' "$p" "$code"
    failed=$((failed + 1)); continue
  fi
  case "$loc" in
    */signin*) : ;;
    *) printf '  %-24s redirected to %s — expected /signin\n' "$p" "$loc"; failed=$((failed + 1)); continue ;;
  esac
  # THE PART ROUND 129 EXISTED FOR: the return path must name the page that was asked for.
  want=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1], safe=''))" "$p")
  case "$loc" in
    *"next=$want"*) : ;;
    *) printf '  %-24s next does not name this page\n      wanted next=%s\n      got    %s\n' "$p" "$want" "$loc"
       failed=$((failed + 1)) ;;
  esac
done

for p in "${PUBLIC[@]}"; do
  checked=$((checked + 1))
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 90 "$BASE$p")
  if [ "$code" != "200" ]; then
    printf '  %-24s %s — a public page must serve\n' "$p" "$code"
    failed=$((failed + 1))
  fi
done

echo "  checked: $checked"
if [ "$checked" -eq 0 ]; then
  echo "  NOTHING WAS CHECKED — not a pass." >&2
  exit 2
elif [ "$failed" -eq 0 ]; then
  echo "  Every gated route refuses, names itself as the return path, and every public page serves."
else
  echo "  FAILED: $failed of $checked."
fi
echo ""
exit $((failed > 0))
