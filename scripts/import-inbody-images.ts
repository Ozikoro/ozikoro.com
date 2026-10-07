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
 * Usage:
 *   node scripts/import-inbody-images.ts                    # measure only: A / B / C and every C named
 *   node scripts/import-inbody-images.ts --apply             # fetch B, store it, open a row, rewrite bodies
 *   node scripts/import-inbody-images.ts --apply --limit 20  # stop after twenty downloads
 *   node scripts/import-inbody-images.ts --host blogger.googleusercontent.com --apply
 */
import { mkdir, writeFile } from 'node:fs/promises';
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
}

function parseArgs(argv: string[]): Options {
  const o: Options = { apply: false, wpOrigin: DEFAULT_WP_ORIGIN, hosts: [], limit: 0, articleIds: [], concurrency: 6 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--apply') o.apply = true;
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
  const got = isWordPress && opts.wpOrigin
    ? await fetchWithCurl(url, opts.wpOrigin)
    : await fetchDirect(url);

  if (!got.ok) {
    const detail = `HTTP ${got.status}${got.contentType ? ` ${got.contentType}` : ''}${got.error ? ` ${got.error}` : ''}`;
    console.log(`  C  ${detail.padEnd(22)} ${t.url.slice(0, 96)}`);
    attempts.push({ url: t.url, articles: [...t.articles], outcome: 'origin-refused', detail, bytes: 0, mime: null, key: null });
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
    const detail = `declared ${got.contentType || 'nothing'}, bytes are not a stored format${looksHtml ? ' (an HTML document)' : ''}`;
    console.log(`  !  not a file           ${t.url.slice(0, 96)}  ${detail}`);
    attempts.push({ url: t.url, articles: [...t.articles], outcome: 'not-a-file', detail, bytes: got.body.length, mime: got.contentType || null, key: null });
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
    imported += 1;
    bytes += got.body.length;
    console.log(`  B  ${String(got.body.length).padStart(9)} B  ${sniffed.mime.padEnd(16)} ${stored.key}`);
    attempts.push({ url: t.url, articles: [...t.articles], outcome: 'imported', detail: sniffed.mime, bytes: got.body.length, mime: sniffed.mime, key: stored.key });
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
 * WHAT IS LEFT, NAMED. A record whose picture answers nowhere keeps the dead address it had — that is the
 * honest state, and this is the list somebody has to act on. It is printed every run, so a second run is a
 * measurement rather than a no-op nobody can see.
 */
const stranded = attempts.filter((a) => a.outcome === 'origin-refused' || a.outcome === 'not-a-file' || a.outcome === 'failed');
if (stranded.length > 0) {
  console.log(`\nCOULD NOT BE RECOVERED — ${stranded.length} address(es), left exactly as they were:`);
  for (const s of stranded) console.log(`  ${s.outcome.padEnd(15)} ${s.url}\n                  ${s.detail}  | records ${s.articles.join(', ')}`);
}
await closeDb();
