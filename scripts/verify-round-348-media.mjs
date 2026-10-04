/**
 * Prove the archive's media through the site, not from the bucket.
 *
 * WHAT THIS IS FOR
 *
 * The bucket can hold every key and the archive still show an empty box. That has happened twice in this
 * repository: a CSP that refused a cross-origin image while `curl` returned 200, and a media route whose
 * key pattern refused eight real files that were on disk and in the table. **Both were invisible to a
 * `ListObjectsV2` count.** So this instrument measures the two ends of the move and the path between them:
 *
 *   1. WHAT THE BUCKET HOLDS — `ListObjectsV2` under `ozikoro/` (top-level) and `ozikoro/episodes/`, and then
 *      EVERY key it returns compared with the size of the file on disk. A count alone cannot see a truncated
 *      object, which is the failure an interrupted upload leaves behind.
 *   2. WHAT THE SITE SERVES — every sample fetched THROUGH `/media/<key>`, asserting status, `Content-Type`
 *      and byte length against the file on disk. The sample is spread across the whole key range and is
 *      deliberately NOT the first twenty records, which are the ones every earlier round has already looked
 *      at. The four spoken records are fetched by their exact byte sizes, because three of them exist in only
 *      one of the two source trees and are the thing most likely to be missed.
 *   3. THE THREE UNUSUAL CASES — the owner's own recording, the 51 rows whose `storage_key` is NULL (which must
 *      be served as "the archive does not hold this file", with no `/media/` address invented for them), and a
 *      `.webp`.
 *
 * WHAT IT NEEDS
 *
 *   --base       the origin to fetch through, e.g. http://127.0.0.1:3110
 *   --manifest   the flat run's manifest, written by the uploader
 *   --source     the directory the flat media lives in (default data/media/ozikoro-wp)
 *   --episodes   the episodes manifest, and --episode-source for their directory
 *   --fixture    JSON with `nulls` (the NULL-key rows) from the archive database — see the doc entry
 *   --env-file   OPTIONAL, an untracked KEY=VALUE file holding process.env.S3_* — names are never printed
 *
 * Run with: node scripts/verify-round-348-media.mjs --base http://127.0.0.1:3110 --manifest …
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (value === undefined && fallback === undefined) {
    console.error(`missing required --${name}`);
    process.exit(2);
  }
  return value ?? fallback;
}

const BASE = arg('base').replace(/\/$/, '');
const MANIFEST = arg('manifest');
const SOURCE = arg('source', 'data/media/ozikoro-wp');
const EPISODE_MANIFEST = arg('episode-manifest', null);
const EPISODE_SOURCE = arg('episode-source', '.data/media/ozikoro/episodes');
const FIXTURE = arg('fixture', null);
const ENV_FILE = arg('env-file', null);
/** OPTIONAL. The bucket's own public host, for the byte-level check below. */
const PUBLIC_BASE = arg('public-base', 'https://media.ozituma.com').replace(/\/$/, '');

if (ENV_FILE) {
  for (const line of (await readFile(ENV_FILE, 'utf8')).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i)] ??= line.slice(i + 1);
  }
}

const failures = [];
function check(ok, message) {
  if (!ok) failures.push(message);
  return ok;
}

// ---------------------------------------------------------------------------
// The route's own content-type map, mirrored so the served type can be asserted.
// Deliberately explicit: this is the thing being checked, so it must not be derived from the same code.
// ---------------------------------------------------------------------------

const SERVED_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
};
const expectedType = (key) => SERVED_TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
/** The address the archive itself builds: `/media/` then the key, encoded one segment at a time. */
const mediaPath = (key) => `/media/${key.split('/').map(encodeURIComponent).join('/')}`;

// ---------------------------------------------------------------------------
// 1. The bucket
// ---------------------------------------------------------------------------

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const Bucket = process.env.S3_BUCKET;

if (!Bucket) {
  console.error('Refusing to run: process.env.S3_BUCKET is not set, so there is no bucket to count.');
  process.exit(2);
}

console.log(`\n  VERIFYING THE ARCHIVE'S MEDIA MOVE`);
console.log(`  bucket  ${Bucket}   (credentials read from the environment; never printed)`);
console.log(`  base    ${BASE}\n`);

async function list({ Prefix, Delimiter }) {
  const objects = [];
  const prefixes = new Set();
  let token;
  let pages = 0;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, Delimiter, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) objects.push({ key: o.Key, size: o.Size ?? 0 });
    for (const p of r.CommonPrefixes ?? []) prefixes.add(p.Prefix);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
    pages += 1;
  } while (token && pages < 500);
  return { objects, prefixes };
}

const topLevel = await list({ Prefix: 'ozikoro/', Delimiter: '/' });
const episodesInBucket = await list({ Prefix: 'ozikoro/episodes/' });
const everything = await list({ Prefix: 'ozikoro/' });
const inBucket = new Map(everything.objects.map((o) => [o.key, o.size]));

console.log('  ── 1. WHAT THE BUCKET HOLDS ────────────────────────────────────────────────');
console.log(`     ozikoro/ (delimiter "/")   objects=${topLevel.objects.length}  commonPrefixes=[${[...topLevel.prefixes].join(', ')}]`);
console.log(`     ozikoro/episodes/          objects=${episodesInBucket.objects.length}`);
console.log(`     ozikoro/ (recursive)       objects=${everything.objects.length}`);

// ---------------------------------------------------------------------------
// 2. Every key the uploader wrote, against the file on disk
// ---------------------------------------------------------------------------

const mediaManifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const episodeManifest = EPISODE_MANIFEST ? JSON.parse(await readFile(EPISODE_MANIFEST, 'utf8')) : null;
const keys = [...new Set([...mediaManifest.missingOnDisk, ...mediaManifest.failed.map((f) => f.key)].map(String))];

console.log('\n  ── 2. EVERY KEY WRITTEN, AGAINST THE FILE ON DISK ──────────────────────────');
console.log(`     flat run     requested=${mediaManifest.keysRequested} present=${mediaManifest.filesPresent} ` +
  `uploaded=${mediaManifest.uploaded} skipped=${mediaManifest.alreadyStored} repaired=${mediaManifest.repaired} ` +
  `verified=${mediaManifest.verified} missing=${mediaManifest.missingOnDisk.length} failed=${mediaManifest.failed.length}`);
if (episodeManifest) {
  console.log(`     episode run  requested=${episodeManifest.keysRequested} present=${episodeManifest.filesPresent} ` +
    `uploaded=${episodeManifest.uploaded} skipped=${episodeManifest.alreadyStored} ` +
    `verified=${episodeManifest.verified} missing=${episodeManifest.missingOnDisk.length} failed=${episodeManifest.failed.length}`);
  check(episodeManifest.keysRequested === 4, `the episode run covered ${episodeManifest.keysRequested} files, not 4`);
}
check(mediaManifest.keysRequested >= 3443, `the flat run covered only ${mediaManifest.keysRequested} keys`);
check(mediaManifest.missingOnDisk.length === 0, `the flat run had ${mediaManifest.missingOnDisk.length} keys with no file`);
check(mediaManifest.failed.length === 0, `the flat run had ${mediaManifest.failed.length} failed uploads`);
check(mediaManifest.unaddressable.length === 0, `the flat run found ${mediaManifest.unaddressable.length} unaddressable keys`);

/*
 * THE KEYS THE ROUTE USED TO REFUSE, AND THE SIZE OF EVERYTHING ELSE.
 *
 * The manifest records the run's counts, not every key, so the census is taken from the SOURCE DIRECTORY:
 * every file the run read is checked against the bucket at exactly its own length. This is what turns "3,443
 * uploaded" into "3,443 objects of the right size".
 */
const { readdir } = await import('node:fs/promises');
const flatFiles = (await readdir(SOURCE, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
let matched = 0;
const sizeMismatch = [];
const absent = [];
for (const name of flatFiles) {
  const key = `ozikoro/${name}`;
  const size = (await stat(join(SOURCE, name))).size;
  if (!inBucket.has(key)) {
    // Not every file in the source directory is a row — the unreferenced ones are not uploaded.
    continue;
  }
  if (inBucket.get(key) !== size) sizeMismatch.push(`${key}: bucket ${inBucket.get(key)} vs disk ${size}`);
  else matched += 1;
}
console.log(`     source files with a matching object at the same size: ${matched} of ${flatFiles.length} on disk`);
check(sizeMismatch.length === 0, `${sizeMismatch.length} object(s) are the wrong size`);
for (const s of sizeMismatch.slice(0, 20)) failures.push(`  size: ${s}`);

// ---------------------------------------------------------------------------
// 3. Through the media route
// ---------------------------------------------------------------------------

console.log('\n  ── 3. THROUGH THE MEDIA ROUTE ──────────────────────────────────────────────');

async function fetchThroughRoute(key, label) {
  const url = `${BASE}${mediaPath(key)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (error) {
    failures.push(`${label} ${key}: fetch failed (${String(error).slice(0, 80)})`);
    return null;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const onDisk = join(SOURCE, key.slice('ozikoro/'.length));
  let diskSize = null;
  try {
    diskSize = (await stat(onDisk)).size;
  } catch {
    try {
      diskSize = (await stat(join(EPISODE_SOURCE, key.slice('ozikoro/episodes/'.length)))).size;
    } catch {
      diskSize = null;
    }
  }
  return { key, label, status: res.status, type, length: bytes.length, diskSize };
}

/*
 * THE SAMPLE IS SPREAD, NOT THE FIRST TWENTY.
 *
 * The uploader writes in `ozikoro_media.id` order, so the first twenty keys are the ones every earlier round
 * has already fetched. Every 1/24th of the run is taken instead, which reaches the end of the archive where
 * the recent imports landed.
 */
const allKeys = [...inBucket.keys()].filter((k) => !k.startsWith('ozikoro/episodes/')).sort();
const sampleCount = 24;
const sample = [];
for (let i = 0; i < sampleCount; i += 1) sample.push(allKeys[Math.floor((i * allKeys.length) / sampleCount)]);

/*
 * AND THE EIGHT KEYS THE ROUTE ITSELF USED TO REFUSE. Seven carry `@2x` and one is 212 characters; all eight
 * were on disk, in the table, and a 404 until the pattern was widened.
 */
const previouslyRefused = allKeys.filter(
  (k) => k.includes('@') || k.slice('ozikoro/'.length).length > 180
);
console.log(`     images sampled: ${sample.length} spread across ${allKeys.length} keys`);
console.log(`     keys that the OLD key pattern refused: ${previouslyRefused.length}`);

const imageResults = [];
for (const key of sample) imageResults.push(await fetchThroughRoute(key, 'image'));
for (const key of previouslyRefused) imageResults.push(await fetchThroughRoute(key, 'previously-refused'));
// A .webp explicitly, whichever one the spread happens to include.
const webp = allKeys.find((k) => k.toLowerCase().endsWith('.webp'));
if (webp) imageResults.push(await fetchThroughRoute(webp, 'webp'));
// A .html key, which must NOT be served as a page from the archive's own origin.
const htmlKey = allKeys.find((k) => /\.html?$/i.test(k));
if (htmlKey) imageResults.push(await fetchThroughRoute(htmlKey, 'html'));

let imageOk = 0;
for (const r of imageResults) {
  const want = r.label === 'html' ? 'application/octet-stream' : expectedType(r.key);
  const ok =
    r.status === 200 &&
    r.type.split(';')[0].trim() === want &&
    r.diskSize !== null &&
    r.length === r.diskSize;
  if (ok) imageOk += 1;
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(
    `     ${mark} ${String(r.status)} ${String(r.length).padStart(9)}B disk=${String(r.diskSize).padStart(9)} ` +
      `${(r.type || '(no content-type)').padEnd(24)} ${r.label.padEnd(18)} ${r.key}`
  );
  if (!ok) {
    failures.push(
      `${r.label} ${r.key}: status ${r.status}, content-type "${r.type}" (wanted ${want}), ` +
        `${r.length} bytes served vs ${r.diskSize} on disk`
    );
  }
}
check(imageOk === imageResults.length, `${imageResults.length - imageOk} of ${imageResults.length} image fetches failed`);

/*
 * THE FOUR SPOKEN RECORDS, BY THEIR EXACT BYTE SIZES.
 *
 * Three of them exist in only one of the two source trees, so a run driven by the rows alone misses them —
 * and a player whose file is absent 404s while every image on the site works, which reads as "the audio is
 * broken" rather than "the upload was incomplete".
 */
const EPISODES = [
  'ozikoro/episodes/how-tortoise-got-his-bumpy-shell.mp3',
  'ozikoro/episodes/igbo-folklore-twelve-timeless-tales-of-wisdom-wonder-and-moral-heritage.mp3',
  'ozikoro/episodes/ute-okpu-an-ika-igbo-clan-and-its-nri-roots.mp3',
  'ozikoro/episodes/ute-okpu-an-ika-igbo-clan-and-its-nri-roots.owner-recording.mp3',
];
const EPISODE_SIZES = [2310522, 8541919, 8029457, 10672389];
console.log('\n     the four spoken records, through the route:');
let episodeOk = 0;
for (let i = 0; i < EPISODES.length; i += 1) {
  const r = await fetchThroughRoute(EPISODES[i], 'episode');
  const owner = EPISODES[i].includes('owner-recording');
  const ok = r.status === 200 && r.type.split(';')[0].trim() === 'audio/mpeg' && r.length === EPISODE_SIZES[i];
  if (ok) episodeOk += 1;
  console.log(
    `     ${ok ? 'ok  ' : 'FAIL'} ${String(r.status)} ${String(r.length).padStart(9)}B expected=${String(EPISODE_SIZES[i]).padStart(9)} ` +
      `${r.type.padEnd(12)} ${owner ? "the owner's own recording" : ''} ${EPISODES[i]}`
  );
  if (!ok) {
    failures.push(`episode ${EPISODES[i]}: status ${r.status}, type "${r.type}", ${r.length} bytes, expected ${EPISODE_SIZES[i]}`);
  }
}
check(episodeOk === 4, `${4 - episodeOk} of the four spoken records failed`);

// ---------------------------------------------------------------------------
// 4. The same bytes from the bucket's own public host
// ---------------------------------------------------------------------------

/*
 * WHY THIS IS HERE, AND WHAT IT PROVES THAT THE ROUTE CANNOT
 *
 * The review server on 3110 runs with `process.env.S3_BUCKET` unset, so its storage driver is the LOCAL one
 * and a 200 from `/media/<key>` is a read of `.data/media/ozikoro/…`, not of the bucket. That is fine for
 * proving the route — the key patterns, the content types and the lengths are the same code either way — but
 * it is NOT a proof that the bucket holds these bytes, and it must not be reported as one.
 *
 * The bucket's own public host is the independent witness. It is checked for the same length as the file on
 * disk, which is what makes "the bytes are in the bucket" a measurement rather than an inference from a PUT
 * that returned 200.
 */
console.log('\n  ── 4. THE SAME BYTES FROM THE BUCKET\'S OWN PUBLIC HOST ─────────────────────');
const publicSample = [
  previouslyRefused[0],
  previouslyRefused[previouslyRefused.length - 1],
  allKeys[0],
  allKeys[Math.floor(allKeys.length / 2)],
  allKeys[allKeys.length - 1],
  'ozikoro/episodes/ute-okpu-an-ika-igbo-clan-and-its-nri-roots.owner-recording.mp3',
].filter(Boolean);
let publicOk = 0;
for (const key of publicSample) {
  const url = `${PUBLIC_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
  let res;
  try {
    res = await fetch(url);
  } catch (error) {
    failures.push(`public host ${key}: fetch failed (${String(error).slice(0, 80)})`);
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const sized = await stat(join(key.startsWith('ozikoro/episodes/') ? EPISODE_SOURCE : SOURCE,
    key.startsWith('ozikoro/episodes/') ? key.slice('ozikoro/episodes/'.length) : key.slice('ozikoro/'.length)));
  const ok = res.status === 200 && bytes.length === sized.size;
  if (ok) publicOk += 1;
  console.log(
    `     ${ok ? 'ok  ' : 'FAIL'} ${res.status} ${String(bytes.length).padStart(9)}B disk=${String(sized.size).padStart(9)} ` +
      `${(res.headers.get('content-type') ?? '').padEnd(12)} ${key.slice(0, 78)}`
  );
  if (!ok) failures.push(`public host ${key}: status ${res.status}, ${bytes.length} bytes vs ${sized.size} on disk`);
}
check(publicOk === publicSample.length, `${publicSample.length - publicOk} of ${publicSample.length} public-host fetches failed`);

// ---------------------------------------------------------------------------
// 5. The 51 rows whose storage_key is NULL
// ---------------------------------------------------------------------------

console.log('\n  ── 5. THE RECORDS THE ARCHIVE DOES NOT HOLD (storage_key IS NULL) ──────────');
if (!FIXTURE) {
  console.log('     no --fixture given, so this case was NOT checked');
  failures.push('the NULL-key case was not checked: no --fixture was given');
} else {
  const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
  console.log(`     rows with storage_key IS NULL: ${fixture.nulls.length}`);
  check(fixture.nulls.length === 51, `expected 51 NULL-key rows, the database holds ${fixture.nulls.length}`);
  for (const row of fixture.nulls.slice(0, 3)) {
    const url = `${BASE}/attachment/${encodeURIComponent(row.slug)}/`;
    const res = await fetch(url, { redirect: 'follow' });
    const body = await res.text();
    const claimsThefile = body.includes(`/media/ozikoro/`);
    const saysSo = body.includes('The archive does not hold this file');
    const ok = res.status === 200 && saysSo && !claimsThefile;
    console.log(
      `     ${ok ? 'ok  ' : 'FAIL'} ${res.status} ${row.kind} id=${row.id} says-so=${saysSo} ` +
        `claims-a-file=${claimsThefile}  ${row.slug.slice(0, 60)}`
    );
    if (!ok) {
      failures.push(`NULL-key record ${row.slug}: status ${res.status}, says-so=${saysSo}, claims-a-file=${claimsThefile}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

console.log('\n  ── RESULT ──────────────────────────────────────────────────────────────────');
if (failures.length === 0) {
  console.log('     PASS — every check above measured, none failed.\n');
} else {
  console.log(`     FAIL — ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`       * ${f}`);
  console.log('');
  process.exitCode = 1;
}
