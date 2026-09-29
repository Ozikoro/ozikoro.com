/**
 * Gamification tests.
 *
 * §F7's acceptance criteria name two things directly: "XP and streak calculations are
 * server-authoritative and tamper-resistant" and "Time zone is stored per user; streak rollover
 * has tests for edge cases." The second sentence is an instruction to write this file.
 *
 * The edge cases that actually break a streak implementation, all covered below:
 *
 *   - a DST transition, where a local day is 23 or 25 hours long
 *   - the learner travelling west, so the local date moves backwards
 *   - two activities on one calendar day, which must count once
 *   - a missed day, with and without a freeze
 *   - a freeze covering exactly one missed day and no more
 *
 * The tests use real IANA zones and real dates, because a fake zone with a fixed offset would
 * pass every one of them while the production code failed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BADGES,
  FREEZE_EVERY_DAYS,
  MAX_FREEZES,
  XP_AWARDS,
  daysBetween,
  earnedBadges,
  levelForXp,
  levelProgress,
  localDay,
  newStreak,
  newlyEarnedBadges,
  previousDay,
  recordActiveDay,
  streakIsAlive,
  totalXp,
  xpForEvent,
  xpToReachLevel,
  type LearnerStats,
  type StreakState,
} from './gamification.ts';

const LAGOS = 'Africa/Lagos'; // UTC+1 year round — no DST, which is the primary audience
const LONDON = 'Europe/London'; // northern-hemisphere DST
const NEW_YORK = 'America/New_York';

/** Epoch ms for a UTC instant. */
const at = (iso: string) => Date.parse(iso);

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

test('XP comes from a legible table, not a formula', () => {
  assert.equal(xpForEvent({ source: 'lesson_completed', referenceId: 'l1' }), XP_AWARDS.lesson_completed);
  assert.equal(xpForEvent({ source: 'exercise_correct', referenceId: 'q1' }), 2);
  assert.equal(xpForEvent({ source: 'review_session_completed', referenceId: 'r1' }), 5);
});

test('repeating completed material is worth less but not nothing', () => {
  const first = xpForEvent({ source: 'lesson_completed', referenceId: 'l1' });
  const again = xpForEvent({ source: 'lesson_completed', referenceId: 'l1', repeat: true });
  assert.ok(again < first && again > 0, `${again} against ${first}`);
});

test('total XP sums the events it is given', () => {
  assert.equal(
    totalXp([
      { source: 'lesson_completed', referenceId: 'l1' },
      { source: 'exercise_correct', referenceId: 'q1' },
      { source: 'exercise_correct', referenceId: 'q2' },
    ]),
    24
  );
});

test('a completed lesson is worth more than a correct answer', () => {
  // The reward is for finishing the lesson, not for tapping.
  assert.ok(XP_AWARDS.lesson_completed > XP_AWARDS.exercise_correct * 5);
});

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

test('the level curve is the documented quadratic', () => {
  assert.equal(xpToReachLevel(1), 0);
  assert.equal(xpToReachLevel(2), 50);
  assert.equal(xpToReachLevel(3), 150);
  assert.equal(xpToReachLevel(4), 300);
  assert.equal(xpToReachLevel(10), 2250);
});

test('levelForXp is right at the boundaries', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(49), 1);
  assert.equal(levelForXp(50), 2, 'exactly the threshold is level 2');
  assert.equal(levelForXp(149), 2);
  assert.equal(levelForXp(150), 3);
  assert.equal(levelForXp(2250), 10);
});

test('levelForXp is monotonic and agrees with xpToReachLevel everywhere', () => {
  let previous = 0;
  for (let xp = 0; xp <= 3000; xp += 7) {
    const level = levelForXp(xp);
    assert.ok(level >= previous, `level went backwards at ${xp}`);
    previous = level;
    assert.ok(xpToReachLevel(level) <= xp, `level ${level} needs more than ${xp}`);
    assert.ok(xpToReachLevel(level + 1) > xp, `level ${level + 1} should still be out of reach at ${xp}`);
  }
});

test('negative XP does not produce a level below one', () => {
  assert.equal(levelForXp(-100), 1);
  assert.equal(xpToReachLevel(0), 0);
});

test('level progress reports a sensible fraction', () => {
  const progress = levelProgress(100); // level 2 spans 50..150
  assert.equal(progress.level, 2);
  assert.equal(progress.xpIntoLevel, 50);
  assert.equal(progress.xpForLevel, 100);
  assert.equal(progress.fraction, 0.5);
  assert.equal(progress.xpToNextLevel, 50);
});

// ---------------------------------------------------------------------------
// The local day
// ---------------------------------------------------------------------------

test('the local day follows the learner zone, not UTC', () => {
  // 02:00 UTC is the 28th in Lagos but still the 27th in New York.
  const instant = at('2026-09-28T02:00:00Z');
  assert.equal(localDay(instant, LAGOS), '2026-09-28');
  assert.equal(localDay(instant, NEW_YORK), '2026-09-27');
  // And a zone far enough east has already rolled over.
  assert.equal(localDay(instant, 'Pacific/Auckland'), '2026-09-28');
});

test('Lagos has no DST, so its local day never shifts', () => {
  for (const iso of ['2026-01-15T12:00:00Z', '2026-06-15T12:00:00Z', '2026-12-15T12:00:00Z']) {
    assert.equal(localDay(at(iso), LAGOS), iso.slice(0, 10));
  }
});

test('a DST transition does not corrupt the local day', () => {
  // London springs forward on 2026-03-29: that local day is 23 hours long.
  // Consecutive local days must still be exactly one apart.
  assert.equal(localDay(at('2026-03-28T12:00:00Z'), LONDON), '2026-03-28');
  assert.equal(localDay(at('2026-03-29T12:00:00Z'), LONDON), '2026-03-29');
  assert.equal(daysBetween('2026-03-28', '2026-03-29'), 1);

  // And the autumn change, where the day is 25 hours long.
  assert.equal(localDay(at('2026-10-24T12:00:00Z'), LONDON), '2026-10-24');
  assert.equal(localDay(at('2026-10-25T12:00:00Z'), LONDON), '2026-10-25');
  assert.equal(daysBetween('2026-10-24', '2026-10-25'), 1);
});

test('daysBetween counts calendar days, not elapsed hours', () => {
  assert.equal(daysBetween('2026-09-28', '2026-09-28'), 0);
  assert.equal(daysBetween('2026-09-28', '2026-09-29'), 1);
  assert.equal(daysBetween('2026-09-28', '2026-10-05'), 7);
  assert.equal(daysBetween('2026-09-28', '2026-09-27'), -1);
  // Across a month and a year boundary.
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1, '2026 is not a leap year');
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2, '2028 is a leap year');
});

test('previousDay walks back across boundaries', () => {
  assert.equal(previousDay('2026-09-28'), '2026-09-27');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
});

// ---------------------------------------------------------------------------
// Streaks — §F7's edge cases
// ---------------------------------------------------------------------------

test('the first activity starts a streak of one', () => {
  const result = recordActiveDay(newStreak(), at('2026-09-28T10:00:00Z'), LAGOS);
  assert.equal(result.outcome, 'started');
  assert.equal(result.state.current, 1);
  assert.equal(result.state.lastActiveDay, '2026-09-28');
});

test('a second activity on the same local day changes nothing', () => {
  const first = recordActiveDay(newStreak(), at('2026-09-28T06:00:00Z'), LAGOS);
  const second = recordActiveDay(first.state, at('2026-09-28T22:00:00Z'), LAGOS);
  assert.equal(second.outcome, 'same_day');
  assert.equal(second.state.current, 1, 'tapping twice is not two days');
  assert.deepEqual(second.state, first.state);
});

test('consecutive days continue the streak', () => {
  let state = newStreak();
  for (let day = 1; day <= 5; day += 1) {
    const result = recordActiveDay(state, at(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`), LAGOS);
    state = result.state;
  }
  assert.equal(state.current, 5);
  assert.equal(state.longest, 5);
});

test('a DST boundary continues the streak rather than breaking it', () => {
  // 23 hours apart in elapsed time, but consecutive local days. A naive +24h comparison would
  // call this a missed day.
  const dayOne = recordActiveDay(newStreak(), at('2026-03-28T23:00:00Z'), LONDON);
  const dayTwo = recordActiveDay(dayOne.state, at('2026-03-29T22:00:00Z'), LONDON);
  assert.equal(dayTwo.outcome, 'continued');
  assert.equal(dayTwo.state.current, 2);
});

test('one missed day is covered by a freeze', () => {
  const state: StreakState = { ...newStreak(), current: 4, longest: 4, lastActiveDay: '2026-09-28', freezesAvailable: 1, freezesEarned: 1 };
  const result = recordActiveDay(state, at('2026-09-30T10:00:00Z'), LAGOS);
  assert.equal(result.outcome, 'frozen');
  assert.equal(result.state.current, 5, 'the streak survives');
  assert.equal(result.state.freezesAvailable, 0);
  assert.equal(result.state.freezesUsed, 1);
});

test('one missed day without a freeze breaks the streak', () => {
  const state: StreakState = { ...newStreak(), current: 4, longest: 4, lastActiveDay: '2026-09-28' };
  const result = recordActiveDay(state, at('2026-09-30T10:00:00Z'), LAGOS);
  assert.equal(result.outcome, 'reset');
  assert.equal(result.state.current, 1);
  assert.equal(result.state.longest, 4, 'the record of the best run is kept');
});

test('a freeze covers exactly ONE missed day, not two', () => {
  // A freeze is for a power cut, not for a fortnight away.
  const state: StreakState = { ...newStreak(), current: 4, longest: 4, lastActiveDay: '2026-09-28', freezesAvailable: 2, freezesEarned: 2 };
  const result = recordActiveDay(state, at('2026-10-01T10:00:00Z'), LAGOS); // two days missed
  assert.equal(result.outcome, 'reset');
  assert.equal(result.state.current, 1);
  assert.equal(result.state.freezesAvailable, 2, 'the freezes were not spent on a real break');
});

test('travelling west does not break the streak', () => {
  // Active in Lagos late on the 29th (01:30 local). Then in New York, where the same moment is
  // still the evening of the 28th — so the learner's own calendar has moved backwards.
  const lagos = recordActiveDay(newStreak(), at('2026-09-29T00:30:00Z'), LAGOS);
  assert.equal(lagos.state.lastActiveDay, '2026-09-29');

  const travelled = recordActiveDay(lagos.state, at('2026-09-29T02:00:00Z'), NEW_YORK);
  assert.equal(localDay(at('2026-09-29T02:00:00Z'), NEW_YORK), '2026-09-28', 'the fixture is a real backwards move');
  assert.equal(travelled.outcome, 'timezone_shift');
  assert.equal(travelled.state.current, 1, 'the streak is not broken by the flight');
});

test('a freeze is earned for every full week of streak', () => {
  let state = newStreak();
  for (let day = 1; day <= FREEZE_EVERY_DAYS; day += 1) {
    const result = recordActiveDay(state, at(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`), LAGOS);
    state = result.state;
  }
  assert.equal(state.current, FREEZE_EVERY_DAYS);
  assert.equal(state.freezesAvailable, 1, 'seven days earns one freeze');
  assert.equal(state.freezesEarned, 1);

  // Three more weeks: capped at MAX_FREEZES.
  for (let day = 8; day <= 28; day += 1) {
    const result = recordActiveDay(state, at(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`), LAGOS);
    state = result.state;
  }
  assert.equal(state.current, 28);
  assert.equal(state.freezesAvailable, MAX_FREEZES, 'freezes are capped');
});

test('a broken streak that is rebuilt earns freezes again', () => {
  // The reward is for the seven days just served, not for a lifetime total.
  const broken: StreakState = {
    ...newStreak(),
    current: 0,
    longest: 30,
    lastActiveDay: '2026-09-01',
    freezesAvailable: 0,
    freezesEarned: 4,
  };
  let state = recordActiveDay(broken, at('2026-10-01T10:00:00Z'), LAGOS).state;
  assert.equal(state.current, 1);
  for (let day = 2; day <= 7; day += 1) {
    state = recordActiveDay(state, at(`2026-10-${String(day).padStart(2, '0')}T10:00:00Z`), LAGOS).state;
  }
  assert.equal(state.current, 7);
  assert.ok(state.freezesAvailable >= 1, 'a new week of streak earns a new freeze');
});

test('streakIsAlive distinguishes today, yesterday, and a broken run', () => {
  const state: StreakState = { ...newStreak(), current: 3, longest: 3, lastActiveDay: '2026-09-28' };
  assert.equal(streakIsAlive(state, at('2026-09-28T23:00:00Z'), LAGOS), true, 'active today');
  assert.equal(streakIsAlive(state, at('2026-09-29T08:00:00Z'), LAGOS), true, 'yesterday still counts');
  assert.equal(streakIsAlive(state, at('2026-09-30T08:00:00Z'), LAGOS), false, 'a day was missed');
  assert.equal(streakIsAlive(newStreak(), at('2026-09-28T08:00:00Z'), LAGOS), false, 'never active');
});

test('streakIsAlive accounts for a freeze that could still cover the gap', () => {
  const state: StreakState = {
    ...newStreak(),
    current: 9,
    longest: 9,
    lastActiveDay: '2026-09-28',
    freezesAvailable: 1,
    freezesEarned: 1,
  };
  assert.equal(streakIsAlive(state, at('2026-09-30T08:00:00Z'), LAGOS), true, 'one gap, one freeze');
  assert.equal(streakIsAlive(state, at('2026-10-01T08:00:00Z'), LAGOS), false, 'two gaps, no cover');
});

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

const emptyStats: LearnerStats = {
  lessonsCompleted: 0,
  reviewsCompleted: 0,
  correctAnswers: 0,
  streakLongest: 0,
  topicsCompleted: [],
  activeDays: 0,
};

test('no badges are earned from nothing', () => {
  assert.deepEqual(earnedBadges(emptyStats), []);
});

test('badges are earned by the thing they name', () => {
  const stats: LearnerStats = { ...emptyStats, lessonsCompleted: 1, activeDays: 7 };
  const ids = earnedBadges(stats).map((badge) => badge.id);
  assert.ok(ids.includes('first_lesson'));
  assert.ok(ids.includes('first_week'));
  assert.ok(!ids.includes('numbers'), 'the numbers unit was not finished');
});

test('newly earned badges exclude the ones already held', () => {
  const stats: LearnerStats = { ...emptyStats, lessonsCompleted: 1, topicsCompleted: ['numbers'] };
  const fresh = newlyEarnedBadges(stats, ['first_lesson']);
  const ids = fresh.map((badge) => badge.id);
  assert.ok(!ids.includes('first_lesson'), 'already held');
  assert.ok(ids.includes('numbers'), 'newly earned');
});

test('every badge has a name and a description a learner can read', () => {
  for (const badge of BADGES) {
    assert.ok(badge.id.length > 0);
    assert.ok(badge.name.length > 0, badge.id);
    assert.ok(badge.description.length > 10, `${badge.id} needs a real description`);
  }
  assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length, 'duplicate badge id');
});
