/**
 * The audit trail: what changed, who changed it, and when.
 *
 * WHY THIS IS A LIST AND NOT A LOG FILE
 *
 * `ozikoro_audit` has been written by every privileged write path since the editorial desk was built —
 * `updateArticleFacets` records a status change, `decideContributorClaim` records a byline being granted,
 * `setMediaRights` records a permission being established. The rows existed and **nothing read them back**,
 * so the one question the table was created to answer — *"who changed this, and when?"* — could only be
 * answered by opening a database client. A record that nobody can read is a record that does not hold
 * anybody to anything.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not write. **A read path that could also write would be a second place for the audit rules to
 * live**, and the whole value of the table is that every write goes through the one function that sets the
 * actor. It also does not interpret `before` and `after`: they are JSONB written by the caller in whatever
 * shape that subject needs, and this module reports them as the JSON they are rather than pretending to know
 * what every field means. The one thing it does shape is a status change, because `update_facets` is the
 * commonest row and `draft → review` is the fact an editor is looking for.
 */
import type { Db } from '@ozituma/db/client';

/** One row of `ozikoro_audit`, with the actor resolved to a person where one was recorded. */
export interface AuditTrailEntry {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  actorId: number | null;
  /** The account's address, or null when the write recorded no actor. */
  actorEmail: string | null;
  actorName: string | null;
  note: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** `draft → review`, when both sides carry a status. Otherwise null. */
  statusChange: string | null;
  createdAt: string;
}

export interface AuditTrailOptions {
  action?: string | null;
  entityType?: string | null;
  limit?: number;
  offset?: number;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      // A value that is not JSON is not a reason to hide the row — it is shown as an empty change rather
      // than dropped, because a dropped audit row is worse than an unreadable one.
      return null;
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function rowToEntry(row: Record<string, unknown>): AuditTrailEntry {
  const before = asObject(row.before);
  const after = asObject(row.after);
  const from = before?.status;
  const to = after?.status;
  return {
    id: Number(row.id),
    entityType: String(row.entity_type),
    entityId: Number(row.entity_id),
    action: String(row.action),
    actorId: row.actor_id === null || row.actor_id === undefined ? null : Number(row.actor_id),
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    actorName: row.actor_name ? String(row.actor_name) : null,
    note: row.note ? String(row.note) : null,
    before,
    after,
    statusChange:
      typeof from === 'string' && typeof to === 'string' && from !== to ? `${from} → ${to}` : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

/**
 * The trail, newest first.
 *
 * Newest first because the question is almost always "what happened just now" — the one an operator asks
 * after a change they did not expect. `total` is returned beside the page so the screen can say how much
 * there is rather than showing a page and implying that is all of it.
 */
export async function listAuditTrail(
  db: Db,
  options: AuditTrailOptions = {}
): Promise<{ total: number; entries: AuditTrailEntry[] }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.action) {
    params.push(options.action);
    conditions.push(`t.action = $${params.length}`);
  }
  if (options.entityType) {
    params.push(options.entityType);
    conditions.push(`t.entity_type = $${params.length}`);
  }
  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';

  const totalRow = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_audit t ${where}`, params);
  const total = Number(totalRow?.n ?? 0);

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  params.push(limit, offset);

  /*
   * THE JOIN IS A LEFT JOIN, AND THAT IS THE POINT.
   *
   * Some rows were written by a script with no signed-in actor, so `actor_id` is null. An inner join would
   * have hidden exactly those rows — **the unattributed changes are the ones an audit trail exists to
   * surface**, and dropping them would make the list look complete while the least accountable writes were
   * the ones missing from it.
   */
  const rows = await db.rows<Record<string, unknown>>(
    `select t.id, t.entity_type, t.entity_id, t.action, t.actor_id, t.note, t.before, t.after, t.created_at,
            a.email as actor_email, a.display_name as actor_name
       from ozikoro_audit t
       left join account a on a.id = t.actor_id
       ${where}
      order by t.created_at desc, t.id desc
      limit $${params.length - 1} offset $${params.length}`,
    params
  );

  return { total, entries: rows.map(rowToEntry) };
}

export interface AuditOverview {
  records: number;
  actions: number;
  entityTypes: number;
  actors: number;
  /** How many rows record no actor at all. Stated, because it is the number that matters. */
  unattributed: number;
  earliest: string | null;
  latest: string | null;
  byAction: { action: string; n: number }[];
  byEntityType: { entityType: string; n: number }[];
}

/** What the trail holds, as counts rather than as a feeling about how much is in it. */
export async function getAuditOverview(db: Db): Promise<AuditOverview> {
  const row = await db.one<Record<string, unknown>>(`
    select count(*)::int as records,
           count(distinct action)::int as actions,
           count(distinct entity_type)::int as entity_types,
           count(distinct actor_id)::int as actors,
           count(*) filter (where actor_id is null)::int as unattributed,
           min(created_at) as earliest,
           max(created_at) as latest
      from ozikoro_audit
  `);
  const byAction = await db.rows<{ action: string; n: number }>(
    `select action, count(*)::int as n from ozikoro_audit group by action order by n desc, action`
  );
  const byEntityType = await db.rows<{ entity_type: string; n: number }>(
    `select entity_type, count(*)::int as n from ozikoro_audit group by entity_type order by n desc, entity_type`
  );
  return {
    records: Number(row?.records ?? 0),
    actions: Number(row?.actions ?? 0),
    entityTypes: Number(row?.entity_types ?? 0),
    actors: Number(row?.actors ?? 0),
    unattributed: Number(row?.unattributed ?? 0),
    earliest: row?.earliest ? new Date(String(row.earliest)).toISOString() : null,
    latest: row?.latest ? new Date(String(row.latest)).toISOString() : null,
    byAction: byAction.map((r) => ({ action: r.action, n: Number(r.n) })),
    byEntityType: byEntityType.map((r) => ({ entityType: r.entity_type, n: Number(r.n) })),
  };
}
