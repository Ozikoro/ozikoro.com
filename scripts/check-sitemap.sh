#!/usr/bin/env bash
#
# Does every page the sitemap ADVERTISES actually resolve?
#
# WHY THIS IS SEPARATE FROM check-links.sh
#
# They answer different questions. `check-links.sh` follows links found on pages, so it covers what is
# LINKED — the surface a reader can walk to. This samples the sitemap, so it covers what is LISTED —
# the long tail of label, media and article pages that no menu points at. A surface walk of 120 pages
# cannot see a page only a crawler would reach.
#
# THE ORIGIN TRAP THIS TOOL EXISTS TO AVOID
#
# A sitemap MUST name the production origin: `<loc>https://ozikoro.com/labels/ubulu/</loc>`. That is
# correct, and it is what a crawler needs. It also means requesting those values verbatim checks
# PRODUCTION, not the server under test.
#
# The first version of this check did exactly that and reported 41 failures out of 45 — every one of them
# a 404 belonging to the old WordPress site still running at that origin. It looked like a catastrophe
# and was a measurement error. So this reads the sitemap for its PATHS and requests those from BASE, and
# says so in its output.
#
# Usage:
#   ./scripts/check-sitemap.sh [BASE_URL] [SAMPLE_SIZE]
set -uo pipefail

BASE="${1:-http://127.0.0.1:3100}"
SIZE="${2:-40}"

echo ""
echo "  Sampling $SIZE pages the sitemap advertises, requested from $BASE"
echo "  (the sitemap names the production origin; the paths are what is tested here)"

SM=$(mktemp)
if ! curl -s --max-time 300 "$BASE/sitemap.xml" -o "$SM"; then
  echo "  Could not fetch $BASE/sitemap.xml. Is the server running?" >&2
  rm -f "$SM"; exit 2
fi

# Parsed in python3, NOT sed. macOS ships BSD sed, where `\?` is not supported — the first version's
# `sed 's|https\?://[^/]*||'` silently failed to strip the origin, left whole `<loc>` elements as
# "paths", and reported all 40 samples broken.
PATHS=$(python3 - "$SM" <<'PYEOF'
import re, sys
xml = open(sys.argv[1], encoding='utf-8').read()
for loc in re.findall(r'<loc>([^<]+)</loc>', xml):
    print(re.sub(r'^https?://[^/]+', '', loc))
PYEOF
)
TOTAL=$(printf '%s\n' "$PATHS" | grep -c . || true)
rm -f "$SM"

if [ "$TOTAL" -eq 0 ]; then
  echo "  The sitemap listed no URLs. Not a pass." >&2
  exit 2
fi
echo "  sitemap lists $TOTAL paths"

# Deterministic sample, so a failure can be reproduced exactly.
SAMPLE=$(printf '%s\n' "$PATHS" | awk 'BEGIN{srand(68)} {print rand() "\t" $0}' | sort -k1,1n | head -n "$SIZE" | cut -f2)

checked=0
broken=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  case "$p" in
    /*) ;;
    *) continue ;;   # anything that is not a path is not testable here
  esac
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 90 "$BASE$p")
  checked=$((checked + 1))
  if [ "$code" != "200" ]; then
    printf '  %-6s %s\n' "$code" "$p"
    broken=$((broken + 1))
  fi
done <<< "$SAMPLE"

echo ""
echo "  checked: $checked"
if [ "$checked" -eq 0 ]; then
  # The round-57 lesson: a check reporting a pass after examining nothing is worse than no check.
  echo "  NOTHING WAS CHECKED — not a pass." >&2
  exit 2
elif [ "$broken" -eq 0 ]; then
  echo "  Every sampled page resolved."
else
  echo "  BROKEN: $broken of $checked sampled pages did not return 200."
fi
echo ""
exit $((broken > 0))
