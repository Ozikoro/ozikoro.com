/**
 * The review queue: §5.3's content lifecycle, persisted.
 *
 * THE FOURTH TIME, AND THE MOST CONSEQUENTIAL ONE
 *
 * `packages/core/src/review-workflow.ts` holds the whole lifecycle and is tested: the eight states,
 * which role may perform which transition, the rule that an AI draft can never skip review, the
 * two-person rule (a linguist cannot approve their own content), and the rule that a lexeme needs
 * approved audio. Migration 0029 created `learn_review_task`, `learn_content_version` and
 * `learn_audit_log` to hold the results. Nothing read or wrote any of it.
 *
 * This one matters more than the others because it is the gate. Every piece of content the platform
 * has is `draft`, and `draft` is invisible to learners — so the workflow that could move something
 * out of draft is the thing standing between "the platform is built" and "the platform has
 * anything in it".
 *
 * THE DOMAIN DECIDES, THIS LAYER ONLY RECORDS
 *
 * `applyContentTransition` calls `applyTransition` and writes what it returns. It does not
 * re-implement any rule, and it does not check the actor's role itself — `canTransition` already
 * does, and a second check is a second thing to keep in step. What this layer adds is the fact the
 * domain cannot know: the current status as stored, and the transaction that writes it.
 *
 * TWO WRITES, AND WHY THEY ARE NOT FORCED INTO ONE
 *
 * A transition changes the content's status AND appends an audit row. Unlike the SRS state and its
 * log — where a disagreement corrupts the schedule — these two failing apart is recoverable: a
 * status change with no audit row is an incomplete record, and the audit row is written second
 * deliberately, so the failure mode is "the change happened but was not logged" rather than "the log
 * claims a change that did not happen". An audit trail that lies is worse than one with a gap.
 */

import type { Db } from './client.ts';
import {
  applyTransition,
  isLearnerVisible,
  trustLabelForStatus,
  type Actor,
  type ContentFacts,
  type ReviewStatus,
  type Role,
  type Transition,
  type TransitionResult,
  canTransition,
} from '@ozituma/core';

/** The content kinds that live in the learn tables, and where. */
const CONTENT_TABLES: Record<string, string> = {
  lesson: 'learn_lesson',
  lesson_section: 'learn_lesson_section',
  grammar_note: 'learn_grammar_note',
  culture_note: 'learn_culture_note',
};

/**
 * Kinds the review task table accepts but this layer cannot transition.
 *
 * `lexeme` is a `word` row, whose status is the dictionary's own `review_status` enum rather than
 * §5.3's lifecycle, and `exercise` has no table of its own yet. Named here so the queue can show a
 * task for one and say plainly that it cannot act on it, rather than throwing a table-not-found
 * error from a reviewer's click.
 */
export const UNSUPPORTED_KINDS: readonly string[] = ['lexeme', 'exercise'];

export type ContentKind = keyof typeof CONTENT_TABLES | 'lexeme' | 'exercise';

export class ReviewError extends Error {
  /**
   * Declared as a field and assigned in the body, NOT as a constructor parameter property.
   *
   * `constructor(message: string, readonly code: ...)` is the idiomatic way to write this and it is
   * what this class did first. It is also non-erasable TypeScript: a parameter property emits an
   * assignment, so Node's type-stripping refuses the file outright with
   * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. The migration runner and every importer run straight from
   * source under Node 24 and are never compiled — see the note at the top of docker/Dockerfile —
   * so a construct that cannot be erased is a construct that breaks at run time, in production,
   * where tsc had already said the file was fine.
   */
  readonly code: 'not_found' | 'unsupported_kind' | 'refused';

  constructor(message: string, code: 'not_found' | 'unsupported_kind' | 'refused') {
    super(message);
    this.name = 'ReviewError';
    this.code = code;
  }
}

function tableFor(kind: string): string {
  const table = CONTENT_TABLES[kind];
  if (!table) {
    throw new ReviewError(
      `Content kind "${kind}" has no reviewable table here. Lexemes live in the dictionary and ` +
        `follow its own workflow; exercises have no table yet.`,
      'unsupported_kind'
    );
  }
  return table;
}

/**
 * The facts `canTransition` needs, read from the row.
 *
 * `aiGenerated` is read from `generation_method = 'ai'` where the column exists. That column is what
 * §5.3 turns on — "AI-generated drafts are created with source = 'ai' and can never skip review" —
 * so getting it wrong would let a machine-written lesson publish without a linguist. It is read,
 * never inferred from anything else.
 *
 * `hasApprovedAudio` is passed as true for the content kinds that are not lexemes: §F4's audio rule
 * is about a lexeme, and asserting it about a lesson would refuse every lesson for a reason that
 * does not apply to it.
 */
export async function loadContentFacts(
  db: Db,
  kind: ContentKind,
  id: number,
  /**
   * Whether approved audio exists, when the caller knows better than this layer.
   *
   * §F4's audio rule is a `ContentFacts` field rather than a transition option, so it has to be
   * supplied with the facts. The dictionary tracks recordings in its own `audio` table, and a
   * lexeme's approval is decided there — this layer cannot see it, so the caller passes the answer.
   */
  audioApproved?: boolean
): Promise<ContentFacts> {
  const table = tableFor(kind);

  // `created_by`, not `author_id`. The content tables name the author `created_by` while
  // `learn_content_version` names it `author_id` — and this reads a content table. Reading the
  // wrong one is a SQL error rather than a silent null, which is the better of the two failures:
  // the two-person rule depends on this value and a null author would quietly disable it.
  const row = await db.one<Record<string, unknown>>(
    `select status, generation_method, created_by, linguist_approved_by, native_approved_by
       from ${table} where id = $1`,
    [id]
  );

  if (!row) throw new ReviewError(`No ${kind} with id ${id}.`, 'not_found');

  return {
    status: String(row.status) as ReviewStatus,
    aiGenerated: String(row.generation_method ?? 'authored') === 'ai',
    authorId: row.created_by === null || row.created_by === undefined ? null : Number(row.created_by),
    linguistApprovedBy:
      row.linguist_approved_by === null || row.linguist_approved_by === undefined
        ? null
        : Number(row.linguist_approved_by),
    // See the note above: the audio rule is a lexeme rule, and the caller supplies the answer when
    // it has one. Defaulting to true for lesson-shaped content is correct — a grammar note has no
    // recording to approve — and the caller overrides it for a lexeme.
    hasApprovedAudio: audioApproved ?? true,
    audioExempt: false,
  };
}

// ---------------------------------------------------------------------------
// Review tasks
// ---------------------------------------------------------------------------

export interface ReviewTask {
  id: number;
  contentKind: string;
  contentId: number;
  requiredRole: Role;
  state: string;
  proposal: unknown;
  reason: string | null;
  origin: string;
  assignedTo: number | null;
  resolvedBy: number | null;
  resolvedAt: number | null;
  createdAt: number;
  /** The content's current status, joined in so a reviewer sees it without a second call. */
  contentStatus: ReviewStatus | null;
  /** True when this layer can actually act on it. False for lexemes and exercises. */
  actionable: boolean;
}

function rowToTask(row: Record<string, unknown>): ReviewTask {
  const kind = String(row.content_kind);
  return {
    id: Number(row.id),
    contentKind: kind,
    contentId: Number(row.content_id),
    requiredRole: String(row.required_role) as Role,
    state: String(row.state),
    proposal: row.proposal ?? null,
    reason: (row.reason as string | null) ?? null,
    origin: String(row.origin),
    assignedTo: row.assigned_to === null ? null : Number(row.assigned_to),
    resolvedBy: row.resolved_by === null ? null : Number(row.resolved_by),
    resolvedAt:
      row.resolved_at === null ? null : Date.parse(String(row.resolved_at)),
    createdAt: Date.parse(String(row.created_at)),
    contentStatus: (row.content_status as ReviewStatus | null) ?? null,
    actionable: !UNSUPPORTED_KINDS.includes(kind),
  };
}

/**
 * The queue.
 *
 * Ordered by age, oldest first, because a review queue that surfaces the newest item is a queue
 * where the oldest submission is never looked at. `state = 'open'` is the default: claimed tasks
 * belong to whoever claimed them, and approved ones are history.
 *
 * The content status is left-joined per kind rather than through a union across tables, because a
 * union over four tables with different columns would be slower and would need keeping in step as
 * columns change. The join is built from the same map that guards writes, so a kind cannot be
 * readable here and unwritable there.
 */
export async function listReviewTasks(
  db: Db,
  options: { state?: string; requiredRole?: Role; limit?: number } = {}
): Promise<ReviewTask[]> {
  const state = options.state ?? 'open';
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  const params: unknown[] = [state, limit];
  let roleClause = '';
  if (options.requiredRole) {
    params.push(options.requiredRole);
    roleClause = `and t.required_role = $${params.length}`;
  }

  const statusJoins = Object.entries(CONTENT_TABLES)
    .map(
      ([kind, table]) =>
        `left join ${table} c_${kind.replace(/[^a-z_]/g, '')} ` +
        `on t.content_kind = '${kind}' and c_${kind.replace(/[^a-z_]/g, '')}.id = t.content_id`
    )
    .join('\n       ');

  const statusSelects = Object.entries(CONTENT_TABLES)
    .map(([kind]) => {
      const alias = `c_${kind.replace(/[^a-z_]/g, '')}`;
      return `case when t.content_kind = '${kind}' then ${alias}.status end`;
    })
    .join(',\n            ');

  const rows = await db.rows<Record<string, unknown>>(
    `select t.id, t.content_kind, t.content_id, t.required_role, t.state, t.proposal, t.reason,
            t.origin, t.assigned_to, t.resolved_by, t.resolved_at, t.created_at,
            coalesce(
              ${statusSelects}
            ) as content_status
       from learn_review_task t
       ${statusJoins}
      where t.state = $1
        ${roleClause}
      order by t.created_at, t.id
      limit $2`,
    params
  );

  return rows.map(rowToTask);
}

/** Open a review task. Used by an author submitting, and by a learner error report (§5.3). */
export async function createReviewTask(
  db: Db,
  input: {
    contentKind: ContentKind;
    contentId: number;
    requiredRole: Role;
    origin?: 'author' | 'ai_draft' | 'learner_report' | 'system';
    proposal?: unknown;
    reason?: string | null;
  }
): Promise<ReviewTask> {
  const row = await db.one<Record<string, unknown>>(
    `insert into learn_review_task (content_kind, content_id, required_role, origin, proposal, reason)
     values ($1,$2,$3,$4,$5,$6)
     returning id, content_kind, content_id, required_role, state, proposal, reason, origin,
               assigned_to, resolved_by, resolved_at, created_at`,
    [
      input.contentKind,
      input.contentId,
      input.requiredRole,
      input.origin ?? 'author',
      input.proposal === undefined ? null : JSON.stringify(input.proposal),
      input.reason ?? null,
    ]
  );
  if (!row) throw new Error('Could not create the review task.');
  // `content_status` is not in the RETURNING list, so it is left null and the caller re-reads if it
  // needs it. Selecting it here would mean repeating the per-kind join for one row.
  return { ...rowToTask(row), contentStatus: null };
}

/** Claim an open task. Only one reviewer can hold it, enforced by the state in the WHERE clause. */
export async function claimReviewTask(
  db: Db,
  taskId: number,
  accountId: number
): Promise<boolean> {
  const rows = await db.rows<{ id: number }>(
    `update learn_review_task
        set state = 'claimed', assigned_to = $2
      where id = $1 and state = 'open'
      returning id`,
    [taskId, accountId]
  );
  // The `state = 'open'` predicate is the lock. A second reviewer claiming the same task updates
  // zero rows rather than overwriting the first, which is the difference between a queue and a race.
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface TransitionOutcome {
  ok: boolean;
  from: ReviewStatus;
  to: ReviewStatus | null;
  code?: string;
  reason?: string;
  /** Convenience for the caller: whether the new status is visible to learners. */
  learnerVisible: boolean;
  trustLabel: string | null;
}

/**
 * Apply a lifecycle transition, write it, and log it.
 *
 * The domain decides. `canTransition` is consulted first so a refusal can be returned as a result
 * rather than thrown — a reviewer clicking a button they are not entitled to should get a sentence,
 * not a stack trace — and `applyTransition` is then used for the value, which cannot disagree
 * because it calls the same check.
 */
export async function applyContentTransition(
  db: Db,
  input: {
    kind: ContentKind;
    id: number;
    transition: Transition;
    actor: Actor;
    reason?: string;
    /**
     * §F4: whether the content's audio has been approved by a native speaker. Only meaningful for a
     * lexeme, and only consulted on `publish`.
     */
    audioApproved?: boolean;
  }
): Promise<TransitionOutcome> {
  const table = tableFor(input.kind);
  const facts = await loadContentFacts(db, input.kind, input.id, input.audioApproved);

  // Only `reason` is a transition option. The audio rule is a fact about the content, so it travels
  // in `facts` — passing it here would have been silently ignored, and a lexeme could then publish
  // with no recording.
  const check: TransitionResult = canTransition(facts, input.actor, input.transition, {
    reason: input.reason,
  });

  if (!check.ok || !check.to) {
    return {
      ok: false,
      from: facts.status,
      to: null,
      code: check.code,
      reason: check.reason,
      learnerVisible: isLearnerVisible(facts.status),
      trustLabel: null,
    };
  }

  const to = applyTransition(facts, input.actor, input.transition, {
    reason: input.reason,
  });

  // The audio approval flag is recorded when the transition is the one that grants it, so the
  // two-person rule can see it on the next attempt without re-deriving it.
  const sets: string[] = ['status = $2', 'updated_at = now()'];
  const params: unknown[] = [input.id, to];

  // Who approved AND when. The timestamp is set alongside the id rather than by a trigger, because
  // a trigger would also fire on a backfill or a data fix and would date the approval to the fix
  // rather than to the approval.
  if (input.transition === 'approve_linguist') {
    params.push(input.actor.id);
    sets.push(`linguist_approved_by = $${params.length}`);
    sets.push('linguist_approved_at = now()');
  } else if (input.transition === 'approve_native') {
    params.push(input.actor.id);
    sets.push(`native_approved_by = $${params.length}`);
    sets.push('native_approved_at = now()');
  }

  await db.rows(`update ${table} set ${sets.join(', ')} where id = $1`, params);

  // Written second, on purpose: see the note at the top of the file.
  await writeAudit(db, {
    actorId: input.actor.id,
    action: input.transition,
    contentKind: input.kind,
    contentId: input.id,
    before: { status: facts.status },
    after: { status: to, reason: input.reason ?? null },
  });

  // Close any open task for this item, so it leaves the queue. Done for every transition rather
  // than only approvals: a rejected or changes-requested item is also finished with while it goes
  // back to the author, and leaving it open would keep it in a reviewer's list forever.
  await db.rows(
    `update learn_review_task
        set state = case
              when $3 in ('approve_linguist','approve_native','publish') then 'approved'
              when $3 = 'request_changes' then 'changes_requested'
              else 'cancelled'
            end,
            resolved_by = $2,
            resolved_at = now()
      where content_kind = $1 and content_id = $4 and state in ('open','claimed')`,
    [input.kind, input.actor.id, input.transition, input.id]
  );

  return {
    ok: true,
    from: facts.status,
    to,
    learnerVisible: isLearnerVisible(to),
    trustLabel: trustLabelForStatus(to, facts.aiGenerated),
  };
}

/** Which transitions the actor could perform on this item right now. */
export async function availableFor(
  db: Db,
  kind: ContentKind,
  id: number,
  actor: Actor
): Promise<Transition[]> {
  const facts = await loadContentFacts(db, kind, id);
  const { availableTransitions } = await import('@ozituma/core');
  return availableTransitions(facts, actor);
}

// ---------------------------------------------------------------------------
// Audit and versions
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: number;
  actorId: number | null;
  action: string;
  contentKind: string | null;
  contentId: number | null;
  before: unknown;
  after: unknown;
  createdAt: number;
}

export async function writeAudit(
  db: Db,
  input: {
    actorId: number | null;
    action: string;
    contentKind?: string | null;
    contentId?: number | null;
    before?: unknown;
    after?: unknown;
  }
): Promise<void> {
  await db.rows(
    `insert into learn_audit_log (actor_id, action, content_kind, content_id, before, after)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      input.actorId,
      input.action,
      input.contentKind ?? null,
      input.contentId ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
    ]
  );
}

export async function listAuditLog(
  db: Db,
  filter: { contentKind: string; contentId: number; limit?: number }
): Promise<AuditEntry[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select id, actor_id, action, content_kind, content_id, before, after, created_at
       from learn_audit_log
      where content_kind = $1 and content_id = $2
      order by id desc
      limit $3`,
    [filter.contentKind, filter.contentId, Math.min(Math.max(filter.limit ?? 50, 1), 200)]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    actorId: row.actor_id === null ? null : Number(row.actor_id),
    action: String(row.action),
    contentKind: (row.content_kind as string | null) ?? null,
    contentId: row.content_id === null ? null : Number(row.content_id),
    before: row.before ?? null,
    after: row.after ?? null,
    createdAt: Date.parse(String(row.created_at)),
  }));
}

/**
 * Snapshot a content row as a new version (§F10).
 *
 * The version number is computed as max+1 in the same statement that inserts, so two concurrent
 * snapshots cannot claim the same number — the unique constraint on (kind, id, version) would
 * reject the loser, which is the correct outcome for a race.
 */
export async function snapshotContentVersion(
  db: Db,
  input: {
    contentKind: ContentKind;
    contentId: number;
    snapshot: unknown;
    authorId: number | null;
    changeNote?: string | null;
  }
): Promise<number> {
  const row = await db.one<{ version: number }>(
    `insert into learn_content_version (content_kind, content_id, version, snapshot, author_id, change_note)
     select $1, $2,
            coalesce((select max(version) from learn_content_version
                       where content_kind = $1 and content_id = $2), 0) + 1,
            $3, $4, $5
     returning version`,
    [
      input.contentKind,
      input.contentId,
      JSON.stringify(input.snapshot),
      input.authorId,
      input.changeNote ?? null,
    ]
  );
  return Number(row?.version ?? 0);
}
