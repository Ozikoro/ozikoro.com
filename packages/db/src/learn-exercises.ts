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

export type ExerciseKind = 'igbo-to-english' | 'english-to-igbo' | 'listen' | 'recall';

export const KIND_DESCRIPTIONS: Record<ExerciseKind, string> = {
  'igbo-to-english': 'Choose the English meaning.',
  'english-to-igbo': 'Choose the Igbo word.',
  listen: 'Listen, then choose the word you heard.',
  recall: 'Type the Igbo for the English shown.',
};

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
  /** null for `recall`, which is answered by typing rather than by choosing. */
  options: ExerciseOption[] | null;
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
  return hasAnyAudio
    ? ['igbo-to-english', 'english-to-igbo', 'listen', 'recall']
    : ['igbo-to-english', 'english-to-igbo', 'recall'];
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
  }

  // Phrases are not tested here. A full sentence has no plausible one-word
  // wrong answer, so a multiple-choice question about it would be either
  // trivial or unfair — the phrases are for reading and listening in the lesson
  // itself, and `phrases` is accepted now so the signature does not change when
  // a sentence-level exercise (word order, or gap-fill) is added.
  void phrases;

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

    const correct =
      answer.kind === 'recall'
        ? answer.accept.includes(foldIgbo(response))
        : response === answer.answer;

    return {
      id: exercise.id,
      correct,
      response,
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

/** Strip the grading key so a set can be sent to the browser safely. */
export function toClientSet(set: ExerciseSet): { lessonId: number; exercises: Exercise[] } {
  return { lessonId: set.lessonId, exercises: set.exercises };
}
