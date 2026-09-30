/**
 * XP, streaks and badges — the persistence layer.
 *
 * THE SAME GAP AS THE SCHEDULER
 *
 * `packages/core/src/gamification.ts` holds all of this and is tested: XP awards weighted by source,
 * a quadratic level curve, a time-zone-correct streak with freezes, and a small badge set. Migration
 * 0030 created `learn_xp_event`, `learn_streak`, `learn_badge` and `learn_user_badge` and designed
 * them well — the XP table even carries `unique (account_id, source, reference)` as an idempotency
 * key. Nothing read or wrote any of it, so a learner could answer a hundred questions and the
 * platform would still say they had done nothing.
 *
 * IDEMPOTENCY IS THE POINT, NOT A DETAIL
 *
 * XP is the one number a learner will notice being wrong, and the one number that is trivially
 * inflated by accident: a double-tapped button, a retried request, a replayed offline queue. The
 * unique constraint makes the database the arbiter rather than the application, so `awardXp` reports
 * whether the row was actually inserted and a second identical award is a no-op that returns zero.
 * Every caller can therefore be written as if it might be called twice, because it might be.
 *
 * TIME ZONES ARE LOAD-BEARING
 *
 * §F7 defines a day in the LEARNER's zone, and `localDay` in core does the conversion. This layer
 * stores the resulting day STRING in a `date` column and never derives a day itself — a
 * `timestamptz` cannot express "which day was that where they are", and computing it in SQL would
 * put the rule in two places that could disagree.
 */

import type { Db } from './client.ts';
import {
  BADGES,
  earnedBadges,
  levelProgress,
  localDay,
  newStreak,
  recordActiveDay,
  totalXp,
  xpForEvent,
  type Badge,
  type LevelProgress,
  type StreakOutcome,
  type StreakState,
  type XpSource,
} from '@ozituma/core';

/** Sources the database will accept, mirroring the check constraint in migration 0030. */
const VALID_SOURCES: readonly XpSource[] = [
  'lesson_completed',
  'exercise_correct',
  'review_session_completed',
  'placement_completed',
  'content_report_submitted',
];

export interface AwardResult {
  /** XP actually granted. Zero when this exact event was already recorded. */
  awarded: number;
  /** True when the row already existed, so the caller can avoid re-announcing it. */
  duplicate: boolean;
}

/**
 * Grant XP for one thing the learner did, at most once.
 *
 * `reference` is whatever identifies the event — an exercise id, a lesson slug, or a session key.
 * The pair `(source, reference)` is the key, so the same exercise answered twice is the same event;
 * a DIFFERENT exercise is a different one.
 *
 * `on conflict do nothing` plus `returning` is what makes the answer trustworthy: the row comes back
 * only if it was actually inserted, so `duplicate` is the database's statement rather than the
 * application's guess. A caller that read first and then inserted would race itself.
 */
export async function awardXp(
  db: Db,
  input: {
    accountId: number;
    source: XpSource;
    reference: string;
    repeat?: boolean;
  }
): Promise<AwardResult> {
  if (!VALID_SOURCES.includes(input.source)) {
    // A programming error rather than a user one. Thrown loudly rather than clamped, because
    // silently dropping an unknown source would hide a typo that costs learners their XP — and the
    // database would reject it anyway, with a far less obvious message.
    throw new Error(`Unknown XP source: ${input.source}`);
  }

  const repeat = input.repeat === true;
  const amount = xpForEvent({ source: input.source, referenceId: input.reference, repeat });

  const inserted = await db.rows<{ amount: number }>(
    `insert into learn_xp_event (account_id, source, reference, amount, repeat)
     values ($1, $2, $3, $4, $5)
     on conflict (account_id, source, reference) do nothing
     returning amount`,
    [input.accountId, input.source, input.reference, amount, repeat]
  );

  if (inserted.length === 0) return { awarded: 0, duplicate: true };
  return { awarded: Number(inserted[0]!.amount), duplicate: false };
}

export interface XpSummary {
  total: number;
  level: LevelProgress;
  /** XP by source, for a breakdown on the progress page. */
  bySource: { source: XpSource; amount: number; events: number }[];
}

/**
 * The learner's XP and level.
 *
 * Summed in SQL rather than by loading every event and calling `totalXp`, because a learner with a
 * year of history would otherwise pull thousands of rows into memory to display one number. `totalXp`
 * remains the definition of what the total means and is what the tests exercise; this is the same
 * arithmetic pushed to where the data is.
 */
export async function getXpSummary(db: Db, accountId: number): Promise<XpSummary> {
  const [row, bySourceRows] = await Promise.all([
    db.one<{ total: number | null }>(
      `select coalesce(sum(amount), 0)::int as total from learn_xp_event where account_id = $1`,
      [accountId]
    ),
    db.rows<{ source: string; amount: number; events: number }>(
      `select source, coalesce(sum(amount),0)::int as amount, count(*)::int as events
         from learn_xp_event where account_id = $1
        group by source order by amount desc`,
      [accountId]
    ),
  ]);

  const total = Number(row?.total ?? 0);
  return {
    total,
    level: levelProgress(total),
    bySource: bySourceRows.map((r) => ({
      source: r.source as XpSource,
      amount: Number(r.amount),
      events: Number(r.events),
    })),
  };
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

interface StreakRow {
  current: number;
  longest: number;
  last_active_day: string | Date | null;
  freezes_available: number;
  freezes_used: number;
  freezes_earned: number;
}

/**
 * `last_active_day` is a `date`, and drivers disagree about what that becomes.
 *
 * `pg` hands back a Date at local midnight; PGlite may hand back a string. Both must become the
 * `YYYY-MM-DD` the domain uses, and the failure mode of getting this wrong is a streak that resets
 * every day — which looks like a learner problem rather than a parsing one.
 */
function toDayString(value: string | Date | null): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rowToStreak(row: StreakRow): StreakState {
  return {
    current: Number(row.current),
    longest: Number(row.longest),
    lastActiveDay: toDayString(row.last_active_day),
    freezesAvailable: Number(row.freezes_available),
    freezesUsed: Number(row.freezes_used),
    freezesEarned: Number(row.freezes_earned),
  };
}

export async function getStreak(db: Db, accountId: number): Promise<StreakState> {
  const row = await db.one<StreakRow>(
    `select current, longest, last_active_day, freezes_available, freezes_used, freezes_earned
       from learn_streak where account_id = $1`,
    [accountId]
  );
  return row ? rowToStreak(row) : newStreak();
}

export interface ActivityResult {
  state: StreakState;
  outcome: StreakOutcome;
  /** True when this call was the one that extended the streak, so the UI can celebrate once. */
  changed: boolean;
}

/**
 * Record that the learner did something today, and advance the streak.
 *
 * READ-MODIFY-WRITE, AND WHY THAT IS ACCEPTABLE HERE
 *
 * The freeze rule lives in `recordActiveDay` in core — spend one freeze to cover a single missed day,
 * earn one per full week, hold at most two. Reimplementing that as a single SQL statement would put
 * the rule in two places, and the two would eventually disagree.
 *
 * So this reads, computes in core, and writes. Two concurrent requests from the SAME learner are the
 * only race, and both failure modes are benign: if both compute from the same day they write the
 * same value, and if a freeze were somehow spent twice the `check (freezes_available between 0 and 2)`
 * constraint rejects the write rather than letting the count go negative. The streak is also
 * idempotent per local day by design — calling it ten times moves it once — so the ordinary
 * double-tap is absorbed by the domain rather than by the database.
 */
export async function recordActivity(
  db: Db,
  accountId: number,
  timeZone: string,
  now: number = Date.now()
): Promise<ActivityResult> {
  const current = await getStreak(db, accountId);
  const result = recordActiveDay(current, now, timeZone);

  // `same_day` means nothing changed, and the `timezone_shift` case is explicitly "treated as the
  // same day". Both skip the write rather than issuing one that changes nothing.
  if (result.outcome === 'same_day' || result.outcome === 'timezone_shift') {
    return { state: result.state, outcome: result.outcome, changed: false };
  }

  const next = result.state;

  await db.rows(
    `insert into learn_streak (
       account_id, current, longest, last_active_day,
       freezes_available, freezes_used, freezes_earned, updated_at
     ) values ($1,$2,$3,$4::date,$5,$6,$7, now())
     on conflict (account_id) do update set
       current           = excluded.current,
       longest           = excluded.longest,
       last_active_day   = excluded.last_active_day,
       freezes_available = excluded.freezes_available,
       freezes_used      = excluded.freezes_used,
       freezes_earned    = excluded.freezes_earned,
       updated_at        = now()`,
    [
      accountId,
      next.current,
      next.longest,
      next.lastActiveDay,
      next.freezesAvailable,
      next.freezesUsed,
      next.freezesEarned,
    ]
  );

  return { state: next, outcome: result.outcome, changed: true };
}

/**
 * Whether the streak is still alive as of now, without recording anything.
 *
 * Reading a streak must not extend it — the page that says "4 days" would otherwise make it 5 just
 * by being opened. `streakIsAlive` in core answers the display question: a streak whose last day is
 * yesterday is still shown, because the learner has until midnight to keep it.
 */
export async function getStreakView(
  db: Db,
  accountId: number,
  timeZone: string,
  now: number = Date.now()
): Promise<StreakState & { alive: boolean; today: string; activeToday: boolean }> {
  const { streakIsAlive } = await import('@ozituma/core');
  const state = await getStreak(db, accountId);
  const today = localDay(now, timeZone);

  return {
    ...state,
    alive: streakIsAlive(state, now, timeZone),
    today,
    activeToday: state.lastActiveDay === today,
  };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export interface LearnerProgress {
  totalXp: number;
  level: LevelProgress;
  streak: StreakState & { alive: boolean; activeToday: boolean };
  badges: Badge[];
  stats: {
    lessonsCompleted: number;
    reviewsCompleted: number;
    correctAnswers: number;
    wordsTracked: number;
    wordsLearned: number;
  };
}

/**
 * Gather the stats the badge predicates are evaluated against.
 *
 * Every number here is counted from stored events rather than tracked incrementally, so the badges
 * are derivable from history rather than from a running total that can drift. `topicsCompleted` is
 * empty because lesson tags do not exist until the authored curriculum does — a badge that needs it
 * simply cannot be earned yet, which is the honest state rather than a fabricated one.
 */
async function gatherStats(
  db: Db,
  accountId: number
): Promise<{ stats: Parameters<typeof earnedBadges>[0]; wordsTracked: number; wordsLearned: number }> {
  const [lessons, reviews, correct, streak, words] = await Promise.all([
    db.one<{ n: number }>(
      `select count(distinct reference)::int as n from learn_xp_event
        where account_id = $1 and source = 'lesson_completed'`,
      [accountId]
    ),
    db.one<{ n: number }>(
      `select count(distinct reference)::int as n from learn_xp_event
        where account_id = $1 and source = 'review_session_completed'`,
      [accountId]
    ),
    db.one<{ n: number }>(
      `select count(*)::int as n from learn_xp_event
        where account_id = $1 and source = 'exercise_correct'`,
      [accountId]
    ),
    getStreak(db, accountId),
    // Words, and days active, both come from tables that already record them rather than from a
    // counter kept alongside.
    db.one<{ tracked: number; learned: number; active_days: number }>(
      `select (select count(*)::int from learn_item_state
                where account_id = $1 and item_kind = 'lexeme') as tracked,
              (select count(*)::int from learn_item_state
                where account_id = $1 and item_kind = 'lexeme'
                  and state in ('review','relearning')) as learned,
              (select count(distinct reviewed_at::date)::int from learn_review_log
                where account_id = $1) as active_days`,
      [accountId]
    ),
  ]);

  const wordsTracked = Number(words?.tracked ?? 0);
  const wordsLearned = Number(words?.learned ?? 0);
  const activeDays = Math.max(Number(words?.active_days ?? 0), streak.current);

  return {
    stats: {
      lessonsCompleted: Number(lessons?.n ?? 0),
      reviewsCompleted: Number(reviews?.n ?? 0),
      correctAnswers: Number(correct?.n ?? 0),
      streakLongest: streak.longest,
      topicsCompleted: [],
      activeDays,
    },
    wordsTracked,
    wordsLearned,
  };
}

/**
 * Award every badge the learner now qualifies for, and return the full set they hold.
 *
 * Badge definitions live in the database as well as in code, because the `learn_user_badge` table
 * references `learn_badge(id)` — so an id that is not present cannot be awarded at all. They are
 * upserted from `BADGES` on every call rather than by a migration: the code is the definition, and a
 * migration that had to be written every time a badge's wording changed would be a way for the two to
 * drift apart silently.
 */
export async function syncBadges(db: Db, accountId: number): Promise<Badge[]> {
  const { stats } = await gatherStats(db, accountId);

  for (const badge of BADGES) {
    await db.rows(
      `insert into learn_badge (id, name, description) values ($1,$2,$3)
       on conflict (id) do update set name = excluded.name, description = excluded.description`,
      [badge.id, badge.name, badge.description]
    );
  }

  const held = await db.rows<{ badge_id: string }>(
    `select badge_id from learn_user_badge where account_id = $1`,
    [accountId]
  );
  const alreadyEarned = held.map((row) => row.badge_id);
  const newly = earnedBadges(stats).filter((badge) => !alreadyEarned.includes(badge.id));

  for (const badge of newly) {
    await db.rows(
      `insert into learn_user_badge (account_id, badge_id) values ($1,$2)
       on conflict (account_id, badge_id) do nothing`,
      [accountId, badge.id]
    );
  }

  // Re-read so the returned set is what the database holds rather than what this call computed —
  // the difference matters when two requests race and the other one got there first.
  const finalRows = await db.rows<{ badge_id: string }>(
    `select badge_id from learn_user_badge where account_id = $1 order by earned_at, badge_id`,
    [accountId]
  );
  const ids = finalRows.map((row) => row.badge_id);
  return BADGES.filter((badge) => ids.includes(badge.id));
}

/** Everything the progress page needs, in one call. */
export async function getLearnerProgress(
  db: Db,
  accountId: number,
  timeZone: string
): Promise<LearnerProgress> {
  const [xp, streak, badges, gathered] = await Promise.all([
    getXpSummary(db, accountId),
    getStreakView(db, accountId, timeZone),
    syncBadges(db, accountId),
    gatherStats(db, accountId),
  ]);

  return {
    totalXp: xp.total,
    level: xp.level,
    streak,
    badges,
    stats: {
      lessonsCompleted: gathered.stats.lessonsCompleted,
      reviewsCompleted: gathered.stats.reviewsCompleted,
      correctAnswers: gathered.stats.correctAnswers,
      wordsTracked: gathered.wordsTracked,
      wordsLearned: gathered.wordsLearned,
    },
  };
}

/** Exported so a caller can total a list of events the way the XP table does. */
export { totalXp };
