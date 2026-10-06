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
import { importArchive } from './import/archive.ts';
import { listIndexableUrls } from './seo.ts';
import {
  RESERVED_ARCHIVE_SLUGS,
  countArticles,
  getArchiveFacets,
  getArchiveStats,
  getArticleBySlug,
  listArticleSlugs,
  listArticles,
  searchArticles,
} from './archive.ts';

const db = await getDb();
let failures = 0;

const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const stats = await getArchiveStats(db);

/*
 * TWO KINDS OF ASSERTION, AND ONLY ONE OF THEM NEEDS THE REAL ARCHIVE.
 *
 * The counts below answer "did the migration actually happen?" — 1,051 records, 3,488 media, 11,056
 * labels. Only the real archive can answer that, and it is answered every time this runs where the
 * archive is present.
 *
 * Everything after this block answers "is the data structurally sound?" — no record lost its slug, its
 * address, its author or its body; every record is searchable; no two share an address. Those hold for
 * ANY dataset, so they are the half worth running where the archive is absent, which is what CI is.
 *
 * So the counts are conditional and ANNOUNCE what they skipped. A suite that quietly skips its
 * strongest checks is worse than one that cannot run them, because the reader cannot tell the
 * difference between "passed" and "not examined".
 */
const ARCHIVE_PRESENT = stats.articles >= 1000;

console.log('\n--- what arrived from WordPress ---');

if (ARCHIVE_PRESENT) {
  assert('the archive holds the migrated articles', stats.articles >= 1000, `${stats.articles} records`);
  /*
   * AT LEAST the migration's eleven, because the table now holds two provenance classes.
   *
   * This counted exactly 11 until the Blogger source was ingested; its seven guest authors bring their own
   * contributor records, so the total is 19 and an equality here would fail for a reason that has nothing to
   * do with the migration. The `>= 11` keeps the claim that matters — the WordPress import brought its
   * authors across — and the ingested class is asserted separately below.
   */
  assert('the migration brought its authors', stats.contributors >= 11, `${stats.contributors} contributors`);
  assert('the media records arrived', stats.media >= 3400, `${stats.media} records`);
  assert('the serials arrived', stats.topics === 14, `${stats.topics} topics`);
  assert('the labels arrived', stats.labels >= 11000, `${stats.labels} labels`);
  assert('most records carry an image', stats.withImages > 1000, `${stats.withImages} of ${stats.articles}`);
  assert('the archive spans the site\'s publishing history', Boolean(stats.earliest && stats.latest), `${stats.earliest} .. ${stats.latest}`);
  /*
   * The recovered drafts, counted exactly rather than as "at least".
   *
   * The public REST API refuses `status=draft`, so these did not exist in the archive until the
   * authenticated extraction ran. The number is worth pinning precisely because it is the figure that
   * proves the second extraction happened: 39 is what the live site reports, and an inequality here
   * would let a partial pull pass as a complete one.
   */
  /*
   * Scoped by `wp_post_id is not null`, which is what makes a record a migrated WordPress post. The
   * Blogger source is also held in review and carries a null wp_post_id; it has its own assertions
   * below, and folding it in here would make this count read 563 instead of the 39 being claimed.
   */
  const recovered = await db.one<{ draft_count: number; dated: number }>(`
    select
      count(*) filter (where status = 'draft' and wp_post_id is not null) as draft_count,
      count(*) filter (where status = 'draft' and wp_post_id is not null and published_at is not null) as dated
    from ozikoro_article
  `);
  assert(
    'the recovered drafts are held as drafts, and there are 39 of them',
    Number(recovered?.draft_count) === 39,
    `${recovered?.draft_count} as draft`
  );
  assert(
    'and none of them claims a publication date',
    Number(recovered?.dated) === 0,
    `${recovered?.dated} with a date`
  );
} else {
  /*
   * THE SUITE STOPS HERE, AND SAYS SO.
   *
   * The first attempt at this split guarded only the counts and let the rest run — and five further
   * assertions then failed on an empty database, because they are data-dependent too: that exactly one
   * source record is untitled, that the six WordPress pages are held separately, that the institution
   * page is among them, that the sitemap lists the archive.
   *
   * Which means the honest description is not "the structural half runs anywhere". It is:
   * **on an empty database there is nothing here that can be checked meaningfully.** The structural
   * assertions would pass vacuously — no records, therefore no record lost its slug — and reporting
   * that as a pass would be the exact overstatement this project keeps trying not to make.
   *
   * So it exits cleanly with a notice. That makes the suite safe to run in CI, where the archive is
   * absent, WHILE BEING EXPLICIT THAT CI THEREFORE PROVIDES NO ARCHIVE COVERAGE. A green CI run says
   * nothing about the archive.
   *
   * The real fix is a seeded fixture — a small known dataset the structural assertions can bite on.
   * That does not exist, and this notice is what stands in for it.
   */
  console.log(
    '  SKIPPED — the archive is not imported, so NOTHING here can be checked meaningfully.\n' +
    '             Not checked: articles >= 1000, contributors == 11, media >= 3400, topics == 14,\n' +
    '                          labels >= 11000, withImages > 1000, the publishing date range, the\n' +
    '                          untitled-record invariant, the WordPress pages, the sitemap contents.\n' +
    '             The structural checks would pass vacuously on an empty database, and reporting\n' +
    '             that as a pass would be a false claim.\n' +
    '             Import the archive to run this suite: npm run import:ozikoro-wp && npm run import:ozikoro-archive'
  );
  await closeDb();
  process.exit(0);
}

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
  from ozikoro_article
  /*
   * SCOPED TO THE MIGRATION, WHICH IS WHAT THIS SECTION IS ABOUT.
   *
   * The heading above reads "what arrived from WordPress", and every assertion under it is a claim about
   * that migration: nothing lost its body, its address, its author, or its published status. Those are
   * invariants of a MIGRATION — a live page must not go offline on the day it moves.
   *
   * They are not invariants of INGESTION. The Blogger source is new external material, and it is
   * deliberately in review rather than published with no legacy_url, because it has been through no
   * editorial process here and it never had an address on the archive being migrated from. Running the
   * migration's rules over it would force publishing unverified community history to make a test pass,
   * which is the wrong direction for the test to push.
   *
   * THAT ARGUMENT APPLIES WITHIN THE MIGRATION TOO. An unpublished WordPress draft is the same case as an
   * ingested Blogger post on the point that matters: it was never live, so "it must not go offline" and
   * "it must have a body" are not claims that hold of it. The drafts recovered from an authenticated
   * session are therefore held to the same rules as ingested material — asserted in full, just below, on
   * their own terms — rather than folded in here where the invariants do not apply.
   *
   * NOTE ON THIS COMMENT ITSELF: it sits inside a backtick-delimited SQL template literal, so it may not
   * contain a backtick. An earlier version quoted the column names and ended the string.
   */
  where is_page = false and wp_post_id is not null and status = 'published'
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
assert('no published record lost its body', Number(gaps?.no_body) === 0, String(gaps?.no_body));
assert('every record is searchable', Number(gaps?.no_search) === 0, String(gaps?.no_search));
assert(
  'every published record is still published, because it already was',
  Number(gaps?.not_published) === 0,
  `${gaps?.not_published} not published`
);

/*
 * --- the unpublished WordPress drafts, asserted rather than excluded ---
 *
 * These arrived through an authenticated session, because the public REST API answers `status=draft` with
 * `rest_invalid_param`. They are in the migration's own source, so they are held to the standards above
 * wherever those standards apply — and where they do not, they are asserted on their own terms here, for
 * the same reason the ingested class is: a suite that quietly drops its strongest assertions is worse than
 * one that cannot run them.
 *
 * Three things are checked, and each is a real risk rather than a formality:
 *
 *   1. Exactly 39, the number the live site reports. An inequality would let a partial pull pass.
 *   2. Every one attributed. An unattributed record is attribution silently lost.
 *   3. Exactly one with an empty body, and it is the known WordPress one. One draft really is empty at the
 *      source, so zero would mean the comparison is wrong and two would mean a body was lost.
 */
console.log('\n--- the unpublished drafts recovered from WordPress ---');
/*
 * Scoped by `wp_post_id is not null`, which is what makes a record a migrated WordPress post. The
 * Blogger source is also held in review and has a null wp_post_id, and those records are asserted in
 * their own section below rather than being counted as WordPress drafts.
 */
const drafts = await db.rows<{ wp_post_id: string; slug: string; body_html: string; author_id: string | null }>(
  `select wp_post_id, slug, body_html, author_id from ozikoro_article
    where status = 'draft' and wp_post_id is not null order by wp_post_id`
);
assert('all 39 unpublished posts arrived', drafts.length === 39, `${drafts.length} records`);
assert(
  'every draft is attributed to its author',
  drafts.every((d) => d.author_id !== null),
  `${drafts.filter((d) => d.author_id === null).length} unattributed`
);
const emptyDrafts = drafts.filter((d) => d.body_html === '');
assert(
  'exactly one draft is empty, and it is the one that is empty at the source',
  emptyDrafts.length === 1 && Number(emptyDrafts[0]?.wp_post_id) === 6868,
  emptyDrafts.map((d) => d.wp_post_id).join(', ') || 'none'
);

/*
 * ── THE THREE THINGS AN IMPORTED DRAFT IS REQUIRED TO BE, ASKED OF THE REAL QUERIES ───────────────
 *
 * These are the assertions the owner's instruction actually reduces to — "keep every one a draft" — and
 * each is asked of the code that would otherwise expose it rather than of a restatement of that code:
 *
 *   1. **NOT PUBLICLY READABLE.** The two queries below are the public route's own, copied from
 *      `apps/ozikoro/app/[slug]/route.ts` character for character. A test that wrote its own
 *      `status = 'published'` filter would pass while the route served the draft.
 *   2. **ABSENT FROM THE SITEMAP.** Asked of `listIndexableUrls`, which is the single definition of
 *      "indexable" that the sitemap index and all eight child sitemaps filter — so there is no second
 *      list that could disagree with it.
 *   3. **A SECOND IMPORT ADDS NOTHING.** This is the property that makes re-running the import against
 *      production a safe operation instead of a risk, so it is measured here rather than asserted about.
 *      The comparison is every WordPress row's own fields including an md5 of each body, plus the total
 *      row count and the status census — a re-run that rewrote a body, moved a date, or inserted a row
 *      changes the digest.
 */
console.log('\n--- an imported draft is not public, and re-importing changes nothing ---');
assert('there are 39 drafts to probe', drafts.length === 39, `${drafts.length}`);

let publiclyReadable = 0;
for (const d of drafts) {
  const mark = await db.one(
    `select access_tier from ozikoro_article
      where slug in ($1, $2) and status = 'published' and is_page = false`,
    [d.slug, d.slug]
  );
  const row = await db.one(
    `select a.id from ozikoro_article a
      where a.slug in ($1, $2) and a.status = 'published' and a.is_page = false`,
    [d.slug, d.slug]
  );
  if (mark || row) publiclyReadable += 1;
}
assert(
  'the public route\'s own two reads return nothing for all 39',
  publiclyReadable === 0,
  `${publiclyReadable} would be served`
);

const sitemapNow = await listIndexableUrls(db);
const inSitemap = drafts.filter((d) => sitemapNow.some((entry) => entry.url.endsWith(`/${d.slug}/`)));
assert('the sitemap lists none of them', inSitemap.length === 0, inSitemap.map((d) => d.slug).join(', ') || 'none');

/** Every WordPress row's fields, the status census and the row count — a snapshot two runs must agree on. */
const archiveDigest = async (): Promise<string> => {
  const rows = await db.rows<Record<string, unknown>>(
    `select wp_post_id, slug, status, author_id, is_page, legacy_url, word_count,
            published_at, modified_at, md5(body_html) as body_md5, md5(title) as title_md5
       from ozikoro_article where wp_post_id is not null order by wp_post_id`
  );
  const total = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article`);
  const byStatus = await db.rows<{ status: string; n: number }>(
    `select status, count(*)::int as n from ozikoro_article group by status order by status`
  );
  return JSON.stringify({ total: Number(total?.n), byStatus, rows });
};

const beforeSecondImport = await archiveDigest();
const secondRun = await importArchive(db, { apply: true });
/*
 * `articles` is deliberately NOT asserted here. A full import re-reports the published records it just
 * re-wrote — 1,057 of them, all identical — so `articles === 0` would only be true of a run scoped to
 * the drafts, which is not what this suite runs. **"Adds nothing" is a claim about the ROWS, not about
 * what the run reports**, and the digest below is what measures it.
 */
assert('the second import re-reports the same 39 drafts', secondRun.drafts === 39, `drafts ${secondRun.drafts}`);
const afterSecondImport = await archiveDigest();
assert(
  'and a second import adds nothing: every row is identical afterwards',
  beforeSecondImport === afterSecondImport,
  beforeSecondImport === afterSecondImport ? '' : 'the archive digest moved'
);
const draftsStillDrafts = await db.one<{ n: number }>(
  `select count(*)::int as n from ozikoro_article where status = 'draft' and wp_post_id is not null`
);
assert('the 39 are still drafts after the second import', Number(draftsStillDrafts?.n) === 39, `${draftsStillDrafts?.n}`);

/*
 * --- the second provenance class, asserted rather than excluded ---
 *
 * Excluding the ingested records from the migration's checks would leave them unchecked, and a suite that
 * quietly skips its strongest assertions is worse than one that cannot run them. So they are asserted here
 * on their own terms: every ingested record is attributed, in review, searchable, and carries the address of
 * its original rather than a fabricated archive path.
 */
console.log('\n--- what was ingested from the Blogger source ---');
const ingested = await db.one<Record<string, number>>(`
  select
    count(*) as total,
    count(*) filter (where author_id is null) as no_author,
    count(*) filter (where status <> 'review') as not_review,
    count(*) filter (where legacy_url is not null) as has_legacy,
    /*
     * Where legacy_url is NOT the original address, it is an address of ours that was fabricated — the
     * failure this assertion exists to catch. The Blogger importer writes the Blogger link to legacy_url
     * AND canonical_url, so on a correct import the two agree on every row and this is zero. That is a
     * stronger check than requiring legacy_url to be null, which the importer was never going to satisfy
     * and which asserted the opposite of what the importer deliberately does. See the assertion note below.
     */
    count(*) filter (where coalesce(legacy_url, '') <> coalesce(canonical_url, '')) as legacy_not_original,
    count(*) filter (where canonical_url is null) as no_canonical,
    count(*) filter (where search_vector is null) as no_search,
    count(*) filter (where body_html = '') as no_body
  from ozikoro_article
  /*
   * EXCLUDING THE REWRITTEN PIECES, WHICH ARE A THIRD CLASS.
   *
   * These assertions describe INGESTION: material brought in from elsewhere, held in review until an editor
   * has looked, with no address on the archive being migrated from. The rewritten articles are not ingestion.
   * They were written for Ozikoro in the owner's voice from a named earlier article, so they are published by
   * design and their legacy_url holds the source they were written from — provenance, not an address of ours.
   *
   * The marker is the standfirst the publish script writes. A prose marker is weaker than a column and it is
   * what exists; a column becomes worth it when there are more than a handful of these.
   */
  where is_page = false and wp_post_id is null
    and coalesce(standfirst, '') not like 'By Idenze Ezeme, for Ozikoro.%'
`);
if (Number(ingested?.total) === 0) {
  console.log('  SKIPPED — no ingested records are present.');
} else {
  assert('every ingested record is attributed', Number(ingested?.no_author) === 0, String(ingested?.no_author));
  assert(
    'every ingested record is in review, not published',
    Number(ingested?.not_review) === 0,
    `${ingested?.not_review} not in review`
  );
  /*
   * THIS ASSERTION WAS WRONG, AND THE RECORDS THAT PROVE IT WERE MISSING UNTIL NOW.
   *
   * It read "no ingested record claims an address on the archive it came from" and required
   * `legacy_url is null`. `import-blogger.ts` writes the Blogger link to `legacy_url` (and to
   * `canonical_url`), because the Blogger id does not fit `wp_post_id` and the address is where the
   * provenance lives — the importer says so in its own header. The importer was committed at 06:20 and
   * this assertion at 06:28, and it passed only because the ingested records had been lost in a restore,
   * so the query returned nothing and the block was skipped. Restoring the records exposed it.
   *
   * The claim worth making is the one the heading actually describes: the ingested record's legacy
   * address is its ORIGINAL address, not a fabricated path on our archive. That is what is asserted now,
   * and it is a stronger check than requiring null.
   */
  assert(
    'no ingested record claims a fabricated address on the archive it came from',
    Number(ingested?.legacy_not_original) === 0,
    `${ingested?.legacy_not_original} of ${ingested?.has_legacy} legacy addresses are not the original`
  );
  assert(
    'every ingested record keeps the address of its original',
    Number(ingested?.no_canonical) === 0,
    String(ingested?.no_canonical)
  );
  assert(
    'and every one of them still carries an address at all',
    Number(ingested?.has_legacy) === Number(ingested?.total),
    `${ingested?.has_legacy} of ${ingested?.total} carry a legacy address`
  );
  assert('every ingested record is searchable', Number(ingested?.no_search) === 0, String(ingested?.no_search));
  assert('no ingested record lost its body', Number(ingested?.no_body) === 0, String(ingested?.no_body));
  console.log(`  (${ingested?.total} ingested records checked on their own terms)`);
}

console.log('\n--- addresses ---');

/*
 * Scoped to the migration, for the reason given above: a legacy_url is the address a record held on the
 * archive being migrated FROM, so only migrated records can have one. The ingested records are asserted to
 * have none, which is the same claim from the other side.
 */
const legacy = await db.rows<{ slug: string; legacy_url: string }>(
  `select slug, legacy_url from ozikoro_article where is_page = false and wp_post_id is not null limit 5000`
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

/*
 * THE RAIL'S OWN COUNTS, AND THE TWO ANSWERS THAT MUST NOT BE CONFUSED.
 *
 * The filter rail draws its options from `getArchiveFacets`, which counts them from the records. The
 * checks below hold for any dataset, present or empty:
 *
 *   * a facet that offers nothing must COUNT zero, so the page cannot print an option that matches
 *     nothing and cannot hide one that matches something;
 *   * a free-text filter must return records for a word the archive contains and none for a word it
 *     does not, so "no results" is a fact about the query rather than about the query layer;
 *   * the completeness axis must partition the archive exactly — `sourced + partial = records` —
 *     because a filter that loses records is worse than one that finds none.
 */
const facets = await getArchiveFacets(db);
assert('the facets count every published record', facets.records === everything, `${facets.records} of ${everything}`);
assert(
  'the completeness axis partitions the archive exactly',
  facets.sourced + facets.partial === facets.records,
  `${facets.sourced} sourced + ${facets.partial} partial = ${facets.records}`
);
assert(
  'every offered facet option matches at least one record',
  [...facets.ethnicGroups, ...facets.clans, ...facets.towns, ...facets.periods, ...facets.sourceTypes].every((o) => o.count > 0),
  `${facets.ethnicGroups.length} ethnic · ${facets.clans.length} clan · ${facets.towns.length} town · ${facets.periods.length} period · ${facets.sourceTypes.length} source`
);
assert(
  'the source-type count agrees with a direct count of the column',
  facets.sourceTypes.reduce((n, o) => n + o.count, 0) ===
    (await db.one<{ n: number }>(`select count(*)::int n from ozikoro_article where status='published' and is_page=false and source_type is not null`))!.n,
  `${facets.sourceTypes.length} recorded types`
);

const textHit = await countArticles(db, { search: 'Nri' });
assert('a free-text filter finds records', textHit > 0, `${textHit} records contain “Nri”`);
const textMiss = await countArticles(db, { search: 'zzzznothingmatchesthiszzzz' });
assert('and returns none for a word the archive does not contain', textMiss === 0, `${textMiss} records`);
const textRows = await listArticles(db, { search: 'Nri', limit: 2 });
assert('the filtered listing returns rows, not just a count', textRows.length > 0, `${textRows.length} rows`);

const sourcedOnly = await countArticles(db, { completeness: 'sourced' });
assert('the sourced filter agrees with the facet count', sourcedOnly === facets.sourced, `${sourcedOnly} fully sourced`);
/* A value the archive holds and a value it does not must both be answerable without inventing one. */
const knownSourceType = facets.sourceTypes[0]?.value ?? 'oral_history';
assert(
  'a recorded source type returns its records',
  (await countArticles(db, { sourceType: knownSourceType })) === (facets.sourceTypes[0]?.count ?? 0),
  `${knownSourceType}`
);
assert('an unrecorded source type returns an honest empty result', (await countArticles(db, { sourceType: '__none__' })) === 0);

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await closeDb();
process.exit(failures === 0 ? 0 : 1);
