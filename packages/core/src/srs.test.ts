/**
 * SRS tests.
 *
 * §F6 states two behaviours in plain words, and they are the two that matter most:
 *
 *   "Items answered wrongly return sooner; mastered items space out."
 *
 * Both are asserted directly below, against real numbers rather than against the shape of the
 * output — because those two sentences are the entire product claim of spaced repetition, and an
 * implementation that satisfies neither can still pass every structural test.
 *
 * The other load-bearing group is the review log. §F6 requires the log to keep "enough data to
 * move to FSRS later", and a log that is missing a field is not discovered to be missing until
 * the migration that needs it. So the log's completeness is asserted field by field.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQueue,
  estimateSeconds,
  isDue,
  mastery,
  masteryRate,
  newReviewState,
  schedule,
  updateEase,
  RATINGS,
  RATING_QUALITY,
  type Rating,
  type ReviewState,
} from './srs.ts';

const DAY = 86_400_000;
const MINUTE = 60_000;
/** A fixed clock. Nothing in this module reads the real one, which is why these tests are stable. */
const T0 = Date.UTC(2026, 8, 28, 9, 0, 0);

/** Drive a card through a sequence of ratings from new. */
function run(ratings: readonly Rating[], start = newReviewState(T0), options = {}) {
  let state = start;
  let clock = T0;
  const logs = [];
  for (const rating of ratings) {
    const result = schedule(state, rating, clock, options);
    state = result.state;
    logs.push(result.log);
    clock = state.dueAt;
  }
  return { state, logs, clock };
}

// ---------------------------------------------------------------------------
// Ease — SM-2's published formula, unchanged
// ---------------------------------------------------------------------------

test('the ease update matches SM-2 exactly for each rating', () => {
  // EF' = EF + (0.1 - (5-q)(0.08 + (5-q)0.02))
  assert.equal(updateEase(2.5, 5), 2.6, 'easy raises ease by 0.10');
  assert.equal(updateEase(2.5, 4), 2.5, 'good leaves ease unchanged');
  assert.equal(updateEase(2.5, 3), 2.36, 'hard lowers ease by 0.14');
  assert.equal(updateEase(2.5, 1), 1.96, 'again lowers ease by 0.54');
});

test('ease never falls below the SM-2 floor', () => {
  let ease = 2.5;
  for (let i = 0; i < 50; i += 1) ease = updateEase(ease, 1);
  assert.equal(ease, 1.3);
});

test('every rating maps to an explicit quality', () => {
  assert.deepEqual(RATING_QUALITY, { again: 1, hard: 3, good: 4, easy: 5 });
  for (const rating of RATINGS) {
    assert.ok(RATING_QUALITY[rating] >= 0 && RATING_QUALITY[rating] <= 5, rating);
  }
});

// ---------------------------------------------------------------------------
// §F6: "items answered wrongly return sooner"
// ---------------------------------------------------------------------------

test('a wrong answer returns SOONER than a right one — the §F6 requirement', () => {
  // Same starting point: a card that has graduated and is being reviewed.
  const learned: ReviewState = {
    ...newReviewState(T0),
    state: 'review',
    intervalDays: 30,
    ease: 2.5,
    repetitions: 4,
    dueAt: T0,
  };

  const wrong = schedule(learned, 'again', T0);
  const right = schedule(learned, 'good', T0);

  assert.ok(
    wrong.state.dueAt < right.state.dueAt,
    `again (${wrong.log.nextDueInMinutes} min) must come back before good`
  );
  // Concretely: a failure comes back inside the same session, not in a month.
  assert.ok(wrong.log.nextDueInMinutes <= 10, 'a lapse is retried in minutes');
  assert.ok(right.log.nextDueInMinutes > 60 * 24 * 20, 'a success is retried in weeks');
});

test('a wrong answer on a brand-new card also comes back within the session', () => {
  const { logs } = run(['again']);
  assert.ok(logs[0]!.nextDueInMinutes <= 10, `${logs[0]!.nextDueInMinutes} minutes`);
});

// ---------------------------------------------------------------------------
// §F6: "mastered items space out"
// ---------------------------------------------------------------------------

test('intervals grow with repeated success — the §F6 requirement', () => {
  const { logs } = run(['easy', 'good', 'good', 'good', 'good']);
  const intervals = logs.map((log) => log.intervalAfterDays);

  // After graduating, each success must be further out than the last.
  for (let i = 2; i < intervals.length; i += 1) {
    assert.ok(
      intervals[i]! > intervals[i - 1]!,
      `review ${i} interval ${intervals[i]} should exceed ${intervals[i - 1]}`
    );
  }
  assert.ok(intervals.at(-1)! >= 20, `ends up well spaced: ${intervals.at(-1)} days`);
});

test('the interval is capped so nothing vanishes for years', () => {
  let state = newReviewState(T0);
  let clock = T0;
  for (let i = 0; i < 40; i += 1) {
    const result = schedule(state, 'easy', clock, { maxIntervalDays: 365 });
    state = result.state;
    clock = state.dueAt;
  }
  assert.equal(state.intervalDays, 365);
});

// ---------------------------------------------------------------------------
// Learning steps
// ---------------------------------------------------------------------------

test('a new card moves through the learning steps before graduating', () => {
  const first = schedule(newReviewState(T0), 'good', T0, { learningStepsMinutes: [1, 10] });
  assert.equal(first.state.state, 'learning');
  assert.equal(first.log.nextDueInMinutes, 10);

  const second = schedule(first.state, 'good', first.state.dueAt, { learningStepsMinutes: [1, 10] });
  assert.equal(second.state.state, 'review', 'graduates after the last step');
  assert.equal(second.state.intervalDays, 1);
});

test('easy skips the learning steps entirely', () => {
  const result = schedule(newReviewState(T0), 'easy', T0);
  assert.equal(result.state.state, 'review');
  assert.equal(result.state.intervalDays, 4);
});

test('again restarts the learning steps', () => {
  const first = schedule(newReviewState(T0), 'good', T0, { learningStepsMinutes: [1, 10] });
  const back = schedule(first.state, 'again', first.state.dueAt, { learningStepsMinutes: [1, 10] });
  assert.equal(back.state.state, 'learning');
  assert.equal(back.state.learningStep, 0);
  assert.equal(back.log.nextDueInMinutes, 1);
});

// ---------------------------------------------------------------------------
// Lapses
// ---------------------------------------------------------------------------

test('failing a learned card counts a lapse and drops its ease', () => {
  const learned: ReviewState = {
    ...newReviewState(T0),
    state: 'review',
    intervalDays: 20,
    ease: 2.5,
    repetitions: 5,
    dueAt: T0,
  };
  const result = schedule(learned, 'again', T0);

  assert.equal(result.state.lapses, 1);
  assert.equal(result.state.state, 'relearning');
  assert.equal(result.state.repetitions, 0, 'the success streak resets');
  assert.ok(result.state.ease < learned.ease, 'ease is penalised');
  assert.equal(result.log.lapse, true);
});

test('a lapse on a card still learning is not counted as forgetting it', () => {
  // It was never learned, so "forgot it" would be false.
  const { logs } = run(['good', 'again']);
  assert.equal(logs[1]!.lapse, false);
});

test('a relearned card graduates on a shorter interval than a fresh one', () => {
  const relearned: ReviewState = {
    ...newReviewState(T0),
    state: 'relearning',
    learningStep: 0,
    ease: 1.96,
    intervalDays: 20,
    dueAt: T0,
  };
  const result = schedule(relearned, 'good', T0, { learningStepsMinutes: [1] });
  assert.equal(result.state.state, 'review');
  assert.equal(result.state.intervalDays, 1, 'comes back quickly, not at 20 days');
});

// ---------------------------------------------------------------------------
// The review log, for the FSRS migration
// ---------------------------------------------------------------------------

test('the log records everything an FSRS optimiser needs', () => {
  const learned: ReviewState = {
    ...newReviewState(T0 - 10 * DAY),
    state: 'review',
    intervalDays: 10,
    ease: 2.5,
    repetitions: 3,
    dueAt: T0,
    // Set explicitly: newReviewState always starts unreviewed, so spreading it would otherwise
    // leave this null and the elapsed-interval assertion below would be vacuous.
    lastReviewedAt: T0 - 10 * DAY,
  };
  const { log } = schedule(learned, 'good', T0);

  // Each of these is a field FSRS fits a memory model against. Asserted individually so a
  // future refactor that drops one fails here rather than at migration time.
  assert.equal(log.itemId, '', 'the caller fills this in');
  assert.equal(log.rating, 'good');
  assert.equal(log.quality, 4, 'the mapped quality is stored, not just the rating');
  assert.equal(log.reviewedAt, T0);
  assert.equal(log.elapsedDays, 10, 'days since the previous review');
  assert.equal(log.stateBefore, 'review');
  assert.equal(log.stateAfter, 'review');
  assert.equal(log.intervalBeforeDays, 10);
  assert.ok(log.intervalAfterDays > 0);
  assert.equal(log.easeBefore, 2.5);
  assert.ok(log.easeAfter > 0);
  assert.equal(log.lapse, false);
  assert.ok(log.nextDueInMinutes > 0);
});

test('a first review logs a null elapsed interval rather than a wrong number', () => {
  const { log } = schedule(newReviewState(T0), 'good', T0);
  assert.equal(log.elapsedDays, null);
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test('scheduling is pure — same inputs, same outputs, and the input is not mutated', () => {
  const state: ReviewState = {
    ...newReviewState(T0),
    state: 'review',
    intervalDays: 7,
    ease: 2.5,
    repetitions: 2,
    dueAt: T0,
  };
  const snapshot = JSON.stringify(state);

  const a = schedule(state, 'good', T0);
  const b = schedule(state, 'good', T0);

  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.log, b.log);
  assert.equal(JSON.stringify(state), snapshot, 'the input state was mutated');
});

test('isDue compares against the clock, not the wall clock', () => {
  const state = { ...newReviewState(T0), dueAt: T0 + 5 * MINUTE };
  assert.equal(isDue(state, T0), false);
  assert.equal(isDue(state, T0 + 5 * MINUTE), true);
  assert.equal(isDue(state, T0 + 9 * DAY), true);
});

// ---------------------------------------------------------------------------
// The daily queue (§F6)
// ---------------------------------------------------------------------------

function card(id: string, dueOffsetDays: number, isNew = false): { itemId: string; isNew: boolean; state: ReviewState } {
  return {
    itemId: id,
    isNew,
    state: { ...newReviewState(T0), state: isNew ? 'new' : 'review', dueAt: T0 + dueOffsetDays * DAY },
  };
}

test('due reviews come before new material', () => {
  // The ordering that stops a busy learner spending every session on novelty and never
  // clearing the backlog.
  const queue = buildQueue(
    [card('new-1', 0, true), card('due-1', -2), card('due-2', -1), card('new-2', 0, true)],
    T0
  );
  const dueIndexes = queue.itemIds.filter((id) => id.startsWith('due')).length;
  assert.equal(queue.itemIds.slice(0, dueIndexes).every((id) => id.startsWith('due')), true);
  assert.equal(queue.dueCount, 2);
  assert.equal(queue.newCount, 2);
});

test('the most overdue item comes first', () => {
  const queue = buildQueue([card('a', -1), card('b', -10), card('c', -3)], T0);
  assert.deepEqual(queue.itemIds, ['b', 'c', 'a']);
});

test('items not yet due are left out', () => {
  const queue = buildQueue([card('future', +5), card('now', 0)], T0);
  assert.deepEqual(queue.itemIds, ['now']);
});

test('the queue respects the learner stated time budget', () => {
  const many = Array.from({ length: 50 }, (_, i) => card(`due-${i}`, -1));
  const queue = buildQueue(many, T0, { minutesAvailable: 2 });

  assert.equal(queue.truncated, true, 'says so rather than silently dropping work');
  assert.ok(queue.estimatedMinutes <= 2, `${queue.estimatedMinutes} minutes fits the budget`);
  assert.ok(queue.itemIds.length > 0 && queue.itemIds.length < 50);
});

test('the new-item cap holds even with unlimited time', () => {
  const fresh = Array.from({ length: 100 }, (_, i) => card(`new-${i}`, 0, true));
  const queue = buildQueue(fresh, T0, { maxNew: 5 });
  assert.equal(queue.newCount, 5);
  assert.equal(queue.truncated, true);
});

test('new items are skipped entirely when the due backlog already fills the budget', () => {
  const items = [
    ...Array.from({ length: 20 }, (_, i) => card(`due-${i}`, -1)),
    card('new-1', 0, true),
  ];
  const queue = buildQueue(items, T0, { minutesAvailable: 1 });
  assert.equal(queue.newCount, 0, 'reviews were protected from the new items');
});

test('an empty queue is reported as empty, not as an error', () => {
  const queue = buildQueue([], T0);
  assert.deepEqual(queue.itemIds, []);
  assert.equal(queue.estimatedMinutes, 0);
  assert.equal(queue.truncated, false);
});

test('a new item is estimated to cost more time than a review', () => {
  assert.ok(estimateSeconds(true) > estimateSeconds(false));
});

// ---------------------------------------------------------------------------
// Mastery (§10.1)
// ---------------------------------------------------------------------------

test('mastery rises as a card is learned and falls when it is forgotten', () => {
  const fresh = newReviewState(T0);
  assert.equal(mastery(fresh, T0), 0);

  let state = fresh;
  let clock = T0;
  for (let i = 0; i < 6; i += 1) {
    const result = schedule(state, 'good', clock);
    state = result.state;
    clock = state.dueAt;
  }
  const learned = mastery(state, T0);

  const lapsed = schedule(state, 'again', clock).state;
  assert.ok(mastery(lapsed, T0) < learned, 'a lapse reduces mastery');
  assert.ok(learned > 0.4, `a well-reviewed card scores ${learned}`);
});

test('the mastery rate counts only attempted items', () => {
  const states = [
    // Never seen: must not count toward the denominator at all, or a large untouched deck would
    // make a diligent learner look like a failing one.
    newReviewState(T0),
    newReviewState(T0),
    // Attempted and well known.
    { ...newReviewState(T0), state: 'review' as const, intervalDays: 200, repetitions: 8 },
    // Attempted but still being learned.
    { ...newReviewState(T0), state: 'learning' as const, learningStep: 1 },
  ];
  // Two attempted, one mastered -> 0.5.
  assert.equal(masteryRate(states, T0), 0.5);
  assert.equal(masteryRate([newReviewState(T0)], T0), 0, 'nothing attempted yet');
});
