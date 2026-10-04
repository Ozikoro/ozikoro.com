/**
 * Entities: the knowledge graph, and the record it shares with the dictionary.
 *
 * ONE DATABASE, AND NOW ONE PLACE TO READ THE REGISTER
 *
 * The build plan is emphatic: "Ozituma is the language layer. Do not duplicate its dictionary inside
 * Ozikoro." A clan is already recorded in `clan`, with its division, its present-day states and its
 * towns, and an `ozikoro_entity` of kind `clan` does not restate any of that — it holds a foreign key to
 * the dictionary's row and contributes only what the archive adds: the historical relations, the articles
 * that mention it, the coordinates and the chronology.
 *
 * Production is also ONE Postgres database, shared by ozituma.com, ozikoro.com and learn (see
 * `docker/docker-compose.prod.yml`). So "do not duplicate" and "read it from here" are the same
 * instruction, not opposing ones: this module reads the register's OWN rows across the join, and the
 * register is now published on this site at `/clans/<slug>/`. A reader is not sent to another host to read
 * data that is already being served here; the only thing still read at ozituma.com is the language layer
 * — the name register and the dictionary's language records — which is what stays there.
 *
 * WHY THE PAGE IS WORTH BUILDING BEFORE THE GRAPH IS FULL
 *
 * Search promises `/entities/<slug>/` for every entity it returns, and the plan requires canonical
 * entity pages. The graph is thin because attaching an article to a clan is a human editorial decision —
 * the schema deliberately does not guess one from prose. But the destination has to exist and be correct
 * before the work that fills it, or the first editor to link a record creates a 404.
 */
import type { Db } from '@ozituma/db/client';
import { slugVariants } from './archive.ts';

export interface EntityDictionaryLink {
  /** The register's own record, when this entity is one. */
  kind: 'clan' | 'clan_town' | 'language';
  id: number | string;
  label: string;
  /**
   * The register entry's slug, for a clan or a town.
   *
   * WHY THIS EXISTS RATHER THAN THE URL BEING READ BACK OUT OF ONE
   *
   * This link used to be built as `https://ozituma.com/clans/${clan.id}`, and the dictionary looks an
   * entry up by SLUG — `packages/db/src/clans.ts` has `where c.slug = $1 and c.published`. So `/clans/11`
   * was a 404 and every one of the 188 entity pages carried a dead link. Measured against production:
   * `/clans/umunri` answers 200 and `/clans/11` answers 404. The bug was never the host; it was that an id
   * was put where a slug belongs. Carrying the slug makes that impossible to repeat.
   */
  slug: string | null;
  /** Present for a clan: the division above it. */
  tribe: string | null;
  /** The present-day states, which the register holds because the colonial divisions are history. */
  states: string[];
  lgas: string[];
  /** A clan's towns, as the sources enumerate them. */
  towns: string[];
  /**
   * Where the reader goes for this record.
   *
   * A clan or a town now has a page ON THIS SITE — the register at `/clans/<slug>/` — and that is where a
   * reader belongs, because production is one database and the archive can serve the register itself
   * instead of sending the reader to a second site to read its own data. A language record is still the
   * dictionary's, because the language layer stays there.
   */
  url: string;
  /** True when `url` leaves Ozikoro. A caller must render an anchor for it, not a Next `Link`. */
  external: boolean;
}

/**
 * The words the graph files its rows under, as a reader reads them.
 *
 * `ozikoro_entity.kind` is a checked vocabulary of 45 snake_case values — `historical_place`,
 * `oral_tradition`, `archaeological_site`. That is the column's language, not the page's, so an index that
 * printed it raw would offer a filter reading "archaeological site". The vocabulary here is the same one
 * `/entities/<slug>/` already uses for its own heading and for the kind beside each connected record; it
 * lives in the platform module now because two pages read it and a second copy is a second place for the
 * two to disagree. A kind the table does not name falls back to the column's own words with the
 * underscores opened out, so a migration that adds a kind cannot silently render it as nothing.
 */
const ENTITY_KIND_LABELS: Record<string, string> = {
  person: 'Person', people: 'People', community: 'Community', clan: 'Clan', town: 'Town',
  place: 'Place', historical_place: 'Historical place', archaeological_site: 'Archaeological site',
  polity: 'Polity', kingdom: 'Kingdom', chiefdom: 'Chiefdom', event: 'Event', period: 'Period',
  migration: 'Migration', trade_route: 'Trade route', conflict: 'Conflict', treaty: 'Treaty',
  deity: 'Deity', ritual: 'Ritual', festival: 'Festival', folklore: 'Folklore',
  oral_tradition: 'Oral tradition', architecture: 'Architecture', music: 'Music', craft: 'Craft',
  institution: 'Institution', language: 'Language', dialect: 'Dialect', object: 'Object',
  museum: 'Museum', collection: 'Collection', document: 'Document', photograph: 'Photograph',
  audio: 'Audio', video: 'Video', manuscript: 'Manuscript', dataset: 'Dataset',
  publication: 'Publication', topic: 'Topic', other: 'Record',
};

/** An entity kind's label. Never invents a word for a kind it does not know. */
export function entityKindLabel(kind: string): string {
  return ENTITY_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

export interface EntityRelation {
  relation: string;
  direction: 'out' | 'in';
  entityId: number;
  slug: string;
  name: string;
  kind: string;
}

export interface EntityArticle {
  slug: string;
  title: string;
  role: string;
  publishedAt: string | null;
}

export interface EntityDetail {
  id: number;
  kind: string;
  slug: string;
  name: string;
  aliases: string[];
  summary: string | null;
  latitude: number | null;
  longitude: number | null;
  locationNote: string | null;
  dateStart: number | null;
  dateEnd: number | null;
  dateQualifier: string | null;
  dateNote: string | null;
  /** How the date is known, in words, so "circa" is not rendered as a year. */
  dateStatement: string | null;
  dictionary: EntityDictionaryLink[];
  relations: EntityRelation[];
  articles: EntityArticle[];
}

/**
 * The chronology in words.
 *
 * A date qualifier collapsed into a bare number would assert precision the sources do not support —
 * "circa 1200" and "1200" are different claims, and the plan requires uncertainty to be
 * representable. So the sentence is built from the qualifier rather than from the year alone.
 */
export function dateStatement(entity: {
  dateStart: number | null; dateEnd: number | null; dateQualifier: string | null; dateNote: string | null;
}): string | null {
  const { dateStart, dateEnd, dateQualifier, dateNote } = entity;
  if (dateStart === null && dateEnd === null) return dateNote;
  const year = (y: number) => (y < 0 ? `${Math.abs(y)} BCE` : String(y));
  const range = dateStart !== null && dateEnd !== null && dateStart !== dateEnd
    ? `${year(dateStart)}–${year(dateEnd)}`
    : year((dateStart ?? dateEnd)!);

  const qualifier: Record<string, string> = {
    exact: '', circa: 'circa ', before: 'before ', after: 'after ', range: '', unknown: '',
  };
  const prefix = qualifier[dateQualifier ?? ''] ?? '';
  const suffix = dateNote ? ` — ${dateNote}` : '';
  return `${prefix}${range}${suffix}`.trim();
}

export async function getEntityBySlug(db: Db, slug: string): Promise<EntityDetail | null> {
  const row = await db.one<Record<string, unknown>>(
    `select id, kind, slug, name, aliases, summary, clan_id, clan_town_id, language_code,
            latitude, longitude, location_note, date_start, date_end, date_qualifier, date_note
       from ozikoro_entity where slug = any($1::text[]) limit 1`,
    [slugVariants(slug)]
  );
  if (!row) return null;

  const id = Number(row.id);
  const clanId = row.clan_id === null || row.clan_id === undefined ? null : Number(row.clan_id);
  const townId = row.clan_town_id === null || row.clan_town_id === undefined ? null : Number(row.clan_town_id);
  const languageCode = row.language_code ? String(row.language_code) : null;

  const [clan, town, language, relations, articles] = await Promise.all([
    clanId
      ? db.one<Record<string, unknown>>(
          `select c.id, c.slug, c.name, c.ethnic_group, c.states, c.lgas, t.name as tribe,
                  coalesce((select array_agg(ct.name order by ct.is_head desc, ct.name) from clan_town ct where ct.clan_id = c.id), '{}'::text[]) as towns
             from clan c left join tribe t on t.id = c.tribe_id where c.id = $1`,
          [clanId]
        )
      : Promise.resolve(null),
    /*
     * A town entity is a `clan_town` row. Its register page is its CLAN's page — a town inside a clan has
     * no page of its own, because the sources enumerate it as a settlement of the clan and give it no
     * record to read. So the clan's slug is read here, which is also what makes the link correct: the old
     * code built it from `clan_id`, and an id is not a slug.
     */
    townId
      ? db.one<Record<string, unknown>>(
          `select ct.id, ct.name, ct.clan_id, c.slug as clan_slug, c.name as clan_name
             from clan_town ct
             left join clan c on c.id = ct.clan_id
            where ct.id = $1`,
          [townId]
        )
      : Promise.resolve(null),
    languageCode
      ? db.one<Record<string, unknown>>(`select code, name, native_name from language where code = $1`, [languageCode])
      : Promise.resolve(null),
    db.rows<Record<string, unknown>>(
      `select r.relation, r.from_entity_id, r.to_entity_id,
              e.id, e.slug, e.name, e.kind
         from ozikoro_entity_relation r
         join ozikoro_entity e on e.id = case when r.from_entity_id = $1 then r.to_entity_id else r.from_entity_id end
        where r.from_entity_id = $1 or r.to_entity_id = $1
        order by r.relation, e.name
        limit 60`,
      [id]
    ),
    db.rows<Record<string, unknown>>(
      `select a.slug, a.title, a.published_at, ae.role
         from ozikoro_article_entity ae
         join ozikoro_article a on a.id = ae.article_id
        where ae.entity_id = $1 and a.status = 'published' and a.is_page = false
        order by a.published_at desc nulls last
        limit 60`,
      [id]
    ),
  ]);

  const links: EntityDictionaryLink[] = [];
  if (clan) {
    const clanSlug = clan.slug ? String(clan.slug) : null;
    links.push({
      kind: 'clan',
      id: Number(clan.id),
      label: String(clan.name),
      slug: clanSlug,
      tribe: clan.tribe ? String(clan.tribe) : null,
      states: Array.isArray(clan.states) ? clan.states.map(String) : [],
      lgas: Array.isArray(clan.lgas) ? clan.lgas.map(String) : [],
      towns: Array.isArray(clan.towns) ? clan.towns.map(String) : [],
      /*
       * THE FIX. This was `https://ozituma.com/clans/${clan.id}` and the dictionary looks entries up by
       * slug, so all 188 entity pages carried a 404. It is now the register's own page on this site,
       * built from the slug, with the index as a safe fallback if a row ever arrives without one.
       */
      url: clanSlug ? `/clans/${clanSlug}/` : '/clans/',
      external: false,
    });
  }
  if (town) {
    const clanSlug = town.clan_slug ? String(town.clan_slug) : null;
    links.push({
      kind: 'clan_town',
      id: Number(town.id),
      label: String(town.name),
      slug: clanSlug,
      tribe: null,
      states: [],
      lgas: [],
      towns: [],
      // A town is read on its clan's register page; the label above says which town this is.
      url: clanSlug ? `/clans/${clanSlug}/` : '/clans/',
      external: false,
    });
  }
  if (language) {
    links.push({
      kind: 'language',
      id: String(language.code),
      label: `${String(language.name)} (${String(language.native_name)})`,
      slug: null,
      tribe: null,
      states: [],
      lgas: [],
      towns: [],
      // The language layer stays in the dictionary, so this one link still leaves the site.
      url: `https://ozituma.com/languages/${String(language.code)}`,
      external: true,
    });
  }

  const entity: EntityDetail = {
    id,
    kind: String(row.kind),
    slug: String(row.slug),
    name: String(row.name),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    summary: row.summary ? String(row.summary) : null,
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    locationNote: row.location_note ? String(row.location_note) : null,
    dateStart: row.date_start === null || row.date_start === undefined ? null : Number(row.date_start),
    dateEnd: row.date_end === null || row.date_end === undefined ? null : Number(row.date_end),
    dateQualifier: row.date_qualifier ? String(row.date_qualifier) : null,
    dateNote: row.date_note ? String(row.date_note) : null,
    dateStatement: null,
    dictionary: links,
    relations: relations.map((r) => ({
      relation: String(r.relation),
      direction: Number(r.from_entity_id) === id ? 'out' : 'in',
      entityId: Number(r.id),
      slug: String(r.slug),
      name: String(r.name),
      kind: String(r.kind),
    })),
    articles: articles.map((a) => ({
      slug: String(a.slug),
      title: String(a.title ?? '').trim() || 'Untitled record',
      role: String(a.role),
      publishedAt: a.published_at ? new Date(String(a.published_at)).toISOString() : null,
    })),
  };
  entity.dateStatement = dateStatement(entity);
  return entity;
}

/** What a listing of the graph is narrowed by. The search is free text; the kind is a column value. */
export interface EntityFilter {
  kind?: string | null;
  search?: string | null;
}

/**
 * The WHERE clause every read of the graph shares, built once so the page and its count cannot disagree.
 *
 * WHY THIS IS ONE FUNCTION AND NOT TWO STRINGS. An index draws a page of rows and prints how many rows the
 * same filter matches in total. If those two are written separately they drift, and the drift is invisible:
 * the page shows eighteen cards and says "3 records", and nobody can tell which of the two is wrong. The
 * count and the listing therefore take the same arguments and the same clause, and there is one place for
 * `kind` and `search` to mean one thing.
 *
 * THE SEARCH IS OVER WHAT THE GRAPH ACTUALLY HOLDS — the name, the slug, the summary an editor wrote, and
 * the alternative and historical spellings in `aliases`. It is not a full-text search over linked prose:
 * the histories a record is attached to are the archive's articles, and `/archive/?q=` is where a reader
 * searches those. A record whose summary is empty is still findable by its name, and a name spelled the
 * other way is findable because `aliases` is read — which is the same reason the column exists.
 */
function entityFilter(options: EntityFilter): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options.kind) {
    params.push(options.kind);
    clauses.push(`e.kind = $${params.length}`);
  }

  const search = (options.search ?? '').trim();
  if (search.length > 0) {
    // `%` and `_` are wildcards in LIKE and a backslash escapes; a reader typing them means them
    // literally, so they are escaped rather than allowed to widen the search. The same rule, and the same
    // reasoning, as `listPlaces` in places.ts.
    const pattern = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    params.push(pattern);
    const at = `$${params.length}`;
    clauses.push(
      `(e.name ilike ${at} or e.slug ilike ${at} or e.summary ilike ${at}
        or exists (select 1 from unnest(e.aliases) a where a ilike ${at}))`
    );
  }

  return { clause: clauses.length > 0 ? `and ${clauses.join(' and ')}` : '', params };
}

/**
 * Entities by kind, for an index that is honest about how sparse the graph still is.
 *
 * THE ORDER IS TOTAL, WHICH IS WHAT MAKES PAGING CORRECT. It used to be `article_count desc, e.name`, and
 * neither column is unique — two records with no linked history and the same name are not impossible, and
 * a sort that does not decide between them lets Postgres return them in either order between two queries.
 * A reader pressing Next would then see one card twice and another never. `e.slug` is unique, so it is the
 * last key and the order is a function of the data rather than of the planner.
 */
export async function listEntities(
  db: Db,
  options: EntityFilter & { limit?: number; offset?: number } = {}
): Promise<{ id: number; kind: string; slug: string; name: string; summary: string | null; articleCount: number }[]> {
  const { clause, params } = entityFilter(options);
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 200);
  params.push(limit);
  const limitAt = params.length;
  params.push(Math.max(options.offset ?? 0, 0));
  const offsetAt = params.length;

  const rows = await db.rows<Record<string, unknown>>(
    `select e.id, e.kind, e.slug, e.name, e.summary,
            (select count(*)::int from ozikoro_article_entity ae
               join ozikoro_article a on a.id = ae.article_id
              where ae.entity_id = e.id and a.status = 'published' and a.is_page = false) as article_count
       from ozikoro_entity e
      where true ${clause}
      order by article_count desc, e.name, e.slug
      limit $${limitAt} offset $${offsetAt}`,
    params
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    slug: String(r.slug),
    name: String(r.name),
    summary: r.summary ? String(r.summary) : null,
    articleCount: Number(r.article_count ?? 0),
  }));
}

/**
 * How many records the same filter matches in total.
 *
 * It exists beside `listEntities` rather than being derived from the returned page, because a page of
 * eighteen says nothing about whether there are nineteen records or nine hundred — and "Next" cannot be
 * drawn, or honestly refused, without the number the reader is not being shown.
 */
export async function countEntities(db: Db, options: EntityFilter = {}): Promise<number> {
  const { clause, params } = entityFilter(options);
  const row = await db.one<Record<string, unknown>>(
    `select count(*)::int as n from ozikoro_entity e where true ${clause}`,
    params
  );
  return Number(row?.n ?? 0);
}

/** A kind the graph files rows under, with how many there are. */
export interface EntityKindFacet {
  kind: string;
  label: string;
  count: number;
}

/**
 * The kinds the graph actually files, counted from its own rows.
 *
 * THIS IS A `group by` AND NOT A LIST, for the reason `/archive`'s rail records: a filter drawn from a
 * constant offers values the archive does not hold, and a reader who picks one lands on an empty page that
 * reads as "the archive does not have this" when the truth is "that is not a value it uses". The check
 * constraint on `ozikoro_entity.kind` names 45 kinds and the graph holds a handful of them; only the
 * handful is offered, and a kind appears the moment an editor files the first record under it.
 *
 * The order is biggest first, then alphabetically, so the words a reader is most likely to want are the
 * ones nearest the start of a bar that scrolls sideways on a narrow screen. `kind` breaks the tie, so two
 * kinds holding the same number of rows cannot swap places between two renders of the same page.
 */
export async function getEntityFacets(db: Db): Promise<{ total: number; kinds: EntityKindFacet[] }> {
  const rows = await db.rows<Record<string, unknown>>(
    `select kind, count(*)::int as n
       from ozikoro_entity
      group by kind
      order by n desc, kind`
  );
  const kinds = rows.map((r) => ({
    kind: String(r.kind),
    label: entityKindLabel(String(r.kind)),
    count: Number(r.n ?? 0),
  }));
  return { total: kinds.reduce((sum, k) => sum + k.count, 0), kinds };
}

/**
 * How much of the graph exists, so a page can say so rather than implying it is complete.
 *
 * THE TWO FIGURES ARE NOW COMPARABLE, WHICH THEY WERE NOT. The page's sentence is "N of the archive's M
 * published histories are linked to a record", and M was `published and not is_page` while N was
 * `count(distinct article_id) from ozikoro_article_entity` — every link there is, including links to
 * drafts, to pages and to trashed rows. A numerator that can exceed its denominator makes the sentence
 * false in the one place a reader has no way to check it. Both sides now read the same articles: published
 * and not a page. The number of links to anything else is not a fact this page claims.
 */
export async function getEntityStats(
  db: Db
): Promise<{ entities: number; kinds: number; linkedArticles: number; publishedArticles: number }> {
  const row = await db.one<Record<string, unknown>>(`
    select
      (select count(*)::int from ozikoro_entity) as entities,
      (select count(distinct kind)::int from ozikoro_entity) as kinds,
      (select count(distinct ae.article_id)::int
         from ozikoro_article_entity ae
         join ozikoro_article a on a.id = ae.article_id
        where a.status = 'published' and a.is_page = false) as linked_articles,
      (select count(*)::int from ozikoro_article
        where status = 'published' and is_page = false) as published_articles
  `);
  return {
    entities: Number(row?.entities ?? 0),
    kinds: Number(row?.kinds ?? 0),
    linkedArticles: Number(row?.linked_articles ?? 0),
    publishedArticles: Number(row?.published_articles ?? 0),
  };
}
