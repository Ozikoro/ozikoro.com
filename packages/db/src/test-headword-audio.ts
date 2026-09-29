/**
 * The headword recording belongs to the headword.
 *
 *   npm -w @ozituma/db run test:headword-audio
 *
 * WHAT THIS EXISTS TO CATCH
 *
 * On /word/igbo/ike the entry page rendered, under "Voice recording" and beside the
 * headword "ike", an Ọnịcha dialect recording that says "ume". Two independent
 * faults had to line up for that:
 *
 *   1. The entry owned no recording of its own. Every headword recording in the
 *      dictionary had been deleted by `audio-unlabelled.ts --all`, which removed
 *      clips that named no variety — and a headword recording names no variety
 *      because it is not OF one.
 *   2. The page then chose WHICH clip to show by position: `const [primaryAudio] =
 *      word.audio`. With no headword recording left, the first element was a dialect
 *      clip, and the page used it as the word's own pronunciation.
 *
 * Either fault alone is silent. Together they make a dictionary say one word and
 * play another, which is the worst thing a dictionary page can do, so both are
 * asserted here against a database built to reproduce the failing state.
 *
 * The corpus fixture is the real ike entry from nkowaokwu/ibo-dict: same six
 * dialect spellings, same Ọnịcha+Ezaa "ume" recording.
 */
import { closeDb, getDb, type Db } from './client.ts';
import { getWord } from './repository.ts';
import { storageKeyFor } from './import/ibodict.ts';
import { restoreHeadwordAudio } from './import/restore-headword-audio.ts';

const db: Db = await getDb();
let failures = 0;

/*
 * THIS TEST WRITES TO THE LIVE DICTIONARY AND DELETES WHAT IT WRITES.
 *
 * It builds the failing state by taking the real `ike` entry, and it cleans up by
 * deleting that entry's audio rows and then the entry itself. Against a local PGlite
 * database that is exactly right. Against production it would delete `ike`.
 *
 * The file ships inside the production image — the runner stage copies `packages/` —
 * so the guard is not paranoia: the command that would have run it is one line long
 * and looks like the one that runs the safe suites.
 */
if (db.driver !== 'pglite' && process.env.OZITUMA_ALLOW_DESTRUCTIVE_TEST !== '1') {
  console.error(
    '\n  Refusing to run against a non-local database.\n' +
      '  This test deletes the audio rows and then the word row for `ike`.\n' +
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
const HEADWORD = 'ike';

// The corpus entry, verbatim: its own recording, then the dialect spellings.
const IKE_BASE = 'audio/archive-0/5f90c35e49f7e863e92b7a18.mp3';
const IKE_UME = 'audio/archive-6/5f90c35e49f7e863e92b7a18-648865aa67ee0e3811d9e163.mp3';

// ---------------------------------------------------------------------------
// Build the failing state: a word whose only recordings are dialect recordings
// ---------------------------------------------------------------------------
console.log('\n--- Reproducing the state /word/igbo/ike was in ---');

const source = await db.one<{ id: string }>(`select id from source where slug = $1`, ['ibo-dict']);
if (!source) {
  console.error('  source "ibo-dict" is missing — run `npm run seed` first.');
  await closeDb();
  process.exit(1);
}
const sourceId = Number(source.id);

// A clean slate for this headword, so the test is repeatable.
await db.query(`delete from audio where word_id in (select id from word where headword = $1)`, [HEADWORD]);
await db.query(
  `delete from word_dialect where word_id in (select id from word where headword = $1)`,
  [HEADWORD]
);

const existing = await db.one<{ id: string }>(
  `select id from word where language_code = $1 and headword = $2`,
  [LANGUAGE, HEADWORD]
);
const wordId = existing
  ? Number(existing.id)
  : Number(
      (
        await db.one<{ id: string }>(
          `insert into word (language_code, headword, exact_form, search_form, slug, source_id)
           values ($1, $2, $2, $2, $2, $3) returning id`,
          [LANGUAGE, HEADWORD, sourceId]
        )
      )?.id
    );

const onicha = await db.one<{ id: string }>(
  `select id from dialect where language_code = $1 and name = $2`,
  [LANGUAGE, 'Ọnịcha']
);

// The dialect spelling "ume" and its recording, owned by the spelling — which is
// how the importer stores a dialect recording, and why it is not the word's own.
const spelling = await db.one<{ id: string }>(
  `insert into word_dialect (word_id, dialect_id, spelling, search_form)
   values ($1, $2, 'ume', 'ume') returning id`,
  [wordId, Number(onicha?.id)]
);
await db.query(
  `insert into audio (language_code, dialect_id, word_dialect_id, storage_key, mime_type, source_id)
   values ($1, $2, $3, $4, 'audio/mpeg', $5)`,
  [LANGUAGE, Number(onicha?.id), Number(spelling?.id), storageKeyFor(LANGUAGE, IKE_UME), sourceId]
);

const before = await db.one<{ n: number }>(
  `select count(*)::int as n from audio where word_id = $1`,
  [wordId]
);
assert(
  'the entry owns no recording of its own',
  Number(before?.n ?? 0) === 0,
  `${Number(before?.n ?? 0)} owned`
);
assert('it does have a dialect recording', Boolean(spelling), 'Ọnịcha · ume');

// The old page rule, applied to exactly this data. It is the bug, spelled out.
const brokenAudio = await getWord(db, wordId, LANGUAGE);
const brokenFirst = brokenAudio?.audio[0];
assert(
  'and the old rule would hand it to the headword position',
  brokenFirst?.dialectSpelling === 'ume',
  `first clip is ${brokenFirst?.dialect ?? 'none'} · ${brokenFirst?.dialectSpelling ?? '—'}`
);

// ---------------------------------------------------------------------------
// The page rule: the headword position goes to a headword recording or nobody
// ---------------------------------------------------------------------------
console.log('\n--- The entry page takes a headword recording, or shows none ---');

const headwordClips = (brokenAudio?.audio ?? []).filter((clip) => clip.isHeadword);
assert(
  'a word with no recording of its own offers none for the headword position',
  headwordClips.length === 0,
  `${headwordClips.length} headword clip(s)`
);
assert(
  'its dialect recording is still labelled with its spelling',
  (brokenAudio?.audio ?? []).some(
    (clip) => !clip.isHeadword && clip.dialectSpelling === 'ume' && clip.dialect === 'Ọnịcha'
  )
);

// ---------------------------------------------------------------------------
// The restoration: put the corpus recording back and check it is the one chosen
// ---------------------------------------------------------------------------
console.log('\n--- Restoring the headword recording from the corpus ---');

const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
const { join } = await import('node:path');
const { tmpdir } = await import('node:os');

const fixture = await mkdtemp(join(tmpdir(), 'ozituma-restore-'));
await mkdir(join(fixture, 'audio', 'nkowaokwu', 'ibo-dict', 'audio', 'archive-0'), { recursive: true });
await writeFile(join(fixture, 'audio', 'nkowaokwu', 'ibo-dict', IKE_BASE), Buffer.alloc(2048));
await writeFile(
  join(fixture, 'ibo-dict.json'),
  JSON.stringify([
    {
      word: HEADWORD,
      wordClass: 'Noun',
      definitions: 'energy; strength',
      pronunciation: IKE_BASE,
      dialects: [{ dialects: ['Ọnịcha', 'Ezaa'], pronunciation: IKE_UME, word: 'ume' }],
    },
    // A headword with no recording at all must not gain a row.
    { word: 'nne', wordClass: 'Noun', definitions: 'mother', pronunciation: '' },
  ])
);

const first = await restoreHeadwordAudio({ sourceDir: fixture, apply: true, log: () => {} });
assert('a recording was put back', first.restored === 1, `${first.restored} restored`);

const second = await restoreHeadwordAudio({ sourceDir: fixture, apply: true, log: () => {} });
assert(
  'running it again changes nothing',
  second.restored === 0,
  `${second.restored} restored, ${second.alreadyHad} already had one`
);

const after = await getWord(db, wordId, LANGUAGE);
const primary = after?.audio[0];
assert(
  'the headword position now holds the word\'s own recording',
  primary?.isHeadword === true,
  `${primary?.dialectSpelling ?? 'own recording'}`
);
assert(
  'and it is the corpus recording of "ike", not of "ume"',
  primary?.url?.endsWith(storageKeyFor(LANGUAGE, IKE_BASE).split('/').pop() ?? '') === true,
  primary?.url ?? 'no url'
);
assert(
  'the Ọnịcha recording stays on its own chip',
  (after?.audio ?? []).some((clip) => !clip.isHeadword && clip.dialectSpelling === 'ume'),
  'ume · Ọnịcha'
);
assert(
  'the word with no recording in the corpus got none',
  (
    await db.one<{ n: number }>(
      `select count(*)::int as n from audio a join word w on w.id = a.word_id
        where w.headword = 'nne' and a.language_code = $1`,
      [LANGUAGE]
    )
  )?.n === 0
);

// ---------------------------------------------------------------------------
// A headword that has since been re-spelled still gets its recording back
// ---------------------------------------------------------------------------
console.log('\n--- A word whose spelling has drifted since the import ---');

/*
 * The real case: the corpus spells a headword one way and the surviving word row
 * spells it another, because a spelling was corrected or a duplicate merged after
 * the audio was imported. Matching on the headword alone loses those entries — it
 * was 171 of them on the live data.
 *
 * The entry's own dialect recordings are the way out: they were never deleted, and
 * they are still attached to the word the entry belonged to, so they name it
 * exactly. Here the corpus says "àbà" while the word row says "àba".
 */
const DRIFT_OWN = 'audio/archive-0/aaaaaaaaaaaaaaaaaaaaaaaa.mp3';
const DRIFT_DIALECT = 'audio/archive-6/bbbbbbbbbbbbbbbbbbbbbbbb.mp3';

const driftWordId = Number(
  (
    await db.one<{ id: string }>(
      `insert into word (language_code, headword, exact_form, search_form, slug, source_id)
       values ($1, 'àba', 'àba', 'aba', $2, $3) returning id`,
      [LANGUAGE, `aba-test-${Date.now()}`, sourceId]
    )
  )?.id
);
const driftSpelling = Number(
  (
    await db.one<{ id: string }>(
      `insert into word_dialect (word_id, dialect_id, spelling, search_form)
       values ($1, $2, 'àbà', 'aba') returning id`,
      [driftWordId, Number(onicha?.id)]
    )
  )?.id
);
await db.query(
  `insert into audio (language_code, dialect_id, word_dialect_id, storage_key, mime_type, source_id)
   values ($1, $2, $3, $4, 'audio/mpeg', $5)`,
  [LANGUAGE, Number(onicha?.id), driftSpelling, storageKeyFor(LANGUAGE, DRIFT_DIALECT), sourceId]
);

const driftFixture = await mkdtemp(join(tmpdir(), 'ozituma-drift-'));
await mkdir(join(driftFixture, 'audio', 'nkowaokwu', 'ibo-dict', 'audio', 'archive-0'), {
  recursive: true,
});
await writeFile(join(driftFixture, 'audio', 'nkowaokwu', 'ibo-dict', DRIFT_OWN), Buffer.alloc(64));
await writeFile(
  join(driftFixture, 'ibo-dict.json'),
  JSON.stringify([
    {
      word: 'àbà',
      definitions: 'breast',
      pronunciation: DRIFT_OWN,
      dialects: [{ dialects: ['Ọnịcha'], pronunciation: DRIFT_DIALECT, word: 'àbà' }],
    },
  ])
);

const driftRun = await restoreHeadwordAudio({
  sourceDir: driftFixture,
  apply: true,
  log: () => {},
});
assert('the re-spelled entry was still found', driftRun.restored === 1, `${driftRun.restored} restored`);

const driftAudio = await db.one<{ storage_key: string }>(
  `select storage_key from audio where word_id = $1`,
  [driftWordId]
);
assert(
  'and its recording landed on the surviving word',
  driftAudio?.storage_key === storageKeyFor(LANGUAGE, DRIFT_OWN),
  driftAudio?.storage_key ?? 'nothing attached'
);

// ---------------------------------------------------------------------------
// Housekeeping: this test writes to the database, so it puts it back
// ---------------------------------------------------------------------------
await db.query(`delete from audio where word_id = $1`, [wordId]);
await db.query(`delete from word_dialect where word_id = $1`, [wordId]);
await db.query(`delete from word where id = $1`, [wordId]);
await db.query(`delete from audio where word_id = $1`, [driftWordId]);
await db.query(`delete from word_dialect where word_id = $1`, [driftWordId]);
await db.query(`delete from word where id = $1`, [driftWordId]);

console.log();
if (failures > 0) {
  console.log(`  ${failures} check(s) failed.\n`);
  await closeDb();
  process.exit(1);
}
console.log('  All checks passed.\n');
await closeDb();
