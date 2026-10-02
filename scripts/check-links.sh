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

  # `000` is curl reporting NO RESPONSE — a dropped connection or a timeout — not a broken link.
  #
  # Round 70 established this for check-sitemap.sh, where 31 of 14,667 paths came back 000 and every one
  # returned 200 when re-requested. Round 122 carried the retry into check-assets.sh. This is the THIRD
  # checker and the OLDEST — written in round 57, thirteen rounds before the lesson existed — so it is the
  # one where a single dropped request is most likely to have been read as a broken page.
  if [ "$code" = "000" ]; then
    sleep 1
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 120 "$BASE$path" 2>/dev/null)
  fi
  checked=$((checked + 1))

  # A REDIRECT IS NOT A BROKEN LINK (round 264).
  # This required 200 and called anything else broken. **That was a false failure introduced by fixing a real
  # one:** round 258 removed a loading boundary above /submit so that an unauthenticated request would return
  # a 307 to /signin rather than a 200 with a loading shell — and this check then reported /submit as broken,
  # because 307 is not 200.
  # So the request follows redirects and the FINAL status is what is judged. A gated route that leads to the
  # sign-in page is a link that resolves; a redirect that ends at a 404 is still caught, because the final
  # status is what is read.
  if [ "$code" != "200" ]; then
    final=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 120 "$BASE$path" 2>/dev/null)
    if [ "$final" = "200" ]; then
      # A 3xx that lands on a page is a link a reader can follow. Counted as resolved.
      code="200"
    else
      if [ "$code" = "000" ]; then
        printf '  %-22s %s\n' "NO RESPONSE (retried)" "$path"
      else
        printf '  %-22s %s\n' "$code -> $final" "$path"
      fi
      broken=$((broken + 1))
      continue
    fi
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
