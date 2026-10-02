/**
 * Fetch the media records that have no file on disk.
 *
 * THE GAP
 *
 * The archive holds 3,488 media rows and 3,437 files. **Fifty-one records name a file that was never
 * written**, so any page that lists them links to a 404 — and a reader cannot tell a missing file from a
 * broken archive.
 *
 * WHY IT HAPPENED
 *
 * The original import walked the WordPress media API and recorded every item it saw, downloading as it went.
 * **The API reports items whose file it will not serve** — the ones with non-ASCII names it sanitised on
 * upload, as this file has recorded before — so the row exists and the bytes do not.
 *
 * WHAT THIS DOES
 *
 * For each record with no file, fetch `source_url` and write it. **A record whose fetch fails keeps its row
 * and gains an explicit marker**, so the page can say the file is not held rather than offering a download
 * that does not work.
 *
 * IT IS SAFE TO RE-RUN: a record whose file exists is skipped without a request.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, closeDb } from '@ozituma/db/client';

/*
 * THE KEY HAS A PREFIX AND THE DISK DOES NOT.
 *
 * `storage_key` is `ozikoro/11231-umunede-king.jpeg`; the files live at `data/media/ozikoro-wp/11231-…`, with
 * the prefix STRIPPED — which is exactly what `app/media/[...key]/route.ts` does before reading. **The first
 * version of this script joined the key as given, found all 3,437 files "missing" and re-downloaded 803 MB
 * into `data/media/ozikoro-wp/ozikoro/`, duplicating the collection while reporting success.**
 *
 * A migration script that misreads its own layout does not fail — **it does the wrong thing confidently**, and
 * the only reason this was caught is that the number was absurd.
 */
const ROOT = join(process.cwd(), 'data', 'media', 'ozikoro-wp');
/** Where a key actually points on disk: the `ozikoro/` prefix is not part of the local layout. */
const diskName = (key: string) => key.replace(/^ozikoro\//, '');
const UA = 'OzikoroArchiveImporter/1.0 (+https://ozikoro.com; contact hello@ozikoro.com)';

const db = await getDb();
const rows = await db.rows<{ id: number; storage_key: string; source_url: string | null; mime_type: string | null }>(
  `select id, storage_key, source_url, mime_type from ozikoro_media where storage_key is not null`
);

const missing = rows.filter((r) => !existsSync(join(ROOT, diskName(r.storage_key))));
console.log(`  media rows            ${rows.length}`);
console.log(`  with no file on disk  ${missing.length}`);

let got = 0, failed = 0, bytes = 0;
for (const m of missing) {
  if (!m.source_url) { failed += 1; continue; }
  const dest = join(ROOT, diskName(m.storage_key));
  try {
    await mkdir(join(dest, '..'), { recursive: true });
    const res = await fetch(m.source_url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new Error('empty');
    await writeFile(dest, buf);
    const size = (await stat(dest)).size;
    bytes += size;
    await db.query(
      `update ozikoro_media
          set mime_type = coalesce($2, mime_type), filesize_bytes = $3, rights_note = null
        where id = $1`,
      [m.id, res.headers.get('content-type')?.split(';')[0] ?? null, size]
    );
    got += 1;
  } catch (error) {
    failed += 1;
    // The row stays — the record is real even when the file is gone — and the note is how a page can say so
    // rather than offering a download that 404s.
    await db.query(
      `update ozikoro_media set rights_note = $2 where id = $1`,
      [m.id, 'The archive holds this record; the file itself could not be retrieved.']
    );
    if (failed <= 6) console.log(`  FAILED ${m.storage_key.slice(-52)}  ${String(error).slice(0, 40)}`);
  }
}
console.log(`  fetched               ${got}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  failed, marked        ${failed}`);

const left = rows.filter((r) => !existsSync(join(ROOT, diskName(r.storage_key)))).length;
console.log(`  still without a file  ${left}`);
await closeDb();
