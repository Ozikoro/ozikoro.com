/**
 * Following: what an account keeps an eye on, and what a screen may say about it.
 *
 * THE BRIEF ASKS FOR IT BY NAME
 *
 * §3.2 lists "following and visibility controls" beside the profile, the upload and discovery — and is
 * explicit that the social features are *secondary* to findability rather than the point. So this is
 * deliberately small: three kinds of subject (a researcher, a series, an institution), one row per
 * follow, no feed, no notifications, no follower graph to browse. What it buys is that a reader can
 * say "tell me when this changes" and that a profile can honestly say how many people are watching it.
 *
 * WHY A FOLLOW IS NOT AN ACCOUNT ROW
 *
 * Tempting, and wrong: a follow is a preference about somebody else's work, and the moment it lives on
 * the profile it becomes a fact about the person followed rather than about the person following.
 * Keeping it in its own table means closing an account removes what it followed and leaves the
 * followed profile untouched — which the cascade in migration 0048 arranges.
 *
 * WHY COUNTS ARE PUBLIC AND LISTS ARE NOT
 *
 * A follower count is a fact about a public profile and belongs on it. **The list of who follows
 * somebody is not**, and neither is an account's own list to anyone but that account: it is a reading
 * habit, and this repository has no business publishing one. `listFollowing` therefore refuses to
 * answer for an account other than the one asking.
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';

export type FollowKind = 'researcher' | 'topic' | 'institution';

export interface Follow {
  id: number;
  kind: FollowKind;
  /** The account followed, for `researcher`. */
  subjectAccountId: number | null;
  /** The display name of the account followed, resolved for a screen. */
  subjectName: string | null;
  /** The series followed, for `topic`. */
  topicId: number | null;
  topicName: string | null;
  topicSlug: string | null;
  /** The institution followed, for `institution`. */
  institution: string | null;
  createdAt: string;
}

/** What a screen needs to decide whether to offer Follow or Unfollow. */
export interface FollowState {
  following: boolean;
  followers: number;
}

function rowToFollow(row: Record<string, unknown>): Follow {
  return {
    id: Number(row.id),
    kind: String(row.kind) as FollowKind,
    subjectAccountId: row.subject_account_id === null || row.subject_account_id === undefined ? null : Number(row.subject_account_id),
    subjectName: row.subject_name ? String(row.subject_name) : null,
    topicId: row.topic_id === null || row.topic_id === undefined ? null : Number(row.topic_id),
    topicName: row.topic_name ? String(row.topic_name) : null,
    topicSlug: row.topic_slug ? String(row.topic_slug) : null,
    institution: row.institution ? String(row.institution) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

const FOLLOW_SELECT = `
  select f.id, f.kind, f.subject_account_id, f.topic_id, f.institution, f.created_at,
         coalesce(m.display_name, a.display_name, a.email) as subject_name,
         t.name as topic_name, t.slug as topic_slug
    from ozikoro_follow f
    left join account a on a.id = f.subject_account_id
    left join ozikoro_member m on m.account_id = f.subject_account_id
    left join ozikoro_topic t on t.id = f.topic_id
`;

/**
 * An account's own follows, and only its own.
 *
 * The `viewerId` parameter is not decoration: a function that returned any account's list would make
 * a reading habit readable by anybody who could guess an id, and the caller would have no way to say
 * which account it meant. So the two are compared here and a mismatch is refused rather than answered.
 */
export async function listFollowing(db: Db, input: { accountId: number; viewerId: number }): Promise<Follow[]> {
  if (input.accountId !== input.viewerId) {
    throw new MemberError('not_your_list', 'That is somebody else’s reading list.');
  }
  const rows = await db.rows<Record<string, unknown>>(
    `${FOLLOW_SELECT} where f.account_id = $1 order by f.created_at desc`,
    [input.accountId]
  );
  return rows.map(rowToFollow);
}

/** How many accounts follow a researcher, which a profile may show. */
export async function countFollowers(db: Db, subjectAccountId: number): Promise<number> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_follow where kind = 'researcher' and subject_account_id = $1`,
    [subjectAccountId]
  );
  return Number(row?.n ?? 0);
}

/** Whether one account follows another, for the button's own state. */
export async function followsResearcher(db: Db, accountId: number, subjectAccountId: number): Promise<boolean> {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_follow
      where account_id = $1 and kind = 'researcher' and subject_account_id = $2`,
    [accountId, subjectAccountId]
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * Follow, or stop following. Idempotent in both directions.
 *
 * `on` rather than a toggle, deliberately: a toggle is a function of state, and two requests racing
 * from two tabs would each flip the same row and land somewhere neither reader asked for. "Make it so"
 * is the same request however many times it arrives.
 */
export async function setFollow(
  db: Db,
  input:
    | { accountId: number; on: boolean; kind: 'researcher'; subjectAccountId: number }
    | { accountId: number; on: boolean; kind: 'topic'; topicId: number }
    | { accountId: number; on: boolean; kind: 'institution'; institution: string }
): Promise<void> {
  if (input.kind === 'researcher') {
    if (input.subjectAccountId === input.accountId) {
      throw new MemberError('follow_self', 'You already see your own work.');
    }
    const exists = await db.one<{ n: number }>(`select count(*)::int as n from account where id = $1`, [input.subjectAccountId]);
    if (Number(exists?.n ?? 0) === 0) throw new MemberError('no_account', 'That account does not exist.');

    if (input.on) {
      /*
       * CHECK FIRST, THEN INSERT. The uniqueness that makes a follow idempotent is a PARTIAL unique
       * index per kind (`where kind = 'researcher'`), and a bare `on conflict do nothing` against a
       * partial index is a statement whose behaviour depends on inference rather than on something
       * the reader can see. The check is explicit, and the index stays as the database's own guard.
       */
      const already = await db.one<{ n: number }>(
        `select count(*)::int as n from ozikoro_follow
          where account_id = $1 and kind = 'researcher' and subject_account_id = $2`,
        [input.accountId, input.subjectAccountId]
      );
      if (Number(already?.n ?? 0) === 0) {
        await db.query(
          `insert into ozikoro_follow (account_id, kind, subject_account_id) values ($1, 'researcher', $2)`,
          [input.accountId, input.subjectAccountId]
        );
        await audit(db, {
          entityType: 'ozikoro_follow',
          entityId: input.subjectAccountId,
          action: 'follow_researcher',
          after: { subjectAccountId: input.subjectAccountId },
          actorId: input.accountId,
        });
      }
    } else {
      await db.query(
        `delete from ozikoro_follow where account_id = $1 and kind = 'researcher' and subject_account_id = $2`,
        [input.accountId, input.subjectAccountId]
      );
      await audit(db, {
        entityType: 'ozikoro_follow',
        entityId: input.subjectAccountId,
        action: 'unfollow_researcher',
        before: { subjectAccountId: input.subjectAccountId },
        actorId: input.accountId,
      });
    }
    return;
  }

  if (input.kind === 'topic') {
    const exists = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_topic where id = $1`, [input.topicId]);
    if (Number(exists?.n ?? 0) === 0) throw new MemberError('no_topic', 'That series does not exist.');

    if (input.on) {
      const already = await db.one<{ n: number }>(
        `select count(*)::int as n from ozikoro_follow where account_id = $1 and kind = 'topic' and topic_id = $2`,
        [input.accountId, input.topicId]
      );
      if (Number(already?.n ?? 0) === 0) {
        await db.query(`insert into ozikoro_follow (account_id, kind, topic_id) values ($1, 'topic', $2)`, [
          input.accountId,
          input.topicId,
        ]);
        await audit(db, {
          entityType: 'ozikoro_follow',
          entityId: input.topicId,
          action: 'follow_topic',
          after: { topicId: input.topicId },
          actorId: input.accountId,
        });
      }
    } else {
      await db.query(`delete from ozikoro_follow where account_id = $1 and kind = 'topic' and topic_id = $2`, [
        input.accountId,
        input.topicId,
      ]);
      await audit(db, {
        entityType: 'ozikoro_follow',
        entityId: input.topicId,
        action: 'unfollow_topic',
        before: { topicId: input.topicId },
        actorId: input.accountId,
      });
    }
    return;
  }

  const institution = input.institution.trim().slice(0, 200);
  if (institution.length === 0) throw new MemberError('no_institution', 'Which institution?');

  if (input.on) {
    /*
     * `on conflict` IS NOT USED HERE, AND THAT IS THE SAFER CHOICE.
     *
     * The uniqueness for an institution follow is a PARTIAL index on an EXPRESSION —
     * `(account_id, lower(institution)) where kind = 'institution'` — and Postgres only infers such an
     * index as an `on conflict` arbiter when the statement repeats both the expression and the
     * predicate exactly.
     *
     * It is tempting to write it anyway because the syntax is accepted; **it was not, on the entity
     * index in migration 0048, which failed the whole run with "there is no unique or exclusion
     * constraint matching the ON CONFLICT specification".** Rather than risk the same failure on a
     * sentence whose index is harder to name, the duplicate is checked first — matching on
     * `lower(institution)`, which is what makes "University of Nigeria" and "university of nigeria"
     * the same institution — and the partial index remains the database's own guard underneath.
     */
    const already = await db.one<{ n: number }>(
      `select count(*)::int as n from ozikoro_follow
        where account_id = $1 and kind = 'institution' and lower(institution) = lower($2)`,
      [input.accountId, institution]
    );
    if (Number(already?.n ?? 0) === 0) {
      await db.query(
        `insert into ozikoro_follow (account_id, kind, institution) values ($1, 'institution', $2)`,
        [input.accountId, institution]
      );
      await audit(db, {
        entityType: 'ozikoro_follow',
        entityId: 0,
        action: 'follow_institution',
        after: { institution },
        actorId: input.accountId,
      });
    }
  } else {
    await db.query(
      `delete from ozikoro_follow where account_id = $1 and kind = 'institution' and lower(institution) = lower($2)`,
      [input.accountId, institution]
    );
    await audit(db, {
      entityType: 'ozikoro_follow',
      entityId: 0,
      action: 'unfollow_institution',
      before: { institution },
      actorId: input.accountId,
    });
  }
}

/**
 * The audit write, local for the same reason `members.ts` keeps its own.
 *
 * Following is a small act and it is still an act: a table that records what people watch but not who
 * started watching is a table that cannot answer "why am I following this". The `catch` is deliberate
 * — a missing audit row is bad, and a follow that silently failed because the audit table was
 * unavailable is worse.
 */
async function audit(
  db: Db,
  event: { entityType: string; entityId: number; action: string; before?: unknown; after?: unknown; actorId: number }
): Promise<void> {
  try {
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        event.entityType,
        event.entityId,
        event.action,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.actorId,
        null,
      ]
    );
  } catch (error) {
    console.error('[ozikoro/follows] could not record an audit event:', String(error).slice(0, 160));
  }
}

/**
 * The subjects one account follows of a given kind, as ids or names.
 *
 * Used where a page has to filter rather than to list: "the series this reader follows" is a set of
 * topic ids, and a query that joins it is cheaper and clearer than one that re-reads the follows.
 */
export async function followedIds(
  db: Db,
  input: { accountId: number; kind: 'researcher' | 'topic' }
): Promise<number[]> {
  const column = input.kind === 'researcher' ? 'subject_account_id' : 'topic_id';
  const rows = await db.rows<{ id: string }>(
    `select ${column} as id from ozikoro_follow
      where account_id = $1 and kind = $2 and ${column} is not null`,
    [input.accountId, input.kind]
  );
  return rows.map((r) => Number(r.id));
}
