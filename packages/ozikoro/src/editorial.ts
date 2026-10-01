/**
 * The editorial desk: turning 1,051 faithfully-migrated but untagged records into a sourced archive.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The migration did exactly what it should: it carried the archive across without inventing
 * anything. The consequence is that every one of the 1,051 records arrived with no source attached,
 * no period, and no link to a clan, a town or a people — because WordPress had no such fields and a
 * script that guessed them from prose would be inventing history.
 *
 * The technical scope names this as human work with software around it: "a re-tagging tool (even a
 * simple internal admin screen) so a human can go through each article and assign it to an ethnic
 * group, sub-group, and layer — this is half data-entry, half software, and doesn't need to be
 * elegant, just functional."
 *
 * So this module is the software half. It does not decide anything about a record; it makes an
 * editor's decision cheap to record, and it refuses to let a decision be recorded without saying
 * who made it.
 *
 * WHY EVERY WRITE GOES THROUGH HERE
 *
 * The plan requires "an audit trail when an editorial status changes" and that historical records
 * are never silently overwritten. Both are properties of the write path, not of the UI: a second
 * caller — an importer, a script, a future API — cannot bypass the audit if the audit is inside the
 * only function that writes.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceType = 'oral_history' | 'colonial_record' | 'academic_source' | 'mixed' | 'unsourced';
export type SourceKind =
  | 'book' | 'journal_article' | 'chapter' | 'thesis' | 'dissertation' | 'preprint' | 'report'
  | 'archive_document' | 'colonial_record' | 'oral_history' | 'interview' | 'newspaper' | 'website'
  | 'dataset' | 'photograph' | 'audio' | 'video' | 'manuscript' | 'catalogue' | 'other';
export type EvidenceType =
  | 'archaeological' | 'primary_source' | 'oral_history' | 'linguistic' | 'anthropological'
  | 'genetic' | 'historical_document' | 'scholarly_interpretation' | 'traditional_account'
  | 'disputed' | 'unverified';
export type EntityRole = 'ethnic_group' | 'clan' | 'town' | 'place' | 'period' | 'person' | 'event' | 'other';
export type EntityKind =
  | 'person' | 'people' | 'community' | 'clan' | 'town' | 'place' | 'historical_place'
  | 'archaeological_site' | 'polity' | 'kingdom' | 'chiefdom' | 'event' | 'period'
  | 'migration' | 'trade_route' | 'conflict' | 'treaty' | 'deity' | 'ritual' | 'festival'
  | 'folklore' | 'oral_tradition' | 'architecture' | 'music' | 'craft' | 'institution'
  | 'language' | 'dialect' | 'object' | 'museum' | 'collection' | 'document' | 'photograph'
  | 'audio' | 'video' | 'manuscript' | 'dataset' | 'publication' | 'topic' | 'other';

const SOURCE_TYPES: SourceType[] = ['oral_history', 'colonial_record', 'academic_source', 'mixed', 'unsourced'];
const SOURCE_KINDS: SourceKind[] = [
  'book', 'journal_article', 'chapter', 'thesis', 'dissertation', 'preprint', 'report',
  'archive_document', 'colonial_record', 'oral_history', 'interview', 'newspaper', 'website',
  'dataset', 'photograph', 'audio', 'video', 'manuscript', 'catalogue', 'other',
];
const EVIDENCE_TYPES: EvidenceType[] = [
  'archaeological', 'primary_source', 'oral_history', 'linguistic', 'anthropological', 'genetic',
  'historical_document', 'scholarly_interpretation', 'traditional_account', 'disputed', 'unverified',
];
const ENTITY_ROLES: EntityRole[] = ['ethnic_group', 'clan', 'town', 'place', 'period', 'person', 'event', 'other'];
const ENTITY_KINDS: EntityKind[] = [
  'person', 'people', 'community', 'clan', 'town', 'place', 'historical_place', 'archaeological_site',
  'polity', 'kingdom', 'chiefdom', 'event', 'period', 'migration', 'trade_route', 'conflict', 'treaty',
  'deity', 'ritual', 'festival', 'folklore', 'oral_tradition', 'architecture', 'music', 'craft',
  'institution', 'language', 'dialect', 'object', 'museum', 'collection', 'document', 'photograph',
  'audio', 'video', 'manuscript', 'dataset', 'publication', 'topic', 'other',
];

export function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as string[]).includes(value);
}
export function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as string[]).includes(value);
}
export function isEntityRole(value: string): value is EntityRole {
  return (ENTITY_ROLES as string[]).includes(value);
}


/**
 * Labels a human reads, kept beside the values so a screen cannot drift from the vocabulary.
 *
 * The source types are worded rather than echoed: "Colonial record" is what an editor calls it, and
 * `colonial_record` is what the database stores. Both are needed and only one belongs on a form.
 */
export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  oral_history: 'Oral history',
  colonial_record: 'Colonial record',
  academic_source: 'Academic source',
  mixed: 'More than one kind',
  unsourced: 'No source',
};

export const ROLE_LABEL_ENTITY: Record<EntityRole, string> = {
  ethnic_group: 'Ethnic group',
  clan: 'Clan',
  town: 'Town',
  place: 'Place',
  period: 'Period',
  person: 'Person',
  event: 'Event',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface QueueItem {
  id: number;
  slug: string;
  url: string;
  title: string;
  topicName: string | null;
  authorName: string | null;
  publishedAt: string | null;
  /** Which of the brief's required facets are still missing. */
  missing: string[];
  /** How many of the four required facets are present, so the queue can be ordered by need. */
  completeness: number;
  sourceCount: number;
  entityCount: number;
}

export interface QueueOptions {
  /** 'all' by default; a specific gap narrows it to the records missing that thing. */
  gap?: 'any' | 'sources' | 'period' | 'entities' | 'source_type' | 'topic';
  limit?: number;
  offset?: number;
  search?: string | null;
}

/**
 * Records that still need editorial work, worst first.
 *
 * "Completeness" counts the five things the design brief requires every article to carry: a series,
 * a source type, a period, an entity relation and at least one source. Ordering by it means the
 * queue opens on the emptiest records rather than on whichever was migrated last, which is the
 * difference between a work list and a list.
 */
export async function listEditorialQueue(db: Db, options: QueueOptions = {}): Promise<QueueItem[]> {
  const params: unknown[] = [];
  const conditions: string[] = [`a.is_page = false`, `a.status <> 'archived'`];

  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`a.title ilike $${params.length}`);
  }

  const gapConditions: Record<string, string> = {
    sources: `not exists (select 1 from ozikoro_article_source s where s.article_id = a.id)`,
    period: `a.period_label is null`,
    source_type: `a.source_type is null`,
    topic: `a.topic_id is null`,
    entities: `not exists (select 1 from ozikoro_article_entity e where e.article_id = a.id)`,
  };
  const gap = options.gap ?? 'any';
  if (gap !== 'any' && gapConditions[gap]) conditions.push(gapConditions[gap]!);

  const limit = Math.min(Math.max(options.limit ?? 30, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select a.id, a.slug, a.title, a.published_at, a.topic_id, a.source_type, a.period_label,
            t.name as topic_name, c.display_name as author_name,
            (select count(*)::int from ozikoro_article_source s where s.article_id = a.id) as source_count,
            (select count(*)::int from ozikoro_article_entity e where e.article_id = a.id) as entity_count
       from ozikoro_article a
       left join ozikoro_topic t on t.id = a.topic_id
       left join ozikoro_contributor c on c.id = a.author_id
      where ${conditions.join(' and ')}
      order by
        ((case when a.topic_id is null then 0 else 1 end)
       + (case when a.source_type is null then 0 else 1 end)
       + (case when a.period_label is null then 0 else 1 end)
       + (case when exists (select 1 from ozikoro_article_source s where s.article_id = a.id) then 1 else 0 end)
       + (case when exists (select 1 from ozikoro_article_entity e where e.article_id = a.id) then 1 else 0 end)) asc,
        a.published_at desc nulls last
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return rows.map((r) => {
    const sourceCount = Number(r.source_count ?? 0);
    const entityCount = Number(r.entity_count ?? 0);
    const missing: string[] = [];
    if (r.topic_id === null || r.topic_id === undefined) missing.push('series');
    if (r.source_type === null) missing.push('source type');
    if (r.period_label === null) missing.push('period');
    if (entityCount === 0) missing.push('clan, town or place');
    if (sourceCount === 0) missing.push('sources');
    return {
      id: Number(r.id),
      slug: String(r.slug),
      url: `/${String(r.slug)}/`,
      title: String(r.title ?? '').trim() || 'Untitled record',
      topicName: r.topic_name ? String(r.topic_name) : null,
      authorName: r.author_name ? String(r.author_name) : null,
      publishedAt: r.published_at ? new Date(String(r.published_at)).toISOString() : null,
      missing,
      completeness: 5 - missing.length,
      sourceCount,
      entityCount,
    };
  });
}

/** How much of the archive still needs work, stated as numbers rather than as a feeling. */
export async function getEditorialProgress(db: Db): Promise<{
  records: number;
  withSeries: number;
  withSourceType: number;
  withPeriod: number;
  withEntities: number;
  withSources: number;
  fullyTagged: number;
  sources: number;
  entities: number;
}> {
  const row = await db.one<Record<string, unknown>>(`
    select
      count(*)::int as records,
      count(*) filter (where a.topic_id is not null)::int as with_series,
      count(*) filter (where a.source_type is not null)::int as with_source_type,
      count(*) filter (where a.period_label is not null)::int as with_period,
      count(*) filter (where exists (select 1 from ozikoro_article_entity e where e.article_id = a.id))::int as with_entities,
      count(*) filter (where exists (select 1 from ozikoro_article_source s where s.article_id = a.id))::int as with_sources,
      count(*) filter (
        where a.topic_id is not null and a.source_type is not null and a.period_label is not null
          and exists (select 1 from ozikoro_article_source s where s.article_id = a.id)
          and exists (select 1 from ozikoro_article_entity e where e.article_id = a.id)
      )::int as fully_tagged,
      (select count(*)::int from ozikoro_source) as sources,
      (select count(*)::int from ozikoro_entity) as entities
    from ozikoro_article a
    where a.is_page = false and a.status <> 'archived'
  `);
  return {
    records: Number(row?.records ?? 0),
    withSeries: Number(row?.with_series ?? 0),
    withSourceType: Number(row?.with_source_type ?? 0),
    withPeriod: Number(row?.with_period ?? 0),
    withEntities: Number(row?.with_entities ?? 0),
    withSources: Number(row?.with_sources ?? 0),
    fullyTagged: Number(row?.fully_tagged ?? 0),
    sources: Number(row?.sources ?? 0),
    entities: Number(row?.entities ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Editing a record's facets
// ---------------------------------------------------------------------------

export interface ArticleFacets {
  id: number;
  slug: string;
  title: string;
  standfirst: string | null;
  topicId: number | null;
  sourceType: SourceType | null;
  periodLabel: string | null;
  periodStart: number | null;
  periodEnd: number | null;
  status: string;
  entities: { id: number; name: string; kind: EntityKind; role: EntityRole }[];
  sources: { id: number; title: string; kind: SourceKind; stance: string; position: number; evidenceType: EvidenceType | null }[];
}

export async function getArticleFacets(db: Db, articleId: number): Promise<ArticleFacets | null> {
  const row = await db.one<Record<string, unknown>>(
    `select id, slug, title, standfirst, topic_id, source_type, period_label, period_start, period_end, status
       from ozikoro_article where id = $1`,
    [articleId]
  );
  if (!row) return null;

  const [entities, sources] = await Promise.all([
    db.rows<Record<string, unknown>>(
      `select e.id, e.name, e.kind, ae.role from ozikoro_article_entity ae
         join ozikoro_entity e on e.id = ae.entity_id where ae.article_id = $1 order by ae.role, e.name`,
      [articleId]
    ),
    db.rows<Record<string, unknown>>(
      `select s.id, s.title, s.kind, s.evidence_type, l.stance, l.position from ozikoro_article_source l
         join ozikoro_source s on s.id = l.source_id where l.article_id = $1 order by l.position, s.title`,
      [articleId]
    ),
  ]);

  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title ?? ''),
    standfirst: row.standfirst ? String(row.standfirst) : null,
    topicId: row.topic_id === null || row.topic_id === undefined ? null : Number(row.topic_id),
    sourceType: row.source_type ? (String(row.source_type) as SourceType) : null,
    periodLabel: row.period_label ? String(row.period_label) : null,
    periodStart: row.period_start === null || row.period_start === undefined ? null : Number(row.period_start),
    periodEnd: row.period_end === null || row.period_end === undefined ? null : Number(row.period_end),
    status: String(row.status),
    entities: entities.map((e) => ({
      id: Number(e.id), name: String(e.name),
      kind: String(e.kind) as EntityKind, role: String(e.role) as EntityRole,
    })),
    sources: sources.map((s) => ({
      id: Number(s.id), title: String(s.title), kind: String(s.kind) as SourceKind,
      stance: String(s.stance), position: Number(s.position ?? 0),
      evidenceType: s.evidence_type ? (String(s.evidence_type) as EvidenceType) : null,
    })),
  };
}

/**
 * Save the facets an editor just decided.
 *
 * The five things the brief requires are validated rather than trusted: `sourceType` must be one of
 * the five, the period must be an ordered range, and the topic must exist. A form is not a schema,
 * and the plan requires input validation on the server.
 */
export async function updateArticleFacets(
  db: Db,
  input: {
    articleId: number;
    topicId?: number | null;
    sourceType?: SourceType | null;
    periodLabel?: string | null;
    periodStart?: number | null;
    periodEnd?: number | null;
    status?: 'draft' | 'review' | 'published' | 'archived';
    actorId: number;
  }
): Promise<void> {
  const before = await getArticleFacets(db, input.articleId);
  if (!before) throw new MemberError('no_article', 'That record does not exist.');

  if (input.sourceType !== undefined && input.sourceType !== null && !SOURCE_TYPES.includes(input.sourceType)) {
    throw new MemberError('bad_source_type', 'That is not one of the source types the archive uses.');
  }
  if (input.topicId !== undefined && input.topicId !== null) {
    const topic = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_topic where id = $1`, [input.topicId]);
    if (Number(topic?.n ?? 0) === 0) throw new MemberError('no_topic', 'That series does not exist.');
  }
  if (input.periodStart != null && input.periodEnd != null && input.periodEnd < input.periodStart) {
    throw new MemberError('bad_period', 'The period ends before it starts.');
  }

  await db.query(
    `update ozikoro_article set
        topic_id = coalesce($2, topic_id),
        source_type = $3,
        period_label = $4,
        period_start = $5,
        period_end = $6,
        status = coalesce($7, status),
        updated_at = now()
      where id = $1`,
    [
      input.articleId,
      input.topicId ?? null,
      input.sourceType ?? null,
      input.periodLabel ?? null,
      input.periodStart ?? null,
      input.periodEnd ?? null,
      input.status ?? null,
    ]
  );

  const after = await getArticleFacets(db, input.articleId);
  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'update_facets',
    before: { sourceType: before.sourceType, periodLabel: before.periodLabel, topicId: before.topicId, status: before.status },
    after: { sourceType: after?.sourceType ?? null, periodLabel: after?.periodLabel ?? null, topicId: after?.topicId ?? null, status: after?.status ?? null },
    actorId: input.actorId,
  });
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** A URL-safe slug that is not already taken, so two entities of the same name can coexist. */
function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base.length > 0 ? base : 'entity';
}

export async function findOrCreateEntity(
  db: Db,
  input: {
    name: string;
    kind: EntityKind;
    /** Optionally linked to the dictionary, which is where clans and towns actually live. */
    clanId?: number | null;
    clanTownId?: number | null;
    languageCode?: string | null;
    actorId: number;
  }
): Promise<number> {
  const name = input.name.trim();
  if (name.length === 0) throw new MemberError('no_name', 'An entity needs a name.');
  if (!isEntityKind(input.kind)) throw new MemberError('bad_kind', 'That is not an entity kind.');

  // Case-insensitive, because "Ohafia" and "ohafia" are the same town and an editor should not
  // create a second row by typing it differently.
  const existing = await db.one<{ id: string }>(
    `select id from ozikoro_entity where kind = $1 and lower(name) = lower($2) limit 1`,
    [input.kind, name]
  );
  if (existing) return Number(existing.id);

  const base = slugify(name);
  let slug = base;
  for (let n = 2; n < 50; n += 1) {
    const taken = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_entity where slug = $1`, [slug]);
    if (Number(taken?.n ?? 0) === 0) break;
    slug = `${base}-${n}`;
  }

  const inserted = await db.one<{ id: string }>(
    `insert into ozikoro_entity (kind, slug, name, clan_id, clan_town_id, language_code)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.kind, slug, name, input.clanId ?? null, input.clanTownId ?? null, input.languageCode ?? null]
  );

  await audit(db, {
    entityType: 'ozikoro_entity',
    entityId: Number(inserted!.id),
    action: 'create',
    after: { name, kind: input.kind, slug },
    actorId: input.actorId,
  });

  return Number(inserted!.id);
}

/** Attach an entity to a record in one of the brief's required roles. */
export async function attachEntity(
  db: Db,
  input: { articleId: number; entityId: number; role: EntityRole; actorId: number }
): Promise<void> {
  if (!isEntityRole(input.role)) throw new MemberError('bad_role', 'That is not one of the archive roles.');
  await db.query(
    `insert into ozikoro_article_entity (article_id, entity_id, role) values ($1, $2, $3)
     on conflict do nothing`,
    [input.articleId, input.entityId, input.role]
  );
  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'attach_entity',
    after: { entityId: input.entityId, role: input.role },
    actorId: input.actorId,
  });
}

export async function detachEntity(
  db: Db,
  input: { articleId: number; entityId: number; role: EntityRole; actorId: number }
): Promise<void> {
  await db.query(`delete from ozikoro_article_entity where article_id = $1 and entity_id = $2 and role = $3`, [
    input.articleId, input.entityId, input.role,
  ]);
  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'detach_entity',
    before: { entityId: input.entityId, role: input.role },
    actorId: input.actorId,
  });
}

/** Entities an editor can pick from, so the common case is a choice rather than free typing. */
export async function searchEntities(
  db: Db,
  query: string,
  options: { kind?: EntityKind | null; limit?: number } = {}
): Promise<{ id: number; name: string; kind: EntityKind; slug: string; linkedToDictionary: boolean }[]> {
  const text = query.trim();
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (text.length > 0) {
    params.push(`%${text}%`);
    conditions.push(`(name ilike $${params.length} or exists (select 1 from unnest(aliases) a where a ilike $${params.length}))`);
  }
  if (options.kind) {
    params.push(options.kind);
    conditions.push(`kind = $${params.length}`);
  }
  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
  params.push(Math.min(Math.max(options.limit ?? 25, 1), 100));

  const rows = await db.rows<Record<string, unknown>>(
    `select id, name, kind, slug, (clan_id is not null or clan_town_id is not null or language_code is not null) as linked
       from ozikoro_entity ${where} order by name limit $${params.length}`,
    params
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    kind: String(r.kind) as EntityKind,
    slug: String(r.slug),
    linkedToDictionary: Boolean(r.linked),
  }));
}

/**
 * Clans and towns from the dictionary, for linking rather than retyping.
 *
 * The build plan is emphatic that Ozituma is the language layer and its records must not be
 * duplicated. The dictionary already holds 228 clans and their towns, so an editor linking a
 * history to Ọ̀nịchạ should be choosing the row that exists, not creating a second one.
 */
export async function searchDictionaryPlaces(
  db: Db,
  query: string,
  limit = 20
): Promise<{ clanId: number; clanName: string; tribe: string | null; states: string[]; towns: string[] }[]> {
  const text = query.trim();
  const params: unknown[] = [];
  let clause = '';
  if (text.length > 0) {
    params.push(`%${text}%`);
    clause = `and (c.name ilike $${params.length} or exists (select 1 from clan_town t where t.clan_id = c.id and t.name ilike $${params.length}))`;
  }
  params.push(Math.min(Math.max(limit, 1), 100));

  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.name, tr.name as tribe, c.states,
            coalesce((select array_agg(t.name order by t.is_head desc, t.name) from clan_town t where t.clan_id = c.id), '{}'::text[]) as towns
       from clan c left join tribe tr on tr.id = c.tribe_id
      where true ${clause}
      order by c.name limit $${params.length}`,
    params
  );
  return rows.map((r) => ({
    clanId: Number(r.id),
    clanName: String(r.name),
    tribe: r.tribe ? String(r.tribe) : null,
    states: Array.isArray(r.states) ? r.states.map(String) : [],
    towns: Array.isArray(r.towns) ? r.towns.map(String) : [],
  }));
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function createSource(
  db: Db,
  input: {
    title: string;
    kind: SourceKind;
    authors?: string[];
    year?: number | null;
    yearNote?: string | null;
    publisher?: string | null;
    journal?: string | null;
    url?: string | null;
    identifier?: string | null;
    archive?: string | null;
    collection?: string | null;
    licence?: string | null;
    rightsNote?: string | null;
    evidenceType?: EvidenceType | null;
    notes?: string | null;
    actorId: number;
  }
): Promise<number> {
  const title = input.title.trim();
  if (title.length === 0) throw new MemberError('no_title', 'A source needs a title.');
  if (!isSourceKind(input.kind)) throw new MemberError('bad_kind', 'That is not a source kind.');
  if (input.evidenceType && !EVIDENCE_TYPES.includes(input.evidenceType)) {
    throw new MemberError('bad_evidence', 'That is not one of the evidence types.');
  }
  if (input.url && !/^https?:\/\//i.test(input.url)) {
    throw new MemberError('bad_url', 'A source link must start with http:// or https://.');
  }

  // A source is identified by its title and year together: the same book cited twice is one row.
  const existing = await db.one<{ id: string }>(
    `select id from ozikoro_source where lower(title) = lower($1) and coalesce(year, -1) = coalesce($2, -1) limit 1`,
    [title, input.year ?? null]
  );
  if (existing) return Number(existing.id);

  const base = slugify(input.year ? `${title} ${input.year}` : title);
  let slug = base;
  for (let n = 2; n < 50; n += 1) {
    const taken = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_source where slug = $1`, [slug]);
    if (Number(taken?.n ?? 0) === 0) break;
    slug = `${base}-${n}`;
  }

  const inserted = await db.one<{ id: string }>(
    `insert into ozikoro_source
       (slug, kind, title, authors, year, year_note, publisher, journal, url, identifier, archive,
        collection, licence, rights_note, evidence_type, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
    [
      slug, input.kind, title,
      input.authors && input.authors.length > 0 ? input.authors : [],
      input.year ?? null, input.yearNote ?? null, input.publisher ?? null, input.journal ?? null,
      input.url ?? null, input.identifier ?? null, input.archive ?? null, input.collection ?? null,
      input.licence ?? null, input.rightsNote ?? null, input.evidenceType ?? null, input.notes ?? null,
    ]
  );

  await audit(db, {
    entityType: 'ozikoro_source',
    entityId: Number(inserted!.id),
    action: 'create',
    after: { title, kind: input.kind, year: input.year ?? null },
    actorId: input.actorId,
  });

  return Number(inserted!.id);
}

/**
 * Attach a source to a record, with the stance it takes.
 *
 * The stance is not decoration. The plan requires that an archive can hold "supporting, contradicting
 * or qualifying evidence" and "competing interpretations", so a citation that can only agree is a
 * citation that cannot represent a debate — which is most of what a historical archive holds.
 */
export async function attachSource(
  db: Db,
  input: { articleId: number; sourceId: number; stance?: 'supports' | 'contradicts' | 'qualifies' | 'context'; position?: number; note?: string | null; actorId: number }
): Promise<void> {
  const stance = input.stance ?? 'supports';
  if (!['supports', 'contradicts', 'qualifies', 'context'].includes(stance)) {
    throw new MemberError('bad_stance', 'That is not a way a source can relate to a record.');
  }
  const next = await db.one<{ n: number }>(
    `select coalesce(max(position) + 1, 0)::int as n from ozikoro_article_source where article_id = $1`,
    [input.articleId]
  );
  await db.query(
    `insert into ozikoro_article_source (article_id, source_id, position, stance, note)
     values ($1, $2, $3, $4, $5)
     on conflict (article_id, source_id) do update set stance = excluded.stance, note = excluded.note`,
    [input.articleId, input.sourceId, input.position ?? Number(next?.n ?? 0), stance, input.note ?? null]
  );
  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'attach_source',
    after: { sourceId: input.sourceId, stance },
    actorId: input.actorId,
  });
}

export async function detachSource(
  db: Db,
  input: { articleId: number; sourceId: number; actorId: number }
): Promise<void> {
  await db.query(`delete from ozikoro_article_source where article_id = $1 and source_id = $2`, [
    input.articleId, input.sourceId,
  ]);
  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'detach_source',
    before: { sourceId: input.sourceId },
    actorId: input.actorId,
  });
}

export async function searchSources(
  db: Db,
  query: string,
  limit = 25
): Promise<{ id: number; title: string; kind: SourceKind; year: number | null; authors: string[]; evidenceType: EvidenceType | null }[]> {
  const text = query.trim();
  const params: unknown[] = [];
  let clause = '';
  if (text.length > 0) {
    params.push(`%${text}%`);
    clause = `where title ilike $${params.length} or exists (select 1 from unnest(authors) a where a ilike $${params.length})`;
  }
  params.push(Math.min(Math.max(limit, 1), 100));

  const rows = await db.rows<Record<string, unknown>>(
    `select id, title, kind, year, authors, evidence_type from ozikoro_source ${clause}
      order by year desc nulls last, title limit $${params.length}`,
    params
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    kind: String(r.kind) as SourceKind,
    year: r.year === null || r.year === undefined ? null : Number(r.year),
    authors: Array.isArray(r.authors) ? r.authors.map(String) : [],
    evidenceType: r.evidence_type ? (String(r.evidence_type) as EvidenceType) : null,
  }));
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function audit(
  db: Db,
  event: {
    entityType: string;
    entityId: number;
    action: string;
    before?: unknown;
    after?: unknown;
    actorId: number | null;
    note?: string | null;
  }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        event.entityType, event.entityId, event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId, event.note ?? null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/editorial] could not record audit event:', String(error).slice(0, 160));
  }
}

/** The audit trail for a record, which is what makes "never silently overwritten" checkable. */
export async function getArticleHistory(
  db: Db,
  articleId: number,
  limit = 50
): Promise<{ action: string; actorEmail: string | null; before: unknown; after: unknown; createdAt: string }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select a.action, a.before, a.after, a.created_at, acc.email as actor_email
       from ozikoro_audit a left join account acc on acc.id = a.actor_id
      where a.entity_type = 'ozikoro_article' and a.entity_id = $1
      order by a.created_at desc limit $2`,
    [articleId, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((r) => ({
    action: String(r.action),
    actorEmail: r.actor_email ? String(r.actor_email) : null,
    before: r.before ?? null,
    after: r.after ?? null,
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}
