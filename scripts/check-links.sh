#!/usr/bin/env bash
#
# Does every internal link on the site actually resolve?
#
# WHY THIS EXISTS
#
# In round 9 search began returning `/entities/<slug>/` links for a route that did not exist yet. It was
# caught by checking rather than assuming, and it was **latent rather than live** only because the
# knowledge graph happened to be empty. The first editor to link a record would have created a 404 on a
# public page, and nothing in this project would have noticed.
#
# Nothing still would. There is no check that a link on a page leads anywhere, and every suite asserts
# data and logic, not reachability. This walks the site and follows what a reader would click.
#
# It needs a running server, so it is NOT part of verify-all.sh — that runs against a stopped server
# because the suites hold the PGlite lock.
#
# Usage:
#   npm -w @ozikoro/site run dev &        # or a standalone build
#   ./scripts/check-links.sh [BASE_URL] [MAX_PAGES]
set -uo pipefail

BASE="${1:-http://127.0.0.1:3100}"
MAX_PAGES="${2:-40}"

echo ""
echo "  Checking internal links from $BASE (up to $MAX_PAGES pages)"

# Start from the pages a reader actually lands on, then follow what they link to.
SEEDS=("/" "/archive/" "/folklore/" "/documents/" "/topics/" "/entities/" "/publications/" "/researchers/" "/about/" "/search/?q=igbo")

# `declare -A` is bash 4. macOS ships bash 3.2, where the first version of this script died with
# "declare: -A: invalid option" — and then reported "Every internal link resolved" after checking
# NOTHING. A check that reports success without running is worse than no check.
seen=" "
queue=("${SEEDS[@]}")
checked=0
broken=0

while [ "${#queue[@]}" -gt 0 ] && [ "$checked" -lt "$MAX_PAGES" ]; do
  path="${queue[0]}"
  queue=("${queue[@]:1}")
  case "$seen" in *" $path "*) continue ;; esac
  seen="$seen$path "

  body=$(curl -s --max-time 60 "$BASE$path" 2>/dev/null) || continue
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 "$BASE$path" 2>/dev/null)
  checked=$((checked + 1))

  if [ "$code" != "200" ]; then
    printf '  %-6s %s\n' "$code" "$path"
    broken=$((broken + 1))
    continue
  fi

  # Internal links only: same-origin paths. Assets and anchors are skipped.
  links=$(printf '%s' "$body" \
    | grep -oE 'href="/[^"#]*"' \
    | sed 's/href="//; s/"$//' \
    | grep -vE '^/(_next|design|api)/' \
    | grep -vE '\.(css|js|png|jpg|jpeg|webp|svg|ico|xml|txt|pdf)$' \
    | sort -u || true)

  for link in $links; do
    case "$seen" in *" $link "*) continue ;; esac
    queue+=("$link")
  done
done

echo ""
echo "  pages checked: $checked"
if [ "$checked" -eq 0 ]; then
  # The important guard. The first version of this script failed on bash 3.2, checked nothing, and
  # printed "Every internal link resolved" — a green result from a run that did not happen.
  echo "  NOTHING WAS CHECKED — the walker did not reach a single page. Not a pass."
  exit 2
elif [ "$broken" -eq 0 ]; then
  echo "  Every internal link resolved ($checked pages)."
else
  echo "  BROKEN LINKS: $broken (listed above with their status)"
fi
echo ""
exit $((broken > 0))
