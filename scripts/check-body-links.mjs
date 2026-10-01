/**
 * Broken links INSIDE archived article bodies.
 *
 * WHY THIS IS SEPARATE FROM THE OTHER TWO CHECKS
 *
 *   check-links.sh     follows links found on pages   -> what a reader can CLICK
 *   check-sitemap.sh   samples <loc> values           -> what a crawler is TOLD
 *   this               links written in article PROSE -> what the RECORDS reference
 *
 * The third is different in kind: these links were typed by the original authors, they point at a site
 * that no longer exists, and no walk reaches them unless it happens to open the article containing them.
 * Round 74 found 40 distinct dead targets this way.
 *
 * THE FOUR SHAPES A LINK CAN HAVE, AND WHICH OF THEM NOW RESOLVE
 *
 * A link is fine if it is a page the sitemap already advertises, or if it matches one of the three
 * families repaired in rounds 77, 78, 83 and 84:
 *
 *   /<topic-slug>/                    1 segment, topic      -> 308 to /topics/<slug>/   (round 78)
 *   /author/<contributor-slug>/       2 segments            -> served directly          (round 77)
 *   /<parent>/<media-slug>/           2 segments            -> 308 to /documents/<slug>/ (rounds 83-84)
 *
 * Round 85's measurement missed the author family because it only tested contributors as a
 * SINGLE-segment path, and `author/nze` is two. The families are listed here as shapes rather than as
 * examples so that mistake cannot be repeated by editing a list.
 *
 * Usage: node scripts/check-body-links.mjs      (needs the database; NOT the dev server)
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { listIndexableUrls } from '@ozikoro/platform';

const db = await getDb();
const known = new Set(
  (await listIndexableUrls(db)).map((u) => u.url.replace('https://ozikoro.com', '') || '/')
);
const media = new Set((await db.rows(`select slug from ozikoro_media`)).map((r) => r.slug));
const topics = new Set((await db.rows(`select slug from ozikoro_topic`)).map((r) => r.slug));
const contributors = new Set((await db.rows(`select slug from ozikoro_contributor`)).map((r) => r.slug));

/*
 * KNOWN DEAD, WAIVED DELIBERATELY — not fixed, and not to be silenced.
 *
 * These three are dead links written by the original authors, pointing at addresses that never existed on
 * this platform. No rule fixes them: the author family, the category family and the attachment family were
 * each one shape with one destination (rounds 77, 78, 83, 84), and these three share no shape with each
 * other or with any of those.
 *
 * They are waived rather than repaired because repairing them would mean INVENTING a destination — sending
 * a reader to a page the archive does not hold, which is the one thing this project is not allowed to do.
 * A redirect here would be a fabrication dressed as a fix.
 *
 * What they need is a person who knows what the article meant to link to. Until then the waiver keeps the
 * check GREEN for everything else, which is the point: a check that is red for a known, deferred issue is
 * how a suite teaches people to ignore it.
 *
 * WAIVED MUST BE VISIBLE. Anything here still prints, under its own heading, on every run.
 */
const WAIVED = new Set([
  '/womens-title-taking-the-iyom-otu-odu-title-in-igbo-culture/',
  '/how-a-hunter-obtained-money-from-his-friends-the-leopard-goat-bush-cat-and-cock-and-how-he-got-out-of-repaying-them/',
  '/uli-samples-from-awka-district-n-w-thomas-1910-11/',
]);

const rows = await db.rows(
  `select slug, body_html from ozikoro_article where status='published' and body_html like '%href=%'`
);

let anchors = 0;
let internal = 0;
const unknown = new Map();

for (const row of rows) {
  for (const m of String(row.body_html ?? '').matchAll(/href="([^"]+)"/g)) {
    anchors++;
    let u = m[1];
    if (u.startsWith('https://ozikoro.com')) u = u.replace('https://ozikoro.com', '');
    else if (!u.startsWith('/')) continue;                 // external
    const p = u.split('#')[0].split('?')[0];
    if (!p.startsWith('/')) continue;
    if (/^\/(_next|design|api|media)/.test(p)) continue;    // not reader-facing pages
    if (/\.(css|js|png|jpe?g|webp|svg|ico|xml|txt|pdf|mp4|mp3)$/i.test(p)) continue;
    internal++;

    if (known.has(p)) continue;

    const seg = p.split('/').filter(Boolean);
    const resolves =
      (seg.length === 1 && topics.has(seg[0])) ||
      (seg.length === 2 && seg[0] === 'author' && contributors.has(seg[1])) ||
      (seg.length === 2 && media.has(seg[1]));
    if (resolves) continue;

    unknown.set(p, (unknown.get(p) ?? 0) + 1);
  }
}

console.log(`  articles with links : ${rows.length}`);
console.log(`  anchors seen        : ${anchors}`);
console.log(`  internal links      : ${internal}`);
const waived = [...unknown.entries()].filter(([p]) => WAIVED.has(p));
const live = [...unknown.entries()].filter(([p]) => !WAIVED.has(p));

console.log(`  DISTINCT DEAD       : ${live.length}`);
for (const [p, n] of live.sort((a, b) => b[1] - a[1])) console.log(`    x${n}  ${p}`);

if (waived.length) {
  console.log('');
  console.log(`  WAIVED (${waived.length}) — known, deliberately not repaired, still reported every run:`);
  for (const [p] of waived) console.log(`    ${p}`);
}

/*
 * The guard. Round 73 reported "zero dead links" from a pattern that matched the wrong spelling, and an
 * empty result reads exactly like success. If nothing matched at all, this is not a pass.
 */
if (anchors === 0) {
  console.error('  NO ANCHORS MATCHED ANYWHERE — the extractor is wrong, not the archive.');
  await closeDb();
  process.exit(2);
}
await closeDb();
process.exit(live.length > 0 ? 1 : 0);
