/*
 * probe-round-316.mjs — WHICH OF THE DESIGN'S HOT-LINKED IMAGES THE ARCHIVE ACTUALLY HOLDS.
 *
 * The serve-time rewrite in `apps/ozikoro/app/design-screen/[screen]/route.ts` leaves a URL alone when it does
 * not resolve, and that is deliberate: **a broken image is better than a wrong one.** This script is the
 * measurement of how many are therefore left, and why each one is.
 *
 * It reports, per distinct URL the design files still point at `ozikoro.com`:
 *
 *   db-exact   the URL is a `ozikoro_media.source_url` verbatim
 *   db-resized the URL is a WordPress resize of one (`-680x541`), matched with the suffix stripped
 *   no-row     no media row matches — and then whether the FILE is nonetheless on disk, which is the
 *              matcher `apps/ozikoro/lib/publication.ts` uses for the PDF (`<attachment-id>-<name>`)
 *   nothing    neither a row nor a file: it was never migrated, and is left as it is
 *
 * It also counts the YouTube hosts article bodies reference, because `frame-src` has to name the host the
 * embeds actually use — the design's script uses `youtube-nocookie.com` and the bodies may use `youtube.com`.
 *
 * Usage: node scripts/probe-round-316.mjs        (needs the database; NOT the dev server)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDb, closeDb } from '@ozituma/db/client';
import { mediaUrlMap, mediaPath } from '@ozikoro/platform';

const SCREENS = 'apps/ozikoro/public/design/screens';
const MEDIA_ROOT = '.data/media/ozikoro';

/* ---------------------------------------------------------------- every absolute image in the design. */

const files = readdirSync(SCREENS).filter((f) => f.endsWith('.html')).sort();
const occurrences = [];
for (const f of files) {
  const html = readFileSync(join(SCREENS, f), 'utf8');
  for (const m of html.matchAll(/<(img|source|video|link)\b[^>]*?\b(src|srcset|poster|href)="([^"]+)"/g)) {
    const [, tag, attr, value] = m;
    for (const part of value.split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (/^https?:\/\//i.test(url)) occurrences.push({ file: f, tag, attr, url });
    }
  }
}

const byHost = new Map();
for (const o of occurrences) {
  const h = new URL(o.url).host;
  byHost.set(h, (byHost.get(h) ?? 0) + 1);
}
console.log('== every absolute URL in the design screens, by host ==');
for (const [h, n] of [...byHost].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${h}`);

const cms = occurrences.filter((o) => o.url.startsWith('https://ozikoro.com/wp-content/'));
const distinct = [...new Set(cms.map((o) => o.url))];
console.log(`\n  ${cms.length} occurrences of an ozikoro.com CMS image, ${distinct.length} distinct URLs`);

/* ---------------------------------------------------------------- the two matchers, side by side. */

const db = await getDb();
const rows = await db.rows(
  `select source_url, storage_key from ozikoro_media where source_url is not null and storage_key is not null`
);
const resolve = mediaUrlMap(rows);
const sourceUrls = new Set(rows.map((r) => r.source_url).filter(Boolean));

/** `publication.ts`'s rule: the tail of the path, looked for exactly, then as the suffix of a stored name. */
const disk = existsSync(MEDIA_ROOT) ? readdirSync(MEDIA_ROOT) : [];
const storedName = (url) => {
  const tail = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
  if (!tail) return null;
  if (disk.includes(tail)) return tail;
  return disk.find((name) => name.endsWith(`-${tail}`)) ?? null;
};

const buckets = { exact: [], resized: [], fileOnly: [], nothing: [] };
console.log('\n== the 14 distinct URLs, against the database and the disk ==');
for (const url of distinct.sort()) {
  const hit = resolve(url);
  const strip = url.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
  const onDisk = storedName(url) ?? storedName(strip);
  const used = cms.filter((o) => o.url === url).length;
  let verdict;
  if (hit && sourceUrls.has(url)) verdict = 'exact';
  else if (hit) verdict = 'resized';
  else if (onDisk) verdict = 'fileOnly';
  else verdict = 'nothing';
  buckets[verdict].push(url);
  console.log(
    `  ${verdict.padEnd(8)} x${String(used).padStart(2)}  ${url}` +
      (hit ? `\n              -> ${hit}` : '') +
      (!hit && onDisk ? `\n              file on disk: ${onDisk} (no media row matches the URL)` : '')
  );
}

console.log('\n== summary ==');
console.log(`  resolved from a media row : ${buckets.exact.length + buckets.resized.length} / ${distinct.length}`);
console.log(`     of which exact         : ${buckets.exact.length}`);
console.log(`     of which a WP resize   : ${buckets.resized.length}`);
console.log(`  row absent, file on disk  : ${buckets.fileOnly.length}`);
console.log(`  neither                   : ${buckets.nothing.length}`);
for (const u of buckets.nothing) console.log(`     LEFT AS IS  ${u}`);

/* ---------------------------------------------------------------- which YouTube hosts the bodies use. */

const hosts = await db.rows(
  `select host, count(*)::int n from (
     select unnest(array[
       case when body_html ~ 'youtube-nocookie\\.com/embed/' then 'youtube-nocookie.com' end,
       case when body_html ~ '(^|[^a-z-])youtube\\.com/embed/' then 'youtube.com' end,
       case when body_html ~ 'youtu\\.be/' then 'youtu.be' end
     ]) host
     from ozikoro_article
     where status = 'published' and is_page = false
   ) t where host is not null group by host order by n desc`
);
console.log('\n== the YouTube hosts the published bodies reference ==');
for (const h of hosts) console.log(`  ${String(h.n).padStart(4)}  ${h.host}`);

const frames = await db.rows(
  `select count(*)::int n from ozikoro_article
    where status = 'published' and is_page = false and body_html ~* '<iframe[^>]+youtube'`
);
console.log(`  ${String(frames[0]?.n ?? 0).padStart(4)}  bodies carry a literal <iframe ... youtube`);

await closeDb();
