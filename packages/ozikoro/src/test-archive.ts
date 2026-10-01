/**
 * What the migration actually produced.
 *
 * The content tests prove the HTML pipeline is safe. These check the other half: that 1,051
 * articles really did arrive from WordPress, that their addresses are intact, that the archive
 * queries exclude the site's own pages, and that search finds what a reader would search for.
 *
 * A migration is the one operation in this repository that can silently lose something
 * irreplaceable, and the source site is still the only other copy. So the assertions are about
 * completeness and address preservation rather than about behaviour.
 *
 * Run with: npm -w @ozikoro/platform run test:archive
 */
import { getDb, closeDb } from '@ozituma/db/client';
import {
  RESERVED_ARCHIVE_SLUGS,
  countArticles,
  getArchiveStats,
  getArticleBySlug,
  listArticleSlugs,
  searchArticles,
} from './archive.ts';

const db = await getDb();
let failures = 0;

const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log('\n--- what arrived from WordPress ---');

const stats = await getArchiveStats(db);
assert('the archive holds the migrated articles', stats.articles >= 1000, `${stats.articles} records`);
assert('every article has an author', stats.contributors === 11, `${stats.contributors} contributors`);
assert('the media records arrived', stats.media >= 3400, `${stats.media} records`);
assert('the serials arrived', stats.topics === 14, `${stats.topics} topics`);
assert('the labels arrived', stats.labels >= 11000, `${stats.labels} labels`);
assert('most records carry an image', stats.withImages > 1000, `${stats.withImages} of ${stats.articles}`);
assert('the archive spans the site\'s publishing history', Boolean(stats.earliest && stats.latest), `${stats.earliest} .. ${stats.latest}`);

console.log('\n--- completeness ---');

const gaps = await db.one<Record<string, number>>(`
  select
    count(*) filter (where title is null or title = '') as no_title,
    count(*) filter (where slug is null or slug = '') as no_slug,
    count(*) filter (where legacy_url is null) as no_legacy,
    count(*) filter (where author_id is null) as no_author,
    count(*) filter (where body_html = '') as no_body,
    count(*) filter (where search_vector is null) as no_search,
    count(*) filter (where status <> 'published') as not_published
  from ozikoro_article where is_page = false
`);
/*
 * One source record has no title. Asserted as exactly one, by name, rather than as zero: the
 * migration must not lose a title, and it must not invent one either. Comparing against the
 * source is the honest test, and naming the known exception means a second untitled record
 * appearing later is caught rather than absorbed.
 */
assert(
  'no record lost a title it had (one source record never had one)',
  Number(gaps?.no_title) === 1,
  `${gaps?.no_title} untitled`
);
const untitled = await db.rows<{ slug: string }>(
  `select slug from ozikoro_article where is_page = false and (title is null or title = '')`
);
assert(
  'and the untitled record is the known WordPress one',
  untitled.length === 1 && untitled[0]?.slug === '3774-2',
  untitled.map((u) => u.slug).join(', ')
);
assert('no record lost its slug', Number(gaps?.no_slug) === 0, String(gaps?.no_slug));
assert('no record lost the address it was published at', Number(gaps?.no_legacy) === 0, String(gaps?.no_legacy));
assert('no record lost its author', Number(gaps?.no_author) === 0, String(gaps?.no_author));
assert('no record lost its body', Number(gaps?.no_body) === 0, String(gaps?.no_body));
assert('every record is searchable', Number(gaps?.no_search) === 0, String(gaps?.no_search));
assert(
  'imported records are published, because they already were',
  Number(gaps?.not_published) === 0,
  `${gaps?.not_published} not published`
);

console.log('\n--- addresses ---');

const legacy = await db.rows<{ slug: string; legacy_url: string }>(
  `select slug, legacy_url from ozikoro_article where is_page = false limit 5000`
);
const mismatched = legacy.filter((r) => r.legacy_url !== `/${r.slug}/`);
assert(
  'every record keeps its exact original path, so no redirect is needed',
  mismatched.length === 0,
  mismatched.length > 0 ? `${mismatched.length} differ, e.g. ${mismatched[0]?.legacy_url}` : `${legacy.length} checked`
);

const duplicates = await db.rows(`select slug from ozikoro_article group by slug having count(*) > 1`);
assert('no two records share an address', duplicates.length === 0, String(duplicates.length));

/*
 * A reserved name would be unreachable: Next.js resolves a static segment before a dynamic one, so
 * an article slugged `archive` would never be served. The importer reports such a clash, and this
 * asserts there is none rather than trusting that it did.
 */
const reserved = [...RESERVED_ARCHIVE_SLUGS];
const clashes = await db.rows<{ slug: string }>(
  `select slug from ozikoro_article where is_page = false and slug = any($1)`,
  [reserved]
);
assert('no archive record is shadowed by a site route', clashes.length === 0, clashes.map((c) => c.slug).join(', '));

console.log('\n--- pages are not records ---');

const pages = await db.rows<{ slug: string }>(`select slug from ozikoro_article where is_page = true`);
assert('the WordPress pages are held separately', pages.length === 6, `${pages.length} pages`);
const pageSlugs = pages.map((p) => p.slug);
assert('the institution page is among them', pageSlugs.includes('about'), pageSlugs.join(', '));

const archiveQuery = await db.one<{ n: number }>(
  `select count(*)::int as n from ozikoro_article where slug = 'privacy-policy' and is_page = false`
);
assert('a site page cannot appear as an archive record', Number(archiveQuery?.n) === 0);
const listed = await listArticleSlugs(db);
assert('and cannot reach the sitemap as one', !listed.some((a) => a.slug === 'privacy-policy'));
assert('the sitemap lists the archive', listed.length >= 1000, `${listed.length} entries`);

console.log('\n--- reading a record ---');

const known = 'ute-okpu-an-ika-igbo-clan-and-its-nri-roots';
const article = await getArticleBySlug(db, known);
assert('a known record loads', article !== null);
if (article) {
  assert('with its title', article.title.includes('Ute-Okpu'), article.title);
  assert('with its author', Boolean(article.authorName), article.authorName ?? 'none');
  assert('with its series', article.topicName === 'Historical Studies', article.topicName ?? 'none');
  assert('with its featured image', Boolean(article.imageUrl), article.imageUrl ?? 'none');
  assert('with its labels', article.labels.length > 0, `${article.labels.length} labels`);
  /*
   * The body must be sanitised on the way out, never the raw WordPress HTML. The check is that
   * nothing the sanitiser strips survived — not that the body is short, since the real body is
   * 11,000 characters of legitimate markup.
   */
  assert('with a body that has been sanitised', !/<script|<iframe|style=|elementor/i.test(article.bodyHtml));
  assert('with real prose in it', (article.bodyHtml.match(/<p[ >]/g) ?? []).length > 10, `${(article.bodyHtml.match(/<p[ >]/g) ?? []).length} paragraphs`);
  assert('and a citation ready to copy', article.citation.includes(article.title.slice(0, 12)), article.citation.slice(0, 80));
  /*
   * No sources yet, and that is the expected state: attaching them is a human editorial task, and
   * the page renders the design's `.unsourced` block. Asserted so that a future change which
   * silently invents a source is caught here.
   */
  assert('with no sources invented for it', article.sources.length === 0, `${article.sources.length} sources`);
}

/*
 * An untitled record must still render a heading, because an empty `<h1>` is not a record. The
 * stored title stays empty so the editorial queue can see the gap.
 */
const untitledRecord = await getArticleBySlug(db, '3774-2');
assert('an untitled record still has a display title', untitledRecord?.title === 'Untitled record', untitledRecord?.title ?? 'none');
const untitledRow = await db.one<{ title: string }>(`select title from ozikoro_article where slug = '3774-2'`);
assert('while the stored record keeps the gap visible to editors', untitledRow?.title === '', JSON.stringify(untitledRow?.title));

const missing = await getArticleBySlug(db, 'this-record-does-not-exist');
assert('an unknown address returns nothing rather than a wrong record', missing === null);

console.log('\n--- search ---');

const byTitle = await searchArticles(db, 'Ute-Okpu');
assert('a title search finds the record', byTitle.some((a) => a.slug === known), `${byTitle.length} results`);

const byBody = await searchArticles(db, 'Nri');
assert('a body search finds records', byBody.length > 0, `${byBody.length} results`);

const byLabel = await searchArticles(db, 'Ohafia');
assert('a label search finds records', byLabel.length > 0, `${byLabel.length} results`);

const nonsense = await searchArticles(db, 'zzzznothingmatchesthiszzzz');
assert('a search that matches nothing returns nothing, not everything', nonsense.length === 0, `${nonsense.length} results`);

const empty = await searchArticles(db, '   ');
assert('an empty search is not run', empty.length === 0);

console.log('\n--- filtering ---');

const historyOnly = await countArticles(db, { topicSlug: 'historical-studies' });
const everything = await countArticles(db);
assert('a series filter narrows the archive', historyOnly > 0 && historyOnly < everything, `${historyOnly} of ${everything}`);

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await closeDb();
process.exit(failures === 0 ? 0 : 1);
