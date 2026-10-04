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
  /**
   * The record's place names, comma-separated, from the entities it is linked to.
   *
   * **Null when the record names no place, which is 996 of the archive's 1,051 published records.**
   * The card shows a place chip only when this is non-null: a chip is a claim with a record behind
   * it, and the one thing this archive must never do is print a plausible place beside the real
   * ones.
   */
  place: string | null;
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
 * The entity kinds that read to a reader as a PLACE.
 *
 * **This is a rule about meaning, not a formatting choice, so it is stated once.** The archive's
 * link table carries a `role` per link (`town`, `clan`, `ethnic_group`, `place`, …), and a record's
 * place facet is defined in `getArchiveFacets` as `role in ('town','place')`. The chip on a card is
 * the same statement as that facet read one record at a time, so it uses the same roles — and the
 * entity's own `kind` narrows it further, because a `place` link can point at a kingdom or a
 * community, and both are places a reader would recognise. Measured on the served archive:
 * **55 of 1,051 published records** are linked to an entity of one of these kinds, and **1,051 of
 * 1,051** carry no period and no source type at all.
 */
const PLACE_ENTITY_KINDS = `('town','place','historical_place','archaeological_site','kingdom','polity','chiefdom','community')`;

/**
 * The columns every article listing needs, joined once.
 *
 * The image is taken from the featured-media relation, and its rights fields come with it: the
 * plan requires rights and attribution on every media record the site shows, so a query that
 * returned a URL without them would make the correct rendering impossible.
 *
 * `place` is the record's own place names, denormalised into the listing because the card's place
 * chip needs them for every row on the page and a query per row would be twenty-four queries. It is
 * `string_agg(distinct …)` rather than `string_agg(…)`: **one record was measured printing
 * "Igbodo, Igbodo"** when the same place was reachable through two entity rows, and a chip that
 * names a place twice reads as a fault in the record rather than as a fact about it.
 */
const ARTICLE_SELECT = `
  select a.id, a.slug, a.title, a.standfirst, a.body_html, a.word_count,
         a.published_at, a.modified_at, a.source_type, a.period_label,
         a.seo_title, a.seo_description,
         c.display_name as author_name, c.slug as author_slug,
         t.name as topic_name, t.slug as topic_slug,
         (select string_agg(distinct e.name, ', ' order by e.name)
            from ozikoro_article_entity ae join ozikoro_entity e on e.id = ae.entity_id
           where ae.article_id = a.id and e.kind in ${PLACE_ENTITY_KINDS}) as place,
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
    place: row.place ? String(row.place) : null,
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
/*
 * Exported because FOUR other public lookups had the same exposure and were fixed in round 64.
 * The uniqueness checks in `editorial.ts` and `publications.ts` deliberately do NOT use it: "is this
 * slug taken?" must compare against the exact stored value, and a tolerant comparison there would
 * report collisions that do not exist.
 */
export function slugVariants(slug: string): string[] {
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
  /**
   * A contributor's slug, for the `/author/<slug>/` addresses WordPress served.
   *
   * Filtered through a SUBQUERY rather than a join, deliberately: `listArticles` already joins
   * `ozikoro_contributor`, but `countArticles` does not, and both call `listWhere`. Referencing
   * `c.slug` there would break the count with an unknown-table error — a failure that would surface
   * only on pages that paginate.
   */
  authorSlug?: string | null;
  limit?: number;
  offset?: number;
  /** Newest first by default; alphabetical is used by the A–Z index. */
  order?: 'recent' | 'title';

  // -------------------------------------------------------------------------
  // The archive's filter rail (design brief §3.1)
  // -------------------------------------------------------------------------
  /**
   * Free text over the title, the standfirst and the body.
   *
   * The body match is `ilike` rather than the generated `search_vector`, because the vector is
   * built with the `english` configuration and this archive is full of Igbo names that the English
   * stemmer mangles — "Abọ" and "Abo" are the same place and neither is an English word. A plain
   * substring match over the stored HTML is slower and finds what a reader actually typed, which is
   * the trade this archive wants: the brief's first audience is a diaspora reader on a phone who
   * does not have the diacritics to hand.
   *
   * Match-anywhere is deliberate. At 1,057 records a sequential scan is milliseconds, and a filter
   * that misses a record because the word appears in the third paragraph is a filter that has
   * failed at the one thing it was for.
   */
  search?: string | null;
  /** A town, village or named site — matched against the entity graph AND the dictionary. */
  place?: string | null;
  /** The Igbo grouping a record's clan belongs to, e.g. `Igbo`. */
  ethnicGroup?: string | null;
  /** The article's own `period_label`. */
  period?: string | null;
  /** One of `SOURCE_TYPES`. */
  sourceType?: string | null;
  /**
   * `sourced` — carries at least one source AND a recorded source type.
   * `partial` — missing either. This is the archive's honest completeness axis, and both halves
   *   are computed from the same two facts the article page renders.
   */
  completeness?: 'sourced' | 'partial' | null;
  /** Restrict to the entities a record is linked to by slug — the rail's clan and town links. */
  entitySlug?: string | null;
}

/**
 * The roles an entity can fill on a record, narrowed to the four the filter rail draws.
 *
 * A narrower union than `EntityRole` in `editorial.ts` on purpose: `person`, `event` and `other`
 * are real links the archive makes and are not facets a reader filters an index by, so admitting
 * them here would create filters the rail has no group for.
 */
export type EntityRoleFilter = 'ethnic_group' | 'clan' | 'town' | 'place';

const ENTITY_ROLE_FILTERS: EntityRoleFilter[] = ['ethnic_group', 'clan', 'town', 'place'];

export function isEntityRoleFilter(value: string): value is EntityRoleFilter {
  return (ENTITY_ROLE_FILTERS as string[]).includes(value);
}

function listWhere(options: ListOptions): { clause: string; params: unknown[] } {
  // Pages are site content, not records. Every archive query excludes them (migration 0036).
  const conditions: string[] = [`a.status = 'published'`, `a.is_page = false`];
  const params: unknown[] = [];

  if (options.topicSlug) {
    params.push(options.topicSlug);
    conditions.push(`t.slug = $${params.length}`);
  }
  if (options.authorSlug) {
    params.push(options.authorSlug);
    conditions.push(
      `a.author_id = (select id from ozikoro_contributor where slug = $${params.length})`
    );
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

  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(
      `(a.title ilike $${params.length}
        or a.standfirst ilike $${params.length}
        or a.body_html ilike $${params.length})`
    );
  }

  if (options.place) {
    params.push(`%${options.place}%`);
    const p = `$${params.length}`;
    conditions.push(
      `(
        exists (
          select 1 from ozikoro_article_entity ae
            join ozikoro_entity en on en.id = ae.entity_id
           where ae.article_id = a.id
             and ae.role in ('town', 'place')
             and (en.name ilike ${p}
                  or exists (select 1 from unnest(en.aliases) al where al ilike ${p}))
        )
        or exists (
          select 1 from ozikoro_article_entity ae
            join ozikoro_entity en on en.id = ae.entity_id
            join clan cl on cl.id = en.clan_id
           where ae.article_id = a.id
             and (cl.name ilike ${p}
                  or exists (select 1 from clan_town ct where ct.clan_id = cl.id and ct.name ilike ${p}))
        )
      )`
    );
  }

  if (options.ethnicGroup) {
    /*
     * THE ETHNIC GROUP IS READ FROM THE CLAN, NOT COPIED ONTO THE RECORD.
     *
     * `clan.ethnic_group` is where this fact lives — one row per group, stated once — and an
     * article's ethnic group is a property of the clan it is attached to. Copying it onto the
     * article would be a second definition of the same thing, and the two would drift the first
     * time a clan was reclassified. So the filter follows the relation, which is also why a record
     * with no clan linked to it can never appear under any ethnic group: it does not have one yet.
     */
    params.push(options.ethnicGroup);
    conditions.push(
      `exists (
        select 1 from ozikoro_article_entity ae
          join ozikoro_entity en on en.id = ae.entity_id
          join clan cl on cl.id = en.clan_id
         where ae.article_id = a.id and cl.ethnic_group = $${params.length}
      )`
    );
  }

  if (options.entitySlug) {
    params.push(options.entitySlug);
    conditions.push(
      `exists (
        select 1 from ozikoro_article_entity ae
          join ozikoro_entity en on en.id = ae.entity_id
         where ae.article_id = a.id and en.slug = $${params.length}
      )`
    );
  }

  if (options.period) {
    params.push(options.period);
    conditions.push(`a.period_label = $${params.length}`);
  }

  if (options.sourceType) {
    params.push(options.sourceType);
    conditions.push(`a.source_type = $${params.length}`);
  }

  if (options.completeness === 'sourced') {
    conditions.push(
      `(a.source_type is not null and a.source_type <> 'unsourced'
        and exists (select 1 from ozikoro_article_source s where s.article_id = a.id))`
    );
  }
  if (options.completeness === 'partial') {
    conditions.push(
      `(a.source_type is null or a.source_type = 'unsourced'
        or not exists (select 1 from ozikoro_article_source s where s.article_id = a.id))`
    );
  }

  return { clause: `where ${conditions.join(' and ')}`, params };
}

/**
 * What the archive's rail can offer, counted from the records themselves.
 *
 * WHY THIS IS A FUNCTION AND NOT A CONSTANT
 *
 * The design draws fixed groups — five period bands, three source types — and the archive holds
 * 1,057 records with **no period and no source type recorded on any of them**. A rail that printed
 * the design's bands with invented counts would be a lie with a progress bar, and one that omitted
 * them would promise less than the schema can do.
 *
 * So every option below is a `group by` over the published records, and a group with no rows comes
 * back empty. The page then says, in words, that nothing is recorded yet — which is the honest
 * screen the brief asks for ("an entry without a source should look incomplete") and, unlike a
 * constant, fills itself the moment an editor records the first period.
 */
export interface ArchiveFacetOption {
  value: string;
  label: string;
  count: number;
}

export interface ArchiveFacets {
  /** The four facets every record is required to carry. */
  ethnicGroups: ArchiveFacetOption[];
  clans: ArchiveFacetOption[];
  towns: ArchiveFacetOption[];
  periods: ArchiveFacetOption[];
  sourceTypes: ArchiveFacetOption[];
  /** The archive's own completeness axis. */
  sourced: number;
  partial: number;
  /** Totals, so a page can say what it is a filter over. */
  records: number;
  /** Of `records`, how many carry at least one source at all. */
  withAnySource: number;
}

const SOURCE_TYPE_NAMES: Record<string, string> = {
  oral_history: 'Oral history',
  colonial_record: 'Colonial record',
  academic_source: 'Academic source',
  mixed: 'More than one kind',
  unsourced: 'No source recorded',
};

/**
 * What a stored `source_type` reads as to a reader.
 *
 * **Exported because two places now name the same fact.** The rail's source-type facet has always
 * printed `Oral history` for `oral_history`; the chip on a record card names the same value, and a
 * card reading `oral_history` beneath a rail reading `Oral history` would look like two different
 * vocabularies. One function, called by both, is the only way that stays true.
 *
 * `source_type` is currently `null` on all 1,051 published records, so nothing calls this on a live
 * card today — it is called for the rail's own labels, and it is what a chip will print on the day
 * an editor records the first one.
 */
export function sourceTypeLabel(value: string): string {
  return SOURCE_TYPE_NAMES[value] ?? value.replace(/_/g, ' ');
}

/**
 * The chip class a source type is drawn with, in the design's own vocabulary.
 *
 * The design carries `chip-oral` (a moss wash) and `chip-source` (an indigo wash). **Oral history
 * is the one the design draws in its own colour**, so it keeps `chip-oral`; every other recorded
 * kind takes `chip-source`, which is the design's neutral wash for a source. No new class is
 * invented — the stylesheet is part of the design and is not edited.
 */
export function sourceTypeChipClass(value: string): string {
  return value === 'oral_history' ? 'chip-oral' : 'chip-source';
}

export async function getArchiveFacets(db: Db): Promise<ArchiveFacets> {
  /*
   * One query per group rather than one enormous query, because each has a different grain (an
   * entity role, a text column, a joined dictionary row) and a union of them would have to be
   * unpivoted in TypeScript anyway. All six are indexed or trivially small.
   */
  const base = `from ozikoro_article a where a.status = 'published' and a.is_page = false`;

  const [ethnic, clans, towns, periods, sources, totals] = await Promise.all([
    db.rows<{ value: string; n: number }>(
      `select cl.ethnic_group as value, count(distinct a.id)::int n
         from ozikoro_article a
         join ozikoro_article_entity ae on ae.article_id = a.id
         join ozikoro_entity en on en.id = ae.entity_id
         join clan cl on cl.id = en.clan_id
        where a.status = 'published' and a.is_page = false and cl.ethnic_group is not null
        group by 1 order by n desc, 1`
    ),
    db.rows<{ value: string; label: string; n: number }>(
      `select en.slug as value, en.name as label, count(distinct a.id)::int n
         from ozikoro_article a
         join ozikoro_article_entity ae on ae.article_id = a.id and ae.role = 'clan'
         join ozikoro_entity en on en.id = ae.entity_id
        where a.status = 'published' and a.is_page = false
        group by 1, 2 order by n desc, 2`
    ),
    db.rows<{ value: string; label: string; n: number }>(
      `select en.slug as value, en.name as label, count(distinct a.id)::int n
         from ozikoro_article a
         join ozikoro_article_entity ae on ae.article_id = a.id and ae.role in ('town','place')
         join ozikoro_entity en on en.id = ae.entity_id
        where a.status = 'published' and a.is_page = false
        group by 1, 2 order by n desc, 2`
    ),
    db.rows<{ value: string; n: number }>(
      `select a.period_label as value, count(*)::int n ${base} and a.period_label is not null
        group by 1 order by 1`
    ),
    db.rows<{ value: string; n: number }>(
      `select a.source_type as value, count(*)::int n ${base} and a.source_type is not null
        group by 1 order by 2 desc, 1`
    ),
    db.one<{ records: number; sourced: number; partial: number; with_any: number }>(
      `select count(*)::int as records,
              count(*) filter (where a.source_type is not null
                                 and a.source_type <> 'unsourced'
                                 and exists (select 1 from ozikoro_article_source s where s.article_id = a.id))::int as sourced,
              count(*) filter (where a.source_type is null
                                 or a.source_type = 'unsourced'
                                 or not exists (select 1 from ozikoro_article_source s where s.article_id = a.id))::int as partial,
              count(*) filter (where exists (select 1 from ozikoro_article_source s where s.article_id = a.id))::int as with_any
         ${base}`
    ),
  ]);

  return {
    ethnicGroups: ethnic.map((r) => ({ value: r.value, label: r.value, count: Number(r.n) })),
    clans: clans.map((r) => ({ value: r.value, label: r.label, count: Number(r.n) })),
    towns: towns.map((r) => ({ value: r.value, label: r.label, count: Number(r.n) })),
    periods: periods.map((r) => ({ value: r.value, label: r.value, count: Number(r.n) })),
    sourceTypes: sources.map((r) => ({
      value: r.value,
      label: sourceTypeLabel(r.value),
      count: Number(r.n),
    })),
    sourced: Number(totals?.sourced ?? 0),
    partial: Number(totals?.partial ?? 0),
    records: Number(totals?.records ?? 0),
    withAnySource: Number(totals?.with_any ?? 0),
  };
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
  const row = await db.one<Record<string, unknown>>(
    `select slug, name from ozikoro_label where slug = any($1::text[]) limit 1`,
    [slugVariants(slug)]
  );
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
