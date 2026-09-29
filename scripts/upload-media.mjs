/*
 * Upload the corpus recordings to R2 in parallel.
 *
 *   node scripts/upload-media.mjs
 *
 * The importers write media through the storage driver, but their loop is
 * `await storage.put(...)` inside a sequential for — about one file a second,
 * roughly six hours for the full corpus. The storage key is deterministic
 * (sha256 of the repo-relative path, first 24 hex characters), so the same
 * objects can be written concurrently without coordinating with an importer, and
 * a repeated PUT of an identical object is harmless. This is the 32-worker
 * version: ~50 files a second, 49,010 objects, zero failures.
 *
 * It exists because production had 46,419 audio rows and an empty bucket — the
 * records had been moved across without the media. See docs/DATA-SOURCES.md.
 *
 * Reads the corpus from data/sources/ibodict/audio and credentials from the
 * environment (S3_*), so run it where those live: inside the production image,
 * with the source directory mounted.
 */
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { readdir, readFile, stat } = require('node:fs/promises');
const { join, relative, extname, sep } = require('node:path');
const { createHash } = require('node:crypto');

const ROOT = '/app/data/sources/ibodict/audio';
/*
 * Each repo writes to its own key namespace, and the two importers disagree on
 * which is which — reading both only from the corpus namespace left every
 * sentence recording pointing at a key that was never written:
 *
 *   ibodict.ts   AUDIO_REPO_DIR = nkowaokwu/ibo-dict          -> corpus/
 *   examples.ts  AUDIO_REPO_DIR = nkowaokwu/ibo-dict-expansion -> examples/
 */
const REPOS = [
  { dir: 'nkowaokwu/ibo-dict', namespace: 'corpus' },
  { dir: 'nkowaokwu/ibo-dict-expansion', namespace: 'examples' },
];
const CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY || 32);

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE) === 'true',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function keyFor(sourcePath, namespace) {
  const digest = createHash('sha256').update(sourcePath).digest('hex').slice(0, 24);
  const ext = extname(sourcePath).toLowerCase() || '.mp3';
  return `audio/ibo/${namespace}/${digest}${ext}`;
}

async function main() {
const files = [];
for (const repo of REPOS) {
  const dir = join(ROOT, repo.dir);
  for (const f of await walk(dir)) {
    files.push({ path: f, key: keyFor(relative(dir, f).split(sep).join('/'), repo.namespace) });
  }
}
console.log(`local recordings: ${files.length}`);

let done = 0, uploaded = 0, skipped = 0, failed = 0;
let next = 0;
const started = Date.now();

async function worker() {
  while (true) {
    const i = next++;
    if (i >= files.length) return;
    const { path, key } = files[i];
    try {
      // Skip what is already there, so a re-run is cheap.
      await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      skipped++;
    } catch {
      try {
        const body = await readFile(path);
        await s3.send(new PutObjectCommand({
          Bucket: process.env.S3_BUCKET, Key: key, Body: body,
          ContentType: key.endsWith('.webm') ? 'audio/webm' : 'audio/mpeg',
        }));
        uploaded++;
      } catch (e) { failed++; if (failed <= 5) console.log('  !', key, e.name); }
    }
    done++;
    if (done % 500 === 0) {
      const rate = (done / ((Date.now() - started) / 1000)).toFixed(1);
      console.log(`  ${done}/${files.length} uploaded=${uploaded} skipped=${skipped} failed=${failed} ${rate}/s`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`DONE uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => { console.log('FATAL', e && e.message); process.exit(1); });
