/**
 * Practice question quality test.
 *
 * A multiple-choice question is only worth asking if the wrong answers are
 * plausible. This suite is therefore mostly about the DISTRACTORS:
 *
 *   - four distinct options, exactly one of which is the answer
 *   - the answer is always among the options (a question whose answer is
 *     missing is unanswerable, and that is the failure most likely to escape
 *     a casual look)
 *   - no distractor shares a definition with the answer, which would make two
 *     options correct
 *   - distractors sit in a similar length band, so the answer cannot be chosen
 *     by shape alone
 *   - listening questions always have playable audio, because a silent
 *     listening question is broken rather than hard
 *   - dialect distractors are dialects the word is NOT recorded in, for the
 *     same "two right answers" reason
 *
 *   npm -w @ozituma/db run test:practice
 */
import { closeDb, getDb } from './client.ts';
import { generateQuestion, practiceAvailability, PRACTICE_MODES, type PracticeMode } from './practice.ts';

const db = await getDb();
let failures = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const SAMPLES = Number(process.env.OZITUMA_PRACTICE_SAMPLES ?? 120);
const language = 'ibo';

console.log('\n--- Availability ---');
const availability = await practiceAvailability(db, language);
for (const mode of PRACTICE_MODES) {
  console.log(`  ${mode.padEnd(10)} ${String(availability[mode]).padStart(7)} eligible items`);
  assert(`${mode} mode has enough content`, availability[mode] >= 50, `${availability[mode]}`);
}

// ---------------------------------------------------------------------------
// Generate a batch per mode and check every question
// ---------------------------------------------------------------------------
for (const mode of PRACTICE_MODES as PracticeMode[]) {
  console.log(`\n--- ${mode} mode: ${SAMPLES} questions ---`);

  let generated = 0;
  let withFourOptions = 0;
  let distinctLabels = 0;
  let answerPresent = 0;
  let audioPresent = 0;
  let duplicateLabels = 0;
  const labelLengths: number[] = [];

  for (let i = 0; i < SAMPLES; i += 1) {
    const question = await generateQuestion(db, { mode, language });
    if (!question) continue;
    generated += 1;

    if (question.options.length === 4) withFourOptions += 1;

    const labels = question.options.map((o) => o.label.trim().toLowerCase());
    if (new Set(labels).size === labels.length) distinctLabels += 1;
    else duplicateLabels += 1;

    if (question.options.some((o) => o.id === question.answerId)) answerPresent += 1;

    if (mode === 'listening' && question.promptAudioUrl) audioPresent += 1;

    if (mode === 'meaning') {
      const lengths = question.options.map((o) => o.label.length);
      labelLengths.push(Math.max(...lengths) - Math.min(...lengths));
    }
  }

  assert('questions were generated', generated >= SAMPLES * 0.9, `${generated}/${SAMPLES}`);
  assert(
    'every question has exactly four options',
    withFourOptions === generated,
    `${withFourOptions}/${generated}`
  );
  assert(
    'no two options have the same label',
    duplicateLabels === 0,
    duplicateLabels === 0 ? 'all distinct' : `${duplicateLabels} collisions`
  );
  assert(
    'the answer is always among the options',
    answerPresent === generated,
    `${answerPresent}/${generated}`
  );

  if (mode === 'listening') {
    assert(
      'every listening question has playable audio',
      audioPresent === generated,
      `${audioPresent}/${generated}`
    );
  }

  if (mode === 'meaning' && labelLengths.length > 0) {
    const averageSpread = labelLengths.reduce((a, b) => a + b, 0) / labelLengths.length;
    // If the answer were the only long option, the spread would be large and
    // the question answerable by shape.
    assert(
      'option lengths are comparable, so length is not a giveaway',
      averageSpread <= 24,
      `mean longest-minus-shortest: ${averageSpread.toFixed(1)} characters`
    );
  }

  // Length similarity is necessary but NOT sufficient. The first version of
  // this quiz filtered annotation markers out of the ANSWER but not the
  // distractors, so it offered "chimpanzee" beside "(fig.) individual" —
  // options of similar length that are structurally nothing alike, making the
  // answer obvious by shape. A length check passed that happily. So check the
  // shape directly, on every option and not just the answer.
  if (mode === 'meaning') {
    // Includes '=' because this corpus marks cross-references that way.
  const ANNOTATION = /\(|\)|^see\s|^[-–=]|^"|\d/;
    let annotated = 0;
    for (let i = 0; i < 80; i += 1) {
      const question = await generateQuestion(db, { mode, language });
      if (!question) continue;
      if (question.options.some((o) => ANNOTATION.test(o.label.trim()))) annotated += 1;
    }
    assert(
      'no option is a raw annotation fragment',
      annotated === 0,
      annotated === 0
        ? 'every option is a clean gloss'
        : `${annotated} questions contain annotations like "(fig.) ..."`
    );
  }
}

// ---------------------------------------------------------------------------
// Specific invariants that need a direct query, not just sampling
// ---------------------------------------------------------------------------
console.log('\n--- Answer uniqueness ---');

// Two options that mean the same thing is the worst kind of bad question.
let sharedGloss = 0;
for (let i = 0; i < 60; i += 1) {
  const question = await generateQuestion(db, { mode: 'meaning', language });
  if (!question) continue;
  const glosses = question.options.map((o) => o.label.trim().toLowerCase());
  if (new Set(glosses).size !== glosses.length) sharedGloss += 1;
}
assert('no two meaning options are the same gloss', sharedGloss === 0, `${sharedGloss} duplicates`);

/*
 * The dialect mode was removed on the owner's instruction — "I want you to not display any
 * other igbo dialect there that is not Central Igbo (Igbo Izugbe)" — so what is asserted here
 * instead is the rule that replaced it: nothing Practice offers is a dialect form.
 *
 * The test to apply is the same one the queries apply. A word is a dialect form when some
 * OTHER entry records that spelling as its form in some other dialect; a standard headword is
 * one that no other entry claims as its own dialect spelling.
 */
console.log('\n--- Practice stays in Central Igbo ---');

let dialectsOffered = 0;
let checked = 0;
for (let i = 0; i < 120; i += 1) {
  for (const mode of PRACTICE_MODES) {
    const question = await generateQuestion(db, { mode, language });
    if (!question) continue;
    checked += 1;

    // Every option offered, and the prompt itself, must be standard Igbo.
    const labels = [question.prompt, ...question.options.map((o) => o.label)];
    const dialectRows = await db.rows<{ spelling: string }>(
      `select spelling from word_dialect where lower(spelling) = any($1::text[])`,
      [labels.map((l) => l.trim().toLowerCase())]
    );
    if (dialectRows.length > 0) dialectsOffered += 1;
  }
}
assert(
  'no question offers a dialect spelling',
  dialectsOffered === 0,
  `${dialectsOffered} of ${checked} questions did`
);
assert('the modes are meanings and listening only', PRACTICE_MODES.length === 2, PRACTICE_MODES.join(', '));
assert(
  'the dialect mode is gone from the type',
  !(PRACTICE_MODES as string[]).includes('dialect')
);

console.log('\n--- Unknown language is refused ---');
try {
  await generateQuestion(db, { mode: 'meaning', language: 'zzz' });
  assert('unknown language refused', false, 'it was accepted');
} catch (error) {
  assert(
    'unknown language refused',
    error instanceof Error && error.name === 'PracticeError',
    error instanceof Error ? error.message : ''
  );
}

console.log('\n--- A second language generates its own questions ---');
// This assertion used to read "Yoruba has no questions yet", which was true
// when the test was written and stopped being true when the Yoruba corpus was
// imported. The question generator needed no change to support it — which is
// the point of the multi-language claim, so it is now asserted positively.
const yorubaQuestion = await generateQuestion(db, { mode: 'meaning', language: 'yor' });
assert(
  'Yoruba generates questions from its own corpus',
  yorubaQuestion !== null,
  yorubaQuestion ? `"${yorubaQuestion.prompt}" with ${yorubaQuestion.options.length} options` : 'null'
);
if (yorubaQuestion) {
  // The options must come from the Yoruba corpus — not Igbo bleeding across
  // languages, which a shared table would allow and which nothing else here
  // would catch.
  const yorubaGlosses = await db.rows<{ text: string }>(
    // DISTINCT: the same English gloss legitimately appears on more than one
    // Yoruba headword, so counting rows would exceed the option count.
    `select distinct d.text from definition d join word w on w.id = d.word_id
      where w.language_code = 'yor' and d.text = any($1::text[])`,
    [yorubaQuestion.options.map((o) => o.label)]
  );
  assert(
    'every option comes from the Yoruba corpus, not another language',
    yorubaGlosses.length === yorubaQuestion.options.length,
    `${yorubaGlosses.length}/${yorubaQuestion.options.length} matched`
  );
}

console.log('\n--- A language with no corpus yields no questions, not a broken one ---');
const emptyMode = await generateQuestion(db, { mode: 'meaning', language: 'hau' });
assert('Hausa has no questions yet (no corpus)', emptyMode === null, emptyMode ? 'got a question' : 'null, as expected');

console.log(
  `\n${failures === 0 ? 'ALL PRACTICE CHECKS PASSED' : `${failures} PRACTICE CHECKS FAILED`}\n`
);
process.exitCode = failures === 0 ? 0 : 1;
await closeDb();
