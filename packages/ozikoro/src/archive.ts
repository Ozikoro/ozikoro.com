/**
 * Reading the Ozikoro archive.
 *
 * Every query the public site needs lives here rather than in page components, for the reason
 * the repository's architecture doc gives for the dictionary: business logic in the package, so
 * it can be tested without a running server and so a second caller — the API, a sitemap, an
 * export — cannot drift from what the page shows.
 *
 * The article body is NOT sanitised here. It is stored verbatim, as the record of what was
 * published, and made safe at the point of rendering by `prepareArchiveHtml`. Sanitising on the
 * way in would destroy the evidence and mean the stored copy could never be re-rendered with a
 * fixed sanitiser.
 */
import type { Db } from '@ozituma/db/client';
import { prepareArchiveHtml, summarise, readingMinutes, citationFor } from './content.ts';

/**
 * Top-level paths the site itself owns.
 *
 * Next.js resolves a static segment before a dynamic one, so `app/archive/` always wins over
 * `app/[slug]/`. An archive record whose slug is one of these would be published and then never
 * reachable, which is the quietest possible way to lose a record. The importer reports such a
 * clash and `test-archive.ts` fails on one; the list lives here so both read the same source.
 */
export const RESERVED_ARCHIVE_SLUGS = [
  'about', 'archive', 'documents', 'folklore', 'labels', 'researchers', 'search', 'topics',
  'watch', 'admin', 'signin', 'design', 'sitemap.xml', 'robots.txt', 'api',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArticleAuthor {
  id: number;
  slug: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
}

export interface ArticleMedia {
  id: number;
  kind: string;
  title: string | null;
  altText: string | null;
  caption: string | null;
  sourceUrl: string | null;
  creator: string | null;
  credit: string | null;
  licence: string | null;
  rightsNote: string | null;
  width: number | null;
  height: number | null;
}

export interface ArticleSource {
  id: number;
  slug: string;
  kind: string;
  title: string;
  authors: string[];
  year: number | null;
  yearNote: string | null;
  publisher: string | null;
  journal: string | null;
  url: string | null;
  licence: string | null;
  evidenceType: string | null;
  stance: string;
}

export interface ArticleLabel {
  slug: string;
  name: string;
}

export interface ArticleEntity {
  id: number;
  kind: string;
  slug: string;
  name: string;
  role: string;
}

export interface ArticleSummary {
  id: number;
  slug: string;
  url: string;
  title: string;
  standfirst: string | null;
  publishedAt: string | null;
  authorName: string | null;
  authorSlug: string | null;
  topicName: string | null;
  topicSlug: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageCredit: string | null;
  readingMinutes: number;
  sourceType: string | null;
  periodLabel: string | null;
}

export interface ArticleDetail extends ArticleSummary {
  /** Sanitised and design-ready, not the stored copy. */
  bodyHtml: string;
  citation: string;
  ownerUrl: string;
  wordCount: number;
  modifiedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Null when the archive has no source attached — the design's deliberate `.unsourced` state. */
  sources: ArticleSource[];
  labels: ArticleLabel[];
  entities: ArticleEntity[];
}

// ---------------------------------------------------------------------------
// Shared SQL
// ---------------------------------------------------------------------------

/**
 * The columns every article listing needs, joined once.
 *
 * The image is taken from the featured-media relation, and its rights fields come with it: the
 * plan requires rights and attribution on every media record the site shows, so a query that
 * returned a URL without them would make the correct rendering impossible.
 */
const ARTICLE_SELECT = `
  select a.id, a.slug, a.title, a.standfirst, a.body_html, a.word_count,
         a.published_at, a.modified_at, a.source_type, a.period_label,
         a.seo_title, a.seo_description,
         c.display_name as author_name, c.slug as author_slug,
         t.name as topic_name, t.slug as topic_slug,
         coalesce('/media/' || m.storage_key, m.source_url) as image_url,
         m.alt_text as image_alt, m.credit as image_credit
    from ozikoro_article a
    left join ozikoro_contributor c on c.id = a.author_id
    left join ozikoro_topic       t on t.id = a.topic_id
    left join ozikoro_media       m on m.id = a.featured_media_id
`;

function rowToSummary(row: Record<string, unknown>, origin = 'https://ozikoro.com'): ArticleSummary {
  const slug = String(row.slug);
  const body = String(row.body_html ?? '');
  return {
    id: Number(row.id),
    slug,
    url: `/${slug}/`,
    /*
     * One migrated record genuinely has no title: WordPress post 3774, an image with no text,
     * published in January 2025 under the auto-generated slug `3774-2`. The migration preserved
     * that faithfully and invented nothing — but an empty `<h1>` is not a record, so the display
     * falls back to a label that says what it is. The stored title is left as the empty string it
     * was, so the editorial queue can still see that this record needs a human.
     */
    title: String(row.title ?? '').trim() || 'Untitled record',
    standfirst: row.standfirst ? String(row.standfirst) : null,
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
    authorName: row.author_name ? String(row.author_name) : null,
    authorSlug: row.author_slug ? String(row.author_slug) : null,
    topicName: row.topic_name ? String(row.topic_name) : null,
    topicSlug: row.topic_slug ? String(row.topic_slug) : null,
    imageUrl: row.image_url ? String(row.image_url) : null,
    imageAlt: row.image_alt ? String(row.image_alt) : null,
    imageCredit: row.image_credit ? String(row.image_credit) : null,
    readingMinutes: readingMinutes(body),
    sourceType: row.source_type ? String(row.source_type) : null,
    periodLabel: row.period_label ? String(row.period_label) : null,
    ...(origin ? {} : {}),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One article, with everything the article screen renders. */
/**
 * Every spelling of a slug that the same address can arrive as.
 *
 * THE PROBLEM THIS SOLVES, AND THE ONE IT DOES NOT
 *
 * WordPress stored one article's slug in PERCENT-ENCODED form — `…compound-%c7%b9gwulu…` — while a
 * browser requesting that address sends the encoding and the router hands the handler the **decoded**
 * character. The lookup compared the decoded text against the encoded column and found nothing, so a
 * published article 404'd and the sitemap published the broken address.
 *
 * The obvious fix was to rewrite the slug — and it was WRONG. Round 58 tried it: normalising stripped
 * every non-alphanumeric character **including the `ǹ`**, destroying an Igbo character in a published
 * address, breaking the guarantee that archived paths survive the move, and weakening the diacritic
 * search. The archive suite caught it.
 *
 * So the slug is left exactly as WordPress published it, and the LOOKUP becomes tolerant instead. The
 * database keeps the original; the route finds it however the address was written.
 *
 * Casing is included because `encodeURIComponent` emits uppercase hex and the import stored lowercase,
 * which is a difference no reader would ever see and no comparison would forgive.
 */
function slugVariants(slug: string): string[] {
  const variants = new Set<string>([slug]);
  /*
   * The raw slug LOWERCASED, and this is the line that mattered.
   *
   * Measured by logging what the route actually receives: Next hands over the segment still
   * percent-encoded, with **uppercase** hex —
   *
   *     "entrance-…-compound-%C7%B9gwulu-…"      codepoints … 25 43 37 25 42 39 …
   *
   * — while the import stored the same thing in **lowercase**, `%c7%b9`. Neither the slug as given,
   * nor its encodeURIComponent form (which escapes the literal `%` to `%25`), nor the decoded form
   * matched. The lookup returned NULL and the page 404'd, for a difference of letter case inside a
   * percent-escape that no reader could ever see.
   *
   * Every earlier theory — routing, the middleware, non-ASCII dispatch, the encoding itself — was
   * eliminated by experiment before this one line was found. It is `toLowerCase()` on the slug rather
   * than on a re-encoded copy, and that distinction is the whole bug.
   */
  variants.add(slug.toLowerCase());
  try {
    const encoded = encodeURIComponent(slug);
    variants.add(encoded);
    variants.add(encoded.toLowerCase());
  } catch {
    // A lone surrogate cannot be encoded; the raw form is still tried.
  }
  try {
    variants.add(decodeURIComponent(slug));
  } catch {
    // A malformed escape sequence is not a reason to fail the lookup.
  }
  return [...variants];
}

export async function getArticleBySlug(db: Db, slug: string): Promise<ArticleDetail | null> {
  const row = await db.one<Record<string, unknown>>(
    `${ARTICLE_SELECT} where a.slug = any($1::text[]) limit 1`,
    [slugVariants(slug)]
  );
  if (!row) return null;

  const id = Number(row.id);
  const [sources, labels, entities] = await Promise.all([
    db.rows<Record<string, unknown>>(
      `select s.id, s.slug, s.kind, s.title, s.authors, s.year, s.year_note, s.publisher, s.journal,
              s.url, s.licence, s.evidence_type, l.stance as stance
         from ozikoro_article_source l
         join ozikoro_source s on s.id = l.source_id
        where l.article_id = $1
        order by l.position, s.year nulls last, s.title`,
      [id]
    ),
    db.rows<Record<string, unknown>>(
      `select l.slug, l.name from ozikoro_article_label a join ozikoro_label l on l.id = a.label_id
        where a.article_id = $1 order by l.usage_count desc, l.name limit 60`,
      [id]
    ),
    db.rows<Record<string, unknown>>(
      `select e.id, e.kind, e.slug, e.name, ae.role
         from ozikoro_article_entity ae join ozikoro_entity e on e.id = ae.entity_id
        where ae.article_id = $1 order by ae.role, e.name`,
      [id]
    ),
  ]);

  const summary = rowToSummary(row);

  return {
    ...summary,
    /*
     * The stored HTML is passed through the sanitiser and the WordPress rewriting here, at the
     * boundary where it becomes something a browser will render.
     */
    bodyHtml: prepareArchiveHtml(String(row.body_html ?? '')),
    citation: citationFor({
      authorName: summary.authorName,
      title: summary.title,
      publishedAt: summary.publishedAt,
      url: `https://ozikoro.com${summary.url}`,
    }),
    ownerUrl: `https://ozikoro.com${summary.url}`,
    wordCount: Number(row.word_count ?? 0),
    modifiedAt: row.modified_at ? new Date(String(row.modified_at)).toISOString() : null,
    seoTitle: row.seo_title ? String(row.seo_title) : null,
    seoDescription: row.seo_description ? String(row.seo_description) : null,
    sources: sources.map((s) => ({
      id: Number(s.id),
      slug: String(s.slug),
      kind: String(s.kind),
      title: String(s.title),
      authors: Array.isArray(s.authors) ? s.authors.map(String) : [],
      year: s.year === null || s.year === undefined ? null : Number(s.year),
      yearNote: s.year_note ? String(s.year_note) : null,
      publisher: s.publisher ? String(s.publisher) : null,
      journal: s.journal ? String(s.journal) : null,
      url: s.url ? String(s.url) : null,
      licence: s.licence ? String(s.licence) : null,
      evidenceType: s.evidence_type ? String(s.evidence_type) : null,
      stance: String(s.stance ?? 'supports'),
    })),
    labels: labels.map((l) => ({ slug: String(l.slug), name: String(l.name) })),
    entities: entities.map((e) => ({
      id: Number(e.id),
      kind: String(e.kind),
      slug: String(e.slug),
      name: String(e.name),
      role: String(e.role),
    })),
  };
}

export interface ListOptions {
  topicSlug?: string | null;
  labelSlug?: string | null;
  entityId?: number | null;
  limit?: number;
  offset?: number;
  /** Newest first by default; alphabetical is used by the A–Z index. */
  order?: 'recent' | 'title';
}

function listWhere(options: ListOptions): { clause: string; params: unknown[] } {
  // Pages are site content, not records. Every archive query excludes them (migration 0036).
  const conditions: string[] = [`a.status = 'published'`, `a.is_page = false`];
  const params: unknown[] = [];

  if (options.topicSlug) {
    params.push(options.topicSlug);
    conditions.push(`t.slug = $${params.length}`);
  }
  if (options.labelSlug) {
    params.push(options.labelSlug);
    conditions.push(`exists (select 1 from ozikoro_article_label al join ozikoro_label ll on ll.id = al.label_id
                                 where al.article_id = a.id and ll.slug = $${params.length})`);
  }
  if (options.entityId) {
    params.push(options.entityId);
    conditions.push(`exists (select 1 from ozikoro_article_entity ae where ae.article_id = a.id and ae.entity_id = $${params.length})`);
  }

  return { clause: `where ${conditions.join(' and ')}`, params };
}

export async function listArticles(db: Db, options: ListOptions = {}): Promise<ArticleSummary[]> {
  const { clause, params } = listWhere(options);
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const order = options.order === 'title' ? 'a.title asc' : 'a.published_at desc nulls last, a.id desc';

  const rows = await db.rows<Record<string, unknown>>(
    `${ARTICLE_SELECT} ${clause} order by ${order} limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return rows.map((row) => rowToSummary(row));
}

export async function countArticles(db: Db, options: ListOptions = {}): Promise<number> {
  const { clause, params } = listWhere(options);
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_article a
       left join ozikoro_topic t on t.id = a.topic_id ${clause}`,
    params
  );
  return Number(row?.n ?? 0);
}

/**
 * Full-text search.
 *
 * `websearch_to_tsquery` rather than `plainto_tsquery` because it understands quoted phrases and
 * `-exclusion`, which is what a reader typing into a search box expects. Title matches are ranked
 * above body matches by the weights baked into the generated `search_vector`.
 *
 * A label match is OR-ed in as well: the archive's 11,056 tags are how the existing site is found,
 * and a search for a town that is a tag but not a word in any body should still find the articles
 * tagged with it.
 */
export async function searchArticles(
  db: Db,
  query: string,
  options: { limit?: number; offset?: number } = {}
): Promise<ArticleSummary[]> {
  const text = query.trim();
  if (text.length === 0) return [];

  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const rows = await db.rows<Record<string, unknown>>(
    `${ARTICLE_SELECT}
      where a.status = 'published' and a.is_page = false
        and (
          a.search_vector @@ websearch_to_tsquery('english', $1)
          or exists (
            select 1 from ozikoro_article_label al
              join ozikoro_label l on l.id = al.label_id
             where al.article_id = a.id
               and (l.name ilike '%' || $1 || '%' or l.slug ilike '%' || $1 || '%')
          )
          or a.title ilike '%' || $1 || '%'
        )
      order by
        ts_rank(a.search_vector, websearch_to_tsquery('english', $1)) desc,
        a.published_at desc nulls last
      limit $2 offset $3`,
    [text, limit, offset]
  );
  return rows.map((row) => rowToSummary(row));
}

export interface TopicSummary {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  articleCount: number;
}

export async function listTopics(db: Db): Promise<TopicSummary[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select t.id, t.slug, t.name, t.description,
            (select count(*)::int from ozikoro_article a where a.topic_id = t.id and a.status = 'published' and a.is_page = false) as article_count
       from ozikoro_topic t
      order by t.position, t.name`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    slug: String(r.slug),
    name: String(r.name),
    description: r.description ? String(r.description) : null,
    articleCount: Number(r.article_count ?? 0),
  }));
}

export async function getTopicBySlug(db: Db, slug: string): Promise<TopicSummary | null> {
  const topics = await listTopics(db);
  return topics.find((t) => t.slug === slug) ?? null;
}

/**
 * The labels actually used, most-used first.
 *
 * Filtered by a prefix when browsing the A–Z, because 11,056 labels cannot be listed and no
 * reader wants them to be.
 */
export async function listLabels(
  db: Db,
  options: { prefix?: string | null; limit?: number; usedByArticlesOnly?: boolean } = {}
): Promise<{ slug: string; name: string; articleCount: number }[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (options.prefix) {
    params.push(`${options.prefix}%`);
    conditions.push(`l.name ilike $${params.length}`);
  }
  if (options.usedByArticlesOnly !== false) {
    conditions.push(`exists (select 1 from ozikoro_article_label al where al.label_id = l.id)`);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
  params.push(limit);

  const rows = await db.rows<Record<string, unknown>>(
    `select l.slug, l.name,
            (select count(*)::int from ozikoro_article_label al where al.label_id = l.id) as article_count
       from ozikoro_label l ${where}
      order by article_count desc, l.name
      limit $${params.length}`,
    params
  );
  return rows.map((r) => ({ slug: String(r.slug), name: String(r.name), articleCount: Number(r.article_count ?? 0) }));
}

export async function getLabelBySlug(db: Db, slug: string): Promise<{ slug: string; name: string } | null> {
  const row = await db.one<Record<string, unknown>>(`select slug, name from ozikoro_label where slug = $1`, [slug]);
  return row ? { slug: String(row.slug), name: String(row.name) } : null;
}

/** Related reading: the same topic or an overlapping label, excluding the article itself. */
export async function getRelatedArticles(db: Db, articleId: number, limit = 4): Promise<ArticleSummary[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `${ARTICLE_SELECT}
      where a.status = 'published' and a.is_page = false and a.id <> $1
        and (
          a.topic_id = (select topic_id from ozikoro_article where id = $1)
          or exists (
            select 1 from ozikoro_article_label mine
              join ozikoro_article_label theirs on theirs.label_id = mine.label_id
             where mine.article_id = $1 and theirs.article_id = a.id
          )
        )
      order by a.published_at desc nulls last
      limit $2`,
    [articleId, Math.min(Math.max(limit, 1), 12)]
  );
  return rows.map((row) => rowToSummary(row));
}

export interface ArchiveStats {
  articles: number;
  contributors: number;
  media: number;
  topics: number;
  labels: number;
  sources: number;
  entities: number;
  withImages: number;
  earliest: string | null;
  latest: string | null;
}

/** The numbers the home page and the archive index state. Real counts, not designed ones. */
export async function getArchiveStats(db: Db): Promise<ArchiveStats> {
  const row = await db.one<Record<string, unknown>>(`
    select
      (select count(*)::int from ozikoro_article where status = 'published' and is_page = false) as articles,
      (select count(*)::int from ozikoro_contributor) as contributors,
      (select count(*)::int from ozikoro_media) as media,
      (select count(*)::int from ozikoro_topic) as topics,
      (select count(*)::int from ozikoro_label) as labels,
      (select count(*)::int from ozikoro_source) as sources,
      (select count(*)::int from ozikoro_entity) as entities,
      (select count(*)::int from ozikoro_article where status = 'published' and is_page = false and featured_media_id is not null) as with_images,
      (select min(published_at)::text from ozikoro_article where status = 'published' and is_page = false) as earliest,
      (select max(published_at)::text from ozikoro_article where status = 'published' and is_page = false) as latest
  `);
  return {
    articles: Number(row?.articles ?? 0),
    contributors: Number(row?.contributors ?? 0),
    media: Number(row?.media ?? 0),
    topics: Number(row?.topics ?? 0),
    labels: Number(row?.labels ?? 0),
    sources: Number(row?.sources ?? 0),
    entities: Number(row?.entities ?? 0),
    withImages: Number(row?.with_images ?? 0),
    earliest: row?.earliest ? String(row.earliest) : null,
    latest: row?.latest ? String(row.latest) : null,
  };
}

/** Every published slug, for the sitemap. */
export async function listArticleSlugs(db: Db): Promise<{ slug: string; modifiedAt: string | null }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select slug, modified_at::text as modified_at from ozikoro_article where status = 'published' and is_page = false order by published_at desc nulls last`
  );
  return rows.map((r) => ({ slug: String(r.slug), modifiedAt: r.modified_at ? String(r.modified_at) : null }));
}

export { summarise, readingMinutes, prepareArchiveHtml };
