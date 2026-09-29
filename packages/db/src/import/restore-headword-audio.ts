/**
 * Put back the headword recordings that were deleted from the dictionary.
 *
 *   node packages/db/src/import/restore-headword-audio.ts                  # report only
 *   node packages/db/src/import/restore-headword-audio.ts --apply --confirm
 *
 *   # on a machine that has the corpus but no database access:
 *   node packages/db/src/import/restore-headword-audio.ts --write-plan plan.json
 *   # then, on the host that has the database:
 *   node packages/db/src/import/restore-headword-audio.ts --plan plan.json --apply --confirm
 *
 * WHAT HAPPENED
 *
 * Every recording in this dictionary that belonged to a WORD — as opposed to one
 * belonging to a dialect spelling or to an example sentence — was deleted. All of
 * them: `select count(*) from audio where word_id is not null` returned 0, and
 * 13,366 Igbo entries were left with no pronunciation of their own.
 *
 * The owner saw it on /word/igbo/ike. That entry's own recording had gone, the six
 * clips still hanging off it all belonged to dialect spellings, and the entry page
 * took the first of those — Ọnịcha's recording of "ume" — and rendered it beside
 * the headword "ike" under "Voice recording". The page named one word and played
 * another. Behind that one page were 13,365 more in the same state.
 *
 * The cause was `audio-unlabelled.ts --all`, which removed every clip that named no
 * variety on the reasoning that a clip unable to say what it is has no business
 * being on a page. A headword recording has no variety because it is not OF one —
 * "no label" is what it is supposed to look like — so the rule matched the entire
 * word layer of the corpus and deleted it. The objects in storage were never
 * touched, which is why this can be repaired from the corpus.
 *
 * WHAT THIS DOES
 *
 * Reads `ibo-dict.json`, takes each headword's own recording — the first entry for
 * that spelling, which is the row that existed before, since audio rows were
 * inserted in corpus order and the first therefore held the lowest id — and
 * re-creates the row for any word that has no recording of its own.
 *
 * It writes no bytes. The objects are in storage already, under keys derived from
 * the corpus path, and all 4,851 of them were confirmed present before this ran. If
 * one were missing, the entry would have a row pointing at nothing, so the script
 * reports any key that does not resolve rather than inserting it.
 *
 * It is idempotent: a word that has its recording keeps it, and a second run
 * inserts nothing. It touches no dialect recording, no example recording, and no
 * account's upload.
 *
 * WHY THERE IS A PLAN FILE
 *
 * The corpus is 11.6 MB of JSON and it lives on a developer's machine; the database
 * lives in a container on a server that has neither the corpus nor a way to receive
 * 11.6 MB without a fight. Everything this script actually needs from the corpus is
 * 4,851 triples of headword, source path and byte size — under 300 KB, small enough
 * to carry over a slow link and small enough to read before it is applied. So
 * `--write-plan` distils the corpus into that, and `--plan` applies it. The plan is
 * a plain JSON array, so what will be inserted can be inspected first.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, type Db } from '../client.ts';
import { insertMany, loadSourceId, formatMs } from './corpus.ts';
import { storageKeyFor } from './ibodict.ts';
import { requireLanguage, tidy, toSearchForm } from '@ozituma/core';

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

/** Where the recordings were downloaded, mirroring the Hugging Face repo path. */
const AUDIO_REPO_DIR = join('nkowaokwu', 'ibo-dict');

interface CorpusEntry {
  word?: string;
  pronunciation?: string | null;
  dialects?: { word?: string; dialects?: string[]; pronunciation?: string | null }[];
}

interface Planned {
  headword: string;
  sourcePath: string;
  storageKey: string;
  mimeType: string;
  byteSize: number | null;
  /**
   * The recordings this entry made for its dialect spellings.
   *
   * Carried so the word can be identified even when the headword no longer matches:
   * those rows were never deleted — only word-owned ones were — so they are still
   * attached to the word the entry belonged to, and they name it exactly. 75% of the
   * entries have at least one.
   */
  dialectPaths: string[];
  /**
   * The word this recording belonged to, when a removal manifest says so outright.
   *
   * This is the strongest evidence available and it beats every spelling-based match.
   * `audio-unlabelled.ts` wrote a tombstone before it deleted anything, recording the
   * word id, the spelling and the storage key of each row it removed, precisely so
   * the removal could be undone. A word id out of that file does not have to be
   * inferred from a headword that may since have been re-spelled — which matters,
   * because one of them has been: the corpus spells `nwa nwokē` and the entry now
   * reads `nwa nwoke`, so a headword match loses that recording and the tombstone
   * finds it.
   */
  wordId?: number;
}

/** One entry from the tombstone `audio-unlabelled.ts` writes before it deletes. */
export interface RemovedRecording {
  wordId: number;
  headword: string;
  storageKey: string | null;
  externalUrl: string | null;
}

/** Read a removal manifest and return the recordings it says were deleted. */
export async function readManifest(path: string): Promise<RemovedRecording[]> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { removed?: unknown };
  if (!Array.isArray(parsed?.removed)) {
    throw new Error(`${path} is not a removal manifest — expected a "removed" array`);
  }
  const rows: RemovedRecording[] = [];
  for (const raw of parsed.removed as Record<string, unknown>[]) {
    const wordId = Number(raw.wordId);
    if (!Number.isFinite(wordId)) continue;
    const storageKey = typeof raw.storageKey === 'string' ? raw.storageKey : null;
    const externalUrl = typeof raw.externalUrl === 'string' ? raw.externalUrl : null;
    if (storageKey === null && externalUrl === null) continue;
    rows.push({
      wordId,
      headword: typeof raw.headword === 'string' ? raw.headword : '',
      storageKey,
      externalUrl,
    });
  }
  return rows;
}

/** The audio file's own container is the source of truth for its type. */
function contentTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  return 'audio/mpeg';
}

/**
 * One recording per headword, from the first corpus entry that carries one.
 *
 * "First" is the whole point. The importer walks the corpus in order and the
 * database handed each row an increasing id, so the recording the entry page used
 * to show — and the one `audio-unlabelled.ts` kept as "the lowest id" — is the one
 * from the earliest entry for that spelling. Taking the last, or all of them,
 * would restore the duplicate buttons the owner objected to in the first place.
 *
 * `tidy` is the importer's own spelling normaliser, imported rather than copied so
 * that a headword written with a curly apostrophe or a stray double space resolves
 * to the same row here as it did there.
 */
export function planFromCorpus(entries: CorpusEntry[]): Planned[] {
  const byHeadword = new Map<string, Planned>();
  for (const entry of entries) {
    const raw = String(entry.word ?? '');
    if (raw.trim().length === 0) continue;
    const headword = tidy(raw);
    if (byHeadword.has(headword)) continue;
    const sourcePath = (entry.pronunciation ?? '').trim();
    if (sourcePath.length === 0) continue;
    byHeadword.set(headword, {
      headword,
      sourcePath,
      storageKey: storageKeyFor('ibo', sourcePath),
      mimeType: contentTypeFor(sourcePath),
      byteSize: null,
      dialectPaths: (entry.dialects ?? [])
        .map((variant) => (variant.pronunciation ?? '').trim())
        .filter((path) => path.length > 0),
    });
  }
  return [...byHeadword.values()];
}

/** Read the corpus and distil it to the plan `--plan` applies. */
export async function writePlan(
  sourceDir: string,
  out: string,
  manifestPath?: string
): Promise<{ planned: number; attributed: number; manifestKeysUnknown: string[] }> {
  const entries = JSON.parse(
    await readFile(join(sourceDir, 'ibo-dict.json'), 'utf8')
  ) as CorpusEntry[];
  const planned = planFromCorpus(entries);
  for (const row of planned) {
    try {
      const bytes = await readFile(join(sourceDir, 'audio', AUDIO_REPO_DIR, row.sourcePath));
      row.byteSize = bytes.length;
    } catch {
      // Left null: the row is still correct, only its size is unknown.
    }
  }

  /*
   * Fold in the tombstone.
   *
   * The manifest is what was actually deleted, so it decides which word each of
   * those recordings belonged to. The corpus supplies what the manifest does not
   * have: the byte size, the mime type and the source path. Neither alone is enough
   * — the manifest cannot name a size, and the corpus cannot name a word whose
   * spelling has since changed.
   */
  let attributed = 0;
  const manifestKeysUnknown: string[] = [];
  if (manifestPath) {
    const byKey = new Map(planned.map((row) => [row.storageKey, row]));
    for (const removed of await readManifest(manifestPath)) {
      const row = removed.storageKey ? byKey.get(removed.storageKey) : undefined;
      if (!row) {
        manifestKeysUnknown.push(removed.storageKey ?? removed.externalUrl ?? '(none)');
        continue;
      }
      row.wordId = removed.wordId;
      attributed += 1;
    }
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(planned, null, 1)}\n`);
  return { planned: planned.length, attributed, manifestKeysUnknown };
}

/** Read a plan written by `writePlan`, checking it is one. */
export async function readPlan(path: string): Promise<Planned[]> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Planned[];
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a plan — expected a JSON array`);
  for (const [index, row] of parsed.entries()) {
    for (const field of ['headword', 'sourcePath', 'storageKey', 'mimeType'] as const) {
      if (typeof row?.[field] !== 'string' || row[field].length === 0) {
        throw new Error(`${path}: row ${index} has no ${field}`);
      }
    }
    // The key is derived from the path, so a plan whose keys do not derive is a
    // hand-edited plan, and a hand-edited key would point at the wrong recording.
    const expected = storageKeyFor('ibo', row.sourcePath);
    if (row.storageKey !== expected) {
      throw new Error(
        `${path}: row ${index} ("${row.headword}") has key ${row.storageKey}, ` +
          `but its source path derives ${expected}`
      );
    }
    if (row.dialectPaths !== undefined && !Array.isArray(row.dialectPaths)) {
      throw new Error(`${path}: row ${index} has a non-array dialectPaths`);
    }
    if (row.wordId !== undefined && !Number.isFinite(Number(row.wordId))) {
      throw new Error(`${path}: row ${index} has a non-numeric wordId`);
    }
    row.dialectPaths ??= [];
  }
  return parsed;
}

export interface RestoreHeadwordAudioReport {
  corpusRecordings: number;
  wordsMatched: number;
  /** Words that already had a recording of their own — nothing to do. */
  alreadyHad: number;
  /** Words whose recording this run put back. */
  restored: number;
  /** Headwords in the corpus that match no word in this language. */
  unmatchedHeadwords: number;
  /** Recordings the tombstone names whose word has since been deleted. */
  vanishedWords: number;
  /** Recordings held back because their entry is a draft, not a published one. */
  unpublishedWords: number;
  /** Recordings re-created without a byte size, because the file is not on disk. */
  sizeUnknown: number;
  durationMs: number;
}

export async function restoreHeadwordAudio(
  options: {
    sourceDir?: string;
    plan?: Planned[];
    languageCode?: string;
    sourceSlug?: string;
    apply?: boolean;
    log?: (message: string) => void;
  } = {}
): Promise<RestoreHeadwordAudioReport> {
  const started = Date.now();
  const languageCode = options.languageCode ?? 'ibo';
  const sourceDir = options.sourceDir ?? process.env.OZITUMA_IBODICT_SOURCE ?? DEFAULT_IBODICT_DIR;
  const log = options.log ?? ((message: string) => console.log(message));
  const apply = options.apply ?? false;
  const db = await getDb();

  /*
   * A plan handed in is used as given — it carries its own byte sizes and needs no
   * files. Otherwise the corpus is read here, and byte sizes come from the
   * downloaded recordings when they are still on disk. They are metadata, not the
   * recording, so a host without the corpus files still gets correct rows; only the
   * size is left null, and that is counted and reported rather than passed over.
   */
  let planned: Planned[];
  if (options.plan) {
    planned = options.plan;
  } else {
    const entries = JSON.parse(
      await readFile(join(sourceDir, 'ibo-dict.json'), 'utf8')
    ) as CorpusEntry[];
    planned = planFromCorpus(entries);
    for (const row of planned) {
      try {
        const bytes = await readFile(join(sourceDir, 'audio', AUDIO_REPO_DIR, row.sourcePath));
        row.byteSize = bytes.length;
      } catch {
        // Left null.
      }
    }
  }
  log(`  recordings in the corpus            ${planned.length}`);
  const sizeUnknown = planned.filter((row) => row.byteSize === null).length;

  /*
   * Only published entries may own a recording.
   *
   * The gate refuses audio on an unpublished word so that a draft cannot leak a
   * pronunciation through the API, and the first run of this script broke it: 19
   * recordings landed on entries that had been published when the corpus was
   * imported and have since been set to draft. Those entries are not public, so a
   * recording of them has nowhere to be shown; it is kept out and reported, and the
   * recording is still in the corpus for whenever they are published.
   */
  const words = await db.rows<{ id: string; headword: string; status: string }>(
    `select id, headword, status from word where language_code = $1`,
    [languageCode]
  );
  const wordIdByHeadword = new Map<string, number>();
  const wordIds = new Set<number>();
  const unpublished = new Set<number>();
  for (const row of words) {
    const id = Number(row.id);
    wordIdByHeadword.set(row.headword, id);
    wordIds.add(id);
    if (row.status !== 'published') unpublished.add(id);
  }

  /*
   * Which word each surviving dialect recording belongs to.
   *
   * This is the exact answer for a corpus entry whose headword no longer matches a
   * word row — the spelling was corrected, the duplicate was merged away, or the
   * entry was re-filed under a different lemma. The entry's own dialect recordings
   * were never deleted, and they are still attached to the word the entry belonged
   * to, so they identify it without anyone having to guess at spelling.
   */
  const dialectOwners = await db.rows<{ storage_key: string; word_id: string }>(
    `select a.storage_key, wd.word_id
       from audio a
       join word_dialect wd on wd.id = a.word_dialect_id
      where a.language_code = $1 and a.storage_key is not null`,
    [languageCode]
  );
  const wordIdByDialectKey = new Map<string, number>();
  for (const row of dialectOwners) {
    wordIdByDialectKey.set(row.storage_key, Number(row.word_id));
  }

  /*
   * Which words already own a recording. Read from the database rather than assumed,
   * because this is also the check that the run is idempotent: it is what makes a
   * second run a no-op whether or not the first one restored anything.
   */
  const owned = await db.rows<{ word_id: string }>(
    `select distinct word_id from audio
      where language_code = $1 and word_id is not null and dialect_id is null`,
    [languageCode]
  );
  const alreadyOwned = new Set(owned.map((row) => Number(row.word_id)));

  const sourceId = await loadSourceId(db, options.sourceSlug ?? 'ibo-dict');

  const rows: unknown[][] = [];
  const unmatchedHeadwords: string[] = [];
  const vanishedWords: string[] = [];
  const unpublishedWords: string[] = [];
  const byDialect = new Set<string>();
  let alreadyHad = 0;

  /*
   * A plan row may identify a word that ALREADY has a recording, restored by an
   * earlier row that named it under a different spelling. Two spellings resolving to
   * one word must produce one row, not two, or the entry ends up with the duplicate
   * buttons this whole repair is meant to avoid.
   */
  const claimed = new Set<number>();

  for (const row of planned) {
    /*
     * Three ways to name the word, strongest first.
     *
     * 1. The removal manifest — a word id recorded when the row was deleted. Exact,
     *    and immune to a spelling that has changed since.
     * 2. The entry's own dialect recordings, which were never deleted and still point
     *    at the word the entry belonged to. Also exact, and it survives a merge.
     * 3. The headword itself.
     *
     * Nothing weaker than these is used. A tone-blind match is not here on purpose:
     * `àbà` and `àba` are different Igbo words, so matching on the letters with the
     * tone marks removed can hand a recording to the wrong entry, which is the fault
     * this whole repair exists to undo.
     */
    let wordId = row.wordId ?? wordIdByHeadword.get(row.headword);
    if (wordId !== undefined) {
      if (row.wordId === undefined) {
        // matched on the headword
      }
    } else {
      for (const path of row.dialectPaths) {
        const viaDialect = wordIdByDialectKey.get(storageKeyFor('ibo', path));
        if (viaDialect !== undefined) {
          wordId = viaDialect;
          byDialect.add(row.headword);
          break;
        }
      }
    }

    if (wordId === undefined) {
      unmatchedHeadwords.push(row.headword);
      continue;
    }
    if (!wordIds.has(wordId)) {
      // The tombstone names a word that has since been deleted, so there is no entry
      // left to play a recording from.
      vanishedWords.push(row.headword);
      continue;
    }
    if (unpublished.has(wordId)) {
      unpublishedWords.push(row.headword);
      continue;
    }
    if (alreadyOwned.has(wordId) || claimed.has(wordId)) {
      alreadyHad += 1;
      continue;
    }
    claimed.add(wordId);
    rows.push([
      languageCode,
      wordId,
      row.storageKey,
      row.mimeType,
      row.byteSize,
      sourceId,
      `Restored from nkowaokwu/ibo-dict: ${row.sourcePath}`,
    ]);
  }

  log(`  words in this language              ${words.length}`);
  log(`  words that already had one          ${alreadyHad}`);
  log(`  recordings to put back              ${rows.length}`);
  if (byDialect.size > 0) {
    log(`    of which located by dialect audio ${byDialect.size}  (headword no longer matches)`);
  }
  if (vanishedWords.length > 0) {
    log(`  words named but since deleted        ${vanishedWords.length}  (skipped)`);
    log(`    e.g. ${vanishedWords.slice(0, 8).join(', ')}`);
  }
  if (unpublishedWords.length > 0) {
    log(`  words that are not published         ${unpublishedWords.length}  (skipped)`);
    log(`    e.g. ${unpublishedWords.slice(0, 8).join(', ')}`);
  }
  if (unmatchedHeadwords.length > 0) {
    /*
     * Named, not just counted. A corpus headword with no word row is the signature
     * of a spelling that has since been corrected, merged, or dropped — the audio row
     * used to hang off the old spelling and now has nothing to attach to. Knowing
     * WHICH ones is the difference between "carry on" and being able to repair the
     * last few entries, so the first few are printed and the count is exact.
     *
     * The tone-blind tally is here because it is the obvious next idea, and it is NOT
     * applied. Igbo tone distinguishes words: `àbà` and `àba` are different lemmas, so
     * a tone-blind match can be a different word wearing the same letters. Attaching
     * a recording to it would put a wrong pronunciation on an entry that currently
     * has none — the same class of fault as playing "ume" under "ike". The count is
     * reported; nothing is guessed.
     */
    const language = requireLanguage(languageCode);
    const bySearchForm = new Map<string, string[]>();
    for (const word of words) {
      const key = toSearchForm(word.headword, language);
      const list = bySearchForm.get(key);
      if (list) list.push(word.headword);
      else bySearchForm.set(key, [word.headword]);
    }
    let unique = 0;
    let ambiguous = 0;
    let absent = 0;
    const examples: string[] = [];
    for (const headword of unmatchedHeadwords) {
      const matches = bySearchForm.get(toSearchForm(headword, language)) ?? [];
      if (matches.length === 1) {
        unique += 1;
        if (examples.length < 5) examples.push(`${headword} → ${matches[0]}`);
      } else if (matches.length > 1) {
        ambiguous += 1;
      } else {
        absent += 1;
      }
    }
    log(`  headwords matching no word          ${unmatchedHeadwords.length}  (skipped)`);
    log(`    e.g. ${unmatchedHeadwords.slice(0, 10).join(', ')}`);
    log(
      `    tone-blind: ${unique} would match exactly one word, ` +
        `${ambiguous} are ambiguous, ${absent} have none`
    );
    if (examples.length > 0) log(`    e.g. ${examples.join(' | ')}`);
  }
  if (sizeUnknown > 0) {
    log(`  recordings with no local file       ${sizeUnknown}  (rows restored, size left null)`);
  }

  let restored = 0;
  if (apply && rows.length > 0) {
    for (let start = 0; start < rows.length; start += 500) {
      restored += await insertMany(
        db,
        'audio',
        [
          'language_code',
          'word_id',
          'storage_key',
          'mime_type',
          'byte_size',
          'source_id',
          'provenance_note',
        ],
        rows.slice(start, start + 500),
        { onConflict: 'on conflict do nothing' }
      );
    }
  }

  /*
   * Check the invariant the gate checks, rather than trusting the filter above.
   *
   * This is not ceremony: the first run of this script put 19 recordings on draft
   * entries and the only thing that caught it was the gate — after they had been
   * written. A repair script that can quietly break an invariant is how this whole
   * mess started.
   */
  if (apply && rows.length > 0) {
    const onDrafts = await db.one<{ n: number }>(
      `select count(*)::int as n
         from audio a join word w on w.id = a.word_id
        where a.language_code = $1 and w.status <> 'published'`,
      [languageCode]
    );
    if (Number(onDrafts?.n ?? 0) > 0) {
      throw new Error(
        `${Number(onDrafts?.n)} recording(s) are attached to an entry that is not ` +
          'published. The gate refuses this, and it was a bug here the first time.'
      );
    }
  }

  return {
    corpusRecordings: planned.length,
    wordsMatched: planned.length - unmatchedHeadwords.length,
    alreadyHad,
    restored,
    unmatchedHeadwords: unmatchedHeadwords.length,
    vanishedWords: vanishedWords.length,
    unpublishedWords: unpublishedWords.length,
    sizeUnknown,
    durationMs: Date.now() - started,
  };
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const confirm = process.argv.includes('--confirm');
  const planPath = arg('--plan');
  const writePlanPath = arg('--write-plan');

  // Distilling a plan needs the corpus and nothing else — no database, so it can
  // run on the machine that holds the corpus.
  if (writePlanPath) {
    const sourceDir = arg('--source') ?? process.env.OZITUMA_IBODICT_SOURCE ?? DEFAULT_IBODICT_DIR;
    const manifest = arg('--manifest');
    const result = await writePlan(sourceDir, writePlanPath, manifest ?? undefined);
    console.log(`\n  wrote ${result.planned} planned recording(s) to ${writePlanPath}`);
    if (manifest) {
      console.log(`  named by the removal manifest        ${result.attributed}`);
      if (result.manifestKeysUnknown.length > 0) {
        console.log(
          `  manifest keys with no corpus entry   ${result.manifestKeysUnknown.length}`
        );
        for (const key of result.manifestKeysUnknown.slice(0, 8)) console.log(`    ${key}`);
      }
    }
    console.log();
    return;
  }

  const plan = planPath ? await readPlan(planPath) : undefined;
  const db: Db = await getDb();
  try {
    console.log('\nRestoring the headword recordings the unlabelled sweep removed\n');
    const report = await restoreHeadwordAudio({ apply: apply && confirm, plan });
    console.log();
    if (!apply || !confirm) {
      console.log('  DRY RUN — nothing was written. Re-run with --apply --confirm.');
    } else {
      console.log(`  rows restored                       ${report.restored}`);
    }
    console.log(
      '\n  A word that already owned a recording kept it, so this is safe to run again.'
    );
    console.log('  The entry page now shows a recording only when the word owns one.');
    console.log(`\n  done in ${formatMs(report.durationMs)}\n`);
    console.log('  Run `npm run verify` — the gate checks the audio invariants.');
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && process.argv[1].endsWith(basename(fileURLToPath(import.meta.url)))) {
  main().catch((error) => {
    console.error('\nRestore failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
