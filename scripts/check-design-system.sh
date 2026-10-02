#!/usr/bin/env bash
#
# check-design-system.sh — the archive renders the APPROVED design, and not a generator's scaffold.
#
# WHY THIS CHECK EXISTS
#
# idenze/calm-comfort-construct contains TWO style systems, and they are not interchangeable:
#
#   public/design/tokens.css   the Ozikoro design: warm paper #f7f1e3, ink #1d1a16, and an accent
#                              #0d5c45 described in the file as "ikoro wood / iron oxide", with Noto
#                              Serif/Sans chosen for full Latin Extended Additional coverage so that
#                              ị ọ ụ ṅ and the combining tone marks render without a fallback hop.
#
#   src/styles.css             the Lovable/shadcn SCAFFOLD theme: --primary oklch(0.208 0.042
#                              265.755), a generic slate. It carries no Ozikoro identity at all.
#
# apps/ozikoro does not use Tailwind and loads the design's own stylesheets. **That is the correct
# arrangement, and it is fragile in one specific way**: a later change that installs Tailwind and
# imports src/styles.css as a "modernisation" would silently replace the institution's palette with a
# generic one, and every page would still look plausible. This check fails if that happens.
#
# WHAT IT ASSERTS
#
#   1. the design's stylesheets are linked from the app layout
#   2. main.css still @imports tokens.css, so the tokens actually load
#   3. tokens.css still carries the Ozikoro colour identity
#   4. Tailwind is NOT a dependency of the archive
#   5. the design's own classes are used across the pages
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAIL=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=1; }

LAYOUT="apps/ozikoro/app/layout.tsx"
TOKENS="apps/ozikoro/public/design/tokens.css"
MAIN="apps/ozikoro/public/design/styles/main.css"

printf '\n== the approved design is the one being rendered ==\n'

# 1. The layout links the design's stylesheets.
if grep -q '/design/styles/main.css' "$LAYOUT" 2>/dev/null; then
  ok "layout links the design's main.css"
else
  bad "layout does not link /design/styles/main.css"
fi

# 2. main.css still imports the tokens.
if grep -qE '@import[^;]*tokens\.css' "$MAIN" 2>/dev/null; then
  ok "main.css @imports tokens.css"
else
  bad "main.css no longer @imports tokens.css — the tokens would not load"
fi

# 3. The Ozikoro identity is still in the tokens.
if grep -q '0d5c45' "$TOKENS" 2>/dev/null && grep -q 'f7f1e3' "$TOKENS" 2>/dev/null; then
  ok "tokens.css still carries the Ozikoro palette (paper f7f1e3, accent 0d5c45)"
else
  bad "the Ozikoro palette is missing from tokens.css"
fi

# 4. Tailwind has not been introduced into the archive.
if node -e '
  const p = require("./apps/ozikoro/package.json");
  const all = { ...(p.dependencies||{}), ...(p.devDependencies||{}) };
  process.exit(Object.keys(all).some(k => k.toLowerCase().includes("tailwind")) ? 1 : 0);
' 2>/dev/null; then
  ok "no Tailwind dependency in the archive"
else
  bad "Tailwind is a dependency of the archive — it must not be, the design is plain CSS"
fi

# 5. The design's classes are used across the pages, not merely imported.
CLASSES=$(grep -rhoE 'className="[^"]*"' apps/ozikoro/app --include=*.tsx 2>/dev/null \
  | grep -oE '\b(sx-[a-z-]+|wrap|section|eyebrow|lede|btn-gold|provenance|unsourced|partial-note)\b' \
  | sort -u | wc -l | tr -d ' ')
if [ "$CLASSES" -ge 30 ]; then
  ok "the design's classes are in use across the pages ($CLASSES distinct)"
else
  bad "only $CLASSES design classes in use — the pages may have stopped using the design"
fi

if [ "$FAIL" -eq 0 ]; then
  printf '  \033[32mAll design-system checks passed.\033[0m\n'
else
  printf '  \033[31m%d design-system check(s) FAILED.\033[0m\n' 1
fi
exit "$FAIL"
