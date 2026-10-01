/**
 * Entities: the knowledge graph, and the bridge to the dictionary.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP
 *
 * The build plan is emphatic: "Ozituma is the language layer. Do not duplicate its dictionary inside
 * Ozikoro." A clan is already recorded in `clan`, with its tribe, its present-day states and its
 * towns. An `ozikoro_entity` of kind `clan` does not restate any of that — it holds a foreign key to
 * the dictionary's row and contributes only what the archive adds: the historical relations, the
 * articles that mention it, the coordinates, and the chronology.
 *
 * So this module reads ACROSS the two, which is what makes the three sites one platform rather than
 * three databases sharing a server. A reader on a clan page gets the archive's histories and the
 * dictionary's spelling of the name and its towns, from one query path.
 *
 * WHY THE PAGE IS WORTH BUILDING BEFORE THE GRAPH IS FULL
 *
 * Search promises `/entities/<slug>/` for every entity it returns, and the plan requires canonical
 * entity pages. The graph is empty today because attaching an article to a clan is a human editorial
 * decision — the schema deliberately does not guess one from prose. But the destination has to exist
 * and be correct before the work that fills it, or the first editor to link a record creates a 404.
 */
import type { Db } from '@ozituma/db/client';
import { slugVariants } from './archive.ts';

export interface EntityDictionaryLink {
  /** The dictionary's own record, when this entity is one. */
  kind: 'clan' | 'clan_town' | 'language';
  id: number | string;
  label: string;
  /** Present for a clan: the grouping above it. */
  tribe: string | null;
  /** The present-day states, which the dictionary holds because the colonial divisions are history. */
  states: string[];
  lgas: string[];
  /** A clan's towns, as the sources enumerate them. */
  towns: string[];
  /** The dictionary's own page for it. */
  url: string;
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
          `select c.id, c.name, c.ethnic_group, c.states, c.lgas, t.name as tribe,
                  coalesce((select array_agg(ct.name order by ct.is_head desc, ct.name) from clan_town ct where ct.clan_id = c.id), '{}'::text[]) as towns
             from clan c left join tribe t on t.id = c.tribe_id where c.id = $1`,
          [clanId]
        )
      : Promise.resolve(null),
    townId
      ? db.one<Record<string, unknown>>(`select id, name, clan_id from clan_town where id = $1`, [townId])
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
    links.push({
      kind: 'clan',
      id: Number(clan.id),
      label: String(clan.name),
      tribe: clan.tribe ? String(clan.tribe) : null,
      states: Array.isArray(clan.states) ? clan.states.map(String) : [],
      lgas: Array.isArray(clan.lgas) ? clan.lgas.map(String) : [],
      towns: Array.isArray(clan.towns) ? clan.towns.map(String) : [],
      // The dictionary's own page, so the reader can cross to it rather than the archive restating it.
      url: `https://ozituma.com/clans/${String(clan.id)}`,
    });
  }
  if (town) {
    links.push({
      kind: 'clan_town', id: Number(town.id), label: String(town.name),
      tribe: null, states: [], lgas: [], towns: [],
      url: `https://ozituma.com/clans/${String(town.clan_id)}`,
    });
  }
  if (language) {
    links.push({
      kind: 'language', id: String(language.code),
      label: `${String(language.name)} (${String(language.native_name)})`,
      tribe: null, states: [], lgas: [], towns: [],
      url: `https://ozituma.com/languages/${String(language.code)}`,
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

/** Entities by kind, for an index that is honest about how sparse the graph still is. */
export async function listEntities(
  db: Db,
  options: { kind?: string | null; limit?: number; offset?: number } = {}
): Promise<{ id: number; kind: string; slug: string; name: string; summary: string | null; articleCount: number }[]> {
  const params: unknown[] = [];
  let clause = '';
  if (options.kind) {
    params.push(options.kind);
    clause = `and e.kind = $${params.length}`;
  }
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 200);
  params.push(limit, Math.max(options.offset ?? 0, 0));

  const rows = await db.rows<Record<string, unknown>>(
    `select e.id, e.kind, e.slug, e.name, e.summary,
            (select count(*)::int from ozikoro_article_entity ae
               join ozikoro_article a on a.id = ae.article_id
              where ae.entity_id = e.id and a.status = 'published' and a.is_page = false) as article_count
       from ozikoro_entity e
      where true ${clause}
      order by article_count desc, e.name
      limit $${params.length - 1} offset $${params.length}`,
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

/** How much of the graph exists, so a page can say so rather than implying it is complete. */
export async function getEntityStats(db: Db): Promise<{ entities: number; kinds: number; linkedArticles: number }> {
  const row = await db.one<Record<string, unknown>>(`
    select
      (select count(*)::int from ozikoro_entity) as entities,
      (select count(distinct kind)::int from ozikoro_entity) as kinds,
      (select count(distinct article_id)::int from ozikoro_article_entity) as linked_articles
  `);
  return {
    entities: Number(row?.entities ?? 0),
    kinds: Number(row?.kinds ?? 0),
    linkedArticles: Number(row?.linked_articles ?? 0),
  };
}
