/**
 * Turn an ASR scan into a review queue, and — only on an explicit instruction —
 * remove the recordings it found.
 *
 *   # report only; the default, and it writes nothing to the database
 *   node packages/db/src/import/audio-review.ts --scan scan.json --report review.csv
 *
 *   # remove the worst ones. Needs BOTH flags; without --confirm it prints what
 *   # it would do and stops.
 *   node packages/db/src/import/audio-review.ts --scan scan.json --remove gross --confirm
 *
 * WHY THE DEFAULT IS A REPORT
 *
 * The speech model is not accurate enough to delete with. Measured: single-word
 * recordings come back exactly 63% of the time, and the errors are `ọ/o`, `ụ/u`,
 * `ị/i` and tone — the contrasts that distinguish different Igbo words. So
 * "transcript != filed text" is mostly the model mishearing a minimal pair, not
 * a recording that says something else. Anything this script removes, a person
 * has to have decided to remove.
 *
 * WHAT `--remove gross` ACTUALLY REQUIRES
 *
 * Even then the bar is deliberately narrow, because deletion here is the only
 * irreversible step in the pipeline:
 *
 *   - the tier must be `gross` (character error rate above 0.75), not `wrong`,
 *     `away` or any of the minimal-pair bands;
 *   - the FILED text must be at least 5 characters once folded, so a one- or
 *     two-syllable clip cannot be condemned on the strength of a model that
 *     admits it fails on short clips;
 *   - the transcript must contain at least 3 characters, so a model that
 *     produced 'm' or 'ee' for a syllable is treated as having failed rather
 *     than as evidence about the audio;
 *   - and what is removed is written to a tombstone file first, with the storage
 *     key, so a removal can be audited or reversed from the source corpus.
 *
 * A sentence corpus is a different matter: measured mean character error rate
 * there is 0.020 with zero gross failures on 30 sampled, so filtering sentences
 * is defensible in a way that filtering single words is not.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { closeDb, getDb } from '../client.ts';
import { formatMs } from './corpus.ts';

interface ScanRow {
  file: string;
  expected: string | null;
  transcript?: string;
  cer?: number | null;
  tier?: string;
  error?: string;
}

/** The same folding the scanner scored with, so the thresholds mean the same. */
function normalise(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_LABEL_CHARS = 5;
const MIN_TRANSCRIPT_CHARS = 3;

/** Is this recording one the evidence actually supports removing? */
export function removable(row: ScanRow): { ok: boolean; why: string } {
  if (row.tier !== 'gross') return { ok: false, why: `tier is ${row.tier ?? 'unknown'}, not gross` };
  const label = normalise(row.expected).replace(/ /g, '');
  const said = normalise(row.transcript).replace(/ /g, '');
  if (label.length < MIN_LABEL_CHARS) {
    return { ok: false, why: `filed text is only ${label.length} characters` };
  }
  if (said.length < MIN_TRANSCRIPT_CHARS) {
    return { ok: false, why: 'the model produced too little to be evidence' };
  }
  return { ok: true, why: 'gross mismatch with a substantial transcript' };
}

export interface AudioReviewReport {
  scanned: number;
  flagged: number;
  removable: number;
  matched: number;
  unmatched: number;
  removed: number;
  reportPath: string | null;
  tombstonePath: string | null;
  durationMs: number;
}

export async function reviewAudio(
  options: {
    scanPath: string;
    reportPath?: string | null;
    removeTier?: string | null;
    confirm?: boolean;
    languageCode?: string;
    log?: (m: string) => void;
  }
): Promise<AudioReviewReport> {
  const started = Date.now();
  const log = options.log ?? ((m: string) => console.log(m));
  const languageCode = options.languageCode ?? 'ibo';
  const db = await getDb();

  const parsed = JSON.parse(await readFile(options.scanPath, 'utf8')) as {
    rows: ScanRow[];
    tiers?: Record<string, number>;
  };
  const rows = parsed.rows ?? [];
  log(`  recordings scanned                 ${rows.length}`);
  if (parsed.tiers) log(`  tiers                              ${JSON.stringify(parsed.tiers)}`);

  const flagged = rows.filter((r) => r.tier === 'gross' || r.tier === 'wrong');
  const candidates = rows.filter((r) => removable(r).ok);
  log(`  flagged (wrong or gross)           ${flagged.length}`);
  log(`  meeting the removal bar            ${candidates.length}`);

  // --- Match each scan row to the audio row it came from -------------------
  // The scan keys on the storage key's basename, which is what makes the join
  // possible without the scan needing to know any database ids.
  const files = rows.map((r) => r.file);
  const audioRows = await db.rows<{
    id: string;
    storage_key: string | null;
    external_url: string | null;
    word_id: string | null;
    word_dialect_id: string | null;
  }>(
    `select a.id, a.storage_key, a.external_url, a.word_id, a.word_dialect_id
       from audio a
      where a.storage_key is not null
        and split_part(a.storage_key, '/', 4) = any($1::text[])`,
    [files]
  );
  const byBasename = new Map<string, (typeof audioRows)[number]>();
  for (const row of audioRows) {
    const base = row.storage_key?.split('/').pop();
    if (base) byBasename.set(base, row);
  }
  log(`  matched to stored recordings        ${byBasename.size} of ${rows.length}`);
  log(`  in the scan but not in the database ${rows.length - byBasename.size}`);

  // --- The report ---------------------------------------------------------
  let reportPath: string | null = null;
  if (options.reportPath) {
    const header = 'tier,cer,file,filed_text,transcript,headword,storage_key,removable';
    const lines = [header];
    for (const row of flagged.length > 0 ? flagged : rows) {
      const audio = byBasename.get(row.file);
      const verdict = removable(row);
      const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      lines.push(
        [
          csv(row.tier),
          csv(row.cer),
          csv(row.file),
          csv(row.expected),
          csv(row.transcript ?? row.error),
          csv(audio?.word_id ?? audio?.word_dialect_id ?? ''),
          csv(audio?.storage_key ?? ''),
          csv(verdict.ok ? 'yes' : verdict.why),
        ].join(',')
      );
    }
    await writeFile(options.reportPath, lines.join('\n') + '\n');
    reportPath = options.reportPath;
    log(`  wrote the review queue to          ${options.reportPath}`);
  }

  // --- Removal, only on an explicit instruction --------------------------
  let removed = 0;
  let tombstonePath: string | null = null;

  if (options.removeTier) {
    const target = options.removeTier;
    const chosen = rows.filter((r) => removable(r).ok && r.tier === target);
    log(`  chosen for removal (tier ${target})  ${chosen.length}`);

    if (!options.confirm) {
      log('  DRY RUN — nothing was deleted. Re-run with --confirm to remove these.');
    } else {
      /*
       * The tombstone is written BEFORE anything is deleted, so a removal leaves
       * a record of every storage key even if the process dies halfway. The
       * object can be restored from the source corpus by that key.
       */
      tombstonePath = `${options.scanPath}.removed.json`;
      await writeFile(
        tombstonePath,
        JSON.stringify(
          {
            removedAt: new Date().toISOString(),
            tier: target,
            bar: { MIN_LABEL_CHARS, MIN_TRANSCRIPT_CHARS },
            entries: chosen.map((r) => ({
              file: r.file,
              filedText: r.expected,
              transcript: r.transcript,
              cer: r.cer,
              storageKey: byBasename.get(r.file)?.storage_key ?? null,
            })),
          },
          null,
          1
        )
      );
      log(`  tombstone written first            ${tombstonePath}`);

      for (const row of chosen) {
        const audio = byBasename.get(row.file);
        if (!audio) continue;
        // The row goes; the object in R2 is left in place deliberately, so a
        // wrong removal is a row to reinstate rather than a file to re-upload.
        await db.query(`delete from audio where id = $1`, [Number(audio.id)]);
        removed += 1;
      }
      log(`  recordings removed                 ${removed}`);
    }
  }

  return {
    scanned: rows.length,
    flagged: flagged.length,
    removable: candidates.length,
    matched: byBasename.size,
    unmatched: rows.length - byBasename.size,
    removed,
    reportPath,
    tombstonePath,
    durationMs: Date.now() - started,
  };
}

/**
 * Remove recordings from an explicit list of storage keys.
 *
 * This is the only removal path that is not a judgement call. A file that will
 * not decode cannot be played in a browser either, so it is a defect rather than
 * a suspicion — unlike the ASR tiers, which are the model's opinion. The list is
 * produced by `scripts/asr/check_playable.py`, which needs no speech model and
 * answers unambiguously.
 *
 * Every key is written to a tombstone first, and the object in R2 is left where
 * it is: a wrong removal is then a row to reinstate rather than a file to
 * re-upload.
 */
export async function removeByStorageKeys(
  keys: readonly string[],
  options: { confirm?: boolean; log?: (m: string) => void } = {}
): Promise<{ matched: number; removed: number; tombstonePath: string | null }> {
  const log = options.log ?? ((m: string) => console.log(m));
  const db = await getDb();

  const rows = await db.rows<{ id: string; storage_key: string }>(
    `select id, storage_key from audio where storage_key = any($1::text[])`,
    [keys as string[]]
  );
  log(`  keys given                         ${keys.length}`);
  log(`  matching recordings in the database ${rows.length}`);

  if (!options.confirm) {
    log('  DRY RUN — nothing deleted. Re-run with --confirm.');
    return { matched: rows.length, removed: 0, tombstonePath: null };
  }

  const tombstonePath = `/tmp/removed-audio-${Date.now()}.json`;
  await writeFile(
    tombstonePath,
    JSON.stringify(
      {
        removedAt: new Date().toISOString(),
        reason: 'file does not decode; unplayable in a browser',
        keys: rows.map((r) => r.storage_key),
      },
      null,
      1
    )
  );
  log(`  tombstone written                  ${tombstonePath}`);

  let removed = 0;
  for (const row of rows) {
    await db.query(`delete from audio where id = $1`, [Number(row.id)]);
    removed += 1;
  }
  log(`  recordings removed                 ${removed}`);
  return { matched: rows.length, removed, tombstonePath };
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')
    ? process.argv[i + 1]!
    : null;
}

async function main(): Promise<void> {
  const scanPath = arg('scan');
  if (!scanPath && !arg('remove-keys')) {
    console.error(
      'Usage:\n' +
        '  audio-review.ts --scan <scan.json> [--report <out.csv>] [--remove gross --confirm]\n' +
        '  audio-review.ts --remove-keys <keys.json> [--confirm]   (unplayable files)'
    );
    process.exitCode = 1;
    return;
  }
  try {
    const keysFile = arg('remove-keys');
    if (keysFile) {
      const parsed = JSON.parse(await readFile(keysFile, 'utf8')) as
        | string[]
        | { keys?: string[]; unplayable?: { file: string }[] };
      const keys = Array.isArray(parsed)
        ? parsed
        : (parsed.keys ?? (parsed.unplayable ?? []).map((r) => r.file));
      const result = await removeByStorageKeys(keys, {
        confirm: process.argv.includes('--confirm'),
      });
      console.log(
        `\n  matched ${result.matched}, removed ${result.removed}` +
          `${result.tombstonePath ? `, tombstone ${result.tombstonePath}` : ''}\n`
      );
      return;
    }

    if (!scanPath) return;  // the usage message above already covered this
    const report = await reviewAudio({
      scanPath,
      reportPath: arg('report'),
      removeTier: arg('remove'),
      confirm: process.argv.includes('--confirm'),
    });
    console.log(`\n  done in ${formatMs(report.durationMs)}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && process.argv[1].endsWith('audio-review.ts')) {
  main().catch((error) => {
    console.error('\nFailed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
