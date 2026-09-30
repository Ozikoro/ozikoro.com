/**
 * Persistence for the spaced-repetition scheduler.
 *
 * WHAT WAS MISSING
 *
 * `packages/core/src/srs.ts` has the whole scheduler — SM-2 with learning steps, ease, lapses and a
 * time-budgeted queue builder — and it is tested. What it did not have was anything that stores a
 * result: `learn_item_state` and `learn_review_log` were created by migration 0030 and had no code
 * reading or writing them. So every review a learner did was discarded the moment the page changed,
 * and "tomorrow you should review these eight words" was not a sentence the platform could say.
 *
 * This is that layer, and it is the difference between practice and study. Practice asks a question;
 * a schedule decides when to ask it again, which is the only part of this that makes words stick.
 *
 * ATOMICITY, WITHOUT A TRANSACTION API
 *
 * Recording a review is two writes: the item's new state, and a log row describing the transition.
 * If only the first lands, the schedule advances with no history; if only the second lands, the log
 * claims a change that never happened — and the log is what an FSRS optimiser would later be fitted
 * against, so a row that disagrees with the state is worse than a missing one.
 *
 * `Db` has no `transaction()`, so rather than add one and thread it through, the two writes are a
 * SINGLE statement: an `insert … on conflict` inside a data-modifying CTE, with the log insert
 * selecting from it. Postgres runs one statement in one implicit transaction, so the pair cannot
 * half-apply. The `returning` clause is what makes the second half conditional on the first having
 * happened at all.
 *
 * THE BEFORE VALUES COME FROM THE CALLER
 *
 * `schedule()` in core takes the current state and returns both the next state and a fully-populated
 * log — interval before and after, ease before and after, whether it was a lapse. So the before
 * values are already in hand, and this layer does not have to re-read the row to discover them. That
 * also means the logged history matches what the scheduler actually decided, rather than what the
 * database happened to hold a moment later.
 */

import type { Db } from './client.ts';
import { getStorage } from './storage.ts';
import {
  newReviewState,
  schedule,
  type CardState,
  type Rating,
  type ReviewState,
  type ScheduleOptions,
  type ScheduleResult,
} from '@ozituma/core';

/** The only item kind that exists today. The column allows grammar and culture notes too. */
export type ItemKind = 'lexeme' | 'grammar_note' | 'culture_note';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** A row of `learn_item_state`, as stored. */
interface StateRow {
  state: string;
  ease: number;
  interval_days: number;
  learning_step: number;
  repetitions: number;
  lapses: number;
  due_at: Date | string;
  last_reviewed_at: Date | string | null;
}

/**
 * Postgres hands timestamps back as `Date` under `pg` and as a string under some drivers.
 *
 * Both are converted explicitly rather than relying on `new Date(value)` doing the right thing,
 * because the failure mode is silent: a mis-parsed timestamp produces a valid Date that is hours
 * wrong, and the symptom is a review queue that is empty in the morning and full at midnight.
 */
function toEpochMs(value: Date | string | null): number | null {
  if (value === null) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToState(row: StateRow): ReviewState {
  return {
    state: row.state as CardState,
    ease: Number(row.ease),
    intervalDays: Number(row.interval_days),
    learningStep: Number(row.learning_step),
    repetitions: Number(row.repetitions),
    lapses: Number(row.lapses),
    dueAt: toEpochMs(row.due_at) ?? Date.now(),
    lastReviewedAt: toEpochMs(row.last_reviewed_at),
  };
}

/**
 * The learner's current state for one item, or a brand new card.
 *
 * Absence is not an error. A word with no row is a word never reviewed, which is exactly what
 * `newReviewState` describes — so "no row" and "a new card" are the same thing, and callers do not
 * have to distinguish them.
 */
export async function loadReviewState(
  db: Db,
  accountId: number,
  itemId: string,
  itemKind: ItemKind = 'lexeme'
): Promise<ReviewState> {
  const row = await db.one<StateRow>(
    `select state, ease, interval_days, learning_step, repetitions, lapses, due_at, last_reviewed_at
       from learn_item_state
      where account_id = $1 and item_kind = $2 and item_id = $3`,
    [accountId, itemKind, itemId]
  );
  return row ? rowToState(row) : newReviewState(Date.now());
}

export interface RecordReviewInput {
  accountId: number;
  itemId: string;
  itemKind?: ItemKind;
  rating: Rating;
  /** Milliseconds the learner took, if the client measured it. §F5 asks for it. */
  elapsedMs?: number | null;
  /** The exact answer given, for the log. Truncated before storage. */
  response?: string | null;
  /** The `learn_attempt` row that produced this, when there is one. */
  exerciseId?: number | null;
  /** Injectable for tests; defaults to now. */
  now?: number;
  scheduleOptions?: ScheduleOptions;
}

/**
 * Grade one review, advance its schedule, and record both.
 *
 * Returns the same `ScheduleResult` core produced, so a caller can tell the learner when they will
 * see the word again without a second read.
 */
export async function recordReview(db: Db, input: RecordReviewInput): Promise<ScheduleResult> {
  const now = input.now ?? Date.now();
  const itemKind = input.itemKind ?? 'lexeme';

  const current = await loadReviewState(db, input.accountId, input.itemId, itemKind);
  const result = schedule(current, input.rating, now, input.scheduleOptions);
  const { state, log } = result;

  // One statement, so the state and its history cannot disagree. See the note at the top of the
  // file for why this is a CTE rather than two awaits.
  await db.rows(
    `with advanced as (
       insert into learn_item_state (
         account_id, item_kind, item_id, state, ease, interval_days, learning_step,
         repetitions, lapses, due_at, last_reviewed_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10 / 1000.0), to_timestamp($11 / 1000.0), now())
       on conflict (account_id, item_kind, item_id) do update set
         state            = excluded.state,
         ease             = excluded.ease,
         interval_days    = excluded.interval_days,
         learning_step    = excluded.learning_step,
         repetitions      = excluded.repetitions,
         lapses           = excluded.lapses,
         due_at           = excluded.due_at,
         last_reviewed_at = excluded.last_reviewed_at,
         updated_at       = now()
       returning 1 as ok
     )
     insert into learn_review_log (
       account_id, item_kind, item_id, rating, quality, exercise_id, elapsed_ms, response,
       state_before, state_after, interval_before_days, interval_after_days,
       ease_before, ease_after, elapsed_days, lapse, reviewed_at
     )
     select $1,$2,$3,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
       from advanced`,
    [
      input.accountId,
      itemKind,
      input.itemId,
      state.state,
      state.ease,
      state.intervalDays,
      state.learningStep,
      state.repetitions,
      state.lapses,
      state.dueAt,
      state.lastReviewedAt,
      input.rating,
      log.quality,
      input.exerciseId ?? null,
      input.elapsedMs ?? null,
      // Truncated rather than rejected: an over-long response is a client bug, not a reason to lose
      // the review. The column is text and a 10 KB answer helps nobody.
      input.response ? input.response.slice(0, 500) : null,
      log.stateBefore,
      log.stateAfter,
      log.intervalBeforeDays,
      log.intervalAfterDays,
      log.easeBefore,
      log.easeAfter,
      log.elapsedDays,
      log.lapse,
      new Date(now),
    ]
  );

  return result;
}

// ---------------------------------------------------------------------------
// The daily plan
// ---------------------------------------------------------------------------

export interface DueWord {
  /** `word.id`, as a string — it is a bigint and JS numbers lose it past 2^53. */
  itemId: string;
  headword: string;
  slug: string;
  english: string;
  audioUrl: string | null;
  isNew: boolean;
  state: CardState;
  dueAt: number;
}

export interface DailyPlan {
  items: DueWord[];
  dueCount: number;
  newCount: number;
  estimatedMinutes: number;
  truncated: boolean;
  /** Everything tracked for this learner, so the page can say how big the deck is. */
  trackedTotal: number;
}

export interface PlanOptions {
  /** §F6: the plan adapts to how long the learner says they have. */
  minutesAvailable?: number;
  maxNew?: number;
  maxItems?: number;
}

/** Words the learner has met whose schedule says they are due. */
async function dueWords(
  db: Db,
  accountId: number,
  limit: number
): Promise<(DueWord & { difficulty: number })[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select s.item_id, s.state, s.ease, s.interval_days, s.learning_step, s.repetitions,
            s.lapses, s.due_at, s.last_reviewed_at,
            w.headword, w.slug,
            (select d.text from definition d where d.word_id = w.id
              order by d.is_primary desc, d.position, d.id limit 1) as english,
            (select a.storage_key from audio a
              where a.word_id = w.id and a.status = 'published'
              order by a.created_at, a.id limit 1) as storage_key,
            (select a.external_url from audio a
              where a.word_id = w.id and a.status = 'published'
              order by a.created_at, a.id limit 1) as external_url
       from learn_item_state s
       join word w on w.id = s.item_id
      where s.account_id = $1
        and s.item_kind = 'lexeme'
        and s.due_at <= now()
        and w.status = 'published'
        and exists (select 1 from definition d where d.word_id = w.id)
      order by s.due_at, s.item_id
      limit $2`,
    [accountId, limit]
  );

  const storage = safeStorage();
  return rows
    .filter((row) => typeof row.english === 'string' && String(row.english).trim() !== '')
    .map((row) => {
      const ease = Number(row.ease);
      return {
        itemId: String(row.item_id),
        headword: String(row.headword),
        slug: String(row.slug),
        english: String(row.english),
        // Same resolution order as the dictionary entry page and the practice route, so a word
        // sounds the same wherever it is met.
        audioUrl:
          (row.external_url as string | null) ??
          (row.storage_key && storage ? storage.publicUrl(String(row.storage_key)) : null),
        isNew: false,
        state: String(row.state) as CardState,
        dueAt: toEpochMs(row.due_at as Date | string) ?? Date.now(),
        // A lower ease means the learner has found this harder, so it is shown later in the
        // time-budgeted sort. Derived from ease rather than stored, because ease is the thing the
        // scheduler actually maintains.
        difficulty: ease <= 1.6 ? 5 : ease <= 2.0 ? 4 : ease <= 2.4 ? 3 : ease <= 2.8 ? 2 : 1,
      };
    });
}

/**
 * Words the learner has never met, in the corpus's own frequency order.
 *
 * `not exists` against the state table is what makes "new" mean new. It is the same shape the
 * practice route uses, so a word cannot be simultaneously unseen by practice and seen by the plan.
 */
async function newWords(
  db: Db,
  accountId: number,
  limit: number
): Promise<(DueWord & { difficulty: number })[]> {
  if (limit <= 0) return [];

  const rows = await db.rows<Record<string, unknown>>(
    `select w.id, w.headword, w.slug,
            (select d.text from definition d where d.word_id = w.id
              order by d.is_primary desc, d.position, d.id limit 1) as english,
            (select a.storage_key from audio a
              where a.word_id = w.id and a.status = 'published'
              order by a.created_at, a.id limit 1) as storage_key,
            (select a.external_url from audio a
              where a.word_id = w.id and a.status = 'published'
              order by a.created_at, a.id limit 1) as external_url
       from word w
      where w.language_code = 'ibo'
        and w.status = 'published'
        and exists (select 1 from definition d where d.word_id = w.id)
        and not exists (
          select 1 from learn_item_state s
           where s.account_id = $1 and s.item_kind = 'lexeme' and s.item_id = w.id
        )
      order by w.is_common desc nulls last, w.frequency_rank asc nulls last, w.headword
      limit $2`,
    [accountId, limit]
  );

  const storage = safeStorage();
  return rows
    .filter((row) => typeof row.english === 'string' && String(row.english).trim() !== '')
    .map((row) => ({
      itemId: String(row.id),
      headword: String(row.headword),
      slug: String(row.slug),
      english: String(row.english),
      audioUrl:
        (row.external_url as string | null) ??
        (row.storage_key && storage ? storage.publicUrl(String(row.storage_key)) : null),
      isNew: true,
      state: 'new' as CardState,
      dueAt: Date.now(),
      difficulty: 1,
    }));
}

/**
 * Build today's plan for a learner.
 *
 * DUE BEFORE NEW, and that ordering is the whole design. Due items are the ones the schedule says
 * are about to be forgotten; new items are optional by comparison. A plan that offers novelty first
 * means that on a busy day the learner spends their time on new words and never reaches the
 * reviews — which is precisely how spaced repetition fails in practice, and why `buildQueue` in core
 * orders them this way too.
 *
 * The time budget is applied by core's `buildQueue` rather than here, so the estimate and the
 * truncation rule live beside the scheduler that they describe instead of in a query.
 */
export async function getDailyPlan(
  db: Db,
  accountId: number,
  options: PlanOptions = {}
): Promise<DailyPlan> {
  // A hard ceiling on rows read, before the time budget trims further. Without it a learner
  // returning after a month would pull their whole deck into memory to then show eight items.
  const readLimit = Math.max(options.maxItems ?? 60, 20);

  const [due, tracked] = await Promise.all([
    dueWords(db, accountId, readLimit),
    db.one<{ n: number }>(
      `select count(*)::int as n from learn_item_state where account_id = $1 and item_kind = 'lexeme'`,
      [accountId]
    ),
  ]);

  const minutes = options.minutesAvailable ?? 10;
  const maxNew = options.maxNew ?? 10;
  const maxItems = options.maxItems ?? 40;

  // Core decides how many fit. It receives the due items as already-due and the new ones as
  // never-seen, which is exactly the distinction it needs.
  const { buildQueue } = await import('@ozituma/core');
  const planned = buildQueue(
    [
      ...due.map((item) => ({ itemId: item.itemId, difficulty: item.difficulty, isNew: false, state: placeholderState() })),
      ...(await newWords(db, accountId, maxNew)).map((item) => ({
        itemId: item.itemId,
        difficulty: item.difficulty,
        isNew: true,
        state: placeholderState(),
      })),
    ],
    Date.now(),
    { minutesAvailable: minutes, maxNew, maxItems }
  );

  // `buildQueue` works on ids and does not carry the word back, so the chosen ids are mapped onto
  // the rows already read. Anything the queue dropped is simply not selected.
  const byId = new Map<string, DueWord>();
  for (const item of [...due, ...(await newWords(db, accountId, maxNew))]) byId.set(item.itemId, item);

  const items = planned.itemIds
    .map((id) => byId.get(id))
    .filter((item): item is DueWord => item !== undefined);

  return {
    items,
    dueCount: planned.dueCount,
    newCount: planned.newCount,
    estimatedMinutes: planned.estimatedMinutes,
    truncated: planned.truncated,
    trackedTotal: Number(tracked?.n ?? 0),
  };
}

/**
 * `buildQueue` reads only `isNew` and `difficulty` from an item and never touches its `state`.
 *
 * The field is required by the type, so it is supplied rather than the signature being widened —
 * widening a domain type to suit one caller is how a type stops meaning anything.
 */
function placeholderState(): ReviewState {
  return newReviewState(0);
}

/** Counts for the header and the landing page, without building a plan. */
export async function getReviewSummary(
  db: Db,
  accountId: number
): Promise<{ dueNow: number; tracked: number; learned: number }> {
  const row = await db.one<{ due: number; tracked: number; learned: number }>(
    `select count(*) filter (where s.due_at <= now())::int as due,
            count(*)::int as tracked,
            count(*) filter (where s.state in ('review','relearning'))::int as learned
       from learn_item_state s
       join word w on w.id = s.item_id
      where s.account_id = $1 and s.item_kind = 'lexeme' and w.status = 'published'`,
    [accountId]
  );
  return {
    dueNow: Number(row?.due ?? 0),
    tracked: Number(row?.tracked ?? 0),
    learned: Number(row?.learned ?? 0),
  };
}

/** Exported for tests, and for a caller that needs to reason about spacing. */
export { MINUTE_MS, DAY_MS };

/**
 * Resolve storage without letting a missing media configuration take the plan down.
 *
 * Same reasoning as the practice module: hearing a word and seeing it are separable, and a
 * misconfigured bucket should cost the learner the audio, not the whole plan.
 */
function safeStorage(): { publicUrl(key: string): string } | null {
  try {
    return getStorage();
  } catch {
    return null;
  }
}
