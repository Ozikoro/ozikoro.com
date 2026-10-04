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
/*
 * The sanitiser, imported rather than re-implemented, for the same reason `media.ts` imports `mediaPath`:
 * a second copy of an allowlist is a second allowlist, and the one that is not updated is the one that lets
 * something through. See `updateArticleContent` for where this is applied and why there as well as on read.
 */
import { sanitiseArchiveHtml, wordCount } from './content.ts';

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
// The review queue — records waiting on a decision, not on typing
// ---------------------------------------------------------------------------

/**
 * WHY THIS IS SEPARATE FROM `listEditorialQueue`
 *
 * The editorial queue answers *"which records are worst documented?"* and deliberately mixes every status
 * except `archived`, because a record with no source needs work whether or not it is live. **A record in
 * `review` is waiting on a different question — someone has to decide whether it may be published at all** —
 * and mixing the two produced the fault this list exists to fix: a review queue that read
 * `ozikoro_publication` (an empty table) while the archive's own records sat in `review`, showing
 * *"Waiting (0)"* next to a real backlog.
 *
 * The state is the archive's own. `updateArticleFacets` accepts `draft | review | published | archived`, and
 * `review` is what the archive uses for "the work exists and the verdict has not been given".
 */
export interface ReviewArticle {
  id: number;
  slug: string;
  /** The public address, which exists whether or not the record is currently published. */
  url: string;
  title: string;
  authorName: string | null;
  topicName: string | null;
  wordCount: number | null;
  standfirst: string | null;
  /** 'Last changed' from WordPress; the closest thing the import carries to a submission date. */
  lastChangedAt: string | null;
  /** When this site imported the record. */
  importedAt: string | null;
  /**
   * WHEN THE RECORD ENTERED REVIEW, FROM THE AUDIT TRAIL — or null.
   *
   * The article table has no `submitted_at`, so the honest answer for a record put into review through the
   * editorial desk is the `update_facets` audit row whose `after` carries `status: review`. **Where no such
   * row exists the screen says the time is not recorded** rather than printing the WordPress modified date
   * and calling it a submission — the two are different facts and only one of them answers "how long has
   * this been waiting?".
   */
  inReviewSince: string | null;
}

export interface ReviewQueueOptions {
  search?: string | null;
  limit?: number;
  offset?: number;
}

/** How many records the archive holds in each state, so a count can be stated rather than guessed. */
export async function getArticleStatusCounts(db: Db): Promise<{
  total: number;
  published: number;
  review: number;
  draft: number;
  archived: number;
  pages: number;
}> {
  const row = await db.one<Record<string, unknown>>(`
    select count(*)::int as total,
           count(*) filter (where status = 'published' and is_page = false)::int as published,
           count(*) filter (where status = 'review' and is_page = false)::int as review,
           count(*) filter (where status = 'draft' and is_page = false)::int as draft,
           count(*) filter (where status = 'archived' and is_page = false)::int as archived,
           count(*) filter (where is_page = true)::int as pages
      from ozikoro_article
  `);
  return {
    total: Number(row?.total ?? 0),
    published: Number(row?.published ?? 0),
    review: Number(row?.review ?? 0),
    draft: Number(row?.draft ?? 0),
    archived: Number(row?.archived ?? 0),
    pages: Number(row?.pages ?? 0),
  };
}

/**
 * The records in `review`, oldest submission first.
 *
 * Oldest first for the same reason the editorial queue orders by need: **the person who has waited longest
 * is the one to look at.** A record with no audit row has no knowable waiting time and sorts by the import
 * date, which is the earliest date that is true of it.
 */
export async function listArticlesInReview(
  db: Db,
  options: ReviewQueueOptions = {}
): Promise<{ total: number; articles: ReviewArticle[] }> {
  const params: unknown[] = [];
  const conditions: string[] = [`a.status = 'review'`, `a.is_page = false`];

  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(`(a.title ilike $${params.length} or a.slug ilike $${params.length})`);
  }
  const where = `where ${conditions.join(' and ')}`;

  const totalRow = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_article a ${where}`,
    params
  );

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select a.id, a.slug, a.title, a.standfirst, a.word_count, a.modified_at, a.created_at,
            t.name as topic_name, c.display_name as author_name,
            (select max(au.created_at) from ozikoro_audit au
              where au.entity_type = 'ozikoro_article' and au.entity_id = a.id
                and au.after ->> 'status' = 'review') as in_review_since
       from ozikoro_article a
       left join ozikoro_topic t on t.id = a.topic_id
       left join ozikoro_contributor c on c.id = a.author_id
       ${where}
      order by coalesce(
                 (select max(au.created_at) from ozikoro_audit au
                   where au.entity_type = 'ozikoro_article' and au.entity_id = a.id
                     and au.after ->> 'status' = 'review'),
                 a.created_at
               ) asc,
               a.id asc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return {
    total: Number(totalRow?.n ?? 0),
    articles: rows.map((r) => ({
      id: Number(r.id),
      slug: String(r.slug),
      url: `/${String(r.slug)}/`,
      title: String(r.title ?? '').trim() || 'Untitled record',
      authorName: r.author_name ? String(r.author_name) : null,
      topicName: r.topic_name ? String(r.topic_name) : null,
      wordCount: r.word_count === null || r.word_count === undefined ? null : Number(r.word_count),
      standfirst: r.standfirst ? String(r.standfirst) : null,
      lastChangedAt: r.modified_at ? new Date(String(r.modified_at)).toISOString() : null,
      importedAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
      inReviewSince: r.in_review_since ? new Date(String(r.in_review_since)).toISOString() : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Article claims — the `ozikoro_claim` register
// ---------------------------------------------------------------------------

/**
 * `ozikoro_claim` IS NOT THE AUTHORSHIP CLAIM QUEUE.
 *
 * There are two tables and the names invite the confusion:
 *
 *   `ozikoro_claim`             a statement an article makes — the claim, the anchor it sits under, and
 *                               whether an editor has accepted it. Its subject is a *record's assertion*.
 *   `ozikoro_contributor_claim` a person asking to be recognised as the author of a byline. Its subject is
 *                               a *person*.
 *
 * **A screen that showed one and called it the other would be reporting an empty table as a fact about
 * authorship.** Both are shown on `/admin/claims`, each named for what it holds, so the zero is legible.
 */
export interface ArticleClaim {
  id: number;
  articleId: number;
  articleSlug: string | null;
  articleTitle: string | null;
  entityId: number | null;
  entityName: string | null;
  statement: string | null;
  anchor: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function listArticleClaims(
  db: Db,
  options: { status?: string | null; limit?: number; offset?: number } = {}
): Promise<{ total: number; claims: ArticleClaim[] }> {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`c.status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';

  const totalRow = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_claim c ${where}`, params);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select c.id, c.article_id, c.entity_id, c.statement, c.anchor, c.status, c.created_at, c.updated_at,
            a.slug as article_slug, a.title as article_title, e.name as entity_name
       from ozikoro_claim c
       left join ozikoro_article a on a.id = c.article_id
       left join ozikoro_entity e on e.id = c.entity_id
       ${where}
      order by c.created_at desc, c.id desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return {
    total: Number(totalRow?.n ?? 0),
    claims: rows.map((r) => ({
      id: Number(r.id),
      articleId: Number(r.article_id),
      articleSlug: r.article_slug ? String(r.article_slug) : null,
      articleTitle: r.article_title ? String(r.article_title) : null,
      entityId: r.entity_id === null || r.entity_id === undefined ? null : Number(r.entity_id),
      entityName: r.entity_name ? String(r.entity_name) : null,
      statement: r.statement ? String(r.statement) : null,
      anchor: r.anchor ? String(r.anchor) : null,
      status: String(r.status),
      createdAt: new Date(String(r.created_at)).toISOString(),
      updatedAt: new Date(String(r.updated_at)).toISOString(),
    })),
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
 *
 * ── AND IT NO LONGER MOVES THE RECORD'S STATUS, WHICH IS THE POINT OF ITS OWN SHAPE ─────────────────
 *
 * This function used to take a `status` and write it, so **publishing was a side effect of editing a
 * period**: one press could change the series AND put an unsigned draft in front of readers, and the audit
 * row for both said `update_facets`. The parameter is GONE rather than merely left unused, so a caller
 * cannot pass one and the compiler names every place that used to try — the same reasoning migration 0044
 * uses for stating the owner's capabilities as a list rather than a wildcard. A publication decision is
 * `decideArticleStatus`, which has its own transition table, its own refusals and its own audit action.
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
        updated_at = now()
      where id = $1`,
    [
      input.articleId,
      input.topicId ?? null,
      input.sourceType ?? null,
      input.periodLabel ?? null,
      input.periodStart ?? null,
      input.periodEnd ?? null,
    ]
  );

  const after = await getArticleFacets(db, input.articleId);
  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'update_facets',
    before: { sourceType: before.sourceType, periodLabel: before.periodLabel, topicId: before.topicId },
    after: { sourceType: after?.sourceType ?? null, periodLabel: after?.periodLabel ?? null, topicId: after?.topicId ?? null },
    actorId: input.actorId,
  });
}

// ---------------------------------------------------------------------------
// The record's own words — title, summary and body
// ---------------------------------------------------------------------------

/**
 * The largest body this archive accepts from a person, in characters.
 *
 * 400,000, and the number is not a guess: it is the ceiling the WordPress revision backfill already applies
 * (`--max-body-bytes`, default 400,000) after measuring that the largest revision body in the dump is about
 * 237 KB. A limit larger than anything the archive has ever held would not be a limit; a smaller one would
 * refuse a record the archive already carries. **The same ceiling in both write paths is the point** — a
 * body the importer accepted must not be one an editor cannot save.
 */
export const MAX_ARTICLE_BODY = 400_000;

/** The title ceiling. `ozikoro_article.title` is `text`, so this is a judgement and is stated as one. */
const MAX_TITLE = 300;

export interface ArticleContent {
  id: number;
  slug: string;
  title: string;
  standfirst: string | null;
  /** The stored body, VERBATIM. This is what the archive holds, not what a reader is shown. */
  bodyHtml: string;
  status: string;
  wordCount: number;
}

/**
 * One record's editable text, read for the editor's form.
 *
 * Deliberately a different read from `getArticleFacets`, which answers "what has been decided about this
 * record". This answers "what does it say", and the two are separate forms on the same screen because they
 * are separate decisions made at different moments.
 *
 * **THE BODY IS RETURNED AS STORED, NOT AS RENDERED.** A form that showed the sanitised body would silently
 * save the sanitiser's output back over the record the first time an editor pressed Save on a form they had
 * not touched — turning a read-time transformation into a write. The page renders the sanitised body
 * separately, as a preview.
 */
export async function getArticleContent(db: Db, articleId: number): Promise<ArticleContent | null> {
  const row = await db.one<Record<string, unknown>>(
    `select id, slug, title, standfirst, body_html, status, word_count
       from ozikoro_article where id = $1`,
    [articleId]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title ?? ''),
    standfirst: row.standfirst ? String(row.standfirst) : null,
    bodyHtml: String(row.body_html ?? ''),
    status: String(row.status),
    wordCount: Number(row.word_count ?? 0),
  };
}

/**
 * THE WORDS, COUNTED IN SQL, SO A REVISION'S COUNT AND THE COLUMN CANNOT DISAGREE.
 *
 * The count is taken from each body inside the one statement that writes both, rather than computed in
 * TypeScript from a value read a moment earlier. **A read-then-write count is a number that can describe a
 * body the row no longer holds**, and the column exists precisely so a list can show how much text a
 * revision carries without loading it.
 */
function wordsOf(expression: string): string {
  const text = `trim(regexp_replace(coalesce(${expression}, ''), '<[^>]*>', ' ', 'g'))`;
  return `case when ${text} = '' then 0 else array_length(regexp_split_to_array(${text}, '\\s+'), 1) end`;
}

/**
 * Save a record's title, summary and body — the first write path into the words themselves.
 *
 * WHY THIS FUNCTION EXISTS AT ALL
 *
 * Until now the archive could edit what a record was *about* — its facets, its entities, its sources — and
 * not what it *said*. `ozikoro_article.body_html` was import-only, and the record's own title and summary had
 * no write path from the site. A record with a mangled body, or a summary that is a truncated window of the
 * body rather than a summary, could be read and not corrected.
 *
 * WHAT IT GUARANTEES, IN ORDER OF IMPORTANCE
 *
 * 1. **THE PREVIOUS TEXT IS KEPT BEFORE THE NEW TEXT IS WRITTEN.** The revision and the update are one
 *    statement, so there is no instant in which the record has been changed and the thing it replaced has
 *    not been recorded. The brief asks for "a revision before the change, not after" and the failure it
 *    names is a half-written body: **one statement has no half.** If it fails, the old record stands and no
 *    revision exists — which is the truthful outcome, because nothing happened. A revision written for a
 *    change that was never applied would be the archive lying about its own history.
 *
 *    The statement's own `before` CTE reads the row through the statement's snapshot, so it copies the OLD
 *    values even though the update sits beside it. That is what makes the order a property of the language
 *    rather than of the sequence of statements a caller happens to write.
 *
 * 2. **THE ACTOR IS NAMED.** `ozikoro_article_revision.actor_id` and `ozikoro_audit.actor_id` both carry the
 *    account. An edit with no actor is refused before anything is written: `actorId` is a required argument
 *    and there is no branch that omits it, because a human edit is a decision by a person.
 *
 * 3. **THE STORED BODY IS SANITISED.** See `updateArticleContent`'s note on the sanitiser below. The
 *    *revision* keeps the old body verbatim, so nothing that was published is lost by this.
 *
 * 4. **A PAGE IS NOT A RECORD.** `is_page = true` rows are published WordPress pages, not histories, and the
 *    editorial screen has never listed them. This function refuses them by count rather than trusting the
 *    caller's id, so a form posted at a page's id changes nothing.
 */
export async function updateArticleContent(
  db: Db,
  input: {
    articleId: number;
    title: string;
    standfirst: string | null;
    bodyHtml: string;
    note?: string | null;
    actorId: number;
  }
): Promise<{ revisionId: number; wordCount: number; sanitised: boolean }> {
  const title = input.title.trim();
  if (title.length === 0) throw new MemberError('no_title', 'A record needs a title. It is what a citation names.');
  if (title.length > MAX_TITLE) {
    throw new MemberError('title_too_long', `A title of ${title.length} characters is longer than this archive accepts (${MAX_TITLE}).`);
  }
  if (input.bodyHtml.length > MAX_ARTICLE_BODY) {
    throw new MemberError(
      'body_too_long',
      `That body is ${input.bodyHtml.length.toLocaleString('en-GB')} characters and the archive accepts ` +
        `${MAX_ARTICLE_BODY.toLocaleString('en-GB')}. Nothing was changed.`
    );
  }
  if (!Number.isInteger(input.actorId) || input.actorId <= 0) {
    throw new MemberError('no_actor', 'An edit must name the account that made it.');
  }

  /*
   * SANITISED ON WRITE, AND ON READ AS WELL — TWO GUARDS FOR TWO DIFFERENT JOBS.
   *
   * The archive's rule is that a body is kept verbatim and sanitised when rendered (0035, and 0053 for the
   * revisions). **That rule was written for the import**, where the bytes are the evidence of what WordPress
   * published and rewriting them would destroy the evidence. A person typing a body today is not evidence of
   * a historical publication: they are writing the record now, and what they meant to publish is the
   * sanitised form. So the sanitiser runs here, and the *revision* takes the previous body untouched — no
   * published text is lost by this, because the previous text is what the revision holds.
   *
   * The read path's own sanitiser is not made redundant by this. 1,051 imported bodies were stored verbatim
   * and were never near this function, so **read is the only guard those records have** — and the served
   * article route was measured this round to be missing it. Both run; neither is trusted alone.
   *
   * A `<script>` pasted into the form does not reach the row. `sanitiseArchiveHtml` drops `script`, `style`,
   * `iframe`, `object`, `embed`, `form` and their contents outright, drops every `on*` attribute, and refuses
   * `javascript:` and `data:` URLs — so what is stored is what a reader may safely be shown, and the caller is
   * told the text was altered rather than being left to discover it.
   *
   * ── AND THE SANITISER IS TOLD NOT TO REWRITE ADDRESSES, WHICH IS A BUG FIX RATHER THAN A PREFERENCE ──
   *
   * `sanitiseArchiveHtml` also does a FIDELITY job: an internal host is rewritten to a relative path, so
   * `https://ozikoro.com/wp-content/uploads/x.jpg` becomes `/wp-content/uploads/x.jpg`. On the READ path that
   * happens AFTER `rewriteBodyImages` has already resolved the address to `/media/<key>`, so the rewrite has
   * nothing left to do.
   *
   * On the WRITE path there is no resolver, and the rewrite is actively destructive. **Measured, on record 1,
   * by saving its own body back unchanged and diffing the served page:** the stored address became
   * `/wp-content/uploads/2026/09/ute-king.webp`, `rewriteBodyImages` could no longer match it — its map is
   * keyed by the full `source_url` — so the image 404'd **and** `tidyBody`'s de-duplication stopped recognising
   * it as the featured image, so the reader met the same photograph twice. A page that grew an image and lost
   * its resolution is not a sanitising question; it is the write path doing the read path's job with the wrong
   * tools.
   *
   * `internalHosts: []` turns that one behaviour off and leaves every safety rule on. **The write path's job
   * is to make the text safe; resolving where a file now lives is the read path's job, and it has the
   * media table to do it with.**
   */
  const sanitisedBody = sanitiseArchiveHtml(input.bodyHtml, { internalHosts: [] });
  const standfirst = input.standfirst === null ? null : input.standfirst.trim() || null;

  const row = await db.one<Record<string, unknown>>(
    `with target as (
       select id, title, standfirst, body_html
         from ozikoro_article where id = $1 and is_page = false
     ), rev as (
       insert into ozikoro_article_revision
         (article_id, title, standfirst, body_html, revised_at, word_count, actor_id, note, carries_unique_text)
       select t.id, t.title, t.standfirst, t.body_html, now(), ${wordsOf('t.body_html')}, $5, $6, false
         from target t
       returning id
     ), upd as (
       update ozikoro_article
          set title = $2,
              standfirst = $3,
              body_html = $4,
              word_count = ${wordsOf('$4')},
              updated_at = now()
        where id = (select id from target)
       returning id, word_count
     )
     select (select id from rev) as revision_id,
            (select id from upd) as updated_id,
            (select word_count from upd) as word_count,
            (select title from target) as before_title,
            (select standfirst from target) as before_standfirst`,
    [input.articleId, title, standfirst, sanitisedBody, input.actorId, input.note ?? null]
  );

  /*
   * NOTHING WAS WRITTEN IS THE ONLY OTHER POSSIBLE ANSWER, AND IT IS SAID PLAINLY.
   *
   * `updated_id` is null when the target matched no row — either the record does not exist or it is a page.
   * `target` already excludes pages, so **neither the revision nor the update happened for a page**: the two
   * CTEs read the same filtered set, which is what stops a refused write from leaving a revision behind.
   * The refusal distinguishes the two cases, because "that is a page, not a history" is something the editor
   * can act on and "no such record" is not.
   */
  const updatedId = row?.updated_id === null || row?.updated_id === undefined ? null : Number(row.updated_id);
  if (updatedId === null) {
    const page = await db.one<{ is_page: boolean }>(`select is_page from ozikoro_article where id = $1`, [input.articleId]);
    if (page?.is_page) throw new MemberError('is_page', 'That is a published page, not an archive record. Pages are served from their own document and are not edited here.');
    throw new MemberError('no_article', 'That record does not exist.');
  }
  const revisionId = Number(row?.revision_id);
  const newWordCount = Number(row?.word_count ?? wordCount(sanitisedBody));

  /*
   * WHAT THE AUDIT HOLDS, AND WHY IT DOES NOT HOLD THE BODY.
   *
   * The audit answers "who changed this, and when" and the revision answers "what did it say before". Putting
   * a megabyte of superseded prose into `before`/`after` would duplicate the revision table inside the audit
   * table and make `/admin/audit/`, which lists rows, carry documents. So the audit carries the title and the
   * summary as they were and as they now are — the two fields a list can show — plus the sizes and the
   * revision's id, which is the pointer to the text.
   *
   * **THE BEFORE VALUES COME OUT OF THE WRITE STATEMENT, NOT FROM A QUERY AFTER IT.** A read issued once the
   * update had committed would return the new title and the audit would report a change from a value to
   * itself. The write statement is the only place that has both states in hand, so it returns them.
   */
  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: 'update_content',
    before: { title: row?.before_title ?? null, standfirst: row?.before_standfirst ?? null },
    after: {
      title,
      standfirst,
      revisionId,
      bodyBytes: sanitisedBody.length,
      wordCount: newWordCount,
      // Stated in the row rather than left for a reader to infer from a byte count.
      sanitised: sanitisedBody !== input.bodyHtml,
    },
    actorId: input.actorId,
    note: input.note ?? null,
  });

  return { revisionId, wordCount: newWordCount, sanitised: sanitisedBody !== input.bodyHtml };
}

// ---------------------------------------------------------------------------
// The review decision — approving an article, and the three decisions that are not
// ---------------------------------------------------------------------------

export type ArticleDecision = 'submit' | 'approve' | 'send_back' | 'unpublish' | 'retire';

/** What each decision is called on a screen and in an audit row. */
export const ARTICLE_DECISION_LABEL: Record<ArticleDecision, string> = {
  submit: 'Send for review',
  approve: 'Approve and publish',
  send_back: 'Send back to draft',
  unpublish: 'Unpublish — return to draft',
  retire: 'Retire from the archive',
};

/**
 * THE TRANSITIONS.
 *
 * The design's publishing workflow draws six states — Draft, Submitted, Review, Revision, Approved,
 * Published — and this table stores four plus the bin: `draft`, `review`, `published`, `archived`,
 * `trashed`. The mapping is stated rather than assumed: `draft` is Draft, `review` is
 * Submitted/Review/Revision, `published` is Approved+Published (the archive publishes on approval — there is
 * no separate approved-but-not-live state, and inventing one would put a record in a state no screen or route
 * understands), `archived` is retired from the live archive, and `trashed` is in the bin.
 *
 * **AN EDITOR MAY UNPUBLISH, AND THIS TABLE NOW SAYS SO.** That is the owner's latest instruction —
 * *"an editor can approve every content, write any content, unpublish any content"* — and it reversed the
 * decision this table carried an hour earlier, when an editor edited and approved and nothing more. The
 * `unpublish` decision is what changed, and it is a decision rather than the absence of one because the
 * consequences are different: **approving puts a live address in front of readers and `unpublish` takes it
 * away.** `/[slug]/` answers 404 for a record that is not `published`, so this is the act that breaks a
 * shared link — permitted, and recorded, and refused nothing, because the owner has said whose it is.
 *
 * `trashed` is deliberately in no `from` list: a record in the bin is recovered, not decided, and
 * `restoreArticle` puts it back in the state it came from. **Deciding a trashed record's status instead of
 * restoring it would make the bin a second way to publish something nobody looked at.**
 */
const DECISION_TRANSITIONS: Record<ArticleDecision, { from: string[]; to: string; needsPublish: boolean }> = {
  submit: { from: ['draft'], to: 'review', needsPublish: false },
  approve: { from: ['draft', 'review', 'archived'], to: 'published', needsPublish: true },
  send_back: { from: ['review'], to: 'draft', needsPublish: false },
  unpublish: { from: ['published'], to: 'draft', needsPublish: true },
  retire: { from: ['draft', 'review', 'published'], to: 'archived', needsPublish: true },
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', review: 'In review', published: 'Published', archived: 'Archived', trashed: 'In the trash',
};

/** Which decisions this record can take right now, so a screen offers only what would be accepted. */
export function decisionsAvailable(status: string): ArticleDecision[] {
  return (Object.keys(DECISION_TRANSITIONS) as ArticleDecision[]).filter((decision) =>
    DECISION_TRANSITIONS[decision].from.includes(status)
  );
}

/** What a decision did, so a route can say it rather than implying it. */
export interface ArticleDecisionResult {
  from: string;
  to: string;
  decision: ArticleDecision;
  /**
   * True when the person approving is the person whose revision the record currently carries.
   *
   * ALLOWED AND LABELLED, NOT FORBIDDEN. See `decideArticleStatus` for why a second-actor rule is not
   * enforced here, and why the fact is recorded instead.
   */
  selfApproved: boolean;
  publishedAt: string | null;
}

/**
 * APPROVE, SEND BACK, SUBMIT OR RETIRE — an article's publication state, as a decision by a named person.
 *
 * WHY THIS IS A FUNCTION AND NOT A FIELD ON THE FACETS FORM
 *
 * The record's status used to be one more `<select>` in the facets form, saved along with the source type and
 * the period, through `updateArticleFacets`. That made publishing a side effect of filling in a form: an
 * editor changing a period could move a draft to `published` in the same press, and **the audit row said
 * `update_facets` — the same action name as a change of series.** The owner has now said the approval is the
 * editor's central act, so it gets its own transition table, its own refusals, its own audit action and its
 * own control. `updateArticleFacets` refuses a status change for that reason; see its note.
 *
 * WHAT IS ENFORCED, AND WHAT IS ONLY RECORDED
 *
 * Enforced: the record exists and is not a page; the transition is one this table allows; a `publish`
 * decision carries the `publish` capability; and the actor is a real account id. Everything else is refused
 * with a `MemberError` the editor can act on, and **a refused decision writes nothing at all** — not even an
 * audit row, because a row saying a decision was attempted would be indistinguishable in the trail from one
 * saying it was made.
 *
 * RECORDED, NOT ENFORCED: **an editor may approve their own edit.** There is no separation of duties here and
 * this is a decision, not an oversight:
 *
 *   * the schema holds no "submitted by" on `ozikoro_article`, so a second-actor rule would have to be
 *     reconstructed from the newest human revision — which is a rule built on a field that a record with no
 *     human revision does not have, so the FIRST approve of every migrated record would be unrestrained
 *     anyway;
 *   * the archive holds ONE account today, and migration 0046 already settled what a rule like this does to
 *     it: *"admin must never be locked out of a decision"*. **A two-person rule over a one-person archive is
 *     not a safeguard; it is the feature not working**, and its practical effect would be that nothing could
 *     ever be published;
 *   * so the fact is LABELLED instead. `selfApproved` is computed from the newest human revision's actor and
 *     written into the audit row and the visible note, which is the same answer `mayApprovePronunciation`
 *     reached for the same problem: *"the owner checked his own work" is a fact the audit trail can carry.*
 *     **An approval whose provenance is indistinguishable from an independent review is what this flag
 *     exists to prevent.**
 *
 * A PUBLISHED RECORD GETS ITS DATE HERE, AND NOWHERE ELSE
 *
 * `published_at` was never set by any write path — the migration filled it and `updateArticleFacets` did not
 * — so a record published from this archive would have been live with a null publication date, sorted last in
 * every list and printing nothing where the design prints "Published". The approval sets it, once, with
 * `coalesce` so re-approving a record does not move its publication date.
 */
export async function decideArticleStatus(
  db: Db,
  input: {
    articleId: number;
    decision: ArticleDecision;
    note?: string | null;
    actorId: number;
    /** The caller's capability set, resolved by the guard. The rule is checked HERE as well as there. */
    capabilities: Set<string>;
  }
): Promise<ArticleDecisionResult> {
  const transition = DECISION_TRANSITIONS[input.decision];
  if (!transition) {
    throw new MemberError('bad_decision', 'That is not a decision this archive records.');
  }
  if (!Number.isInteger(input.actorId) || input.actorId <= 0) {
    throw new MemberError('no_actor', 'A decision must name the account that made it.');
  }
  if (transition.needsPublish && !input.capabilities.has('publish')) {
    throw new MemberError(
      'forbidden',
      'Approving an article publishes it to readers, which needs the “publish” permission. That one is not yours.'
    );
  }

  const current = await db.one<{ status: string; published_at: Date | null; is_page: boolean }>(
    `select status, published_at, is_page from ozikoro_article where id = $1`,
    [input.articleId]
  );
  if (!current) throw new MemberError('no_article', 'That record does not exist.');
  if (current.is_page) {
    throw new MemberError('is_page', 'That is a published page, not an archive record. Pages are not decided here.');
  }

  const from = String(current.status);
  /*
   * A TRANSITION THE TABLE DOES NOT ALLOW IS REFUSED BY NAME, AND THE REFUSAL SAYS WHAT WOULD BE ACCEPTED.
   * A disabled button teaches nothing; a sentence naming the states a decision applies to is something the
   * editor can act on.
   */
  if (!transition.from.includes(from)) {
    throw new MemberError(
      'bad_transition',
      `“${ARTICLE_DECISION_LABEL[input.decision]}” is not available to a record that is ${STATUS_LABEL[from] ?? from}. ` +
        `It applies to ${transition.from.map((s) => STATUS_LABEL[s] ?? s).join(' or ')}.`
    );
  }

  /*
   * WHO LAST CHANGED THIS RECORD'S WORDS, SO THE APPROVAL CAN SAY WHETHER IT IS THE APPROVER'S OWN.
   *
   * The newest HUMAN revision only — `wp_revision_id is null` — because an imported revision's `actor_id` is
   * null by construction and asking "did the importer approve this" is not a question. Null when the record
   * has no human revision, which is the honest answer for the 1,051 migrated records and is not the same as
   * "somebody else changed it".
   */
  const lastEditor = await db.one<{ actor_id: number | null; email: string | null }>(
    `select r.actor_id, a.email
       from ozikoro_article_revision r
       left join account a on a.id = r.actor_id
      where r.article_id = $1 and r.wp_revision_id is null
      order by r.created_at desc, r.id desc
      limit 1`,
    [input.articleId]
  );
  const selfApproved = lastEditor?.actor_id !== null && lastEditor?.actor_id !== undefined
    && Number(lastEditor.actor_id) === input.actorId;

  const updated = await db.one<{ published_at: Date | null }>(
    `update ozikoro_article
        set status = $2,
            published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end,
            updated_at = now()
      where id = $1 and is_page = false
      returning published_at`,
    [input.articleId, transition.to]
  );

  /*
   * THE AUDIT ROW, WHICH IS THE WHOLE POINT OF APPROVING BEING A DECISION.
   *
   * Its action names the decision (`approve_article`, not `update_facets`), so `/admin/audit/` reads as a
   * list of decisions rather than a list of forms. The note carries the two facts a reader of the trail needs
   * and cannot get from the status pair: **whether the approver approved their own work**, and, when they are
   * somebody else, who last changed the words.
   */
  const noteParts: string[] = [];
  if (selfApproved) {
    noteParts.push('Approved by the same account whose revision the record currently carries — a self-approval.');
  } else if (lastEditor?.email) {
    noteParts.push(`The record's words were last changed by ${String(lastEditor.email)}.`);
  } else {
    noteParts.push('The record carries no revision written in this archive, so it is as the migration left it.');
  }
  if (input.note) noteParts.push(input.note.trim());

  await audit(db, {
    entityType: 'ozikoro_article',
    entityId: input.articleId,
    action: `${input.decision === 'send_back' ? 'send_back' : input.decision}_article`,
    before: { status: from },
    after: {
      status: transition.to,
      decision: input.decision,
      publishedAt: updated?.published_at ? new Date(String(updated.published_at)).toISOString() : null,
      selfApproved,
    },
    actorId: input.actorId,
    note: noteParts.join(' '),
  });

  return {
    from,
    to: transition.to,
    decision: input.decision,
    selfApproved,
    publishedAt: updated?.published_at ? new Date(String(updated.published_at)).toISOString() : null,
  };
}

/** Every revision a PERSON has saved on a record. Imported revisions are excluded by their WordPress id. */
export async function listHumanRevisions(
  db: Db,
  articleId: number,
  limit = 20
): Promise<{ id: number; title: string | null; standfirst: string | null; bodyBytes: number; wordCount: number; actorEmail: string | null; note: string | null; createdAt: string }[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select r.id, r.title, r.standfirst, r.word_count, r.note, r.created_at, a.email as actor_email,
            coalesce(octet_length(r.body_html), 0)::int as body_bytes
       from ozikoro_article_revision r
       left join account a on a.id = r.actor_id
      where r.article_id = $1 and r.wp_revision_id is null
      order by r.created_at desc, r.id desc
      limit $2`,
    [articleId, Math.min(Math.max(limit, 1), 100)]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title ? String(r.title) : null,
    standfirst: r.standfirst ? String(r.standfirst) : null,
    bodyBytes: Number(r.body_bytes ?? 0),
    wordCount: Number(r.word_count ?? 0),
    actorEmail: r.actor_email ? String(r.actor_email) : null,
    note: r.note ? String(r.note) : null,
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
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

// ---------------------------------------------------------------------------
// The revision history of a record — what it said before it said this
// ---------------------------------------------------------------------------

/**
 * ONE REVISION, AS A LIST NEEDS IT — the body is NOT included.
 *
 * The versions are whole-document snapshots imported from WordPress and 4,266 of them hold 36.6 MiB,
 * so a list that selected `body_html` would pull that much text to render forty rows of metadata.
 * `getArticleRevision` reads one body at a time, which is the operation a reader actually performs.
 */
export interface ArticleRevisionSummary {
  id: number;
  wpRevisionId: number | null;
  wpParentPostId: number | null;
  title: string | null;
  revisedAt: string | null;
  wordCount: number;
  author: string | null;
  /** True when this revision is the one carrying text that survives in no other record. */
  carriesUniqueText: boolean;
  /** The stored size of the body, so a list can show how much text a revision holds without loading it. */
  bodyBytes: number;
  /** What the revision opens with, for a list that has to be readable at a glance. */
  opening: string | null;
  /**
   * The account that saved this revision, for a revision written here. NULL for an imported one.
   *
   * The `author` field above is the BYLINE — who wrote the article — and this is who made the revision.
   * They are different people every time an editor corrects somebody else's record, and the list shows both
   * rather than offering one number where two facts are held. See migration 0054.
   */
  actorEmail: string | null;
  /** True for a WordPress revision, false for one a person saved in this archive. `wp_revision_id` decides. */
  imported: boolean;
}

/** The history of a record, newest first — the order an editor reads it in. */
export async function listArticleRevisions(
  db: Db,
  articleId: number,
  options: { limit?: number; offset?: number; uniqueOnly?: boolean } = {}
): Promise<ArticleRevisionSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const conditions = ['r.article_id = $1'];
  const params: unknown[] = [articleId];
  if (options.uniqueOnly) conditions.push('r.carries_unique_text');
  params.push(limit, offset);

  const rows = await db.rows<Record<string, unknown>>(
    `select r.id, r.wp_revision_id, r.wp_parent_post_id, r.title, r.revised_at, r.word_count,
            r.carries_unique_text, c.display_name as author, acc.email as actor_email,
            coalesce(octet_length(r.body_html), 0)::int as body_bytes,
            left(regexp_replace(coalesce(r.body_html, ''), '<[^>]*>', ' ', 'g'), 180) as opening
       from ozikoro_article_revision r
       left join ozikoro_contributor c on c.id = r.author_id
       left join account acc on acc.id = r.actor_id
      where ${conditions.join(' and ')}
      order by r.revised_at desc nulls last, r.id desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return rows.map(rowToRevisionSummary);
}

function rowToRevisionSummary(r: Record<string, unknown>): ArticleRevisionSummary {
  const wpRevisionId = r.wp_revision_id === null || r.wp_revision_id === undefined ? null : Number(r.wp_revision_id);
  return {
    id: Number(r.id),
    wpRevisionId,
    wpParentPostId: r.wp_parent_post_id === null || r.wp_parent_post_id === undefined ? null : Number(r.wp_parent_post_id),
    title: r.title ? String(r.title) : null,
    revisedAt: r.revised_at ? new Date(String(r.revised_at)).toISOString() : null,
    wordCount: Number(r.word_count ?? 0),
    author: r.author ? String(r.author) : null,
    carriesUniqueText: Boolean(r.carries_unique_text),
    bodyBytes: Number(r.body_bytes ?? 0),
    opening: r.opening ? String(r.opening).replace(/\s+/g, ' ').trim() : null,
    actorEmail: r.actor_email ? String(r.actor_email) : null,
    imported: wpRevisionId !== null,
  };
}

/** How many revisions a record holds, and how many of them carry text held nowhere else. */
export async function countArticleRevisions(
  db: Db,
  articleId: number
): Promise<{ total: number; carryingUniqueText: number; bodyBytes: number }> {
  const row = await db.one<{ total: number; carriers: number; bytes: string }>(
    `select count(*)::int as total,
            count(*) filter (where carries_unique_text)::int as carriers,
            coalesce(sum(octet_length(body_html)), 0)::bigint as bytes
       from ozikoro_article_revision where article_id = $1`,
    [articleId]
  );
  return {
    total: Number(row?.total ?? 0),
    carryingUniqueText: Number(row?.carriers ?? 0),
    bodyBytes: Number(row?.bytes ?? 0),
  };
}

/** One revision, with its body. `articleId` is checked so a record cannot be shown another's history. */
export async function getArticleRevision(
  db: Db,
  revisionId: number,
  articleId?: number
): Promise<(ArticleRevisionSummary & { bodyHtml: string | null }) | null> {
  const row = await db.one<Record<string, unknown>>(
    `select r.id, r.wp_revision_id, r.wp_parent_post_id, r.title, r.revised_at, r.word_count,
            r.carries_unique_text, r.body_html, c.display_name as author, acc.email as actor_email,
            coalesce(octet_length(r.body_html), 0)::int as body_bytes,
            left(regexp_replace(coalesce(r.body_html, ''), '<[^>]*>', ' ', 'g'), 180) as opening
       from ozikoro_article_revision r
       left join ozikoro_contributor c on c.id = r.author_id
       left join account acc on acc.id = r.actor_id
      where r.id = $1 and ($2::bigint is null or r.article_id = $2::bigint)`,
    [revisionId, articleId ?? null]
  );
  if (!row) return null;
  return { ...rowToRevisionSummary(row), bodyHtml: row.body_html === null ? null : String(row.body_html) };
}

/**
 * The revisions whose parent post this archive does not hold, grouped by that parent.
 *
 * There is no article to open them from, so **without this list the 74 revisions would be a table
 * nobody could reach** — which is the fault the brief names: a backfill that satisfies a count and
 * nothing else. They belong to WordPress posts this archive deliberately did not import.
 */
export interface OrphanRevisionGroup {
  wpParentPostId: number;
  revisions: number;
  bodyBytes: number;
  carryingUniqueText: number;
  titles: string[];
}

export async function listOrphanRevisionGroups(db: Db): Promise<OrphanRevisionGroup[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select wp_parent_post_id,
            count(*)::int as revisions,
            coalesce(sum(octet_length(body_html)), 0)::bigint as body_bytes,
            count(*) filter (where carries_unique_text)::int as carriers,
            (array_agg(distinct nullif(title, '')))[1:3] as titles
       from ozikoro_article_revision
      where article_id is null
      group by wp_parent_post_id
      order by wp_parent_post_id`
  );
  return rows.map((r) => ({
    wpParentPostId: Number(r.wp_parent_post_id),
    revisions: Number(r.revisions),
    bodyBytes: Number(r.body_bytes),
    carryingUniqueText: Number(r.carriers),
    titles: Array.isArray(r.titles) ? (r.titles as unknown[]).map(String) : [],
  }));
}

/** The orphan revisions of one WordPress parent, newest first. */
export async function listOrphanRevisions(
  db: Db,
  wpParentPostId: number,
  limit = 200
): Promise<ArticleRevisionSummary[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select r.id, r.wp_revision_id, r.wp_parent_post_id, r.title, r.revised_at, r.word_count,
            r.carries_unique_text, c.display_name as author,
            coalesce(octet_length(r.body_html), 0)::int as body_bytes,
            left(regexp_replace(coalesce(r.body_html, ''), '<[^>]*>', ' ', 'g'), 180) as opening
       from ozikoro_article_revision r
       left join ozikoro_contributor c on c.id = r.author_id
      where r.article_id is null and r.wp_parent_post_id = $1
      order by r.revised_at desc nulls last, r.id desc
      limit $2`,
    [wpParentPostId, Math.min(Math.max(limit, 1), 500)]
  );
  return rows.map(rowToRevisionSummary);
}

/** The whole import, as one figure, for the admin's own index. */
export async function revisionArchiveTotals(
  db: Db
): Promise<{ revisions: number; records: number; carriers: number; bodyBytes: number; orphans: number }> {
  const row = await db.one<Record<string, unknown>>(
    `select count(*)::int as revisions,
            count(distinct article_id)::int as records,
            count(*) filter (where carries_unique_text)::int as carriers,
            coalesce(sum(octet_length(body_html)), 0)::bigint as bytes,
            count(*) filter (where article_id is null)::int as orphans
       from ozikoro_article_revision`
  );
  return {
    revisions: Number(row?.revisions ?? 0),
    records: Number(row?.records ?? 0),
    carriers: Number(row?.carriers ?? 0),
    bodyBytes: Number(row?.bytes ?? 0),
    orphans: Number(row?.orphans ?? 0),
  };
}
