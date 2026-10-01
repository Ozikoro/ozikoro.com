#!/usr/bin/env bash
#
# Does everything a page REFERENCES actually load?
#
# WHY THIS IS THE THIRD KIND OF LINK CHECK
#
#   check-links.sh     follows <a href> on pages     -> what a reader can CLICK
#   check-sitemap.sh   samples <loc> from the sitemap -> what a crawler is TOLD
#   check-body-links   links written in article prose -> what the RECORDS reference
#   this               stylesheets, scripts and images -> whether a page can RENDER
#
# The failure mode this guards is the quiet one. A moved stylesheet leaves every page unstyled, the HTML
# still returns 200, and **not one of the other three checks notices** — they all ask whether pages and
# links are reachable, never whether the page can render as designed.
#
# Usage:
#   ./scripts/check-assets.sh [BASE_URL] [MAX_PAGES]
set -uo pipefail

BASE="${1:-http://127.0.0.1:3100}"
MAX_PAGES="${2:-10}"

echo ""
echo "  Checking every asset referenced by up to $MAX_PAGES pages on $BASE"

SEEDS=("/" "/archive/" "/folklore/" "/about/" "/documents/" "/topics/" "/labels/" "/researchers/" "/search/?q=igbo" "/entities/")

TMP=$(mktemp)
: > "$TMP"
count=0
for p in "${SEEDS[@]}"; do
  [ "$count" -ge "$MAX_PAGES" ] && break
  count=$((count + 1))
  curl -s --max-time 120 "$BASE$p" >> "$TMP" 2>/dev/null || true
done

# Parsed in python3, not sed: macOS ships BSD sed, where `\?` is unsupported and silently does nothing
# — a mistake that cost a false alarm in round 68.
ASSETS=$(python3 - "$TMP" <<'PYEOF'
import re, sys
html = open(sys.argv[1], encoding='utf-8', errors='replace').read()
seen = []
for m in re.findall(r'(?:href|src)="(/[^"]+\.(?:css|js|png|jpe?g|webp|svg|ico|woff2?))(?:\?[^"]*)?"', html):
    if m not in seen:
        seen.append(m)
print('\n'.join(seen))
PYEOF
)
rm -f "$TMP"

TOTAL=$(printf '%s\n' "$ASSETS" | grep -c . || true)
if [ "$TOTAL" -eq 0 ]; then
  # The round-57 lesson, applied again: an empty result reads exactly like success.
  echo "  NO ASSETS MATCHED across $count pages — the extractor is wrong, not the site. Not a pass." >&2
  exit 2
fi
echo "  distinct asset references: $TOTAL"

bad=0
checked=0
while IFS= read -r a; do
  [ -z "$a" ] && continue
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 90 "$BASE$a")
  checked=$((checked + 1))
  if [ "$code" != "200" ]; then
    printf '  %-6s %s\n' "$code" "$a"
    bad=$((bad + 1))
  fi
done <<< "$ASSETS"

echo ""
echo "  checked: $checked"
if [ "$bad" -eq 0 ]; then
  echo "  Every referenced asset loaded."
else
  echo "  BROKEN ASSETS: $bad of $checked."
fi
echo ""
exit $((bad > 0))
