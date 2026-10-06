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

/**
 * An unpublished post, recovered through an authenticated session.
 *
 * Same shape as `ArticleRow` for the fields the two share, plus the WordPress status the record
 * actually carried. See `recovered.ts` for why these are in a separate file: `articles.json` came
 * from the public route, which is unchanged, and these are the records that route could not reach.
 */
interface DraftRow extends ArticleRow {
  date: string;
  modifiedGmt: string;
  wpStatus: 'draft' | 'pending' | 'private' | 'future';
  commentStatus: string;
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
  /** The WordPress role(s), when the extraction kept them. Absent on an export made before that was fixed. */
  roles?: string[];
}

/**
 * The single WordPress role to record for a byline, from the array the endpoint returns, or null.
 *
 * WordPress allows several roles and precedence is by capability level, so the most senior one present is
 * the answer — which is WordPress's own ranking, written out rather than inferred. **`subscriber` is in the
 * list because WordPress has it, not because any of the fifteen holds it**; none does. A user whose array
 * names no built-in role yields null, and null means "not recorded" rather than "no role".
 */
const WP_ROLE_PRECEDENCE = ['administrator', 'editor', 'author', 'contributor', 'subscriber'] as const;

function wpRoleOf(roles: string[] | undefined): string | null {
  if (!Array.isArray(roles)) return null;
  for (const role of WP_ROLE_PRECEDENCE) {
    if (roles.includes(role)) return role;
  }
  return null;
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

/**
 * The recovered drafts, when the authenticated extraction has been run.
 *
 * Optional on purpose: a checkout that has only ever run the public extraction has no `drafts.json`,
 * and the import must still work there rather than failing on a missing file.
 */
async function loadDrafts(): Promise<DraftRow[]> {
  try {
    return await loadJson<DraftRow[]>('drafts.json');
  } catch {
    return [];
  }
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
    /*
     * An unpublished post has no address yet: WordPress reports its `link` as `/?p=10779`, which is
     * a query string rather than a path. Storing that as the legacy URL would create a redirect from
     * a meaningless address, so a post with no real path falls back to its slug. Nothing is
     * redirected on the strength of it — the redirect pass only fires where an address genuinely
     * changed, and these were never live.
     */
    if (parsed.pathname === '/' || parsed.pathname === '') return `/${slug}/`;
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
  /** Records imported from `drafts.json`, all as `draft`. Zero when that file is absent. */
  drafts: number;
  /** The recovered drafts by their real WordPress status, so the split is visible not assumed. */
  draftsByStatus: Record<string, number>;
  articleLabels: number;
  articleMedia: number;
  redirects: number;
  conflicts: { slug: string; reason: string }[];
  skipped: Record<string, number>;
}

/**
 * A category slug that is safe to put in a URL.
 *
 * Strips invisible formatting characters (word joiner, zero-width space, BOM and friends), decodes any
 * percent-encoding WordPress left in the slug, and falls back to a derived form if nothing is left.
 */
export function normaliseTopicSlug(raw: string): string {
  let slug = String(raw ?? '');
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // A malformed escape sequence is not worth failing the whole import over.
  }
  return slug
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function importArchive(db: Db, options: { apply?: boolean } = {}): Promise<ImportReport> {
  const apply = Boolean(options.apply);
  const [articles, media, users, categories, tags, pages, drafts] = await Promise.all([
    loadJson<ArticleRow[]>('articles.json'),
    loadJson<MediaRow[]>('media.json'),
    loadJson<UserRow[]>('users.json'),
    loadJson<TaxonomyRow[]>('categories.json'),
    loadJson<TaxonomyRow[]>('tags.json'),
    loadJson<ArticleRow[]>('pages.json'),
    loadDrafts(),
  ]);

  const report: ImportReport = {
    contributors: 0,
    topics: 0,
    labels: 0,
    media: 0,
    articles: 0,
    drafts: 0,
    draftsByStatus: {},
    articleLabels: 0,
    articleMedia: 0,
    redirects: 0,
    conflicts: [],
    skipped: {},
  };

  for (const d of drafts) {
    report.draftsByStatus[d.wpStatus] = (report.draftsByStatus[d.wpStatus] ?? 0) + 1;
  }

  if (!apply) {
    report.contributors = users.length;
    report.topics = categories.length;
    report.labels = tags.length;
    report.media = media.length;
    report.articles = articles.length;
    report.drafts = drafts.length;
    return report;
  }

  // -------------------------------------------------------------------------
  // Contributors
  // -------------------------------------------------------------------------
  /*
   * ⚠️ `wp_role` IS INSERTED AND DELIBERATELY NOT UPDATED, AND THE OMISSION IS THE POINT.
   *
   * The extraction that produced `data/ozikoro-wp/users.json` on disk predates the fix to `normaliseUser`,
   * so that file carries no `roles` and this import would write NULL for every byline. An update list that
   * included `wp_role` would therefore **wipe the roles the dump backfill had already recorded**, every
   * time the import was re-run. Insert-and-never-clobber means a fresh database gets whatever the export
   * knows, and a database that has been backfilled from the dump keeps it.
   *
   * The roles for the fifteen WordPress users come from the dump, not from this file:
   * `packages/ozikoro/src/ops/backfill-contributor-roles.ts`.
   */
  report.contributors = await upsertBatch(
    db,
    'ozikoro_contributor',
    ['wp_user_id', 'slug', 'display_name', 'bio', 'website', 'avatar_url', 'wp_role'],
    users.map((u) => [
      u.wpId,
      u.slug,
      u.name,
      u.description || null,
      u.url || null,
      u.avatarUrls?.['96'] ?? u.avatarUrls?.['48'] ?? null,
      wpRoleOf(u.roles),
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
    /*
     * The slug is normalised, not taken verbatim.
     *
     * MEASURED: WordPress category 14 arrived with a slug of `%e2%81%a0religion-and-spirituality` — the
     * PERCENT-ENCODED form of a leading U+2060 WORD JOINER — while its name carried the raw character.
     * The topic page therefore 404'd: the router decoded the URL segment back to the real character and
     * looked up that, which matched nothing, because the database held the encoded text.
     *
     * Worse, the sitemap published the broken address, which is an instruction to a search engine to
     * index a 404.
     *
     * A slug is a URL component, so it must not contain either invisible formatting characters or
     * percent-encoding of its own. Both are removed here rather than left for the router to fail on.
     */
    categories.map((c) => [c.wpId, normaliseTopicSlug(c.slug), plainText(c.name), c.description || null]),
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
   * The drafts' final addresses, kept so they can be checked against the DATABASE before a write.
   * `takenSlugs` only knows about the rows in the files this run loaded, which is not the same set as
   * the rows in the table — see the guard below.
   */
  const preparedDrafts: { wpId: number; slug: string }[] = [];

  /*
   * Pages are carried too, because their content is the owner's own words (About US, Authors,
   * Privacy Policy), but they are flagged and every archive query filters them out. Conflating
   * the two put "Privacy Policy" in the archive index and let the page slugged `about` take the
   * root address the institution page needs. See migration 0036.
   */
  const isPageByWp = new Set(pages.map((p) => p.wpId));
  const isPage = (wpId: number) => isPageByWp.has(wpId);

  for (const article of [...articles, ...pages, ...drafts]) {
    /*
     * A recovered draft is the same record shape as a published article, so the only thing that
     * separates them here is the status the record carried. `publishedAt` only exists on the
     * published shape; a draft carries `date` instead, and it is deliberately not mapped to the
     * publication date, because the piece never went live.
     */
    const draft = article as Partial<DraftRow>;
    const isDraft = typeof draft.wpStatus === 'string';
    /*
     * A PUBLISHED RECORD KEEPS ITS WORDPRESS SLUG BYTE FOR BYTE; A DRAFT'S WAS MINTED BY THE WRITE
     * PATH'S OWN RULE IN `recovered.ts` AND IS TAKEN AS GIVEN HERE.
     *
     * The published branch is deliberately NOT passed through `slugForTitle`: 1,051 records are live at
     * these addresses and re-slugging one would move a URL that search engines and readers already
     * hold. Their slugs came from WordPress and that is the authority for them.
     *
     * A draft arrives already slugged — `recovered.ts` keeps a real WordPress slug verbatim and derives
     * one with `authoring.ts`'s `slugForTitle` only where WordPress gave none. The fallback below is the
     * archive's own placeholder for a piece with neither (`draft-<id>`, exactly what `createPiece`
     * writes), not a third slug rule.
     */
    let slug = article.slug || (isDraft ? `draft-${article.wpId}` : `article-${article.wpId}`);
    if (takenSlugs.has(slug)) {
      const resolved = `${slug}-${article.wpId}`;
      report.conflicts.push({ slug, reason: `slug already used; stored as ${resolved}` });
      slug = resolved;
    }
    takenSlugs.add(slug);
    if (isDraft) preparedDrafts.push({ wpId: article.wpId, slug });

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
        /*
         * Published content stays published, because it already was — setting anything else would
         * take 1,051 live pages off the internet on the day of the migration.
         *
         * A RECOVERED DRAFT LANDS AS `draft`, WHICH IS THE STATUS IT ACTUALLY CARRIED.
         *
         * It is not `published` (it was never public) and it is not `review` either, which is where it
         * used to land. `review` is this archive's OWN editorial queue — the status the Blogger ingest
         * puts unvetted outside material in, so an editor knows it has not been looked at. A WordPress
         * draft is a different thing: it is the author's own unfinished work, and the owner asked for
         * the drafts to be drafts. One word here, and it is the whole of the difference.
         *
         * WordPress's other unpublished statuses (`pending`, `private`, `future`) mean the same thing to
         * this schema — not on the public site — and there are none in the file; `draftsByStatus` in the
         * report proves that rather than leaving it asserted. Mapping all of them to `draft` is why the
         * value is a constant and not `draft.wpStatus`: the archive's CHECK constraint has no
         * `pending`/`private`/`future`, and inventing one would be a schema change, not an import.
         */
        isDraft ? 'draft' : 'published',
        isDraft ? null : article.publishedAt ? new Date(`${article.publishedAt}Z`).toISOString() : null,
        /*
         * THE DATE IS WORDPRESS'S, IN GMT, AND NOT THE DAY OF THE IMPORT.
         *
         * A draft has no publication date, so the date the back office shows for it is this one —
         * `list-table.tsx` renders "Last saved <modified_at>" — and taking `raw.modified` (the site's
         * local clock) instead of `modified_gmt` would print a time that is off by the site's offset.
         * `DraftRow` therefore carries `modifiedGmt` and it is used when present.
         */
        isDraft
          ? draft.modifiedGmt ? new Date(`${draft.modifiedGmt}Z`).toISOString() : null
          : article.modifiedAt ? new Date(`${article.modifiedAt}Z`).toISOString() : null,
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

  /*
   * ── THE PRE-FLIGHT CHECK AGAINST THE DATABASE, WHICH THE IN-MEMORY SET CANNOT MAKE ────────────────
   *
   * `takenSlugs` knows only the rows in the files THIS run loaded. A draft's `wp_post_id` and its
   * address are facts about the TABLE, and the two ways that goes wrong are both incidents rather than
   * bugs:
   *
   *   1. **THE ID ALREADY EXISTS UNDER ANOTHER STATUS.** The upsert keys on `wp_post_id`, so importing
   *      draft 1234 over a row that is `published` SETS THAT ROW TO `draft` — a live article disappears
   *      from the site, from the sitemap and from every listing, silently, with the import reporting
   *      success. `review` is allowed (that is where these 39 were first landed and the correction is
   *      the point of this run); `draft` is allowed (a re-run). Anything else — `published`, `archived`,
   *      `trashed` — is a human's decision about that record and this import must not overrule it, so it
   *      REFUSES and names the rows.
   *   2. **THE ADDRESS IS ALREADY HELD BY A DIFFERENT RECORD.** `slug` is `not null unique` across posts
   *      and pages, so the write would abort mid-batch on a raw constraint error. Checked here so the
   *      failure names the two records instead.
   *
   * It runs BEFORE the first write and throws rather than reporting, because a partial import that has
   * already unpublished an article is not a state worth reaching a report from.
   */
  if (preparedDrafts.length > 0) {
    const idPlaceholders = preparedDrafts.map((_, i) => `$${i + 1}`).join(', ');
    const idParams = preparedDrafts.map((d) => d.wpId);
    const existing = await db.rows<{ wp_post_id: number; status: string; is_page: boolean; slug: string }>(
      `select wp_post_id, status, is_page, slug from ozikoro_article where wp_post_id in (${idPlaceholders})`,
      idParams
    );
    const wrongStatus = existing.filter((r) => r.status !== 'draft' && r.status !== 'review');
    const wasPage = existing.filter((r) => r.is_page);
    if (wrongStatus.length > 0 || wasPage.length > 0) {
      const detail = [...wrongStatus, ...wasPage]
        .map((r) => `wp_post_id ${r.wp_post_id} is "${r.status}"${r.is_page ? ' and is a page' : ''} (/${r.slug}/)`)
        .join('; ');
      throw new Error(
        `Refusing to import a WordPress draft over a record under another status: ${detail}. ` +
        `An unpublished WordPress draft may only land on a row that is absent, draft, or review.`
      );
    }

    const slugPlaceholders = preparedDrafts.map((_, i) => `$${i + 1}`).join(', ');
    const taken = await db.rows<{ slug: string; wp_post_id: number }>(
      `select slug, wp_post_id from ozikoro_article where slug in (${slugPlaceholders})`,
      preparedDrafts.map((d) => d.slug)
    );
    const mine = new Map(preparedDrafts.map((d) => [d.slug, d.wpId]));
    const stolen = taken.filter((r) => mine.get(String(r.slug)) !== Number(r.wp_post_id));
    if (stolen.length > 0) {
      throw new Error(
        `Refusing to import: a draft's address is already held by another record — ` +
        stolen.map((r) => `/${r.slug}/ is wp_post_id ${r.wp_post_id}`).join('; ')
      );
    }
  }

  const written = await upsertBatch(
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
  // One statement covers both files, so the total is split here rather than claimed as one figure.
  report.drafts = drafts.length;
  report.articles = written - drafts.length;

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
    // An object value gets stringified rather than printed as `[object Object]`.
    console.log(`    ${key.padEnd(16)} ${typeof value === 'object' ? JSON.stringify(value) : value}`);
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
