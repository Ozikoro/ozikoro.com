/**
 * Import the nkowaokwu/ibo-dict corpus: words, definitions, dialect variants
 * and pronunciation recordings.
 *
 * WHY THIS IS A SECOND CORPUS, NOT A DUPLICATE
 *
 * `ibo-dict.json` (CC-BY-4.0) is a different dataset from the Igbo API's
 * `ig-en.json` that the main importer reads. Only about 26% of its 5,095 words
 * appear in that dictionary at all, so it contributes roughly 3,700 headwords
 * that exist nowhere else, plus 24,013 recordings.
 *
 * Shape of one entry:
 *
 *   {
 *     word: "àgbàrà", wordClass: "Noun",
 *     definitions: "the author of fertility in Igbo mythology, ...",
 *     pronunciation: "audio/archive-0/5f90c35e49f7e863e92b6e97.mp3",
 *     dialects: [
 *       { dialects: ["Owere"],  word: "agbara", pronunciation: "audio/archive-6/....mp3" },
 *       { dialects: ["Ọnịcha"], word: "agbala", pronunciation: "audio/archive-6/....mp3" }
 *     ]
 *   }
 *
 * TWO MAPPINGS THIS RELIES ON, BOTH VERIFIED AT 100% BEFORE IMPORT
 *
 *   wordClass is a LABEL ("Active verb"), not a code. It resolves against
 *   part_of_speech.name for Igbo — all 20 labels resolve.
 *
 *   dialects[] holds NAMES ("Ọnịcha"), not codes. All 33 resolve against
 *   dialect.name. This is exactly what the language-scoped reference tables
 *   were for; neither mapping needs a hardcoded table here.
 *
 * AUDIO IS UPLOADED, NOT LINKED
 *
 * The recordings sit behind Hugging Face's gated endpoint, so their URLs need a
 * token and are not servable to the public. Each file is therefore uploaded
 * through the active storage driver (S3 in production, local filesystem in
 * development) and the database holds the resulting key. Keys are derived from
 * a hash of the source path, so a re-import reuses the same object rather than
 * duplicating it.
 *
 * Usage:
 *   node src/import/ibodict.ts
 *   OZITUMA_IMPORT_LIMIT=50 node src/import/ibodict.ts   # smoke test
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage, slugify } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { getStorage } from '../storage.ts';
import {
  SlugAllocator,
  formatMs,
  insertMany,
  loadPosIndex,
  loadSourceId,
  progress,
  wordFields,
} from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_DIR = resolve(HERE, '..', '..', '..', '..', 'data', 'sources', 'ibodict');

/**
 * Directory the recordings are downloaded into, mirroring the Hugging Face repo
 * path. Must match scripts/fetch-audio.ts.
 */
const AUDIO_REPO_DIR = join('nkowaokwu', 'ibo-dict');

/** The audio file's own container is the source of truth for its type. */
function contentTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  return 'audio/mpeg';
}

interface CorpusDialect {
  dialects?: string[];
  word?: string;
  pronunciation?: string;
}

interface CorpusEntry {
  word?: string;
  wordClass?: string;
  definitions?: string;
  pronunciation?: string;
  dialects?: CorpusDialect[];
  igbo?: string;
}

export interface IbodictImportOptions {
  sourceDir?: string;
  languageCode?: string;
  sourceSlug?: string;
  /** Stop after N headwords — for a fast smoke test. */
  limit?: number;
  /** Count what would happen without writing anything. */
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface IbodictReport {
  entriesRead: number;
  wordsInserted: number;
  wordsUpdated: number;
  definitionsInserted: number;
  dialectFormsInserted: number;
  audioUploaded: number;
  audioRowsInserted: number;
  audioFilesMissing: number;
  audioUploadFailed: number;
  unmappedWordClasses: Record<string, number>;
  unmappedDialects: Record<string, number>;
  durationMs: number;
}

/**
 * Deterministic storage key, so re-importing does not duplicate objects.
 *
 * Exported because it is the only thing that ties a stored recording to the
 * corpus path it came from: the row itself holds a hash and a provenance note,
 * and neither says which recording it is. `restore-headword-audio.ts` rebuilds
 * this key to find the objects an over-broad sweep left behind in storage, so a
 * second copy of the rule there would be a second thing to get wrong.
 */
export function storageKeyFor(languageCode: string, sourcePath: string): string {
  const digest = createHash('sha256').update(sourcePath).digest('hex').slice(0, 24);
  const ext = extname(sourcePath).toLowerCase() || '.mp3';
  return `audio/${languageCode}/corpus/${digest}${ext}`;
}

export async function importIbodictCorpus(
  db: Db,
  options: IbodictImportOptions = {}
): Promise<IbodictReport> {
  const started = Date.now();
  const log = options.log ?? ((message: string) => console.log(message));
  const sourceDir = options.sourceDir ?? process.env.OZITUMA_IBODICT_SOURCE ?? DEFAULT_SOURCE_DIR;
  const languageCode = options.languageCode ?? 'ibo';
  const sourceSlug = options.sourceSlug ?? 'ibo-dict';

  const language = requireLanguage(languageCode);
  const sourceId = await loadSourceId(db, sourceSlug);
  const posIndex = await loadPosIndex(db, languageCode);
  const storage = getStorage();

  // --- Reference mappings -------------------------------------------------
  // Grammar labels -> codes, from the seeded table rather than a hardcoded map.
  const posRows = await db.rows<{ code: string; name: string }>(
    `select code, name from part_of_speech where language_code = $1 or language_code is null`,
    [languageCode]
  );
  const posByName = new Map(posRows.map((row) => [row.name.toLowerCase(), row.code]));

  // Dialect names -> ids and codes.
  const dialectRows = await db.rows<{ id: string; code: string; name: string }>(
    `select id, code, name from dialect where language_code = $1`,
    [languageCode]
  );
  const dialectByName = new Map(
    dialectRows.map((row) => [row.name.toLowerCase(), { id: Number(row.id), code: row.code }])
  );

  // --- Read the corpus ----------------------------------------------------
  const metadataPath = join(sourceDir, 'ibo-dict.json');
  log(`  reading ${metadataPath}`);
  const entries = JSON.parse(await readFile(metadataPath, 'utf8')) as CorpusEntry[];
  log(`  corpus: ${entries.length} entries`);

  const limited = options.limit && options.limit > 0 ? entries.slice(0, options.limit) : entries;

  // --- Reserve existing slugs, park our own -------------------------------
  const allocator = new SlugAllocator();
  const foreignSlugs = await db.rows<{ slug: string }>(
    `select slug from word where language_code = $1 and (source_id is distinct from $2)`,
    [languageCode, sourceId]
  );
  for (const row of foreignSlugs) allocator.reserve(languageCode, row.slug);

  // Note: unlike the main importer we do NOT park this source's slugs, because
  // this importer also attaches audio to words it does not own. Parking would
  // rewrite slugs that the API has already published.

  const existingWords = await db.rows<{ id: string; headword: string; search_form: string }>(
    `select id, headword, search_form from word where language_code = $1`,
    [languageCode]
  );
  const wordIdByHeadword = new Map<string, number>();
  const wordIdBySearchForm = new Map<string, number>();
  for (const row of existingWords) {
    wordIdByHeadword.set(row.headword, Number(row.id));
    // First writer wins, so an exact-headword match always beats a folded one.
    if (!wordIdBySearchForm.has(row.search_form)) {
      wordIdBySearchForm.set(row.search_form, Number(row.id));
    }
  }

  const unmappedWordClasses: Record<string, number> = {};
  const unmappedDialects: Record<string, number> = {};

  // ---------------------------------------------------------------------
  // Phase A: words
  // ---------------------------------------------------------------------
  interface Prepared {
    headword: string;
    posId: number;
    definition: string | null;
    baseAudio: string | null;
    dialectVariants: { spelling: string; dialectId: number; audio: string | null }[];
  }

  const prepared: Prepared[] = [];

  for (const entry of limited) {
    const raw = String(entry.word ?? '').trim();
    if (raw.length === 0) continue;
    const fields = deriveForms(raw, language);

    const label = (entry.wordClass ?? '').trim();
    let posId = posIndex.unclassified;
    if (label.length > 0) {
      const code = posByName.get(label.toLowerCase());
      if (code) posId = posIndex.byCode.get(code) ?? posIndex.unclassified;
      else unmappedWordClasses[label] = (unmappedWordClasses[label] ?? 0) + 1;
    }

    const variants: Prepared['dialectVariants'] = [];
    for (const dialect of entry.dialects ?? []) {
      const spelling = String(dialect.word ?? '').trim();
      const names = dialect.dialects ?? [];
      if (spelling.length === 0 || names.length === 0) continue;

      for (const name of names) {
        const match = dialectByName.get(String(name).trim().toLowerCase());
        if (!match) {
          unmappedDialects[name] = (unmappedDialects[name] ?? 0) + 1;
          continue;
        }
        variants.push({
          spelling,
          dialectId: match.id,
          audio: dialect.pronunciation?.trim() || null,
        });
      }
    }

    prepared.push({
      headword: fields.headword,
      posId,
      definition: (entry.definitions ?? '').trim() || null,
      baseAudio: entry.pronunciation?.trim() || null,
      dialectVariants: variants,
    });
  }

  log(`  prepared ${prepared.length} entries\n`);

  let wordsInserted = 0;
  let wordsUpdated = 0;

  if (!options.dryRun) {
    // Insert only genuinely new headwords; existing ones keep their own source
    // and are merely enriched below.
    const newRows: unknown[][] = [];
    for (const record of prepared) {
      if (wordIdByHeadword.has(record.headword)) continue;
      const fields = wordFields(record.headword, language);
      if (wordIdBySearchForm.has(fields.searchForm)) continue;
      newRows.push([
        languageCode,
        fields.headword,
        fields.exactForm,
        fields.searchForm,
        allocator.allocate(languageCode, record.headword, language),
        sourceId,
      ]);
    }

    log(`  inserting ${newRows.length} new headwords ...`);
    const CHUNK = 400;
    for (let start = 0; start < newRows.length; start += CHUNK) {
      const chunk = newRows.slice(start, start + CHUNK);
      const values: unknown[] = [];
      const tuples: string[] = [];
      for (const row of chunk) {
        tuples.push(`(${chunk.length && row.map((_, i) => `$${values.length + i + 1}`).join(', ')})`);
        values.push(...row);
      }
      const result = await db.query(
        `insert into word (language_code, headword, exact_form, search_form, slug, source_id)
         values ${tuples.join(', ')}
         on conflict (language_code, headword) do nothing`,
        values
      );
      wordsInserted += result.rowCount;
      progress('words', Math.min(start + CHUNK, newRows.length), newRows.length);
    }

    if (newRows.length === 0) log('  no new headwords to insert');

    // Refresh the id maps so Phase B can attach to the rows we just created.
    const refreshed = await db.rows<{ id: string; headword: string; search_form: string }>(
      `select id, headword, search_form from word where language_code = $1`,
      [languageCode]
    );
    for (const row of refreshed) {
      wordIdByHeadword.set(row.headword, Number(row.id));
      if (!wordIdBySearchForm.has(row.search_form)) {
        wordIdBySearchForm.set(row.search_form, Number(row.id));
      }
    }
  }

  // ---------------------------------------------------------------------
  // Phase B: definitions, dialect forms, audio
  // ---------------------------------------------------------------------
  const definitionRows: unknown[][] = [];
  const dialectFormRows: unknown[][] = [];

  /** `${wordId}:${dialectId}:${spelling}` -> word_dialect.id, filled below. */
  const dialectSpellingIds = new Map<string, number>();

  for (const record of prepared) {
    const wordId = wordIdByHeadword.get(record.headword);
    if (wordId === undefined) continue;
    if (record.definition) {
      definitionRows.push([wordId, 'eng', record.posId, record.definition, 0, false, sourceId]);
    }
    for (const variant of record.dialectVariants) {
      dialectFormRows.push([
        wordId,
        variant.dialectId,
        variant.spelling,
        deriveForms(variant.spelling, language).searchForm,
      ]);
    }
  }

  let definitionsInserted = 0;
  let dialectFormsInserted = 0;

  if (!options.dryRun) {
    log(`\n  inserting ${definitionRows.length} definitions ...`);
    definitionsInserted = await insertMany(
      db,
      'definition',
      ['word_id', 'language_code', 'part_of_speech_id', 'text', 'position', 'is_primary', 'source_id'],
      definitionRows,
      { onConflict: 'on conflict (word_id, language_code, text) do nothing' }
    );

    log(`  inserting ${dialectFormRows.length} dialect spellings ...`);
    dialectFormsInserted = await insertMany(
      db,
      'word_dialect',
      ['word_id', 'dialect_id', 'spelling', 'search_form'],
      dialectFormRows,
      { onConflict: 'on conflict (word_id, dialect_id, spelling) do nothing' }
    );

    /*
     * Read the dialect spellings back, so a recording can be attached to the
     * exact row it is OF.
     *
     * Read rather than captured from the insert, because `on conflict do
     * nothing` means a re-run inserts nothing and returns no ids — the rows are
     * already there and still need to be found.
     */
    const dialectIdRows = await db.rows<{
      id: string;
      word_id: string;
      dialect_id: string;
      spelling: string;
    }>(
      `select wd.id, wd.word_id, wd.dialect_id, wd.spelling
         from word_dialect wd
         join word w on w.id = wd.word_id
        where w.language_code = $1`,
      [languageCode]
    );
    for (const row of dialectIdRows) {
      dialectSpellingIds.set(
        `${row.word_id}:${row.dialect_id}:${row.spelling}`,
        Number(row.id)
      );
    }
  }

  // --- Audio --------------------------------------------------------------
  // Uploading is the slow part, so it is separated out and counted precisely:
  // a recording that has not been downloaded yet is a "missing file", not a
  // failure, and re-running picks it up.
  let audioUploaded = 0;
  let audioRowsInserted = 0;
  let audioFilesMissing = 0;
  let audioUploadFailed = 0;

  if (!options.dryRun) {
    interface AudioTask {
      wordId: number;
      dialectId: number | null;
      /**
       * The `word_dialect` row this recording is OF.
       *
       * Set for a dialect recording and null for the word's own. It is what
       * ties the recording to a spelling rather than to a dialect label, and it
       * is the difference between the entry page playing the right recording
       * and playing whichever one for that dialect came first.
       */
      wordDialectId: number | null;
      sourcePath: string;
      label: string;
    }
    const tasks: AudioTask[] = [];

    for (const record of prepared) {
      const wordId = wordIdByHeadword.get(record.headword);
      if (wordId === undefined) continue;
      if (record.baseAudio) {
        tasks.push({
          wordId,
          dialectId: null,
          wordDialectId: null,
          sourcePath: record.baseAudio,
          label: record.headword,
        });
      }
      for (const variant of record.dialectVariants) {
        if (!variant.audio) continue;
        tasks.push({
          wordId,
          dialectId: variant.dialectId,
          wordDialectId:
            dialectSpellingIds.get(`${wordId}:${variant.dialectId}:${variant.spelling}`) ?? null,
          sourcePath: variant.audio,
          label: record.headword,
        });
      }
    }

    // The unique index is on (word_id, storage_key), and several dialect entries
    // can point at the same recording for the same word. Uploading those twice
    // writes the same object twice — harmless on a local filesystem, but a real
    // S3 PUT cost — and the second row is discarded by the conflict clause
    // anyway. Deduplicate on the key the database actually enforces.
    const deduped = new Map<string, AudioTask>();
    for (const task of tasks) {
      deduped.set(
        `${task.wordDialectId ?? `word:${task.wordId}`}:${storageKeyFor(languageCode, task.sourcePath)}`,
        task
      );
    }
    const uniqueTasks = [...deduped.values()];
    if (uniqueTasks.length < tasks.length) {
      log(`  deduplicated ${tasks.length - uniqueTasks.length} repeated recordings`);
    }

    log(`\n  processing ${uniqueTasks.length} recordings ...`);

    const audioRows: unknown[][] = [];
    let processed = 0;

    for (const task of uniqueTasks) {
      processed += 1;
      if (processed % 500 === 0 || processed === uniqueTasks.length) {
        progress('audio', processed, uniqueTasks.length);
      }

      // Downloads are laid out as audio/<repo>/<path>, because the metadata
      // records paths inside the repo and two datasets can share a filename.
      // Keep this in step with scripts/fetch-audio.ts.
      const localPath = join(sourceDir, 'audio', AUDIO_REPO_DIR, task.sourcePath);
      let bytes: Buffer;
      try {
        bytes = await readFile(localPath);
      } catch {
        audioFilesMissing += 1;
        continue;
      }

      const key = storageKeyFor(languageCode, task.sourcePath);
      const contentType = contentTypeFor(task.sourcePath);

      try {
        await storage.put(key, bytes, contentType);
        audioUploaded += 1;
      } catch (error) {
        audioUploadFailed += 1;
        if (audioUploadFailed <= 3) {
          log(`\n  ! upload failed for ${task.sourcePath}: ${error instanceof Error ? error.message : error}`);
        }
        continue;
      }

      /*
       * A dialect recording is owned by the dialect SPELLING, not by the word.
       *
       * The check constraint requires exactly one owner, so this is one or the
       * other and never both: `word_dialect_id` for a dialect form,
       * `word_id` for the word's own recording. `dialect_id` is still set on
       * both, because that is the label the entry page shows, but it is no
       * longer the thing the page matches on — that is what made a chip for one
       * spelling play another spelling's audio.
       */
      audioRows.push([
        languageCode,
        task.dialectId,
        task.wordDialectId === null ? task.wordId : null,
        task.wordDialectId,
        key,
        contentType,
        bytes.length,
        sourceId,
        `Imported from nkowaokwu/ibo-dict: ${task.sourcePath}`,
      ]);
    }

    if (audioRows.length > 0) {
      log(`\n  inserting ${audioRows.length} audio rows ...`);
      audioRowsInserted = await insertMany(
        db,
        'audio',
        [
          'language_code',
          'dialect_id',
          'word_id',
          'word_dialect_id',
          'storage_key',
          'mime_type',
          'byte_size',
          'source_id',
          'provenance_note',
        ],
        audioRows,
        {
          /*
           * Untargeted, because there are now two partial unique indexes and a
           * batch can contain both kinds of row: `audio_no_duplicate_recording`
           * arbitrates a row owned by a word, `audio_no_duplicate_dialect_recording`
           * one owned by a dialect spelling. A targeted clause names one index
           * and leaves the other's conflicts to raise, so this defers to
           * whichever applies.
           */
          onConflict: 'on conflict do nothing',
        }
      );
    } else {
      log('\n  no recordings available to attach yet — download them first');
    }
  }

  return {
    entriesRead: limited.length,
    wordsInserted,
    wordsUpdated,
    definitionsInserted,
    dialectFormsInserted,
    audioUploaded,
    audioRowsInserted,
    audioFilesMissing,
    audioUploadFailed,
    unmappedWordClasses,
    unmappedDialects,
    durationMs: Date.now() - started,
  };
}

export async function runIbodictImportCli(): Promise<void> {
  const db = await getDb();
  try {
    console.log('\nImporting the ibo-dict corpus (words, dialect variants, audio)\n');
    const report = await importIbodictCorpus(db, {
      limit: process.env.OZITUMA_IMPORT_LIMIT ? Number(process.env.OZITUMA_IMPORT_LIMIT) : undefined,
      dryRun: process.env.OZITUMA_IMPORT_DRY_RUN === '1',
    });

    console.log('\n  Import complete');
    console.log('  ' + '-'.repeat(48));
    console.log(`  entries read             ${report.entriesRead}`);
    console.log(`  words inserted           ${report.wordsInserted}`);
    console.log(`  definitions inserted     ${report.definitionsInserted}`);
    console.log(`  dialect spellings        ${report.dialectFormsInserted}`);
    console.log(`  recordings uploaded      ${report.audioUploaded}`);
    console.log(`  audio rows inserted       ${report.audioRowsInserted}`);
    console.log(`  recordings missing       ${report.audioFilesMissing}`);
    console.log(`  recordings failed        ${report.audioUploadFailed}`);
    console.log(`  duration                 ${formatMs(report.durationMs)}`);

    const unmappedClasses = Object.entries(report.unmappedWordClasses);
    if (unmappedClasses.length > 0) {
      console.log(`  unmapped grammar labels  ${unmappedClasses.map(([k, v]) => `${k}(${v})`).join(', ')}`);
    }
    const unmappedD = Object.entries(report.unmappedDialects);
    if (unmappedD.length > 0) {
      console.log(`  unmapped dialect names   ${unmappedD.map(([k, v]) => `${k}(${v})`).join(', ')}`);
    }
    console.log('');
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runIbodictImportCli().catch((error) => {
    console.error('\nImport failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
