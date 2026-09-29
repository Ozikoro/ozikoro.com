/**
 * Gamification — XP, levels, streaks with grace, and badges.
 *
 * Spec §F7: "XP for lessons, exercises and reviews; levels; daily streak with a grace mechanism
 * (one freeze earned per week of streak, and the day is defined in the learner's time zone)
 * because of connectivity and power interruptions; a small badge set … No hearts or lives at
 * launch." Acceptance: "XP and streak calculations are server-authoritative and
 * tamper-resistant. Time zone is stored per user; streak rollover has tests for edge cases."
 *
 * WHY XP IS DERIVED FROM EVENTS AND NEVER ACCEPTED FROM THE CLIENT
 *
 * §F7 requires tamper-resistance, and the only way to get it is for the client never to send a
 * number the server believes. This module therefore exports no "addXp(amount)" — the client
 * submits an EVENT ("I answered question q correctly"), the server validates it against the
 * exercise it served, and XP is computed here from the event. Everything in this file is a pure
 * function of those events, which is also what makes it testable without a database.
 *
 * WHY THE STREAK IS COMPUTED FROM A LOCAL DAY STRING AND NOT FROM TIMESTAMPS
 *
 * "The day is defined in the learner's time zone" is the whole difficulty, and the naive
 * implementation — adding 24 hours to the last activity — is wrong in three separate ways:
 *
 *   1. A DST transition makes a local day 23 or 25 hours long, so a 24-hour comparison drifts by
 *      an hour twice a year and eventually lands a perfectly ordinary evening on the wrong day.
 *   2. Two activities on the same calendar day must not count twice, which a timestamp
 *      comparison does not prevent.
 *   3. A learner who travels west can see the local date move backwards, which a timestamp
 *      comparison reads as a missed day.
 *
 * So the streak works in LOCAL DAY STRINGS ("2026-09-28", produced by `Intl` for the learner's
 * zone) and compares them as dates. That removes DST entirely, makes "same day" exact, and makes
 * the travel case a comparison of two ordered dates rather than two instants.
 *
 * The grace mechanism exists for the same reason: §F7 names "connectivity and power
 * interruptions" as the cause, and a streak that punishes a learner for Nigeria's grid teaches
 * them to stop caring about the streak.
 */

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

/**
 * What earns XP, and how much.
 *
 * Deliberately a small, legible table rather than a formula. §16 warns that over-gamification
 * produces "shallow learning, manipulative feel", and the mitigation it names is tying rewards to
 * lesson objectives. A learner should be able to say what the points are for; a table can be
 * read aloud, an economy cannot.
 *
 * The values weight completion over volume: finishing a lesson is worth ten correct answers,
 * because the thing being rewarded is the lesson, not the tapping.
 */
export const XP_AWARDS = {
  /** Finishing a lesson. The main unit of progress. */
  lesson_completed: 20,
  /** A correct answer inside an exercise. */
  exercise_correct: 2,
  /** Finishing a review session, however large. Rewards returning, not grinding. */
  review_session_completed: 5,
  /** A first attempt at a placement test. */
  placement_completed: 10,
  /** Answering a reported content problem. Rewards the correction loop (§11.5). */
  content_report_submitted: 1,
} as const;

export type XpSource = keyof typeof XP_AWARDS;

/**
 * One thing the learner did.
 *
 * `source` and `referenceId` together are the idempotency key: the server records each event
 * once, so a retried request or a replayed offline queue cannot double-count. That is a
 * server-side concern, but the shape has to carry the key for it to be possible.
 */
export interface XpEvent {
  source: XpSource;
  /** The thing it happened to — a lesson id, an exercise id. Used for idempotency. */
  referenceId: string;
  /** True for a re-attempt of something already completed. Awards a reduced amount. */
  repeat?: boolean;
}

/** Repeating completed material is worth less, but not nothing — revision is real work. */
export const REPEAT_MULTIPLIER = 0.25;

export function xpForEvent(event: XpEvent): number {
  const base = XP_AWARDS[event.source];
  return event.repeat ? Math.floor(base * REPEAT_MULTIPLIER) : base;
}

export function totalXp(events: readonly XpEvent[]): number {
  return events.reduce((sum, event) => sum + xpForEvent(event), 0);
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/**
 * Cumulative XP needed to reach a level: 25 × n × (n − 1).
 *
 *   level 1 → 0      level 2 → 50     level 3 → 150
 *   level 4 → 300    level 5 → 500    level 10 → 2250
 *
 * A quadratic curve with a gentle start, so the first level arrives on the first day — which is
 * what makes a level system motivating rather than a wall — and later levels take real work.
 */
export function xpToReachLevel(level: number): number {
  if (level < 1) return 0;
  return 25 * level * (level - 1);
}

/** The highest level whose threshold the learner has reached. */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  // Invert the quadratic: n = floor((1 + sqrt(1 + 4·xp/25)) / 2), then correct for float drift.
  const estimate = Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2);
  let level = Math.max(1, estimate);
  while (xpToReachLevel(level + 1) <= xp) level += 1;
  while (level > 1 && xpToReachLevel(level) > xp) level -= 1;
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP the current level spans. */
  xpForLevel: number;
  /** 0–1, for a progress bar. */
  fraction: number;
  xpToNextLevel: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const floor = xpToReachLevel(level);
  const ceiling = xpToReachLevel(level + 1);
  const span = ceiling - floor;
  const into = xp - floor;
  return {
    level,
    xpIntoLevel: into,
    xpForLevel: span,
    fraction: span === 0 ? 1 : into / span,
    xpToNextLevel: ceiling - xp,
  };
}

// ---------------------------------------------------------------------------
// The local day
// ---------------------------------------------------------------------------

/**
 * The learner's calendar day, as "YYYY-MM-DD".
 *
 * Uses `Intl` rather than arithmetic on the UTC offset, because the offset is not constant: it
 * changes at DST boundaries and at the learner's discretion when they travel. `Intl` asks the
 * tz database, which is the only thing that actually knows.
 */
export function localDay(instantMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instantMs));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole days between two local day strings. `b - a`. */
export function daysBetween(a: string, b: string): number {
  // Parsed as UTC midnight purely to turn each day string into a stable integer. No timezone is
  // involved in the subtraction — the dates have already been resolved to the learner's zone.
  const toNumber = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toNumber(b) - toNumber(a)) / 86_400_000);
}

/** The day before a given local day. Used by tests and by grace logic. */
export function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export interface StreakState {
  /** Consecutive active days, counting today once it is active. */
  current: number;
  longest: number;
  /** Local day string of the last activity, or null if there has never been one. */
  lastActiveDay: string | null;
  /** Freezes held. Spent automatically on a single missed day. */
  freezesAvailable: number;
  /** Freezes spent in total, for display. */
  freezesUsed: number;
  /** Freezes already earned, so the "one per week" rule does not re-award. */
  freezesEarned: number;
}

export function newStreak(): StreakState {
  return {
    current: 0,
    longest: 0,
    lastActiveDay: null,
    freezesAvailable: 0,
    freezesUsed: 0,
    freezesEarned: 0,
  };
}

/** One freeze per full week of streak, held up to this many. */
export const FREEZE_EVERY_DAYS = 7;
export const MAX_FREEZES = 2;

export type StreakOutcome =
  /** Already counted today; nothing changed. */
  | 'same_day'
  /** Consecutive with the previous day. */
  | 'continued'
  /** A single day was missed and a freeze covered it. */
  | 'frozen'
  /** The streak was broken and restarted. */
  | 'reset'
  /** The first activity ever. */
  | 'started'
  /** The local date moved backwards — the learner travelled west. Treated as the same day. */
  | 'timezone_shift';

export interface StreakResult {
  state: StreakState;
  outcome: StreakOutcome;
}

/**
 * Record one day of activity.
 *
 * Idempotent within a local day: calling it ten times on the same day leaves the streak at one,
 * which is what stops a learner from farming a streak by tapping repeatedly.
 */
export function recordActiveDay(state: StreakState, now: number, timeZone: string): StreakResult {
  const today = localDay(now, timeZone);

  if (state.lastActiveDay === null) {
    return { state: awardFreezes({ ...state, current: 1, longest: 1, lastActiveDay: today }), outcome: 'started' };
  }

  const gap = daysBetween(state.lastActiveDay, today);

  if (gap === 0) return { state, outcome: 'same_day' };

  // Travelled west: the local date is now behind the last activity. No day has been missed in
  // the learner's own experience, so the streak stands and the record keeps the later date.
  if (gap < 0) return { state, outcome: 'timezone_shift' };

  // A single missed day, covered by a freeze if one is held. Two or more missed days is a real
  // break: the grace mechanism is for a power cut, not for a fortnight away.
  if (gap === 2 && state.freezesAvailable > 0) {
    const next: StreakState = {
      ...state,
      current: state.current + 1,
      longest: Math.max(state.longest, state.current + 1),
      lastActiveDay: today,
      freezesAvailable: state.freezesAvailable - 1,
      freezesUsed: state.freezesUsed + 1,
    };
    return { state: awardFreezes(next), outcome: 'frozen' };
  }

  if (gap === 1) {
    const next: StreakState = {
      ...state,
      current: state.current + 1,
      longest: Math.max(state.longest, state.current + 1),
      lastActiveDay: today,
    };
    return { state: awardFreezes(next), outcome: 'continued' };
  }

  return {
    state: awardFreezes({
      ...state,
      current: 1,
      longest: Math.max(state.longest, 1),
      lastActiveDay: today,
      // Reset the earning counter, because it tracks freezes earned DURING the current streak.
      // Leaving it at its lifetime value would mean a learner who built a 28-day streak, broke
      // it, and started again could not earn another freeze until they passed 28 days — the
      // exact opposite of the grace mechanism's purpose. Banked freezes are kept; only the
      // "already rewarded for this run" count restarts.
      freezesEarned: 0,
    }),
    outcome: 'reset',
  };
}

/**
 * Award a freeze for each full week of streak not yet rewarded.
 *
 * Counted from `freezesEarned` rather than from the current streak directly, so a learner whose
 * streak breaks and rebuilds earns freezes again — the reward is for the seven days just served,
 * not for a lifetime total.
 */
function awardFreezes(state: StreakState): StreakState {
  const earnedByNow = Math.floor(state.current / FREEZE_EVERY_DAYS);
  if (earnedByNow <= state.freezesEarned) return state;

  const newlyEarned = earnedByNow - state.freezesEarned;
  return {
    ...state,
    freezesEarned: earnedByNow,
    freezesAvailable: Math.min(MAX_FREEZES, state.freezesAvailable + newlyEarned),
  };
}

/**
 * Whether the streak is still alive at `now`.
 *
 * A streak is alive if the learner has been active today or yesterday (the day is not over yet).
 * Anything older is broken, and saying so before the learner next acts is the honest thing —
 * showing a 12-day streak that cannot be continued is a small lie that costs trust.
 */
export function streakIsAlive(state: StreakState, now: number, timeZone: string): boolean {
  if (state.lastActiveDay === null) return false;
  const gap = daysBetween(state.lastActiveDay, localDay(now, timeZone));
  if (gap <= 0) return true;
  if (gap === 1) return true;
  return gap === 2 && state.freezesAvailable > 0;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export interface LearnerStats {
  lessonsCompleted: number;
  reviewsCompleted: number;
  correctAnswers: number;
  streakLongest: number;
  /** Topics the learner has finished at least one lesson in, by tag. */
  topicsCompleted: string[];
  /** Local days on which the learner has been active, for the week-long badge. */
  activeDays: number;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  /** Pure predicate over the learner's stats. */
  earned: (stats: LearnerStats) => boolean;
}

/**
 * A small badge set, as §F7 asks.
 *
 * Each badge names something a learner can describe to another person ("I finished the numbers
 * unit") rather than a volume threshold, which is the difference between a milestone and a
 * slot machine. §F7 suggests Greetings, Numbers and First Week; those three are here.
 */
export const BADGES: readonly Badge[] = [
  {
    id: 'first_week',
    name: 'First week',
    description: 'Seven days of practice.',
    earned: (stats) => stats.activeDays >= 7,
  },
  {
    id: 'streak_7',
    name: 'Seven in a row',
    description: 'A seven-day streak.',
    earned: (stats) => stats.streakLongest >= 7,
  },
  {
    id: 'greetings',
    name: 'Greetings',
    description: 'Finished the greetings unit.',
    earned: (stats) => stats.topicsCompleted.includes('greetings'),
  },
  {
    id: 'numbers',
    name: 'Numbers',
    description: 'Finished the numbers unit.',
    earned: (stats) => stats.topicsCompleted.includes('numbers'),
  },
  {
    id: 'first_lesson',
    name: 'First lesson',
    description: 'Completed a lesson.',
    earned: (stats) => stats.lessonsCompleted >= 1,
  },
  {
    id: 'hundred_answers',
    name: 'A hundred answers',
    description: 'A hundred correct answers.',
    earned: (stats) => stats.correctAnswers >= 100,
  },
  {
    id: 'reviewer',
    name: 'Keeper of the list',
    description: 'Twenty review sessions.',
    earned: (stats) => stats.reviewsCompleted >= 20,
  },
];

export function earnedBadges(stats: LearnerStats): Badge[] {
  return BADGES.filter((badge) => badge.earned(stats));
}

/** Badges newly earned, so the UI can celebrate only what is new. */
export function newlyEarnedBadges(stats: LearnerStats, alreadyEarned: readonly string[]): Badge[] {
  const held = new Set(alreadyEarned);
  return earnedBadges(stats).filter((badge) => !held.has(badge.id));
}
