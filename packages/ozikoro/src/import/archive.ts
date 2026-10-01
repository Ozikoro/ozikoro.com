/**
 * Import the extracted WordPress archive into the Ozikoro database.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY REFUSES TO DO
 *
 * It moves across exactly what WordPress actually held: 1,051 articles with their bodies
 * verbatim, 3,488 media records with their rights fields, 11 author identities, 14 categories
 * and 11,056 tags. Every row keeps its WordPress id, so a re-run updates the same rows instead
 * of duplicating them and a second import months from now is safe.
 *
 * What it does NOT do is decide what the articles are ABOUT. The design brief requires every
 * article to carry an ethnic group, a clan, a town and a period, and the technical scope names
 * assigning those as a human task — "a re-tagging tool ... so a human can go through each
 * article and assign it to an ethnic group, sub-group, and layer". So the structured facets are
 * left empty and the editorial screen fills them. A script that guessed a clan from an article's
 * prose would be inventing history, which the plan forbids in as many words.
 *
 * The consequence is deliberate and the design already anticipates it: an article with no source
 * renders the `.unsourced` state, which the design notes describe as making incompleteness "a
 * deliberate, legible state rather than an absence nobody notices". So the archive opens honest.
 *
 * ACCOUNTS ARE NOT CREATED, AND THAT IS NOT AN OVERSIGHT
 *
 * WordPress exposes no password hashes through any endpoint, so there is nothing to migrate.
 * The 11 authors become `ozikoro_contributor` rows — attribution — and a person gets an account
 * by registering on the new platform, at which point `ozikoro_contributor.account_id` links the
 * two. Inventing accounts with invented passwords would be worse than having none.
 *
 * Usage:
 *   node src/import/archive.ts --check     # report what would happen, change nothing
 *   node src/import/archive.ts --apply
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, closeDb, type Db } from '@ozituma/db/client';
import { WP_ORIGIN, OUT_DIR } from './wordpress.ts';

// ---------------------------------------------------------------------------
// Reading the extraction
// ---------------------------------------------------------------------------

interface ArticleRow {
  wpId: number;
  slug: string;
  url: string;
  title: string;
  contentHtml: string;
  excerptHtml: string;
  publishedAt: string;
  modifiedAt: string;
  authorId: number;
  featuredMediaId: number;
  categoryIds: number[];
  tagIds: number[];
  seo: { title: string | null; description: string | null; canonical: string | null; schema: unknown };
  wordCount: number;
}

interface MediaRow {
  wpId: number;
  slug: string;
  url: string;
  sourceUrl: string;
  mimeType: string;
  mediaType: string;
  title: string;
  altText: string;
  captionHtml: string;
  descriptionHtml: string;
  width: number | null;
  height: number | null;
  filesizeBytes: number | null;
  uploadedAt: string;
  authorId: number;
}

interface UserRow {
  wpId: number;
  slug: string;
  name: string;
  description: string;
  url: string;
  avatarUrls: Record<string, string>;
  link: string;
}

interface TaxonomyRow {
  wpId: number;
  slug: string;
  name: string;
  description: string;
  count: number;
  parent: number;
}

async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(OUT_DIR, name), 'utf8')) as T;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip tags and decode the handful of entities WordPress leaves in titles. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '\u2019')
    .replace(/&#8216;|&lsquo;/g, '\u2018')
    .replace(/&#8220;|&ldquo;/g, '\u201c')
    .replace(/&#8221;|&rdquo;/g, '\u201d')
    .replace(/&#8211;|&ndash;/g, '\u2013')
    .replace(/&#8212;|&mdash;/g, '\u2014')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * The path an article is served at.
 *
 * WordPress published these at the site root — `https://ozikoro.com/<slug>/` — and the plan
 * requires that existing URLs and their search value survive. So the new site serves the same
 * path rather than moving everything under `/articles/`, which would mean 1,051 redirects and the
 * loss of whatever the addresses have accumulated.
 */
function legacyPath(url: string, slug: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  } catch {
    return `/${slug}/`;
  }
}

/** Media kind from the MIME type, rather than trusting WordPress's own `media_type`. */
function mediaKind(mimeType: string): 'image' | 'audio' | 'video' | 'document' | 'other' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) return 'document';
  return 'other';
}

/**
 * Run a batched upsert.
 *
 * One statement per batch rather than one per row: 11,056 tags sent one at a time is 11,056 round
 * trips, which on PGlite is minutes and on a networked Postgres is worse. Rows are also
 * de-duplicated on the conflict target first, because Postgres refuses an ON CONFLICT statement
 * that would touch the same row twice — the first error a naive bulk import hits.
 */
async function upsertBatch(
  db: Db,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictColumn: string,
  updateColumns: string[],
  batchSize = 400
): Promise<number> {
  if (rows.length === 0) return 0;

  // De-duplicate on the conflict target, keeping the last occurrence.
  const keyIndex = columns.indexOf(conflictColumn);
  const deduped = new Map<unknown, unknown[]>();
  for (const row of rows) deduped.set(row[keyIndex], row);
  const unique = [...deduped.values()];

  const assignments = updateColumns.map((c) => `${c} = excluded.${c}`).join(', ');
  let written = 0;

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    await db.query(
      `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')}
       on conflict (${conflictColumn}) do update set ${assignments}`,
      params
    );
    written += batch.length;
  }

  return written;
}

/**
 * Bulk insert where the row may already exist and nothing needs updating.
 *
 * Join tables have composite primary keys, so `on conflict (one_column)` is not expressible —
 * the conflict target is the whole key or nothing. `on conflict do nothing` is the right
 * statement for a link, and it keeps the import idempotent without a second code path.
 */
async function insertIgnoreBatch(
  db: Db,
  table: string,
  columns: string[],
  rows: unknown[][],
  batchSize = 500
): Promise<number> {
  if (rows.length === 0) return 0;

  const seen = new Set<string>();
  const unique: unknown[][] = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  let written = 0;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await db.query(
      `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')} on conflict do nothing`,
      params
    );
    written += batch.length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

export interface ImportReport {
  contributors: number;
  topics: number;
  labels: number;
  media: number;
  articles: number;
  articleLabels: number;
  articleMedia: number;
  redirects: number;
  conflicts: { slug: string; reason: string }[];
  skipped: Record<string, number>;
}

export async function importArchive(db: Db, options: { apply?: boolean } = {}): Promise<ImportReport> {
  const apply = Boolean(options.apply);
  const [articles, media, users, categories, tags, pages] = await Promise.all([
    loadJson<ArticleRow[]>('articles.json'),
    loadJson<MediaRow[]>('media.json'),
    loadJson<UserRow[]>('users.json'),
    loadJson<TaxonomyRow[]>('categories.json'),
    loadJson<TaxonomyRow[]>('tags.json'),
    loadJson<ArticleRow[]>('pages.json'),
  ]);

  const report: ImportReport = {
    contributors: 0,
    topics: 0,
    labels: 0,
    media: 0,
    articles: 0,
    articleLabels: 0,
    articleMedia: 0,
    redirects: 0,
    conflicts: [],
    skipped: {},
  };

  if (!apply) {
    report.contributors = users.length;
    report.topics = categories.length;
    report.labels = tags.length;
    report.media = media.length;
    report.articles = articles.length;
    return report;
  }

  // -------------------------------------------------------------------------
  // Contributors
  // -------------------------------------------------------------------------
  report.contributors = await upsertBatch(
    db,
    'ozikoro_contributor',
    ['wp_user_id', 'slug', 'display_name', 'bio', 'website', 'avatar_url'],
    users.map((u) => [
      u.wpId,
      u.slug,
      u.name,
      u.description || null,
      u.url || null,
      u.avatarUrls?.['96'] ?? u.avatarUrls?.['48'] ?? null,
    ]),
    'wp_user_id',
    ['slug', 'display_name', 'bio', 'website', 'avatar_url']
  );

  const contributorIdByWp = new Map<number, number>();
  for (const row of await db.rows<{ id: string; wp_user_id: number }>(
    `select id, wp_user_id from ozikoro_contributor where wp_user_id is not null`
  )) {
    contributorIdByWp.set(Number(row.wp_user_id), Number(row.id));
  }

  // -------------------------------------------------------------------------
  // Topics and labels
  // -------------------------------------------------------------------------
  report.topics = await upsertBatch(
    db,
    'ozikoro_topic',
    ['wp_term_id', 'slug', 'name', 'description'],
    categories.map((c) => [c.wpId, c.slug, plainText(c.name), c.description || null]),
    'wp_term_id',
    ['slug', 'name', 'description']
  );

  // Parents second, so a child's parent already exists.
  const topicIdByWp = new Map<number, number>();
  for (const row of await db.rows<{ id: string; wp_term_id: number }>(
    `select id, wp_term_id from ozikoro_topic where wp_term_id is not null`
  )) {
    topicIdByWp.set(Number(row.wp_term_id), Number(row.id));
  }
  for (const category of categories) {
    if (!category.parent) continue;
    const childId = topicIdByWp.get(category.wpId);
    const parentId = topicIdByWp.get(category.parent);
    if (childId && parentId) {
      await db.query(`update ozikoro_topic set parent_id = $1 where id = $2`, [parentId, childId]);
    }
  }

  report.labels = await upsertBatch(
    db,
    'ozikoro_label',
    ['wp_term_id', 'slug', 'name', 'usage_count'],
    tags.map((t) => [t.wpId, t.slug, plainText(t.name), t.count]),
    'wp_term_id',
    ['slug', 'name', 'usage_count']
  );

  const labelIdByWp = new Map<number, number>();
  for (const row of await db.rows<{ id: string; wp_term_id: number }>(
    `select id, wp_term_id from ozikoro_label where wp_term_id is not null`
  )) {
    labelIdByWp.set(Number(row.wp_term_id), Number(row.id));
  }

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------
  report.media = await upsertBatch(
    db,
    'ozikoro_media',
    ['wp_media_id', 'slug', 'kind', 'title', 'alt_text', 'caption', 'description', 'source_url',
     'mime_type', 'width', 'height', 'filesize_bytes', 'uploaded_at', 'contributor_id'],
    media.map((m) => [
      m.wpId,
      m.slug || `media-${m.wpId}`,
      mediaKind(m.mimeType),
      m.title ? plainText(m.title) : null,
      m.altText || null,
      m.captionHtml ? plainText(m.captionHtml) : null,
      m.descriptionHtml ? plainText(m.descriptionHtml) : null,
      m.sourceUrl || null,
      m.mimeType || null,
      m.width,
      m.height,
      m.filesizeBytes,
      m.uploadedAt ? new Date(`${m.uploadedAt}Z`).toISOString() : null,
      contributorIdByWp.get(m.authorId) ?? null,
    ]),
    'wp_media_id',
    ['slug', 'kind', 'title', 'alt_text', 'caption', 'description', 'source_url', 'mime_type',
     'width', 'height', 'filesize_bytes', 'uploaded_at', 'contributor_id']
  );

  const mediaIdByWp = new Map<number, number>();
  for (const row of await db.rows<{ id: string; wp_media_id: number }>(
    `select id, wp_media_id from ozikoro_media where wp_media_id is not null`
  )) {
    mediaIdByWp.set(Number(row.wp_media_id), Number(row.id));
  }

  // -------------------------------------------------------------------------
  // Articles
  // -------------------------------------------------------------------------
  /*
   * Slugs must be unique across articles and pages together, because both are served at the
   * site root. A collision is resolved by suffixing the later one and recording it in the report
   * rather than silently dropping an article.
   */
  const takenSlugs = new Set<string>();
  const preparedArticles: { row: unknown[]; labelIds: number[]; featuredWp: number }[] = [];

  /*
   * Pages are carried too, because their content is the owner's own words (About US, Authors,
   * Privacy Policy), but they are flagged and every archive query filters them out. Conflating
   * the two put "Privacy Policy" in the archive index and let the page slugged `about` take the
   * root address the institution page needs. See migration 0036.
   */
  const isPageByWp = new Set(pages.map((p) => p.wpId));
  const isPage = (wpId: number) => isPageByWp.has(wpId);

  for (const article of [...articles, ...pages]) {
    let slug = article.slug || `article-${article.wpId}`;
    if (takenSlugs.has(slug)) {
      const resolved = `${slug}-${article.wpId}`;
      report.conflicts.push({ slug, reason: `slug already used; stored as ${resolved}` });
      slug = resolved;
    }
    takenSlugs.add(slug);

    preparedArticles.push({
      row: [
        article.wpId,
        slug,
        legacyPath(article.url, slug),
        plainText(article.title),
        article.excerptHtml ? plainText(article.excerptHtml) : null,
        article.contentHtml ?? '',
        contributorIdByWp.get(article.authorId) ?? null,
        article.featuredMediaId ? (mediaIdByWp.get(article.featuredMediaId) ?? null) : null,
        article.categoryIds.length > 0 ? (topicIdByWp.get(article.categoryIds[0]!) ?? null) : null,
        // Structured facets are left null on purpose: a human assigns them. See the file header.
        null,
        null,
        null,
        null,
        // Imported content is published, because it already was. It is not "draft": setting that
        // would take 1,051 live pages off the internet on the day of the migration.
        'published',
        article.publishedAt ? new Date(`${article.publishedAt}Z`).toISOString() : null,
        article.modifiedAt ? new Date(`${article.modifiedAt}Z`).toISOString() : null,
        article.seo?.title ?? null,
        article.seo?.description ?? null,
        article.seo?.canonical ?? null,
        article.wordCount,
        isPage(article.wpId),
      ],
      labelIds: article.tagIds.map((id) => labelIdByWp.get(id)).filter((v): v is number => typeof v === 'number'),
      featuredWp: article.featuredMediaId,
    });
  }

  report.articles = await upsertBatch(
    db,
    'ozikoro_article',
    ['wp_post_id', 'slug', 'legacy_url', 'title', 'standfirst', 'body_html', 'author_id',
     'featured_media_id', 'topic_id', 'source_type', 'period_label', 'period_start', 'period_end',
     'status', 'published_at', 'modified_at', 'seo_title', 'seo_description', 'canonical_url',
     'word_count', 'is_page'],
    preparedArticles.map((p) => p.row),
    'wp_post_id',
    ['slug', 'legacy_url', 'title', 'standfirst', 'body_html', 'author_id', 'featured_media_id',
     'topic_id', 'status', 'published_at', 'modified_at', 'seo_title', 'seo_description',
     'canonical_url', 'word_count', 'is_page'],
    200
  );

  const articleIdByWp = new Map<number, number>();
  for (const row of await db.rows<{ id: string; wp_post_id: number }>(
    `select id, wp_post_id from ozikoro_article where wp_post_id is not null`
  )) {
    articleIdByWp.set(Number(row.wp_post_id), Number(row.id));
  }

  // -------------------------------------------------------------------------
  // Article to label, and article to media
  // -------------------------------------------------------------------------
  const labelLinks: unknown[][] = [];
  const mediaLinks: unknown[][] = [];
  for (const prepared of preparedArticles) {
    const wpId = Number(prepared.row[0]);
    const articleId = articleIdByWp.get(wpId);
    if (!articleId) continue;
    for (const labelId of prepared.labelIds) labelLinks.push([articleId, labelId]);
    if (prepared.featuredWp) {
      const mediaId = mediaIdByWp.get(prepared.featuredWp);
      if (mediaId) mediaLinks.push([articleId, mediaId, 'featured', 0]);
    }
  }

  report.articleLabels = await insertIgnoreBatch(
    db, 'ozikoro_article_label', ['article_id', 'label_id'], labelLinks
  );

  report.articleMedia = await insertIgnoreBatch(
    db, 'ozikoro_article_media', ['article_id', 'media_id', 'role', 'position'], mediaLinks
  );

  // -------------------------------------------------------------------------
  // Redirects
  // -------------------------------------------------------------------------
  /*
   * Only where the address actually changed. The articles keep their root-level slugs, so this
   * is normally empty — which is the point, and the count in the report proves it rather than
   * leaving it to be assumed.
   */
  const staleCanonicals = await db.rows<{ id: string; legacy_url: string | null; slug: string }>(
    `select id, legacy_url, slug from ozikoro_article where legacy_url is not null and legacy_url <> '/' || slug || '/'`
  );
  for (const row of staleCanonicals) {
    await db.query(
      `insert into ozikoro_redirect (from_path, to_path, status, reason) values ($1, $2, 301, $3)
       on conflict (from_path) do update set to_path = excluded.to_path`,
      [row.legacy_url, `/${row.slug}/`, 'Migrated from WordPress: the slug changed']
    );
    report.redirects += 1;
  }

  return report;
}

// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('archive.ts')) {
  const apply = process.argv.includes('--apply');
  const db = await getDb();
  console.log(`\n  Ozikoro archive import${apply ? '' : ' (check only, nothing is written)'}`);
  console.log(`  Source: ${OUT_DIR}`);
  console.log(`  Site:   ${WP_ORIGIN}\n`);

  const started = Date.now();
  const report = await importArchive(db, { apply });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  for (const [key, value] of Object.entries(report)) {
    if (key === 'conflicts' || key === 'skipped') continue;
    console.log(`    ${key.padEnd(16)} ${value}`);
  }
  if (report.conflicts.length > 0) {
    console.log(`\n    slug conflicts (${report.conflicts.length}):`);
    for (const c of report.conflicts.slice(0, 10)) console.log(`      ${c.slug}: ${c.reason}`);
    if (report.conflicts.length > 10) console.log(`      … and ${report.conflicts.length - 10} more`);
  }
  console.log(`\n  ${elapsed}s`);

  if (apply) {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      join(OUT_DIR, 'import-report.json'),
      JSON.stringify({ importedAt: new Date().toISOString(), report }, null, 2)
    );
  } else {
    console.log('\n  Re-run with --apply to write these rows.\n');
  }
  await closeDb();
}
