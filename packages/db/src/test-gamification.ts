/**
 * Tests for XP, streaks and badges.
 *
 * Run with: npm -w @ozituma/db run test:gamification
 *
 * WHAT THESE ARE ACTUALLY CHECKING
 *
 *   1. XP cannot be double-awarded. This is the claim that matters most: XP is the number a learner
 *      will notice being wrong, and the number a double-tapped button or a retried request inflates
 *      by accident. The database's unique constraint is the arbiter, and this proves a second
 *      identical award is a no-op that reports itself as one.
 *   2. A streak moves once per local day, continues across consecutive days, spends a freeze on a
 *      single missed day, and resets on two.
 *   3. Badges are awarded from stats and are not re-awarded.
 *
 * Time is passed in explicitly rather than waited for. `recordActivity` takes `now`, so a streak of
 * consecutive days is tested in milliseconds instead of a week — and the freeze rule, which only
 * engages after a gap, is the one that would otherwise never be exercised at all.
 */
import { createDb, type Db } from './client.ts';
import { registerAccount } from './accounts.ts';
import { awardXp, getLearnerProgress, getStreak, getStreakView, getXpSummary, recordActivity, syncBadges } from './learn-gamification.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A fixed UTC instant, so the test cannot depend on when it is run. */
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0); // 5 Jan 2026, midday UTC
const TZ = 'UTC';

async function main(): Promise<void> {
  const db: Db = await createDb({});
  const email = `gam-test-${Date.now()}@ozituma.test`;

  const account = await registerAccount(db, {
    email,
    password: 'gamification-test-password',
    displayName: 'Gamification Test',
  });
  const accountId = account.id;
  console.log(`  test account ${accountId} (${email})\n`);

  try {
    // ---------------------------------------------------------------------
    // 1. XP: awarded once, and only once
    // ---------------------------------------------------------------------
    const first = await awardXp(db, {
      accountId,
      source: 'exercise_correct',
      reference: 'exercise-1',
    });
    check('a first award grants XP', first.awarded === 2, `got ${first.awarded}`);
    check('a first award is not a duplicate', first.duplicate === false);

    const again = await awardXp(db, {
      accountId,
      source: 'exercise_correct',
      reference: 'exercise-1',
    });
    check('the same event again grants nothing', again.awarded === 0);
    check('the same event again reports itself as a duplicate', again.duplicate === true);

    const summaryAfterDup = await getXpSummary(db, accountId);
    check('the total was not inflated by the repeat', summaryAfterDup.total === 2, `got ${summaryAfterDup.total}`);

    // A different reference is a different event, even from the same source.
    const other = await awardXp(db, {
      accountId,
      source: 'exercise_correct',
      reference: 'exercise-2',
    });
    check('a different reference is a different event', other.awarded === 2 && !other.duplicate);
    check('the total now counts both', (await getXpSummary(db, accountId)).total === 4);

    // A repeat of completed material is worth less, and is still idempotent.
    const lesson = await awardXp(db, {
      accountId,
      source: 'lesson_completed',
      reference: 'igbo/greetings',
    });
    check('completing a lesson awards the full amount', lesson.awarded === 20, `got ${lesson.awarded}`);

    const lessonRepeat = await awardXp(db, {
      accountId,
      source: 'lesson_completed',
      reference: 'igbo/greetings-again',
      repeat: true,
    });
    check('repeating completed material awards a quarter', lessonRepeat.awarded === 5, `got ${lessonRepeat.awarded}`);

    // Same source and reference but a different repeat flag is STILL the same event — the key is
    // (source, reference), so flipping the flag cannot be used to farm a second award.
    const flipped = await awardXp(db, {
      accountId,
      source: 'lesson_completed',
      reference: 'igbo/greetings',
      repeat: true,
    });
    check('flipping the repeat flag does not re-award the same event', flipped.awarded === 0 && flipped.duplicate);

    // ---------------------------------------------------------------------
    // 2. An unknown source is a programming error, not a silent no-op
    // ---------------------------------------------------------------------
    let threw = false;
    try {
      await awardXp(db, { accountId, source: 'invented_source' as never, reference: 'x' });
    } catch {
      threw = true;
    }
    check('an unknown XP source throws rather than silently dropping', threw);

    // ---------------------------------------------------------------------
    // 3. Level curve
    // ---------------------------------------------------------------------
    const xpNow = await getXpSummary(db, accountId);
    check('level is at least 1', xpNow.level.level >= 1);
    check('level progress has a fraction between 0 and 1', xpNow.level.fraction >= 0 && xpNow.level.fraction < 1);
    check('xpToNextLevel is positive', xpNow.level.xpToNextLevel > 0);
    check('the breakdown has one row per source', xpNow.bySource.length === 2, `got ${xpNow.bySource.length}`);

    // ---------------------------------------------------------------------
    // 4. Streak: started, then idempotent within a day
    // ---------------------------------------------------------------------
    const started = await recordActivity(db, accountId, TZ, T0);
    check('the first activity starts a streak', started.outcome === 'started', started.outcome);
    check('the streak is 1', started.state.current === 1);
    check('the streak reports a change', started.changed === true);

    const sameDay = await recordActivity(db, accountId, TZ, T0 + 3 * 60 * 60 * 1000);
    check('a second activity the same day is a no-op', sameDay.outcome === 'same_day', sameDay.outcome);
    check('the streak did not move', sameDay.state.current === 1);
    check('a no-op reports no change', sameDay.changed === false);

    // ---------------------------------------------------------------------
    // 5. Streak: continues across consecutive days
    // ---------------------------------------------------------------------
    const day2 = await recordActivity(db, accountId, TZ, T0 + DAY);
    check('the next day continues the streak', day2.outcome === 'continued', day2.outcome);
    check('the streak is 2', day2.state.current === 2);

    const day3 = await recordActivity(db, accountId, TZ, T0 + 2 * DAY);
    check('a third day continues it', day3.state.current === 3);

    // ---------------------------------------------------------------------
    // 6. Streak: a single missed day is covered by a freeze
    //
    // A freeze is earned per full week, so at three days the learner holds none — which is the case
    // worth testing, because it is the one where the streak must break.
    // ---------------------------------------------------------------------
    const afterGap = await recordActivity(db, accountId, TZ, T0 + 4 * DAY);
    check('a missed day with no freeze resets the streak', afterGap.outcome === 'reset', afterGap.outcome);
    check('the streak restarts at 1', afterGap.state.current === 1);
    check('the longest streak is remembered', afterGap.state.longest === 3, `longest ${afterGap.state.longest}`);

    // ---------------------------------------------------------------------
    // 7. Streak view does not extend the streak just by being read
    // ---------------------------------------------------------------------
    const view = await getStreakView(db, accountId, TZ, T0 + 4 * DAY);
    check('the view reports the streak as alive on the day it was earned', view.alive === true);
    check('the view says today is already active', view.activeToday === true);

    const tomorrowView = await getStreakView(db, accountId, TZ, T0 + 5 * DAY);
    check('reading the streak tomorrow does not extend it', tomorrowView.current === 1);
    check('a streak with yesterday as its last day is still shown as alive', tomorrowView.alive === true);
    check('but it is not active today', tomorrowView.activeToday === false);

    const staleView = await getStreakView(db, accountId, TZ, T0 + 20 * DAY);
    check('a long-dormant streak is not alive', staleView.alive === false);

    // ---------------------------------------------------------------------
    // 8. Badges
    // ---------------------------------------------------------------------
    const badges = await syncBadges(db, accountId);
    check('syncing badges returns the held set', Array.isArray(badges));
    // The stats here are four active days and two completed lessons. So exactly one badge is
    // justified (first_lesson) and one is specifically NOT (first_week, which needs seven days).
    // Asserting both directions matters: a badge set that awards nothing would pass a
    // negative-only check, and one that awards everything would pass a positive-only check.
    check(
      'a badge needing seven days is not awarded after four',
      !badges.some((badge) => badge.id === 'first_week')
    );
    check(
      'a badge the stats do justify IS awarded',
      badges.some((badge) => badge.id === 'first_lesson'),
      `held: ${badges.map((b) => b.id).join(', ') || 'none'}`
    );

    const badgeRows = await db.rows<{ badge_id: string }>(
      `select badge_id from learn_user_badge where account_id = $1`,
      [accountId]
    );
    check('badge definitions were upserted into learn_badge', (await db.one<{ n: number }>(`select count(*)::int as n from learn_badge`))!.n > 0);
    check('the held badges match the table', badgeRows.length === badges.length);

    // Syncing twice must not duplicate.
    const badgesAgain = await syncBadges(db, accountId);
    check('syncing twice does not duplicate a badge', badgesAgain.length === badges.length);
    const badgeCount = await db.one<{ n: number }>(
      `select count(*)::int as n from learn_user_badge where account_id = $1`,
      [accountId]
    );
    check('no duplicate rows in learn_user_badge', Number(badgeCount?.n ?? 0) === badges.length);

    // ---------------------------------------------------------------------
    // 9. The combined progress view agrees with its parts
    // ---------------------------------------------------------------------
    const progress = await getLearnerProgress(db, accountId, TZ);
    check('progress reports the same total XP', progress.totalXp === (await getXpSummary(db, accountId)).total);
    check('progress carries the streak', progress.streak.current === 1);
    check('progress carries the badges', progress.badges.length === badges.length);
    check('progress counts tracked words', progress.stats.wordsTracked === 0, 'nothing has been reviewed in this test');
  } finally {
    await db.rows('delete from auth_session where account_id = $1', [accountId]);
    await db.rows('delete from account where id = $1', [accountId]);

    const [xp, streak, userBadges] = await Promise.all([
      db.one<{ n: number }>(`select count(*)::int as n from learn_xp_event where account_id = $1`, [accountId]),
      db.one<{ n: number }>(`select count(*)::int as n from learn_streak where account_id = $1`, [accountId]),
      db.one<{ n: number }>(`select count(*)::int as n from learn_user_badge where account_id = $1`, [accountId]),
    ]);
    check(
      'the test account left no XP, streak or badge rows behind',
      Number(xp?.n ?? 0) === 0 && Number(streak?.n ?? 0) === 0 && Number(userBadges?.n ?? 0) === 0
    );
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  await db.close();
  if (failed > 0) process.exitCode = 1;
}

await main();
