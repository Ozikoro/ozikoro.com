/*
 * verify-round-346.mjs — the front page's town tiles, `/town/`, `/town/<slug>/` and `/towns/`, measured on
 * the served site.
 *
 * ── WHAT THE OWNER REPORTED, AND WHAT THIS MEASURES ─────────────────────────────────────────────
 *
 *   "inside http://127.0.0.1:3110/town/, why is the homepage showing that when you click on igbodo, and
 *    then also show me links to other clans and towns, instead of showing me articles relating to the
 *    igbodo?"
 *   "also, why it not showing the details of igbodo, just the way the demo shows?"
 *   "also, why is the towns and clans page not showing like the demo?"
 *
 * Every one of those is a property of the SERVED HTML, so every one is measured here by fetching the
 * addresses a reader clicks — and, for the article cards, by FOLLOWING each card's link and reading the
 * destination's own `h1` rather than trusting the status code. **A 200 is not a working link**; this
 * repository has paid for that lesson three times.
 *
 * ── WHAT IT CHECKS, IN THE ORDER THE OWNER MET THEM ─────────────────────────────────────────────
 *
 *   A. THE FRONT PAGE. Six tiles under "Explore by town". Each one's `href` must be that town's own page,
 *      no two may share an address, and none may be left at `/town/` — which is what all six were, and
 *      which is the click the owner described.
 *   B. `/town/`. The design's example heading — "Histories about Igbodo" — must be gone, because the list
 *      beneath it is the archive's places and not Igbodo's histories. The list must be the design's own
 *      `sx-town-articles` card markup rather than `.entry` articles nested inside a card grid.
 *   C. `/town/<slug>/`. The design's `#histories` section must exist, and where the archive links a record
 *      to that community the card must be there, in the design's markup, with its link's role in the
 *      `<small>`. Each card's address is followed and the destination's `h1` is read.
 *   D. THE TWO IGBODOS. `/town/igbodo/` is a section in Enugu; `/town/igbodo-northern-ika/` is the Ika
 *      town. Each must show what its OWN record is linked to. The front page's Igbodo tile is the Ika
 *      town, so it must not point at the Enugu section.
 *   E. THE EMPTY STATE. A community with no linked record must still say so in words rather than being
 *      given an invented card. The candidates are found by measurement, not by a list in this file.
 *   F. `/towns/`. The design's own sections and classes must be present in the served page, and the
 *      register's Igbodo cards must carry the `href` the design's card shape promises.
 *
 * USAGE
 *   node scripts/verify-round-346.mjs                 # against http://127.0.0.1:3110
 *   OZIKORO_BASE=http://127.0.0.1:3110 node scripts/verify-round-346.mjs
 */
const BASE = process.env.OZIKORO_BASE || 'http://127.0.0.1:3110';

const problems = [];
const notes = [];

/** Fetch a page as text, with the status so a 404 can be reported rather than parsed. */
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

/** Every `href` inside a named container, up to its first `</div>`. */
function hrefsIn(body, container) {
  const start = body.indexOf(container);
  if (start === -1) return null;
  const open = body.indexOf('>', start) + 1;
  const close = body.indexOf('</div>', open);
  return [...body.slice(open, close).matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]);
}

/** The design's own card markup: `<a href><small>…</small><strong>…</strong><span>…</span></a>`. */
function articleCards(body) {
  const start = body.indexOf('<div class="sx-town-articles">');
  if (start === -1) return [];
  const close = body.indexOf('</div>', start);
  const seg = body.slice(start, close);
  return [...seg.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    small: (/<small>([\s\S]*?)<\/small>/.exec(m[2])?.[1] ?? '').replace(/<[^>]+>/g, '').trim(),
    strong: (/<strong>([\s\S]*?)<\/strong>/.exec(m[2])?.[1] ?? '').replace(/<[^>]+>/g, '').trim(),
    span: (/<span[^>]*>([\s\S]*?)<\/span>/.exec(m[2])?.[1] ?? '').replace(/<[^>]+>/g, '').trim(),
  }));
}

async function main() {
  /* ── A. THE FRONT PAGE ─────────────────────────────────────────────────────────────────────── */
  const home = await get('/');
  console.log(`A. /  ${home.status}`);
  const strip = hrefsIn(home.body, '<div class="sx-strip reveal">');
  if (strip === null) {
    problems.push('/ has no "Explore by town" strip: the container marker is gone');
  } else {
    console.log(`   town tiles            ${strip.length}`);
    for (const href of strip) console.log(`     ${href}`);
    if (strip.length !== 6) problems.push(`/ draws ${strip.length} town tiles, not the design's six`);
    if (new Set(strip).size !== strip.length) problems.push(`/ gives two tiles the same address: ${strip.join(', ')}`);
    if (strip.includes('/town/')) problems.push('/ still sends a town tile to /town/, which is the fault reported');
    const igbodo = strip[0];
    notes.push(`the front page's Igbodo tile points at ${igbodo}`);
    if (igbodo !== '/town/igbodo-northern-ika/') {
      problems.push(`the front page's Igbodo tile points at ${igbodo}, not the Ika town's own page`);
    }
  }

  /* ── B. /town/ ────────────────────────────────────────────────────────────────────────────── */
  const townIndex = await get('/town/');
  console.log('');
  console.log(`B. /town/  ${townIndex.status}  h1 "${h1(townIndex.body)}"`);
  if (townIndex.body.includes('Histories about Igbodo')) {
    problems.push('/town/ still carries the design\'s example heading "Histories about Igbodo" over the register');
  }
  const asideOpen = townIndex.body.indexOf('<nav>');
  notes.push(`/town/ on-this-page: ${townIndex.body.slice(asideOpen, townIndex.body.indexOf('</nav>', asideOpen)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
  const townCards = articleCards(townIndex.body);
  console.log(`   register card rows    ${townCards.length}`);
  if (townCards.length === 0) problems.push('/town/ draws no places in the design\'s sx-town-articles container');
  if (townIndex.body.slice(townIndex.body.indexOf('<section id="histories"')).includes('<article class="entry">')) {
    problems.push('/town/ still nests .entry articles inside the design\'s card grid');
  }

  /* ── C, D, E. ONE COMMUNITY, BY SLUG ──────────────────────────────────────────────────────── */
  const communities = ['igbodo', 'igbodo-northern-ika', 'umunri', 'abaja-udi'];
  const linked = [];
  const empty = [];
  for (const slug of communities) {
    const page = await get(`/town/${slug}/`);
    const cards = articleCards(page.body);
    const hasHistories = page.body.includes('id="histories"');
    console.log('');
    console.log(`C. /town/${slug}/  ${page.status}  h1 "${h1(page.body)}"  histories=${hasHistories}  cards=${cards.length}`);
    if (page.status !== 200) { problems.push(`/town/${slug}/ answered ${page.status}`); continue; }
    if (!hasHistories) problems.push(`/town/${slug}/ draws no #histories section, which the design draws`);
    for (const card of cards) {
      const dest = await get(card.href);
      console.log(`     ${card.href}  ${dest.status}  h1 "${h1(dest.body)}"`);
      console.log(`       small "${card.small}"  strong "${card.strong}"  span "${card.span}"`);
      if (dest.status !== 200) problems.push(`the card ${card.href} on /town/${slug}/ answered ${dest.status}`);
      if (h1(dest.body) === '(no h1)') problems.push(`the card ${card.href} landed on a page with no h1`);
      if (!card.span.toLowerCase().includes('read article')) {
        problems.push(`the card ${card.href} has no "Read article" line: the design's <span> is "${card.span}"`);
      }
      if (card.strong === '') problems.push(`the card ${card.href} has no <strong> title`);
    }
    if (cards.length > 0) linked.push(slug); else empty.push(slug);
  }

  console.log('');
  console.log(`   communities with real cards: ${linked.join(', ') || '(none)'}`);
  console.log(`   communities with the honest empty state: ${empty.join(', ') || '(none)'}`);
  if (linked.length === 0) problems.push('no community on the served site shows a single real article card');
  if (empty.length === 0) problems.push('no measured community shows the empty state, so it is not covered here');

  /* ── F. /towns/ ───────────────────────────────────────────────────────────────────────────── */
  const towns = await get('/towns/');
  console.log('');
  console.log(`F. /towns/  ${towns.status}  h1 "${h1(towns.body)}"  ${towns.body.length} bytes`);
  /*
   * The design's own classes and sections, by name. `towns.html` draws a discovery hero, a GET search form,
   * a `sx-town-grid` of cards and a closing `sx-source-note sx-light-note`; the register's four-step finder
   * replaces the search form at the owner's own instruction and is measured separately.
   */
  const wanted = [
    'sx-discovery-hero', 'sx-town-grid', 'sx-source-note', 'sx-light-note',
    'sx-reg-finder', 'sx-reg-steps', 'sx-reg-search', 'sx-reg-levels',
  ];
  for (const cls of wanted) {
    const n = towns.body.split(cls).length - 1;
    console.log(`   .${cls.padEnd(20)} ${n}`);
    if (n === 0) problems.push(`/towns/ does not draw the design's .${cls}`);
  }
  const gridCards = hrefsIn(towns.body, '<div class="sx-town-grid">') ?? [];
  const withImg = (towns.body.slice(towns.body.indexOf('<div class="sx-town-grid">')).match(/<a\b[^>]*>\s*<img/g) ?? []).length;
  console.log(`   cards                 ${gridCards.length}   with the design's <img>: ${withImg}`);
  if (gridCards.length === 0) problems.push('/towns/ draws no cards in the design\'s sx-town-grid');
  if (withImg === 0) problems.push('/towns/ draws none of the design\'s card photographs');
  const igbodos = gridCards.filter((h) => h.startsWith('/town/igbodo'));
  console.log(`   the register's Igbodo cards: ${igbodos.join(', ')}`);
  if (igbodos.length !== 2) problems.push(`/towns/ draws ${igbodos.length} Igbodo cards; the register holds two`);
  for (const href of igbodos) {
    const dest = await get(href);
    console.log(`     ${href}  ${dest.status}  h1 "${h1(dest.body)}"`);
    if (dest.status !== 200) problems.push(`the register's Igbodo card ${href} answered ${dest.status}`);
  }

  console.log('');
  console.log(`NOTES: ${notes.length}`);
  for (const n of notes) console.log(`  · ${n}`);
  console.log(`PROBLEMS: ${problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);
  if (problems.length) process.exitCode = 1;
}

await main();
