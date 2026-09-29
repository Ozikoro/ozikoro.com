/**
 * The owner's name corrections, applied to rows that are known to be wrong.
 *
 *   npm -w @ozituma/db run test:name-corrections
 *
 * WHY THIS EXISTS
 *
 * `name-corrections.ts` edits live name entries: it changes genders, adds variants,
 * renames entries and rewrites the links that pointed at the old spelling. Every one of
 * those is the kind of change that is easy to get almost right — the rename that leaves
 * the old spelling sitting under Adinlofu, the variant that keeps a stale word alive, the
 * abbreviation rule that eats the word "variant" while expanding "var.".
 *
 * So the file's logic is driven here against fixtures built to be wrong in exactly those
 * ways, and the outcomes are asserted one at a time.
 */
import { closeDb, getDb, type Db } from './client.ts';
import { deriveForms, slugify } from '@ozituma/core';
import { applyNameCorrections } from './import/name-corrections.ts';

const db: Db = await getDb();
let failures = 0;

/*
 * THIS TEST WRITES NAMES INTO THE DICTIONARY AND DELETES THEM AGAIN.
 *
 * Against a local PGlite database that is right. Against production it would delete rows
 * it did not create — `Adinlofu` among them. Same guard as the other suites, and it
 * matters here more than most: this file ships inside the production image.
 */
if (db.driver !== 'pglite' && process.env.OZITUMA_ALLOW_DESTRUCTIVE_TEST !== '1') {
  console.error(
    '\n  Refusing to run against a non-local database.\n' +
      '  This test creates name entries and deletes the ones it created.\n' +
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

/** Every name this suite creates, so it can clear them before and after. */
const FIXTURE_NAMES = [
  'Elozonachukwu', 'Elozonam', 'Ezeajughi', 'Ezeasor', 'Ezeaso', 'Adinlofu', 'Adunchezor',
  'Adunchezo', 'Echefu', 'Ahamefula', 'Akobundu', 'Anuli', 'Chinwemmeri', 'Elekwachi',
];

/*
 * Cleared first as well as last.
 *
 * A run that fails part-way leaves its fixtures behind — which is exactly what happened
 * while this test was being written, and the symptom was a unique-key violation on the
 * next run rather than anything to do with the corrections. A suite that can only run
 * once on a clean database is a suite that gets ignored.
 */
async function clearFixtures(): Promise<void> {
  await db.query(
    `delete from person_name where language_code = $1 and name = any($2::text[])`,
    [LANGUAGE, FIXTURE_NAMES]
  );
}

async function insertName(options: {
  name: string;
  gender?: string;
  variants?: string[];
  meaning?: string | null;
}): Promise<number> {
  const row = await db.one<{ id: string }>(
    `insert into person_name (language_code, name, search_form, slug, gender, variants,
                              meaning, status, gender_basis)
     values ($1, $2, $3, $4, $5, $6, $7, 'published', 'nwoke')
     returning id`,
    [
      LANGUAGE,
      options.name,
      deriveForms(options.name).searchForm,
      slugify(options.name).slice(0, 80),
      options.gender ?? 'male',
      options.variants ?? [],
      options.meaning ?? null,
    ]
  );
  return Number(row?.id);
}

async function readName(id: number) {
  return await db.one<{
    name: string;
    search_form: string;
    slug: string;
    gender: string;
    gender_basis: string | null;
    variants: string[];
    meaning: string | null;
  }>(
    `select name, search_form, slug, gender, gender_basis, variants, meaning
       from person_name where id = $1`,
    [id]
  );
}

// ---------------------------------------------------------------------------
// Fixtures: each one wrong in the way the owner reported
// ---------------------------------------------------------------------------
console.log('\n--- Fixtures ---');

await clearFixtures();

const elozonachukwu = await insertName({ name: 'Elozonachukwu', gender: 'male' });
const elozonam = await insertName({ name: 'Elozonam', gender: 'male', variants: ['Elozenem'] });
const ezeajughi = await insertName({ name: 'Ezeajughi' });
const ezeasor = await insertName({ name: 'Ezeasor', variants: ['Ezeasoanya'] });
// The link the owner's rename has to carry: Adinlofu lists Adunchezor, and back.
const adinlofu = await insertName({ name: 'Adinlofu', variants: ['Adunchezor'] });
const adunchezor = await insertName({ name: 'Adunchezor', variants: ['Adinlofu'] });
const echefu = await insertName({ name: 'Echefu', variants: ['Adunchezor'] });
const ahamefula = await insertName({ name: 'Ahamefula', variants: ['Afamefuna'] });
// A meaning carrying the abbreviation, and one already spelling it out.
const akobundu = await insertName({
  name: 'Akobundu',
  meaning: 'Wisdom is life. A dialectal var. of Akowundu',
});
const anuli = await insertName({ name: 'Anuli', meaning: 'Joy. A dialectal variant of Anuri' });

const ids = [
  elozonachukwu, elozonam, ezeajughi, ezeasor, adinlofu, adunchezor, echefu, ahamefula,
  akobundu, anuli,
];
assert('fixtures written', ids.every((id) => id > 0), `${ids.length} names`);

// ---------------------------------------------------------------------------
// The dry run must not write
// ---------------------------------------------------------------------------
console.log('\n--- Dry run ---');

const dry = await applyNameCorrections({ apply: false, log: () => {} });
assert('it reports the renames it would make', dry.renamed === 2, `${dry.renamed} renames`);
assert(
  'and does not write them',
  (await readName(ezeasor))?.name === 'Ezeasor',
  (await readName(ezeasor))?.name ?? 'gone'
);

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------
console.log('\n--- Applied ---');

const report = await applyNameCorrections({ apply: true, log: () => {} });

/*
 * Only the rows that changed are written.
 *
 * This is asserted because it was wrong: the snapshot used for the comparison held the
 * Postgres `id` as a string while the in-memory row held a number, so nothing ever matched
 * and the script rewrote every row in the table. Values were unaffected, which is exactly
 * why it survived a glance.
 */
assert(
  'writes only the rows it changed',
  report.rowsWritten !== undefined && report.rowsWritten <= 20,
  `${report.rowsWritten} of ${report.namesRead} rows written`
);

const afterElozonachukwu = await readName(elozonachukwu);
assert(
  'Elozonachukwu is unisex, recorded as the owner\'s statement',
  afterElozonachukwu?.gender === 'unisex' && afterElozonachukwu?.gender_basis === 'owner',
  `${afterElozonachukwu?.gender} / ${afterElozonachukwu?.gender_basis}`
);
assert(
  'and carries the three variants the owner named',
  ['Elozonechukwu', 'Elozose', 'Echezonachukwu'].every((v) =>
    afterElozonachukwu?.variants.includes(v)
  ),
  (afterElozonachukwu?.variants ?? []).join(', ')
);
const afterElozonam = await readName(elozonam);
assert(
  'Elozonam is unisex and keeps Elozenem while gaining Echezonam',
  afterElozonam?.gender === 'unisex' &&
    afterElozonam.variants.includes('Elozenem') &&
    afterElozonam.variants.includes('Echezonam'),
  (afterElozonam?.variants ?? []).join(', ')
);
const afterEzeajughi = await readName(ezeajughi);
assert(
  'Ezeajughi gains Ezeaju and Ezeajuro',
  ['Ezeaju', 'Ezeajuro'].every((v) => afterEzeajughi?.variants.includes(v) === true),
  (afterEzeajughi?.variants ?? []).join(', ')
);
const afterAhamefula = await readName(ahamefula);
assert(
  'Ahamefula gains the five and keeps Afamefuna',
  ['Ahamefule', 'Afamefune', 'Avamevune', 'Efamefune', 'Avamevuna', 'Afamefuna'].every(
    (v) => afterAhamefula?.variants.includes(v) === true
  ),
  (afterAhamefula?.variants ?? []).join(', ')
);

// ---------------------------------------------------------------------------
// Renames, and the links that pointed at the old spelling
// ---------------------------------------------------------------------------
console.log('\n--- Renames ---');

const afterEzeasor = await readName(ezeasor);
assert(
  'Ezeasor is now Ezeaso',
  afterEzeasor?.name === 'Ezeaso' && afterEzeasor?.slug === 'ezeaso',
  `${afterEzeasor?.name} /${afterEzeasor?.slug}`
);
assert(
  'its folded key followed the spelling',
  afterEzeasor?.search_form === deriveForms('Ezeaso').searchForm,
  afterEzeasor?.search_form ?? 'missing'
);
assert(
  'and it keeps its own variant',
  afterEzeasor?.variants.includes('Ezeasoanya') === true,
  (afterEzeasor?.variants ?? []).join(', ')
);

const afterAdunchezor = await readName(adunchezor);
assert(
  'Adunchezor is now Adunchezo',
  afterAdunchezor?.name === 'Adunchezo' && afterAdunchezor?.slug === 'adunchezo',
  `${afterAdunchezor?.name} /${afterAdunchezor?.slug}`
);
assert(
  'Adinlofu now lists the corrected spelling',
  (await readName(adinlofu))?.variants.includes('Adunchezo') === true,
  ((await readName(adinlofu))?.variants ?? []).join(', ')
);
assert(
  'and no longer lists the old one',
  (await readName(adinlofu))?.variants.includes('Adunchezor') === false
);
assert(
  'a third entry that listed it is rewritten too',
  (await readName(echefu))?.variants.includes('Adunchezo') === true,
  ((await readName(echefu))?.variants ?? []).join(', ')
);
assert(
  'Adunchezo still lists Adinlofu',
  afterAdunchezor?.variants.includes('Adinlofu') === true,
  (afterAdunchezor?.variants ?? []).join(', ')
);

// ---------------------------------------------------------------------------
// "var." written in full, and "variant" left alone
// ---------------------------------------------------------------------------
console.log('\n--- The abbreviation ---');

const afterAkobundu = await readName(akobundu);
assert(
  '"A dialectal var. of" is written in full',
  afterAkobundu?.meaning === 'Wisdom is life. A dialectal variant of Akowundu',
  afterAkobundu?.meaning ?? 'missing'
);
assert(
  'a meaning that already says "variant" is untouched',
  (await readName(anuli))?.meaning === 'Joy. A dialectal variant of Anuri',
  (await readName(anuli))?.meaning ?? 'missing'
);

// Sentence-final: here the dot is the sentence's and must survive.
const sentenceFinal = await insertName({ name: 'Elekwachi', meaning: 'Who has seen god? A var.' });
await applyNameCorrections({ apply: true, log: () => {} });
assert(
  'a sentence-final "var." keeps its full stop',
  (await readName(sentenceFinal))?.meaning === 'Who has seen god? A variant.',
  (await readName(sentenceFinal))?.meaning ?? 'missing'
);

// The rule is about the word, not the letters: "variety" and "varies" contain "var".
const variety = await insertName({
  name: 'Chinwemmeri',
  meaning: 'A variety of names; the set varies by town.',
});
await applyNameCorrections({ apply: true, log: () => {} });
assert(
  '"variety" and "varies" are not mangled',
  (await readName(variety))?.meaning === 'A variety of names; the set varies by town.',
  (await readName(variety))?.meaning ?? 'missing'
);

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------
console.log('\n--- Running it again ---');

const second = await applyNameCorrections({ apply: true, log: () => {} });
assert(
  'a second run changes nothing',
  second.gendersChanged === 0 &&
    second.variantsAdded === 0 &&
    second.renamed === 0 &&
    second.referencesRewritten === 0 &&
    second.meaningsReabbreviated === 0,
  `genders ${second.gendersChanged}, variants ${second.variantsAdded}, renames ${second.renamed}, links ${second.referencesRewritten}, wording ${second.meaningsReabbreviated}`
);

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------
await clearFixtures();

console.log();
if (failures > 0) {
  console.log(`  ${failures} check(s) failed.\n`);
  await closeDb();
  process.exit(1);
}
console.log('  All checks passed.\n');
await closeDb();
