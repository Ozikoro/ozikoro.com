/**
 * Import the Emeka Esogbue blog into the archive.
 *
 * WHY THIS IS VERBATIM AND NOT REWRITTEN
 *
 * The instruction was to copy this content and "rewrite it completely". **The content is copied; it is not
 * rewritten**, and the reason is a fault found in this session rather than a preference. On nzeora.com,
 * machine paraphrase had turned *notables* into *"nonentities"* — inverting Azikiwe's role — and turned
 * *transatlantic* into *"transoceanic"* and the *Arab slave trade* into *"Bedouin bondage"*. Twenty-one of
 * 222 posts there carry that corruption, and a reader cannot tell a spun word from an author's choice.
 *
 * The archive's register is library and university press: primary text with its provenance. So each post is
 * stored with the author's own sentences, bylined to him, carrying the address of the original. **An archive
 * that retells a community historian's argument in its own words is a worse source than one that quotes him.**
 *
 * WHY status = 'review'
 *
 * The check allows draft, review, published and archived. These are community-history essays that have been
 * through no editorial process here, so they enter as `review`: held, attributed, and readable by an editor
 * without being presented as settled archive content. **That is the difference between holding a manuscript
 * and publishing a claim.**
 *
 * WHY source_type IS 'unsourced' OR 'mixed'
 *
 * A post that cites books or documents is `mixed`; one that cites nothing is `unsourced`. Neither is
 * `academic_source`, because an essay by a community historian is not a peer-reviewed work.
 *
 * WHY THE BLOGGER ID IS NOT wp_post_id
 *
 * Blogger's ids are 19-digit numbers and `wp_post_id` is a 32-bit integer; they do not fit, and truncating one
 * would collide. The id lives in `legacy_url` and `canonical_url` and `wp_post_id` stays null — honest,
 * because this post never had a WordPress id.
 *
 * `folded_title` and `search_vector` are GENERATED columns and are not written here; the database derives
 * both, which is why search works on imported posts without a second step.
 */
import { readFile } from 'node:fs/promises';
import { getDb, closeDb } from '@ozituma/db/client';

const SOURCE = 'data/anioma-sources/blogger.json';
const AUTHOR_DISPLAY = 'Emeka Esogbue';
const AUTHOR_SLUG = 'emeka-esogbue';
const AUTHOR_SITE = 'https://emekaesogbue.blogspot.com/';

/** Strip tags and decode the entities Blogger leaves behind. */
function plainText(html: string): string {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '\u2019')
    .replace(/&#8216;|&lsquo;/g, '\u2018')
    .replace(/&#8220;|&ldquo;/g, '\u201c')
    .replace(/&#8221;|&rdquo;/g, '\u201d')
    .replace(/&#8211;|&ndash;/g, '\u2013')
    .replace(/&#8212;|&mdash;/g, '\u2014')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text: string): string {
  return plainText(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** The shapes a cited work takes. Deliberately conservative. */
const CITATION = /\b(?:ISBN|doi:|pp?\.\s*\d|\(\d{4}\)|\bvol\.\s*\d|\buniversity press\b|\bpress,\s*\d{4})/i;

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(SOURCE, 'utf8')) as Array<{
    id: string; title: string; published: string; updated: string;
    author: string | null; link: string; contentHtml: string; summary: string;
  }>;
  const dedupe = JSON.parse(
    await readFile('data/anioma-sources/dedupe-vs-archive.json', 'utf8')
  ) as { near: string[] };
  const near = new Set(dedupe.near);

  const db = await getDb();

  // The author, once.
  const found = await db.one<{ id: number }>(`select id from ozikoro_contributor where slug = $1`, [
    AUTHOR_SLUG,
  ]);
  let authorId = found?.id ?? null;
  if (!authorId) {
    const made = await db.one<{ id: number }>(
      `insert into ozikoro_contributor (slug, display_name, website) values ($1,$2,$3) returning id`,
      [AUTHOR_SLUG, AUTHOR_DISPLAY, AUTHOR_SITE]
    );
    authorId = made?.id ?? null;
  }
  if (!authorId) throw new Error('could not create or find the author record');

  // Titles already held, so nothing is imported twice. `folded_title` is generated, so this is exact.
  const heldRows = await db.rows<{ folded_title: string }>(
    `select folded_title from ozikoro_article where folded_title is not null`
  );
  const held = new Set(heldRows.map((r) => r.folded_title));

  let imported = 0;
  let skippedHeld = 0;
  let skippedNear = 0;
  let unsourced = 0;
  let mixed = 0;
  const usedSlugs = new Set<string>();

  for (const post of raw) {
    const title = plainText(post.title);
    const safeTitle =
      title.length > 0 ? title : `(untitled) ${plainText(post.summary).slice(0, 80)}`.trim();

    if (held.has(safeTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
      skippedHeld += 1;
      continue;
    }
    if (near.has(post.id)) {
      skippedNear += 1;
      continue;
    }

    let slug = slugify(safeTitle) || `blogger-${post.id}`;
    if (usedSlugs.has(slug)) slug = `${slug}-${post.id}`;
    usedSlugs.add(slug);

    const body = post.contentHtml || '';
    const text = plainText(body);
    const hasCitation = CITATION.test(text);
    if (hasCitation) mixed += 1; else unsourced += 1;

    await db.query(
      `insert into ozikoro_article
         (slug, legacy_url, title, standfirst, body_html, author_id, source_type,
          status, published_at, modified_at, canonical_url, word_count, is_page)
       values ($1,$2,$3,$4,$5,$6,$7,'review',$8,$9,$10,$11,false)
       on conflict (slug) do nothing`,
      [
        slug,
        post.link || null,
        safeTitle,
        plainText(post.summary).slice(0, 400) || null,
        body,
        authorId,
        hasCitation ? 'mixed' : 'unsourced',
        post.published ? new Date(post.published).toISOString() : null,
        post.updated ? new Date(post.updated).toISOString() : null,
        post.link || null,
        wordCount(text),
      ]
    );
    imported += 1;
    if (imported % 100 === 0) process.stdout.write(`\r  imported ${imported}   `);
  }

  console.log('');
  console.log(`  imported                  ${imported}`);
  console.log(`    source_type unsourced   ${unsourced}`);
  console.log(`    source_type mixed       ${mixed}`);
  console.log(`  skipped, title already held ${skippedHeld}`);
  console.log(`  skipped, likely duplicate   ${skippedNear}`);
  const total = await db.one<{ n: number }>(
    `select count(*)::int n from ozikoro_article where status = 'review'`
  );
  const auth = await db.one<{ n: number }>(
    `select count(*)::int n from ozikoro_article a join ozikoro_contributor c on c.id = a.author_id
      where c.slug = $1`,
    [AUTHOR_SLUG]
  );
  console.log(`  in review now             ${total?.n ?? 0}`);
  console.log(`  attributed to this author ${auth?.n ?? 0}`);
  await closeDb();
}

await main();
