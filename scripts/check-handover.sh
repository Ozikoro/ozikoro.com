#!/usr/bin/env bash
#
# Does the resume block's numbers still match the system?
#
# WHY THIS EXISTS (round 175)
#
# Round 174 counted eight corrections to the resume block, seven of them made in a LATER round than the
# change they described — which means seven rounds ended with a handover that was already stale. The habit
# that caught all eight was one command: ask the document a question it should be able to answer.
#
# This is that command, for the claims that can be counted. `verify-all.sh` checks twenty things about the
# code and nothing about the block it exists to keep honest.
#
# THE GUARD MATTERS MORE THAN THE CHECKS
#
# This file parses prose with patterns, and this project has recorded six occasions where a pattern that
# could not match reported an absence as a finding (rounds 101, 106, 109, 124, 169, 172). So every claim
# below is REQUIRED to be found: if its pattern does not match, this exits 2 and says the pattern is broken,
# rather than silently checking fewer things. **A claim that cannot be found is not a claim that holds.**
#
# Offline: reads the repository and the database. No server.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2

BLOCK=$(python3 - <<'PY'
import pathlib
s = pathlib.Path('docs/OZIKORO-REMAINING.md').read_text(encoding='utf-8')
start = s.index('> **RESUME HERE')
# The block ends at the first line that is not a blockquote and not blank.
out = []
for line in s[start:].split('\n'):
    if line.startswith('>'):
        out.append(line)
    elif out and line.strip() == '':
        out.append('')
    elif out:
        break
print('\n'.join(out))
PY
)

if [ -z "$BLOCK" ]; then
  echo "  THE RESUME BLOCK WAS NOT FOUND — not a pass." >&2
  exit 2
fi

failed=0
checked=0
missing=0

# claim <label> <pattern with one capture group> <actual value>
# The block is FLATTENED before matching, because it is wrapped prose and a claim can straddle a line
# break. Measured in round 175: "3,437 of 3,488" ends one line and "media" begins the next, so a
# line-oriented pattern found neither and the guard reported two claims as missing when both were
# present. That is round 172's lesson in a second costume — a pattern that cannot express how the text is
# serialised. Flattening costs nothing and removes the whole class.
# AND THE QUOTE MARKERS GO FIRST. Round 175's first fix flattened the block but left each line's
# leading `> `, so "3,437 of 3,488" and "media" ended up separated by `> ` and the pattern still
# could not match — a fix for a serialisation problem that had a serialisation problem. Strip the
# markers, then flatten.
BLOCK_ONE_LINE=$(printf '%s' "$BLOCK" | sed 's/^> *//' | tr '\n' ' ')

claim() {
  local label="$1" pattern="$2" actual="$3"
  local stated
  stated=$(printf '%s' "$BLOCK_ONE_LINE" | grep -oE "$pattern" | head -1 | grep -oE '[0-9][0-9,]*' | head -1 | tr -d ',')
  if [ -z "$stated" ]; then
    printf '  PATTERN FOUND NOTHING  %-34s (pattern: %s)\n' "$label" "$pattern"
    missing=$((missing + 1))
    return
  fi
  checked=$((checked + 1))
  if [ "$stated" = "$actual" ]; then
    printf '  ok    %-34s %s\n' "$label" "$actual"
  else
    printf '  WRONG %-34s says %s, is %s\n' "$label" "$stated" "$actual"
    failed=$((failed + 1))
  fi
}

PAGES=$(find apps/ozikoro/app -name 'page.tsx' | wc -l | tr -d ' ')
ADMIN=$(find apps/ozikoro/app/admin -name 'page.tsx' | wc -l | tr -d ' ')
LIVE=$(grep -cE '^run_check "' scripts/verify-live.sh | tr -d ' ')
STEPS=$(grep -cE '^run "' scripts/verify-all.sh | tr -d ' ')

DB=$(node --input-type=module -e "
import { getDb, closeDb } from '@ozituma/db/client';
const db = await getDb();
const q = async (s) => (await db.one(s)).n;
console.log([
  await q('select count(*)::int n from ozikoro_media'),
  await q(\"select count(*)::int n from ozikoro_media where storage_key is not null and storage_key <> ''\"),
  await q('select count(*)::int n from ozikoro_article where is_page = false'),
  await q('select count(distinct article_id)::int n from ozikoro_article_entity'),
  await q(\"select count(*)::int n from ozikoro_media where licence is not null and licence <> ''\"),
  await q('select count(*)::int n from account'),
].join(' '));
await closeDb();
" 2>/dev/null | tail -1)
read -r MEDIA SELFHOSTED ARTICLES LINKED LICENCED ACCOUNTS <<< "$DB"

if [ -z "${MEDIA:-}" ]; then
  echo "  COULD NOT READ THE DATABASE — not a pass." >&2
  exit 2
fi

echo ""
echo "  Resume block against the system"
claim "page routes"            "$PAGES page routes"                    "$PAGES"
claim "reader-facing routes"   "23 reader-facing routes"               "$((PAGES - ADMIN))"
claim "routes under /admin"    "7 under \`/admin\`"                     "$ADMIN"
claim "live checks"            "[0-9]+ live checks"                    "$LIVE"
claim "media total"            "[0-9,]+ media"                       "$MEDIA"
claim "media self-hosted"      "[0-9,]+ of [0-9,]+ media"            "$SELFHOSTED"
claim "articles"               "[0-9,]+ records"                     "$ARTICLES"
claim "records entity-linked"  "0 of 1,051 records linked"             "$LINKED"
claim "media licenced"         "[0-9,]+ of [0-9,]+ items"            "$LICENCED"

echo ""
echo "  checked: $checked   wrong: $failed   pattern-found-nothing: $missing"
if [ "$missing" -gt 0 ]; then
  echo "  $missing CLAIM(S) COULD NOT BE FOUND — the patterns are wrong, not the block. Not a pass." >&2
  exit 2
fi
[ "$failed" -eq 0 ] && echo "  Every countable claim in the resume block holds." || echo "  $failed claim(s) are STALE."
echo ""
exit $((failed > 0))
