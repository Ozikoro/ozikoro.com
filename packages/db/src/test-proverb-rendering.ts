/**
 * A proverb's meaning is shown, or the proverb is shown without one.
 *
 *   npm -w @ozituma/db run test:proverb-rendering
 *
 * WHAT THIS EXISTS TO CATCH
 *
 * /proverbs/51784 published this under "Meaning":
 *
 *   [uncertain] Whoever walks himself into the muck is the one who has to climb back
 *   out of it — you are the one who must get yourself clear of the mess you enter.
 *
 * with a paragraph below explaining that the Igbo was corrupt and the reading was the
 * best that could be established. Three separate things were wrong and each is asserted
 * here:
 *
 *   1. A meaning was published that the dictionary itself called uncertain, and the
 *      `[uncertain]` marker was printed inside the meaning as though it were part of it.
 *   2. The literal translation, the usage note and the theme were published too. They
 *      came from the same guess about a line the model had said it could not read.
 *   3. The count of proverbs "with a meaning" included these, so the section advertised
 *      renderings it should not have been showing.
 *
 * The distinction the cut rests on is the one the generator recorded when it wrote these:
 * `high` means the sense is established, `medium` means the sense is clear but the English
 * could be phrased differently, `low` means the Igbo is corrupt or the sense was a guess.
 * Only `low` is a doubt about truth, so only `low` goes — and this test pins that down,
 * because "remove anything not certain" read carelessly would throw away the 871
 * `medium` readings that sampling found to be right.
 */
import { closeDb, getDb, type Db } from './client.ts';
import { deriveForms, getLanguage, requireLanguage } from '@ozituma/core';
import { getProverb, listProverbs } from './repository.ts';
import { clearUnsettledRenderings, findUnsettled } from './import/unsettled-renderings.ts';

const db: Db = await getDb();
let failures = 0;

/*
 * This suite writes proverbs into the dictionary and deletes them again. Against a local
 * PGlite database that is right; against production it would delete rows it did not
 * create. The same guard as test-headword-audio.ts, for the same reason: this file ships
 * inside the production image.
 */
if (db.driver !== 'pglite' && process.env.OZITUMA_ALLOW_DESTRUCTIVE_TEST !== '1') {
  console.error(
    '\n  Refusing to run against a non-local database.\n' +
      '  This test creates proverbs and deletes the ones it created by id.\n' +
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

async function insertProverb(options: {
  text: string;
  translation: string;
  confidence: string | null;
  literal?: string | null;
  usage?: string | null;
  theme?: string | null;
}): Promise<number> {
  const row = await db.one<{ id: string }>(
    `insert into example (language_code, text, search_form, translation, style, status,
                          literal_translation, usage_note, theme, translation_confidence)
     values ($1, $2, $3, $4, 'proverb', 'published', $5, $6, $7, $8)
     returning id`,
    [
      LANGUAGE,
      options.text,
      deriveForms(options.text, requireLanguage(LANGUAGE)).searchForm,
      options.translation,
      options.literal ?? null,
      options.usage ?? null,
      options.theme ?? null,
      options.confidence,
    ]
  );
  return Number(row?.id);
}

// ---------------------------------------------------------------------------
// Fixtures: one of each kind, plus the marker without the column
// ---------------------------------------------------------------------------
console.log('\n--- Fixtures ---');

const low = await insertProverb({
  text: 'A baa nshị a rịhị',
  translation:
    '[uncertain] Whoever walks himself into the muck is the one who has to climb back out.',
  confidence: 'low',
  literal: 'If one goes into nshị, one comes climbing out.',
  usage: 'Said to someone who has walked into trouble.',
  theme: 'Responsibility',
});
// The pipeline had two ways of recording the same doubt and used both: 250 low rows
// carry no marker, and this one carries the marker with no column.
const markedOnly = await insertProverb({
  text: 'Igwe ejee ngaa',
  translation: '[uncertain] The line is truncated and its sense cannot be recovered.',
  confidence: null,
});
const medium = await insertProverb({
  text: 'Iwe dị n\'obi, ọchị dị n\'eze',
  translation:
    'A person can carry anger inside and still smile at you; a friendly face is not proof of a friendly heart.',
  confidence: 'medium',
  literal: 'Anger is in the heart, laughter is in the teeth.',
  usage: 'Said of someone whose calm manner cannot be trusted.',
  theme: 'Character',
});
const high = await insertProverb({
  text: 'Ogologo abụghị na nwa m etoola',
  translation: 'Being tall is not the same as being grown; size is no proof of maturity.',
  confidence: 'high',
  literal: 'Tallness is not that my child has grown.',
  theme: 'Wisdom',
});

const ids = [low, markedOnly, medium, high];
assert('four fixtures written', ids.every((id) => id > 0), ids.join(', '));

// ---------------------------------------------------------------------------
// Nothing uncertain reaches a reader, however it was recorded
// ---------------------------------------------------------------------------
console.log('\n--- What the entry page is given ---');

const lowDetail = await getProverb(db, low, LANGUAGE);
assert(
  'a low-confidence meaning is not served at all',
  lowDetail?.translation === null,
  lowDetail?.translation ?? 'null (correct)'
);
assert(
  'the [uncertain] marker is not printed as part of a meaning',
  (await getProverb(db, markedOnly, LANGUAGE))?.translation === null
);
assert(
  'its literal translation goes with it',
  lowDetail?.literal === null,
  lowDetail?.literal ?? 'null (correct)'
);
assert(
  'so does the usage note',
  lowDetail?.usage === null,
  lowDetail?.usage ?? 'null (correct)'
);
assert(
  'and the theme, which was read off the same guess',
  lowDetail?.theme === null,
  lowDetail?.theme ?? 'null (correct)'
);
assert(
  'the proverb itself is still served',
  lowDetail?.text === 'A baa nshị a rịhị',
  lowDetail?.text ?? 'missing'
);

// The bar is about doubt of the sense, not of the phrasing, so these must survive.
const mediumDetail = await getProverb(db, medium, LANGUAGE);
const highDetail = await getProverb(db, high, LANGUAGE);
assert(
  'a medium reading is served, meaning and all',
  mediumDetail?.translation?.startsWith('A person can carry anger') === true,
  mediumDetail?.translation?.slice(0, 40) ?? 'MISSING'
);
assert('its literal and usage survive too', Boolean(mediumDetail?.literal && mediumDetail?.usage));
assert('a high reading is served', highDetail?.translation?.startsWith('Being tall') === true);

// ---------------------------------------------------------------------------
// The count the section advertises agrees with what it will show
// ---------------------------------------------------------------------------
console.log('\n--- The count and the list agree ---');

const listed = await listProverbs(db, { language: LANGUAGE, translatedOnly: true, limit: 200 });
const shownWithMeaning = listed.data.filter((row) => row.translation !== null).length;
assert(
  'every proverb counted as translated has a meaning to show',
  listed.translated === shownWithMeaning,
  `counted ${listed.translated}, showing ${shownWithMeaning}`
);
assert(
  'the two uncertain fixtures are not counted',
  !listed.data.some((row) => row.id === low || row.id === markedOnly),
  `${listed.translated} translated`
);

// ---------------------------------------------------------------------------
// The purge clears the low readings and leaves the rest untouched
// ---------------------------------------------------------------------------
console.log('\n--- The purge ---');

const found = await findUnsettled(db);
assert(
  'it finds both uncertain fixtures and only those',
  found.length === 2 && found.every((row) => row.id === low || row.id === markedOnly),
  found.map((row) => row.id).join(', ')
);

const cleared = await clearUnsettledRenderings(db);
assert('it clears them', cleared === 2, `${cleared} cleared`);

const after = await db.one<{
  translation: string | null;
  literal_translation: string | null;
  usage_note: string | null;
  theme: string | null;
  translation_confidence: string | null;
}>(`select translation, literal_translation, usage_note, theme, translation_confidence
      from example where id = $1`, [low]);
assert(
  'every generated field is cleared from a low reading',
  after !== null && Object.values(after).every((value) => value === null),
  JSON.stringify(after)
);
assert('running it again clears nothing', (await clearUnsettledRenderings(db)) === 0);

const survived = await db.one<{ translation: string | null; theme: string | null }>(
  `select translation, theme from example where id = $1`,
  [medium]
);
assert(
  'a medium reading is left exactly as it was',
  survived?.translation?.startsWith('A person can carry anger') === true &&
    survived?.theme === 'Character',
  `${survived?.translation?.slice(0, 30) ?? 'MISSING'} / ${survived?.theme ?? 'no theme'}`
);

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------
await db.query(`delete from example where id = any($1::bigint[])`, [ids]);

console.log();
if (failures > 0) {
  console.log(`  ${failures} check(s) failed.\n`);
  await closeDb();
  process.exit(1);
}
console.log('  All checks passed.\n');
await closeDb();
