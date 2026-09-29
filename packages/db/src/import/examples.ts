/**
 * Import the nkowaokwu/ibo-dict-expansion sentence corpus.
 *
 * 25,000 entries of the form { igbo, english, pronunciation } — an Igbo
 * sentence, its English translation, and a recording of it.
 *
 * THE INTERESTING PROBLEM: THE SOURCE HAS NO WORD LINKS
 *
 * Sentences are only useful on an entry page if we know which words they
 * contain, and this corpus does not say. The Igbo API's own sentences carry an
 * `associatedWords` array; these do not. So the links are DERIVED here, by
 * matching the words we already have against each sentence.
 *
 * Deriving links is a judgement call, not a lookup, so the rules are explicit
 * and conservative:
 *
 *   1. Matching happens on `search_form`, so a sentence written without tone
 *      marks still links to the accented headword — the same machinery the
 *      search box uses.
 *   2. Single tokens must be at least 3 characters. Without this, Igbo's very
 *      common one- and two-letter words ("m", "na", "ya") would attach
 *      thousands of sentences to nearly every entry, which is noise rather
 *      than an example.
 *   3. Multi-word headwords are matched as phrases across n-grams, so
 *      "mmiri ozuzo" links as one unit rather than as "mmiri" plus "ozuzo".
 *   4. At most MAX_LINKS_PER_EXAMPLE links are kept, preferring the longest
 *      match, so a long sentence does not become an edge to every word in it.
 *   5. Only `published` words are considered, and a sentence longer than the
 *      cap is imported with fewer links rather than skipped — an unlinked
 *      sentence is still a valid example with a translation and audio.
 *
 * Usage:
 *   node src/import/examples.ts
 *   OZITUMA_IMPORT_LIMIT=100 node src/import/examples.ts
 *   OZITUMA_EXAMPLES_NO_AUDIO=1 node src/import/examples.ts   # text only
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage, tokenize } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { getStorage } from '../storage.ts';
import { formatMs, insertMany, loadSourceId, progress } from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_DIR = resolve(HERE, '..', '..', '..', '..', 'data', 'sources', 'ibodict');
const AUDIO_REPO_DIR = join('nkowaokwu', 'ibo-dict-expansion');

/** See rule 2 in the header. */
const MIN_TOKEN_LENGTH = 3;
/** See rule 4 in the header. */
const MAX_LINKS_PER_EXAMPLE = 8;
/** Longest phrase, in words, considered a possible headword. */
const MAX_PHRASE_WORDS = 4;

interface SentenceEntry {
  igbo?: string;
  english?: string;
  pronunciation?: string;
  style?: string;
  type?: string;
}

function contentTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  return 'audio/mpeg';
}

function storageKeyFor(sourcePath: string): string {
  const digest = createHash('sha256').update(sourcePath).digest('hex').slice(0, 24);
  return `audio/ibo/examples/${digest}${extname(sourcePath).toLowerCase() || '.mp3'}`;
}

export interface ExampleImportOptions {
  sourceDir?: string;
  languageCode?: string;
  sourceSlug?: string;
  limit?: number;
  dryRun?: boolean;
  skipAudio?: boolean;
  log?: (message: string) => void;
}

export interface ExampleImportReport {
  entriesRead: number;
  examplesInserted: number;
  examplesSkippedExisting: number;
  linksInserted: number;
  unlinkedExamples: number;
  audioUploaded: number;
  audioRowsInserted: number;
  audioFilesMissing: number;
  sentencesWithoutTranslation: number;
  durationMs: number;
}

export async function importSentenceCorpus(
  db: Db,
  options: ExampleImportOptions = {}
): Promise<ExampleImportReport> {
  const started = Date.now();
  const log = options.log ?? ((message: string) => console.log(message));
  const sourceDir = options.sourceDir ?? process.env.OZITUMA_IBODICT_SOURCE ?? DEFAULT_SOURCE_DIR;
  const languageCode = options.languageCode ?? 'ibo';
  const sourceSlug = options.sourceSlug ?? 'ibo-dict-expansion';

  const language = requireLanguage(languageCode);
  const sourceId = await loadSourceId(db, sourceSlug);
  const storage = getStorage();

  // --- Read the corpus ----------------------------------------------------
  const metadataPath = join(sourceDir, 'ibo-dict-expansion.json');
  log(`  reading ${metadataPath}`);
  const entries = JSON.parse(await readFile(metadataPath, 'utf8')) as SentenceEntry[];
  log(`  corpus: ${entries.length} sentences`);
  const limited = options.limit && options.limit > 0 ? entries.slice(0, options.limit) : entries;

  // --- Build the word index used to derive links --------------------------
  // Loaded once: 12k-odd rows is far cheaper in memory than 25k round trips.
  const words = await db.rows<{ id: string; headword: string; search_form: string }>(
    `select id, headword, search_form from word
      where language_code = $1 and status = 'published'`,
    [languageCode]
  );
  const bySearchForm = new Map<string, number>();
  for (const row of words) {
    if (!bySearchForm.has(row.search_form)) bySearchForm.set(row.search_form, Number(row.id));
  }
  // Phrase index: only headwords containing a space or hyphen can be phrases.
  const phraseForms = [...bySearchForm.keys()].filter((form) => /[\s-]/.test(form));
  log(`  word index: ${bySearchForm.size} distinct forms, ${phraseForms.length} multi-word`);

  /** Find the words a sentence contains, longest match first. */
  function deriveLinks(sentence: string): number[] {
    const tokens = tokenize(sentence, language);
    const found = new Map<number, number>(); // wordId -> matched token count

    // Phrases first, so "mmiri ozuzo" is preferred over "mmiri".
    for (let size = MAX_PHRASE_WORDS; size >= 2; size -= 1) {
      for (let i = 0; i + size <= tokens.length; i += 1) {
        const phrase = tokens.slice(i, i + size).join(' ');
        const wordId = bySearchForm.get(phrase);
        if (wordId !== undefined) found.set(wordId, size);
      }
    }

    for (const token of tokens) {
      if (token.length < MIN_TOKEN_LENGTH) continue;
      const wordId = bySearchForm.get(token);
      if (wordId !== undefined && !found.has(wordId)) found.set(wordId, 1);
    }

    return [...found.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, MAX_LINKS_PER_EXAMPLE)
      .map(([wordId]) => wordId);
  }

  // --- Prepare ------------------------------------------------------------
  interface Prepared {
    text: string;
    searchForm: string;
    translation: string | null;
    externalId: string;
    audioPath: string | null;
    links: number[];
  }

  const prepared: Prepared[] = [];
  let sentencesWithoutTranslation = 0;
  /** How many times each sentence text has been seen, so ids stay unique. */
  const occurrences = new Map<string, number>();

  for (const entry of limited) {
    const text = String(entry.igbo ?? '').trim();
    if (text.length === 0) continue;
    const english = String(entry.english ?? '').trim();
    if (english.length === 0) sentencesWithoutTranslation += 1;

    // external_id must identify ONE row. A hash of the text does not: 628
    // sentences in this corpus appear twice, recorded separately with different
    // audio and in 103 cases a different translation. Collapsing them lost the
    // second row's links entirely, because the id map could only point at one.
    // So occurrences of the same text get a distinct suffix.
    const textHash = createHash('sha256').update(text).digest('hex').slice(0, 20);
    const occurrence = (occurrences.get(textHash) ?? 0) + 1;
    occurrences.set(textHash, occurrence);
    const externalId =
      'ibodict-ex-' + textHash + (occurrence > 1 ? `-${occurrence}` : '');

    prepared.push({
      text,
      searchForm: deriveForms(text, language).searchForm,
      translation: english.length > 0 ? english : null,
      externalId,
      audioPath: entry.pronunciation?.trim() || null,
      links: deriveLinks(text),
    });
  }

  const withLinks = prepared.filter((p) => p.links.length > 0).length;
  log(`  prepared ${prepared.length} sentences, ${withLinks} with derived word links`);

  if (options.dryRun) {
    return {
      entriesRead: limited.length,
      examplesInserted: 0,
      examplesSkippedExisting: 0,
      linksInserted: 0,
      unlinkedExamples: prepared.length - withLinks,
      audioUploaded: 0,
      audioRowsInserted: 0,
      audioFilesMissing: 0,
      sentencesWithoutTranslation,
      durationMs: Date.now() - started,
    };
  }

  // --- Insert examples ----------------------------------------------------
  // external_id makes this idempotent and lets an interrupted run resume: a
  // sentence already present is skipped entirely, audio included.
  const existing = await db.rows<{ external_id: string }>(
    `select external_id from example where language_code = $1 and source_id = $2 and external_id is not null`,
    [languageCode, sourceId]
  );
  const alreadyThere = new Set(existing.map((row) => row.external_id));
  const toInsert = prepared.filter((p) => !alreadyThere.has(p.externalId));

  log(`\n  inserting ${toInsert.length} new sentences (${alreadyThere.size} already present) ...`);

  const exampleRows = toInsert.map((p) => [
    languageCode,
    p.text,
    p.searchForm,
    p.translation,
    p.translation ? 'eng' : null,
    sourceId,
    p.externalId,
  ]);

  await insertMany(
    db,
    'example',
    [
      'language_code',
      'text',
      'search_form',
      'translation',
      'translation_language_code',
      'source_id',
      'external_id',
    ],
    exampleRows,
    {
      // If this ever fires, external_id has stopped being unique and rows are
      // being silently dropped — which is exactly the bug this guards against.
      onConflict:
        'on conflict (language_code, source_id, external_id) where external_id is not null do nothing',
    }
  );

  const idRows = await db.rows<{ id: string; external_id: string }>(
    `select id, external_id from example where language_code = $1 and source_id = $2 and external_id is not null`,
    [languageCode, sourceId]
  );
  const idByExternal = new Map(idRows.map((row) => [row.external_id, Number(row.id)]));

  const linkRows: unknown[][] = [];
  let unlinked = 0;
  for (const p of toInsert) {
    const exampleId = idByExternal.get(p.externalId);
    if (exampleId === undefined) continue;
    if (p.links.length === 0) {
      unlinked += 1;
      continue;
    }
    for (const wordId of p.links) linkRows.push([exampleId, wordId]);
  }

  log(`  inserting ${linkRows.length} word links ...`);
  const linksInserted = await insertMany(db, 'example_word', ['example_id', 'word_id'], linkRows, {
    onConflict: 'on conflict do nothing',
  });

  // --- Audio --------------------------------------------------------------
  let audioUploaded = 0;
  let audioRowsInserted = 0;
  let audioFilesMissing = 0;

  if (!options.skipAudio) {
    interface AudioTask {
      exampleId: number;
      sourcePath: string;
    }
    const tasks: AudioTask[] = [];
    for (const p of toInsert) {
      if (!p.audioPath) continue;
      const exampleId = idByExternal.get(p.externalId);
      if (exampleId === undefined) continue;
      tasks.push({ exampleId, sourcePath: p.audioPath });
    }

    log(`\n  processing ${tasks.length} sentence recordings ...`);
    const audioRows: unknown[][] = [];
    let processed = 0;

    for (const task of tasks) {
      processed += 1;
      if (processed % 500 === 0 || processed === tasks.length) {
        progress('audio', processed, tasks.length);
      }

      const localPath = join(sourceDir, 'audio', AUDIO_REPO_DIR, task.sourcePath);
      let bytes: Buffer;
      try {
        bytes = await readFile(localPath);
      } catch {
        audioFilesMissing += 1;
        continue;
      }

      const key = storageKeyFor(task.sourcePath);
      const contentType = contentTypeFor(task.sourcePath);
      try {
        await storage.put(key, bytes, contentType);
        audioUploaded += 1;
      } catch {
        continue;
      }

      audioRows.push([
        languageCode,
        task.exampleId,
        key,
        contentType,
        bytes.length,
        sourceId,
        `Imported from nkowaokwu/ibo-dict-expansion: ${task.sourcePath}`,
      ]);
    }

    if (audioRows.length > 0) {
      log(`\n  inserting ${audioRows.length} sentence audio rows ...`);
      audioRowsInserted = await insertMany(
        db,
        'audio',
        ['language_code', 'example_id', 'storage_key', 'mime_type', 'byte_size', 'source_id', 'provenance_note'],
        audioRows,
        { onConflict: 'on conflict do nothing' }
      );
    }
  }

  return {
    entriesRead: limited.length,
    examplesInserted: toInsert.length,
    examplesSkippedExisting: alreadyThere.size,
    linksInserted,
    unlinkedExamples: unlinked,
    audioUploaded,
    audioRowsInserted,
    audioFilesMissing,
    sentencesWithoutTranslation,
    durationMs: Date.now() - started,
  };
}

export async function runExamplesImportCli(): Promise<void> {
  const db = await getDb();
  try {
    console.log('\nImporting the Igbo sentence corpus\n');
    const report = await importSentenceCorpus(db, {
      limit: process.env.OZITUMA_IMPORT_LIMIT ? Number(process.env.OZITUMA_IMPORT_LIMIT) : undefined,
      dryRun: process.env.OZITUMA_IMPORT_DRY_RUN === '1',
      skipAudio: process.env.OZITUMA_EXAMPLES_NO_AUDIO === '1',
    });

    console.log('\n  Import complete');
    console.log('  ' + '-'.repeat(48));
    console.log(`  entries read             ${report.entriesRead}`);
    console.log(`  sentences inserted       ${report.examplesInserted}`);
    console.log(`  already present          ${report.examplesSkippedExisting}`);
    console.log(`  word links inserted      ${report.linksInserted}`);
    console.log(`  sentences with no links  ${report.unlinkedExamples}`);
    console.log(`  recordings uploaded      ${report.audioUploaded}`);
    console.log(`  audio rows inserted      ${report.audioRowsInserted}`);
    console.log(`  recordings missing       ${report.audioFilesMissing}`);
    console.log(`  missing a translation    ${report.sentencesWithoutTranslation}`);
    console.log(`  duration                 ${formatMs(report.durationMs)}`);
    console.log('');
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runExamplesImportCli().catch((error) => {
    console.error('\nImport failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
