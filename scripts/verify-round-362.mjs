/*
 * verify-round-362.mjs — the register's card, and the two Igbodos, measured on the served site.
 *
 * ── THE TWO CLAIMS, AND WHY BOTH ARE FETCHED RATHER THAN REASONED ABOUT ──────────────────────────────
 *
 *   1. **`/towns/` IS THE TOWNS REGISTER AND ITS CARD IS THE DESIGN'S CARD.** `towns.html` draws
 *      `<a href><img><span><small>REGION</small><strong>NAME</strong><em>View connected records →</em></span></a>`,
 *      so a card here is asserted to hold exactly those four elements and that sentence. **The design's
 *      own grid is read from the served `/design-screen/towns/` — the deliverable with the archive's data
 *      in it — so the shape compared is the shape a reader is given, not a restatement of it.**
 *
 *   2. **THE REGISTER HOLDS TWO PUBLISHED ENTRIES CALLED IGBODO**, a *section* in Enugu (`/town/igbodo/`)
 *      and the Ika *town* in Delta (`/town/igbodo-northern-ika/`), and a reader must land on the one the
 *      card named. So each card's destination is followed and **its own page is required to say which of
 *      the two it is** — the region from the record and the kind from the register — because a page that
 *      says only "Igbodo" tells a reader nothing about which Igbodo they reached.
 *
 * Nothing here trusts a 200: an address is followed and the destination's own text is read.
 *
 * USAGE
 *   node scripts/verify-round-362.mjs                 # against http://127.0.0.1:3110
 *   OZIKORO_BASE=http://127.0.0.1:3110 node scripts/verify-round-362.mjs
 */
const BASE = process.env.OZIKORO_BASE || 'http://127.0.0.1:3110';

const problems = [];
const notes = [];
const bad = (message) => problems.push(message);
const note = (message) => notes.push(message);

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  return { status: res.status, url: res.url, body: await res.text() };
}

/** The text of the first `<h1>`, which is a reader's answer to "what page is this". */
function h1(body) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '(no h1)';
}

/** The design's card grid, by its own class, and every `<a>` in it. */
function cardsIn(body) {
  const i = body.indexOf('<div class="sx-town-grid">');
  if (i < 0) return [];
  const rest = body.slice(i);
  const j = rest.indexOf('</div>');
  return (rest.slice(0, j < 0 ? rest.length : j).match(/<a\b[\s\S]*?<\/a>/g) ?? []);
}

const DESIGN_CARD =
  /^<a href="[^"]+"><img src="[^"]+" alt="" loading="lazy"\/?><span><small>[\s\S]*?<\/small><strong[^>]*>[\s\S]*?<\/strong><em>View connected records →<\/em><\/span><\/a>$/;
const DESIGN_CARD_NO_PHOTO =
  /^<a href="[^"]+"><span><small>[\s\S]*?<\/small><strong[^>]*>[\s\S]*?<\/strong><em>View connected records →<\/em><\/span><\/a>$/;

async function main() {
  /* ── A. THE DESIGN'S OWN CARD, SERVED ───────────────────────────────────────────────────────── */
  const design = await get('/design-screen/towns/');
  console.log(`A. /design-screen/towns/  ${design.status}  ${design.body.length} bytes`);
  const designCards = cardsIn(design.body);
  console.log(`   the design's cards: ${designCards.length}`);
  let designWithPhoto = 0;
  for (const card of designCards) {
    if (/<img\b/.test(card)) designWithPhoto += 1;
    /*
     * THE SHAPE, NOT THE SENTENCE. `/design-screen/towns/` is filled by `fillTowns`, whose `<em>` is the
     * record count, while `towns.html` itself draws `View connected records →`. The authoritative check on
     * the design's own `<em>` is the unit test that reads the file (`design-fill.test.ts`), so this only
     * measures the served screen — whether it leads with a photograph, and whether it holds the design's
     * four elements at all.
     */
    if (!/^<a href="[^"]+">(<img\b[^>]*>)?<span><small>[\s\S]*?<\/small><strong[^>]*>[\s\S]*?<\/strong><em>[\s\S]*?<\/em><\/span><\/a>$/.test(card.replace(/\s*\/>/g, '>'))) {
      bad(`the design screen's own card is not the design's four-element shape: ${card.slice(0, 160)}`);
    }
  }
  console.log(`   of those, leading with a photograph: ${designWithPhoto}`);
  if (designCards.length === 0) bad('/design-screen/towns/ draws no cards, so nothing was compared');

  /* ── B. THE REGISTER'S CARD AT /towns/ ──────────────────────────────────────────────────────── */
  const towns = await get('/towns/');
  console.log('');
  console.log(`B. /towns/  ${towns.status} → ${towns.url}  h1 "${h1(towns.body)}"`);
  const register = cardsIn(towns.body);
  console.log(`   the register's cards on page 1: ${register.length}`);
  if (register.length === 0) bad('/towns/ draws no cards in the design\'s sx-town-grid');
  let registerWithPhoto = 0;
  for (const card of register) {
    if (/<img\b/.test(card)) registerWithPhoto += 1;
    /*
     * React's HTML has no self-closing slash, and `render`'s string does — the shape is the same card
     * either way, so the slash is normalised before the comparison rather than asserted.
     */
    const shape = card.replace(/\s*\/>/g, '>');
    if (!(DESIGN_CARD.test(shape) || DESIGN_CARD_NO_PHOTO.test(shape))) {
      bad(`the register's card is not the design's four-element shape: ${card.slice(0, 200)}`);
    }
    /* NOTHING THE DESIGN DOES NOT DRAW: no sentence between the region and the name. */
    if (/ · /.test(card)) {
      bad(`the register's card carries a sentence the design does not draw: ${card.slice(0, 200)}`);
    }
  }
  console.log(`   leading with a photograph: ${registerWithPhoto}`);
  if (registerWithPhoto === 0) bad('/towns/ draws none of the design\'s card photographs');

  /* ── C. THE TWO IGBODOS, EACH REACHED FROM THE REGISTER ────────────────────────────────────── */
  const filtered = await get('/clan-towns/?q=Igbodo');
  const igbodoCards = cardsIn(filtered.body).filter((card) => /href="\/town\/igbodo/.test(card));
  console.log('');
  console.log(`C. /clan-towns/?q=Igbodo  ${filtered.status}  Igbodo cards: ${igbodoCards.length}`);
  for (const card of igbodoCards) console.log(`   ${card.replace(/<[^>]+>/g, '|').replace(/\|+/g, ' | ').trim()}`);

  const expected = [
    { href: '/town/igbodo/', kind: 'section', region: 'Enugu', name: 'Igbodo' },
    { href: '/town/igbodo-northern-ika/', kind: 'town', region: 'Delta', name: 'Igbodo' },
  ];
  for (const want of expected) {
    const card = igbodoCards.find((c) => c.includes(`href="${want.href}"`));
    if (!card) {
      bad(`the register draws no card for ${want.href}, so a reader cannot reach the ${want.region} ${want.kind}`);
      continue;
    }
    const region = /<small>([\s\S]*?)<\/small>/.exec(card)?.[1].replace(/<[^>]+>/g, '').trim();
    const name = /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(card)?.[1].replace(/<[^>]+>/g, '').trim();
    console.log(`   card ${want.href}  region="${region}"  name="${name}"  photograph=${/<img\b/.test(card) ? 'yes' : 'no'}`);
    if (region !== want.region) bad(`the card for ${want.href} says region "${region}"; the record says ${want.region}`);
    if (name !== want.name) bad(`the card for ${want.href} says name "${name}"; the record says ${want.name}`);
  }

  /* ── D. EACH DESTINATION SAYS WHICH PLACE IT IS ────────────────────────────────────────────── */
  console.log('');
  console.log('D. the destinations');
  for (const want of expected) {
    const dest = await get(want.href);
    const text = dest.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log(`   ${want.href}  ${dest.status}  h1 "${h1(dest.body)}"`);
    if (dest.status !== 200) {
      bad(`${want.href} answered ${dest.status}`);
      continue;
    }
    if (h1(dest.body) !== want.name) bad(`${want.href} is headed "${h1(dest.body)}", not "${want.name}"`);
    /*
     * THE TWO THINGS THAT TELL THE TWO PLACES APART, ON THE PAGE ITSELF: the register's kind and the
     * record's region. Both are the archive's own values, and neither is a sentence this round wrote.
     */
    if (!text.includes(`${want.kind} in the archive`)) {
      bad(`${want.href} does not say it is a ${want.kind}, so a reader cannot tell the two Igbodos apart`);
    }
    if (!text.includes(want.region)) {
      bad(`${want.href} does not name the region ${want.region} it is recorded in`);
    }
    /* A REGION ALONE IS NOT ENOUGH IF THE OTHER PLACE'S NAME IS THE ONLY HEADING. */
    if (want.href === '/town/igbodo-northern-ika/' && !text.includes('Ika North East')) {
      note('the Ika town page no longer names its local government area');
    }
  }
  if (igbodoCards.length !== 0 && igbodoCards.length !== 2) {
    bad(`the register draws ${igbodoCards.length} Igbodo cards; the register holds two published entries named Igbodo`);
  }

  console.log('');
  console.log(`NOTES: ${notes.length}`);
  for (const n of notes) console.log(`  · ${n}`);
  console.log(`PROBLEMS: ${problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);
  if (problems.length) process.exitCode = 1;
}

await main();
