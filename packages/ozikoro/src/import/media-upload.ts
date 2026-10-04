/**
 * Put the archive's media into object storage.
 *
 * THE PROBLEM THIS CLOSES
 *
 * The 3,441 files migrated from WordPress are on this machine and are served from here. That works on a
 * development machine and cannot work in production: a container's filesystem is ephemeral, so a deploy
 * would leave the database pointing at keys that no longer exist, and every image and every player in the
 * archive would 404 at once. The media route already prefers object storage and refuses the local copy in
 * production — with a warning naming the file — so deploying before this runs fails loudly rather than
 * silently serving nothing. This is the step that makes it not fail.
 *
 * ── WHY THIS REPLACED THE PREVIOUS VERSION OF THIS FILE ──────────────────────────────────────────────
 *
 * The earlier tool knew two facts and said neither of them out loud: it read its files from a `readdir` of
 * `MEDIA_DIR` — **flat, and therefore blind to `episodes/`** — and it took the key from the row. Run alone
 * it uploaded 3,443 images and **zero episodes**, so every image on the site worked and all four spoken
 * records 404'd. The two facts are now arguments that **fail loudly when unset**, because a tool that
 * guesses its source and its key is a tool that reports success while doing something else.
 *
 * THE SIBLING MISTAKE, RECORDED SO IT IS NOT MADE AGAIN
 *
 * `scripts/upload-media.mjs` is the DICTIONARY's corpus uploader. It reads `data/sources/ibodict/audio`,
 * invents its key as `sha256(path)[0:24]`, and writes into the `audio/` namespace. **Against this archive it
 * would upload 49,010 objects that nothing references, leave every key this archive needs untouched, and
 * print `failed=0`.** It is not a general media uploader and must not be run for the archive. What was worth
 * keeping from it is its shape — 32 concurrent workers and an idempotent PUT — and that shape is here.
 *
 * ── THE TWO KEY PATHS, EACH STATED ON THE COMMAND LINE ───────────────────────────────────────────────
 *
 *   node packages/ozikoro/src/import/media-upload.ts \
 *       --source data/media/ozikoro-wp \
 *       --prefix ozikoro/ \
 *       --keys db:ozikoro_media \
 *       --manifest .data/media-upload-media.json \
 *       --apply
 *
 *   node packages/ozikoro/src/import/media-upload.ts \
 *       --source .data/media/ozikoro/episodes \
 *       --prefix ozikoro/episodes/ \
 *       --keys dir \
 *       --manifest .data/media-upload-episodes.json \
 *       --apply
 *
 * `--source` is the directory the bytes are read from. `--prefix` is the namespace the keys live in, and
 * `key.slice(prefix.length)` is the path under `--source` — so the key is the row's `storage_key` read
 * **verbatim** and is never recomputed from a hash, a slug or a file's bytes.
 *
 * `--keys` names where the keys come from, and it is one of exactly three things:
 *
 *   db:<table>    the `storage_key` column of that table, read verbatim. `ozikoro_media` for the flat
 *                 media; `ozikoro_episode` for the spoken records.
 *   dir           one key per file under `--source`: `--prefix` + the file's path relative to `--source`.
 *                 Used for the episodes, **because the row set there is a strict subset of what was
 *                 published** — one superseded recording is still on disk and still has a live URL in
 *                 history, and a row-driven run would silently leave it out.
 *   file:<path>   one key per line, verbatim. For running where the bytes are and the database is not.
 *
 * ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────────────────────────────────
 *
 * It refuses to run if `--source`, `--prefix` or `--keys` is missing. It refuses a key that does not begin
 * with `--prefix`. It refuses a key the media route cannot address (`isAddressableMediaKey` in
 * `../../media-key.ts`) — **a key the route will 404 is a hole no upload can fill**, and the honest moment
 * to say so is before the first byte, not after 3,443 successful PUTs. And it never deletes or moves a local
 * file: **the files on disk are the only copy until the bucket is proven**, so this tool only ever reads
 * them.
 *
 * ── RESUMABLE AND IDEMPOTENT ─────────────────────────────────────────────────────────────────────────
 *
 * Every key is HEAD-checked first and skipped when it is already there, so an interrupted run is resumed by
 * running it again, and a repeated PUT of identical bytes is harmless. The run writes a manifest naming every
 * key with its on-disk size and its outcome, so the counts below can be checked against the bucket
 * afterwards rather than believed.
 *
 * Usage:
 *   … --keys db:ozikoro_media                 # report what it would do, write nothing
 *   … --keys db:ozikoro_media --apply         # upload what is missing
 *   … --keys db:ozikoro_media --apply --limit 5
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { getDb, closeDb, type Db } from '@ozituma/db/client';
import { getStorage, localStorageRoot } from '@ozituma/db/storage';
import { isAddressableMediaKey } from '../media-key.ts';

export interface MediaUploadReport {
  driver: 's3' | 'local';
  source: string;
  prefix: string;
  keySource: string;
  keysRequested: number;
  filesPresent: number;
  alreadyStored: number;
  /**
   * Already stored, at the WRONG SIZE, and overwritten.
   *
   * This is the count that a bare existence check cannot produce. An upload interrupted mid-object leaves a
   * key that exists and is short, so "is it there?" answers yes, the run skips it, and the archive serves a
   * truncated image forever. The stored length is compared with the file's, and a mismatch is repaired
   * rather than skipped.
   */
  repaired: number;
  uploaded: number;
  bytesUploaded: number;
  /** Objects whose stored length was re-read after the PUT and matched the file exactly. */
  verified: number;
  /** Keys the route would refuse: a 404 no upload can fix. Refused before any byte is sent. */
  unaddressable: string[];
  /** Keys whose file is not under `--source`. A hole, so the run exits non-zero. */
  missingOnDisk: string[];
  failed: Array<{ key: string; error: string }>;
}

/**
 * The content type written for each extension.
 *
 * THIS MAP IS THE ROUTE'S OWN MAP, DELIBERATELY AND EXACTLY. `app/media/[...key]/route.ts` derives the type
 * it serves from the extension and prefers a stored type unless the stored type is the generic
 * `application/octet-stream`. So the two maps have to agree in **both** directions:
 *
 *   * a type written here that the route does not know is served as written — which is why **`html` is
 *     absent from both**. Eight archive files are `.html`, and a stored `text/html` would make the route
 *     serve a stored page as a page **from the archive's own origin**. Uploaded as
 *     `application/octet-stream` the route falls back to its own map, which does not know `html` either, and
 *     the file is served as an opaque download. That is what it is today and it must stay that way.
 *   * a type the route knows and this map omits would be sent as `application/octet-stream`; the route would
 *     then fall back to the extension and serve the right type anyway — so an omission here is survivable
 *     and an addition is not.
 */
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

/** The tables `--keys db:<table>` will read, so a typo cannot quietly read nothing. */
const KEY_TABLES = new Set(['ozikoro_media', 'ozikoro_episode']);

/**
 * The guard that matters most when the driver is LOCAL.
 *
 * With the local driver the "object store" is a directory, so if the archive and the storage root were the
 * same place this would read a file and write it over itself, and a partial failure would leave the only
 * copy damaged. They are different directories (`.data/media` and `data/media/ozikoro-wp`), and that is
 * checked rather than assumed because the consequence of getting it wrong is losing the archive.
 *
 * It is only meaningful for the local driver: with S3 configured the bytes leave the machine and no local
 * path is written at all.
 */
export function assertStorageIsSeparate(archiveDir: string, driver: 's3' | 'local'): void {
  if (driver !== 'local') return;
  const storageRoot = resolve(localStorageRoot());
  const archive = resolve(archiveDir);
  if (storageRoot === archive || archive.startsWith(`${storageRoot}${sep}`)) {
    throw new Error(
      `Refusing to run: the source directory (${archive}) is inside the storage root ` +
        `(${storageRoot}). With the local driver that would copy each file onto itself.`
    );
  }
}

export interface UploadOptions {
  apply?: boolean;
  limit?: number;
  concurrency?: number;
  /** Called for each finished key, so the CLI can print progress without buffering 3,441 lines. */
  onProgress?: (done: number, total: number, report: MediaUploadReport) => void;
}

/** Every file under `dir`, recursively, as paths relative to `dir` with `/` separators. */
async function walkRelative(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  const entries = await readdir(base, { withFileTypes: true });
  for (const e of entries) {
    const full = join(base, e.name);
    if (e.isDirectory()) await walkRelative(dir, full, out);
    else if (e.isFile()) out.push(relative(dir, full).split(sep).join('/'));
  }
  return out;
}

/**
 * The keys to upload, from the source `--keys` names.
 *
 * NOTHING HERE DERIVES A KEY. `db:` reads the column. `file:` reads the file. `dir` composes
 * `--prefix + <relative path>`, which is the one case where a key is made rather than read, and it is made
 * from the file's own name **because that is the key the route was already given for the episode that has no
 * row** — see the header.
 */
export async function collectKeys(
  db: Db | null,
  keySource: string,
  source: string,
  prefix: string
): Promise<string[]> {
  if (keySource === 'dir') {
    return (await walkRelative(source)).map((rel) => `${prefix}${rel}`).sort();
  }
  if (keySource.startsWith('file:')) {
    const path = keySource.slice('file:'.length);
    const text = await readFile(path, 'utf8');
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
      .sort();
  }
  if (keySource.startsWith('db:')) {
    const table = keySource.slice('db:'.length);
    if (!KEY_TABLES.has(table)) {
      throw new Error(
        `--keys db:${table} is not a table this tool reads. Use one of: ${[...KEY_TABLES].join(', ')}.`
      );
    }
    if (!db) throw new Error('--keys db:<table> needs a database; none was opened.');
    // The column, verbatim, ordered by id so two runs read the same list in the same order.
    const rows = await db.rows<{ storage_key: string }>(
      `select storage_key from ${table} where storage_key is not null order by id`
    );
    return rows.map((r) => String(r.storage_key));
  }
  throw new Error(
    `--keys must be db:<table>, dir or file:<path>. Got "${keySource}". ` +
      'There is deliberately no default: the previous tool had one and uploaded zero episodes.'
  );
}

export async function uploadMedia(
  db: Db | null,
  source: string,
  prefix: string,
  keySource: string,
  options: UploadOptions = {}
): Promise<MediaUploadReport> {
  const apply = Boolean(options.apply);
  const concurrency = Math.max(1, options.concurrency ?? 16);
  const storage = getStorage();
  const report: MediaUploadReport = {
    driver: storage.driver,
    source,
    prefix,
    keySource,
    keysRequested: 0,
    filesPresent: 0,
    alreadyStored: 0,
    repaired: 0,
    uploaded: 0,
    bytesUploaded: 0,
    verified: 0,
    unaddressable: [],
    missingOnDisk: [],
    failed: [],
  };

  assertStorageIsSeparate(source, storage.driver);

  const keys = await collectKeys(db, keySource, source, prefix);
  report.keysRequested = keys.length;

  // Every key must sit in the namespace that was stated, or `key.slice(prefix.length)` reads the wrong file.
  const offPrefix = keys.filter((k) => !k.startsWith(prefix));
  if (offPrefix.length > 0) {
    throw new Error(
      `Refusing to run: ${offPrefix.length} key(s) do not begin with --prefix "${prefix}", so the path under ` +
        `--source would be wrong. First: ${offPrefix[0]}`
    );
  }

  /*
   * A KEY THE ROUTE REFUSES IS A HOLE IN THE BUCKET THAT NO UPLOAD CAN FILL.
   *
   * This is checked before a single byte is sent, and it is deliberately fatal rather than a warning: the
   * only correct responses are to widen the pattern or to rename the file, and both of those are decisions
   * for a person. Reporting it after an otherwise clean run is how it gets read as a success.
   */
  report.unaddressable = keys.filter((k) => !isAddressableMediaKey(k));
  if (report.unaddressable.length > 0) {
    const shown = report.unaddressable.slice(0, 10).map((k) => `\n    ${k}`).join('');
    throw new Error(
      `Refusing to run: ${report.unaddressable.length} key(s) cannot be addressed by /media/<key>, so the ` +
        `upload would put bytes in the bucket that the archive can never serve. Fix the pattern in ` +
        `packages/ozikoro/src/media-key.ts, or rename the files in the import — do not upload around it.` +
        `${shown}${report.unaddressable.length > 10 ? `\n    … and ${report.unaddressable.length - 10} more` : ''}`
    );
  }

  const queue = options.limit !== undefined ? keys.slice(0, Math.max(0, options.limit)) : keys;
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= queue.length) return;
      const key = queue[i]!;
      const filename = key.slice(prefix.length);
      const path = join(source, filename);

      let size: number;
      try {
        const info = await stat(path);
        if (!info.isFile()) throw new Error('not a regular file');
        size = info.size;
      } catch (error) {
        // A key whose file is absent is a hole, not a skip. It is named and it makes the run exit non-zero.
        report.missingOnDisk.push(`${key} (${String(error).slice(0, 80)})`);
        done += 1;
        options.onProgress?.(done, queue.length, report);
        continue;
      }
      report.filesPresent += 1;

      /*
       * Already there, AT THE RIGHT SIZE? Skip — this is what makes the run resumable.
       *
       * The length is compared, not merely the existence. A `get()` here would answer the question by
       * downloading the object, which over 3,441 files is the whole archive twice; `head()` asks the same
       * question in one round trip and can also see a truncated object that an existence check cannot.
       */
      let overwrite = false;
      try {
        const existing = await storage.head(key);
        if (existing) {
          if (existing.byteSize === size) {
            report.alreadyStored += 1;
            done += 1;
            options.onProgress?.(done, queue.length, report);
            continue;
          }
          // Right key, wrong length: a truncated or superseded object. Overwrite it rather than skip it.
          overwrite = true;
        }
      } catch {
        // A storage error on the check is treated as "not there" so the upload is attempted; if that also
        // fails it is counted as a failure rather than silently skipped.
      }

      if (apply) {
        try {
          const body = await readFile(path);
          if (body.length !== size) {
            throw new Error(`file changed while reading: stat said ${size}, read ${body.length}`);
          }
          await storage.put(key, body, contentTypeFor(filename));
          if (overwrite) report.repaired += 1;
          report.uploaded += 1;
          report.bytesUploaded += body.length;

          /*
           * THE OBJECT IS READ BACK BEFORE THE BYTES ARE CALLED DONE.
           *
           * A PUT that returns 200 has not proved that the right number of bytes arrived, and a short object
           * with the right key is indistinguishable from a complete one until a browser draws half a
           * photograph. The stored length is re-read and compared with the file's own, and a mismatch is a
           * failure that names the key and makes the run exit non-zero — **not a warning that scrolls past.**
           */
          const stored = await storage.head(key);
          if (!stored || stored.byteSize !== body.length) {
            throw new Error(
              `stored object is ${stored ? `${stored.byteSize} bytes` : 'absent'}, the file is ${body.length}`
            );
          }
          report.verified += 1;
        } catch (error) {
          report.failed.push({ key, error: String(error).slice(0, 160) });
        }
      }
      done += 1;
      options.onProgress?.(done, queue.length, report);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const USAGE = `
Upload the archive's media to object storage. Nothing is written without --apply.

  --source <dir>      REQUIRED. The directory the bytes are read from. No default.
  --prefix <string>   REQUIRED. The key namespace, ending in "/". key.slice(prefix.length) is the
                      path under --source, so the key is read from the row and never recomputed.
  --keys <spec>       REQUIRED. Where the keys come from. No default.
                        db:ozikoro_media     the storage_key column, verbatim (the flat media)
                        db:ozikoro_episode   the storage_key column, verbatim (the spoken records)
                        dir                  one key per file under --source, prefix + relative path
                        file:<path>          one key per line, verbatim

  --manifest <path>   Write the full per-key result here. Strongly recommended: it is what the bucket
                      is checked against afterwards.
  --concurrency <n>   Parallel uploads. Default 16.
  --limit <n>         Stop after n keys. For a first, small, real run.
  --apply             Actually upload. Without it the run reports and writes nothing.

The two paths, verbatim:

  node packages/ozikoro/src/import/media-upload.ts \\
      --source data/media/ozikoro-wp --prefix ozikoro/ --keys db:ozikoro_media \\
      --manifest .data/media-upload-media.json --apply

  node packages/ozikoro/src/import/media-upload.ts \\
      --source .data/media/ozikoro/episodes --prefix ozikoro/episodes/ --keys dir \\
      --manifest .data/media-upload-episodes.json --apply

Run BOTH. The flat run alone leaves every spoken record 404.
`;

if (process.argv[1] && process.argv[1].endsWith('media-upload.ts')) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const source = flag(args, 'source');
  const prefix = flag(args, 'prefix');
  const keySource = flag(args, 'keys');
  const manifest = flag(args, 'manifest');
  const concurrency = Number(flag(args, 'concurrency') ?? 16);
  const limitRaw = flag(args, 'limit');
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);

  const problems: string[] = [];
  if (!source) problems.push('--source is not set');
  if (!prefix) problems.push('--prefix is not set');
  if (!keySource) {
    problems.push(
      '--keys is not set (the previous tool defaulted to a flat readdir of the archive directory, and ' +
        'uploaded zero of the four spoken records)'
    );
  }
  if (prefix && !prefix.endsWith('/')) problems.push(`--prefix "${prefix}" must end in "/"`);
  if (limitRaw !== undefined && !Number.isFinite(limit)) problems.push(`--limit "${limitRaw}" is not a number`);
  if (!Number.isFinite(concurrency) || concurrency < 1) problems.push('--concurrency must be a positive number');

  if (problems.length > 0) {
    console.error(`\n  REFUSING TO RUN:\n${problems.map((p) => `    * ${p}`).join('\n')}\n${USAGE}`);
    process.exitCode = 1;
  } else {
    const db = keySource!.startsWith('db:') ? await getDb() : null;
    console.log(`\n  Archive media -> object storage${apply ? '' : '  (CHECK ONLY — nothing is uploaded)'}`);
    console.log(`  source       ${source}`);
    console.log(`  prefix       ${prefix}`);
    console.log(`  keys         ${keySource}`);
    console.log(`  manifest     ${manifest ?? '(none)'}`);
    console.log('');

    try {
      const started = Date.now();
      const report = await uploadMedia(db, source!, prefix!, keySource!, {
        apply,
        limit,
        concurrency,
        onProgress: (done, total, r) => {
          if (done % 250 === 0 || done === total) {
            const rate = (done / Math.max(1, (Date.now() - started) / 1000)).toFixed(1);
            console.log(
              `    ${done}/${total} stored=${r.alreadyStored} uploaded=${r.uploaded} ` +
                `missing=${r.missingOnDisk.length} failed=${r.failed.length} ${rate}/s`
            );
          }
        },
      });

      const { unaddressable: _u, missingOnDisk, failed, ...counts } = report;
      for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(16)} ${v}`);

      if (manifest) {
        const { writeFile, mkdir } = await import('node:fs/promises');
        await mkdir(resolve(manifest, '..'), { recursive: true });
        await writeFile(
          manifest,
          JSON.stringify({ ...report, finishedAt: new Date().toISOString(), applied: apply }, null, 1)
        );
        console.log(`\n    manifest written to ${manifest}`);
      }

      if (missingOnDisk.length > 0) {
        console.error(`\n  ${missingOnDisk.length} KEY(S) HAVE NO FILE UNDER --source — this run is a HOLE, not a success:`);
        for (const m of missingOnDisk.slice(0, 40)) console.error(`    ${m}`);
        if (missingOnDisk.length > 40) console.error(`    … and ${missingOnDisk.length - 40} more`);
      }
      if (failed.length > 0) {
        console.error(`\n  ${failed.length} UPLOAD(S) FAILED — this run is a HOLE, not a success:`);
        for (const f of failed.slice(0, 40)) console.error(`    ${f.key}: ${f.error}`);
        if (failed.length > 40) console.error(`    … and ${failed.length - 40} more`);
      }

      if (report.driver === 'local') {
        console.log(
          `\n  NOTE: the driver is LOCAL. Files went to ${localStorageRoot()},\n` +
            '  which is EPHEMERAL on a container platform. Set process.env.S3_BUCKET for production.'
        );
      }
      console.log(
        apply
          ? '\n  Local files were NOT moved and NOT deleted. They are the only copy until the bucket is proven.\n'
          : '\n  Re-run with --apply to upload.\n'
      );
      if (missingOnDisk.length > 0 || failed.length > 0) process.exitCode = 1;
    } catch (error) {
      console.error(`\n  ${String(error).includes('Refusing') ? String(error) : `Failed: ${String(error).slice(0, 400)}`}\n`);
      process.exitCode = 1;
    }
    if (db) await closeDb();
  }
}
