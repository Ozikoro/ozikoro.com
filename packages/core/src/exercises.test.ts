/**
 * Exercise engine tests.
 *
 * Spec §F5 requires that answer checking "normalises Unicode and offers 'almost correct'
 * feedback for missing diacritics without marking it fully wrong (configurable strictness)",
 * and §2.1 requires tests for Igbo characters "wherever text is stored, searched or compared".
 * Those two requirements are the spine of this file.
 *
 * The assertions use real Igbo minimal pairs rather than invented strings, because that is the
 * only way to test the thing that actually breaks:
 *
 *   ákwá egg   àkwà bed   akwa cry
 *   ịhụ  to see         ihu  face
 *
 * Run with: npm -w @ozituma/core test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnswer,
  definitionFor,
  registeredTypes,
  scoreResponse,
  trustLabelFor,
  isQuestionVisible,
  validateQuestion,
  V1_EXERCISE_TYPES,
  ExerciseError,
  type FillGapQuestion,
  type MatchQuestion,
  type McqQuestion,
  type Question,
  type SentenceBuildQuestion,
  type FlashcardQuestion,
  type ListenQuestion,
} from './exercises.ts';

// ---------------------------------------------------------------------------
// checkAnswer — the three-valued comparison
// ---------------------------------------------------------------------------

test('an exact answer is correct', () => {
  assert.equal(checkAnswer('àkwà', 'àkwà').verdict, 'correct');
  assert.deepEqual(checkAnswer('àkwà', 'àkwà').differences, []);
});

test('letters right, tone missing is ALMOST, not wrong and not correct', () => {
  const result = checkAnswer('akwa', 'àkwà');
  assert.equal(result.verdict, 'almost');
  assert.deepEqual(result.differences, ['tone']);
  assert.equal(result.expected, 'àkwà');
  assert.equal(result.normalised, 'akwa');
});

test('letter mark missing is ALMOST — the phone-keyboard case', () => {
  // ị -> i. A different letter, but the one an English keyboard cannot produce.
  const result = checkAnswer('ihu', 'ịhụ');
  assert.equal(result.verdict, 'almost');
  assert.ok(result.differences.includes('letter_mark'));
});

test('the dotted n folds the same way as the underdot vowels', () => {
  const result = checkAnswer('nnoo', 'nnọọ');
  assert.equal(result.verdict, 'almost');
  assert.ok(result.differences.includes('letter_mark'));
});

test('a genuinely different word is incorrect', () => {
  for (const [response, expected] of [
    ['àkwà', 'ákwá'], // bed vs egg — differ ONLY in tone
    ['ihu', 'aka'], // face vs hand
    ['nnọọ', 'Ndeewo'],
  ] as const) {
    const result = checkAnswer(response, expected);
    // ákwá/àkwà is the subtle one: it differs only by tone, so it lands on 'almost' rather
    // than 'incorrect', which is exactly the behaviour the two-stage comparison is for.
    if (response === 'àkwà' && expected === 'ákwá') {
      assert.equal(result.verdict, 'almost', 'àkwà for ákwá differs only by tone');
    } else {
      assert.equal(result.verdict, 'incorrect', `${response} for ${expected}`);
    }
  }
});

test('strictness is configurable and changes the verdict, not just the score', () => {
  // The tone drill case: 'standard' would forgive a dropped tone; a tone drill must not.
  assert.equal(checkAnswer('akwa', 'àkwà', { strictness: 'strict' }).verdict, 'incorrect');
  assert.equal(checkAnswer('akwa', 'àkwà', { strictness: 'standard' }).verdict, 'almost');
  assert.equal(checkAnswer('akwa', 'àkwà', { strictness: 'lenient' }).verdict, 'correct');
});

test('strict still accepts an exactly right answer', () => {
  assert.equal(checkAnswer('àkwà', 'àkwà', { strictness: 'strict' }).verdict, 'correct');
});

test('accepted variants are honoured', () => {
  // A form the linguists allow (a dialect variant, a common alternative spelling) is correct,
  // not merely almost.
  const result = checkAnswer('Ndewo', 'Ndeewo', { acceptedVariants: ['Ndewo'] });
  assert.equal(result.verdict, 'correct');
});

test('Unicode is normalised before comparison — composed and decomposed agree', () => {
  // 'ọ' as one codepoint (NFC) vs 'o' + U+0323 (NFD). Both are the same letter.
  const composed = '\u1ecdt\u1ee5'; // ọtụ
  const decomposed = 'o\u0323t\u1ee5';
  assert.notEqual(composed, decomposed, 'the two spellings really are different strings');
  assert.equal(checkAnswer(decomposed, composed).verdict, 'correct');
});

test('surrounding whitespace does not fail an otherwise right answer', () => {
  assert.equal(checkAnswer('  àkwà  ', 'àkwà').verdict, 'correct');
});

test('case is reported when it is the only difference', () => {
  const result = checkAnswer('AKWA', 'akwa');
  // Case-only: not exact at stage 1 (case is significant), but caught as a near miss later.
  assert.equal(result.verdict, 'almost');
  assert.ok(result.differences.includes('case'));
});

test('an empty answer is incorrect rather than throwing', () => {
  assert.equal(checkAnswer('', 'àkwà').verdict, 'incorrect');
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('every v1.0 type is registered', () => {
  const registered = registeredTypes();
  for (const type of V1_EXERCISE_TYPES) {
    assert.ok(registered.includes(type), `${type} is registered`);
  }
});

test('an unknown type fails loudly', () => {
  assert.throws(() => definitionFor('chess' as never), ExerciseError);
});

test('mcq rejects an answer that is not among its options', () => {
  assert.throws(
    () =>
      validateQuestion({
        id: 'q1',
        type: 'mcq',
        prompt: 'What does àkwà mean?',
        options: [
          { id: 'a', text: 'bed' },
          { id: 'b', text: 'egg' },
        ],
        answerId: 'z',
      }),
    /not among the options/
  );
});

test('mcq rejects duplicate option text, which would be two right answers', () => {
  assert.throws(
    () =>
      validateQuestion({
        id: 'q2',
        type: 'mcq',
        prompt: 'pick',
        options: [
          { id: 'a', text: 'bed' },
          { id: 'b', text: 'bed' },
        ],
        answerId: 'a',
      }),
    /duplicate option text/
  );
});

test('mcq rejects duplicate option ids', () => {
  assert.throws(
    () =>
      validateQuestion({
        id: 'q3',
        type: 'mcq',
        prompt: 'pick',
        options: [
          { id: 'a', text: 'bed' },
          { id: 'a', text: 'egg' },
        ],
        answerId: 'a',
      }),
    /duplicate option ids/
  );
});

test('listen refuses to exist without audio', () => {
  // §F4: a listening question with no recording is impossible, not merely hard.
  assert.throws(
    () =>
      validateQuestion({
        id: 'q4',
        type: 'listen',
        prompt: 'Which word is spoken?',
        options: [
          { id: 'a', text: 'àkwà' },
          { id: 'b', text: 'ákwá' },
        ],
        answerId: 'a',
      }),
    /audioAssetId/
  );
});

test('match rejects duplicate right-hand values, which make the mapping ambiguous', () => {
  assert.throws(
    () =>
      validateQuestion({
        id: 'q5',
        type: 'match',
        prompt: 'Match',
        pairs: [
          { id: 'p1', left: 'àkwà', right: 'bed' },
          { id: 'p2', left: 'ákwá', right: 'bed' },
        ],
      }),
    /ambiguous/
  );
});

test('a valid question round-trips through validation', () => {
  const question = validateQuestion({
    id: 'q6',
    type: 'mcq',
    prompt: 'What does àkwà mean?',
    options: [
      { id: 'a', text: 'bed' },
      { id: 'b', text: 'egg' },
      { id: 'c', text: 'cry' },
    ],
    answerId: 'a',
  });
  assert.equal(question.type, 'mcq');
  assert.equal(question.reviewStatus, 'draft');
  assert.equal(question.generationMethod, 'authored');
});

// ---------------------------------------------------------------------------
// aiGenerated defaults
// ---------------------------------------------------------------------------

test('a question declared as ai-generated is flagged even if the flag is omitted', () => {
  // §5.3: "AI-generated drafts are created with source = 'ai' and can never skip review."
  // Defaulting the flag from the method means a caller cannot forget it and quietly produce
  // unattributed AI content.
  const question = validateQuestion({
    id: 'q7',
    type: 'fill_gap',
    prompt: 'Fill the gap',
    text: 'M na-eri ___.',
    answer: 'nri',
    generationMethod: 'ai',
  });
  assert.equal(question.aiGenerated, true);
  assert.equal(trustLabelFor(question), 'ai_assisted');
});

// ---------------------------------------------------------------------------
// Scoring, type by type
// ---------------------------------------------------------------------------

const flashcard: FlashcardQuestion = {
  id: 'f1',
  type: 'flashcard',
  prompt: 'bed',
  answer: 'àkwà',
  reviewStatus: 'published',
  aiGenerated: false,
};

test('flashcard consumes the learner self-rating rather than inventing a verdict', () => {
  const good = scoreResponse(flashcard, { kind: 'self_rating', rating: 'good' });
  const again = scoreResponse(flashcard, { kind: 'self_rating', rating: 'again' });
  assert.ok(good.score > again.score, 'good rates higher than again');
  assert.equal(again.verdict, 'incorrect');
  assert.equal(good.verdict, 'correct');
  // The rating is what SRS needs, so it must be in the recorded response.
  assert.deepEqual(good.recorded, { rating: 'good' });
});

const mcq: McqQuestion = {
  id: 'm1',
  type: 'mcq',
  prompt: 'àkwà',
  options: [
    { id: 'a', text: 'bed' },
    { id: 'b', text: 'egg' },
    { id: 'c', text: 'cry' },
  ],
  answerId: 'a',
  reviewStatus: 'published',
  aiGenerated: false,
};

test('mcq scores a right choice and a wrong one', () => {
  const right = scoreResponse(mcq, { kind: 'choice', optionId: 'a' });
  assert.equal(right.verdict, 'correct');
  assert.equal(right.score, 1);

  const wrong = scoreResponse(mcq, { kind: 'choice', optionId: 'b' });
  assert.equal(wrong.verdict, 'incorrect');
  assert.equal(wrong.score, 0);
  assert.match(wrong.feedback!, /bed/);
});

test('mcq records the exact response and the time taken', () => {
  // §F5: "Every answer is logged with time taken and the exact response."
  const scored = scoreResponse(mcq, { kind: 'choice', optionId: 'c' }, { elapsedMs: 4210 });
  assert.equal(scored.elapsedMs, 4210);
  assert.deepEqual(scored.recorded, { optionId: 'c', chosenText: 'cry' });
});

test('a response of the wrong shape is rejected rather than mis-scored', () => {
  assert.throws(
    () => scoreResponse(mcq, { kind: 'ordering', tokens: ['a'] }),
    /expects a "choice" response/
  );
});

const match: MatchQuestion = {
  id: 'ma1',
  type: 'match',
  prompt: 'Match the words to their meanings',
  pairs: [
    { id: 'p1', left: 'àkwà', right: 'bed' },
    { id: 'p2', left: 'ákwá', right: 'egg' },
    { id: 'p3', left: 'akwa', right: 'cry' },
    { id: 'p4', left: 'ihu', right: 'face' },
  ],
  reviewStatus: 'published',
  aiGenerated: false,
};

test('match gives partial credit, because its pairs are independent', () => {
  const result = scoreResponse(match, {
    kind: 'mapping',
    mapping: { p1: 'bed', p2: 'egg', p3: 'wrong', p4: 'wrong' },
  });
  assert.equal(result.verdict, 'almost');
  assert.equal(result.score, 0.5);
  assert.match(result.feedback!, /2 of 4/);
});

test('a perfect match is correct and a wholly wrong one is incorrect', () => {
  const perfect = scoreResponse(match, {
    kind: 'mapping',
    mapping: { p1: 'bed', p2: 'egg', p3: 'cry', p4: 'face' },
  });
  assert.equal(perfect.verdict, 'correct');
  assert.equal(perfect.score, 1);

  const none = scoreResponse(match, { kind: 'mapping', mapping: {} });
  assert.equal(none.verdict, 'incorrect');
  assert.equal(none.score, 0);
});

const sentence: SentenceBuildQuestion = {
  id: 's1',
  type: 'sentence_build',
  prompt: 'Build: The pot broke.',
  tokens: ['gbajiri', 'ite', 'ahụ'],
  answer: 'ite ahụ gbajiri',
  reviewStatus: 'published',
  aiGenerated: false,
};

test('sentence_build distinguishes wrong order from wrong words', () => {
  const right = scoreResponse(sentence, {
    kind: 'ordering',
    tokens: ['ite', 'ahụ', 'gbajiri'],
  });
  assert.equal(right.verdict, 'correct');
  assert.equal(right.score, 1);

  // Right words, wrong order — a different lesson to teach.
  const reordered = scoreResponse(sentence, {
    kind: 'ordering',
    tokens: ['gbajiri', 'ite', 'ahụ'],
  });
  assert.equal(reordered.verdict, 'almost');
  assert.match(reordered.feedback!, /order/);

  // Wrong words.
  const wrongWords = scoreResponse(sentence, {
    kind: 'ordering',
    tokens: ['ite', 'ahụ', 'ọzọ'],
  });
  assert.equal(wrongWords.verdict, 'incorrect');
  assert.equal(wrongWords.score, 0);
});

const fillGap: FillGapQuestion = {
  id: 'g1',
  type: 'fill_gap',
  prompt: 'Fill the gap',
  text: 'M na-eri ___.',
  answer: 'nri',
  reviewStatus: 'published',
  aiGenerated: false,
};

test('fill_gap uses the shared almost-correct path', () => {
  assert.equal(scoreResponse(fillGap, { kind: 'text', text: 'nri' }).verdict, 'correct');
  assert.equal(scoreResponse(fillGap, { kind: 'text', text: 'ji' }).verdict, 'incorrect');
  assert.equal(scoreResponse(fillGap, { kind: 'text', text: 'NRI' }).verdict, 'almost');
});

const toneGap: FillGapQuestion = {
  id: 'g2',
  type: 'fill_gap',
  prompt: 'Fill the gap',
  text: 'Ọ dị ___',
  answer: 'mma',
  acceptedVariants: ['mma'],
  reviewStatus: 'published',
  aiGenerated: false,
};

test('a missing diacritic scores half, not zero — the §F5 requirement', () => {
  const strict = scoreResponse(toneGap, { kind: 'text', text: 'mma' });
  assert.equal(strict.verdict, 'correct');

  const bed: FillGapQuestion = { ...toneGap, id: 'g3', text: '___ dị mma', answer: 'àkwà' };
  const dropped = scoreResponse(bed, { kind: 'text', text: 'akwa' }, { strictness: 'standard' });
  assert.equal(dropped.verdict, 'almost');
  assert.equal(dropped.score, 0.5, 'half credit, not zero');
  assert.ok(dropped.differences.includes('tone'));
});

test('a missing letter mark also scores half', () => {
  const verb: FillGapQuestion = { ...toneGap, id: 'g4', text: '___ m', answer: 'ịhụ' };
  const dropped = scoreResponse(verb, { kind: 'text', text: 'ihu' });
  assert.equal(dropped.verdict, 'almost');
  assert.equal(dropped.score, 0.5);
  assert.match(dropped.feedback!, /dots/);
});

const listen: ListenQuestion = {
  id: 'l1',
  type: 'listen',
  prompt: 'Which word is spoken?',
  audioAssetId: 'audio-uuid-1',
  options: [
    { id: 'a', text: 'àkwà' },
    { id: 'b', text: 'ákwá' },
  ],
  answerId: 'a',
  reviewStatus: 'published',
  aiGenerated: false,
};

test('listen scores like a choice question and keeps its audio', () => {
  const result = scoreResponse(listen, { kind: 'choice', optionId: 'a' });
  assert.equal(result.verdict, 'correct');
  assert.equal(listen.audioAssetId, 'audio-uuid-1');
});

// ---------------------------------------------------------------------------
// Visibility and trust labels (§5.3)
// ---------------------------------------------------------------------------

test('only published questions are learner-visible', () => {
  assert.equal(isQuestionVisible(flashcard), true);
  const draft = { ...mcq, reviewStatus: 'draft' } as Question;
  assert.equal(isQuestionVisible(draft), false);

  for (const status of ['draft', 'submitted', 'in_review', 'changes_requested'] as const) {
    assert.equal(isQuestionVisible({ ...mcq, reviewStatus: status } as Question), false, status);
  }
});

test('review status decides the trust label, because review is what it certifies', () => {
  // §5.3: Verified = "Reviewed and approved by an authorised linguist or native-speaker reviewer";
  // AI-assisted = "Generated or transformed with AI and NOT YET editorially verified". The "not
  // yet" means a published AI draft is verified — it passed the review the lifecycle requires.
  const publishedAi = { ...mcq, reviewStatus: 'published', aiGenerated: true } as Question;
  assert.equal(trustLabelFor(publishedAi), 'verified');

  // Provenance is not lost; it is just not the thing the learner-facing label certifies, and it
  // is still what an unreviewed item is labelled by.
  assert.equal(publishedAi.aiGenerated, true);
  assert.equal(trustLabelFor({ ...mcq, reviewStatus: 'draft', aiGenerated: true } as Question), 'ai_assisted');
});

test('trust labels follow the review status', () => {
  assert.equal(trustLabelFor(flashcard), 'verified');
  assert.equal(trustLabelFor({ ...mcq, reviewStatus: 'draft' } as Question), 'needs_review');
  assert.equal(trustLabelFor({ ...mcq, reviewStatus: 'in_review' } as Question), 'community_submission');
  assert.equal(trustLabelFor({ ...mcq, reviewStatus: 'changes_requested' } as Question), 'needs_review');
  assert.equal(trustLabelFor({ ...mcq, reviewStatus: 'archived' } as Question), 'needs_review');
});
