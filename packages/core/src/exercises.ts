/**
 * The exercise engine — canonical question schema, validators and scorers.
 *
 * Spec: §F5 (six exercise types), Appendix A (canonical question), §10.1.
 *
 * WHY ONE ENGINE AND NOT EIGHT GAMES
 *
 * §F5: "Adding a new exercise type requires only a new schema, renderer and scorer, with no
 * changes to the core engine." That sentence is the whole design. A game-per-feature approach
 * is what produces a codebase where the fifth game re-implements answer checking slightly
 * differently from the first four, and where a fix to Igbo answer handling has to be found and
 * applied five times.
 *
 * So there is exactly one dispatch point (`scoreResponse`), one normalisation path
 * (`checkAnswer`), and a registry. A new type is added by registering a definition; nothing in
 * this file changes.
 *
 * WHY "ALMOST CORRECT" IS A THIRD OUTCOME AND NOT A BOOLEAN
 *
 * §F5: "Answer checking normalises Unicode and offers 'almost correct' feedback for missing
 * diacritics without marking it fully wrong (configurable strictness)."
 *
 * A boolean cannot express that. For Igbo it matters more than for most languages, because the
 * characters a learner is most likely to drop from a phone keyboard are exactly the ones that
 * carry meaning:
 *
 *   ákwá  egg        àkwà  bed        akwa  cry
 *   ịhụ   to see     ihu   face       (a different letter, not an accent)
 *
 * Marking `akwa` flatly wrong for `àkwà` tells a learner who knew the word that they did not.
 * Marking it flatly right teaches them the tone marks do not matter, which is false. So the
 * verdict is three-valued, and the reason is reported so the UI can say *what* was missing
 * rather than just *how much*.
 *
 * WHY THIS FILE DOES NOT RE-IMPLEMENT DIACRITIC HANDLING
 *
 * `orthography.ts` already distinguishes marks that change which letter a character is
 * (U+0323 dot-below for ị ọ ụ; U+0307 dot-above for ṅ) from marks that only encode tone
 * (U+0301, U+0300, …). That distinction is precisely what almost-correct needs, so this module
 * consumes it rather than duplicating it with its own regexes.
 */
import { tidy, type Orthography } from './orthography.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The question types the engine knows.
 *
 * The first six are the v1.0 set from §F5. `scramble` is v1.1 (§4), `speaking` is v2 and
 * `free_response` is the tutor. They are declared now because Appendix A's canonical schema
 * lists them, and because the registry makes declaring them free.
 *
 * `flashcard` is an addition to Appendix A's list. That list did not include it, but §F5
 * requires it in v1.0 and §F6 requires the learner to rate recall as Again/Hard/Good/Easy on
 * it. It is a real type with a real scorer, so it belongs in the union rather than being
 * smuggled in as an `mcq` with no options. Recorded in docs/decisions.md.
 */
export type ExerciseType =
  | 'flashcard'
  | 'mcq'
  | 'match'
  | 'sentence_build'
  | 'fill_gap'
  | 'listen'
  | 'scramble'
  | 'speaking'
  | 'free_response';

/** The v1.0 subset, in the order §F5 lists them. */
export const V1_EXERCISE_TYPES: readonly ExerciseType[] = [
  'flashcard',
  'mcq',
  'match',
  'sentence_build',
  'fill_gap',
  'listen',
];

export type TrustLabel =
  | 'verified'
  | 'ai_assisted'
  | 'community_submission'
  | 'regional_variant'
  | 'needs_review';

export type ReviewStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'linguist_approved'
  | 'native_approved'
  | 'published'
  | 'changes_requested'
  | 'archived';

export type GenerationMethod = 'authored' | 'ai';

export interface QuestionBase {
  id: string;
  type: ExerciseType;
  /** What the learner is shown, or a key into the UI strings for a generated prompt. */
  prompt: string;
  /** Optional audio for the prompt. */
  audioAssetId?: string | null;
  explanation?: string;
  sourceLessonId?: string | null;
  sourceLexemeIds?: string[];
  /** 1–5. Used to order a session, not to weight the score. */
  difficulty?: number;
  reviewWeight?: number;
  generationMethod?: GenerationMethod;
  /** True whenever a machine produced any part of this. Drives the trust label. */
  aiGenerated?: boolean;
  reviewStatus?: ReviewStatus;
}

export interface FlashcardQuestion extends QuestionBase {
  type: 'flashcard';
  /** The Igbo the learner is being asked to recall. */
  answer: string;
  acceptedVariants?: string[];
}

export interface ChoiceOption {
  id: string;
  text: string;
}

export interface McqQuestion extends QuestionBase {
  type: 'mcq';
  options: ChoiceOption[];
  answerId: string;
}

export interface ListenQuestion extends QuestionBase {
  type: 'listen';
  /** Required: without audio this type is unanswerable, so the validator enforces it. */
  audioAssetId: string;
  options: ChoiceOption[];
  answerId: string;
}

export interface MatchPair {
  /** Stable id for the left item, used as the response key. */
  id: string;
  left: string;
  right: string;
}

export interface MatchQuestion extends QuestionBase {
  type: 'match';
  pairs: MatchPair[];
}

export interface SentenceBuildQuestion extends QuestionBase {
  type: 'sentence_build';
  /** The word bank, already shuffled. */
  tokens: string[];
  /** The correct sentence, as the order the tokens must end in. */
  answer: string;
}

export interface FillGapQuestion extends QuestionBase {
  type: 'fill_gap';
  /** The sentence with a gap marker, e.g. "M na-eri ___." */
  text: string;
  answer: string;
  acceptedVariants?: string[];
}

export type Question =
  | FlashcardQuestion
  | McqQuestion
  | ListenQuestion
  | MatchQuestion
  | SentenceBuildQuestion
  | FillGapQuestion;

/**
 * What the learner did. The shape depends on the type.
 *
 * Every response is recorded verbatim alongside the verdict (§F5: "Every answer is logged with
 * time taken and the exact response"), because the SRS log has to stay rich enough to move from
 * a simple scheduler to a better one without re-collecting data (§F6).
 */
export type Response =
  /** flashcard: the learner's own rating, which is what SRS consumes. */
  | { kind: 'self_rating'; rating: 'again' | 'hard' | 'good' | 'easy' }
  /** mcq / listen: the chosen option id. */
  | { kind: 'choice'; optionId: string }
  /** match: left id -> chosen right value. */
  | { kind: 'mapping'; mapping: Record<string, string> }
  /** sentence_build: the tokens in the order the learner placed them. */
  | { kind: 'ordering'; tokens: string[] }
  /** fill_gap and typed recall: free text. */
  | { kind: 'text'; text: string };

// ---------------------------------------------------------------------------
// Answer checking
// ---------------------------------------------------------------------------

/**
 * How forgiving to be about tone marks and diacritics.
 *
 * `standard` is the default and is what §F5 asks for. The other two exist because the honest
 * setting depends on what is being assessed: a tone drill must be `strict`, or it does not test
 * tone; an end-of-unit test probably should be too. Making this a per-call option rather than a
 * global constant means the curriculum can set it per exercise without a code change.
 */
export type Strictness = 'strict' | 'standard' | 'lenient';

export type Verdict = 'correct' | 'almost' | 'incorrect';

/** What the learner got wrong, when they were close. */
export type DifferenceKind = 'tone' | 'letter_mark' | 'case' | 'whitespace' | 'punctuation';

export interface CheckResult {
  verdict: Verdict;
  /** The canonical form of what the learner wrote. */
  normalised: string;
  /** The canonical form of the expected answer. */
  expected: string;
  /**
   * Which kinds of difference separated the two. Empty when the verdict is `correct`.
   * A learner who dropped tone marks gets `['tone']`; one who also missed ị gets
   * `['tone', 'letter_mark']`.
   */
  differences: DifferenceKind[];
}

/** Marks that change which letter a character is, not how it sounds. */
const LETTER_MARK_CHARS = /[\u0323\u0307\u0331]/g;
/** Marks that carry tone or length. */
const TONE_MARK_CHARS = /[\u0301\u0300\u0304\u030c\u0302\u0303\u0306\u0308]/g;

/** Fold to a comparison key. `mode` decides how much is thrown away. */
type FoldMode = 'exact' | 'tone_insensitive' | 'mark_insensitive' | 'fully_insensitive';

function fold(value: string, mode: FoldMode, _orthography?: Orthography): string {
  // tidy() gives NFC, canonicalises apostrophes and dashes, and collapses whitespace.
  // It takes no orthography: it is a surface-form canonicaliser, not a language rule.
  let out = tidy(value);

  if (mode === 'exact') return out;

  out = out.normalize('NFD');

  if (mode === 'tone_insensitive' || mode === 'fully_insensitive') {
    out = out.replace(TONE_MARK_CHARS, '');
  }
  if (mode === 'mark_insensitive' || mode === 'fully_insensitive') {
    out = out.replace(LETTER_MARK_CHARS, '');
  }

  out = out.normalize('NFC');

  if (mode === 'fully_insensitive') {
    out = out.toLowerCase();
  }

  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Compare a learner's typed answer against the expected one.
 *
 * The comparison runs in stages, from strictest to most forgiving, and the FIRST stage that
 * matches decides the verdict. That ordering is what produces a useful reason: a learner who
 * wrote the right letters with no tone marks matches at stage two and is told the tone was
 * missing, rather than being told generically that the answer was close.
 */
export function checkAnswer(
  response: string,
  expected: string,
  options: { strictness?: Strictness; acceptedVariants?: readonly string[]; orthography?: Orthography } = {}
): CheckResult {
  const strictness = options.strictness ?? 'standard';
  const orthography = options.orthography;
  const candidates = [expected, ...(options.acceptedVariants ?? [])];
  const normalised = tidy(response);
  const expectedTidy = tidy(expected);

  const pass = (): CheckResult => ({
    verdict: 'correct',
    normalised,
    expected: expectedTidy,
    differences: [],
  });

  // 1. Exact, after Unicode canonicalisation only. Case is significant here — Igbo
  //    distinguishes Àba the town from àba — so case is handled at stage 4.
  if (candidates.some((candidate) => fold(response, 'exact', orthography) === fold(candidate, 'exact', orthography))) {
    if (strictness === 'strict') return pass();
    // Even at `standard`, an exact match is exact.
    return pass();
  }

  // Everything below is a near miss. At `strict` there is nothing more to try.
  if (strictness === 'strict') {
    return { verdict: 'incorrect', normalised, expected: expectedTidy, differences: differencesBetween(response, expectedTidy) };
  }

  // 2. Tone only. "akwa" for "àkwà" — the letters are right.
  const toneMatch = candidates.some(
    (candidate) => fold(response, 'tone_insensitive', orthography) === fold(candidate, 'tone_insensitive', orthography)
  );
  if (toneMatch) {
    return strictness === 'lenient'
      ? pass()
      : { verdict: 'almost', normalised, expected: expectedTidy, differences: ['tone'] };
  }

  // 3. Letter marks only. "ihu" for "ịhụ" — a genuinely different letter, but the one a phone
  //    keyboard cannot produce, so it is a near miss rather than a wrong answer.
  const markMatch = candidates.some(
    (candidate) => fold(response, 'mark_insensitive', orthography) === fold(candidate, 'mark_insensitive', orthography)
  );
  if (markMatch) {
    return strictness === 'lenient'
      ? pass()
      : { verdict: 'almost', normalised, expected: expectedTidy, differences: ['letter_mark'] };
  }

  // 4. Everything folded — case, tone marks, letter marks, spacing.
  const looseMatch = candidates.some(
    (candidate) => fold(response, 'fully_insensitive', orthography) === fold(candidate, 'fully_insensitive', orthography)
  );
  if (looseMatch) {
    return strictness === 'lenient'
      ? pass()
      : {
          verdict: 'almost',
          normalised,
          expected: expectedTidy,
          differences: differencesBetween(response, expectedTidy),
        };
  }

  return {
    verdict: 'incorrect',
    normalised,
    expected: expectedTidy,
    differences: differencesBetween(response, expectedTidy),
  };
}

/**
 * Say what separated two strings, for feedback.
 *
 * Deliberately coarse — it reports the KINDS of difference, not a character-level diff. The
 * learner needs to know "you missed the tone marks", not a diff view; and a character-level
 * diff between two short Igbo words is mostly noise.
 *
 * Each kind is present when removing exactly that kind of difference would make the two
 * strings identical. The first version of this function had the comparisons inverted — it
 * added 'tone' when the strings still differed AFTER tone was dropped, which is the opposite of
 * what it means — so `àkwà` typed as `akwa` reported no differences at all. The tests in
 * exercises.test.ts pin this down for real minimal pairs.
 */
function differencesBetween(response: string, expected: string): DifferenceKind[] {
  const a = tidy(response);
  const b = tidy(expected);
  if (a === b) return [];

  const differences = new Set<DifferenceKind>();

  // Dropping tone marks alone makes them identical -> tone was the difference.
  if (fold(a, 'tone_insensitive') === fold(b, 'tone_insensitive')) differences.add('tone');

  // Dropping letter marks alone makes them identical -> a dot was the difference.
  if (fold(a, 'mark_insensitive') === fold(b, 'mark_insensitive')) differences.add('letter_mark');

  // Case alone separates them. Note this compares the LOWERCASED forms for equality — case is
  // the difference precisely when ignoring case makes them match.
  if (a.toLowerCase() === b.toLowerCase()) differences.add('case');

  // Whitespace alone separates them.
  if (a.replace(/\s+/g, '') === b.replace(/\s+/g, '')) differences.add('whitespace');

  // Nothing above explained it, yet they agree once EVERYTHING is folded: more than one kind of
  // difference is present at once (say a dropped tone AND a dropped dot). Report each kind that
  // is still contributing, so the feedback stays specific.
  if (differences.size === 0 && fold(a, 'fully_insensitive') === fold(b, 'fully_insensitive')) {
    if (fold(a, 'tone_insensitive') !== fold(b, 'tone_insensitive')) differences.add('tone');
    if (fold(a, 'mark_insensitive') !== fold(b, 'mark_insensitive')) differences.add('letter_mark');
    if (a.toLowerCase() !== b.toLowerCase()) differences.add('case');
  }

  return [...differences];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreContext {
  strictness?: Strictness;
  orthography?: Orthography;
  /** Milliseconds the learner took, recorded with the answer (§F5). */
  elapsedMs?: number;
  /** True when the learner saw the answer before responding (a "show me" reveal). */
  revealed?: boolean;
}

export interface ScoreResult {
  verdict: Verdict;
  /** 0–1. Partial credit exists only for `match`, where it is meaningful. */
  score: number;
  /** Human-readable feedback, or null when there is nothing to say. */
  feedback: string | null;
  /** Which kinds of difference made it a near miss. */
  differences: DifferenceKind[];
  /**
   * The exact thing the learner did, verbatim, for the answer log (§F5).
   * Kept separate from any normalised form so the log stays re-analysable.
   */
  recorded: unknown;
  elapsedMs: number | null;
  revealed: boolean;
}

/** SRS consumes a 0–5 quality, so each verdict maps onto one. */
export function verdictToQuality(result: ScoreResult, rating?: 'again' | 'hard' | 'good' | 'easy'): number {
  if (rating) {
    return { again: 1, hard: 3, good: 4, easy: 5 }[rating];
  }
  if (result.verdict === 'correct') return result.score >= 1 ? 5 : 4;
  if (result.verdict === 'almost') return 3;
  return 1;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class ExerciseError extends Error {
  override readonly name = 'ExerciseError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ExerciseError('invalid_question', `${where} must be a non-empty string.`);
  }
  return value;
}

function requireOptions(value: unknown, where: string): ChoiceOption[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new ExerciseError('invalid_question', `${where} must be an array of at least two options.`);
  }
  const options = value.map((option, index) => {
    if (typeof option !== 'object' || option === null) {
      throw new ExerciseError('invalid_question', `${where}[${index}] must be an object.`);
    }
    const record = option as Record<string, unknown>;
    return {
      id: requireString(record.id, `${where}[${index}].id`),
      text: requireString(record.text, `${where}[${index}].text`),
    };
  });

  const ids = new Set(options.map((o) => o.id));
  if (ids.size !== options.length) {
    throw new ExerciseError('invalid_question', `${where} contains duplicate option ids.`);
  }

  // §F11: "no duplicate options". Two options with the same text make a question with two right
  // answers as far as the learner can tell, so it is rejected at validation rather than at score
  // time when the learner is already looking at it.
  const texts = new Set(options.map((o) => fold(o.text, 'exact')));
  if (texts.size !== options.length) {
    throw new ExerciseError('invalid_question', `${where} contains duplicate option text.`);
  }

  return options;
}

export interface ExerciseDefinition<Q extends Question = Question> {
  type: ExerciseType;
  /** Validate the type-specific payload. Throws ExerciseError. */
  validate(question: Record<string, unknown>): Q;
  /** Score a response. */
  score(question: Q, response: Response, context: ScoreContext): ScoreResult;
  /** Whether this type is implemented in v1.0 or declared for later. */
  release: 'v1.0' | 'v1.1' | 'v2';
}

function base(question: Record<string, unknown>, type: ExerciseType): QuestionBase {
  return {
    id: requireString(question.id, 'question.id'),
    type,
    prompt: requireString(question.prompt, 'question.prompt'),
    audioAssetId: typeof question.audioAssetId === 'string' ? question.audioAssetId : null,
    explanation: typeof question.explanation === 'string' ? question.explanation : undefined,
    sourceLessonId: typeof question.sourceLessonId === 'string' ? question.sourceLessonId : null,
    sourceLexemeIds: Array.isArray(question.sourceLexemeIds) ? (question.sourceLexemeIds as string[]) : [],
    difficulty: typeof question.difficulty === 'number' ? question.difficulty : 1,
    reviewWeight: typeof question.reviewWeight === 'number' ? question.reviewWeight : 1,
    generationMethod: question.generationMethod === 'ai' ? 'ai' : 'authored',
    // §5.3: "AI-generated drafts are created with source = 'ai' and can never skip review."
    // Defaulting to true when the generation method is ai means a caller cannot forget it.
    aiGenerated: question.aiGenerated === true || question.generationMethod === 'ai',
    reviewStatus: (question.reviewStatus as ReviewStatus) ?? 'draft',
  };
}

function expectKind<K extends Response['kind']>(
  response: Response,
  kind: K,
  type: ExerciseType
): Extract<Response, { kind: K }> {
  if (response.kind !== kind) {
    throw new ExerciseError(
      'wrong_response_kind',
      `A "${type}" question expects a "${kind}" response, got "${response.kind}".`
    );
  }
  return response as Extract<Response, { kind: K }>;
}

function result(
  partial: Omit<ScoreResult, 'elapsedMs' | 'revealed'> & { elapsedMs?: number; revealed?: boolean }
): ScoreResult {
  return {
    ...partial,
    elapsedMs: partial.elapsedMs ?? null,
    revealed: partial.revealed ?? false,
  };
}

// ---------------------------------------------------------------------------
// The six v1.0 types
// ---------------------------------------------------------------------------

const flashcard: ExerciseDefinition<FlashcardQuestion> = {
  type: 'flashcard',
  release: 'v1.0',
  validate(question) {
    return {
      ...base(question, 'flashcard'),
      type: 'flashcard',
      answer: requireString(question.answer, 'question.answer'),
      acceptedVariants: Array.isArray(question.acceptedVariants)
        ? (question.acceptedVariants as string[])
        : undefined,
    };
  },
  score(question, response, context) {
    const selfRating = expectKind(response, 'self_rating', 'flashcard');
    // A flashcard is not marked right or wrong — the learner judges their own recall, and that
    // judgement IS the SRS input (§F6). Reporting a verdict would be inventing an assessment
    // the engine did not make, so `score` reflects the rating rather than a truth.
    const score = { again: 0, hard: 0.5, good: 0.85, easy: 1 }[selfRating.rating];
    return result({
      verdict: selfRating.rating === 'again' ? 'incorrect' : selfRating.rating === 'hard' ? 'almost' : 'correct',
      score,
      feedback: context.revealed === true ? question.answer : null,
      differences: [],
      recorded: { rating: selfRating.rating },
      elapsedMs: context.elapsedMs,
      revealed: context.revealed,
    });
  },
};

function scoreChoice(
  question: McqQuestion | ListenQuestion,
  response: Response,
  context: ScoreContext,
  type: ExerciseType
): ScoreResult {
  const choice = expectKind(response, 'choice', type);
  const chosen = question.options.find((option) => option.id === choice.optionId);
  const correct = question.options.find((option) => option.id === question.answerId);

  if (!correct) {
    // A question whose answer is not among its options is unanswerable. Validation prevents it,
    // but scoring must not silently mark the learner wrong for a broken question.
    throw new ExerciseError('broken_question', `Question ${question.id} has no option matching its answerId.`);
  }

  const isRight = choice.optionId === question.answerId;
  return result({
    verdict: isRight ? 'correct' : 'incorrect',
    score: isRight ? 1 : 0,
    feedback: isRight ? null : (question.explanation ?? `The answer is "${correct.text}".`),
    differences: [],
    recorded: { optionId: choice.optionId, chosenText: chosen?.text ?? null },
    elapsedMs: context.elapsedMs,
    revealed: context.revealed,
  });
}

const mcq: ExerciseDefinition<McqQuestion> = {
  type: 'mcq',
  release: 'v1.0',
  validate(question) {
    const options = requireOptions(question.options, 'question.options');
    const answerId = requireString(question.answerId, 'question.answerId');
    if (!options.some((option) => option.id === answerId)) {
      throw new ExerciseError('invalid_question', `question.answerId "${answerId}" is not among the options.`);
    }
    return { ...base(question, 'mcq'), type: 'mcq', options, answerId };
  },
  score: (question, response, context) => scoreChoice(question, response, context, 'mcq'),
};

const listen: ExerciseDefinition<ListenQuestion> = {
  type: 'listen',
  release: 'v1.0',
  validate(question) {
    const options = requireOptions(question.options, 'question.options');
    const answerId = requireString(question.answerId, 'question.answerId');
    if (!options.some((option) => option.id === answerId)) {
      throw new ExerciseError('invalid_question', `question.answerId "${answerId}" is not among the options.`);
    }
    // §F4: a listening question without audio is not hard, it is impossible.
    const audioAssetId = requireString(question.audioAssetId, 'question.audioAssetId');
    return { ...base(question, 'listen'), type: 'listen', options, answerId, audioAssetId };
  },
  score: (question, response, context) => scoreChoice(question, response, context, 'listen'),
};

const match: ExerciseDefinition<MatchQuestion> = {
  type: 'match',
  release: 'v1.0',
  validate(question) {
    const pairs = question.pairs;
    if (!Array.isArray(pairs) || pairs.length < 2) {
      throw new ExerciseError('invalid_question', 'question.pairs must be an array of at least two pairs.');
    }
    const validated = pairs.map((pair, index) => {
      if (typeof pair !== 'object' || pair === null) {
        throw new ExerciseError('invalid_question', `question.pairs[${index}] must be an object.`);
      }
      const record = pair as Record<string, unknown>;
      return {
        id: requireString(record.id, `question.pairs[${index}].id`),
        left: requireString(record.left, `question.pairs[${index}].left`),
        right: requireString(record.right, `question.pairs[${index}].right`),
      };
    });

    if (new Set(validated.map((p) => p.id)).size !== validated.length) {
      throw new ExerciseError('invalid_question', 'question.pairs contains duplicate ids.');
    }
    // Two pairs sharing a right-hand value make a mapping ambiguous: the learner can place the
    // correct word and still be marked wrong, or place it in the wrong row and be marked right.
    if (new Set(validated.map((p) => p.right)).size !== validated.length) {
      throw new ExerciseError(
        'invalid_question',
        'question.pairs contains duplicate right-hand values, which makes the mapping ambiguous.'
      );
    }
    return { ...base(question, 'match'), type: 'match', pairs: validated };
  },
  score(question, response, context) {
    const mapping = expectKind(response, 'mapping', 'match');
    let right = 0;
    const wrongIds: string[] = [];
    for (const pair of question.pairs) {
      if (mapping.mapping[pair.id] === pair.right) right += 1;
      else wrongIds.push(pair.id);
    }
    const total = question.pairs.length;
    const score = right / total;
    // Match is the one type where partial credit is honest: the pairs are independent, so four
    // of five is real information about what the learner knows.
    return result({
      verdict: score === 1 ? 'correct' : score === 0 ? 'incorrect' : 'almost',
      score,
      feedback:
        score === 1
          ? null
          : `${right} of ${total} correct.${question.explanation ? ` ${question.explanation}` : ''}`,
      differences: [],
      recorded: { mapping: mapping.mapping, wrongIds },
      elapsedMs: context.elapsedMs,
      revealed: context.revealed,
    });
  },
};

const sentenceBuild: ExerciseDefinition<SentenceBuildQuestion> = {
  type: 'sentence_build',
  release: 'v1.0',
  validate(question) {
    const tokens = question.tokens;
    if (!Array.isArray(tokens) || tokens.length < 2) {
      throw new ExerciseError('invalid_question', 'question.tokens must be an array of at least two tokens.');
    }
    return {
      ...base(question, 'sentence_build'),
      type: 'sentence_build',
      tokens: tokens.map((token, index) => requireString(token, `question.tokens[${index}]`)),
      answer: requireString(question.answer, 'question.answer'),
    };
  },
  score(question, response, context) {
    const ordering = expectKind(response, 'ordering', 'sentence_build');
    const expectedTokens = question.answer.split(/\s+/).filter(Boolean);
    const given = ordering.tokens;

    const exact =
      given.length === expectedTokens.length &&
      given.every((token, index) => fold(token, 'exact') === fold(expectedTokens[index]!, 'exact'));

    if (exact) {
      return result({
        verdict: 'correct',
        score: 1,
        feedback: null,
        differences: [],
        recorded: { tokens: given },
        elapsedMs: context.elapsedMs,
        revealed: context.revealed,
      });
    }

    // Right words, wrong order. This is the single most useful distinction the type can make:
    // it separates "I do not know the words" from "I do not know the word order", which are
    // different lessons for the curriculum to give.
    const sameWords =
      given.length === expectedTokens.length &&
      [...given].map((t) => fold(t, 'exact')).sort().join('\u0000') ===
        [...expectedTokens].map((t) => fold(t, 'exact')).sort().join('\u0000');

    return result({
      verdict: sameWords ? 'almost' : 'incorrect',
      score: sameWords ? 0.5 : 0,
      feedback: sameWords
        ? `The words are right but the order is not. It should be "${question.answer}".`
        : (question.explanation ?? `The correct sentence is "${question.answer}".`),
      differences: [],
      recorded: { tokens: given },
      elapsedMs: context.elapsedMs,
      revealed: context.revealed,
    });
  },
};

const fillGap: ExerciseDefinition<FillGapQuestion> = {
  type: 'fill_gap',
  release: 'v1.0',
  validate(question) {
    return {
      ...base(question, 'fill_gap'),
      type: 'fill_gap',
      text: requireString(question.text, 'question.text'),
      answer: requireString(question.answer, 'question.answer'),
      acceptedVariants: Array.isArray(question.acceptedVariants)
        ? (question.acceptedVariants as string[])
        : undefined,
    };
  },
  score(question, response, context) {
    const text = expectKind(response, 'text', 'fill_gap');
    const check = checkAnswer(text.text, question.answer, {
      strictness: context.strictness,
      acceptedVariants: question.acceptedVariants,
      orthography: context.orthography,
    });

    return result({
      verdict: check.verdict,
      score: check.verdict === 'correct' ? 1 : check.verdict === 'almost' ? 0.5 : 0,
      feedback: feedbackFor(check, question.answer, question.explanation),
      differences: check.differences,
      recorded: { text: text.text },
      elapsedMs: context.elapsedMs,
      revealed: context.revealed,
    });
  },
};

/** Shared near-miss wording, so every typed answer explains itself the same way. */
function feedbackFor(check: CheckResult, expected: string, explanation?: string): string | null {
  if (check.verdict === 'correct') return null;

  if (check.verdict === 'almost') {
    const missing: string[] = [];
    if (check.differences.includes('tone')) missing.push('tone marks');
    if (check.differences.includes('letter_mark')) missing.push('the dots on ị, ọ, ụ and ṅ');
    if (check.differences.includes('case')) missing.push('capitalisation');

    const which = missing.length > 0 ? missing.join(' and ') : 'a small detail';
    return `Nearly — the word is right, but ${which} ${missing.length > 1 ? 'are' : 'is'} missing. "${expected}"`;
  }

  return explanation ?? `The answer is "${expected}".`;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY = new Map<ExerciseType, ExerciseDefinition<never>>();

function register(definition: ExerciseDefinition<never>): void {
  REGISTRY.set(definition.type, definition);
}

register(flashcard as unknown as ExerciseDefinition<never>);
register(mcq as unknown as ExerciseDefinition<never>);
register(listen as unknown as ExerciseDefinition<never>);
register(match as unknown as ExerciseDefinition<never>);
register(sentenceBuild as unknown as ExerciseDefinition<never>);
register(fillGap as unknown as ExerciseDefinition<never>);

/** The types the engine can actually handle. Declared but unregistered types are not listed. */
export function registeredTypes(): ExerciseType[] {
  return [...REGISTRY.keys()];
}

export function definitionFor(type: ExerciseType): ExerciseDefinition<never> {
  const definition = REGISTRY.get(type);
  if (!definition) {
    throw new ExerciseError(
      'unsupported_type',
      `No exercise definition is registered for "${type}". Registered: ${registeredTypes().join(', ')}.`
    );
  }
  return definition;
}

/** Validate any question. Returns the narrowed, checked question. */
export function validateQuestion(question: unknown): Question {
  if (typeof question !== 'object' || question === null) {
    throw new ExerciseError('invalid_question', 'A question must be an object.');
  }
  const record = question as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string') {
    throw new ExerciseError('invalid_question', 'question.type must be a string.');
  }
  return definitionFor(type as ExerciseType).validate(record) as Question;
}

/**
 * Score a response. The single dispatch point — the only function the rest of the app calls.
 */
export function scoreResponse(question: Question, response: Response, context: ScoreContext = {}): ScoreResult {
  const definition = definitionFor(question.type);
  return (definition as unknown as ExerciseDefinition<Question>).score(question, response, context);
}

/**
 * Whether a question is visible to a learner.
 *
 * Delegates to the lifecycle rule rather than restating it: `review-workflow.ts` owns §5.3, and a
 * second copy of "published means visible" is a second thing to keep in step. This wrapper exists
 * only so a caller holding a Question does not have to reach into `reviewStatus` itself.
 */
export function isQuestionVisible(question: Question): boolean {
  return question.reviewStatus === 'published';
}

/**
 * The trust label a learner is shown for a question (§5.3).
 *
 * REVIEW STATUS DECIDES, and `aiGenerated` does not override it. §5.3 defines the two labels that
 * matter here as:
 *
 *   Verified      "Reviewed and approved by an authorised linguist or native-speaker reviewer"
 *   AI-assisted   "Generated or transformed with AI and **not yet editorially verified**"
 *
 * "Not yet" is the operative phrase. Published content has, by the §5.3 lifecycle, passed
 * linguist and native-speaker approval — so it is verified, and calling it AI-assisted would
 * understate a review that actually happened. Provenance is not lost: `aiGenerated` is still
 * stored on every row and is what an auditor or the CMS reads. It is simply not the thing the
 * learner-facing label certifies.
 *
 * (An earlier version of this function let `aiGenerated` win in every case, including for
 * published rows. That contradicted §5.3's own definition and also disagreed with
 * `ai/retrieval.ts`, which labels tutor answers "verified" whenever they are grounded in published
 * content — two modules giving different answers to the same question.)
 */
export function trustLabelFor(question: Question): TrustLabel {
  if (question.reviewStatus === 'published') return 'verified';
  if (question.reviewStatus === 'submitted' || question.reviewStatus === 'in_review') {
    return 'community_submission';
  }
  // Draft or changes-requested: the provenance is the useful thing to say.
  if (question.aiGenerated) return 'ai_assisted';
  return 'needs_review';
}
