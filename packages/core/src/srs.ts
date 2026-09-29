/**
 * Spaced repetition — an SM-2 variant, plus the daily review queue.
 *
 * Spec §F6: "Each learner-item pair has an SRS state. Use a simple, well-known scheduling
 * algorithm (SM-2 variant) at launch; the review log must keep enough data to move to FSRS
 * later."
 *
 * WHY SM-2 AND NOT FSRS YET
 *
 * FSRS is better, and it needs a lot of review history per learner before it beats SM-2. A new
 * platform has none. Shipping SM-2 first and switching later is the right order, and the switch
 * is only possible if the log has been capturing the right things all along — which is why the
 * log record here is deliberately over-specified. It stores the rating, the elapsed interval,
 * the interval before and after, the ease before and after, and whether the review was a lapse.
 * That is what an FSRS optimiser needs to fit a memory model. Recording only "when is it next
 * due" is the mistake that makes a later upgrade impossible without throwing the history away.
 *
 * WHY THERE ARE MINUTE-SCALE STEPS IN A DAY-SCALE ALGORITHM
 *
 * Plain SM-2 schedules everything in whole days. §F6 requires that "items answered wrongly
 * return sooner", and against a day-scale algorithm there is no such thing as sooner — a lapsed
 * item comes back tomorrow, exactly like everything else. So the first exposure uses short
 * learning steps measured in minutes (the thing every spaced-repetition app does), and items
 * graduate to SM-2's day-scale intervals once they are known.
 *
 * WHY THE RATINGS ARE FOUR AND NOT SIX
 *
 * SM-2's canonical input is a quality 0–5. §F6 requires learners to rate as Again/Hard/Good/Easy,
 * which is four. The mapping is explicit ({@link RATING_QUALITY}) rather than implied, so the
 * conversion is inspectable and testable, and so changing it is a one-line change with
 * consequences that can be measured.
 */

/** What a learner can say about their own recall (§F6). */
export type Rating = 'again' | 'hard' | 'good' | 'easy';

export const RATINGS: readonly Rating[] = ['again', 'hard', 'good', 'easy'];

/**
 * SM-2 quality, 0–5. Again is 1 rather than 0: 0 means "complete blackout, the answer was not
 * even recognised", which is a different and rarer event than "I could not produce it", and
 * treating every failure as a blackout drives ease into the floor within a few sessions.
 */
export const RATING_QUALITY: Record<Rating, number> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
};

/** Where a card is in its life. */
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface ReviewState {
  state: CardState;
  /** Ease factor. SM-2's EF; see the update rule in `schedule`. Floored at 1.3. */
  ease: number;
  /** Current interval in days. 0 while the card is still in minute-scale learning. */
  intervalDays: number;
  /** Index into the learning steps, while the card is learning or relearning. */
  learningStep: number;
  /** Consecutive successful reviews. Reset by a lapse. */
  repetitions: number;
  /** How many times this card has been forgotten after having been learned. */
  lapses: number;
  /** Epoch milliseconds. */
  dueAt: number;
  /** Epoch milliseconds of the last review, or null if never reviewed. */
  lastReviewedAt: number | null;
}

export interface ReviewLogEntry {
  itemId: string;
  rating: Rating;
  /** SM-2 quality the rating mapped to. Stored so a mapping change is visible in history. */
  quality: number;
  reviewedAt: number;
  /** Days since the previous review of this item; null for a first review. */
  elapsedDays: number | null;
  stateBefore: CardState;
  stateAfter: CardState;
  intervalBeforeDays: number;
  intervalAfterDays: number;
  easeBefore: number;
  easeAfter: number;
  /** True when the learner failed a card that had already been learned. */
  lapse: boolean;
  /** Minutes until the next review. Kept verbatim because it is what the learner experienced. */
  nextDueInMinutes: number;
}

export interface ScheduleResult {
  state: ReviewState;
  log: ReviewLogEntry;
}

export interface ScheduleOptions {
  /** Learning steps in minutes, for new and relearned cards. */
  learningStepsMinutes?: readonly number[];
  /** Interval granted when a card graduates from learning on Good. */
  graduatingIntervalDays?: number;
  /** Interval granted immediately on Easy. */
  easyIntervalDays?: number;
  /** Interval granted when a lapsed card graduates from relearning. */
  relearningGraduatingDays?: number;
  /** Ceiling, so nothing is scheduled beyond a point where the learner will have forgotten it. */
  maxIntervalDays?: number;
  /** Floor for ease. SM-2's own value. */
  minEase?: number;
}

const DEFAULTS = {
  // Two steps is the common default and enough to make "again" mean something within a session
  // without making a new card tedious.
  learningStepsMinutes: [1, 10] as readonly number[],
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  relearningGraduatingDays: 1,
  // A year. Beyond this the scheduling signal is weaker than the drift in a learner's life, and
  // a card scheduled for 2032 is a card nobody sees again.
  maxIntervalDays: 365,
  minEase: 1.3,
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** A brand new card, due now. */
export function newReviewState(now: number): ReviewState {
  return {
    state: 'new',
    ease: 2.5,
    intervalDays: 0,
    learningStep: 0,
    repetitions: 0,
    lapses: 0,
    dueAt: now,
    lastReviewedAt: null,
  };
}

/**
 * SM-2's ease update, unchanged.
 *
 * EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
 *
 * Worth keeping exactly as published rather than "improving": it is well understood, its
 * behaviour on each of the four ratings is documented above, and a variant that drifts from the
 * literature is no longer the thing this module claims to implement.
 *
 *   easy (q=5)  +0.10     good (q=4)   0.00
 *   hard (q=3)  −0.14     again (q=1) −0.54
 */
export function updateEase(ease: number, quality: number, minEase = DEFAULTS.minEase): number {
  const next = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return Math.max(minEase, Number(next.toFixed(4)));
}

function clampInterval(days: number, max: number): number {
  return Math.min(max, Math.max(1, Math.round(days)));
}

/**
 * Apply one review.
 *
 * Pure: takes a state and a rating, returns the next state and a log entry. No clock, no
 * database, no randomness — which is what makes the whole scheduling policy testable and what
 * lets the same function run on the server and, later, on a client reconciling offline reviews.
 */
export function schedule(
  state: ReviewState,
  rating: Rating,
  now: number,
  options: ScheduleOptions = {}
): ScheduleResult {
  const steps = options.learningStepsMinutes ?? DEFAULTS.learningStepsMinutes;
  const graduating = options.graduatingIntervalDays ?? DEFAULTS.graduatingIntervalDays;
  const easyInterval = options.easyIntervalDays ?? DEFAULTS.easyIntervalDays;
  const relearningGraduating = options.relearningGraduatingDays ?? DEFAULTS.relearningGraduatingDays;
  const maxInterval = options.maxIntervalDays ?? DEFAULTS.maxIntervalDays;
  const minEase = options.minEase ?? DEFAULTS.minEase;

  const quality = RATING_QUALITY[rating];
  const elapsedDays =
    state.lastReviewedAt === null ? null : (now - state.lastReviewedAt) / DAY_MS;

  let next: ReviewState;
  let lapse = false;

  switch (state.state) {
    // ---------------------------------------------------------------------
    // A card the learner has never seen.
    // ---------------------------------------------------------------------
    case 'new': {
      if (rating === 'again') {
        next = { ...state, state: 'learning', learningStep: 0, dueAt: now + steps[0]! * MINUTE_MS };
      } else if (rating === 'hard') {
        // Between the first step and the second: not a failure, but not a pass either.
        const minutes = steps[0]! * 3;
        next = { ...state, state: 'learning', learningStep: 0, dueAt: now + minutes * MINUTE_MS };
      } else if (rating === 'good') {
        const step = Math.min(1, steps.length - 1);
        next = {
          ...state,
          state: 'learning',
          learningStep: step,
          dueAt: now + steps[step]! * MINUTE_MS,
        };
      } else {
        // Easy on a brand-new card: skip the steps entirely. The learner has said they know it.
        next = {
          ...state,
          state: 'review',
          intervalDays: easyInterval,
          repetitions: 1,
          dueAt: now + easyInterval * DAY_MS,
        };
      }
      break;
    }

    // ---------------------------------------------------------------------
    // Learning, or relearning after a lapse. Both move through minute steps.
    // ---------------------------------------------------------------------
    case 'learning':
    case 'relearning': {
      const relearning = state.state === 'relearning';
      const graduateDays = relearning ? relearningGraduating : graduating;

      if (rating === 'again') {
        next = {
          ...state,
          learningStep: 0,
          dueAt: now + steps[0]! * MINUTE_MS,
        };
      } else if (rating === 'hard') {
        next = {
          ...state,
          dueAt: now + steps[state.learningStep]! * 2 * MINUTE_MS,
        };
      } else if (rating === 'good') {
        const nextStep = state.learningStep + 1;
        if (nextStep >= steps.length) {
          next = {
            ...state,
            state: 'review',
            learningStep: 0,
            intervalDays: graduateDays,
            repetitions: state.repetitions + 1,
            dueAt: now + graduateDays * DAY_MS,
          };
        } else {
          next = {
            ...state,
            learningStep: nextStep,
            dueAt: now + steps[nextStep]! * MINUTE_MS,
          };
        }
      } else {
        next = {
          ...state,
          state: 'review',
          learningStep: 0,
          intervalDays: easyInterval,
          repetitions: state.repetitions + 1,
          dueAt: now + easyInterval * DAY_MS,
        };
      }
      break;
    }

    // ---------------------------------------------------------------------
    // A learned card. This is plain SM-2.
    // ---------------------------------------------------------------------
    case 'review': {
      const ease = updateEase(state.ease, quality, minEase);

      if (rating === 'again') {
        lapse = true;
        // Back to relearning, with the ease penalty already applied.
        next = {
          ...state,
          state: 'relearning',
          ease,
          learningStep: 0,
          repetitions: 0,
          lapses: state.lapses + 1,
          dueAt: now + steps[0]! * MINUTE_MS,
        };
      } else {
        // SM-2 multiplies by the NEW ease, which is why ease is computed first.
        const factor = rating === 'hard' ? 1.2 : rating === 'easy' ? ease * 1.3 : ease;
        const interval = clampInterval(state.intervalDays * factor, maxInterval);
        next = {
          ...state,
          ease,
          intervalDays: interval,
          repetitions: state.repetitions + 1,
          dueAt: now + interval * DAY_MS,
        };
      }
      break;
    }

    default: {
      // Unreachable for a well-formed state; treat unknown as new rather than throwing, because
      // a corrupt card should not take down a review session.
      next = { ...newReviewState(now) };
      break;
    }
  }

  next.lastReviewedAt = now;

  const log: ReviewLogEntry = {
    itemId: '', // filled by the caller, which knows which item this was
    rating,
    quality,
    reviewedAt: now,
    elapsedDays: elapsedDays === null ? null : Number(elapsedDays.toFixed(4)),
    stateBefore: state.state,
    stateAfter: next.state,
    intervalBeforeDays: state.intervalDays,
    intervalAfterDays: next.intervalDays,
    easeBefore: state.ease,
    easeAfter: next.ease,
    lapse,
    nextDueInMinutes: Math.round((next.dueAt - now) / MINUTE_MS),
  };

  return { state: next, log };
}

/** Whether a card is due at `now`. */
export function isDue(state: ReviewState, now: number): boolean {
  return state.dueAt <= now;
}

// ---------------------------------------------------------------------------
// The daily review queue
// ---------------------------------------------------------------------------

export interface QueueItem {
  itemId: string;
  /** 1–5, from the question. Higher is harder. */
  difficulty?: number;
  /** Whether the learner has ever seen it. */
  isNew: boolean;
}

export interface QueueOptions {
  /**
   * How long the learner said they have today. §F6: "The daily plan adapts to the goal in
   * minutes", and §F1 collects that goal during onboarding.
   */
  minutesAvailable?: number;
  /** Cap on brand-new items, so a big backlog cannot bury a learner. */
  maxNew?: number;
  /** Cap on total items, regardless of time. */
  maxItems?: number;
}

export interface PlannedQueue {
  /** In the order they should be shown. */
  itemIds: string[];
  dueCount: number;
  newCount: number;
  /** Estimated minutes for the selection. */
  estimatedMinutes: number;
  /** True when items were left out because of the time budget. */
  truncated: boolean;
}

/**
 * Rough seconds per item, by kind and difficulty.
 *
 * An estimate, not a measurement — it exists so the daily plan can be sized to a stated goal, and
 * it should be replaced with real timings once the platform has them. §F5 already records the
 * elapsed time of every answer, so the data to calibrate this will exist from day one; the
 * numbers below are a starting point and are labelled as such rather than presented as fact.
 */
export function estimateSeconds(isNew: boolean, difficulty = 1): number {
  const base = isNew ? 25 : 12;
  return base + (difficulty - 1) * 5;
}

/**
 * Build the day's review queue.
 *
 * Ordering is deliberate: due reviews first, then new material.
 *
 * Due reviews are the stronger signal — the learner already met those items, and the schedule
 * says they are about to be forgotten. New items are optional by comparison, and putting them
 * first means that on a busy day the learner spends their time on novelty and never gets to the
 * reviews, which is the exact behaviour that makes spaced repetition fail in practice.
 */
export function buildQueue(
  states: readonly (QueueItem & { state: ReviewState })[],
  now: number,
  options: QueueOptions = {}
): PlannedQueue {
  const maxNew = options.maxNew ?? 20;
  const maxItems = options.maxItems ?? 200;
  const minutesAvailable = options.minutesAvailable ?? Number.POSITIVE_INFINITY;
  const budgetSeconds = minutesAvailable * 60;

  const due = states
    .filter((entry) => !entry.isNew && isDue(entry.state, now))
    // Most overdue first: the further past its due date, the more likely it is already gone.
    .sort((a, b) => a.state.dueAt - b.state.dueAt);

  const fresh = states.filter((entry) => entry.isNew);

  const selected: QueueItem[] = [];
  let seconds = 0;
  let truncated = false;
  let dueCount = 0;
  let newCount = 0;

  for (const entry of due) {
    const cost = estimateSeconds(false, entry.difficulty);
    if (selected.length >= maxItems || seconds + cost > budgetSeconds) {
      truncated = true;
      break;
    }
    selected.push(entry);
    seconds += cost;
    dueCount += 1;
  }

  if (!truncated) {
    for (const entry of fresh) {
      if (newCount >= maxNew) {
        // There is more new material than the cap allows, so work was left out. Saying so is
        // the point of the flag: a learner who cleared their queue should be able to tell
        // "nothing left" from "nothing left that I was shown".
        truncated = fresh.length > newCount;
        break;
      }
      const cost = estimateSeconds(true, entry.difficulty);
      if (selected.length >= maxItems || seconds + cost > budgetSeconds) {
        truncated = true;
        break;
      }
      selected.push(entry);
      seconds += cost;
      newCount += 1;
    }
  }

  return {
    itemIds: selected.map((entry) => entry.itemId),
    dueCount,
    newCount,
    estimatedMinutes: Math.round(seconds / 6) / 10,
    truncated,
  };
}

/**
 * How well the learner knows this item, 0–1.
 *
 * A coarse summary for progress displays. Deliberately a function of the schedule rather than a
 * separate counter: two numbers that both claim to mean "how well do you know this" will
 * eventually disagree, and the one on screen will be the wrong one.
 */
export function mastery(state: ReviewState, now: number): number {
  if (state.state === 'new') return 0;
  if (state.state === 'learning' || state.state === 'relearning') return 0.3;
  // Reached `review`: scale the interval logarithmically toward a year, and dock for lapses.
  const intervalScore = Math.log2(Math.max(1, state.intervalDays) + 1) / Math.log2(366);
  const lapsePenalty = Math.min(0.3, state.lapses * 0.1);
  return Math.max(0, Math.min(1, intervalScore - lapsePenalty));
}

/** §10.1's "item mastery": the share of attempted items meeting a threshold. */
export function masteryRate(
  states: readonly ReviewState[],
  now: number,
  threshold = 0.7
): number {
  const attempted = states.filter((state) => state.state !== 'new');
  if (attempted.length === 0) return 0;
  const mastered = attempted.filter((state) => mastery(state, now) >= threshold).length;
  return mastered / attempted.length;
}
