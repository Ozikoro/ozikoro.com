/**
 * The linguistic evaluation harness.
 *
 * Spec §8.1: "Evaluation set. Linguists write and maintain at least 200 test prompts with
 * reference answers (translation, grammar, correction, culture). Every change to model, provider
 * or prompt MUST be run against this set and results stored before release."
 *
 * Spec §8.3 names the six things measured: lexical accuracy, orthography, grammar, cultural
 * context, regional variation and instruction following.
 *
 * Spec §8.2: "Evaluation harness — Measure AI quality on a curated test set. Runs before any model
 * or prompt change ships."
 *
 * WHY THE HARNESS SHIPS BEFORE THE CASES DO
 *
 * The 200 cases are a linguist deliverable — §2.1 forbids an agent writing Igbo reference answers,
 * so they cannot be authored here and are blocked on §18 #4. But the harness is code, and building
 * it now is what makes the first real evaluation possible on the day the cases arrive rather than
 * a week later. It also fixes the shape the linguists write into, which is the difference between
 * receiving 200 usable cases and 200 rows that need reshaping.
 *
 * WHAT "STORED BEFORE RELEASE" REQUIRES OF THIS CODE
 *
 * A report has to be comparable across runs, or storing it achieves nothing. So a report carries
 * the prompt versions, provider and model that produced it, and {@link compareReports} answers the
 * question a release actually asks: did this change make anything worse? §8.1's rule is that a
 * change is run against the set before it ships, and a bare pass rate cannot detect a change that
 * fixed three cases and broke four.
 */
import type { AiUsage } from './gateway.ts';
import type { TutorMode } from './prompts.ts';
import { toSearchForm } from '../orthography.ts';

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** §8.3's six measures. Every case belongs to exactly one. */
export type EvalCategory =
  | 'lexical_accuracy'
  | 'orthography'
  | 'grammar'
  | 'cultural_context'
  | 'regional_variation'
  | 'instruction_following';

export const EVAL_CATEGORIES: readonly EvalCategory[] = [
  'lexical_accuracy',
  'orthography',
  'grammar',
  'cultural_context',
  'regional_variation',
  'instruction_following',
];

/** §8.1's stated minimum. A smaller set cannot certify a release. */
export const MINIMUM_EVAL_CASES = 200;

export interface EvalCase {
  id: string;
  category: EvalCategory;
  mode: TutorMode;
  /** What the learner asks. */
  input: string;
  /**
   * The reviewed answer, for humans reading a failure. Never machine-compared as a whole — two
   * correct answers to a language question are rarely word-for-word identical, and comparing them
   * as strings would fail good answers.
   */
  referenceAnswer: string;
  /** Each of these must appear in a correct answer. Compared with diacritics folded. */
  mustInclude?: string[];
  /** None of these may appear. Used for the things a correct answer must not say. */
  mustNotInclude?: string[];
  /** The expected trust label, where the case has a determined answer. */
  expectedTrust?: 'verified' | 'unverified';
  /** Set when the correct behaviour is to refuse or fall back rather than answer. */
  expectFallback?: boolean;
  /** Who wrote it, so a failing case can be taken back to its author. §11.5's two-person review. */
  authoredBy?: string;
}

// ---------------------------------------------------------------------------
// Scoring one case
// ---------------------------------------------------------------------------

export interface CaseFailure {
  code:
    | 'missing_expected_content'
    | 'contains_forbidden_content'
    | 'wrong_trust'
    | 'should_have_fallen_back'
    | 'fell_back_unexpectedly'
    | 'empty_answer'
    | 'category_not_covered';
  detail: string;
}

export interface CaseOutcome {
  caseId: string;
  category: EvalCategory;
  passed: boolean;
  failures: CaseFailure[];
}

/** What the model produced for one case. */
export interface EvalActual {
  answer: string;
  trust?: 'verified' | 'unverified';
  /** True when the validator replaced the answer with the safe fallback. */
  fellBack?: boolean;
  usage?: AiUsage;
  latencyMs?: number;
}

/**
 * Score one case.
 *
 * Content comparison folds diacritics, because §8.3 measures orthography as a CATEGORY — an
 * orthography case says so in `mustInclude` by listing the correctly-marked form — while the
 * other five categories should not fail a good answer over a mark. Applying one comparison to
 * every category would make the orthography measure either meaningless or everywhere.
 */
export function scoreCase(testCase: EvalCase, actual: EvalActual): CaseOutcome {
  const failures: CaseFailure[] = [];
  const answer = actual.answer ?? '';
  const folded = toSearchForm(answer);

  if (testCase.expectFallback) {
    if (!actual.fellBack) {
      failures.push({
        code: 'should_have_fallen_back',
        detail: 'this case must be refused or fall back, and an answer was returned instead',
      });
    }
    return { caseId: testCase.id, category: testCase.category, passed: failures.length === 0, failures };
  }

  if (actual.fellBack) {
    failures.push({
      code: 'fell_back_unexpectedly',
      detail: 'the answer was replaced by the safe fallback, so the case was not answered',
    });
    return { caseId: testCase.id, category: testCase.category, passed: false, failures };
  }

  if (answer.trim() === '') {
    failures.push({ code: 'empty_answer', detail: 'no answer was produced' });
  }

  for (const expected of testCase.mustInclude ?? []) {
    // Orthography cases compare the exact recorded form; everything else folds.
    const needle = testCase.category === 'orthography' ? expected : toSearchForm(expected);
    const haystack = testCase.category === 'orthography' ? answer : folded;
    if (!haystack.includes(needle)) {
      failures.push({
        code: 'missing_expected_content',
        detail: `expected ${JSON.stringify(expected)} in the answer`,
      });
    }
  }

  for (const forbidden of testCase.mustNotInclude ?? []) {
    if (folded.includes(toSearchForm(forbidden))) {
      failures.push({
        code: 'contains_forbidden_content',
        detail: `the answer must not contain ${JSON.stringify(forbidden)}`,
      });
    }
  }

  if (testCase.expectedTrust && actual.trust !== testCase.expectedTrust) {
    failures.push({
      code: 'wrong_trust',
      detail: `expected trust "${testCase.expectedTrust}", got "${actual.trust ?? 'none'}"`,
    });
  }

  return { caseId: testCase.id, category: testCase.category, passed: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Set quality
// ---------------------------------------------------------------------------

export interface EvalSetProblem {
  severity: 'error' | 'warning';
  detail: string;
}

/**
 * Check the set itself, before it is used to judge anything.
 *
 * A weak set produces confident numbers, which is worse than no numbers. The checks that matter
 * are the ones that make a report misleading: duplicate ids (double-counting a case), an
 * uncovered category (a §8.3 measure with nothing behind it), a case that cannot fail, and a
 * category carrying too few cases to mean anything.
 */
export function validateEvalSet(cases: readonly EvalCase[]): EvalSetProblem[] {
  const problems: EvalSetProblem[] = [];

  if (cases.length < MINIMUM_EVAL_CASES) {
    problems.push({
      severity: 'error',
      detail:
        `${cases.length} cases; §8.1 requires at least ${MINIMUM_EVAL_CASES}. ` +
        'A release cannot be certified against a smaller set.',
    });
  }

  const ids = new Set<string>();
  for (const testCase of cases) {
    if (ids.has(testCase.id)) {
      problems.push({ severity: 'error', detail: `duplicate case id "${testCase.id}"` });
    }
    ids.add(testCase.id);

    if (testCase.referenceAnswer.trim().length < 3) {
      problems.push({ severity: 'error', detail: `case "${testCase.id}" has no real reference answer` });
    }

    const hasExpectation =
      (testCase.mustInclude?.length ?? 0) > 0 ||
      (testCase.mustNotInclude?.length ?? 0) > 0 ||
      testCase.expectedTrust !== undefined ||
      testCase.expectFallback === true;

    if (!hasExpectation) {
      // Such a case passes whatever the model says, so it inflates the score while measuring
      // nothing.
      problems.push({
        severity: 'error',
        detail: `case "${testCase.id}" cannot fail — it states no expectation`,
      });
    }

    if (testCase.expectFallback && testCase.mustInclude?.length) {
      problems.push({
        severity: 'warning',
        detail: `case "${testCase.id}" expects a fallback and also expects content; the content will not be checked`,
      });
    }

    if (!testCase.authoredBy) {
      problems.push({
        severity: 'warning',
        detail: `case "${testCase.id}" does not record who wrote it (§11.5 two-person review)`,
      });
    }
  }

  for (const category of EVAL_CATEGORIES) {
    const count = cases.filter((testCase) => testCase.category === category).length;
    if (count === 0) {
      problems.push({
        severity: 'error',
        detail: `no cases cover "${category}", so §8.3's measure for it has nothing behind it`,
      });
    } else if (count < 10) {
      problems.push({
        severity: 'warning',
        detail: `only ${count} case(s) cover "${category}"; the rate will be noisy`,
      });
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface CategoryScore {
  total: number;
  passed: number;
  rate: number;
}

export interface EvalReport {
  /** ISO timestamp. Part of the stored artifact. */
  runAt: string;
  providerId: string;
  model: string;
  /** Prompt id@version for each mode exercised. §8.2: the version travels with the result. */
  promptVersions: Record<string, string>;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Record<EvalCategory, CategoryScore>;
  /** Only the failures, with details. A passing run's report stays small. */
  failures: { caseId: string; category: EvalCategory; failures: CaseFailure[] }[];
  usage: AiUsage;
  /** Set problems found at run time, so a stored report carries its own caveats. */
  setProblems: EvalSetProblem[];
  /** False when the set is under §8.1's minimum, whatever the pass rate says. */
  certifiable: boolean;
}

export interface EvalRunInput {
  cases: readonly EvalCase[];
  providerId: string;
  model: string;
  promptVersions: Record<string, string>;
  /** Produce one answer per case. */
  answer: (testCase: EvalCase) => Promise<EvalActual>;
  /** Injected so tests are deterministic. */
  now?: () => Date;
}

/**
 * Run the set.
 *
 * Sequential rather than parallel: an evaluation that rate-limits itself produces a mixture of
 * real answers and provider errors, and a pass rate computed over both measures the rate limiter.
 */
export async function runEvaluation(input: EvalRunInput): Promise<EvalReport> {
  const now = input.now ?? (() => new Date());
  const outcomes: CaseOutcome[] = [];
  const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };

  for (const testCase of input.cases) {
    let actual: EvalActual;
    try {
      actual = await input.answer(testCase);
    } catch (error) {
      // A crashed case is a failed case. Dropping it would raise the pass rate.
      actual = {
        answer: '',
        fellBack: true,
        ...(error ? {} : {}),
      };
    }

    if (actual.usage) {
      usage.inputTokens += actual.usage.inputTokens;
      usage.outputTokens += actual.usage.outputTokens;
    }

    outcomes.push(scoreCase(testCase, actual));
  }

  const byCategory = Object.fromEntries(
    EVAL_CATEGORIES.map((category) => {
      const inCategory = outcomes.filter((outcome) => outcome.category === category);
      const passed = inCategory.filter((outcome) => outcome.passed).length;
      return [
        category,
        {
          total: inCategory.length,
          passed,
          rate: inCategory.length === 0 ? 0 : passed / inCategory.length,
        } satisfies CategoryScore,
      ];
    })
  ) as Record<EvalCategory, CategoryScore>;

  const passed = outcomes.filter((outcome) => outcome.passed).length;
  const setProblems = validateEvalSet(input.cases);

  return {
    runAt: now().toISOString(),
    providerId: input.providerId,
    model: input.model,
    promptVersions: input.promptVersions,
    total: outcomes.length,
    passed,
    failed: outcomes.length - passed,
    passRate: outcomes.length === 0 ? 0 : passed / outcomes.length,
    byCategory,
    failures: outcomes
      .filter((outcome) => !outcome.passed)
      .map((outcome) => ({ caseId: outcome.caseId, category: outcome.category, failures: outcome.failures })),
    usage,
    setProblems,
    certifiable:
      input.cases.length >= MINIMUM_EVAL_CASES &&
      !setProblems.some((problem) => problem.severity === 'error'),
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface Regression {
  caseId: string;
  was: CategoryScore | null;
  now: CategoryScore | null;
  detail: string;
}

export interface EvalDiff {
  /** Cases that passed before and fail now. The reason to read a report at all. */
  regressed: string[];
  /** Cases that failed before and pass now. */
  fixed: string[];
  /** Per-category change in rate. */
  categoryDeltas: Record<EvalCategory, number>;
  /** True when anything got worse, whatever else improved. */
  hasRegression: boolean;
  /** True when model, provider or any prompt version differs. */
  configurationChanged: boolean;
}

/**
 * Compare a run against a stored baseline.
 *
 * §8.1 requires a stored result before release, and the reason to store it is this function: a
 * pass rate alone cannot distinguish "the change fixed four cases and broke three" from "nothing
 * happened". The prompt-version comparison is included because a like-for-like result depends on
 * it — comparing two runs made with different prompts measures the prompts, not the model.
 */
export function compareReports(baseline: EvalReport, current: EvalReport): EvalDiff {
  // The stored report keeps only failures, so a case is "previously passing" unless it is listed.
  const previouslyFailed = new Set(baseline.failures.map((failure) => failure.caseId));
  const nowFailed = new Set(current.failures.map((failure) => failure.caseId));

  const regressed = [...nowFailed].filter((id) => !previouslyFailed.has(id));
  const fixed = [...previouslyFailed].filter((id) => !nowFailed.has(id));

  const categoryDeltas = Object.fromEntries(
    EVAL_CATEGORIES.map((category) => [
      category,
      current.byCategory[category].rate - baseline.byCategory[category].rate,
    ])
  ) as Record<EvalCategory, number>;

  const configurationChanged =
    baseline.model !== current.model ||
    baseline.providerId !== current.providerId ||
    JSON.stringify(baseline.promptVersions) !== JSON.stringify(current.promptVersions);

  return {
    regressed,
    fixed,
    categoryDeltas,
    hasRegression: regressed.length > 0,
    configurationChanged,
  };
}
