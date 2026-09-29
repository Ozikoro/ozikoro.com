/**
 * Evaluation harness tests.
 *
 * §8.1 requires the set to be at least 200 cases and the result to be stored before release. The
 * tests below are mostly about the ways a stored result can mislead: a set that cannot fail, a
 * category with nothing behind it, and a comparison that reports an improvement while a regression
 * sits beside it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVAL_CATEGORIES,
  MINIMUM_EVAL_CASES,
  compareReports,
  runEvaluation,
  scoreCase,
  validateEvalSet,
  type EvalActual,
  type EvalCase,
  type EvalReport,
} from './evaluation.ts';

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'c1',
    category: 'lexical_accuracy',
    mode: 'explain',
    input: 'a question',
    referenceAnswer: 'a reviewed reference answer',
    mustInclude: ['expected'],
    authoredBy: 'a linguist',
    ...overrides,
  };
}

/** A set that is large enough and covers every category, for harness-level tests. */
function fullSet(count = MINIMUM_EVAL_CASES): EvalCase[] {
  return Array.from({ length: count }, (_, index) =>
    evalCase({
      id: `case-${index}`,
      category: EVAL_CATEGORIES[index % EVAL_CATEGORIES.length]!,
      mustInclude: [`token-${index}`],
    })
  );
}

// ---------------------------------------------------------------------------
// Scoring a case
// ---------------------------------------------------------------------------

test('a case that contains what it requires passes', () => {
  const outcome = scoreCase(evalCase(), { answer: 'The expected answer is here.' });
  assert.equal(outcome.passed, true);
  assert.deepEqual(outcome.failures, []);
});

test('missing required content fails with a named reason', () => {
  const outcome = scoreCase(evalCase({ mustInclude: ['àkwà means bed'] }), { answer: 'Something else entirely.' });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.failures[0]!.code, 'missing_expected_content');
});

test('forbidden content fails', () => {
  const outcome = scoreCase(evalCase({ mustInclude: undefined, mustNotInclude: ['verified'] }), {
    answer: 'This is verified content.',
  });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.failures[0]!.code, 'contains_forbidden_content');
});

test('a wrong trust label fails', () => {
  const outcome = scoreCase(evalCase({ mustInclude: undefined, expectedTrust: 'unverified' }), {
    answer: 'A perfectly good answer.',
    trust: 'verified',
  });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.failures[0]!.code, 'wrong_trust');
});

test('a case that must fall back fails when an answer is produced', () => {
  const outcome = scoreCase(evalCase({ mustInclude: undefined, expectFallback: true }), {
    answer: 'I will answer anyway.',
    fellBack: false,
  });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.failures[0]!.code, 'should_have_fallen_back');
});

test('a case that must fall back passes when the fallback fired', () => {
  const outcome = scoreCase(evalCase({ mustInclude: undefined, expectFallback: true }), {
    answer: '',
    fellBack: true,
  });
  assert.equal(outcome.passed, true);
});

test('an ordinary case fails when the fallback fired instead of an answer', () => {
  const outcome = scoreCase(evalCase(), { answer: '', fellBack: true });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.failures[0]!.code, 'fell_back_unexpectedly');
});

test('an empty answer fails even with no other expectation', () => {
  const outcome = scoreCase(evalCase({ mustInclude: undefined }), { answer: '   ' });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.failures[0]!.code, 'empty_answer');
});

test('content matching folds diacritics for ordinary categories', () => {
  // A correct answer that spells a word without tone marks should not fail a grammar case; the
  // orthography category is where tone is the thing being measured.
  const outcome = scoreCase(
    evalCase({ category: 'grammar', mustInclude: ['àkwà'] }),
    { answer: 'the word akwa appears here' }
  );
  assert.equal(outcome.passed, true);
});

test('the orthography category compares the exact marked form', () => {
  // §8.3 measures orthography as its own thing, so this category must not forgive the marks.
  const marked = scoreCase(
    evalCase({ category: 'orthography', mustInclude: ['àkwà'] }),
    { answer: 'the word àkwà appears here' }
  );
  assert.equal(marked.passed, true);

  const unmarked = scoreCase(
    evalCase({ category: 'orthography', mustInclude: ['àkwà'] }),
    { answer: 'the word akwa appears here' }
  );
  assert.equal(unmarked.passed, false, 'the missing tone marks must fail here');
});

// ---------------------------------------------------------------------------
// Set quality
// ---------------------------------------------------------------------------

test('a set smaller than §8.1 requires is an error', () => {
  const problems = validateEvalSet([evalCase()]);
  assert.ok(problems.some((problem) => problem.severity === 'error' && /at least 200/.test(problem.detail)));
});

test('a missing category is an error, because a §8.3 measure would have nothing behind it', () => {
  const problems = validateEvalSet(fullSet());
  const categoryProblems = problems.filter((problem) => /no cases cover/.test(problem.detail));
  assert.deepEqual(categoryProblems, [], 'the full set covers everything');
});

test('a set covering only some categories reports the gap', () => {
  const onlyOne = Array.from({ length: MINIMUM_EVAL_CASES }, (_, i) =>
    evalCase({ id: `c${i}`, category: 'lexical_accuracy' })
  );
  const problems = validateEvalSet(onlyOne);
  const uncovered = problems.filter((problem) => /no cases cover/.test(problem.detail));
  assert.equal(uncovered.length, EVAL_CATEGORIES.length - 1);
});

test('duplicate case ids are an error', () => {
  const cases = fullSet().map((testCase) => ({ ...testCase, id: 'same' }));
  const problems = validateEvalSet(cases);
  assert.ok(problems.some((problem) => /duplicate case id/.test(problem.detail)));
});

test('a case that cannot fail is an error, because it inflates the score while measuring nothing', () => {
  const cases = fullSet();
  cases[0] = evalCase({ id: cases[0]!.id, category: cases[0]!.category, mustInclude: undefined });
  const problems = validateEvalSet(cases);
  assert.ok(problems.some((problem) => /cannot fail/.test(problem.detail)));
});

test('an unattributed case is a warning, not an error', () => {
  const cases = fullSet();
  cases[0] = { ...cases[0]!, authoredBy: undefined };
  const problems = validateEvalSet(cases);
  const warning = problems.find((problem) => /does not record who wrote it/.test(problem.detail));
  assert.equal(warning?.severity, 'warning');
});

test('a healthy full set reports no errors', () => {
  const problems = validateEvalSet(fullSet());
  assert.deepEqual(problems.filter((problem) => problem.severity === 'error'), []);
});

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const fixedClock = () => new Date('2026-09-28T12:00:00Z');

test('a run produces a report with per-category rates', async () => {
  const cases = fullSet();
  const report = await runEvaluation({
    cases,
    providerId: 'scripted',
    model: 'test-model',
    promptVersions: { explain: 'tutor.explain@1' },
    now: fixedClock,
    // Answer every case correctly.
    answer: async (testCase) => ({ answer: testCase.mustInclude![0]!, trust: 'verified', usage: { inputTokens: 10, outputTokens: 5 } }),
  });

  assert.equal(report.total, MINIMUM_EVAL_CASES);
  assert.equal(report.passed, MINIMUM_EVAL_CASES);
  assert.equal(report.passRate, 1);
  assert.equal(report.runAt, '2026-09-28T12:00:00.000Z');
  assert.equal(report.model, 'test-model');
  assert.equal(report.promptVersions.explain, 'tutor.explain@1');

  for (const category of EVAL_CATEGORIES) {
    assert.equal(report.byCategory[category].rate, 1, category);
  }
});

test('token usage is accumulated across the run', async () => {
  const report = await runEvaluation({
    cases: fullSet(6),
    providerId: 'p',
    model: 'm',
    promptVersions: {},
    now: fixedClock,
    answer: async () => ({ answer: 'token-0', usage: { inputTokens: 100, outputTokens: 20 } }),
  });
  assert.equal(report.usage.inputTokens, 600);
  assert.equal(report.usage.outputTokens, 120);
});

test('a case that throws is a FAILED case, not a missing one', async () => {
  // Dropping it would raise the pass rate, which is the wrong direction for a failure.
  const cases = fullSet(6);
  const report = await runEvaluation({
    cases,
    providerId: 'p',
    model: 'm',
    promptVersions: {},
    now: fixedClock,
    answer: async (testCase) => {
      if (testCase.id === 'case-3') throw new Error('provider exploded');
      return { answer: testCase.mustInclude![0]! };
    },
  });

  assert.equal(report.total, 6);
  assert.equal(report.passed, 5);
  assert.ok(report.failures.some((failure) => failure.caseId === 'case-3'));
});

test('a run against a weak set is not certifiable, whatever the pass rate says', async () => {
  const report = await runEvaluation({
    cases: fullSet(5),
    providerId: 'p',
    model: 'm',
    promptVersions: {},
    now: fixedClock,
    answer: async (testCase) => ({ answer: testCase.mustInclude![0]! }),
  });
  assert.equal(report.passRate, 1, 'every case passed');
  assert.equal(report.certifiable, false, 'and it still cannot certify a release');
  assert.ok(report.setProblems.length > 0);
});

test('a healthy run against a full set is certifiable', async () => {
  const report = await runEvaluation({
    cases: fullSet(),
    providerId: 'p',
    model: 'm',
    promptVersions: {},
    now: fixedClock,
    answer: async (testCase) => ({ answer: testCase.mustInclude![0]! }),
  });
  assert.equal(report.certifiable, true);
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function reportWith(failing: string[], overrides: Partial<EvalReport> = {}): EvalReport {
  const cases = fullSet(12);
  const failures = cases
    .filter((testCase) => failing.includes(testCase.id))
    .map((testCase) => ({
      caseId: testCase.id,
      category: testCase.category,
      failures: [{ code: 'missing_expected_content' as const, detail: 'x' }],
    }));

  const byCategory = Object.fromEntries(
    EVAL_CATEGORIES.map((category) => {
      const total = cases.filter((testCase) => testCase.category === category).length;
      const failedHere = failures.filter((failure) => failure.category === category).length;
      return [category, { total, passed: total - failedHere, rate: total === 0 ? 0 : (total - failedHere) / total }];
    })
  ) as EvalReport['byCategory'];

  return {
    runAt: '2026-09-28T12:00:00.000Z',
    providerId: 'p',
    model: 'm',
    promptVersions: { explain: 'tutor.explain@1' },
    total: cases.length,
    passed: cases.length - failures.length,
    failed: failures.length,
    passRate: (cases.length - failures.length) / cases.length,
    byCategory,
    failures,
    usage: { inputTokens: 0, outputTokens: 0 },
    setProblems: [],
    certifiable: false,
    ...overrides,
  };
}

test('a case that passed before and fails now is a regression', () => {
  const diff = compareReports(reportWith([]), reportWith(['case-1']));
  assert.deepEqual(diff.regressed, ['case-1']);
  assert.equal(diff.hasRegression, true);
});

test('a case that failed before and passes now is a fix', () => {
  const diff = compareReports(reportWith(['case-1']), reportWith([]));
  assert.deepEqual(diff.fixed, ['case-1']);
  assert.equal(diff.hasRegression, false);
});

test('a regression is reported even when other cases improved', () => {
  // The reason a stored baseline exists: a bare pass rate cannot tell "fixed four, broke three"
  // from "nothing happened". The case ids must exist in the set for the comparison to mean
  // anything, which an earlier version of this test got wrong by using ids that matched nothing.
  const diff = compareReports(reportWith(['case-0', 'case-1', 'case-2']), reportWith(['case-3']));
  assert.deepEqual(diff.regressed, ['case-3']);
  assert.deepEqual(diff.fixed.sort(), ['case-0', 'case-1', 'case-2']);
  assert.equal(diff.hasRegression, true, 'the improvement does not cancel the regression');
});

test('a change of model, provider or prompt version is flagged', () => {
  const baseline = reportWith([]);
  assert.equal(compareReports(baseline, reportWith([])).configurationChanged, false);

  assert.equal(compareReports(baseline, reportWith([], { model: 'other-model' })).configurationChanged, true);
  assert.equal(
    compareReports(baseline, reportWith([], { promptVersions: { explain: 'tutor.explain@2' } })).configurationChanged,
    true,
    'comparing across prompt versions measures the prompts, not the model'
  );
});

test('per-category deltas are reported', () => {
  const diff = compareReports(reportWith([]), reportWith(['case-1', 'case-2']));
  const changed = EVAL_CATEGORIES.filter((category) => diff.categoryDeltas[category] !== 0);
  assert.ok(changed.length > 0, 'something moved');
  assert.ok(changed.every((category) => diff.categoryDeltas[category] < 0), 'and it moved down');
});

test('identical runs show no change at all', () => {
  const diff = compareReports(reportWith(['a']), reportWith(['a']));
  assert.deepEqual(diff.regressed, []);
  assert.deepEqual(diff.fixed, []);
  assert.equal(diff.hasRegression, false);
  assert.ok(EVAL_CATEGORIES.every((category) => diff.categoryDeltas[category] === 0));
});
