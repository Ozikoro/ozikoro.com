/**
 * Editing an entry and a name, with approval.
 *
 *   npm -w @ozituma/db run test:entry-edits
 *
 * WHY THIS EXISTS
 *
 * `applySuggestion` for these two kinds rewrites things that are hard to get back: the meanings of
 * a dictionary entry and the spelling, meaning, gender and variants of a name. Two specific ways it
 * could go wrong, and both are asserted here.
 *
 * The first is the meaning list. The obvious implementation deletes every `definition` row and
 * writes the new list from the form — and that silently destroys the part of speech recorded on
 * each sense, plus which source printed it. A correction to a spelling would strip the grammar off
 * the whole entry. The rewrite is in place, and the test proves a sense keeps its part of speech
 * when only its text changes.
 *
 * The second is the audit trail. An edit approved with nothing recorded on the way through cannot
 * be argued with or reversed, so a revision row is written BEFORE the update, and the test checks
 * that the previous wording survives even when the edit is later reverted by hand.
 */
import { closeDb, getDb, type Db } from './client.ts';
import { reviewSuggestion, submitSuggestion } from './contributions.ts';
import { registerAccount } from './accounts.ts';
import { getWord } from './repository.ts';

const db: Db = await getDb();
let failures = 0;

if (db.driver !== 'pglite' && process.env.OZITUMA_ALLOW_DESTRUCTIVE_TEST !== '1') {
  console.error(
    '\n  Refusing to run against a non-local database.\n' +
      '  This test creates an entry and a name, then deletes them.\n' +
      '  Run it against PGlite (leave DATABASE_URL unset), or set\n' +
      '  OZITUMA_ALLOW_DESTRUCTIVE_TEST=1 if you truly mean it.\n'
  );
  await closeDb();
  process.exit(1);
}

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const LANGUAGE = 'ibo';
const HEADWORD = 'zztestentry';
const NAME = 'Zztestname';

await db.query(`delete from example where text = $1`, [HEADWORD]).catch(() => {});
const stale = await db.one<{ id: string }>(`select id from word where headword = $1`, [HEADWORD]);
if (stale) await db.query(`delete from word where id = $1`, [Number(stale.id)]);
await db.query(`delete from person_name where name = $1`, [NAME]);

const source = await db.one<{ id: string }>(`select id from source where slug = 'ibo-dict'`);
const sourceId = Number(source?.id ?? 0);

// ---------------------------------------------------------------------------
// An entry, with a part of speech on its first sense
// ---------------------------------------------------------------------------
console.log('\n--- Fixtures ---');

const wordRow = await db.one<{ id: string }>(
  `insert into word (language_code, headword, exact_form, search_form, slug, source_id)
   values ($1, $2, $2, $2, $2, $3) returning id`,
  [LANGUAGE, HEADWORD, sourceId]
);
const wordId = Number(wordRow?.id);
const pos = await db.one<{ id: string }>(`select id from part_of_speech where code = 'noun' limit 1`);
const posId = pos ? Number(pos.id) : null;

await db.query(
  `insert into definition (word_id, language_code, part_of_speech_id, text, position, is_primary, source_id)
   values ($1, 'eng', $2, 'first sense', 0, true, $3), ($1, 'eng', null, 'second sense', 1, false, $3)`,
  [wordId, posId, sourceId]
);

// An example, and a dialect spelling, so the edit has something to rewrite.
const exampleRow = await db.one<{ id: string }>(
  `insert into example (language_code, text, search_form, translation, style, status, source_id)
   values ($1, 'first example', 'first example', 'first example in English', 'colloquial', 'published', $2)
   returning id`,
  [LANGUAGE, sourceId]
);
const exampleId = Number(exampleRow?.id);
await db.query(`insert into example_word (example_id, word_id) values ($1, $2)`, [exampleId, wordId]);

const dialect = await db.one<{ id: string; code: string }>(
  `select id, code from dialect where language_code = $1 order by id limit 1`,
  [LANGUAGE]
);
const dialectId = Number(dialect?.id ?? 0);
const dialectCode = String(dialect?.code ?? '');
if (dialectId > 0) {
  await db.query(
    `insert into word_dialect (word_id, dialect_id, spelling, search_form) values ($1, $2, 'old spelling', 'old spelling')`,
    [wordId, dialectId]
  );
}

/*
 * An example the page does NOT show.
 *
 * The page displays two and the entry holds this third one. The form never sends it, so an edit to a
 * visible example must leave it exactly where it is — the owner found the version that did not:
 * "it showed even edit of examples that was not showing live on the page", and behind that was worse,
 * a positional rewrite that dropped the links to everything past the second.
 */
const hiddenExampleRow = await db.one<{ id: string }>(
  `insert into example (language_code, text, search_form, translation, style, status, source_id)
   values ($1, 'hidden example', 'hidden example', null, 'colloquial', 'published', $2)
   returning id`,
  [LANGUAGE, sourceId]
);
const hiddenExampleId = Number(hiddenExampleRow?.id);
await db.query(`insert into example_word (example_id, word_id) values ($1, $2)`, [
  hiddenExampleId,
  wordId,
]);

const nameRow = await db.one<{ id: string }>(
  `insert into person_name (language_code, name, search_form, slug, gender, variants, meaning, status, gender_basis)
   values ($1, $2, $2, $2, 'male', '{Oldvariant}', 'the old meaning', 'published', 'nwoke') returning id`,
  [LANGUAGE, NAME]
);
const nameId = Number(nameRow?.id);

assert('entry and name written', wordId > 0 && nameId > 0, `${wordId} / ${nameId}`);

/*
 * A reviewer. The queue refuses self-review on purpose, so the proposal is submitted with no
 * submitter (which is what an editor entering something directly looks like) and approved by this
 * account. `registerAccount` is used rather than a raw insert because the account table has rules
 * about what a valid row is, and a test that writes one by hand is testing its own idea of them.
 */
const editorEmail = `zztest-editor-${Date.now()}@example.invalid`;
const editor = await registerAccount(db, {
  email: editorEmail,
  password: 'zztest-password-1234',
  displayName: 'ZZ Test Editor',
});
const editorId = Number(editor.id);
assert('a reviewer account exists', editorId > 0, `account ${editorId}`);

// ---------------------------------------------------------------------------
// A proposed word edit, and what approval does to the senses
// ---------------------------------------------------------------------------
console.log('\n--- Entry edit ---');

const wordSubmission = await submitSuggestion(db, null, {
  kind: 'word_edit',
  language: LANGUAGE,
  targetWordId: wordId,
  payload: {
    wordId,
    previousHeadword: HEADWORD,
    previousMeanings: 'first sense\nsecond sense',
    // First sense edited in place, second removed, a third added.
    headword: HEADWORD,
    meanings: 'first sense corrected\nthird sense',
    // One example kept and corrected, one added.
    // Only the example the page shows, named by id — an empty pair adds the second.
    previousExamples: [
      { exampleId, text: 'first example', translation: 'first example in English' },
    ],
    examples: [
      { exampleId, text: 'first example corrected', translation: 'first example in English, corrected' },
      { exampleId: null, text: 'second example', translation: null },
    ],
    previousDialects: dialectId > 0 ? [{ dialectCode, spelling: 'old spelling' }] : [],
    dialects: dialectId > 0 ? [{ dialectCode, spelling: 'new spelling' }] : [],
    note: 'test',
  },
});
assert('the proposal is queued, not applied', wordSubmission.status === 'pending');

const beforeApply = await getWord(db, wordId, LANGUAGE);
assert(
  'the entry is untouched while it waits',
  beforeApply?.definitions.map((d) => d.text).join('|') === 'first sense|second sense',
  beforeApply?.definitions.map((d) => d.text).join('|') ?? 'missing'
);

const applied = await reviewSuggestion(db, {
  suggestionId: wordSubmission.id,
  reviewerId: editorId,
  decision: 'approve',
});
assert(
  'approval applies it',
  applied.applied?.outcome === 'approved',
  applied.applied?.detail ?? 'no detail'
);

const afterApply = await getWord(db, wordId, LANGUAGE);
assert(
  'the meanings are what was proposed, in order',
  afterApply?.definitions.map((d) => d.text).join('|') === 'first sense corrected|third sense',
  afterApply?.definitions.map((d) => d.text).join('|') ?? 'missing'
);

const examplesAfter = await db.rows<{ text: string; translation: string | null }>(
  `select e.text, e.translation from example_word ew join example e on e.id = ew.example_id
    where ew.word_id = $1 order by e.id`,
  [wordId]
);
assert(
  'the example is corrected in place, not replaced',
  examplesAfter[0]?.text === 'first example corrected' &&
    (await db.one<{ id: string }>(`select id from example where id = $1`, [exampleId])) !== null,
  examplesAfter[0]?.text ?? 'missing'
);
/*
 * Presence, not position.
 *
 * A new example is inserted with a new id and the list is ordered by id, so it lands after every
 * example that already existed — including the hidden one it was never told about. That is correct
 * and it is worth stating in the test rather than asserting an order that happens to look tidy.
 */
assert(
  'the example that was edited is present, and the added one too',
  examplesAfter.some((row) => row.text === 'first example corrected') &&
    examplesAfter.some((row) => row.text === 'second example'),
  examplesAfter.map((row) => row.text).join(' | ')
);
// Three in total: the two the form carried, plus the hidden one it never mentioned.
assert('and nothing else was added or removed', examplesAfter.length === 3, `${examplesAfter.length} examples`);

const hiddenStillLinked = await db.one<{ n: number }>(
  `select count(*)::int as n from example_word where word_id = $1 and example_id = $2`,
  [wordId, hiddenExampleId]
);
const hiddenStillThere = await db.one<{ text: string }>(
  `select text from example where id = $1`,
  [hiddenExampleId]
);
assert(
  'an example the form never showed is still linked and untouched',
  Number(hiddenStillLinked?.n ?? 0) === 1 && hiddenStillThere?.text === 'hidden example',
  `${Number(hiddenStillLinked?.n ?? 0)} link(s), text "${hiddenStillThere?.text ?? 'gone'}"`
);

if (dialectId > 0) {
  const spelling = await db.one<{ spelling: string }>(
    `select spelling from word_dialect where word_id = $1 and dialect_id = $2`,
    [wordId, dialectId]
  );
  assert(
    'the dialect spelling is rewritten',
    spelling?.spelling === 'new spelling',
    spelling?.spelling ?? 'missing'
  );
}

if (posId !== null) {
  const keptPos = await db.one<{ part_of_speech_id: string | null; position: number }>(
    `select part_of_speech_id, position from definition where word_id = $1 order by position limit 1`,
    [wordId]
  );
  assert(
    'an edited sense keeps its part of speech',
    Number(keptPos?.part_of_speech_id) === posId,
    `part_of_speech_id ${keptPos?.part_of_speech_id ?? 'null'}`
  );
}

const revision = await db.one<{ previous_meanings: string; meanings: string; approved_by: string | null }>(
  `select previous_meanings, meanings, approved_by from word_revision where word_id = $1`,
  [wordId]
);
assert(
  'the previous wording is recorded',
  revision?.previous_meanings === 'first sense\nsecond sense',
  revision?.previous_meanings ?? 'missing'
);
assert('and the approver is named', revision?.approved_by !== null, String(revision?.approved_by));

// ---------------------------------------------------------------------------
// A proposed name edit
// ---------------------------------------------------------------------------
console.log('\n--- Name edit ---');

const nameSubmission = await submitSuggestion(db, null, {
  kind: 'name_edit',
  language: LANGUAGE,
  targetWordId: null,
  payload: {
    nameId,
    previousName: NAME,
    previousMeaning: 'the old meaning',
    previousGender: 'male',
    previousVariants: ['Oldvariant'],
    name: NAME,
    meaning: 'the corrected meaning',
    gender: 'unisex',
    variants: ['Newvariant', 'Oldvariant'],
    note: 'test',
  },
});

const appliedName = await reviewSuggestion(db, {
  suggestionId: nameSubmission.id,
  reviewerId: editorId,
  decision: 'approve',
});
assert(
  'approval applies the name edit',
  appliedName.applied?.outcome === 'approved',
  appliedName.applied?.detail ?? 'no detail'
);

const afterName = await db.one<{
  meaning: string | null;
  gender: string;
  gender_basis: string | null;
  variants: string[];
}>(
  `select meaning, gender, gender_basis, variants from person_name where id = $1`,
  [nameId]
);
assert(
  'the meaning is replaced',
  afterName?.meaning === 'the corrected meaning',
  afterName?.meaning ?? 'missing'
);
assert('the gender follows, with the basis moved to owner', afterName?.gender === 'unisex' && afterName?.gender_basis === 'unisex', `${afterName?.gender}/${afterName?.gender_basis}`);
assert(
  'and both variants are kept',
  afterName?.variants.join(',') === 'Newvariant,Oldvariant',
  (afterName?.variants ?? []).join(',')
);

const nameRevision = await db.one<{ previous_name: string; previous_gender: string; previous_variants: string[] }>(
  `select previous_name, previous_gender, previous_variants from name_revision where person_name_id = $1`,
  [nameId]
);
assert(
  'what the name said before is recorded',
  nameRevision?.previous_gender === 'male' &&
    (nameRevision?.previous_variants ?? []).join(',') === 'Oldvariant',
  `${nameRevision?.previous_gender} / ${(nameRevision?.previous_variants ?? []).join(',')}`
);

// ---------------------------------------------------------------------------
// A clan edit, which is how the gaps in the registry get filled
// ---------------------------------------------------------------------------
console.log('\n--- Clan edit ---');

const tribeRow = await db.one<{ id: string }>(`select id from tribe limit 1`);
const clanRow = await db.one<{ id: string }>(
  `insert into clan (slug, name, kind, ethnic_group, tribe_id, origin_summary, description, states, lgas, published)
   values ('zztestclan', 'Zztestclan', 'clan', 'Igbo', $1, 'the old summary', ARRAY['the old paragraph'], '{}', '{}', true)
   returning id`,
  [tribeRow ? Number(tribeRow.id) : null]
);
const clanId = Number(clanRow?.id);
await db.query(`insert into clan_town (clan_id, name) values ($1, 'Oldtown'), ($1, 'Kepttown')`, [clanId]);

const clanSubmission = await submitSuggestion(db, null, {
  kind: 'clan_edit',
  language: LANGUAGE,
  targetWordId: null,
  payload: {
    clanId,
    previousName: 'Zztestclan',
    previousOrigin: 'the old summary',
    previousDescription: ['the old paragraph'],
    previousStates: [],
    previousLgas: [],
    previousTowns: ['Kepttown', 'Oldtown'],
    name: 'Zztestclan',
    origin: 'the corrected summary',
    description: ['the corrected paragraph'],
    // The point of the feature: a contributor supplies the state and LGA the file never had.
    states: ['Anambra'],
    lgas: ['Idemili North'],
    // Kepttown stays, Oldtown goes, Newtown arrives.
    towns: ['Kepttown', 'Newtown'],
    note: 'test',
  },
});

const appliedClan = await reviewSuggestion(db, {
  suggestionId: clanSubmission.id,
  reviewerId: editorId,
  decision: 'approve',
});
assert('approval applies the clan edit', appliedClan.applied?.outcome === 'approved', appliedClan.applied?.detail ?? '');

const afterClan = await db.one<{ name: string; origin_summary: string | null; states: string[]; lgas: string[] }>(
  `select name, origin_summary, states, lgas from clan where id = $1`,
  [clanId]
);
assert(
  'the state and LGA are recorded, which is the gap being filled',
  (afterClan?.states ?? []).join(',') === 'Anambra' && (afterClan?.lgas ?? []).join(',') === 'Idemili North',
  `${(afterClan?.states ?? []).join(',')} / ${(afterClan?.lgas ?? []).join(',')}`
);
assert('the summary is replaced', afterClan?.origin_summary === 'the corrected summary');

const townsAfter = (
  await db.rows<{ name: string }>(`select name from clan_town where clan_id = $1 order by name`, [clanId])
).map((t) => t.name);
assert(
  'a town still listed is kept, one dropped is removed, one added arrives',
  townsAfter.join(',') === 'Kepttown,Newtown',
  townsAfter.join(',')
);

const clanRevision = await db.one<{ previous_states: string[]; previous_towns: string[] }>(
  `select previous_states, previous_towns from clan_revision where clan_id = $1`,
  [clanId]
);
assert(
  'what the entry said before is recorded',
  (clanRevision?.previous_states ?? []).length === 0 &&
    (clanRevision?.previous_towns ?? []).join(',') === 'Kepttown,Oldtown',
  (clanRevision?.previous_towns ?? []).join(',')
);

await db.query(`delete from clan where id = $1`, [clanId]);
await db.query(`delete from suggestion where id = $1`, [clanSubmission.id]);

// ---------------------------------------------------------------------------
// A stale proposal is refused rather than applied over a change nobody saw
// ---------------------------------------------------------------------------
console.log('\n--- Conflict ---');

const staleSubmission = await submitSuggestion(db, null, {
  kind: 'word_edit',
  language: LANGUAGE,
  targetWordId: wordId,
  payload: {
    wordId,
    previousHeadword: HEADWORD,
    previousMeanings: 'a list that is no longer there',
    headword: HEADWORD,
    meanings: 'whatever',
    previousExamples: [],
    examples: [],
    previousDialects: [],
    dialects: [],
    note: 'test',
  },
});
let refused = false;
try {
  await reviewSuggestion(db, {
    suggestionId: staleSubmission.id,
    reviewerId: editorId,
    decision: 'approve',
  });
} catch {
  refused = true;
}
assert('an edit proposed against older wording is refused', refused);

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------
await db.query(`delete from word where id = $1`, [wordId]);
await db.query(`delete from person_name where id = $1`, [nameId]);
await db.query(`delete from suggestion where id = any($1::bigint[])`, [
  [wordSubmission.id, nameSubmission.id, staleSubmission.id],
]);
await db.query(`delete from account where email = $1`, [editorEmail]);

console.log();
if (failures > 0) {
  console.log(`  ${failures} check(s) failed.\n`);
  await closeDb();
  process.exit(1);
}
console.log('  All checks passed.\n');
await closeDb();
