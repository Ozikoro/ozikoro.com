/*
 * verify-round-350.mjs — `/entities/` redesigned, measured on the served site.
 *
 * ── WHAT THE OWNER ASKED FOR, AND WHAT THIS MEASURES ────────────────────────────────────────────────
 *
 *   "on the records page http://127.0.0.1:3110/entities/, can you redesign it to look better, at least a
 *    nicer design? also, remove that 'where this stands' or rewrite what was written there. dont display
 *    everything there. there should be a page for you to search or select or click next to see more"
 *
 * Four claims, and every one of them is a property of the SERVED HTML, so every one is measured by fetching
 * the addresses a reader clicks. Nothing here trusts a status code: **a 200 is not a working page**, and
 * each card's address is followed and its destination's own `h1` is read.
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────────────────────────────────
 *
 *   A. THE PAGE. The size against the 96,512 bytes the owner was looking at, the `h1`, whether any `h2`
 *      exists at all (there were none), that "Where this stands" is gone, and that **every class on the
 *      page is one the design's own stylesheets define** — fetched from the served `/design/styles/`.
 *   B. THE COUNT LINE AND THE FACETS. "N records · page 1 of M" is read and its N is checked against the
 *      number of cards the index actually holds: **the kinds in the filter bar are fetched one by one and
 *      their counts must sum to the same total**, so a facet cannot be a word with nothing behind it.
 *   C. PAGING. 18 cards on page 1, the Next link followed and the destination read, every page walked to
 *      the last one, the last page's size checked, no card repeated across pages, and a page past the end
 *      required to be an honest state rather than an empty grid.
 *   D. SEARCH, AND THE KIND SELECT, AND BOTH SURVIVING A PAGE TURN — proved by following a Next link with
 *      a filter set and reading the destination's own address and cards, not by reading the href alone.
 *   E. EVERY CARD. All 188 serve their own page, and each page's `h1` must be the name the card showed.
 *   F. THE DESIGN. The parity check over `apps/ozikoro/public/design/` is run here too, so the file this
 *      round touched most cannot have been edited by accident.
 *
 * USAGE
 *   node scripts/verify-round-350.mjs                 # against http://127.0.0.1:3110
 *   OZIKORO_BASE=http://127.0.0.1:3110 node scripts/verify-round-350.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BASE = process.env.OZIKORO_BASE || 'http://127.0.0.1:3110';

const problems = [];
const notes = [];

const bad = (message) => problems.push(message);
const note = (message) => notes.push(message);

async function get(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { redirect: 'follow' });
  return { url, status: res.status, body: await res.text() };
}

/** The text of the first `<h1>`, which is the reader's answer to "what page is this". */
function h1(body) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '(no h1)';
}

/**
 * React escapes `&` in an href as `&amp;`, and an address fetched with `&amp;` in it is a different address:
 * `?kind=clan&amp;page=2` is `kind=clan` plus an unknown parameter, so it renders page 1 and the walk below
 * would follow the same page sixty times. The reader's browser decodes it; so does this.
 */
const unescapeHref = (href) => href.replace(/&amp;/g, '&');

/** React splits interpolated text with `<!-- -->`; the reader never sees those. */
const text = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Every card link on the page, in document order, with the name the card showed. */
function cards(body) {
  const found = [];
  const re = /<a[^>]*href="(\/entities\/[^"]+\/)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(m[2]);
    found.push({ href: unescapeHref(m[1]), name: name ? text(name[1]) : '' });
  }
  return found;
}

/** The count line above the grid: "188 records · Clan · page 2 of 11". */
function countLine(body) {
  // The design's count row is `.spread`; the class list is matched loosely so a spacing change is not
  // mistaken for a missing count line.
  const m = /<div class="spread[^"]*">([\s\S]*?)<\/div>/.exec(body);
  return m ? text(m[1]) : '';
}

/** "Showing 1–18 of 188" and the two pager controls. */
function pager(body) {
  const nav = /<nav class="row section"[^>]*aria-label="Pagination">([\s\S]*?)<\/nav>/.exec(body);
  if (!nav) return null;
  const links = [...nav[1].matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: unescapeHref(m[1]),
    label: text(m[2]),
  }));
  const disabled = [...nav[1].matchAll(/<span class="btn btn-quiet btn-sm" aria-disabled="true">([\s\S]*?)<\/span>/g)].map(
    (m) => text(m[1])
  );
  return { showing: text(nav[1].replace(/<span class="row">[\s\S]*$/, '')), links, disabled };
}

/** The kinds offered by the filter bar, with their addresses. */
function facets(body) {
  const nav = /<nav class="sx-filterbar"[^>]*>([\s\S]*?)<\/nav>/.exec(body);
  if (!nav) return [];
  return [...nav[1].matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: unescapeHref(m[1]),
    label: text(m[2]),
  }));
}

// ── A. THE PAGE ─────────────────────────────────────────────────────────────────────────────────────

const home = await get('/entities/');
if (home.status !== 200) bad(`GET /entities/ answered ${home.status}`);
note(`GET /entities/ — ${home.status}, ${Buffer.byteLength(home.body)} bytes (was 96,512)`);

if (h1(home.body) !== 'The record') bad(`/entities/ h1 reads "${h1(home.body)}", not "The record"`);

const h2s = [...home.body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1]));
if (h2s.length === 0) bad('/entities/ still has no h2 at all');
note(`h2: ${h2s.length} — ${h2s.map((s) => JSON.stringify(s)).join(', ')}`);

if (home.body.includes('Where this stands')) bad('"Where this stands" is still on /entities/');

// Every class must be one the design defines. The stylesheets are fetched from the served site, so this
// measures the CSS a browser actually receives rather than a file on disk.
let designCss = '';
for (const sheet of ['/design/tokens.css', '/design/styles/main.css', '/design/styles/showcase.css']) {
  const res = await get(sheet);
  if (res.status !== 200) bad(`${sheet} answered ${res.status}`);
  designCss += res.body;
}
const defined = new Set([...designCss.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const used = new Set([...home.body.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
// The classes the shared layout supplies, which are not this page's to choose.
const layout = new Set(['masthead', 'nav', 'nav-account', 'platform-bar', 'site-foot', 'skip', 'wordmark', 'here', 'owner']);
const mine = [...used].filter((c) => !layout.has(c));
const undefinedClasses = [...used].filter((c) => !defined.has(c) && !layout.has(c));
if (undefinedClasses.length > 0) bad(`classes not defined by the design: ${undefinedClasses.join(', ')}`);
note(`classes on the page: ${used.size}; this page's own: ${mine.length}; undefined by the design: ${undefinedClasses.length}`);

const firstPage = cards(home.body);
if (firstPage.length !== 18) bad(`page 1 drew ${firstPage.length} cards, not 18`);
note(`page 1 cards: ${firstPage.length}; unique: ${new Set(firstPage.map((c) => c.href)).size}`);

// ── B. THE COUNT LINE AND THE FACETS ────────────────────────────────────────────────────────────────

const line = countLine(home.body);
const totalFromLine = Number((/^([\d,]+) record/.exec(line) || [])[1]?.replace(/,/g, '') ?? NaN);
const pagesFromLine = Number((/page \d+ of ([\d,]+)/.exec(line) || [])[1]?.replace(/,/g, '') ?? NaN);
if (!Number.isFinite(totalFromLine)) bad(`no count line found; the spread reads ${JSON.stringify(line)}`);
if (!Number.isFinite(pagesFromLine)) bad(`the count line carries no "page 1 of M": ${JSON.stringify(line)}`);
note(`count line: "${line}"`);

const bar = facets(home.body);
if (bar.length < 2) bad(`the filter bar offered ${bar.length} entries; it needs the kinds and a way back`);
note(`filter bar: ${bar.map((f) => f.label).join(' · ')}`);

// Every kind the bar offers is fetched and its own count read, and the counts must sum to the whole. A
// facet with nothing behind it, or a total that is not the sum of its parts, is the fault this catches.
let facetSum = 0;
const facetCounts = [];
for (const facet of bar.filter((f) => f.href.includes('kind='))) {
  const page = await get(facet.href);
  if (page.status !== 200) {
    bad(`${facet.href} answered ${page.status}`);
    continue;
  }
  const count = Number((/^([\d,]+) record/.exec(countLine(page.body)) || [])[1]?.replace(/,/g, '') ?? NaN);
  const drawn = new Set(cards(page.body).map((c) => c.href)).size;
  if (count === 0) bad(`${facet.href} offers a kind with no records behind it`);
  // Every card on a kind-filtered page must carry that kind's own `<small>`.
  const kinds = new Set([...page.body.matchAll(/<small>([^<]*)<\/small>/g)].map((m) => m[1]));
  if (kinds.size !== 1 || !kinds.has(facet.label)) {
    bad(`${facet.href} drew cards of kinds ${[...kinds].join(', ')}, not ${facet.label}`);
  }
  if (drawn === 0) bad(`${facet.href} drew no cards`);
  facetSum += count;
  facetCounts.push(`${facet.label} ${count}`);
}
if (facetSum !== totalFromLine) {
  bad(`the kinds count ${facetSum} between them where the index says ${totalFromLine}`);
}
note(`facet counts: ${facetCounts.join(', ')} — sum ${facetSum}`);

// ── C. PAGING ───────────────────────────────────────────────────────────────────────────────────────

const seen = new Map(firstPage.map((c) => [c.href, 1]));
/** Every card's own name, from every page, so the destination check is not limited to page 1. */
const cardNames = new Map(firstPage.map((c) => [c.href, c.name]));
let page = 1;
let pageBody = home.body;
let guard = 0;

while (guard++ < 60) {
  const bar = pager(pageBody);
  if (!bar) {
    bad(`page ${page} has no pager`);
    break;
  }
  const next = bar.links.find((l) => /Next/.test(l.label));
  const last = page === pagesFromLine;
  if (last && next) bad(`the last page (${page}) still offers a Next link to ${next.href}`);
  if (!last && !next) {
    bad(`page ${page} of ${pagesFromLine} offers no Next link`);
    break;
  }
  if (last) {
    if (bar.links.some((l) => /Previous/.test(l.label)) === false) bad(`the last page offers no Previous link`);
    const expectedLast = totalFromLine - (pagesFromLine - 1) * 18;
    if (cards(pageBody).length !== expectedLast) {
      bad(`the last page drew ${cards(pageBody).length} cards where ${expectedLast} remain`);
    }
    note(`last page ${page}: ${cards(pageBody).length} cards, pager "${bar.showing}"`);
    break;
  }

  // Follow the Next link as a reader does, and read where it lands.
  const landing = await get(next.href.replace(BASE, ''));
  if (landing.status !== 200) {
    bad(`following Next from page ${page} (${next.href}) answered ${landing.status}`);
    break;
  }
  page += 1;
  pageBody = landing.body;

  const onPage = cards(pageBody);
  for (const card of onPage) {
    if (seen.has(card.href)) bad(`${card.href} is drawn on page ${seen.get(card.href)} and again on page ${page}`);
    seen.set(card.href, page);
    cardNames.set(card.href, card.name);
  }
  if (page < pagesFromLine && onPage.length !== 18) {
    bad(`page ${page} drew ${onPage.length} cards where a full page is 18`);
  }
  const lineHere = countLine(pageBody);
  if (!lineHere.includes(`page ${page} of ${pagesFromLine}`)) {
    bad(`page ${page} says ${JSON.stringify(lineHere)} rather than "page ${page} of ${pagesFromLine}"`);
  }
}

if (seen.size !== totalFromLine) {
  bad(`the pages drew ${seen.size} distinct cards where the index claims ${totalFromLine} records`);
}
note(`paging: ${page} pages walked, ${seen.size} distinct cards, none repeated`);

// A page past the end must be an honest state, not an empty grid.
const past = await get(`/entities?page=${pagesFromLine + 1}`);
if (past.status !== 200) bad(`/entities?page=${pagesFromLine + 1} answered ${past.status}`);
else {
  if (cards(past.body).length !== 0) bad(`the page past the end still drew ${cards(past.body).length} cards`);
  if (!past.body.includes('class="empty section"')) bad('the page past the end drew no honest state');
  const heading = (/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(past.body) || [])[1];
  if (!heading || !/There is no page/.test(text(heading))) {
    bad(`the page past the end reads ${JSON.stringify(text(heading || ''))}`);
  }
  note(`past the end: "${text((/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(past.body) || [])[1] || '')}" — .empty drawn`);
}

// Nonsense page parameters must not become an empty grid either.
for (const raw of ['abc', '0', '-3']) {
  const res = await get(`/entities?page=${raw}`);
  const n = cards(res.body).length;
  if (res.status !== 200 || n !== 18) bad(`?page=${raw} answered ${res.status} with ${n} cards, not the first page`);
}
note('?page=abc, ?page=0 and ?page=-3 all render page 1');

// ── D. SEARCH AND THE KIND SELECT, EACH SURVIVING A PAGE TURN ───────────────────────────────────────

/**
 * Follow a filtered listing through every page.
 *
 * The point is not that the first page carries the filter — it is that the SECOND one does, because a filter
 * that quietly resets when the reader presses Next is a control that does nothing, in a new coat. So the Next
 * link's own `href` is required to carry every term of the query, it is then followed, and the landing page's
 * own count line is read.
 */
async function walkFiltered(label, query, expectedTotal) {
  const terms = query.split('&');
  const first = await get(`/entities?${query}`);
  if (first.status !== 200) {
    bad(`${label}: /entities?${query} answered ${first.status}`);
    return;
  }
  const total = Number((/^([\d,]+) record/.exec(countLine(first.body)) || [])[1]?.replace(/,/g, '') ?? NaN);
  if (total !== expectedTotal) bad(`${label}: a filtered listing says ${total} records, not ${expectedTotal}`);
  if (total <= 18) {
    bad(`${label}: only ${total} records, so no page turn can be proved`);
    return;
  }
  let body = first.body;
  let turns = 0;
  let cardsSeen = 0;
  for (let page = 1; page <= 60; page += 1) {
    const bar = pager(body);
    if (!bar) {
      bad(`${label}: page ${page} has no pager`);
      return;
    }
    cardsSeen += cards(body).length;
    const next = bar.links.find((l) => /Next/.test(l.label));
    if (!next) break;
    for (const term of terms) {
      if (!next.href.includes(term)) bad(`${label}: the Next link ${next.href} drops "${term}"`);
    }
    const landing = await get(next.href);
    if (landing.status !== 200) {
      bad(`${label}: following ${next.href} answered ${landing.status}`);
      return;
    }
    body = landing.body;
    turns += 1;
    const lineHere = countLine(body);
    if (!lineHere.includes(`page ${page + 1} of`)) {
      bad(`${label}: after the turn the count line reads ${JSON.stringify(lineHere)}`);
    }
  }
  if (cardsSeen !== total) bad(`${label}: the pages drew ${cardsSeen} cards where the filter matches ${total}`);
  note(`${label}: /entities?${query} — ${total} records, ${turns} page turn(s) followed, filter kept`);
}

// A search that spans more than one page is found by measurement rather than written down.
const letters = ['a', 'e', 'i', 'o', 'n'];
let searchLetter = null;
for (const letter of letters) {
  const res = await get(`/entities?q=${letter}`);
  const total = Number((/^([\d,]+) record/.exec(countLine(res.body)) || [])[1]?.replace(/,/g, '') ?? NaN);
  if (total > 18) {
    searchLetter = { letter, total };
    break;
  }
}
if (!searchLetter) bad('no one-letter search matches more than 18 records, so a page turn cannot be proved');
else await walkFiltered('search', `q=${searchLetter.letter}`, searchLetter.total);

// There is not a search AND a kind together on one page unless a kind holds more than 18 records, which is
// measured rather than assumed; the two are combined only when both hold enough to make a turn possible.
const biggest = facetCounts
  .map((s) => {
    const [label, n] = s.split(' ');
    return { label, count: Number(n) };
  })
  .sort((a, b) => b.count - a.count)[0];
if (!biggest || biggest.count <= 18) {
  bad(`no kind holds more than 18 records (biggest: ${biggest ? `${biggest.label} ${biggest.count}` : 'none'})`);
} else {
  const slug = bar.find((f) => f.label === biggest.label)?.href.split('kind=')[1];
  await walkFiltered(`kind select (${biggest.label})`, `kind=${slug}`, biggest.count);
}

// The two controls must compose as well as work alone: a kind chosen while a search is set must keep the
// search, and a search submitted while a kind is set must keep the kind. Both are read off the served HTML.
if (searchLetter && biggest) {
  const slug = bar.find((f) => f.label === biggest.label)?.href.split('kind=')[1];
  const both = await get(`/entities?q=${searchLetter.letter}&kind=${slug}`);
  const kindsOnPage = new Set([...both.body.matchAll(/<small>([^<]*)<\/small>/g)].map((m) => m[1]));
  if (kindsOnPage.size > 1) bad(`?q=${searchLetter.letter}&kind=${slug} drew kinds ${[...kindsOnPage].join(', ')}`);
  const otherKinds = [...both.body.matchAll(/<nav class="sx-filterbar"[^>]*>([\s\S]*?)<\/nav>/g)][0]?.[1] ?? '';
  for (const link of otherKinds.matchAll(/<a[^>]*href="([^"]*)"[^>]*>/g)) {
    if (link[1].includes('kind=') && !link[1].includes(`q=${searchLetter.letter}`)) {
      bad(`choosing a kind while searching drops the search: ${link[1]}`);
    }
  }
  if (!/name="kind"/.test(both.body)) {
    bad('the search form carries no hidden kind, so searching would drop the kind filter');
  }
  note(`search + kind together: /entities?q=${searchLetter.letter}&kind=${slug} — kind kept on every filter link, search kept on the form`);
}

// A kind the graph does not file must fall back to the whole record rather than to an empty grid.
const bogus = await get('/entities?kind=bogus');
if (Number((/^([\d,]+) record/.exec(countLine(bogus.body)) || [])[1]?.replace(/,/g, '') ?? NaN) !== totalFromLine) {
  bad(`?kind=bogus did not fall back to the whole record (${countLine(bogus.body)})`);
}
if (cards(bogus.body).length !== 18) bad(`?kind=bogus drew ${cards(bogus.body).length} cards`);
note('?kind=bogus falls back to the unfiltered index');

// A search that matches nothing must say why rather than drawing an empty grid.
const nothing = await get('/entities?q=zzzzznotarecord');
if (nothing.body.includes('class="sx-town-grid"')) bad('a search matching nothing still drew the grid');
if (!nothing.body.includes('class="empty section"')) bad('a search matching nothing drew no explanation');
note('a search matching nothing: .empty with an explanation, no grid');

// ── E. EVERY CARD'S DESTINATION ─────────────────────────────────────────────────────────────────────

// All 188, fetched a few at a time, and each page's own `h1` read — the name the card showed, not the
// status code. A card whose destination says something else is the fault this catches.
const all = [...seen.keys()];
const mismatched = [];
const notOk = [];
let cursor = 0;
async function worker() {
  while (cursor < all.length) {
    const href = all[cursor++];
    const res = await get(href.replace(BASE, ''));
    if (res.status !== 200) {
      notOk.push(`${href} answered ${res.status}`);
      continue;
    }
    const cardName = cardNames.get(href);
    const pageName = h1(res.body);
    if (cardName && pageName !== cardName) mismatched.push(`${href}: card "${cardName}" -> page h1 "${pageName}"`);
  }
}
await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
if (notOk.length > 0) bad(`${notOk.length} card destinations did not answer 200: ${notOk.slice(0, 5).join('; ')}`);
if (mismatched.length > 0) bad(`${mismatched.length} card destinations read a different h1: ${mismatched.slice(0, 5).join('; ')}`);
note(`card destinations: ${all.length} followed, ${all.length - notOk.length - mismatched.length} whose h1 is the name the card showed`);

// ── F. THE DESIGN ───────────────────────────────────────────────────────────────────────────────────

/** The parity check the brief prints verbatim, run here so the round cannot pass while the design moved. */
function parity() {
  const src = 'design/calm-comfort-construct/public/design';
  const dst = 'apps/ozikoro/public/design';
  const files = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...files(full));
      else out.push(full);
    }
    return out;
  };
  const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  let same = 0;
  let differ = 0;
  let missing = 0;
  for (const file of files(src)) {
    const other = join(dst, relative(src, file));
    try {
      statSync(other);
    } catch {
      missing += 1;
      continue;
    }
    if (sha(file) === sha(other)) same += 1;
    else differ += 1;
  }
  return `identical ${same} differing ${differ} missing ${missing}`;
}
const parityLine = parity();
if (parityLine !== 'identical 63 differing 0 missing 0') bad(`design parity: ${parityLine}`);
note(`design parity: ${parityLine}`);

// ── THE VERDICT ─────────────────────────────────────────────────────────────────────────────────────

console.log('');
for (const n of notes) console.log(`  ${n}`);
if (problems.length === 0) {
  console.log('\nPROBLEMS: 0\n');
} else {
  console.log('');
  for (const p of problems) console.log(`  PROBLEM  ${p}`);
  console.log(`\nPROBLEMS: ${problems.length}\n`);
  process.exitCode = 1;
}
