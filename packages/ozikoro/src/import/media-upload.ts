/**
 * Put the archive's media into object storage.
 *
 * THE PROBLEM THIS CLOSES
 *
 * The 3,488 files migrated from WordPress are on disk in `data/media/ozikoro-wp/` and are served
 * from there. That works on a development machine and cannot work in production: a container's
 * filesystem is ephemeral, so a deploy would leave the database pointing at keys that no longer
 * exist, and every image in the archive would 404 at once. The media route already prefers object
 * storage and refuses the local copy in production — with a warning naming the file — so deploying
 * before this runs fails loudly rather than silently serving nothing. This is the step that makes it
 * not fail.
 *
 * WHY IT GOES THROUGH `getStorage()` RATHER THAN COPYING FILES
 *
 * `getStorage()` is what uploads and what the serving route reads through. Using it here means the
 * local run exercises the same code path as production; only the driver differs. A script that copied
 * files into a directory itself would prove nothing about whether S3 works.
 *
 * RESUMABLE AND IDEMPOTENT
 *
 * It asks storage whether each key is already there and skips it. 3,488 files is a long run that may
 * be interrupted, and re-running must not re-upload what is already done.
 *
 * Usage:
 *   node src/import/media-upload.ts --check          # report, write nothing
 *   node src/import/media-upload.ts --apply          # upload everything missing
 *   node src/import/media-upload.ts --apply --limit 5
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getDb, closeDb, type Db } from '@ozituma/db/client';
import { getStorage, localStorageRoot } from '@ozituma/db/storage';
import { MEDIA_DIR } from './wordpress.ts';

export interface MediaUploadReport {
  driver: 's3' | 'local';
  rowsWithKey: number;
  filesPresent: number;
  alreadyStored: number;
  uploaded: number;
  bytesUploaded: number;
  missingOnDisk: number;
  failed: number;
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
};

export function contentTypeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * The guard that matters most.
 *
 * If the archive directory and the storage root were the same place, this would read a file and write
 * it over itself, and a partial failure would leave the only copy damaged. They are different
 * directories today (`.data/media` vs `data/media/ozikoro-wp`), and that is checked rather than
 * assumed because the consequence of getting it wrong is losing the archive.
 */
export function assertStorageIsSeparate(archiveDir: string = MEDIA_DIR): void {
  const storageRoot = resolve(localStorageRoot());
  const archive = resolve(archiveDir);
  if (storageRoot === archive || archive.startsWith(`${storageRoot}/`)) {
    throw new Error(
      `Refusing to run: the archive directory (${archive}) is inside the storage root ` +
        `(${storageRoot}). Uploading would copy each file onto itself.`
    );
  }
}

export async function uploadMedia(
  db: Db,
  options: { apply?: boolean; limit?: number } = {}
): Promise<MediaUploadReport> {
  const apply = Boolean(options.apply);
  const storage = getStorage();
  const report: MediaUploadReport = {
    driver: storage.driver, rowsWithKey: 0, filesPresent: 0, alreadyStored: 0,
    uploaded: 0, bytesUploaded: 0, missingOnDisk: 0, failed: 0,
  };

  assertStorageIsSeparate();

  let onDisk: Set<string>;
  try {
    onDisk = new Set(await readdir(MEDIA_DIR));
  } catch {
    onDisk = new Set();
  }

  const rows = await db.rows<{ storage_key: string }>(
    `select storage_key from ozikoro_media where storage_key is not null order by id`
  );

  for (const row of rows) {
    if (options.limit !== undefined && report.uploaded >= options.limit) break;
    report.rowsWithKey += 1;

    const key = String(row.storage_key);
    const filename = key.slice('ozikoro/'.length);
    if (!onDisk.has(filename)) {
      report.missingOnDisk += 1;
      continue;
    }
    report.filesPresent += 1;

    // Already there? Skip. This is what makes the run resumable.
    try {
      const existing = await storage.get(key);
      if (existing) {
        report.alreadyStored += 1;
        continue;
      }
    } catch {
      // A storage error on the check is treated as "not there" so the upload is attempted; if that
      // also fails it is counted as a failure rather than silently skipped.
    }

    if (!apply) continue;

    try {
      const path = join(MEDIA_DIR, filename);
      const info = await stat(path);
      const body = await readFile(path);
      await storage.put(key, body, contentTypeFor(filename));
      report.uploaded += 1;
      report.bytesUploaded += info.size;
    } catch (error) {
      report.failed += 1;
      console.error(`[media-upload] ${key}: ${String(error).slice(0, 160)}`);
    }
  }

  return report;
}

if (process.argv[1] && process.argv[1].endsWith('media-upload.ts')) {
  const apply = process.argv.includes('--apply');
  const limitIndex = process.argv.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : undefined;
  const db = await getDb();

  console.log(`\n  Media -> object storage${apply ? '' : ' (check only, nothing is uploaded)'}`);
  console.log(`  Source: ${MEDIA_DIR}\n`);

  try {
    const report = await uploadMedia(db, { apply, limit: Number.isFinite(limit) ? limit : undefined });
    for (const [k, v] of Object.entries(report)) console.log(`    ${k.padEnd(16)} ${v}`);

    if (report.driver === 'local') {
      console.log(
        '\n  NOTE: the driver is LOCAL. Files went to ' + localStorageRoot() + ',\n' +
        '  which is EPHEMERAL on a container platform. Set S3_BUCKET for production.'
      );
    }
    if (!apply) console.log('\n  Re-run with --apply to upload.\n');
  } catch (error) {
    console.error(`\n  ${String(error).includes('Refusing') ? String(error) : `Failed: ${String(error).slice(0, 200)}`}\n`);
    process.exitCode = 1;
  }
  await closeDb();
}
