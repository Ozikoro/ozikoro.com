/**
 * The two exercise types §F5 asks for that the engine does not yet render.
 *
 * WHAT WAS MISSING
 *
 * `HANDOFF.md`: "F5 Remaining exercise types: sentence builder, fill the gap (engine should render
 * from JSON)". The lesson flow already renders cards → chat → match → culture note. These two are
 * additional stages, and they are ADDITIVE: `Lesson` gains optional fields, so every existing lesson
 * keeps working untouched. Nothing was restructured to fit them.
 *
 * WHY THEY ARE NOT MORE MULTIPLE CHOICE
 *
 * `AGENTS.md`: "Keep lesson practice multimodal and context-led rather than duplicating the external
 * dictionary-generated multiple-choice drill." Free Practise already does multiple choice against the
 * dictionary. These two ask the learner to PRODUCE the sentence — order it, or supply the missing
 * word — which is the thing multiple choice cannot test and the reason §F5 lists them separately.
 *
 * EVERY STRING IS CONTENT, NOT CODE
 *
 * Both types carry the Igbo in their JSON. Nothing here composes, conjugates or corrects Igbo — the
 * renderer shuffles and compares, and the comparison is exact (NFC) because these are ordered and
 * filled from APPROVED lesson data, not typed freely. Where a learner types a word from memory, that
 * is `practice-data`, which already handles the "almost correct" hint separately.
 */

export type SentenceToken = {
  /** The Igbo word or particle. */
  text: string;
  /** Shown under the token once it is placed, so the learner learns rather than guesses. */
  gloss?: string;
};

export type SentenceBuilderExercise = {
  kind: 'sentence-builder';
  id: string;
  /** What to say, in English. The task. */
  prompt: string;
  /** The tokens in the CORRECT order. Shuffled for display. */
  answer: readonly SentenceToken[];
  /** Distractor tokens that do not belong. Optional; §F5 does not require them. */
  distractors?: readonly SentenceToken[];
  /** Shown after a correct answer. §F2 asks for a usage note per lesson. */
  note?: string;
};

export type FillGapExercise = {
  kind: 'fill-the-gap';
  id: string;
  /** A sentence with `___` where the word goes. */
  sentence: string;
  /** The correct word, NFC. */
  answer: string;
  /** Offered alongside the answer. Every one must belong to the same part of speech. */
  options: readonly string[];
  /** What the sentence means, shown after answering. */
  translation?: string;
  note?: string;
};

export type LessonExercise = SentenceBuilderExercise | FillGapExercise;

/**
 * Shuffle for display, deterministically.
 *
 * A seeded shuffle rather than `Math.random`, so the same lesson presents the same order on a
 * reload. A learner who refreshes mid-exercise and finds the tiles rearranged loses their place —
 * and worse, a teacher cannot say "the third tile" when helping.
 *
 * The seed is the exercise id, so the order is stable per exercise and different between them.
 */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) state = (state * 31 + seed.charCodeAt(i)) >>> 0;

  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Compare two Igbo strings for grading.
 *
 * NFC-normalised, per HANDOFF rule 3, and NOT diacritic-folded. Folding is a search aid — it is how
 * a learner finds `ákwá` by typing `akwa` — and §F5's exercises are graded against approved content
 * where the tones are the point. Accepting `akwa` for `ákwá` here would teach that the marks do not
 * matter, which is the opposite of what the course is for.
 */
export function sameIgbo(a: string, b: string): boolean {
  return a.normalize('NFC').trim() === b.normalize('NFC').trim();
}

/** A sentence is correct when every token matches in order. */
export function isSentenceCorrect(placed: readonly SentenceToken[], answer: readonly SentenceToken[]): boolean {
  if (placed.length !== answer.length) return false;
  return placed.every((token, index) => sameIgbo(token.text, answer[index]!.text));
}

/**
 * How many leading tokens are right.
 *
 * Used to mark the first wrong tile rather than failing the whole attempt silently. A learner who
 * ordered five of six correctly needs to be told WHICH one, or they re-order all six blindly.
 */
export function firstWrongIndex(placed: readonly SentenceToken[], answer: readonly SentenceToken[]): number {
  for (let i = 0; i < placed.length; i += 1) {
    if (!sameIgbo(placed[i]!.text, answer[i]?.text ?? '')) return i;
  }
  return -1;
}

/** Split a gap sentence for rendering: the parts either side of the blank. */
export function splitGap(sentence: string): { before: string; after: string } | null {
  const at = sentence.indexOf('___');
  if (at === -1) return null;
  return { before: sentence.slice(0, at), after: sentence.slice(at + 3) };
}
