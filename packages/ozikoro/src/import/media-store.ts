/**
 * Record which media files the archive actually holds.
 *
 * The extraction downloads each file to `data/media/ozikoro-wp/<wpId>-<name>`. Until this runs, every
 * media row still points at `ozikoro.com/wp-content/uploads/...`, so the new archive's images depend
 * on the old WordPress site staying up. This walks the rows, checks which files are on disk, and sets
 * `storage_key` on those — which is the single value the pages and the media route key off.
 *
 * It is deliberately per-file and resumable: the download runs for a long time and may be interrupted,
 * so a media row is switched over the moment its file exists rather than waiting for the last one.
 * Re-running is safe and idempotent.
 *
 * It does NOT upload anything. Uploading to object storage is a separate step that needs credentials,
 * and mixing "which files do we have" with "where are they hosted" would make the first question
 * unanswerable without the second.
 *
 * Usage:
 *   node src/import/media-store.ts --check
 *   node src/import/media-store.ts --apply
 */
import { readdir } from 'node:fs/promises';
import { getDb, closeDb, type Db } from '@ozituma/db/client';
import { MEDIA_DIR } from './wordpress.ts';

export interface MediaStoreReport {
  rowsChecked: number;
  filesOnDisk: number;
  linked: number;
  alreadyLinked: number;
  missing: number;
  /** Files that were on disk under a different name than their source URL suggests. */
  renamed: number;
}

/** The key a file is addressed by. `ozikoro/<wpId>-<filename>`, matching the media route's pattern. */
export function mediaKey(wpMediaId: number, filename: string): string {
  return `ozikoro/${wpMediaId}-${filename}`;
}

export async function linkDownloadedMedia(
  db: Db,
  options: { apply?: boolean } = {}
): Promise<MediaStoreReport> {
  const apply = Boolean(options.apply);
  const report: MediaStoreReport = { rowsChecked: 0, filesOnDisk: 0, linked: 0, alreadyLinked: 0, missing: 0, renamed: 0 };

  // One directory read rather than a `stat` per row: 3,488 filesystem calls to answer a question one
  // directory listing already answers.
  let onDisk: Set<string>;
  try {
    onDisk = new Set(await readdir(MEDIA_DIR));
  } catch {
    // The directory does not exist yet, which is the honest state before the first download.
    onDisk = new Set();
  }
  report.filesOnDisk = onDisk.size;

  /*
   * Which file on disk belongs to which media id.
   *
   * The URL's basename is NOT a reliable name for the file: WordPress stores an attachment under
   * whatever it was uploaded as, and the URL it serves may be a scaled or renamed variant. Measured
   * on this archive, media 670 has a source URL ending
   * `Ancient_City_Gates_of_Kano_Ƙofar_Gadon_Ƙaya.jpg` and is on disk as `670-igbo-warriors.jpeg`.
   * Matching on the URL basename therefore missed files that were sitting right there.
   *
   * Every downloaded file is named `<wpId>-<name>`, and the id is unique, so the id prefix alone
   * identifies the file. This index is built from the directory listing once.
   */
  const fileById = new Map<number, string>();
  for (const name of onDisk) {
    const match = /^(\d+)-/.exec(name);
    if (match) fileById.set(Number(match[1]), name);
  }

  const rows = await db.rows<{ id: string; wp_media_id: number; source_url: string | null; storage_key: string | null }>(
    `select id, wp_media_id, source_url, storage_key from ozikoro_media where wp_media_id is not null order by wp_media_id`
  );

  for (const row of rows) {
    report.rowsChecked += 1;
    if (row.storage_key) {
      report.alreadyLinked += 1;
      continue;
    }

    const wpId = Number(row.wp_media_id);
    const filename = decodeURIComponent((row.source_url ?? '').split('/').pop() ?? '');

    // The exact `<id>-<url basename>` first, then whatever file carries this id. The second case is
    // the renamed one, and the key still records the URL's basename so the address stays meaningful.
    const exact = filename ? `${wpId}-${filename}` : '';
    const diskName = onDisk.has(exact) ? exact : fileById.get(wpId);
    if (!diskName || !filename) {
      report.missing += 1;
      continue;
    }
    if (diskName !== exact) report.renamed += 1;

    if (apply) {
      await db.query(`update ozikoro_media set storage_key = $2, updated_at = now() where id = $1`, [
        Number(row.id),
        mediaKey(wpId, filename),
      ]);
    }
    report.linked += 1;
  }

  return report;
}

if (process.argv[1] && process.argv[1].endsWith('media-store.ts')) {
  const apply = process.argv.includes('--apply');
  const db = await getDb();
  console.log(`\n  Linking downloaded media${apply ? '' : ' (check only, nothing is written)'}`);
  console.log(`  Archive directory: ${MEDIA_DIR}\n`);

  const report = await linkDownloadedMedia(db, { apply });
  for (const [k, v] of Object.entries(report)) console.log(`    ${k.padEnd(16)} ${v}`);

  if (!apply) console.log('\n  Re-run with --apply to record these.\n');
  await closeDb();
}
