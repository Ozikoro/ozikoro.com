/**
 * The reader's own library: what they saved, what they read, and the counts a dashboard shows.
 *
 * THE OWNER'S REPORT, AS A FEATURE
 *
 * *"even 'Saved histories — Not built yet / Followed topics — Not built yet / Reading history — Not' are
 * not working."* They were not working because **nothing was behind them**: `ozikoro_follow` existed for
 * the research network, and saves and reads had no table at all. A label saying "Not built yet" was the
 * honest thing to serve while that was true; it stopped being the honest thing the moment the archive
 * decided to build the tables, which is what migration `0060_ozikoro_library.sql` does.
 *
 * WHY THE READS ARE RECORDED WITHOUT A CONTROL
 *
 * A save is an act — the reader asks for it — so it needs a button and an endpoint. **A read is not an
 * act the reader performs on the archive; it is a consequence of opening a page**, and asking them to
 * press "I read this" would be a control that records a lie. So `recordRead` is called by the record
 * route itself, for a signed-in reader, and the reading history is a fact the archive already knows.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No event log, no dwell time, no scroll depth, no per-visit rows. `ozikoro_read_event` keeps one row per
 * account per record with a first open, a last open and a count — **enough for "continue reading", and
 * nothing that turns a named person's reading into a trail somebody else could follow.**
 */
import type { Db } from '@ozituma/db/client';
import { MemberError } from './members.ts';
import { listFollowing, type Follow } from './follows.ts';

/** One record in a reader's library, with the timestamp that put it there. */
export interface LibraryRecord {
  articleId: number;
  slug: string;
  title: string;
  /** When it was saved, for a save; the last time it was opened, for a read. */
  at: string;
  /** Reads only: how many times this account has opened it. */
  opens?: number;
}

export interface LibraryCounts {
  saved: number;
  following: number;
  history: number;
}

/** How many rows the library page asks for by default. */
const DEFAULT_LIMIT = 50;

/**
 * Save or unsave one record for one account.
 *
 * Idempotent in both directions: saving twice leaves one row, unsaving twice leaves none. **The unique
 * pair on the table is what makes that true**, not this function — a `select` then an `insert` would be
 * two statements with a gap between them, and two tabs is enough to fall into the gap.
 */
export async function setSaved(
  db: Db,
  input: { accountId: number; articleId: number; on: boolean }
): Promise<boolean> {
  if (!Number.isInteger(input.articleId) || input.articleId <= 0) {
    throw new MemberError('no_record', 'That record does not exist.');
  }

  if (!input.on) {
    await db.query(`delete from ozikoro_saved where account_id = $1 and article_id = $2`, [
      input.accountId,
      input.articleId,
    ]);
    return false;
  }

  /*
   * THE RECORD IS ASKED FOR BEFORE THE ROW IS WRITTEN, AND THE REASON IS THE ERROR A READER WOULD SEE.
   * Without this check a save of a record that does not exist fails on the foreign key, which surfaces as
   * a 500 and reads as "the archive is broken" rather than "that page is not here".
   */
  const exists = await db.one<{ n: number }>(
    `select count(*)::int as n from ozikoro_article where id = $1`,
    [input.articleId]
  );
  if (Number(exists?.n ?? 0) === 0) throw new MemberError('no_record', 'That record does not exist.');

  await db.query(
    `insert into ozikoro_saved (account_id, article_id) values ($1, $2)
     on conflict (account_id, article_id) do nothing`,
    [input.accountId, input.articleId]
  );
  return true;
}

/** One account's saved records, newest first. */
export async function listSaved(db: Db, input: { accountId: number; limit?: number }): Promise<LibraryRecord[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select s.article_id, a.slug, a.title, s.created_at as at
       from ozikoro_saved s
       join ozikoro_article a on a.id = s.article_id
      where s.account_id = $1
      order by s.created_at desc
      limit $2`,
    [input.accountId, input.limit ?? DEFAULT_LIMIT]
  );
  return rows.map(rowToRecord);
}

/**
 * Record that a signed-in reader has opened a record.
 *
 * Called by the record route, not by a control. `opens` counts and `read_at` moves; `first_read_at` is
 * written once and never touched again, because "when I found this" is the question reading history is
 * actually asked.
 *
 * ⚠️ **THE INSERT CANNOT FAIL ON A RECORD THAT IS NOT THERE.** The `where exists` makes the statement a
 * no-op rather than a foreign-key error, so a route that records a read on a page it then decides to
 * 404 does not turn that into a 500. The reader's page is more important than the statistic.
 */
export async function recordRead(db: Db, input: { accountId: number; articleId: number }): Promise<void> {
  await db.query(
    `insert into ozikoro_read_event (account_id, article_id)
     select $1, $2 where exists (select 1 from ozikoro_article where id = $2)
     on conflict (account_id, article_id) do update
       set read_at = now(), opens = ozikoro_read_event.opens + 1`,
    [input.accountId, input.articleId]
  );
}

/** One account's reading history, most recently opened first. */
export async function listReadingHistory(
  db: Db,
  input: { accountId: number; limit?: number }
): Promise<LibraryRecord[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select r.article_id, a.slug, a.title, r.read_at as at, r.opens
       from ozikoro_read_event r
       join ozikoro_article a on a.id = r.article_id
      where r.account_id = $1
      order by r.read_at desc
      limit $2`,
    [input.accountId, input.limit ?? DEFAULT_LIMIT]
  );
  return rows.map(rowToRecord);
}

/** Forget one record's reading history for one account. The reader's own act, on their own row. */
export async function forgetRead(db: Db, input: { accountId: number; articleId: number }): Promise<void> {
  await db.query(`delete from ozikoro_read_event where account_id = $1 and article_id = $2`, [
    input.accountId,
    input.articleId,
  ]);
}

/** Everything the header of the library page shows, in one round trip each. */
export async function libraryCounts(db: Db, accountId: number): Promise<LibraryCounts> {
  const row = await db.one<{ saved: number; following: number; history: number }>(
    `select
       (select count(*)::int from ozikoro_saved where account_id = $1) as saved,
       (select count(*)::int from ozikoro_follow where account_id = $1) as following,
       (select count(*)::int from ozikoro_read_event where account_id = $1) as history`,
    [accountId]
  );
  return {
    saved: Number(row?.saved ?? 0),
    following: Number(row?.following ?? 0),
    history: Number(row?.history ?? 0),
  };
}

/**
 * The topics one account follows.
 *
 * `listFollowing` already refuses to answer for an account other than the one asking, so the viewer is
 * the account here and the refusal cannot fire — **but it is passed rather than assumed**, because the
 * rule belongs to the function that owns it.
 */
export async function listFollowedTopics(db: Db, accountId: number): Promise<Follow[]> {
  const all = await listFollowing(db, { accountId, viewerId: accountId });
  return all.filter((follow) => follow.kind === 'topic');
}

/** Which of these records this account has already saved — the state a Save control has to show. */
export async function savedAmong(db: Db, input: { accountId: number; articleIds: number[] }): Promise<Set<number>> {
  if (input.articleIds.length === 0) return new Set();
  const rows = await db.rows<{ article_id: number }>(
    `select article_id from ozikoro_saved where account_id = $1 and article_id = any($2::bigint[])`,
    [input.accountId, input.articleIds]
  );
  return new Set(rows.map((row) => Number(row.article_id)));
}

function rowToRecord(row: Record<string, unknown>): LibraryRecord {
  return {
    articleId: Number(row.article_id),
    slug: String(row.slug),
    title: String(row.title),
    at: String(row.at),
    ...(row.opens === undefined || row.opens === null ? {} : { opens: Number(row.opens) }),
  };
}
