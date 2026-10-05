/**
 * What a crawler should be told about.
 *
 * WHY THIS IS ONE QUERY SET RATHER THAN CALLS SCATTERED THROUGH THE PAGE
 *
 * The sitemap is the archive's statement of what it contains. Assembling it from a handful of list
 * functions meant that whatever nobody remembered to add was simply absent — and what was absent was
 * most of the archive. Measured before this module existed: the sitemap listed 1,051 articles and 3
 * topics, and **omitted 11,056 subject pages and 3,488 media pages**, which is the bulk of what the
 * archive holds. A crawler was being shown roughly 8% of it.
 *
 * Keeping the enumeration in one place means the question "what is indexable?" has one answer.
 *
 * WHAT IS DELIBERATELY EXCLUDED
 *
 *   * Drafts, unpublished and private records. A sitemap is public: listing something a reader cannot
 *     reach is an instruction to index a 404.
 *   * Search results and paginated views. They are `noindex` and are not canonical.
 *   * The design reference at `/design/`. It documents the reference implementation and is not part of
 *     the archive.
 *
 * TRAILING SLASHES
 *
 * The site serves with `trailingSlash: true`, so `/archive/` is the canonical address and `/archive`
 * is a form that gets normalised. The sitemap emits the slashed form for every entry, because a
 * sitemap that names a non-canonical form is asking a crawler to index a redirect.
 */
import type { Db } from '@ozituma/db/client';

export interface IndexableUrl {
  url: string;
  lastModified?: string;
  changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: number;
  /**
   * Which sitemap this belongs to.
   *
   * WHY THE ENUMERATION IS SPLIT ON THE WAY OUT
   *
   * Every address the archive wants found, in one document, is **a 2 MB XML file** — and a sitemap protocol
   * limit is 50,000 URLs and 50 MB uncompressed, so size was not yet the problem. **The problem is what a
   * crawler does with it.** One file mixes a page that changes daily with 11,056 subject pages that have not
   * changed since import, so Search Console can only report on the whole, and a single malformed entry
   * invalidates the lot.
   *
   * **A sitemap index with one file per kind is what lets each kind be diagnosed on its own** — and it is how
   * a crawler is told which parts of an archive are large and which are small.
   */
  group: 'pages' | 'histories' | 'topics' | 'subjects' | 'media' | 'places' | 'publications' | 'researchers';
}

/** The child sitemaps, in the order the index lists them. */
export const SITEMAP_GROUPS = [
  'pages', 'histories', 'topics', 'subjects', 'media', 'places', 'publications', 'researchers',
] as const;

/** The site's own origin. One constant, so no entry can be built from a different one by accident. */
export const SITE_ORIGIN = 'https://ozikoro.com';

/** `path` without a leading slash is fine; the result always has exactly one trailing slash. */
export function canonicalUrl(path: string): string {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return clean.length === 0 ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}/${clean}/`;
}

export async function listIndexableUrls(db: Db): Promise<IndexableUrl[]> {
  const out: IndexableUrl[] = [];

  // The pages that always exist, whether or not the archive has content yet.
  out.push({ url: canonicalUrl(''), group: 'pages', changeFrequency: 'daily', priority: 1 });
  out.push({ url: canonicalUrl('archive'), group: 'pages', changeFrequency: 'daily', priority: 0.9 });
  out.push({ url: canonicalUrl('folklore'), group: 'pages', changeFrequency: 'weekly', priority: 0.8 });
  out.push({ url: canonicalUrl('documents'), group: 'pages', changeFrequency: 'weekly', priority: 0.7 });
  out.push({ url: canonicalUrl('topics'), group: 'pages', changeFrequency: 'weekly', priority: 0.7 });
  out.push({ url: canonicalUrl('entities'), group: 'places', changeFrequency: 'weekly', priority: 0.7 });
  /*
   * The clan register.
   *
   * `/towns` was already built and was missing from this list, and `/clans` did not exist — so the whole
   * place surface was invisible to a crawler while `/entities` was listed, and `check-links.sh` has the
   * same gap in its seeds. Both are closed here rather than left for whoever notices next.
   *
   * ⚠️ AND BOTH ADDRESSES IT NAMED ARE NOW 301s, WHICH ROUND 260 FOUND BY FETCHING THEM. The owner renamed
   * the register — *"add them all to the /towns page, and maybe rename it to /clan-towns to accommodate
   * both"* — so `/clans/` and `/towns/` answer **301 to `/clan-towns/`**, and this list was inviting a
   * crawler to two URLs that immediately send it elsewhere. **A sitemap names canonical addresses**; a
   * redirect in one asks a search engine to index a door that opens onto a different room.
   *
   * ⚠️ THIS COULD NOT HAVE BEEN SEEN BEFORE ROUND 257. `check-sitemap.sh` read the sitemap's INDEX and
   * tested its eight sub-sitemap URLs, so no page inside was ever fetched — the check reported
   * `Every sampled page resolved` on eight paths out of fifteen thousand. The first run after it was
   * repaired found these.
   *
   * `/clans/tribes` and `/clans/regions` stay: measured, both answer **200** and are not redirects.
   */
  out.push({ url: canonicalUrl('clan-towns'), group: 'places', changeFrequency: 'weekly', priority: 0.8 });
  out.push({ url: canonicalUrl('clans/tribes'), group: 'places', changeFrequency: 'monthly', priority: 0.6 });
  out.push({ url: canonicalUrl('clans/regions'), group: 'places', changeFrequency: 'monthly', priority: 0.6 });
  out.push({ url: canonicalUrl('publications'), group: 'publications', changeFrequency: 'daily', priority: 0.8 });
  out.push({ url: canonicalUrl('researchers'), group: 'pages', changeFrequency: 'weekly', priority: 0.7 });
  out.push({ url: canonicalUrl('about'), group: 'pages', changeFrequency: 'monthly', priority: 0.5 });

  // Records at their original addresses, which the plan requires to survive the move.
  //
  // A RECORD HELD BY AGREEMENT IS NOT LISTED, AND A PAGE HELD BY AGREEMENT IS NOT EITHER. The address is
  // served as a 403 carrying `noindex` (migration 0057), so a sitemap that invited a crawler to it would be
  // asking a search engine to index a door it cannot open. This is the READING claim; the media register's
  // `restricted` is a claim about reuse and has nothing to do with what may be listed here.
  const articles = await db.rows<{ slug: string; modified_at: string | null }>(
    `select slug, modified_at from ozikoro_article
      where status = 'published' and is_page = false and access_tier = 'open' order by id`
  );
  for (const a of articles) {
    out.push({
      url: canonicalUrl(a.slug), group: 'histories',
      ...(a.modified_at ? { lastModified: new Date(String(a.modified_at)).toISOString() } : {}),
      changeFrequency: 'monthly', priority: 0.8,
    });
  }

  // WordPress pages, which are part of the migrated site and were absent from the old sitemap too.
  const pages = await db.rows<{ slug: string }>(
    `select slug from ozikoro_article
      where status = 'published' and is_page = true and access_tier = 'open' order by id`
  );
  for (const p of pages) out.push({ url: canonicalUrl(p.slug), group: 'pages', changeFrequency: 'monthly', priority: 0.6 });

  const topics = await db.rows<{ slug: string }>(`select slug from ozikoro_topic order by id`);
  for (const t of topics) out.push({ url: canonicalUrl(`topics/${t.slug}`), group: 'topics', changeFrequency: 'weekly', priority: 0.7 });

  /*
   * The 11,056 subjects. Each one is a real page listing the records filed under it, and each is how
   * the archive is actually found — a reader searching a subject, not a title.
   */
  const labels = await db.rows<{ slug: string }>(
    `select slug from ozikoro_label
      where exists (select 1 from ozikoro_article_label al where al.label_id = ozikoro_label.id)
      order by id`
  );
  for (const l of labels) out.push({ url: canonicalUrl(`labels/${l.slug}`), group: 'subjects', changeFrequency: 'weekly', priority: 0.6 });

  // The media pages, which are records in their own right with provenance and rights on them.
  const media = await db.rows<{ slug: string }>(`select slug from ozikoro_media order by id`);
  for (const m of media) out.push({ url: canonicalUrl(`documents/${m.slug}`), group: 'media', changeFrequency: 'monthly', priority: 0.5 });

  // Entities, and only those with something behind them — an empty page is a thin page.
  const entities = await db.rows<{ slug: string }>(
    `select slug from ozikoro_entity
      where exists (select 1 from ozikoro_article_entity ae where ae.entity_id = ozikoro_entity.id)
      order by id`
  );
  for (const e of entities) out.push({ url: canonicalUrl(`entities/${e.slug}`), group: 'places', changeFrequency: 'weekly', priority: 0.7 });

  /*
   * Every published register entry, at its canonical address.
   *
   * `/town/<slug>/` is deliberately NOT listed here. It serves the same record as `/clans/<slug>/` and
   * declares the register address as its canonical, so listing both would ask a crawler to index one entry
   * twice — which is the duplicate the canonical link on that page exists to prevent.
   */
  const places = await db.rows<{ slug: string }>(`select slug from clan where published order by id`);
  for (const p of places) {
    out.push({ url: canonicalUrl(`clans/${p.slug}`), group: 'places', changeFrequency: 'monthly', priority: 0.7 });
  }

  const publications = await db.rows<{ slug: string; published_at: string | null }>(
    `select slug, published_at from ozikoro_publication where status = 'published' and is_public = true order by id`
  );
  for (const p of publications) {
    out.push({
      url: canonicalUrl(`publications/${p.slug}`), group: 'publications',
      ...(p.published_at ? { lastModified: new Date(String(p.published_at)).toISOString() } : {}),
      changeFrequency: 'monthly', priority: 0.7,
    });
  }

  const researchers = await db.rows<{ account_id: number }>(
    `select account_id from ozikoro_member where is_public = true and status = 'active' order by account_id`
  );
  for (const r of researchers) out.push({ url: canonicalUrl(`researchers/${r.account_id}`), group: 'researchers', changeFrequency: 'monthly', priority: 0.6 });

  /*
   * Deduplicate on the way out.
   *
   * Two real collisions were measured on this archive: `/about/` is both a fixed route and one of the
   * six migrated WordPress pages, and two media records share a slug. A sitemap listing the same
   * address twice is a crawl instruction sent twice, and Search Console reports it as a duplicate.
   *
   * Deduplicating here rather than chasing each collision is deliberate: the collisions come from the
   * data, and more will appear as the archive grows. The first entry wins, so the fixed high-priority
   * routes keep their priority over a migrated page of the same name.
   */
  const seen = new Set<string>();
  return out.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

/** XML text, escaped. A title can contain `&`, and an unescaped one invalidates the whole document. */
const x = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** One sitemap document, from a list of entries. */
export function sitemapDocument(entries: IndexableUrl[]): string {
  const urls = entries
    .map((e) => {
      const parts = [`<loc>${x(e.url)}</loc>`];
      if (e.lastModified) parts.push(`<lastmod>${x(new Date(e.lastModified).toISOString())}</lastmod>`);
      parts.push(`<changefreq>${e.changeFrequency}</changefreq>`);
      parts.push(`<priority>${e.priority.toFixed(1)}</priority>`);
      return `<url>${parts.join('')}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

/**
 * The sitemap index, which is what `/sitemap.xml` now returns.
 *
 * **A child is listed only when the archive actually holds something of that kind.** An index entry pointing at
 * an empty sitemap is a crawl request for nothing, and Search Console reports it as a problem rather than as a
 * category with no content.
 */
export function sitemapIndex(groups: { group: string; count: number; lastModified?: string }[]): string {
  const children = groups
    .filter((g) => g.count > 0)
    .map((g) => {
      const parts = [`<loc>${x(`${SITE_ORIGIN}/sitemap/${g.group}`)}</loc>`];
      if (g.lastModified) parts.push(`<lastmod>${x(new Date(g.lastModified).toISOString())}</lastmod>`);
      return `<sitemap>${parts.join('')}</sitemap>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${children}</sitemapindex>`;
}
