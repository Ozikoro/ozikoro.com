/**
 * Attach existing dialect recordings to the spelling they are OF.
 *
 *   node packages/db/src/import/backfill-dialect-audio.ts
 *
 * THE DEFECT THIS REPAIRS
 *
 * Reported from /word/igbo/oru-3: the Ajalị spelling "ihe ọmụmụ" had a play
 * button that played the recording of "ọrụ". The importer attached a dialect
 * recording to the WORD with a dialect label, and the entry page matched a
 * recording to a spelling by the dialect's NAME. That works while a dialect has
 * one spelling for a word and is silently wrong the moment it has two. Ajalị
 * has two for "ọrụ" — "ọrụ" and "ihe ọmụmụ" — and each has its own recording in
 * the corpus, so the chip for one played the other.
 *
 * `audio.word_dialect_id` is the column that fixes it and it was never written
 * to. The importer now writes it, which prevents the defect going forward; this
 * repairs the 46,419 rows already stored, and can be re-run safely.
 *
 * WHY IT NEEDS THE CORPUS
 *
 * Which spelling a stored recording is of cannot be recovered from the database.
 * A row carries its dialect, its word, a storage key that is a SHA-256 of the
 * source path, and a provenance note naming that path — and none of those says
 * what the recording SAYS. The corpus does: each dialect entry there has a
 * spelling and its own pronunciation. So the corpus is read, the two are joined
 * on the storage key, and the answer is written down.
 *
 * A recording whose dialect spelling was never imported as a `word_dialect` row
 * is left exactly as it is and reported. It keeps its dialect label and plays
 * from the entry, which is no worse than before; what it does not get is a place
 * on a chip that might be the wrong one.
 */
import { createHash } from 'node:crypto';
import { extname, join, resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, type Db } from '../client.ts';
import { formatMs, insertMany } from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Same default as the importer: the ibodict corpus, gitignored. */
export const DEFAULT_IBODICT_DIR = resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'data',
  'sources',
  'ibodict'
);

/** Identical to `storageKeyFor` in ibodict.ts. Keep the two in step. */
function storageKeyFor(languageCode: string, sourcePath: string): string {
  const digest = createHash('sha256').update(sourcePath).digest('hex').slice(0, 24);
  const ext = extname(sourcePath).toLowerCase() || '.mp3';
  return `audio/${languageCode}/corpus/${digest}${ext}`;
}

interface CorpusDialect {
  word?: string;
  dialects?: string[];
  pronunciation?: string | null;
}
interface CorpusEntry {
  word?: string;
  pronunciation?: string | null;
  dialects?: CorpusDialect[];
}

export interface DialectAudioBackfillReport {
  corpusRecordings: number;
  audioRowsConsidered: number;
  attached: number;
  alreadyOwned: number;
  /** Recordings whose dialect spelling has no row to attach them to. */
  unattached: number;
  durationMs: number;
}

export async function backfillDialectAudio(
  options: { sourceDir?: string; languageCode?: string; log?: (m: string) => void } = {}
): Promise<DialectAudioBackfillReport> {
  const started = Date.now();
  const languageCode = options.languageCode ?? 'ibo';
  const sourceDir = options.sourceDir ?? process.env.OZITUMA_IBODICT_SOURCE ?? DEFAULT_IBODICT_DIR;
  const log = options.log ?? ((m: string) => console.log(m));
  const db = await getDb();

  const corpus = JSON.parse(await readFile(join(sourceDir, 'ibo-dict.json'), 'utf8')) as CorpusEntry[];

  /*
   * storage key -> the spelling that recording is of.
   *
   * One dialect entry can name several dialects (the corpus groups them, so
   * "Afiikpo, Izii" is one recording covering both). The SPELLING is what
   * matters here and it is the same for each name, so the map stays keyed on the
   * recording rather than on the pair.
   */
  const spellingByKey = new Map<string, string>();
  for (const entry of corpus) {
    for (const dialect of entry.dialects ?? []) {
      const spelling = String(dialect.word ?? '').trim();
      const pronunciation = (dialect.pronunciation ?? '').trim();
      if (spelling.length === 0 || pronunciation.length === 0) continue;
      if ((dialect.dialects ?? []).length === 0) continue;
      spellingByKey.set(storageKeyFor(languageCode, pronunciation), spelling);
    }
  }
  log(`  dialect recordings in the corpus   ${spellingByKey.size}`);

  const considered = await db.one<{ n: number }>(
    `select count(*)::int as n from audio
      where language_code = $1 and dialect_id is not null and word_id is not null`,
    [languageCode]
  );
  log(`  stored rows still owned by a word  ${considered?.n ?? 0}`);

  /*
   * Build the pairs first, then update. Doing it in one statement would mean
   * referencing the update target inside the FROM clause's join, and getting
   * that wrong fails in ways that are hard to read; two steps make what matched
   * inspectable before anything is written.
   *
   * Plain tables, dropped at the end, rather than TEMPORARY ones: TEMPORARY is
   * scoped to a connection and the driver may hand a later statement a different
   * one, which fails as "relation does not exist" depending on pool timing. The
   * names are specific enough not to collide, and the opens drop first so a
   * half-finished run can simply be run again.
   */
  await db.exec(`drop table if exists dialect_backfill_keys`);
  await db.exec(
    `create table dialect_backfill_keys (key text primary key, spelling text not null)`
  );

  const rows = [...spellingByKey].map(([key, spelling]) => [key, spelling]);
  for (let start = 0; start < rows.length; start += 5000) {
    await insertMany(db, 'dialect_backfill_keys', ['key', 'spelling'], rows.slice(start, start + 5000), {
      onConflict: 'on conflict (key) do nothing',
    });
  }

  await db.exec(`drop table if exists dialect_backfill_pairs`);
  await db.query(
    `create table dialect_backfill_pairs as
       select a.id as audio_id, wd.id as word_dialect_id
         from audio a
         join dialect_backfill_keys k on k.key = a.storage_key
         join word_dialect wd
           on wd.word_id = a.word_id
          and wd.dialect_id = a.dialect_id
          and wd.spelling = k.spelling
        where a.language_code = $1
          and a.dialect_id is not null
          and a.word_id is not null
          and a.word_dialect_id is null`,
    [languageCode]
  );

  const paired = await db.one<{ n: number }>(
    `select count(*)::int as n from dialect_backfill_pairs`
  );
  log(`  recordings matched to a spelling   ${paired?.n ?? 0}`);

  /*
   * `word_id` goes null in the same statement that sets `word_dialect_id`,
   * because the table's check constraint requires exactly one owner and would
   * reject a row holding both.
   */
  const updated = await db.query(
    `update audio a
        set word_dialect_id = p.word_dialect_id,
            word_id = null
       from dialect_backfill_pairs p
      where a.id = p.audio_id`
  );

  await db.exec(`drop table if exists dialect_backfill_pairs`);
  await db.exec(`drop table if exists dialect_backfill_keys`);

  const owned = await db.one<{ n: number }>(
    `select count(*)::int as n from audio where language_code = $1 and word_dialect_id is not null`,
    [languageCode]
  );
  const remaining = await db.one<{ n: number }>(
    `select count(*)::int as n from audio
      where language_code = $1 and dialect_id is not null and word_id is not null`,
    [languageCode]
  );

  const report: DialectAudioBackfillReport = {
    corpusRecordings: spellingByKey.size,
    audioRowsConsidered: considered?.n ?? 0,
    attached: updated.rowCount ?? 0,
    alreadyOwned: owned?.n ?? 0,
    unattached: remaining?.n ?? 0,
    durationMs: Date.now() - started,
  };

  log(`  now owned by a spelling           ${report.alreadyOwned}`);
  if (report.unattached > 0) {
    log(
      `  still owned by a word only        ${report.unattached}  ` +
        `(their dialect spelling has no word_dialect row; left as they were)`
    );
  }
  return report;
}

async function main(): Promise<void> {
  const db: Db = await getDb();
  try {
    console.log('\nAttaching dialect recordings to the spelling they are of\n');
    const report = await backfillDialectAudio();
    console.log(`\n  done in ${formatMs(report.durationMs)}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && process.argv[1].endsWith('backfill-dialect-audio.ts')) {
  main().catch((error) => {
    console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

/** Exported for the gate, which checks the invariant this restores. */
export { storageKeyFor as dialectAudioStorageKey };
