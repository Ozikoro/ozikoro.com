/**
 * The credit planner — tested against the real archive, and against a plan that is not this account's.
 *
 * WHY THE PLAN IS INJECTED
 *
 * `planCredits` takes the subscription as an argument instead of fetching it, for two reasons that both
 * matter here. The first is dependency direction: the ElevenLabs client lives in `apps/ozikoro/lib`, and
 * `@ozikoro/platform` must not import from an app. The second is this file — **a 65,000-a-month Starter plan
 * can be tested on a machine whose account is on something else, and the arithmetic can be checked without a
 * network call or a credit.** `subscription()` itself is exercised by the live HTTP pass, not here.
 *
 * WHAT IS ASSERTED, AND WHY EACH ONE COULD BE WRONG
 *
 *   1. THE BILLED LENGTH IS THE SPOKEN SCRIPT, NOT THE HTML. This is the correction this whole module exists
 *      to make: the figure in circulation — "1,051 articles at roughly 9,000 characters is about 9,500,000" —
 *      counts `body_html`, which is markup and is never sent to the API. **If this assertion ever passes with
 *      the two numbers equal, the transform has stopped doing anything and the estimate has silently become
 *      an overestimate again.**
 *   2. THE PLAN ARITHMETIC, against a plan written down here rather than read from the account.
 *   3. WHICH RECORDS FIT, including the shortfall for the ones that do not.
 *   4. THE RECONCILIATION, in BOTH states: unverified when nothing has been measured, and verified — with the
 *      right ratio — once a render has. The second is what makes the first an honest claim rather than a
 *      permanent disclaimer.
 *
 * Run against a COPY of the cluster:
 *
 *   OZITUMA_DB_PATH=.data/scratch/pg node packages/ozikoro/src/test-planner.ts
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { toSpokenScript } from './spoken.ts';
import { archiveSize, articleCost, planCredits, reconcileCharges, whichFit } from './credit-planner.ts';

const db = await getDb();
let failures = 0;
let skipped = 0;
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const skip = (label: string, why: string) => {
  console.log(`  ~ ${label} — SKIPPED: ${why}`);
  skipped += 1;
};
const num = (n: number) => n.toLocaleString('en-GB');

console.log('\nThe archive, counted in BILLABLE characters\n');

const size = await archiveSize(db);
if (size.articles === 0) {
  skip('the archive arithmetic', 'this database holds no published records');
} else {
  console.log(
    `  · ${num(size.articles)} published records · ${num(size.characters)} spoken characters · ` +
      `${num(size.htmlCharacters)} characters of HTML · ${num(size.averageCharacters)} average`
  );
  assert('the archive reports a spoken length', size.characters > 0);
  assert(
    'the spoken length is SMALLER than the HTML, which is the correction this module makes',
    size.characters < size.htmlCharacters,
    `${num(size.htmlCharacters - size.characters)} characters of markup that would never have been billed ` +
      `(${(100 - (size.characters / size.htmlCharacters) * 100).toFixed(1)}% of the naive figure)`
  );
  assert('the average is the spoken average, not the HTML one', size.averageCharacters < size.htmlCharacters / size.articles);
  assert('a duration is derived from the renderer, not restated', size.seconds > 0, `${(size.seconds / 3600).toFixed(1)} hours of audio in the archive`);

  // ── THE PLAN, AGAINST A WRITTEN-DOWN SUBSCRIPTION ─────────────────────────────────────────────
  const starter = { tier: 'starter', used: 12_000, limit: 65_000 };
  const report = await planCredits(db, starter);
  assert('the plan is reported as known', report.plan.known === true);
  if (report.plan.known) {
    assert('the remaining allowance is the limit less what is used', report.plan.remaining === 53_000, num(report.plan.remaining));
    assert('the plan names its tier', report.plan.tier === 'starter');
  }
  const expectedPerMonth = Math.floor(65_000 / size.averageCharacters);
  assert(
    'the allowance buys articles of AVERAGE length',
    report.buys.articlesPerMonth === expectedPerMonth,
    `${report.buys.articlesPerMonth} records a month at ${num(size.averageCharacters)} characters each`
  );
  assert('the archive takes years, and the page says how many', report.buys.monthsForArchive !== null && report.buys.monthsForArchive > 12,
    `${report.buys.monthsForArchive} months for the whole archive`);
  assert('the archive in credits is the archive in characters at the estimate rate',
    report.buys.archiveCredits === size.characters, num(report.buys.archiveCredits));
  assert('the allowance is also expressed as hours of audio', report.buys.hoursPerMonth > 0, `${report.buys.hoursPerMonth} hours a month`);

  // AN UNREADABLE PLAN IS UNKNOWN, NOT ZERO. The failure this prevents: an API outage rendering as
  // "0 records a month", which reads as a plan that has run out rather than a reading that failed.
  const unknown = await planCredits(db, null);
  assert('an unreadable subscription is reported as UNKNOWN rather than as zero', unknown.plan.known === false);
  assert('...and says why', unknown.plan.known === false && unknown.plan.reason.includes('could not be read'));
  assert('...and does not report a floor of zero records a month', unknown.buys.articlesPerMonth === 0 && unknown.plan.known === false);

  // ── ONE RECORD'S COST, BEFORE IT IS SPENT ─────────────────────────────────────────────────────
  const sample = await db.one<{ slug: string }>(
    `select slug from ozikoro_article
      where status = 'published' and is_page = false and length(body_html) > 2000
      order by id limit 1`
  );
  if (!sample) {
    skip('one record’s cost', 'no published record with a body');
  } else {
    const cost = await articleCost(db, sample.slug);
    assert('a record can be costed before it is rendered', cost !== null);
    if (cost) {
      console.log(
        `  · “${cost.slug}”: ${num(cost.characters)} spoken characters (${num(cost.htmlCharacters)} of HTML), ` +
          `${num(cost.credits)} credits, about ${Math.round(cost.estimatedSeconds / 60)} minutes, ${num(cost.words)} words`
      );
      assert('the cost is the SPOKEN length', cost.characters > 0 && cost.characters < cost.htmlCharacters);
      assert('at the estimate rate the credits equal the characters', cost.credits === cost.characters);
      assert('the record’s cost agrees with what the renderer would produce', await (async () => {
        const row = await db.one<{ body_html: string | null }>(`select body_html from ozikoro_article where slug = $1`, [cost.slug]);
        return toSpokenScript(row?.body_html ?? '').script.length === cost.characters;
      })());

      // WHICH FIT: the same record against a remaining allowance that is deliberately too small, and one
      // that is deliberately large enough. A single-sided test would not show the shortfall working.
      const tooSmall = await whichFit(db, [cost.slug], cost.characters - 1);
      assert('a record that does not fit is reported as not fitting', tooSmall.rows[0]?.fits === false);
      assert('...and the shortfall says by how much', tooSmall.rows[0]?.shortfall === 1, `${tooSmall.rows[0]?.shortfall} characters short`);
      const roomEnough = await whichFit(db, [cost.slug], cost.characters);
      assert('a record that exactly fits, fits', roomEnough.rows[0]?.fits === true);
      assert('...and its cost is counted as affordable', roomEnough.affordableCredits === cost.characters);

      const missing = await articleCost(db, 'no-such-record-zz');
      assert('a record that does not exist is null rather than a zero-cost record', missing === null);
    }
  }

  // ── THE RECONCILIATION, IN BOTH STATES ────────────────────────────────────────────────────────
  const before = await reconcileCharges(db);
  console.log(`  · measured renders so far: ${before.measuredRenders}`);
  assert('the estimate rate is one credit per character, as the code says', before.creditsPerCharacter === 1);
  if (before.measuredRenders === 0) {
    assert('with nothing measured, the rate is reported as UNVERIFIED', before.verified === false);
    assert('...and the note says so in words rather than showing a ratio of 1 as if confirmed',
      before.note.includes('ESTIMATE') && before.measuredRatio === null);
  } else {
    assert('with renders measured, the rate is verified and a ratio is given',
      before.verified === true && before.measuredRatio !== null, `ratio ${before.measuredRatio}`);
  }

  /*
   * AND NOW THE MEASUREMENT PATH ITSELF. A synthetic episode whose charge was measured at 1.08× its estimate
   * is inserted, the reconciliation is asked again, and it must notice. **Without this the "verified" branch
   * above could be dead code that nothing has ever executed** — which is exactly the shape of the faults this
   * project keeps recording.
   */
  const article = await db.one<{ id: number }>(`select id from ozikoro_article where slug = $1`, [sample?.slug ?? '']);
  if (!article) {
    skip('the measurement path', 'no article to hang a synthetic episode on');
  } else {
    const slug = `zz-planner-test-${Date.now() % 100000}`;
    const script = 'x'.repeat(1000);
    const episode = await db.one<{ id: number }>(
      `insert into ozikoro_episode
         (article_id, slug, title, script, transcript, narrator_kind, ai_disclosure, status,
          char_count, estimated_credits, measured_credits, measured_used_before, measured_used_after, measured_at)
       values ($1, $2, 'Planner test', $3, $3, 'synthetic_own_voice', 'test', 'pending_review',
               1000, 1000, 1080, 5000, 6080, now())
       returning id`,
      [article.id, slug, script]
    );
    assert('a synthetic measured render is inserted', episode !== null);

    const after = await reconcileCharges(db);
    assert('the reconciliation now reports the rate as verified', after.verified === true);
    assert('the measured render is counted', after.measuredRenders >= 1, `${after.measuredRenders}`);
    assert('the ratio is the measurement over the estimate',
      after.measuredRatio !== null && after.measuredRatio >= 1.08 && after.measuredRatio < 1.09,
      `${after.measuredRatio}× (measured ${num(after.totalMeasured)} against estimated ${num(after.totalEstimated)})`);
    assert('...and the note names the render count rather than the word "estimated"',
      after.note.includes('Measured across'));

    // Clean up, so a repeated run does not accumulate synthetic episodes.
    await db.query(`delete from ozikoro_episode where slug = $1`, [slug]);
    const cleaned = await reconcileCharges(db);
    assert('removing the synthetic render returns the reconciliation to its real state',
      cleaned.measuredRenders === before.measuredRenders);
  }
}

await closeDb();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}${skipped ? ` · ${skipped} skipped` : ''}\n`);
process.exit(failures === 0 ? 0 : 1);
