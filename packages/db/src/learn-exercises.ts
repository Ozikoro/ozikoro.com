/**
 * Ozituma Learn — exercises built from a lesson's own vocabulary.
 *
 * WHY GRADING MOVED TO THE SERVER HERE, WHEN THE DICTIONARY QUIZ GRADES IN THE BROWSER
 *
 * The dictionary practice quiz (`practice.ts`) sends the answer to the browser
 * and says why that is acceptable: it is a self-study tool with no score, no
 * leaderboard and nothing to win, so cheating only wastes the cheater's time.
 * It also names the condition under which that stops being true — "when a
 * leaderboard is added, grading must move to the server and the answer must stop
 * being sent".
 *
 * Lessons changed the condition without adding a leaderboard. A lesson now has
 * persistent progress and a stored `best_score` attached to a real account, and
 * a stored score that the learner can trivially forge is worse than no score at
 * all: it is a number the platform asserts and cannot stand behind. So the
 * answer never leaves the server. The browser receives prompts and options, and
 * submits responses; the server rebuilds the lesson's exercises, grades them,
 * returns what was right and what was expected, and only then writes progress.
 *
 * That is why composition is deterministic (see the header of learn.ts) — the
 * server has to be able to rebuild the exact questions it served, from the
 * lesson content alone, without keeping session state.
 *
 * WHAT THE FOUR KINDS ARE FOR
 *
 *   igbo-to-english  reading recognition — do you know the word when you see it
 *   english-to-igo    production recall  — can you get back to the Igbo
 *   listen            listening          — can you hear it (needs a recording)
 *   recall            spelling           — can you write it, tone marks included
 *
 * `recall` is the one that matters most for Igbo and the one a multiple-choice
 * quiz cannot test at all. It is graded leniently on purpose: see foldIgbo.
 */
import type { LearnPhrase, LearnVocabItem } from './learn.ts';
import { MAX_EXERCISES, MIN_VOCAB_FOR_CHOICE } from './learn.ts';

/**
 * The exercise types a lesson can produce.
 *
 * §4 names six for v1.0: flashcard, multiple choice, match pairs, sentence builder, fill the gap,
 * listen and choose. Five are here — `match`, `build` and `gap` were added after the first four —
 * and the sixth, the flashcard, is the daily review card rather than a lesson exercise: it shows a
 * word, the learner rates their own recall, and the SRS consumes that rating. Keeping it out of this
 * union is deliberate, because a flashcard has no answer to grade and `gradeExerciseSet` grades.
 *
 * `recall` is not one of the six. It is kept because typing a word from memory is genuinely useful
 * and because removing a kind learners may have in their history would break the logs, not because
 * the spec asks for it — `gap` is the spec's "fill the gap".
 */
export type ExerciseKind =
  | 'igbo-to-english'
  | 'english-to-igbo'
  | 'listen'
  | 'recall'
  | 'match'
  | 'build'
  | 'gap';

export const KIND_DESCRIPTIONS: Record<ExerciseKind, string> = {
  'igbo-to-english': 'Choose the English meaning.',
  'english-to-igbo': 'Choose the Igbo word.',
  listen: 'Listen, then choose the word you heard.',
  recall: 'Type the Igbo for the English shown.',
  match: 'Match each Igbo word to its meaning.',
  build: 'Put the words in the right order.',
  gap: 'Fill the gap in the sentence.',
};

/**
 * Separators for the structured answers, which travel as strings.
 *
 * `gradeExerciseSet` takes `Record<string, string>` and compares strings, and that is worth keeping:
 * a response map of strings is trivially JSON-serialisable, works for a form post, and cannot carry
 * a nested object that a caller might mutate after grading. So a mapping and an ordering are
 * ENCODED into a canonical string rather than the response type being widened.
 *
 * These are the ASCII control characters for unit and record separators. They cannot appear in Igbo
 * or in an English gloss, which is the property that matters: a separator that could occur in the
 * data would let two different answers encode identically, and the learner would be marked right for
 * the wrong reason.
 */
const FIELD_SEP = '\u001f';
const ITEM_SEP = '\u001e';

/** How many pairs a match question shows. Five fits a phone screen without scrolling. */
const MATCH_PAIRS = 5;

/**
 * The fewest pairs worth asking.
 *
 * Two is a fifty-fifty guess, and a correct answer to it says nothing. Three is the smallest number
 * at which the matching itself is the work rather than the odds.
 */
const MIN_MATCH_PAIRS = 3;

/**
 * The fewest tokens a sentence needs before word order is a real question.
 *
 * "Ndewo" split once is one token; "Kedu ka ị mere" is four and has an order worth testing. Two
 * tokens is a coin toss.
 */
const MIN_SENTENCE_TOKENS = 3;

/**
 * Encode a `match` response: the learner's mapping, in an order that does not depend on the order
 * they clicked. Sorting by the left id is what makes two identical mappings compare equal.
 */
export function encodeMapping(mapping: Readonly<Record<string, string>>): string {
  return Object.keys(mapping)
    .sort()
    .map((id) => `${id}${FIELD_SEP}${mapping[id] ?? ''}`)
    .join(ITEM_SEP);
}

/** Encode a `build` response: the tokens in the order the learner placed them. */
export function encodeOrdering(tokens: readonly string[]): string {
  return tokens.join(FIELD_SEP);
}

export interface ExerciseOption {
  id: string;
  label: string;
}

/** What the browser is allowed to see. Deliberately carries no answer. */
export interface Exercise {
  id: string;
  kind: ExerciseKind;
  prompt: string;
  promptSubtitle: string | null;
  promptAudioUrl: string | null;
  /**
   * The choices, for the kinds answered by choosing: the multiple-choice pair, `listen`, and — for
   * `match` — the RIGHT-hand column, which the learner pairs against `left`.
   *
   * null for `recall`, `build` and `gap`, which are not answered from a list of meanings.
   */
  options: ExerciseOption[] | null;
  /**
   * `match` only: the left-hand column, with the id the response is keyed by.
   *
   * The pairing itself is not sent. The browser knows which left items and which right options
   * exist, and nothing else — so it cannot know the answer, and the matching is graded on the server
   * like every other kind.
   */
  left?: { id: string; label: string }[];
  /**
   * `build` only: the word bank, already shuffled.
   *
   * Sent rather than derived in the browser because the shuffle is part of the question. A client
   * that shuffled its own tokens would present a different question from the one the server will
   * grade the ordering of — which is harmless for a permutation, but only by luck, and luck is not
   * a property worth relying on.
   */
  tokens?: string[];
}

/** The answer, held server-side only. */
export interface ExerciseKey {
  kind: ExerciseKind;
  /** Correct option id, or the canonical accepted text for `recall`. */
  answer: string;
  /** Everything accepted as correct — `recall` only. */
  accept: string[];
  /** What to show the learner when they got it wrong. */
  expected: string;
  vocabId: number;
  /** Shown after answering, when there is something worth saying. */
  explanation: string | null;
}

export interface ExerciseSet {
  lessonId: number;
  exercises: Exercise[];
  /** Server-only. Never serialise this into a response. */
  key: Map<string, ExerciseKey>;
}

export interface GradedItem {
  id: string;
  correct: boolean;
  /** The learner's response, echoed back. */
  response: string;
  /** The right answer, now that answering is over. */
  expected: string;
  explanation: string | null;
}

export interface GradeResult {
  items: GradedItem[];
  correct: number;
  total: number;
  /** Percentage, rounded. */
  score: number;
}

// ---------------------------------------------------------------------------
// Deterministic helpers — no Math.random in composition
// ---------------------------------------------------------------------------

/** Deterministic shuffle from an explicit seed. Used only for presentation. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  // xorshift32: tiny, no dependency, and its quality is irrelevant here — this
  // decides which button a word appears in, not anything that must be secure.
  let state = seed || 1;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * A per-request seed. Option order must vary between sittings so a learner
 * cannot memorise "it is always the third one", but nothing else may vary.
 */
export function presentationSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) || 1;
}

/**
 * Fold Igbo to a comparison form, for grading typed answers.
 *
 * This is the single most important function in the module, and it is
 * deliberately forgiving.
 *
 * Igbo distinguishes meaning by tone and by dotted vowels: `ákwá` (egg), `àkwà`
 * (bed) and `akwa` (cry) are three different words. A learner who writes the
 * right letters with the wrong tone marks has not learned the wrong word — they
 * have learned the word and cannot yet type the orthography, which on a phone
 * with an English keyboard is not a small obstacle. Marking them wrong would
 * teach them that the keyboard is the subject.
 *
 * So: NFKD-normalise, drop every combining mark (which removes both tone marks
 * and the dots under ị ọ ụ and under ṅ), lowercase, collapse whitespace, and
 * ignore trailing punctuation. What survives is the consonant-and-vowel skeleton
 * the learner is actually being tested on.
 *
 * The tone marks are not lost from the lesson: they are on every vocabulary card
 * and every prompt. They are only not *graded* here.
 */
export function foldIgbo(value: string): string {
  return value
    .normalize('NFKD')
    // \p{M} is every combining mark — tone diacritics and the underdots both.
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[.!?,;:'"“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Which exercise kinds a lesson uses, in order, cycled across its vocabulary.
 *
 * The cycle exists so a lesson tests more than one skill without the author
 * having to specify it per word. `listen` appears only when the lesson actually
 * has recordings — a listening question with no audio is not a hard question,
 * it is an impossible one.
 */
function kindCycle(hasAnyAudio: boolean): ExerciseKind[] {
  // Ordered so the cycle opens with the easiest format and gets harder. A set that leads with
  // sentence building would put the learner's first minute on the hardest thing in it.
  //
  // `match` sits in the cycle for vocabulary and is built once per lesson rather than once per word
  // (see `buildExercises`) — it consumes the whole set of words, so cycling it per word would
  // produce the same question repeatedly.
  return hasAnyAudio
    ? ['igbo-to-english', 'english-to-igbo', 'listen', 'match', 'recall']
    : ['igbo-to-english', 'english-to-igbo', 'match', 'recall'];
}

/**
 * Pick the items to test, spread evenly across the lesson.
 *
 * Taking the first ten would mean a twenty-word lesson never tests its second
 * half, and the words at the end are usually the ones a learner is shakiest on.
 * Evenly spaced sampling across the author's order covers the lesson.
 */
function sampleEvenly<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const step = items.length / count;
  const picked: T[] = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(items[Math.floor(i * step)]!);
  }
  return picked;
}

/**
 * Choose distractor vocabulary, deterministically.
 *
 * The same lesson always produces the same wrong answers, which keeps the
 * difficulty stable between sittings and lets the server rebuild the set. What
 * varies per request is only the order they appear in.
 *
 * Length is the matching axis, for the same reason practice.ts records: an
 * obviously-longer or obviously-shorter gloss can be eliminated on sight,
 * without knowing a word of Igbo.
 */
function pickDistractors(
  pool: readonly LearnVocabItem[],
  answer: LearnVocabItem,
  answerText: string,
  textOf: (item: LearnVocabItem) => string,
  count: number
): LearnVocabItem[] {
  const candidates = pool.filter(
    (item) => item.id !== answer.id && foldIgbo(textOf(item)) !== foldIgbo(answerText)
  );
  const target = foldIgbo(answerText).length;
  return [...candidates]
    .sort((a, b) => {
      const da = Math.abs(foldIgbo(textOf(a)).length - target);
      const db = Math.abs(foldIgbo(textOf(b)).length - target);
      // Tie-break on id so the order is total and therefore stable; without
      // this, equal-length candidates would fall back to array order, which is
      // stable today and silently fragile tomorrow.
      return da - db || a.id - b.id;
    })
    .slice(0, count);
}

function buildChoice(
  lessonId: number,
  kind: ExerciseKind,
  answer: LearnVocabItem,
  pool: readonly LearnVocabItem[],
  promptKey: 'igbo' | 'english',
  seed: number
): { exercise: Exercise; key: ExerciseKey } | null {
  const promptText = answer[promptKey];
  const answerText = promptKey === 'igbo' ? answer.english : answer.igbo;
  const textOf = (item: LearnVocabItem) => (promptKey === 'igbo' ? item.english : item.igbo);

  const distractors = pickDistractors(pool, answer, answerText, textOf, 3);
  if (distractors.length < 3) return null;

  // Option ids are vocab ids, so the answer's identity is stable under shuffling
  // and the server can grade a set it did not keep in memory.
  const options: ExerciseOption[] = [
    { id: String(answer.id), label: answerText },
    ...distractors.map((item) => ({ id: String(item.id), label: textOf(item) })),
  ];
  const shuffledOptions = seededShuffle(options, seed);

  const exercise: Exercise = {
    id: `${lessonId}-${answer.id}-${kind}`,
    kind,
    // The audio prompt shows no text at all, or the question answers itself.
    prompt: kind === 'listen' ? '🔊' : promptText,
    promptSubtitle:
      kind === 'listen'
        ? 'Which word is being spoken?'
        : kind === 'igbo-to-english'
          ? 'What does this mean?'
          : 'Which word means this?',
    promptAudioUrl: kind === 'listen' ? answer.audioUrl : answer.audioUrl,
    options: shuffledOptions,
  };

  return {
    exercise,
    key: {
      kind,
      answer: String(answer.id),
      accept: [],
      expected: answerText,
      vocabId: answer.id,
      explanation: answer.literal ? `Literally: ${answer.literal}` : null,
    },
  };
}

function buildRecall(
  lessonId: number,
  answer: LearnVocabItem,
  seed: number
): { exercise: Exercise; key: ExerciseKey } {
  const exercise: Exercise = {
    id: `${lessonId}-${answer.id}-recall`,
    kind: 'recall',
    prompt: answer.english,
    promptSubtitle: 'Type this in Igbo.',
    // Deliberately absent: playing the recording here would turn a spelling
    // question into a transcription question.
    promptAudioUrl: null,
    options: null,
  };

  return {
    exercise,
    key: {
      kind: 'recall',
      answer: answer.igbo,
      // Both the exact form and the folded form are accepted, so a learner
      // without an Igbo keyboard is not failed for the keyboard.
      accept: [foldIgbo(answer.igbo)],
      expected: answer.igbo,
      vocabId: answer.id,
      explanation: answer.pronunciation ? `Say it: ${answer.pronunciation}` : null,
    },
  };
}

/**
 * Build a match-pairs question from a set of vocabulary items.
 *
 * WHAT IS SENT, AND WHAT IS NOT
 *
 * The browser receives the left column (Igbo, with ids) and the right column (English glosses,
 * shuffled) as two separate lists. It is NOT told which goes with which — the pairing is the answer,
 * and it is graded on the server like every other kind. Sending shuffled parallel arrays is what
 * makes that possible while still letting the browser render the whole question.
 *
 * WHY THE POSITION IS SEEDED FROM THE LEFT ID
 *
 * `seededShuffle` is deterministic given a seed, and the id -> label mapping has to survive the
 * shuffle: shuffling the pairs and then reading `.id` off each would reorder the ids too, which is
 * fine, but shuffling the OPTIONS and the PROMPT independently would produce two different orders
 * for the same four words and the learner would be matching against a list the server did not build.
 * The options are shuffled once, from the pairs, and the correct mapping is read from the same array.
 *
 * A minimum of three pairs is required. Two is a fifty-fifty guess and teaches nothing; three with
 * a wrong attempt is the smallest number where the matching itself is the work.
 */
function buildMatch(
  lessonId: number,
  items: readonly LearnVocabItem[],
  seed: number
): { exercise: Exercise; key: ExerciseKey } | null {
  const pairs = sampleEvenly(items, Math.min(items.length, MATCH_PAIRS));
  if (pairs.length < MIN_MATCH_PAIRS) return null;

  // Left ids stay in a stable order so the prompt does not jump around between attempts; it is the
  // RIGHT column that is shuffled, because that is the one the learner searches.
  const left = pairs.map((item) => ({ id: `m${item.id}`, label: item.igbo }));
  const rightLabels = seededShuffle(
    pairs.map((item) => item.english),
    seed
  );
  const options = rightLabels.map((label, index) => ({ id: `r${index}`, label }));

  const mapping: Record<string, string> = {};
  for (const item of pairs) mapping[`m${item.id}`] = item.english;

  const exercise: Exercise = {
    id: `${lessonId}-match-${seed}`,
    kind: 'match',
    prompt: 'Match each Igbo word to its meaning',
    promptSubtitle: `${pairs.length} pairs`,
    promptAudioUrl: null,
    options,
    left,
  };

  return {
    exercise,
    key: {
      kind: 'match',
      answer: encodeMapping(mapping),
      accept: [],
      // Readable because it is shown to a learner who got it wrong: the encoded form would be
      // control characters and would tell them nothing.
      expected: pairs.map((item) => `${item.igbo} = ${item.english}`).join(', '),
      // A match question spans several words, so there is no single vocab id. The first is recorded
      // so the field is not null; it is not used for grading, which compares the whole mapping.
      vocabId: pairs[0]!.id,
      explanation: null,
    },
  };
}

/**
 * Build a sentence-builder question from a phrase.
 *
 * This is the exercise the file's earlier note anticipated: "a sentence-level exercise (word order,
 * or gap-fill)". A phrase has no plausible one-word wrong answer, which is why it could not be a
 * multiple-choice question — but word order is exactly the thing a multiple-choice question cannot
 * test and a builder can.
 *
 * TOKENISATION IS BY WHITESPACE, AND THAT IS A LIMITATION WORTH STATING
 *
 * Igbo is written with spaces between words, so splitting on whitespace produces the words. It
 * produces them with whatever punctuation was attached, which means a trailing full stop travels
 * with the last token — and that is fine, because the learner is rearranging the same tokens the
 * answer was built from, so the comparison is exact either way. What it would NOT survive is a
 * language that writes without spaces, which is a reason to keep this in the DB layer rather than
 * in core: core's `sentence_build` question takes tokens the caller has already decided on.
 *
 * A sentence needs at least three tokens. Two is a coin toss and doing it teaches nothing about
 * order.
 */
function buildSentence(
  lessonId: number,
  phrase: LearnPhrase,
  seed: number
): { exercise: Exercise; key: ExerciseKey } | null {
  const tokens = phrase.igbo.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length < MIN_SENTENCE_TOKENS) return null;

  // The bank is shuffled; the answer is the original order. Sorting the tokens for the bank would
  // make the question guessable from the alphabet for short sentences.
  const bank = seededShuffle(tokens, seed);

  const exercise: Exercise = {
    id: `${lessonId}-build-${phrase.id}`,
    kind: 'build',
    prompt: phrase.english,
    promptSubtitle: 'Put the words in the right order.',
    promptAudioUrl: null,
    options: null,
    tokens: bank,
  };

  return {
    exercise,
    key: {
      kind: 'build',
      answer: encodeOrdering(tokens),
      accept: [],
      expected: phrase.igbo,
      vocabId: phrase.id,
      explanation: null,
    },
  };
}

/**
 * Build a fill-the-gap question from a phrase.
 *
 * §4 names this as one of the six, and it is the one that tests a word IN CONTEXT rather than in
 * isolation: the sentence is shown with one word removed and the learner supplies it from the
 * English.
 *
 * WHICH WORD IS REMOVED
 *
 * The longest token, deterministically. Removing the longest is a rough proxy for "the most
 * contentful word" — Igbo's short tokens are overwhelmingly grammatical particles, and blanking one
 * of those would test the particle rather than the vocabulary. It is a heuristic and is labelled as
 * one; a linguist choosing the target word per sentence would be better, and is the kind of thing the
 * authored curriculum should carry when it exists.
 *
 * The gap is rendered as `___` in the prompt and the answer is compared folded, so a learner typing
 * without tone marks or dot-below vowels is not failed for their keyboard — the same rule as
 * `recall`, and for the same reason.
 */
function buildGap(
  lessonId: number,
  phrase: LearnPhrase,
  seed: number
): { exercise: Exercise; key: ExerciseKey } | null {
  const tokens = phrase.igbo.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length < MIN_SENTENCE_TOKENS) return null;

  // Longest wins, and ties go to the earlier word so the choice is stable across calls.
  let targetIndex = 0;
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index]!.length > tokens[targetIndex]!.length) targetIndex = index;
  }
  const answer = tokens[targetIndex]!;

  // The gapped sentence is what the learner reads. Using a fixed-width marker rather than a
  // proportionally-sized blank keeps it legible at any font size.
  const gapped = tokens.map((token, index) => (index === targetIndex ? '___' : token)).join(' ');

  const exercise: Exercise = {
    id: `${lessonId}-gap-${phrase.id}`,
    kind: 'gap',
    prompt: gapped,
    promptSubtitle: `Fill the gap — "${phrase.english}"`,
    // The recording would speak the whole sentence including the missing word, which turns a
    // production question into a dictation one. Withheld for the same reason `recall` withholds it.
    promptAudioUrl: null,
    options: null,
  };

  return {
    exercise,
    key: {
      kind: 'gap',
      answer,
      accept: [foldIgbo(answer)],
      expected: phrase.igbo,
      vocabId: phrase.id,
      explanation: null,
    },
  };
}

/**
 * Build a lesson's exercise set.
 *
 * `seed` controls only the order of the options and the exercises; the
 * composition is fixed by the lesson's content. Pass a fresh
 * {@link presentationSeed} per request so a learner does not memorise positions,
 * and omit it in tests so the output is reproducible.
 */
export function buildExercises(
  lessonId: number,
  vocab: readonly LearnVocabItem[],
  phrases: readonly LearnPhrase[] = [],
  seed: number = 1
): ExerciseSet {
  const exercises: Exercise[] = [];
  const key = new Map<string, ExerciseKey>();

  if (vocab.length >= MIN_VOCAB_FOR_CHOICE) {
    const hasAudio = vocab.some((item) => item.audioUrl);
    const cycle = kindCycle(hasAudio);
    const chosen = sampleEvenly(vocab, Math.min(vocab.length, MAX_EXERCISES));

    chosen.forEach((item, index) => {
      let kind = cycle[index % cycle.length]!;
      // A listening question needs a recording for THIS word, not merely for
      // some word in the lesson.
      if (kind === 'listen' && !item.audioUrl) kind = 'english-to-igbo';

      // `match` is built once for the whole lesson, below, because it consumes several words at a
      // time. Producing it here would emit the same question once per word.
      if (kind === 'match') return;

      if (kind === 'recall') {
        const built = buildRecall(lessonId, item, seed + index);
        exercises.push(built.exercise);
        key.set(built.exercise.id, built.key);
        return;
      }

      // `listen` asks for the Igbo word after hearing it; `english-to-igbo` asks
      // for it after reading the English. Both key the prompt on English.
      const promptKey: 'igbo' | 'english' = kind === 'igbo-to-english' ? 'igbo' : 'english';
      const built = buildChoice(lessonId, kind, item, vocab, promptKey, seed + index);
      if (built) {
        exercises.push(built.exercise);
        key.set(built.exercise.id, built.key);
      }
    });

    // One match question per lesson, built from the same vocabulary the rest of the set uses.
    const matched = buildMatch(lessonId, chosen, seed + 101);
    if (matched) {
      exercises.push(matched.exercise);
      key.set(matched.exercise.id, matched.key);
    }
  }

  // ---------------------------------------------------------------------------
  // Sentence-level exercises, from the lesson's phrases.
  //
  // This is what `phrases` was always for. The earlier note here explained that a sentence cannot be
  // a multiple-choice question — there is no plausible one-word wrong answer — and that the
  // parameter existed so the signature would not have to change when a word-order or gap-fill
  // exercise was added. These are those, and the signature did not change.
  //
  // Both need at least MIN_SENTENCE_TOKENS tokens, and a lesson may legitimately have none long
  // enough; a lesson with only "Ndewo" as a phrase simply gets no sentence questions, which is the
  // honest outcome rather than padding the set with a two-token coin toss.
  // ---------------------------------------------------------------------------
  const usablePhrases = phrases.filter(
    (phrase) => phrase.igbo.trim().split(/\s+/).filter((token) => token.length > 0).length >= MIN_SENTENCE_TOKENS
  );

  if (usablePhrases.length > 0) {
    // One of each, from different phrases where the lesson has them, so a learner does not meet the
    // same sentence twice in one set.
    const built = buildSentence(lessonId, usablePhrases[0]!, seed + 211);
    if (built) {
      exercises.push(built.exercise);
      key.set(built.exercise.id, built.key);
    }

    const gapPhrase = usablePhrases[1] ?? usablePhrases[0]!;
    const gapped = buildGap(lessonId, gapPhrase, seed + 307);
    if (gapped) {
      exercises.push(gapped.exercise);
      key.set(gapped.exercise.id, gapped.key);
    }
  }

  return { lessonId, exercises: seededShuffle(exercises, seed + 7919), key };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grade a submission against the set the server rebuilt.
 *
 * Unanswered exercises count as wrong rather than being dropped: a learner who
 * submits with three blanks asked to be finished, and marking them correct for
 * having skipped would make the score meaningless. `total` is the size of the
 * rebuilt set, not the number of responses, so submitting nothing scores zero
 * rather than dividing by zero.
 */
export function gradeExerciseSet(set: ExerciseSet, responses: Record<string, string>): GradeResult {
  const items: GradedItem[] = set.exercises.map((exercise) => {
    const response = responses[exercise.id] ?? '';
    const answer = set.key.get(exercise.id);
    if (!answer) {
      // Composition and grading disagree, which is a bug rather than a learner
      // outcome. Fail loudly instead of silently marking it correct.
      throw new Error(`No grading key for exercise "${exercise.id}".`);
    }

    const correct = isCorrect(answer, response);

    return {
      id: exercise.id,
      correct,
      // The response is echoed verbatim for the log, except that a structured answer is shown in a
      // readable form. An encoded mapping is control characters; putting those in a result the
      // learner reads would render as nothing at all, and the runner shows `response` back to them.
      response: answer.kind === 'match' ? describeMapping(response) : response,
      expected: answer.expected,
      explanation: answer.explanation,
    };
  });

  const correct = items.filter((item) => item.correct).length;
  const total = items.length;
  return {
    items,
    correct,
    total,
    score: total === 0 ? 0 : Math.round((correct / total) * 100),
  };
}

/**
 * Whether one response is right, by kind.
 *
 * FOLDING IS APPLIED WHERE THE LEARNER TYPES AND NOT WHERE THEY CHOOSE, and that distinction is the
 * point rather than an inconsistency:
 *
 *   - `recall` and `gap` are typed. A learner without an Igbo keyboard cannot produce ị, ọ, ụ, ṅ or
 *     a tone mark, so the answer is compared folded and they are not failed for their hardware.
 *   - The others are chosen, and the choice is compared as an IDENTITY. Folding a choice would make
 *     two distinct words that differ only by tone mark — `ákwá` (egg) and `àkwà` (bed) — grade as
 *     interchangeable, teaching that the marks do not matter. They do.
 *
 * A `match` answer is all-or-nothing. Partial credit is meaningful for matching and core's
 * `scoreResponse` does compute it, but this layer's result is a boolean per exercise and the score
 * is a proportion of exercises; introducing a third verdict here would mean changing `GradedItem`,
 * the runner and the stored `best_score` at once, for one exercise type. Noted as a real
 * improvement rather than pretended away.
 */
function isCorrect(answer: ExerciseKey, response: string): boolean {
  switch (answer.kind) {
    case 'recall':
    case 'gap':
      return answer.accept.includes(foldIgbo(response));
    case 'match':
      // Both sides are compared as their canonical encoding, so the order the learner happened to
      // click in cannot change the verdict.
      return normalizeMapping(response) === answer.answer;
    default:
      return response === answer.answer;
  }
}

/**
 * Re-encode a submitted mapping canonically.
 *
 * The browser sends `leftId<US>value<RS>leftId<US>value…` in whatever order the learner paired them.
 * Sorting by id and re-joining means two submissions of the same pairing compare equal regardless
 * of click order, which is the whole reason this is not a plain string equality on the raw input.
 *
 * A malformed response yields the empty string rather than throwing: a learner cannot produce a
 * malformed one, so it means a bug or a probe, and the honest outcome for both is "wrong".
 */
function normalizeMapping(raw: string): string {
  if (raw === '') return '';
  const mapping: Record<string, string> = {};
  for (const entry of raw.split(ITEM_SEP)) {
    if (entry === '') continue;
    const separator = entry.indexOf(FIELD_SEP);
    if (separator === -1) return '';
    mapping[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return encodeMapping(mapping);
}

/** Turn an encoded mapping back into something a person can read. */
function describeMapping(raw: string): string {
  if (raw === '') return '';
  return raw
    .split(ITEM_SEP)
    .map((entry) => entry.split(FIELD_SEP).join(' → '))
    .join(', ');
}

/** Strip the grading key so a set can be sent to the browser safely. */
export function toClientSet(set: ExerciseSet): { lessonId: number; exercises: Exercise[] } {
  return { lessonId: set.lessonId, exercises: set.exercises };
}
