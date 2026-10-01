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

# KNOWN DEAD, WAIVED DELIBERATELY — and printed on every run rather than silenced.
#
# The About page references an image that was never in the archive. Round 88 established there is no media
# record for it and none from that month at all, so the renderer has nothing to rewrite the path onto and
# the original WordPress markup survives into the page.
#
# Waived rather than repaired because repairing it would mean INVENTING an image — showing a reader
# something the archive does not hold, which this project may not do.
WAIVED="/wp-content/uploads/2020/01/image-1-copyright.jpg"

bad=0
checked=0
skipped=0
while IFS= read -r a; do
  [ -z "$a" ] && continue
  # The waived asset is STILL REQUESTED, deliberately.
  #
  # The first version `continue`d before the request, which meant a fixed image would stay "waived" for
  # ever without ever being tested — a waiver that can never notice it is no longer needed. Round 121's
  # rule was to re-read a waiver when the thing it describes changes; this is the mechanical version of
  # that, and it is better than remembering.
  is_waived=no
  [ "$a" = "$WAIVED" ] && is_waived=yes

  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 90 "$BASE$a")

  # `000` is curl reporting NO RESPONSE — a dropped connection or a timeout — not a broken asset.
  #
  # Round 70 established this for check-sitemap.sh, where 31 of 14,667 paths came back 000 under a long
  # sequential run and every one returned 200 when re-requested. check-assets.sh was written twenty rounds
  # LATER and did not carry the lesson across, so a single dropped request here is reported as a broken
  # asset. Found in round 122 by a mutation that exited 1 for a reason unrelated to the mutation.
  if [ "$code" = "000" ]; then
    sleep 1
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 120 "$BASE$a")
  fi

  if [ "$is_waived" = "yes" ] && [ "$code" = "200" ]; then
    echo "  NO LONGER NEEDED — the waived asset now resolves: $a"
    echo "  Remove WAIVED from check-assets.sh."
    skipped=$((skipped + 1))
    continue
  fi
  if [ "$is_waived" = "yes" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  checked=$((checked + 1))
  if [ "$code" != "200" ]; then
    if [ "$code" = "000" ]; then
      printf '  %-6s %s\n' "NO RESPONSE (retried)" "$a"
    else
      printf '  %-6s %s\n' "$code" "$a"
    fi
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
if [ "$skipped" -gt 0 ]; then
  echo ""
  echo "  WAIVED ($skipped) — known, deliberately not repaired, still reported every run:"
  echo "    $WAIVED"
fi
echo ""
exit $((bad > 0))
