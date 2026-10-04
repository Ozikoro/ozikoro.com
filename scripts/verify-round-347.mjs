/*
 * verify-round-347.mjs — the four WordPress page addresses, the whole published-address sweep, the two
 * refused body images, and the images and Igbodo cards on `/towns/`, measured on the SERVED site.
 *
 * ── WHY EVERY CHECK HERE FOLLOWS THE ADDRESS RATHER THAN FETCHING IT ────────────────────────────────
 *
 * Three faults in this repository returned a 200 and were not a working page, and two more returned 404
 * while the bytes were in the building. So nothing here is judged by a status code alone:
 *
 *   A. THE FOUR ADDRESSES. Each is fetched and its redirect chain is read, then **the destination's own
 *      `h1` is read out of the served HTML** — a redirect is only correct if it lands on the page it
 *      claims to. `/construction/` is checked the other way: it must still be a 404, because its record
 *      holds 0 bytes and an address with nothing behind it is not the same fault as one whose page exists.
 *      `/nze/` must be served at its own address, and its own document's `<h1>` must be the one its body
 *      carries — not a byline page.
 *   B. THE SWEEP. Every published `post_name` in the WordPress dump is requested, not a sample. This is the
 *      deliverable: "four of six" is a statement about pages, and the question is how many published
 *      addresses of ANY kind are unserved.
 *   C. THE TWO REFUSED IMAGES. Fetched through the served article with the content type read, and the
 *      old-site address counted in the served body — because a body address is only "rewritten" if it is
 *      gone from what the browser receives.
 *   D. `/towns/`. Every `<img>` on the served page is fetched and its status and content type recorded,
 *      every failure named. A blocked image and an absent image look identical in the HTML.
 *   E. THE IGBODO CARDS. Both cards' exact `href`s, and where each lands, with the destination's `h1`.
 *
 * USAGE
 *   node scripts/verify-round-347.mjs
 *   OZIKORO_BASE=http://127.0.0.1:3110 node scripts/verify-round-347.mjs
 *   OZIKORO_SWEEP=1 node scripts/verify-round-347.mjs     # adds the 1,057-address sweep (~5 min)
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.OZIKORO_BASE || 'http://127.0.0.1:3110';
const SWEEP = process.env.OZIKORO_SWEEP === '1';

const problems = [];
const notes = [];

function fail(msg) {
  problems.push(msg);
  console.log(`  FAIL  ${msg}`);
}
function note(msg) {
  notes.push(msg);
  console.log(`  note  ${msg}`);
}

async function get(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: opts.redirect ?? 'follow' });
  return { status: res.status, location: res.headers.get('location'), body: await res.text(), res };
}

function h1(body) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '(no h1)';
}

console.log(`\nverify-round-347 — ${BASE}\n`);

/* ── A. THE FOUR ADDRESSES ─────────────────────────────────────────────────────────────────────────── */
console.log('A. THE FOUR WORDPRESS PAGE ADDRESSES');

const EXPECTED = [
  { path: '/authors/', want: 'redirect', to: '/researchers/', h1: 'Researchers' },
  { path: '/privacy-policy/', want: 'redirect', to: '/privacy/', h1: 'Privacy' },
  // The record's own `<h1>`, whose hyphen is U+2011 (non-breaking) because that is what its author wrote.
  { path: '/nze/', want: 'served', h1: 'Are you a God\u2011fearing man?' },
  { path: '/construction/', want: '404', h1: null },
  // the two that already answered, for the comparison the brief asks for
  { path: '/about/', want: 'served', h1: 'We keep history where people can find it.' },
  { path: '/home/', want: 'served', h1: 'The stories of our towns, clans and kingdoms — kept, told and cited.' },
];

for (const e of EXPECTED) {
  const first = await get(e.path, { redirect: 'manual' });
  if (e.want === 'redirect') {
    if (first.status !== 301) fail(`${e.path}: expected 301, got ${first.status}`);
    else if (first.location !== e.to) fail(`${e.path}: 301 to ${first.location}, expected ${e.to}`);
    else {
      const dest = await get(e.to);
      if (dest.status !== 200) fail(`${e.path} → ${e.to}: destination is ${dest.status}`);
      else if (h1(dest.body) !== e.h1) fail(`${e.path} → ${e.to}: destination h1 is "${h1(dest.body)}", expected "${e.h1}"`);
      else note(`${e.path} → 301 → ${e.to} (200), h1 "${h1(dest.body)}"`);
    }
  } else if (e.want === '404') {
    if (first.status !== 404) fail(`${e.path}: expected to stay 404 (its record holds 0 bytes), got ${first.status}`);
    else note(`${e.path} stays 404 — the record's whole content is empty, so nothing is behind the address`);
  } else {
    if (first.status !== 200) fail(`${e.path}: expected 200, got ${first.status}`);
    else {
      const served = h1(first.body);
      if (e.h1 && served !== e.h1) fail(`${e.path}: h1 is "${served}", expected "${e.h1}"`);
      else note(`${e.path} 200, h1 "${served}"`);
    }
  }
}

/* The two spellings, because `trailingSlash: true` makes the slash-less form a rewrite that never
 * re-enters the middleware. */
for (const [bare, slashed] of [['/authors', '/researchers/'], ['/privacy-policy', '/privacy/']]) {
  const r = await get(bare, { redirect: 'manual' });
  if (r.status !== 301 || r.location !== slashed) fail(`${bare} (no slash): got ${r.status} ${r.location ?? ''}, expected 301 ${slashed}`);
  else note(`${bare} (no slash) → 301 ${slashed}`);
}

/* ── B. THE SWEEP ──────────────────────────────────────────────────────────────────────────────────── */
/*
 * `/construction/` IS THE ONE ADDRESS THIS ROUND DELIBERATELY LEAVES A 404. Its row is published and its
 * entire content is empty — 0 bytes of `post_content`, 0 words, `_elementor_data` `[]` — so the page branch
 * in `app/[slug]/route.ts` refuses it and the address keeps the 404 it always had. It is counted apart from
 * the failures rather than hidden among them.
 */
const EXPECTED_404 = new Set(['/construction/']);

if (SWEEP) {
  console.log('\nB. EVERY PUBLISHED WORDPRESS ADDRESS');
  const dump = readFileSync('.scratch/recon/rows/wpc9_posts.jsonl', 'utf8').split('\n');
  const addresses = [];
  for (const line of dump) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.post_status !== 'publish') continue;
    if (r.post_type !== 'post' && r.post_type !== 'page') continue;
    if (!r.post_name) continue;
    addresses.push({ path: `/${r.post_name}/`, kind: r.post_type, id: r.ID });
  }
  console.log(`  requesting ${addresses.length} published addresses, 12 at a time, one retry on a transport error …`);
  const bad = [];
  let done = 0;
  const queue = [...addresses];

  /*
   * A TRANSPORT ERROR IS NOT A 404 AND MUST NOT BE COUNTED AS ONE. The first run of this sweep used 24
   * connections and eleven addresses came back `TypeError: fetch failed` — a socket the server dropped
   * under load, on a development server that was simultaneously serving a browser probe. So a transport
   * error is retried once, and if it fails twice it is reported as its own kind of unknown rather than as
   * an address that does not answer.
   */
  async function ask(a) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(`${BASE}${a.path}`, { redirect: 'follow' });
        await res.arrayBuffer();
        return { status: res.status };
      } catch (err) {
        if (attempt === 1) return { status: `transport: ${String(err).slice(0, 60)}` };
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    return { status: 'transport: unknown' };
  }

  async function worker() {
    while (queue.length) {
      const a = queue.shift();
      const { status } = await ask(a);
      if (status !== 200 && !EXPECTED_404.has(a.path)) bad.push({ ...a, status });
      if (++done % 200 === 0) console.log(`    … ${done}/${addresses.length}`);
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  const pages = addresses.filter((a) => a.kind === 'page');
  const posts = addresses.filter((a) => a.kind === 'post');
  note(`published addresses: ${addresses.length} (${posts.length} posts, ${pages.length} pages); ${bad.length} not 200, excluding the one deliberate 404`);
  for (const b of bad) fail(`${b.path} (${b.kind} ${b.id}) → ${b.status}`);
} else {
  console.log('\nB. THE SWEEP — skipped; set OZIKORO_SWEEP=1 to request all 1,057 published addresses');
}

/* ── C. THE TWO REFUSED BODY IMAGES ────────────────────────────────────────────────────────────────── */
console.log('\nC. THE OLD-SITE BODY IMAGES');

const ICHI = '/ichi-mark-the-igbo-scarification/';
const ichi = await get(ICHI);
if (ichi.status !== 200) fail(`${ICHI}: ${ichi.status}`);
else {
  const left = [...new Set(ichi.body.match(/https?:\/\/ozikoro\.com\/wp-content\/uploads\/[^"'\s<>)]+/g) ?? [])];
  const loaded = [...ichi.body.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"[^>]*>/g)].length;
  note(`${ICHI}: ${loaded} <img>, ${left.length} old-site addresses still in the served body`);
  for (const u of left) note(`    still hot: ${u}`);
  if (left.length) fail(`${ICHI}: ${left.length} old-site image addresses survive rewriteBodyImages`);
  else note(`${ICHI}: every old-site body address is rewritten to /media/`);
}

for (const u of [
  'https://ozikoro.com/wp-content/uploads/2024/09/Igbo-Men-with-Ichi-Scarification-Thomas-W.-Northcote-642x317.png',
  'https://ozikoro.com/wp-content/uploads/2024/09/questioning8c86e7b536618f95fd3d8e9cf9fc8ce-768x461.jpg',
]) {
  const res = await fetch(u, { redirect: 'manual' });
  note(`the old address itself is left alone: ${res.status} ${u.split('/').pop()}`);
}

/* The archive's own file for each, as the resolver now finds it. */
for (const [local, what] of [
  ['/media/ozikoro/400-Igbo-Men-with-Ichi-Scarification-Thomas-W.-Northcote-scaled.png', 'the Northcote attachment (media row 3457, wp_media_id 400)'],
  ['/media/ozikoro/1616-questioning8c86e7b536618f95fd3d8e9cf9fc8ce-scaled.jpg', 'the questioning attachment (media row 3200, wp_media_id 1616)'],
]) {
  const r = await fetch(`${BASE}${local}`);
  const type = r.headers.get('content-type') ?? '';
  if (r.status !== 200 || !type.startsWith('image/')) fail(`${local} → ${r.status} ${type}`);
  else note(`${local} → 200 ${type} (${what})`);
}

/* ── D. THE REGISTER'S IMAGES ──────────────────────────────────────────────────────────────────────── */
/*
 * THE REGISTER IS PAGINATED, SO ONE FETCH IS NOT THE REGISTER.
 *
 * The measurement this round owns — 75 `<img>` across 66 distinct `src`, 65 of 66 answering before the media
 * round's key fix and 66 of 66 after — was taken on `/towns/` while that address served all 190 rows at once.
 * A sibling round then renamed the register to `/clan-towns/`, made `/towns/` a 301 to it and paginated it
 * **18 to a page**, so the same 75 images are now spread over eleven pages and the two Igbodo cards sit on
 * pages 4 and 10. **A probe that reads page 1 and calls it the register would report 11 images and no Igbodo
 * card**, which is the same class of mistake as judging a page by its status code.
 *
 * So this section walks the register's pages, carries `?page=` while it does, and asserts the invariant that
 * belongs to this round: **every image the register serves, on every page, answers 200 with an image content
 * type.** It follows `/towns/` once to learn whichever address serves it, so the section keeps working when
 * the next round moves it again.
 */
console.log('\nD. EVERY IMAGE ON THE REGISTER');

const first = await get('/towns/');
const registerPath = new URL(first.res.url).pathname;
note(`the register is served at ${registerPath} (asked for /towns/, ${first.status})`);

const registerPages = [];
for (let n = 1; n <= 15; n += 1) {
  const page = await get(`${registerPath}?page=${n}`);
  if (page.status !== 200) { fail(`${registerPath}?page=${n} → ${page.status}`); break; }
  const cards = [...page.body.matchAll(/<a\b[^>]*href="[^"]*"[^>]*>[\s\S]*?<strong[^>]*>/g)].length;
  registerPages.push({ n, body: page.body, cards });
  if (cards === 0) break;
}
const registerBody = registerPages.map((p) => p.body).join('\n');
note(`the register's pages read: ${registerPages.map((p) => `p${p.n}=${p.cards}`).join(' ')}`);

if (registerPages.length === 0) fail('the register answered no page at all');
else {
  const tags = [...registerBody.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const srcs = [...new Set(tags.map((t) => (/<img\b[^>]*?\ssrc="([^"]*)"/.exec(t) ?? [])[1]).filter(Boolean))];
  note(`the register carries ${tags.length} <img> across ${srcs.length} distinct src`);
  const bad = [];
  const queue = [...srcs];
  async function worker() {
    while (queue.length) {
      const src = queue.shift();
      try {
        const r = await fetch(`${BASE}${src}`);
        const type = r.headers.get('content-type') ?? '';
        await r.arrayBuffer();
        if (r.status !== 200 || !type.startsWith('image/')) bad.push({ src, status: r.status, type });
      } catch (err) {
        bad.push({ src, status: `ERR ${String(err).slice(0, 60)}`, type: '' });
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  note(`the register: ${srcs.length - bad.length} of ${srcs.length} distinct images return 200 with an image content type`);
  for (const b of bad) fail(`register image ${b.src} → ${b.status} ${b.type}`);
}

/* ── E. THE IGBODO CARDS ───────────────────────────────────────────────────────────────────────────── */
console.log('\nE. THE IGBODO CARDS ON THE REGISTER');

{
  const cards = [...registerBody.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({
      href: m[1],
      region: (/<small[^>]*>([\s\S]*?)<\/small>/.exec(m[2])?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      name: (/<strong[^>]*>([\s\S]*?)<\/strong>/.exec(m[2])?.[1] ?? '').replace(/<[^>]+>/g, '').trim(),
    }))
    .filter((c) => c.name === 'Igbodo');

  if (cards.length === 0) {
    fail('the register draws no card named Igbodo on any page');
  }
  for (const card of cards) {
    const dest = await get(card.href);
    const landed = dest.status === 200 ? h1(dest.body) : `(${dest.status})`;
    note(`register card "${card.name}" [${card.region}] → ${card.href} → ${dest.status}, h1 "${landed}"`);
    if (dest.status !== 200) fail(`the Igbodo card for ${card.region} → ${card.href} is ${dest.status}`);
    // The register's own note: `igbodo` is a SECTION in Enugu; `igbodo-northern-ika` is the IKA TOWN.
    if (/^Enugu/.test(card.region) && card.href !== '/town/igbodo/') fail(`the Enugu Igbodo card points at ${card.href}`);
    if (/^Delta/.test(card.region) && card.href !== '/town/igbodo-northern-ika/') fail(`the Ika (Delta) Igbodo card points at ${card.href}`);
  }
  /* And the two addresses themselves, whatever the register draws, because they are the destinations. */
  for (const [href, want] of [['/town/igbodo/', 'Enugu'], ['/town/igbodo-northern-ika/', 'Ika']]) {
    const d = await get(href);
    if (d.status !== 200) fail(`${href} (the ${want} Igbodo) is ${d.status}`);
    else note(`${href} (the ${want} Igbodo) → 200, h1 "${h1(d.body)}"`);
  }
}

/* ── RESULT ────────────────────────────────────────────────────────────────────────────────────────── */
console.log(`\nPROBLEMS: ${problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
console.log(`NOTES: ${notes.length}`);
process.exit(problems.length === 0 ? 0 : 1);
