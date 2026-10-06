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
   * **Null when the record is linked to no entity of a place kind — 881 of the archive's 1,051
   * published records**, measured after the round-323 backfill. The card shows a place chip only
   * when this is non-null: a chip is a claim with a record behind it, and the one thing this archive
   * must never do is print a plausible place beside the real ones.
   *
   * Which entity kinds count as a place, and why a clan does, is stated once at
   * `PLACE_ENTITY_KINDS`.
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
 * The entity kinds that read to a reader as a PLACE — stated ONCE, because three readers use it.
 *
 * **A chip is a claim with a record behind it, and a chip that says `Place` beside a filter that
 * cannot find the record is a worse fault than no chip at all.** So this is the single source: the
 * card's chip (`ARTICLE_SELECT`), the design screen's entry (`PLACE_NAMES_SQL`), the archive's
 * place facet and the rail's free-text place filter (`getArchiveFacets`, `listWhere`) all read this
 * one list. A previous round found the same matcher written twice in two routes and already
 * drifted; a list duplicated is a list that will disagree.
 *
 * **`clan` is in the list and was not, and that is a correction rather than an addition.** The
 * archive's own vocabulary already calls a clan a place: `/towns` is the clan register with the
 * towns filed inside it, `/town/<slug>/` serves a clan and a town through one route and one design,
 * and the design's chip is labelled `Place` — never "Town". An Igbo clan is a territorial unit, and
 * a reader looking at *Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots* reads "Ute-Okpu" as where the
 * record is. Excluding clans was a decision nobody recorded, and it is why nine of the twelve cards
 * on the archive's first page showed nothing.
 *
 * `people` is deliberately NOT here: a people is not a place, and a record about the Igbo, the Aro
 * or the Ikwerre belongs under the ethnic-group facet that already exists for it.
 *
 * Measured on the served archive when the list was extended (4 October 2026): **170 of 1,051
 * published records** carry a link to an entity of one of these kinds, up from 55 — and **112 of
 * the 115 new ones are records reachable only through a clan link** (170 = 58 linked to a town or a
 * kingdom + 130 linked to a clan − 18 that are both). **1,051 of 1,051** still carry no period and
 * no source type.
 */
export const PLACE_ENTITY_KINDS = [
  'town', 'place', 'historical_place', 'archaeological_site', 'kingdom', 'polity', 'chiefdom',
  'community', 'clan',
] as const;

/**
 * The same list spelled for SQL.
 *
 * Exported so a query in another module — the design screen's entry query is one — cannot spell the
 * list differently and drift from the card.
 */
export const PLACE_ENTITY_KINDS_SQL = `(${PLACE_ENTITY_KINDS.map((k) => `'${k}'`).join(',')})`;

/**
 * A record's place names, from the entities it is linked to.
 *
 * **The one definition of the chip, shared by the card (`ARTICLE_SELECT`) and the design screen's
 * entry** (`realEntries` in `app/design-screen/[screen]/route.ts`, which had its own copy and had
 * already drifted — it aggregated *every* linked entity with no `kind` and no `distinct`).
 *
 * `string_agg(distinct …)` rather than `string_agg(…)`: **one record was measured printing
 * "Igbodo, Igbodo"** when the same place was reachable through two entity rows, and a chip that
 * names a place twice reads as a fault in the record rather than as a fact about it.
 */
export const PLACE_NAMES_SQL = `(select string_agg(distinct e.name, ', ' order by e.name)
            from ozikoro_article_entity ae join ozikoro_entity e on e.id = ae.entity_id
           where ae.article_id = a.id and e.kind in ${PLACE_ENTITY_KINDS_SQL})`;

/**
 * The columns every article listing needs, joined once.
 *
 * The image is taken from the featured-media relation, and its rights fields come with it: the
 * plan requires rights and attribution on every media record the site shows, so a query that
 * returned a URL without them would make the correct rendering impossible.
 *
 * `place` is the record's own place names, denormalised into the listing because the card's place
 * chip needs them for every row on the page and a query per row would be twenty-four queries. The
 * names come from `PLACE_NAMES_SQL`, the one definition the design screen also reads.
 */
const ARTICLE_SELECT = `
  select a.id, a.slug, a.title, a.standfirst, a.body_html, a.word_count,
         a.published_at, a.modified_at, a.source_type, a.period_label,
         a.seo_title, a.seo_description,
         c.display_name as author_name, c.slug as author_slug,
         t.name as topic_name, t.slug as topic_slug,
         ${PLACE_NAMES_SQL} as place,
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

  /*
   * ── THE RAIL'S MULTIPLE CHOICE, WHICH ITS OWN CONTROLS PRODUCE ──────────────────────────────────
   *
   * The design's rail draws CHECKBOXES — `name="group"`, `name="clan"`, `name="period"`, `name="src"` —
   * and a reader may tick Igbo and Ijaw in the same fieldset. A `GET` form sends both as a repeated
   * parameter (`?group=igbo&group=ijaw`), and **honouring only the first would answer a question the
   * reader did not ask.** They asked for the union; a rail that silently narrowed to one of the two
   * boxes they ticked would be a filter that lies about what it did, which is the fault this archive
   * has recorded in every round where a control looked right and returned the wrong records.
   *
   * Each plural form is an OR WITHIN its own facet and an AND against the others, which is what the
   * rail's own layout says: ticking Igbo and Ijaw under *Ethnic group* and Ngwa under *Sub-group or
   * clan* means "Ngwa records whose clan is Igbo or Ijaw".
   *
   * The plurals mirror the facets `getArchiveFacets` returns ONE FOR ONE — the same predicate, so an
   * option's count and the listing it produces cannot disagree:
   *
   *   `ethnicGroups`  `clan.ethnic_group`, the value `facets.ethnicGroups` counts
   *   `clanSlugs`     entity slugs linked with `role = 'clan'`, the value `facets.clans` counts
   *   `periods`       `a.period_label`, the value `facets.periods` counts
   *   `sourceTypes`   `a.source_type`, the value `facets.sourceTypes` counts
   *
   * The singular forms above are kept because routes that offer one value at a time use them — a card's
   * place chip, `/topic/<slug>/` — and a caller that passes both gets both conditions rather than one
   * silently replacing the other.
   */
  ethnicGroups?: string[] | null;
  /**
   * The clans a record is linked to, by entity slug.
   *
   * Narrowed to `role = 'clan'` on purpose, because that is the predicate the rail's *Sub-group or clan*
   * group counts with. A broader "any entity with this slug" would return records the group's own count
   * never included.
   */
  clanSlugs?: string[] | null;
  periods?: string[] | null;
  sourceTypes?: string[] | null;

  /**
   * ── THE PEOPLE A RECORD *NAMES*, WHICH IS NOT THE PEOPLE IT IS FILED UNDER ────────────────────────
   *
   * ⚠️ **THIS IS A SECOND, WEAKER CLAIM THAN `ethnicGroup` ABOVE, AND THE TWO ARE DELIBERATELY NOT THE
   * SAME OPTION.** `ethnicGroup` reads `clan.ethnic_group` through `ozikoro_article_entity` — a record
   * *catalogued under* a people — and on this database **that facet holds exactly one row, `Igbo 197`**,
   * because the register has published only Igbo clans (168 of its 228 rows, across thirteen other
   * peoples, are unpublished). `peopleNames` asks the weaker and much wider question the archive's own
   * search already answers: **does this record name the people at all?**
   *
   * It exists because the two are both true and answer different questions, and `/archive/`'s rail is
   * the page that needs the second one: the owner wrote about Edo and Kanuri and the rail showed
   * neither. A rail built on `ethnicGroup` would read `Edo 0` beside an archive with 102 published
   * records naming Edo — *"a list that understates its own holdings is a worse fault than a short
   * one"*. See `place-mentions.ts` for the same distinction already drawn for places: **histories
   * ABOUT a place, and records that MENTION it, are never merged.**
   *
   * THE PREDICATE IS THE ARCHIVE'S OWN INSTRUMENT, NOT A NEW ONE. `search_vector` is the generated
   * column migration 0035 builds from the title (weight `A`), the standfirst (`B`) and the body with its
   * markup stripped (`C`), and it is what `searchArticles` already matches with. The label clause is
   * `searchArticles`' own doctrine: *"a search for a town that is a tag but not a word in any body
   * should still find the articles tagged with it"* — an 11,056-tag vocabulary the migration preserved
   * as the way the existing site is found. The label test is **equality, not `ilike`**, so `Edo` does
   * not match an `Edomani` tag while `Edo People` is reachable through the text it accompanies.
   *
   * **AN OPTION'S COUNT AND THE LISTING IT LEADS TO ARE THE SAME STATEMENT**, which is why this is an
   * option on `listWhere` rather than a query written beside the rail: `countArticles(db, {peopleNames})`
   * and `listArticles(db, {peopleNames})` run this one predicate, so the number cannot disagree with the
   * records it promises.
   *
   * ⚠️ **A LIST, BECAUSE THE DESIGN DRAWS CHECKBOXES.** Its ethnic group is four checkboxes and the
   * reader may tick two; a `GET` form sends both as a repeated parameter (`?group=Edo&group=Ijaw`), and
   * **honouring only the first would answer a question the reader did not ask.** They asked for the union,
   * which is what `websearch_to_tsquery`'s own `or` produces from the names — so the union of two peoples
   * remains one predicate rather than becoming a second one written beside it.
   */
  peopleNames?: string[] | null;
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

/**
 * The `where` clause every archive listing is built from, and the reason it is exported.
 *
 * ⚠️ **A SECOND CALLER NEEDS THE SAME PREDICATE, NOT A SECOND COPY OF IT.** `/archive/` is served by the
 * design screen, and that screen's cards need two things `listArticles` does not return — the record's own
 * place expression and its attached-source count — so its query is written where the card is rendered and
 * borrows this clause rather than restating the filters. **The count and the listing are therefore the same
 * statement on both paths**, which is the property the archive's rail depends on: an option reading `Ngwa 4`
 * above a listing of three is the fault this whole file is arranged to make impossible.
 */
export function listWhere(options: ListOptions): { clause: string; params: unknown[] } {
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

  /*
   * ── A RECORD THAT NAMES A PEOPLE — THE RAIL'S ETHNIC GROUP, READ AS A MENTION ─────────────────────
   *
   * `peopleNames` is documented on `ListOptions`; what matters here is that it is the SAME `search_vector`
   * predicate `searchArticles` runs, so `/archive/?group=Edo` and the archive's own search for `Edo`
   * cannot drift apart. **A lexeme match rather than a second `ilike` on `body_html`**: the substring
   * form finds `edo` inside `Edomani` and inside the markup of a URL, and a count that includes a
   * different people's name is precisely the kind of number this archive refuses.
   *
   * TWO TICKED BOXES ARE ONE PREDICATE, NOT TWO. `websearch_to_tsquery` reads `or` itself, so the union
   * of the chosen peoples is one tsquery over the same column; the label clause is the same list. **A
   * chain of `or`-ed conditions would have been the same answer written twice**, and the second copy is
   * what drifts.
   */
  if (options.peopleNames?.length) {
    params.push(options.peopleNames);
    const p = `$${params.length}`;
    conditions.push(
      `(a.search_vector @@ websearch_to_tsquery('english', array_to_string(${p}::text[], ' or '))
        or exists (
          select 1 from ozikoro_article_label al
            join ozikoro_label l on l.id = al.label_id
           where al.article_id = a.id
             and lower(l.name) = any (select lower(n) from unnest(${p}::text[]) as n)
        ))`
    );
  }

  if (options.place) {
    /*
     * THE FREE-TEXT PLACE FILTER READS THE SAME LIST AS THE CHIP.
     *
     * It used to require `ae.role in ('town','place')` — the role, not the kind — so a record the
     * card chipped `Place` could be missed by a search for that very name whenever the two disagreed.
     * The predicate is now `PLACE_ENTITY_KINDS_SQL`, the one list, so "the chip says Place" and "the
     * place filter finds it" cannot come apart. The second branch is unchanged and deliberately has
     * no predicate of its own: a place is also searched where it is recorded — the clan's own name
     * and the towns filed inside it.
     */
    params.push(`%${options.place}%`);
    const p = `$${params.length}`;
    conditions.push(
      `(
        exists (
          select 1 from ozikoro_article_entity ae
            join ozikoro_entity en on en.id = ae.entity_id
           where ae.article_id = a.id
             and en.kind in ${PLACE_ENTITY_KINDS_SQL}
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

  /*
   * ── THE FOUR MULTI-CHOICE FACETS, EACH ONE THE FACET IT IS COUNTED FROM ─────────────────────────
   *
   * `= any($n::text[])` rather than a chain of `or`s: one parameter, one condition, and the array is
   * passed as a value rather than interpolated into the SQL. **The predicate is deliberately the same
   * text as the one `getArchiveFacets` counts with**, because the archive's rule is that an option's
   * number and the listing it leads to must be the same statement — a rail reading "Ngwa 14" above a
   * listing of thirteen is the fault the facet function exists to make impossible.
   *
   * An empty array is treated as "no choice made" rather than "match nothing": a form with every box
   * unticked submits the field not at all, and a filter that then returned zero records would be a
   * rail that broke the listing by being left alone.
   */
  if (options.ethnicGroups?.length) {
    params.push(options.ethnicGroups);
    conditions.push(
      `exists (
        select 1 from ozikoro_article_entity ae
          join ozikoro_entity en on en.id = ae.entity_id
          join clan cl on cl.id = en.clan_id
         where ae.article_id = a.id and cl.ethnic_group = any($${params.length}::text[])
      )`
    );
  }

  if (options.clanSlugs?.length) {
    params.push(options.clanSlugs);
    conditions.push(
      `exists (
        select 1 from ozikoro_article_entity ae
          join ozikoro_entity en on en.id = ae.entity_id
         where ae.article_id = a.id and ae.role = 'clan' and en.slug = any($${params.length}::text[])
      )`
    );
  }

  if (options.periods?.length) {
    params.push(options.periods);
    conditions.push(`a.period_label = any($${params.length}::text[])`);
  }

  if (options.sourceTypes?.length) {
    params.push(options.sourceTypes);
    conditions.push(`a.source_type = any($${params.length}::text[])`);
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
    /*
     * THE PLACE GROUP IS THE CHIP, COUNTED.
     *
     * It used to be `ae.role in ('town','place')`, which is the same set only while every place-kind
     * entity happens to carry a place role — and it stopped being the same set the moment `clan`
     * joined the chip, because a clan link carries `role = 'clan'` and a chip would then name a
     * place the rail's group did not offer. The predicate is now `PLACE_ENTITY_KINDS_SQL`, the one
     * list: **the group and the chip are the same statement**, one read a page at a time.
     *
     * A clan therefore appears in BOTH this group and the clan group above. That is deliberate and
     * not the fault round 305 fixed: there, 142 clans had been written *as towns* so the clan group
     * was empty and offered a filter matching nothing. Here the clan group is complete and the place
     * group is a second, wider reading of the same records — which is exactly what a reader who sees
     * `Place: Ute-Okpu` on a card and then looks for it expects to find.
     */
    db.rows<{ value: string; label: string; n: number }>(
      `select en.slug as value, en.name as label, count(distinct a.id)::int n
         from ozikoro_article a
         join ozikoro_article_entity ae on ae.article_id = a.id
         join ozikoro_entity en on en.id = ae.entity_id
        where a.status = 'published' and a.is_page = false and en.kind in ${PLACE_ENTITY_KINDS_SQL}
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
