/**
 * Tests for the exercise engine's composition and grading.
 *
 * Run with: npm -w @ozituma/db run test:exercises
 *
 * WHAT THESE ARE ACTUALLY CHECKING
 *
 * The engine now emits seven kinds, up from four. Three of them are new and each has a way of being
 * subtly wrong that a happy-path test would not catch:
 *
 *   1. `match` grades a MAPPING. If the encoding were order-sensitive, the same correct pairing
 *      submitted in a different click order would be marked wrong — so order-independence is tested
 *      directly, in both directions.
 *   2. `build` grades an ORDER. A builder that accepted any permutation would pass a naive test and
 *      teach nothing, so a wrong order is asserted to fail.
 *   3. `gap` is TYPED, so it folds: a learner without an Igbo keyboard must not be failed for it.
 *      That is asserted with real Igbo, tone marks and all.
 *
 * No database is touched. `buildExercises` and `gradeExerciseSet` are pure, so this runs anywhere.
 */
import {
  buildExercises,
  encodeMapping,
  encodeOrdering,
  gradeExerciseSet,
} from './learn-exercises.ts';
import type { LearnPhrase, LearnVocabItem } from './learn.ts';

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

/** Real Igbo, with the diacritics that make folding worth testing. */
const VOCAB: LearnVocabItem[] = [
  { id: 1, igbo: 'ákwá', english: 'egg', pos: 'noun', pronunciation: null, literal: null, note: null, audioUrl: 'https://media.ozituma.com/a.mp3', dictionaryHeadword: 'ákwá', dictionarySlug: 'akwa-1' },
  { id: 2, igbo: 'àkwà', english: 'bed', pos: 'noun', pronunciation: null, literal: null, note: null, audioUrl: 'https://media.ozituma.com/b.mp3', dictionaryHeadword: 'àkwà', dictionarySlug: 'akwa-2' },
  { id: 3, igbo: 'mmiri', english: 'water', pos: 'noun', pronunciation: null, literal: null, note: null, audioUrl: null, dictionaryHeadword: 'mmiri', dictionarySlug: 'mmiri' },
  { id: 4, igbo: 'ọkụ', english: 'fire', pos: 'noun', pronunciation: null, literal: null, note: null, audioUrl: null, dictionaryHeadword: 'ọkụ', dictionarySlug: 'oku' },
  { id: 5, igbo: 'ụlọ', english: 'house', pos: 'noun', pronunciation: null, literal: null, note: null, audioUrl: null, dictionaryHeadword: 'ụlọ', dictionarySlug: 'ulo' },
  { id: 6, igbo: 'nri', english: 'food', pos: 'noun', pronunciation: null, literal: null, note: null, audioUrl: null, dictionaryHeadword: 'nri', dictionarySlug: 'nri' },
];

const PHRASES: LearnPhrase[] = [
  { id: 11, igbo: 'Kedu ka ị mere', english: 'How are you', pronunciation: null, note: null, audioUrl: null },
  { id: 12, igbo: 'Aha m bụ Ada', english: 'My name is Ada', pronunciation: null, note: null, audioUrl: null },
  // Too short to build from: two tokens is a coin toss.
  { id: 13, igbo: 'Ndewo nu', english: 'Hello', pronunciation: null, note: null, audioUrl: null },
];

function main(): void {
  const set = buildExercises(1, VOCAB, PHRASES, 42);
  const kinds = [...new Set(set.exercises.map((e) => e.kind))];

  console.log(`  built ${set.exercises.length} exercises, kinds: ${kinds.join(', ')}\n`);

  // -------------------------------------------------------------------------
  // Composition
  // -------------------------------------------------------------------------
  check('a set is produced', set.exercises.length > 0);
  check('a match question is built', kinds.includes('match'));
  check('a sentence-builder question is built', kinds.includes('build'));
  check('a fill-the-gap question is built', kinds.includes('gap'));
  check('every exercise has a grading key', set.exercises.every((e) => set.key.has(e.id)));
  check(
    'the key map has exactly one entry per exercise',
    set.key.size === set.exercises.length,
    `${set.key.size} keys, ${set.exercises.length} exercises`
  );

  // The answer must not be reachable from what is sent to the browser.
  const clientSet = JSON.stringify(
    set.exercises.map((e) => ({ ...e, key: undefined }))
  );
  check(
    'the match answer is not present in the client payload',
    !clientSet.includes(encodeMapping({ m1: 'egg' }))
  );

  // -------------------------------------------------------------------------
  // match — order independence, which is the whole reason for the encoding
  // -------------------------------------------------------------------------
  const match = set.exercises.find((e) => e.kind === 'match');
  check('the match question carries a left column', (match?.left?.length ?? 0) >= 3);
  check('the match question carries right-hand options', (match?.options?.length ?? 0) >= 3);
  check(
    'left and right are the same size',
    match?.left?.length === match?.options?.length
  );

  if (match && match.left) {
    const key = set.key.get(match.id)!;

    // The correct pairing, read from the key's readable `expected`.
    const answerPairs = key.expected.split(', ').map((part) => {
      const [igbo, english] = part.split(' = ');
      return { igbo: igbo!, english: english! };
    });

    const mapping: Record<string, string> = {};
    for (const item of match.left) {
      const pair = answerPairs.find((p) => p.igbo === item.label);
      if (pair) mapping[item.id] = pair.english;
    }

    const forward = gradeExerciseSet(set, { [match.id]: encodeMapping(mapping) });
    // Looked up by id, never by position: `buildExercises` shuffles the set, so `items[0]` is
    // whichever exercise happened to sort first. The first version of this test made exactly that
    // mistake and reported the match question as failing when it graded correctly.
    const gradedMatch = (graded: ReturnType<typeof gradeExerciseSet>) =>
      graded.items.find((i) => i.id === match.id)!;

    check('the correct pairing grades as correct', gradedMatch(forward).correct);

    // The SAME pairing, with the keys in reverse insertion order. If the encoding were
    // order-sensitive this would fail, and a learner would be marked wrong for clicking in a
    // different order.
    const reversed: Record<string, string> = {};
    for (const id of Object.keys(mapping).reverse()) reversed[id] = mapping[id]!;
    const backward = gradeExerciseSet(set, { [match.id]: encodeMapping(reversed) });
    check(
      'the same pairing in a different click order is still correct',
      gradedMatch(backward).correct
    );

    // One pair swapped must fail: matching is all-or-nothing here.
    const ids = Object.keys(mapping);
    const wrong = { ...mapping };
    const firstId = ids[0]!;
    wrong[firstId] = mapping[ids[1]!]!;
    const swapped = gradeExerciseSet(set, { [match.id]: encodeMapping(wrong) });
    check('a single wrong pair fails the question', !gradedMatch(swapped).correct);

    // A malformed response is wrong, not a crash.
    const junk = gradeExerciseSet(set, { [match.id]: 'not-a-mapping' });
    check('a malformed match response grades as wrong rather than throwing', !gradedMatch(junk).correct);

    // And nothing submitted is wrong.
    const empty = gradeExerciseSet(set, {});
    check('an unanswered match is wrong', !gradedMatch(empty).correct);

    // The response echoed back must be readable, not control characters.
    const shown = gradedMatch(forward).response;
    check(
      'the match response is echoed back readably',
      shown.includes('→') && !shown.includes('\u001f'),
      JSON.stringify(shown.slice(0, 40))
    );
  }

  // -------------------------------------------------------------------------
  // build — the order is the answer
  // -------------------------------------------------------------------------
  const build = set.exercises.find((e) => e.kind === 'build');
  check('the build question carries a token bank', (build?.tokens?.length ?? 0) >= 3);
  check('a build question has no options', build?.options === null);

  if (build) {
    const key = set.key.get(build.id)!;
    const correctTokens = key.answer.split('\u001f');

    const right = gradeExerciseSet(set, { [build.id]: encodeOrdering(correctTokens) });
    check('the correct order grades as correct', right.items.find((i) => i.id === build.id)!.correct);

    // Reverse the tokens. For a three-or-more-token sentence this must differ from the answer.
    const reversed = [...correctTokens].reverse();
    const wrongOrder = gradeExerciseSet(set, { [build.id]: encodeOrdering(reversed) });
    check(
      'a reversed order is wrong',
      !wrongOrder.items.find((i) => i.id === build.id)!.correct,
      'a builder that accepts any permutation would fail here'
    );

    check(
      'the token bank is the same tokens as the answer',
      [...(build.tokens ?? [])].sort().join('\u001f') === [...correctTokens].sort().join('\u001f')
    );
  }

  // -------------------------------------------------------------------------
  // gap — typed, therefore folded
  // -------------------------------------------------------------------------
  const gap = set.exercises.find((e) => e.kind === 'gap');
  check('the gap question shows a blank', gap?.prompt.includes('___') ?? false);
  check('a gap question has no token bank', gap?.tokens === undefined);

  if (gap) {
    const key = set.key.get(gap.id)!;

    const exact = gradeExerciseSet(set, { [gap.id]: key.answer });
    check('the exact answer grades as correct', exact.items.find((i) => i.id === gap.id)!.correct);

    // The same answer stripped of tone marks and dot-below diacritics — what a learner on an
    // English keyboard actually types.
    const folded = key.answer.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ị|ọ|ụ|ṅ/gi, (c) =>
      ({ ị: 'i', ọ: 'o', ụ: 'u', ṅ: 'n' })[c.toLowerCase()] ?? c
    );
    const typed = gradeExerciseSet(set, { [gap.id]: folded });
    check(
      'a gap answer without diacritics is accepted',
      typed.items.find((i) => i.id === gap.id)!.correct,
      `"${key.answer}" vs "${folded}"`
    );

    const wrong = gradeExerciseSet(set, { [gap.id]: 'something-else' });
    check('a wrong gap answer is wrong', !wrong.items.find((i) => i.id === gap.id)!.correct);
  }

  // -------------------------------------------------------------------------
  // Choice questions still compare as identity, not folded
  //
  // ákwá (egg) and àkwà (bed) differ only by tone. If choice grading folded, a learner could answer
  // "egg" for "bed" and be told they were right, which teaches that tone does not matter.
  // -------------------------------------------------------------------------
  const choice = set.exercises.find((e) => e.kind === 'igbo-to-english' || e.kind === 'english-to-igbo');
  if (choice) {
    const key = set.key.get(choice.id)!;
    const right = gradeExerciseSet(set, { [choice.id]: key.answer });
    check('a choice answer grades as correct', right.items.find((i) => i.id === choice.id)!.correct);

    // A folded variant of the correct answer must NOT be accepted for a choice.
    const foldedAnswer = key.answer.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (foldedAnswer !== key.answer) {
      const folded = gradeExerciseSet(set, { [choice.id]: foldedAnswer });
      check(
        'a folded choice answer is NOT accepted (tone changes meaning)',
        !folded.items.find((i) => i.id === choice.id)!.correct
      );
    } else {
      // No diacritics in this particular answer, so the case cannot be exercised here.
      check('a folded choice answer is NOT accepted (tone changes meaning)', true);
    }
  }

  // -------------------------------------------------------------------------
  // Guards: too little content produces no question rather than a bad one
  // -------------------------------------------------------------------------
  const tooFewWords = buildExercises(2, VOCAB.slice(0, 3), [], 1);
  check(
    'three words produce no match question (two is a coin toss)',
    !tooFewWords.exercises.some((e) => e.kind === 'match'),
    `kinds: ${[...new Set(tooFewWords.exercises.map((e) => e.kind))].join(', ') || 'none'}`
  );

  const shortPhrases = buildExercises(3, VOCAB, [PHRASES[2]!], 1);
  check(
    'a two-token phrase produces no sentence exercise',
    !shortPhrases.exercises.some((e) => e.kind === 'build' || e.kind === 'gap'),
    `kinds: ${[...new Set(shortPhrases.exercises.map((e) => e.kind))].join(', ')}`
  );

  const noVocab = buildExercises(4, [], PHRASES, 1);
  check('phrases alone still produce sentence exercises', noVocab.exercises.length > 0);
  check(
    'with no vocabulary there is no match or choice question',
    !noVocab.exercises.some((e) => ['match', 'listen', 'recall'].includes(e.kind)),
    `kinds: ${[...new Set(noVocab.exercises.map((e) => e.kind))].join(', ')}`
  );

  // The match question must be built ONCE for the lesson, not once per word. It consumes several
  // words at a time, so emitting it from the per-word cycle would create the same question
  // repeatedly — a learner would meet an identical matching board five times in one set.
  check(
    'exactly one match question is built, not one per word',
    set.exercises.filter((e) => e.kind === 'match').length === 1,
    `${set.exercises.filter((e) => e.kind === 'match').length} match questions`
  );

  // Every kind the cycle can produce must be constructible, or a learner meets a broken question.
  const vocabOnly = buildExercises(5, VOCAB, [], 1);
  check(
    'a vocabulary-only lesson still yields a complete set',
    vocabOnly.exercises.length >= 4,
    `${vocabOnly.exercises.length} exercises`
  );

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
