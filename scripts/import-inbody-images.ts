/**
 * Import every file a record's body names, into this archive, wherever it is currently hosted.
 *
 * ── WHAT WAS WRONG, MEASURED RATHER THAN GUESSED ─────────────────────────────────────────────────────
 *
 * This script did this job already, and its article selection was:
 *
 *     where status = 'published' and is_page = false and body_html like '%<img%'
 *
 * **The owner's drafts were not in that set.** Measured over all 1,622 rows on 7 October 2026: the archive
 * holds **1,142 distinct image addresses on hosts that are not ozikoro.com — 1,119 of them on
 * `blogger.googleusercontent.com` — and every one of the 374 articles carrying a Blogger image is
 * `status = 'review'`; zero are published.** So `published` alone is why the drafts the owner named
 * (`/admin/posts/2154` is one) still show broken images: their pictures were never fetched, and the site's
 * own `img-src 'self' data:` policy then refuses the address that is left.
 *
 * The second fault is the same shape and was found by re-measuring: 89 distinct
 * `ozikoro.com/wp-content/uploads/…` addresses across 29 records have **no `ozikoro_media` row at all** —
 * uploads dated 2025/04 to 2026/03 that the migration never catalogued. Their files answer on the
 * pre-cutover WordPress origin and nowhere else, so they are a **recovery with a deadline**: that origin is
 * a migration source and can be switched off at any time.
 *
 * ── THE THREE OUTCOMES, AND WHY ONLY TWO OF THEM WRITE ────────────────────────────────────────────────
 *
 *   A  the archive already serves it (`mediaUrlMap` answers)          nothing fetched, nothing written
 *   B  it answers at its origin and the bytes are really that format   fetched, stored, row opened
 *   C  it answers nowhere                                              **left exactly as it was, and named**
 *
 * A `200` is not a file. The first version of this script trusted `res.ok` and the declared
 * `content-type`, so an origin answering an HTML error page with `200` would have been written to disk and
 * given a row whose `mime_type` said `image/jpeg`. **Every download is now checked against its own first
 * bytes** through `sniffMediaBytes`, which is the same rule `app/api/admin/media/upload/route.ts` enforces
 * — one definition, two doors, so the fetching importer cannot accept what the upload form would refuse.
 *
 * ── THE WORDPRESS ORIGIN, AND WHY IT IS AN ARGUMENT ───────────────────────────────────────────────────
 *
 * The cutover moved `ozikoro.com` to this archive's host, so `https://ozikoro.com/wp-content/uploads/…`
 * **404s on the domain itself** while the file still answers on the pre-cutover origin
 * (`162.213.253.73`, measured 6 October 2026). A plain `fetch` therefore cannot reach it and the importer
 * would report 89 live files as dead. `--wp-origin` resolves the hostname to that address for exactly those
 * addresses — the brief's own `curl --resolve ozikoro.com:443:162.213.253.73`. **It is read-only against
 * that origin: nothing is ever written to it.**
 *
 * ── RESUMABLE, IDEMPOTENT, AND NOT IDEMPOTENT BY ACCIDENT ─────────────────────────────────────────────
 *
 * A URL that already has a row is never fetched again; a body whose addresses all resolve is never
 * rewritten; a second run of `--apply` prints zero downloads and zero rewrites. The rewrite runs
 * **`rewriteBodyImages` — the same function the served article route uses** — so the stored body and the
 * rendered page cannot disagree about what an address means.
 *
 * ── AND A BODY IS ONLY EVER RE-POINTED AT A FILE THIS ARCHIVE HOLDS ───────────────────────────────────
 *
 * `fix` returns the address unchanged unless a media row carries it, so a link to another article, to a
 * YouTube player or to a citation cannot be touched by this. A record whose picture could not be recovered
 * keeps the dead address it had, which is the honest state; **nothing is invented to fill the space.**
 *
 * ── AND WHEN NEITHER THE ARCHIVE NOR THE ORIGIN HAS IT, ASK THE PLACE UPLOADS ACTUALLY SURVIVE ───────
 *
 * The two sources this script knew were the live archive and the pre-cutover origin. **Two is not all of
 * them.** A WordPress host drops its uploads when the site moves, and the file is still in a web archive —
 * measured this round, `…/2025/12/kalabari-ladies-…-2A7B43F.jpg` answers `404` on the origin and is held by
 * the Wayback Machine in a capture of 2026-04-06, 263,902 bytes.
 *
 * `--wayback` adds that source, and only as a SECOND one: the origin is always asked first, and the index is
 * consulted only after it refuses. **A recovery from a web archive is recorded as one** — `recordWebArchiveProvenance`
 * writes the archive and the capture date onto the row, in the `credit` field a reader sees on
 * `/documents/<slug>/`, because a photograph with a false provenance is worse than a missing one.
 *
 * ⚠️ AND THE INDEX IS A SERVICE THAT ANSWERS `503` UNDER LOAD, SO ITS ANSWERS ARE THREE, NOT TWO. It says a
 * capture exists, it says there is none, or **it cannot be asked** — and the third is printed as `unknown`
 * and never counted as proof that a file is gone. Be a guest: `--wayback --concurrency 2`.
 *
 * Usage:
 *   node scripts/import-inbody-images.ts                    # measure only: A / B / C and every C named
 *   node scripts/import-inbody-images.ts --apply             # fetch B, store it, open a row, rewrite bodies
 *   node scripts/import-inbody-images.ts --apply --limit 20  # stop after twenty downloads
 *   node scripts/import-inbody-images.ts --host blogger.googleusercontent.com --apply
 *   node scripts/import-inbody-images.ts --apply --wayback --concurrency 2
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getDb, closeDb, type Db } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import { bodyMediaAddresses, rewriteBodyImages } from '@ozikoro/platform';
import { mediaUrlMap } from '@ozikoro/platform/media';
import { isAddressableMediaKey } from '@ozikoro/platform/media-key';
import { looksLikeSvg, safeMediaFilename, sniffMediaBytes } from '@ozikoro/platform/media-bytes';

/**
 * WHERE THE BYTES ARE KEPT WHILE THEY ARE FETCHED.
 *
 * The local layout is flat and the key carries the `ozikoro/` namespace, because
 * `import:media-upload --source <this> --prefix ozikoro/ --keys db:ozikoro_media` derives the file name from
 * the key: `ozikoro/6983-foo.jpg` is `<this>/6983-foo.jpg`. **The staging copy is kept even though the run
 * also PUTs through `getStorage()`**, because it is what the resumable uploader re-reads and because the
 * files on disk are the only copy until a bucket is proven.
 */
const OUT_DIR = join(process.cwd(), 'data', 'media', 'ozikoro-wp');

const UA = 'OzikoroArchiveImporter/1.0 (+https://ozikoro.com; contact hello@ozikoro.com)';

/** The pre-cutover WordPress, measured 6 October 2026. Reading from it is the task; writing to it is not. */
const DEFAULT_WP_ORIGIN = '162.213.253.73';

interface Options {
  apply: boolean;
  wpOrigin: string | null;
  hosts: string[];
  limit: number;
  articleIds: number[];
  concurrency: number;
  /**
   * Ask the Internet Archive for a file its own origin has stopped serving.
   *
   * OFF BY DEFAULT, AND THE DEFAULT IS THE POINT: a normal run reports what the origin says and stops, which
   * is what makes `C` in this file's own vocabulary mean "this address answers nowhere". With `--wayback` a
   * `C` is only reached after a second, named source has also been asked, and every file that comes from
   * there carries the archive and the capture date in its own record.
   */
  wayback: boolean;
  /**
   * A file of captures the Wayback CDX index already answered for, keyed by address.
   *
   * WHY THIS EXISTS: **one prefix query answers for a thousand addresses; a thousand per-address queries
   * answer the same question and take hours.** Under load the index answers `503` far more often than it
   * answers a single-URL query, so a run that only asks per address reports most of the corpus as `unknown`
   * — measured this round. A prefix sweep (`url=ozikoro.com/wp-content/uploads/2025/05/*`) returns every
   * archived file in a month in one request, and this flag lets that evidence prime the run.
   *
   * It is evidence, not a shortcut around the rules: the JSON is the index's own answer, and the bytes are
   * still fetched from the archive and still sniffed before anything is stored.
   */
  waybackIndex: string | null;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { apply: false, wpOrigin: DEFAULT_WP_ORIGIN, hosts: [], limit: 0, articleIds: [], concurrency: 6, wayback: false, waybackIndex: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--apply') o.apply = true;
    else if (a === '--wayback') o.wayback = true;
    else if (a === '--wayback-index') {
      const v = argv[++i];
      if (!v) throw new Error('--wayback-index needs the path of a JSON file of captures');
      o.waybackIndex = v;
    }
    else if (a === '--wp-origin') {
      const v = argv[++i];
      if (!v) throw new Error('--wp-origin needs an address, or the word "none"');
      o.wpOrigin = v === 'none' ? null : v;
    } else if (a === '--host') {
      const v = argv[++i];
      if (!v) throw new Error('--host needs a hostname');
      o.hosts.push(v.toLowerCase());
    } else if (a === '--limit') {
      const v = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isInteger(v) || v <= 0) throw new Error('--limit needs a positive integer');
      o.limit = v;
    } else if (a === '--concurrency') {
      const v = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isInteger(v) || v <= 0 || v > 32) throw new Error('--concurrency needs an integer from 1 to 32');
      o.concurrency = v;
    } else if (a === '--article') {
      const v = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isInteger(v) || v <= 0) throw new Error('--article needs an article id');
      o.articleIds.push(v);
    } else if (a === '--help' || a === '-h') {
      console.log('see the header of this file for usage');
      process.exit(0);
    } else {
      throw new Error(`unknown option ${a}`);
    }
  }
  return o;
}

/** What one address turned out to be. */
type Outcome = 'already-held' | 'imported' | 'origin-refused' | 'not-a-file' | 'failed' | 'skipped';

interface Attempt {
  url: string;
  articles: number[];
  outcome: Outcome;
  detail: string;
  bytes: number;
  mime: string | null;
  key: string | null;
  /**
   * What the web-archive second source said, when it was asked. Present on an `origin-refused` outcome only.
   *
   * `none` is an answer; **`unknown` is not**, and is kept apart so a run that could not reach the index is
   * never reported as a run that proved the file is not archived.
   */
  archived?: 'none' | 'unknown';
  /** The web archive a file came from, and the capture it came from, when it did not come from its origin. */
  recoveredFrom?: { archive: string; timestamp: string };
}

/**
 * Fetch one address to a Buffer.
 *
 * **curl rather than `fetch` for the old WordPress origin, and only for it**, because the address the body
 * quotes is on a hostname whose DNS now points at this archive — the file is reachable only by resolving
 * that hostname to the pre-cutover address, which `fetch` cannot be told to do. Every other address is a
 * plain request.
 */
/**
 * THE ADDRESS AS THE FILE'S OWN SERVER SPELLS IT, WHICH IS NOT ALWAYS THE ADDRESS THE MARKUP QUOTES.
 *
 * WordPress escapes an ampersand in an attribute, so a body holds `?format=jpg&amp;name=medium` and the file
 * answers at `?format=jpg&name=medium` — measured on `pbs.twimg.com`, **`404` for the escaped spelling and
 * `200 image/jpeg` for the decoded one**. Fetching without decoding reports ten live images as gone.
 */
function decodeEntitiesForFetch(url: string): string {
  return url.replace(/&amp;/g, '&').replace(/&#0?38;/g, '&');
}

function fetchWithCurl(url: string, resolveTo: string | null): Promise<{ ok: boolean; status: number; contentType: string; body: Buffer; error: string }> {
  const args = ['-s', '-L', '--connect-timeout', '10', '-m', '90', '--retry', '2', '--retry-delay', '2'];
  if (resolveTo) args.push('--resolve', `ozikoro.com:443:${resolveTo}`);
  args.push('-A', UA, '-w', '\n%{http_code}\t%{content_type}', url);
  return new Promise((resolve) => {
    // No `maxBuffer`: that is an `exec`/`execFile` option. A `spawn` child streams, and the chunks below
    // are collected as they arrive, so a large image is never held twice.
    const p = spawn('curl', args);
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.stderr.on('data', (d: Buffer) => { err += String(d); });
    p.on('close', (code) => {
      const all = Buffer.concat(chunks);
      // The status is appended after a final newline; the body is everything before it.
      const cut = all.lastIndexOf(Buffer.from('\n'));
      const tail = cut === -1 ? '' : all.subarray(cut + 1).toString('utf8');
      const body = cut === -1 ? all : all.subarray(0, cut);
      const [status, contentType] = tail.trim().split('\t');
      resolve({ ok: code === 0 && /^(200|206)$/.test(status ?? ''), status: Number(status) || 0,
        contentType: (contentType ?? '').split(';')[0]!.trim().toLowerCase(), body, error: err.trim().slice(0, 160) });
    });
  });
}

async function fetchDirect(url: string): Promise<{ ok: boolean; status: number; contentType: string; body: Buffer; error: string }> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    const body = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, status: res.status, contentType: (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(), body, error: '' };
  } catch (error) {
    return { ok: false, status: 0, contentType: '', body: Buffer.alloc(0), error: String(error).slice(0, 160) };
  }
}

/*
 * ── THE SECOND SOURCE, AND WHY "NOT ARCHIVED" AND "I COULD NOT ASK" ARE DIFFERENT ANSWERS ──────────────
 *
 * A WordPress host drops the uploads the moment the site moves, so the origin and the live archive can both
 * refuse a file while it still exists elsewhere. The Wayback Machine is the single most likely place a
 * `wp-content/uploads` file survives, and **a CDX query per address is cheap** — but it is also a service
 * that answers `503` with an HTML page under load, and that page is not an answer to the question.
 *
 * **Treating a `503` as "no snapshot" would put a false "not archived" into this report and stop the one
 * search that might have found the file.** So the query returns three states, not two, and the caller prints
 * the third as its own outcome:
 *
 *     a 200 capture exists        -> download it, and say so on the record
 *     the index answers "nothing" -> the address is not archived (as of this run)
 *     the index could not be asked -> **unknown**, and named as unknown
 *
 * The download is the `id_` form, which is the archived bytes themselves rather than a Wayback page that
 * wraps them: `https://web.archive.org/web/<timestamp>id_/<original>`.
 */
const WAYBACK_HOST = 'web.archive.org';

/** A capture the index has already been asked about, and answered. */
interface PrimedCapture {
  timestamp: string;
  mimetype: string;
  bytes: number;
}

let waybackIndexCache: Map<string, PrimedCapture | null> | null = null;

/**
 * What the primed index says about this address: a capture, a proven absence, or nothing at all.
 *
 * **`null` IS AN ANSWER AND `undefined` IS NOT.** The file records the index's negative answers as well as
 * its positive ones — a `200`-filtered per-address query that returned nothing is a measurement, and
 * re-asking it live would both waste the archive's time and, on a loaded day, turn a proven "not archived"
 * into a reported "unknown". A URL the file does not mention at all is the only case that goes to the index.
 *
 * ⚠️ AND THE ADDRESS IS TRIED WITHOUT ITS QUERY AND FRAGMENT TOO, the same normalisation
 * `rewriteBodyImages` already makes. WordPress writes a video's address with a cache-buster —
 * `…-CulturalHeri.mp4?_=1` — and the archive holds the file under the bare address. **An exact-match-only
 * lookup reports a file the archive is holding as not held**, which is how the 49.9 MB Agbeji recording
 * would have stayed missing while its capture sat in the index.
 */
function primedLookup(url: string): { found: boolean; capture: PrimedCapture | null } {
  const index = readWaybackIndex();
  const candidates = [url, url.replace(/[?#].*$/, ''), decodeEntitiesForFetch(url), decodeEntitiesForFetch(url).replace(/[?#].*$/, '')];
  for (const candidate of candidates) {
    if (index.has(candidate)) return { found: true, capture: index.get(candidate) ?? null };
  }
  return { found: false, capture: null };
}

/**
 * Read the file of answers `--wayback-index` supplies, once.
 *
 * A file that cannot be read or parsed is **not** treated as an empty index: an empty index would silently
 * turn every address into a live CDX query, which is exactly the slow path this flag exists to avoid, and
 * the run would look like it had swept when it had not.
 */
function readWaybackIndex(): Map<string, PrimedCapture | null> {
  if (waybackIndexCache) return waybackIndexCache;
  waybackIndexCache = new Map();
  if (!opts.waybackIndex) return waybackIndexCache;
  try {
    const parsed = JSON.parse(readFileSync(opts.waybackIndex, 'utf8')) as Record<string, PrimedCapture | null>;
    for (const [url, capture] of Object.entries(parsed)) {
      if (capture === null) {
        waybackIndexCache.set(url, null);
        continue;
      }
      if (capture && /^\d{14}$/.test(String(capture.timestamp ?? ''))) {
        waybackIndexCache.set(url, {
          timestamp: String(capture.timestamp),
          mimetype: String(capture.mimetype ?? ''),
          bytes: Number(capture.bytes) || 0,
        });
      }
    }
    const captures = [...waybackIndexCache.values()].filter(Boolean).length;
    console.log(
      `wayback index primed: ${captures} capture(s), ${waybackIndexCache.size - captures} proven absent, from ${opts.waybackIndex}`
    );
  } catch (error) {
    console.log(`!! --wayback-index could not be read (${String(error).slice(0, 120)}); every address will be asked live`);
  }
  return waybackIndexCache;
}

interface WaybackSnapshot {
  /** The capture's own timestamp, `YYYYMMDDhhmmss`, which is what the record states. */
  timestamp: string;
  mimetype: string;
  bytes: number;
}

type WaybackAnswer =
  | { state: 'archived'; snapshot: WaybackSnapshot }
  | { state: 'not-archived' }
  | { state: 'unasked'; reason: string };

/** Ask the CDX index for the earliest capture of this address that answered 200. */
async function askWayback(url: string): Promise<WaybackAnswer> {
  const api =
    `https://${WAYBACK_HOST}/cdx/search/cdx?url=${encodeURIComponent(url)}` +
    '&output=json&filter=statuscode:200&limit=1&fl=timestamp,mimetype,length';
  /*
   * THE INDEX IS UNDER LOAD AND `503` IS NORMAL, SO A SINGLE REQUEST IS NOT AN ANSWER.
   *
   * Measured this round: the same CDX query returned `503` twice and `200` on the third attempt within a
   * minute. **Without a retry the run would have written "the Wayback index could not be asked" onto files
   * the archive actually holds** — and, worse, a reader of that report could conclude the file does not
   * exist. Three attempts with a short backoff, and the `unasked` answer is kept for when all three fail.
   */
  let last: WaybackAnswer | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const res = await fetchDirect(api);
    if (!res.ok) {
      last = { state: 'unasked', reason: `the index answered HTTP ${res.status}` };
      continue;
    }
    const text = res.body.toString('utf8').trim();
    // The archive serves an HTML "Temporarily Offline" page with a 200 under load; that is not an index answer.
    if (text.startsWith('<')) {
      last = { state: 'unasked', reason: 'the index answered an HTML page (it is offline or overloaded)' };
      continue;
    }
    let rows: string[][];
    try {
      rows = JSON.parse(text) as string[][];
    } catch {
      last = { state: 'unasked', reason: 'the index answer was not JSON' };
      continue;
    }
    if (rows.length < 2) return { state: 'not-archived' };
    /*
     * ⚠️ THE COLUMNS ARE READ BY NAME, NOT BY POSITION, AND THE FIRST VERSION GOT THIS WRONG.
     *
     * The answer is a header row followed by data rows, and **which columns are present is decided by the
     * `fl=` parameter — which the index does not always honour.** Assuming a leading `urlkey` gave
     * `timestamp = "video/mp4"` on a captured MP4, so the run asked for
     * `https://web.archive.org/web/video/mp4id_/…`, the archive answered `200` with an HTML error page, and
     * the log announced *"the Wayback Machine holds a capture of vide-o/-mp"*. It was caught only because
     * every download is sniffed — but a parse that is right by luck is not a parse.
     *
     * So the header names the columns, and a row without a `timestamp` is not a capture.
     */
    const header = rows[0]!;
    const at = (row: string[], name: string) => row[header.indexOf(name)];
    const timestamp = at(rows[1]!, 'timestamp');
    if (!/^\d{14}$/.test(timestamp ?? '')) return { state: 'not-archived' };
    return {
      state: 'archived',
      snapshot: {
        timestamp: timestamp!,
        mimetype: at(rows[1]!, 'mimetype') ?? '',
        bytes: Number(at(rows[1]!, 'length')) || 0,
      },
    };
  }
  return last ?? { state: 'unasked', reason: 'the index was never reached' };
}

/**
 * The address the capture is fetched from — the `id_` form, which serves the archived bytes themselves.
 *
 * Without `id_` the archive returns its own wrapper page: a toolbar, rewritten links and the file inside.
 * Those bytes are not the file, and `sniffMediaBytes` would — correctly — refuse them.
 */
function waybackAddress(url: string, timestamp: string): string {
  return `https://${WAYBACK_HOST}/web/${timestamp}id_/${url}`;
}

/** `20260406201257` -> `2026-04-06`, which is the date the record states. */
function waybackDate(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

/**
 * Say on the record where the file came from and when it was captured.
 *
 * **A photograph with a false provenance is worse than a missing one**, so a file recovered from a web
 * archive says so in the record a reader can see — the `credit` field of `/documents/<slug>/`, which is the
 * same field the archive already uses for attribution and the one field on that page that is printed whether
 * or not a licence is recorded.
 *
 * ⚠️ AND IT MUST NOT EAT THE ATTRIBUTION ALREADY THERE. `credit` is capped at 300 characters
 * (`MEDIA_TEXT_LIMITS`), 7 of the 51 unfilled rows already state one, and **a blind `slice(0, 300)` would
 * silently cut the end off somebody's name.** So the snapshot address is dropped before the existing credit
 * is, and if the two together still do not fit, the credit is left exactly as it was and the run says so.
 */
async function recordWebArchiveProvenance(db: Db, mediaId: number, timestamp: string, url: string): Promise<void> {
  const row = await db.one<{ credit: string | null }>(`select credit from ozikoro_media where id = $1`, [mediaId]);
  // Idempotent: a second run replaces its own sentence rather than stacking a second copy of it.
  const previous = /^Recovered from the Internet Archive Wayback Machine, capture of \d{4}-\d{2}-\d{2}\..*?\s*(?=Recovered|$)?/;
  const existing = (row?.credit ?? '').trim().replace(previous, '').trim();
  const stamp = `Recovered from the Internet Archive Wayback Machine, capture of ${waybackDate(timestamp)}.`;
  const withAddress = `${stamp} Snapshot: ${waybackAddress(url, timestamp)}`;
  const candidates = [existing ? `${withAddress} ${existing}` : withAddress, existing ? `${stamp} ${existing}` : stamp];
  const credit = candidates.find((c) => c.length <= 300);
  if (!credit) {
    console.log(`     !  provenance NOT written: the existing credit leaves no room inside 300 characters`);
    return;
  }
  await db.query(`update ozikoro_media set credit = $1, updated_at = now() where id = $2`, [credit, mediaId]);
}

/** A slug nothing else in `ozikoro_media` holds. `slug` is `not null unique` on that table. */
async function uniqueSlug(db: Db, name: string, id: number): Promise<string> {
  const root = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  const base = root.length > 0 ? root : 'imported';
  for (let n = 1; n <= 200; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await db.one<{ id: number }>(`select id from ozikoro_media where slug = $1 and id <> $2 limit 1`, [candidate, id]);
    if (!taken) return candidate;
  }
  return `imported-${id}`;
}

const opts = parseArgs(process.argv.slice(2));
const db = await getDb();

/*
 * EVERY ROW THE ARCHIVE HOLDS, KEYED BY THE ADDRESS THE OLD SITE PUBLISHED IT AT. The same rows feed
 * `mediaUrlMap` — the resolver the served page uses — so A is decided by the running site's own rule and
 * not by a second regex written here.
 */
const rows = await db.rows<{ id: number; source_url: string | null; storage_key: string | null }>(
  `select id, source_url, storage_key from ozikoro_media where deleted_at is null and source_url is not null`
);
const keyed = rows.filter((r) => r.storage_key);
let resolve = mediaUrlMap(keyed);
/** A row the archive opened and never filled — `storage_key is null`. Its key is written, not a second row. */
const keylessByUrl = new Map<string, number>();
for (const r of rows) if (!r.storage_key && r.source_url) keylessByUrl.set(r.source_url, r.id);

const articles = await db.rows<{ id: number; slug: string; status: string; body_html: string | null }>(
  `select id, slug, status, body_html from ozikoro_article
    where deleted_at is null and body_html is not null
      ${opts.articleIds.length ? 'and id = any($1::int[])' : ''}
    order by id`,
  opts.articleIds.length ? [opts.articleIds] : []
);

console.log(`articles with a body            ${articles.length}`);
console.log(`media rows already holding bytes ${keyed.length}`);
console.log(`media rows opened, never filled  ${keylessByUrl.size}`);

/*
 * ── AN `<img>` SAYS THE THING IS AN IMAGE, SO THE EXTENSION TEST IS NOT ASKED OF IT ────────────────────
 *
 * An extension is a crude signal and it is the wrong one for a tag that has already declared itself:
 * `https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9Gc…` is a photograph an `<img src>` loads and there is
 * no extension anywhere in the address, so an extension-only rule silently skips it and reports the record as
 * complete. **Anything an `<img>` names is taken as a file; anything else still has to look like one**, which
 * is what keeps the 30 YouTube `embed/` iframes and the Facebook `plugins/video.php` frame out — those are
 * pages, and fetching them would fill the report with recoveries that failed.
 */
const declaredImages = new Set<string>();
for (const a of articles) {
  const body = a.body_html ?? '';
  for (const tag of body.matchAll(/<img[^>]*>/gi)) {
    for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-trx-lazyload-src']) {
      const m = new RegExp(`\\s${attr}="([^"]+)"`, 'i').exec(tag[0]);
      if (m?.[1]) declaredImages.add(m[1].trim());
    }
    for (const attr of ['srcset', 'data-srcset']) {
      const m = new RegExp(`\\s${attr}="([^"]+)"`, 'i').exec(tag[0]);
      for (const part of (m?.[1] ?? '').split(',')) {
        const u = part.trim().split(/\s+/)[0];
        if (u) declaredImages.add(u);
      }
    }
  }
}
console.log(`addresses an <img> names      ${declaredImages.size}`);

// ── which addresses are needed, and by which records
interface Need { url: string; articles: Set<number>; host: string; adoptId: number | null }
const needed = new Map<string, Need>();
for (const a of articles) {
  for (const raw of bodyMediaAddresses(a.body_html ?? '')) {
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url)) continue;                       // already ours, or relative, or a data URI
    if (/^https?:\/\/(?:www\.)?ozikoro\.com\/media\//i.test(url)) continue;
    /*
     * A ROW THAT WAS OPENED AND NEVER FILLED IS ADOPTED, NOT SKIPPED.
     *
     * 51 rows in this archive carry a `source_url` and `storage_key is null` — a row the migration wrote
     * before it got the bytes. **They are not "already held"**: `mediaUrlMap` filters on `storage_key`, so the
     * address does not resolve and the reader sees nothing. The file is the only gap, and the gap is filled
     * under the id the row already has rather than by opening a second row for the same address.
     */
    const adoptId = keylessByUrl.get(url) ?? null;
    if (resolve(url) || resolve(decodeEntitiesForFetch(url)) || resolve(url.replace(/[?#].*$/, ''))) continue; // A — already served
    let host = '';
    try { host = new URL(url).host.toLowerCase(); } catch { continue; }
    if (opts.hosts.length && !opts.hosts.includes(host)) continue;
    /*
     * ONLY AN ADDRESS THAT NAMES A FILE. The scanner returns every `src` a body carries, which includes an
     * `<iframe>` pointing at a YouTube embed — **a page, not a file**, and fetching 25 of them would report 25
     * recoveries that failed and bury the ones that matter. A file extension is a crude test and the right one
     * here: `sniffMediaBytes` decides the truth afterwards, and this only decides what is worth asking for.
     */
    const fileLike =
      declaredImages.has(url) ||
      /\.(?:jpe?g|png|gif|webp|avif|bmp|tiff?|mp4|m4v|webm|ogv|ogm|mov|mp3|m4a|wav|ogg|pdf)(?:[?#]|$)/i.test(url) ||
      // `pbs.twimg.com/media/<id>?format=jpg&name=medium` — an image whose path has no extension at all.
      /[?&]format=(?:jpe?g|png|gif|webp|avif)\b/i.test(url) ||
      /*
       * AND BLOGGER'S OTHER SIZE SPELLING. The older shape is a path segment (`/s320/name.jpg`); the newer
       * one is a query-less suffix on the id (`…AVvXsE…=s320`) with **no file extension anywhere in the
       * address**, which the extension test cannot see and which measured `200 image/jpeg, 16,088 bytes`.
       */
      /=(?:s\d+|w\d+-h\d+|s\d+-c)(?:[?#]|$)/i.test(url);
    if (!fileLike) continue;
    const e = needed.get(url) ?? { url, articles: new Set<number>(), host, adoptId };
    e.articles.add(a.id);
    needed.set(url, e);
  }
}

/*
 * ── AND THE ROWS THE ARCHIVE ALREADY HAS AN ADDRESS FOR BUT NO BYTES OF ────────────────────────────────
 *
 * 51 live `ozikoro_media` rows carry a `source_url` and `storage_key is null`. **Eleven of them are a record's
 * `featured_media_id` and eleven are an `ozikoro_article_media` placement**, so a pass that only walked bodies
 * would leave the lead image of eleven records missing while reporting every body repaired — *"a fix that
 * repairs bodies and leaves featured images broken is half a fix."* These are walked as their own targets and
 * the file is written **under the id the row already has**, so nothing is duplicated.
 */
for (const [url, id] of keylessByUrl) {
  let host = '';
  try { host = new URL(url).host.toLowerCase(); } catch { continue; }
  if (opts.hosts.length && !opts.hosts.includes(host)) continue;
  needed.set(url, { url, articles: new Set<number>(), host, adoptId: id });
}

const byHost = new Map<string, number>();
for (const n of needed.values()) byHost.set(n.host, (byHost.get(n.host) ?? 0) + 1);
const records = new Set<number>();
for (const n of needed.values()) for (const id of n.articles) records.add(id);
console.log(`\nB — addresses to fetch          ${needed.size}  in ${records.size} records`);
for (const [h, n] of [...byHost].sort((a, b) => b[1] - a[1])) console.log(`      ${h.padEnd(38)} ${n}`);
console.log(`    of which adopt a row the migration left empty: ${[...needed.values()].filter((n) => n.adoptId).length}`);

const targets = [...needed.values()].sort((a, b) => a.url.localeCompare(b.url));
if (opts.limit) targets.length = Math.min(targets.length, opts.limit);

if (!opts.apply) {
  console.log('\nMEASURE ONLY — nothing was fetched and nothing was written. Re-run with --apply to import.');
  await closeDb();
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });
const storage = getStorage();
console.log(`\nstore driver                    ${storage.driver}`);

const attempts: Attempt[] = [];
let imported = 0;
let adopted = 0;
let bytes = 0;

/**
 * One address, end to end.
 *
 * THE ROW FIRST, WITH NO KEY, exactly as the upload route does it: `storage_key is null` is what every media
 * picker filters out, so a record that never gets its bytes is a record no screen offers — and if the PUT
 * fails the row is deleted, so a failed import leaves nothing behind rather than an orphan the owner cannot
 * see. **The one thing this cannot undo is bytes already in the store when the row update fails**, which is
 * logged with its key and is why step three is a single `update` rather than a second insert.
 */
async function importOne(t: Need): Promise<void> {
  const url = decodeEntitiesForFetch(t.url);
  const isWordPress = /^https?:\/\/(?:www\.)?ozikoro\.com\/wp-content\//i.test(url);
  let got = isWordPress && opts.wpOrigin
    ? await fetchWithCurl(url, opts.wpOrigin)
    : await fetchDirect(url);

  /*
   * ── AND WHEN THE ORIGIN REFUSES, THE SECOND SOURCE IS ASKED BEFORE THE FILE IS CALLED UNRECOVERABLE ──
   *
   * The origin is a migration source, not a home: it answered for a while and then stopped, and **a `404`
   * from the origin is not evidence that the file is gone from everywhere** — a WordPress host's uploads
   * often survive in a web archive long after the site behind them is switched off.
   *
   * ⚠️ AND THE ORIGIN HAS TWO WAYS OF REFUSING, WHICH IS THE PART THAT IS EASY TO GET WRONG. It can answer
   * `404`, and it can answer **`200` with an HTML page** — measured this round on
   * `pubs.sciepub.com/ajams/3/1/3/Table/2.png`, which returns `200 text/html`, 9,518 bytes. A fallback
   * written against `res.ok` alone would treat the second as a success, refuse the bytes as "not a file",
   * and **never ask the archive about a picture the archive may be holding**. So the question asked here is
   * not "did the origin answer" but "did the origin answer with a file", and only then is the attempt over.
   */
  let originDetail = `HTTP ${got.status}${got.contentType ? ` ${got.contentType}` : ''}${got.error ? ` ${got.error}` : ''}`;
  let recoveredFrom: { timestamp: string; mimetype: string; bytes: number } | null = null;
  let archiveNote = '';
  /** `none` is an answer; `unknown` is not. Kept as a value rather than parsed back out of the sentence. */
  let archiveState: 'none' | 'unknown' | null = null;

  const originIsAFile =
    got.ok && got.body.length > 0 && !looksLikeSvg(got.body.subarray(0, 512)) && sniffMediaBytes(got.body.subarray(0, 512), got.contentType) !== null;

  if (!originIsAFile && opts.wayback) {
    const primed = primedLookup(url);
    const answer: WaybackAnswer = primed.found
      ? primed.capture
        ? { state: 'archived', snapshot: primed.capture }
        : { state: 'not-archived' }
      : await askWayback(url);
    if (answer.state === 'archived') {
      const fetched = await fetchDirect(waybackAddress(url, answer.snapshot.timestamp));
      /*
       * ⚠️ A `200` FROM THE ARCHIVE IS NOT A FILE EITHER — THE SAME RULE, ONE HOP FURTHER OUT.
       *
       * A wrong capture address (see `askWayback`'s note about column order) makes the archive answer `200`
       * with **its own error page**, and a fallback that trusted `res.ok` would store that page as a
       * photograph. So the bytes are sniffed here as well as below, and a capture that is not a file is
       * reported as a capture that could not be used.
       */
      const usable = fetched.ok && sniffMediaBytes(fetched.body.subarray(0, 512), fetched.contentType) !== null;
      if (usable) {
        got = fetched;
        recoveredFrom = answer.snapshot;
        archiveNote = `the Wayback Machine holds a capture of ${waybackDate(answer.snapshot.timestamp)}`;
        console.log(`  W  archived ${answer.snapshot.timestamp}  ${t.url.slice(0, 88)}`);
      } else {
        archiveNote = `a capture of ${waybackDate(answer.snapshot.timestamp)} is indexed but did not answer with a file (HTTP ${fetched.status}${fetched.contentType ? ` ${fetched.contentType}` : ''})`;
        // Indexed and not fetched is not "proven absent": the file is there and the download failed.
        archiveState = 'unknown';
        console.log(`  C  ${originDetail.padEnd(22)} ${t.url.slice(0, 88)}  | ${archiveNote}`);
      }
    } else if (answer.state === 'not-archived') {
      archiveNote = 'the Wayback Machine holds no 200 capture of it';
      archiveState = 'none';
      console.log(`  C  ${originDetail.padEnd(22)} ${t.url.slice(0, 88)}  | ${archiveNote}`);
    } else {
      archiveNote = `the Wayback index could not be asked: ${answer.reason}`;
      archiveState = 'unknown';
      console.log(`  ?  ${originDetail.padEnd(22)} ${t.url.slice(0, 88)}  | ${archiveNote}`);
    }
  }

  if (!got.ok) {
    const detail = archiveNote ? `${originDetail}; ${archiveNote}` : originDetail;
    attempts.push({
      url: t.url,
      articles: [...t.articles],
      outcome: 'origin-refused',
      detail,
      bytes: 0,
      mime: null,
      key: null,
      // Null when `--wayback` was not asked for at all: nothing was proven either way.
      ...(archiveState ? { archived: archiveState } : {}),
    });
    return;
  }

  /*
   * THE BYTES DECIDE, NOT THE RESPONSE. `looksLikeSvg` is asked first so the refusal can name the format, and
   * `sniffMediaBytes` is the same rule the upload form enforces — so an origin answering `200` with an HTML
   * error page cannot be stored as a photograph.
   */
  const head = got.body.subarray(0, 512);
  if (looksLikeSvg(head)) {
    console.log(`  !  SVG refused          ${t.url.slice(0, 96)}`);
    attempts.push({ url: t.url, articles: [...t.articles], outcome: 'not-a-file', detail: 'SVG is refused by name', bytes: got.body.length, mime: null, key: null });
    return;
  }
  const sniffed = sniffMediaBytes(head, got.contentType);
  if (!sniffed) {
    const looksHtml = /^\s*<(!doctype|html|head|body)/i.test(got.body.subarray(0, 64).toString('utf8'));
    const detail =
      `declared ${got.contentType || 'nothing'}, bytes are not a stored format${looksHtml ? ' (an HTML document)' : ''}` +
      (archiveNote ? `; ${archiveNote}` : '');
    console.log(`  !  not a file           ${t.url.slice(0, 96)}  ${detail}`);
    attempts.push({
      url: t.url,
      articles: [...t.articles],
      outcome: 'not-a-file',
      detail,
      bytes: got.body.length,
      mime: got.contentType || null,
      key: null,
      ...(archiveState ? { archived: archiveState } : {}),
    });
    return;
  }
  if (got.body.length === 0) {
    attempts.push({ url: t.url, articles: [...t.articles], outcome: 'not-a-file', detail: 'empty body', bytes: 0, mime: sniffed.mime, key: null });
    return;
  }

  const original = decodeURIComponent((() => { try { return new URL(url).pathname.split('/').pop() ?? 'image'; } catch { return 'image'; } })());
  const filename = safeMediaFilename(original, sniffed.extension);

  let mediaId: number;
  try {
    if (t.adoptId !== null) {
      mediaId = t.adoptId;
      adopted += 1;
    } else {
      const row = await db.one<{ id: number }>(
        `insert into ozikoro_media (slug, kind, title, alt_text, source_url, storage_key, mime_type, filesize_bytes, uploaded_at)
         values ($1, $2, $3, $3, $4, null, $5, $6, now())
         returning id`,
        [`pending-${Date.now()}-${Math.floor(Math.random() * 1e9)}`, sniffed.kind, filename.replace(/\.[A-Za-z0-9]+$/, '').slice(0, 200), url, sniffed.mime, got.body.length]
      );
      if (!row) throw new Error('the media row was not returned');
      mediaId = Number(row.id);
    }
  } catch (error) {
    console.log(`  !  row failed           ${t.url.slice(0, 96)}  ${String(error).slice(0, 80)}`);
    attempts.push({ url: t.url, articles: [...t.articles], outcome: 'failed', detail: `row: ${String(error).slice(0, 120)}`, bytes: got.body.length, mime: sniffed.mime, key: null });
    return;
  }

  const key = `ozikoro/${mediaId}-${filename}`;
  if (!isAddressableMediaKey(key)) {
    if (t.adoptId === null) await db.query(`delete from ozikoro_media where id = $1`, [mediaId]);
    console.log(`  !  key unaddressable    ${key}`);
    attempts.push({ url: t.url, articles: [...t.articles], outcome: 'failed', detail: `key the media route cannot serve: ${key}`, bytes: got.body.length, mime: sniffed.mime, key: null });
    return;
  }

  try {
    const staged = join(OUT_DIR, `${mediaId}-${filename}`);
    await writeFile(staged, got.body);
    const stored = await storage.put(key, got.body, sniffed.mime);
    const slug = await uniqueSlug(db, filename.replace(/\.[A-Za-z0-9]+$/, ''), mediaId);
    await db.query(
      `update ozikoro_media set storage_key = $1, slug = $2, kind = $3, mime_type = $4, filesize_bytes = $5, source_url = $6, updated_at = now() where id = $7`,
      [stored.key, slug, sniffed.kind, sniffed.mime, got.body.length, url, mediaId]
    );
    /*
     * AND IF THE FILE CAME FROM A WEB ARCHIVE, THE RECORD SAYS SO. **A photograph with a false provenance is
     * worse than a missing one**, and this archive's whole point is provenance — so the source and the
     * capture date are written onto the row a reader can see (`/documents/<slug>/`, the `credit` field),
     * not merely printed in this run's log where nobody will meet them again.
     */
    if (recoveredFrom) {
      await recordWebArchiveProvenance(db, mediaId, recoveredFrom.timestamp, url);
      console.log(`     provenance: Wayback capture of ${waybackDate(recoveredFrom.timestamp)} written to the record`);
    }
    imported += 1;
    bytes += got.body.length;
    console.log(`  B  ${String(got.body.length).padStart(9)} B  ${sniffed.mime.padEnd(16)} ${stored.key}`);
    attempts.push({
      url: t.url,
      articles: [...t.articles],
      outcome: 'imported',
      detail: sniffed.mime,
      bytes: got.body.length,
      mime: sniffed.mime,
      key: stored.key,
      ...(recoveredFrom ? { recoveredFrom: { archive: 'Internet Archive Wayback Machine', timestamp: recoveredFrom.timestamp } } : {}),
    });
  } catch (error) {
    if (t.adoptId === null) {
      try { await db.query(`delete from ozikoro_media where id = $1`, [mediaId]); } catch { /* no key, so no picker offers it */ }
    }
    console.log(`  !  store failed         ${t.url.slice(0, 96)}  ${String(error).slice(0, 100)}`);
    attempts.push({ url: t.url, articles: [...t.articles], outcome: 'failed', detail: `store: ${String(error).slice(0, 120)}`, bytes: got.body.length, mime: sniffed.mime, key: null });
  }
}

/*
 * A BOUNDED POOL RATHER THAN ONE REQUEST AT A TIME. The serial first run measured ~1,100 Blogger images at
 * roughly one per second, which is two hours of a migration source that has a deadline. Six at a time is
 * enough to finish it and few enough to be a guest on somebody else's CDN; **the winner is not a race on the
 * database** — PGlite serialises the queries and each worker owns its own row.
 */
let cursor = 0;
const workers = Array.from({ length: Math.min(opts.concurrency, targets.length) }, async () => {
  while (cursor < targets.length) {
    const t = targets[cursor++];
    if (!t) break;
    try {
      await importOne(t);
    } catch (error) {
      console.log(`  !  threw                ${t.url.slice(0, 96)}  ${String(error).slice(0, 100)}`);
      attempts.push({ url: t.url, articles: [...t.articles], outcome: 'failed', detail: String(error).slice(0, 160), bytes: 0, mime: null, key: null });
    }
  }
});
await Promise.all(workers);

// ── and now the bodies, through the SAME function the served article route uses
console.log('\nrewriting bodies …');
const freshRows = await db.rows<{ id: number; source_url: string | null; storage_key: string | null }>(
  `select id, source_url, storage_key from ozikoro_media where deleted_at is null and source_url is not null and storage_key is not null`
);
const freshResolve = mediaUrlMap(freshRows);
let rewritten = 0;
for (const a of articles) {
  const before = a.body_html ?? '';
  const after = rewriteBodyImages(before, freshResolve);
  if (after !== before) {
    await db.query(`update ozikoro_article set body_html = $1, updated_at = now() where id = $2`, [after, a.id]);
    rewritten += 1;
  }
}

const summary = attempts.reduce<Record<string, number>>((acc, a) => { acc[a.outcome] = (acc[a.outcome] ?? 0) + 1; return acc; }, {});
console.log(`\ndownloaded                      ${imported}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`outcomes                        ${JSON.stringify(summary)}`);
console.log(`records rewritten               ${rewritten}`);
console.log(`rows adopted (a row the migration left empty) ${adopted}`);

/*
 * WHERE THE BYTES CAME FROM, COUNTED SEPARATELY. **A recovery and a recovery from a web archive are not the
 * same fact about a file**, so the run says how many of each it wrote, and how many captures it was told
 * about but could not fetch.
 */
const fromArchive = attempts.filter((a) => a.recoveredFrom);
if (fromArchive.length > 0) {
  console.log(`\nRECOVERED FROM A WEB ARCHIVE — ${fromArchive.length} file(s), each with its source and capture date on its own record:`);
  for (const a of fromArchive) {
    console.log(`  ${a.recoveredFrom!.archive}  capture of ${waybackDate(a.recoveredFrom!.timestamp)}  ->  ${a.key}\n      ${a.url}`);
  }
}

/*
 * WHAT IS LEFT, NAMED. A record whose picture answers nowhere keeps the dead address it had — that is the
 * honest state, and this is the list somebody has to act on. It is printed every run, so a second run is a
 * measurement rather than a no-op nobody can see.
 *
 * ⚠️ AND THE THREE ANSWERS ARE KEPT APART, BECAUSE TWO OF THEM ARE NOT THE SAME. An address the origin
 * refused and the index has no capture of is **not archived**. An address the origin refused while the index
 * could not be asked is **unknown**, and calling that "not recoverable" would be reporting a guess as a
 * measurement. The third line below is the one to re-run.
 */
const stranded = attempts.filter((a) => a.outcome === 'origin-refused' || a.outcome === 'not-a-file' || a.outcome === 'failed');
if (stranded.length > 0) {
  const unknown = stranded.filter((a) => a.archived === 'unknown');
  const proven = stranded.filter((a) => a.archived !== 'unknown');
  console.log(`\nCOULD NOT BE RECOVERED — ${stranded.length} address(es), left exactly as they were:`);
  for (const s of stranded) console.log(`  ${s.outcome.padEnd(15)} ${s.url}\n                  ${s.detail}  | records ${s.articles.join(', ')}`);
  if (unknown.length > 0) {
    console.log(
      `\n  ⚠️ ${unknown.length} of those were NOT proven absent anywhere: the Wayback index could not be asked ` +
        `about them. They are unknown, not unrecoverable — re-run to ask again.`
    );
  }
  if (proven.length > 0 && opts.wayback) {
    console.log(`  ${proven.length} were asked of both sources and answered nowhere.`);
  }
}
await closeDb();

