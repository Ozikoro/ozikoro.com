#!/usr/bin/env bash
#
# Refuse a Suspense boundary placed above a page that decides its own 404.
#
# WHY THIS EXISTS (rounds 200-205)
#
# A `loading.tsx` creates a Suspense boundary around its segment. React commits `200 OK` as soon as it begins
# streaming the shell, and `notFound()` renders the 404 page INTO that stream — so a boundary anywhere above
# the call defers it until after the status has been sent.
#
# This rule was broken twice by the same hand:
#
#   round 196   a boundary at `app/`          -> every unmatched address returned 200 instead of 404
#   round 201   a boundary at `app/labels/`   -> every unknown label slug returned 200
#   round 202   the rule, measured            -> a boundary is unsafe wherever a dynamic segment
#                                                sits beneath it, or a page below decides notFound()
#
# The resume block said the equivalent in round 119, in the same paragraph the work was recorded beside.
# **A rule that has been broken twice is a rule that needs a program**, which is also why the commit hook
# exists (round 187).
#
# WHAT IT CHECKS, for every `loading.tsx` under an app's `app/` directory:
#
#   1. no dynamic segment at or beneath that directory — because a single unmatched path would MATCH a
#      catch-all like `[slug]`, and the page would then decide the status
#   2. no page at or beneath that directory calls `notFound()` — because that page decides the status
#
# Both conditions are the same rule: **the status must be settled by the router before the boundary is
# entered.** A directory that fails either one must not have a `loading.tsx`.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2

fail=0
checked=0

for app in apps/*/app; do
  [ -d "$app" ] || continue
  while IFS= read -r boundary; do
    dir=$(dirname "$boundary")
    checked=$((checked + 1))
    rel=${boundary#"$app"/}

    # 1. A dynamic segment at or beneath this directory.
    dynamic=$(find "$dir" -type d -name '*\[*' 2>/dev/null | head -1)
    if [ -n "$dynamic" ]; then
      echo "  FAIL  $app/$rel wraps a dynamic segment"
      echo "        ${dynamic#"$app"/}"
      echo "        An unmatched single path would MATCH that segment, and the page would then decide the"
      echo "        status inside the boundary — which defers it and returns 200 instead of 404."
      fail=$((fail + 1))
      continue
    fi

    # 2. A page at or beneath this directory that decides its own not-found.
    decider=$(grep -rl 'notFound()' "$dir" --include='page.tsx' 2>/dev/null | head -1)
    if [ -n "$decider" ]; then
      echo "  FAIL  $app/$rel wraps a page that calls notFound()"
      echo "        ${decider#"$app"/}"
      echo "        The status is settled during that page's render, so the boundary defers it."
      fail=$((fail + 1))
      continue
    fi

    # -------------------------------------------------------------------------
    # 3. A page that REDIRECTS must not sit under a boundary either.
    #
    # The same mechanism as notFound(), and it was missed until round 258. React commits `200 OK` as
    # soon as it begins streaming the shell, so an unauthenticated request to a gated route answered
    # **200 with the loading fallback** instead of a 307 to /signin. /claims, /reviews and /submit all
    # did this, and the auth-boundary check found it while this one reported all three as fine.
    #
    # A redirect is a STATUS, and only the router can set one. So a directory containing a page that
    # redirects must not have a `loading.tsx` above it, exactly as for notFound().
    # -------------------------------------------------------------------------
    redirector=$(grep -rlE 'redirect\(|permanentRedirect\(|requireCapabilityOrRedirect\(' "$dir" --include='page.tsx' 2>/dev/null | head -1)
    if [ -n "$redirector" ]; then
      echo "  FAIL  $app/$rel wraps a page that redirects ($redirector)"
      fail=$((fail + 1))
      continue
    fi
  done < <(find "$app" -name 'loading.tsx' 2>/dev/null)
done

echo ""
if [ "$checked" -eq 0 ]; then
  echo "  NO loading.tsx FOUND IN ANY app — that is a broken glob, not a clean result." >&2
  exit 2
fi
if [ "$fail" -gt 0 ]; then
  echo "  $fail boundary(ies) are placed above a status decision. See rounds 200-202 in"
  echo "  docs/OZIKORO-REMAINING.md: the file belongs on a route the ROUTER resolves."
  echo ""
  exit 1
fi
echo "  Every loading boundary sits on a route the router resolves ($checked checked)."
echo ""
