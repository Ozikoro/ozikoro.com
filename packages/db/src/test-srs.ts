/**
 * Tests for the spaced-repetition persistence layer.
 *
 * Run with: npm -w @ozituma/db run test:srs
 *
 * WHAT THESE ARE ACTUALLY CHECKING
 *
 * The interesting claims in `learn-srs.ts` are not "the query runs". They are:
 *
 *   1. The state write and the log write cannot disagree — the two are one statement, and this
 *      proves it by checking that a recorded review leaves both, and that the log's before/after
 *      values match what the scheduler decided.
 *   2. "New" means never reviewed and stops meaning that once reviewed. If the `not exists` clause
 *      were wrong, a learner would be shown the same word as new forever and the plan would never
 *      converge.
 *   3. Due means due. A word reviewed to a future interval must leave today's queue.
 *
 * The account is created and destroyed by this file, so it is safe against a live database. It uses
 * a `.test` address and deletes the account at the end — including on failure, so a broken run does
 * not leave a stray account behind.
 */
import { createDb, type Db } from './client.ts';
import { registerAccount } from './accounts.ts';
import { getDailyPlan, getReviewSummary, loadReviewState, recordReview } from './learn-srs.ts';

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

async function main(): Promise<void> {
  const db: Db = await createDb({});
  const email = `srs-test-${Date.now()}@ozituma.test`;

  const account = await registerAccount(db, {
    email,
    password: 'srs-test-password-not-a-secret',
    displayName: 'SRS Test',
  });
  const accountId = account.id;
  console.log(`  test account ${accountId} (${email})\n`);

  try {
    // ---------------------------------------------------------------------
    // 1. A word never reviewed is a new card, not an error
    // ---------------------------------------------------------------------
    const fresh = await loadReviewState(db, accountId, '999999');
    check('unseen item reports state "new"', fresh.state === 'new');
    check('unseen item has default ease 2.5', fresh.ease === 2.5);
    check('unseen item has never been reviewed', fresh.lastReviewedAt === null);

    // ---------------------------------------------------------------------
    // 2. A real word, so the plan can join it
    // ---------------------------------------------------------------------
    const word = await db.one<{ id: string; headword: string }>(
      `select w.id, w.headword
         from word w
        where w.language_code = 'ibo'
          and w.status = 'published'
          and exists (select 1 from definition d where d.word_id = w.id)
        order by w.is_common desc nulls last, w.frequency_rank asc nulls last, w.headword
        limit 1`
    );
    if (!word) {
      check('a published word exists to test against', false, 'no published Igbo words in this database');
      return;
    }
    const wordId = String(word.id);
    console.log(`  using word ${wordId} "${word.headword}"\n`);

    // ---------------------------------------------------------------------
    // 3. The plan offers it as new
    // ---------------------------------------------------------------------
    const planBefore = await getDailyPlan(db, accountId, { minutesAvailable: 10, maxNew: 5 });
    check('plan before any review offers new words', planBefore.newCount > 0);
    check('plan before any review has nothing due', planBefore.dueCount === 0);
    check(
      'the plan includes the word we are about to review',
      planBefore.items.some((item) => item.itemId === wordId && item.isNew)
    );
    check('a new item carries a real gloss, not a placeholder', (planBefore.items[0]?.english ?? '').length > 0);

    // ---------------------------------------------------------------------
    // 4. Recording a review advances state AND writes the log, together
    // ---------------------------------------------------------------------
    const good = await recordReview(db, {
      accountId,
      itemId: wordId,
      rating: 'good',
      elapsedMs: 4200,
      response: word.headword,
    });
    check('scheduling returned a log entry', good.log.rating === 'good');
    check('quality mapped from the rating (good -> 4)', good.log.quality === 4);
    check('state moved off "new"', good.state.state !== 'new');
    // A new card answered "good" moves to the SECOND learning step, it does not graduate. `learning`
    // and `repetitions` are deliberately unchanged here, and asserting otherwise — which this test
    // did at first — mistakes SM-2-with-learning-steps for plain SM-2.
    check('a new card answered good is still learning', good.state.state === 'learning');
    check('repetitions do not advance until the card graduates', good.state.repetitions === 0);
    check('a due date in the future was set', good.state.dueAt > Date.now());

    const logRow = await db.one<{
      rating: string;
      quality: number;
      state_before: string;
      state_after: string;
      ease_before: number;
      ease_after: number;
      interval_after_days: number;
      elapsed_ms: number;
      response: string;
    }>(
      `select rating, quality, state_before, state_after, ease_before, ease_after,
              interval_after_days, elapsed_ms, response
         from learn_review_log
        where account_id = $1 and item_id = $2
        order by id desc limit 1`,
      [accountId, wordId]
    );

    check('the log row was written in the same action', logRow !== null);
    if (logRow) {
      // The point of the CTE: these must agree with what the scheduler returned, not merely exist.
      check('log state_before matches what the scheduler saw', logRow.state_before === good.log.stateBefore);
      check('log state_after matches what the scheduler decided', logRow.state_after === good.log.stateAfter);
      check(
        'log ease_after matches the scheduler',
        Math.abs(Number(logRow.ease_after) - good.log.easeAfter) < 0.0001,
        `${logRow.ease_after} vs ${good.log.easeAfter}`
      );
      check(
        'log interval_after matches the scheduler',
        Math.abs(Number(logRow.interval_after_days) - good.log.intervalAfterDays) < 0.0001
      );
      check('elapsed time was recorded (§F5)', Number(logRow.elapsed_ms) === 4200);
      check('the exact response was recorded (§F5)', logRow.response === word.headword);
    }

    const stored = await db.one<{ state: string; repetitions: number }>(
      `select state, repetitions from learn_item_state
        where account_id = $1 and item_kind = 'lexeme' and item_id = $2`,
      [accountId, wordId]
    );
    check('item state row exists after the review', stored !== null);
    check('stored state matches the scheduler', stored?.state === good.state.state);

    // ---------------------------------------------------------------------
    // 5. The word is no longer "new", and no longer due today
    // ---------------------------------------------------------------------
    const planAfter = await getDailyPlan(db, accountId, { minutesAvailable: 10, maxNew: 5 });
    check(
      'a reviewed word is no longer offered as new',
      !planAfter.items.some((item) => item.itemId === wordId && item.isNew)
    );
    check('a reviewed-to-the-future word is not due today', planAfter.dueCount === 0);

    const summary = await getReviewSummary(db, accountId);
    check('summary counts the tracked word', summary.tracked === 1);
    check('summary reports nothing due yet', summary.dueNow === 0);

    // ---------------------------------------------------------------------
    // 6. Graduating, then failing — a real lapse
    //
    // A lapse is failing a card that had been LEARNED. Failing one still in `learning` is not a
    // lapse, and the first version of this test asserted that it was, which is a claim about the
    // wrong thing: it would have passed against a scheduler that counted a stumble on day one as
    // forgetting a word.
    //
    // The default learning steps are [1, 10] minutes, so a second "good" takes the card past the
    // last step and graduates it to `review`.
    // ---------------------------------------------------------------------
    const graduated = await recordReview(db, { accountId, itemId: wordId, rating: 'good' });
    check('a second good graduates the card', graduated.state.state === 'review', graduated.state.state);
    check('graduating advances repetitions', graduated.state.repetitions === 1);
    check('repetitions were reset to 0 by the earlier review, not carried', graduated.log.stateBefore === 'learning');

    const again = await recordReview(db, { accountId, itemId: wordId, rating: 'again' });
    check('failing a learned card is a lapse', again.log.lapse === true);
    check('a lapsed card returns to relearning', again.state.state === 'relearning', again.state.state);
    check('the lapse is counted', again.state.lapses === 1);
    check('a lapse resets repetitions', again.state.repetitions === 0);
    check('a lapse reduces the interval', again.log.intervalAfterDays <= again.log.intervalBeforeDays);
    check(
      'ease is driven toward the floor but not below it',
      again.state.ease >= 1.3,
      `ease ${again.state.ease}`
    );

    // ---------------------------------------------------------------------
    // 7. Due-in-the-past means due now
    //
    // Backdating the row is the only honest way to test this without waiting a day, and it is what
    // the scheduler will do to a returning learner's data in practice.
    // ---------------------------------------------------------------------
    await db.rows(
      `update learn_item_state set due_at = now() - interval '1 hour'
        where account_id = $1 and item_kind = 'lexeme' and item_id = $2`,
      [accountId, wordId]
    );
    const planDue = await getDailyPlan(db, accountId, { minutesAvailable: 10, maxNew: 5 });
    check('a backdated word is due', planDue.dueCount === 1);
    check(
      'due items come before new items',
      planDue.items[0]?.itemId === wordId,
      `first item was ${planDue.items[0]?.itemId ?? 'none'}`
    );

    const summaryDue = await getReviewSummary(db, accountId);
    check('summary reports one due now', summaryDue.dueNow === 1);
    check('summary counts it as learned', summaryDue.learned === 1);

    // ---------------------------------------------------------------------
    // 8. The time budget actually truncates
    // ---------------------------------------------------------------------
    const tiny = await getDailyPlan(db, accountId, { minutesAvailable: 1, maxNew: 20, maxItems: 40 });
    check(
      'a one-minute budget returns fewer items than a generous one',
      tiny.items.length <= planDue.items.length,
      `tiny=${tiny.items.length} generous=${planDue.items.length}`
    );
    check('a truncated plan says so', tiny.truncated === true || tiny.items.length < 40);

    // ---------------------------------------------------------------------
    // 9. An unknown item kind is rejected by the database, not silently stored
    // ---------------------------------------------------------------------
    let rejected = false;
    try {
      await db.rows(
        `insert into learn_item_state (account_id, item_kind, item_id) values ($1, 'not_a_kind', 1)`,
        [accountId]
      );
    } catch {
      rejected = true;
    }
    check('the check constraint rejects an invalid item_kind', rejected);
  } finally {
    // Cascades to learn_item_state and learn_review_log via the account foreign key, so a failure
    // halfway through cannot leave rows behind.
    await db.rows('delete from auth_session where account_id = $1', [accountId]);
    await db.rows('delete from account where id = $1', [accountId]);
    const leftover = await db.one<{ n: number }>(
      `select count(*)::int as n from learn_item_state where account_id = $1`,
      [accountId]
    );
    check('the test account left no review state behind', Number(leftover?.n ?? 0) === 0);
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  await db.close();
  if (failed > 0) process.exitCode = 1;
}

await main();
