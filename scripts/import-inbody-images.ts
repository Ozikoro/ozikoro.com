/**
 * Import every image an article carries, including the ones that were never on ozikoro.com.
 *
 * THE THREE CASES, AND WHY EACH IS DIFFERENT
 *
 * 1. THE LAZY-LOAD PLACEHOLDER. The theme writes
 *
 *        <img src=".../trx_addons/.../placeholder.png" data-trx-lazyload-src="REAL-URL" …>
 *
 *    so the `src` is a grey box and **the real image is in `data-trx-lazyload-src`.** Reading only `src`
 *    counts 69 images that are not images. This resolves the real one.
 *
 * 2. AN ozikoro.com URL THE MEDIA TABLE DOES NOT HOLD. The file is on the live site and was never catalogued
 *    by the migration — 2020 uploads, for instance. **The owner's instruction is to import it**, so it is
 *    fetched once and kept.
 *
 * 3. AN EXTERNAL URL ON ANOTHER HOST. pbs.twimg.com, ichef.bbci.co.uk, i.pinimg.com, tumblr. **These are the
 *    images the owner asked about by name: still embedded in an article, not hosted here.** Downloading them
 *    is what keeps the article whole; leaving them pointing outward means the article breaks when the other
 *    site moves the file, and the archive would be citing an image it does not hold.
 *
 * WHAT IT WRITES
 *
 *   data/media/ozikoro-wp/ozikoro/<id>-<name>   the file
 *   ozikoro_media                               a row with source_url and storage_key
 *   ozikoro_article.body_html                   the `src` pointed at `/media/…`, placeholder replaced
 *
 * A download that fails is **left exactly as it was** and reported. An article with a dead external link is a
 * fault; an article whose image silently became a local path to nothing is a worse one.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, closeDb } from '@ozituma/db/client';

// No `ozikoro/` subdirectory: the local layout is flat and the route strips the prefix from the key.
const OUT_DIR = join(process.cwd(), 'data', 'media', 'ozikoro-wp');
const UA = 'OzikoroArchiveImporter/1.0 (+https://ozikoro.com; contact hello@ozikoro.com)';

type Need = { url: string };

/** Every image URL an article references, placeholder-resolved. */
function imageUrls(body: string): string[] {
  const urls = new Set<string>();
  for (const tag of body.matchAll(/<img[^>]*>/g)) {
    const t = tag[0];
    const lazy = /data-trx-lazyload-src="([^"]+)"/.exec(t);
    if (lazy) { urls.add(lazy[1]); continue; }
    const src = /\ssrc="([^"]+)"/.exec(t);
    if (src && !src[1].includes('trx_addons')) urls.add(src[1]);
  }
  for (const set of body.matchAll(/\ssrcset="([^"]+)"/g)) {
    for (const part of set[1].split(',')) {
      const u = part.trim().split(' ')[0];
      if (u && !u.includes('trx_addons')) urls.add(u);
    }
  }
  return [...urls];
}

const db = await getDb();
await mkdir(OUT_DIR, { recursive: true });

const media = await db.rows<{ source_url: string; storage_key: string }>(
  `select source_url, storage_key from ozikoro_media where source_url is not null and storage_key is not null`
);
/*
 * THE MAP MUST PRODUCE A URL, NOT A STORAGE KEY.
 *
 * `storage_key` is where the file sits on disk (`ozikoro/11231-umunede-king.jpeg`); what a page needs is
 * `/media/ozikoro/11231-umunede-king.jpeg`. **The first version stored the key, so the rewrite wrote a
 * relative path into every body** — which the browser then resolved against the article's own address and
 * 404'd. The images were imported, served and correct, and the articles showed none of them.
 */
const served = (key: string) => `/media/${key}`;
const known = new Map<string, string>();
for (const m of media) {
  known.set(m.source_url, served(m.storage_key));
  known.set(m.source_url.replace(/-\d+x\d+(?=\.[a-z]+$)/i, ''), served(m.storage_key));
}

const articles = await db.rows<{ id: number; slug: string; body_html: string }>(
  `select id, slug, body_html from ozikoro_article
    where status = 'published' and is_page = false and body_html like '%<img%'`
);

// --- which URLs are missing, and how many articles need each
const needed = new Map<string, Set<number>>();
for (const a of articles) {
  for (const u of imageUrls(a.body_html)) {
    // Already local, or not a URL at all. `known` is keyed on `source_url`, so a body already rewritten to
    // `/media/…` is not in it — and without this the second run tried to import its own output, printing a
    // thousand lines of "unparseable" while changing nothing. **A migration script that is not idempotent
    // cannot be safely re-run, and this one had to be.**
    if (u.startsWith('data:') || u.startsWith('/')) continue;
    const base = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
    if (known.has(u) || known.has(base)) continue;
    if (!needed.has(u)) needed.set(u, new Set());
    needed.get(u)!.add(a.id);
  }
}
console.log(`  articles with images      ${articles.length}`);
console.log(`  urls needing import      ${needed.size}`);

let downloaded = 0, failed = 0, bytes = 0;
const ok = new Map<string, string>();

let nextId = ((await db.one<{ n: number }>(`select coalesce(max(id),0)::int n from ozikoro_media`))?.n ?? 0) + 1;

for (const [url, articleIds] of needed) {
  let name: string;
  try {
    const path = new URL(url).pathname;
    name = decodeURIComponent(path.split('/').pop() ?? 'image');
  } catch {
    failed += 1;
    console.log(`  SKIP (unparseable) ${url.slice(0, 90)}`);
    continue;
  }
  name = name.replace(/[^\w.\-]+/g, '-').slice(0, 90);
  const key = `ozikoro/${nextId}-${name}`;
  const dest = join(OUT_DIR, `${nextId}-${name}`);

  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new Error('empty body');

    await writeFile(dest, buf);
    const size = (await stat(dest)).size;
    bytes += size;

    await db.query(
      `insert into ozikoro_media (id, kind, slug, title, alt_text, source_url, storage_key, mime_type, filesize_bytes)
       values ($1, 'image', $2, $3, $3, $4, $5, $6, $7)
       on conflict (id) do nothing`,
      [
        nextId,
        `${nextId}-${name}`.replace(/\.[a-z]+$/i, '').slice(0, 90),
        name.replace(/\.[a-z]+$/i, ''),
        url,
        key,
        res.headers.get('content-type')?.split(';')[0] ?? null,
        size,
      ]
    );
    ok.set(url, `/media/${key}`);
    downloaded += 1;
    nextId += 1;
  } catch (error) {
    failed += 1;
    console.log(`  FAILED ${url.slice(0, 74)}  ${String(error).slice(0, 40)}`);
  }
}

console.log(`  downloaded               ${downloaded}  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  failed, left untouched   ${failed}`);

// --- rewrite the bodies: the lazy placeholder becomes the real image, and every imported URL goes local
let rewritten = 0;
for (const a of articles) {
  let body = a.body_html;
  const before = body;

  // Replace the whole placeholder img with a plain one pointing at the real file.
  body = body.replace(/<img[^>]*?data-trx-lazyload-src="([^"]+)"[^>]*>/g, (tag, real: string) => {
    const local = ok.get(real) ?? known.get(real) ?? known.get(real.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '')) ?? real;
    const alt = /\salt="([^"]*)"/.exec(tag);
    return `<img src="${local}" alt="${alt ? alt[1] : ''}" loading="lazy" decoding="async">`;
  });

  // Anything else that now has a local copy.
  body = body.replace(/(<img[^>]*?\ssrc=")([^"]+)(")/g, (_m, a2: string, url: string, c: string) => {
    const base = url.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
    return a2 + (ok.get(url) ?? known.get(url) ?? known.get(base) ?? url) + c;
  });

  /*
   * AND `srcset`, WHICH IS THE ONE THE BROWSER ACTUALLY USES.
   *
   * The first run of this rewrote `<img src>` and left 1,013 articles still holding live-site URLs — because a
   * `<img>` with a `srcset` is loaded from the `srcset`, not from the `src`. Rewriting only the fallback left
   * the archive importing files it then did not serve.
   */
  body = body.replace(/(\ssrcset=")([^"]+)(")/g, (_m, a2: string, set: string, c: string) =>
    a2 +
    set
      .split(',')
      .map((part: string) => {
        const trimmed = part.trim();
        const sp = trimmed.indexOf(' ');
        const url = sp === -1 ? trimmed : trimmed.slice(0, sp);
        const rest = sp === -1 ? '' : trimmed.slice(sp);
        const base = url.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
        return (ok.get(url) ?? known.get(url) ?? known.get(base) ?? url) + rest;
      })
      .join(', ') +
    c
  );

  if (body !== before) {
    await db.query(`update ozikoro_article set body_html = $1 where id = $2`, [body, a.id]);
    rewritten += 1;
  }
}
console.log(`  articles rewritten       ${rewritten}`);

const left = await db.one<{ n: number }>(
  `select count(*)::int n from ozikoro_article
    where body_html like '%ozikoro.com/wp-content/uploads%' or body_html like '%trx_addons%'`
);
console.log(`  articles still holding a live-site upload or placeholder: ${left?.n ?? 0}`);
await closeDb();
