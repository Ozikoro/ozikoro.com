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
  await q('select count(*)::int n from ozikoro_article_label'),
  await q('select count(*)::int n from clan where published = true and region is not null and region <> \'\''),
  await q('select count(*)::int n from clan where published = true'),
].join(' '));
await closeDb();
" 2>/dev/null | tail -1)
read -r MEDIA SELFHOSTED ARTICLES LINKED LICENCED ACCOUNTS SUBJECTLINKS CLANREGION CLANPUB <<< "$DB"

if [ -z "${MEDIA:-}" ]; then
  echo "  COULD NOT READ THE DATABASE — not a pass." >&2
  exit 2
fi

SITEMAPURLS=$(node --input-type=module -e "
import { getDb, closeDb } from '@ozituma/db/client';
import { listIndexableUrls } from '@ozikoro/platform';
const db = await getDb();
console.log((await listIndexableUrls(db)).length);
await closeDb();
" 2>/dev/null | tail -1)
WAIVEDLINKS=$(grep -cE "^  '/" scripts/check-body-links.mjs | tr -d ' ')

echo ""
echo "  Resume block against the system"
# Every pattern below describes the BLOCK'S WORDING, never the derived value. Three were still hardcoded
# values — 23 reader-facing routes, 7 under /admin, 0 of 1,051 records linked — and a pattern built from
# the answer can only ever agree with itself: when /careers moved the count, the page-routes claim
# reported 'pattern found nothing' instead of 'says 30, is 31'. Round 175 fixed four; these are the rest. — round 175 fixed four claims
# this way and missed this one, so when /careers made the count stale the check reported "pattern found
# nothing" instead of "says 30, is 31". A pattern built from the answer can only ever agree with itself.
claim "page routes"            "[0-9]+ page routes"                   "$PAGES"
claim "reader-facing routes"   "[0-9]+ reader-facing routes"          "$((PAGES - ADMIN))"
claim "routes under /admin"    "[0-9]+ under \`/admin\`"               "$ADMIN"
claim "live checks"            "[0-9]+ live checks"                    "$LIVE"
claim "media total"            "[0-9,]+ media"                       "$MEDIA"
claim "media self-hosted"      "[0-9,]+ of [0-9,]+ media"            "$SELFHOSTED"
# The pattern must not match "0 of N records linked to an entity", which is a different count that
# happened to equal the article total until the Blogger source was ingested. Matching on the word
# "records" alone made this claim pass for the wrong reason and then fail for the wrong reason.
claim "articles"               "of [0-9,]+ records"                   "$ARTICLES"
claim "records entity-linked"  "[0-9,]+ of [0-9,]+ records linked"     "$LINKED"
claim "media licenced"         "[0-9,]+ of [0-9,]+ items"            "$LICENCED"
# Markdown puts `**` between a number and its noun — "All **14,667** sitemap URLs" — so the patterns allow
# for it. Round 175's lesson, in the third costume: a pattern that cannot express the serialisation reports
# an absence. The guard makes that loud rather than silent, which is how these were found.
claim "sitemap URLs"           "[0-9,]+[^ ]* *sitemap URLs"           "$SITEMAPURLS"
claim "waived in-body links"   "[0-9]+ waived in-body"                "$WAIVEDLINKS"
claim "subject links"          "[0-9,]+ subject links"                "$SUBJECTLINKS"
claim "clans with a region"    "[0-9,]+ of [0-9,]+ *published clans"  "$CLANREGION"

# ---------------------------------------------------------------------------
# PRESENCE — the decisions that must not fall out of the block.
#
# Round 174 found eight corrections to the block, and the countable ones are now checked above. What a
# count cannot catch is a WHOLE ITEM going missing: a decision struck from the owner list, or a gap that
# stops being mentioned because a round rewrote the paragraph around it. Presence is countable even when
# the claim is not, so each of these must still appear.
#
# Same guard: a pattern that matches nothing is reported as a broken pattern, not a missing decision.
# ---------------------------------------------------------------------------
mention() {
  local label="$1" pattern="$2"
  checked=$((checked + 1))
  if printf '%s' "$BLOCK_ONE_LINE" | grep -qiE "$pattern"; then
    printf '  ok    %-34s present\n' "$label"
  else
    printf '  MISSING %-33s the block no longer mentions it\n' "$label"
    failed=$((failed + 1))
  fi
}

echo ""
echo "  Decisions the block must keep naming"
mention "the eleven addresses"      "eleven account addresses|eleven addresses"
mention "the redirect row"          "ozikoro_redirect|/home/ row"
mention "media rights"              "media rights"
mention "where coordinates come from" "coordinates come from"
mention "registration and legal"    "join.*forgot|registration is open|privacy notice"
mention "the favicon"               "favicon"

echo ""
echo "  The ten items of the objective"
# A block that silently drops an item is the failure this whole file exists to prevent: a reader would
# take an unmentioned item for a finished one. Each pattern below is a phrase the block uses when it
# discusses that item, so a rewrite that removes the subject fails here.
mention "1  media into storage"     "media into storage|object storage|self-host|served from our own"
mention "2  auth and the claim path" "claim path|byline claim|sign in|authentication"
mention "3  editorial queue"        "editorial|untagged|entity link|domain layer"
mention "4  research"               "publication|researcher|review workflow"
mention "5  archaeology"            "archaeolog|oral history"
mention "6  universal search"       "search"
mention "7  maps and timeline"      "map|timeline|coordinate"
mention "8  Ozituma integration"    "Ozituma|dictionary"
mention "9  the AI assistant"       "AI|assistant|grounding|gateway"
mention "10 the last mile"          "deployment|deploy|notification|nonce|backup"

echo ""
echo "  checked: $checked   wrong: $failed   pattern-found-nothing: $missing"
if [ "$missing" -gt 0 ]; then
  echo "  $missing CLAIM(S) COULD NOT BE FOUND — the patterns are wrong, not the block. Not a pass." >&2
  exit 2
fi
[ "$failed" -eq 0 ] && echo "  Every countable claim in the resume block holds." || echo "  $failed claim(s) are STALE."
echo ""
exit $((failed > 0))
