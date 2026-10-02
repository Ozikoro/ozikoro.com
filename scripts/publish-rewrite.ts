/**
 * Publish a rewritten article, attributed to its author and carrying its source.
 *
 * THE BYLINE AND THE PROVENANCE ARE BOTH REQUIRED, AND THEY SAY DIFFERENT THINGS
 *
 * The author is Idenze Ezeme, because the piece is his writing — his sentences, his argument, his voice. A
 * rewrite does not stop being his work, so it does not lose his name.
 *
 * The provenance says where the material came from. These pieces are written FROM a published article by the
 * same author, plus verification against other sources, and the record must say so: a reader who wants the
 * earlier version, or wants to see how this one differs, has to be able to find it. **That is not a
 * disclaimer, it is the archive's whole claim about itself.**
 *
 * WHY THE SOURCE GOES IN `legacy_url` AND NOT `canonical_url`
 *
 * `canonical_url` names the address THIS article is published at, and search engines use it to decide which
 * page is the original. Pointing it at a different site would tell them this page is a copy of that one. The
 * earlier article is a *source*, not a canonical alternate, so it goes in `legacy_url` — the column that
 * already means "a related address this record came from" — with the relationship stated in `standfirst`.
 *
 * USAGE
 *   node scripts/publish-rewrite.ts <file.md> <source-url> <source-title>
 */
import { readFile } from 'node:fs/promises';
import { getDb, closeDb } from '@ozituma/db/client';

const AUTHOR_SLUG = 'nze'; // Idenze Ezeme — the contributor record that already exists.
const SOURCE_TYPE = 'mixed'; // Written from a published account AND verified against other sources.

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
const slugify = (t: string) =>
  plainText(t).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** Markdown to the HTML the archive stores. Deliberately minimal: headings, bold, italic, paragraphs. */
function markdownToHtml(md: string): string {
  const out: string[] = [];
  for (const raw of md.split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(block);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      continue;
    }
    out.push(`<p>${inline(block).replace(/\n/g, ' ')}</p>`);
  }
  return out.join('\n');
}
function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&amp;(strong|em|lt|gt|amp|#\d+);/g, '&$1;');
}

const [file, sourceUrl, sourceTitle] = process.argv.slice(2);
if (!file || !sourceUrl) {
  console.error('usage: node scripts/publish-rewrite.ts <file.md> <source-url> [source-title]');
  process.exit(2);
}

const md = await readFile(file, 'utf8');
const titleLine = /^#\s+(.+)$/m.exec(md);
if (!titleLine) throw new Error('the draft has no "# title" line');
const title = plainText(titleLine[1]!);
const bodyMd = md.replace(/^#\s+.+$/m, '').trim();

const db = await getDb();
const author = await db.one<{ id: number }>(`select id from ozikoro_contributor where slug = $1`, [AUTHOR_SLUG]);
if (!author) throw new Error(`no contributor with slug ${AUTHOR_SLUG}`);

const slug = slugify(title);
const bodyHtml = markdownToHtml(bodyMd);
const text = plainText(bodyHtml);

/*
 * The standfirst states the provenance plainly, in the record rather than only on the page. It names the
 * earlier article so the relationship survives anywhere this record travels.
 */
const standfirst =
  `By Idenze Ezeme, for Ozikoro. Written from “${sourceTitle ?? 'an earlier article'}”, ` +
  `verified against further sources.`;

await db.query(
  `insert into ozikoro_article
     (slug, legacy_url, title, standfirst, body_html, author_id, source_type,
      status, published_at, modified_at, word_count, is_page, topic_id)
   values ($1,$2,$3,$4,$5,$6,$7,'published',now(),now(),$8,false,
           (select id from ozikoro_topic where slug = 'cultural-heritage'))
   on conflict (slug) do update set
     title = excluded.title, standfirst = excluded.standfirst, body_html = excluded.body_html,
     author_id = excluded.author_id, source_type = excluded.source_type, status = excluded.status,
     published_at = excluded.published_at, modified_at = excluded.modified_at,
     word_count = excluded.word_count, topic_id = excluded.topic_id, updated_at = now()`,
  [slug, sourceUrl, title, standfirst, bodyHtml, author.id, SOURCE_TYPE, words(text)]
);

const saved = await db.one<{ id: number; slug: string; status: string; w: number }>(
  `select id, slug, status, word_count w from ozikoro_article where slug = $1`, [slug]
);
console.log(`  published  #${saved?.id}  ${saved?.slug}`);
console.log(`  author     Idenze Ezeme (contributor ${author.id})`);
console.log(`  status     ${saved?.status}  ·  ${saved?.w} words`);
console.log(`  source     ${sourceUrl}`);
await closeDb();
