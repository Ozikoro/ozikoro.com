/*
 * check-page-variants.mjs — a page's bare address and its parameterised address, checked against each other.
 *
 * ── THE FAULT THIS EXISTS FOR, TWICE MEASURED ─────────────────────────────────────────────────────
 *
 *   * **2026-10-04, the front page.** Six town tiles on `/` all opened `/town/` — one address for six
 *     records — because the tile carried its record in `data-*` and the link did not carry it at all.
 *   * **2026-10-04, the film page.** `/watch-video/?v=<id>` was restructured on the owner's instruction and
 *     **`/watch-video/` with no `?v=` was left alone**, deliberately, as "Option B". The owner opened the
 *     bare address — the one the front page's film card and the inline player both reach — and found the one
 *     section he had asked to have removed, its "On this page" nav, its transcript statement, the design's
 *     boilerplate in the description slot, and a "Low-bandwidth reading" button pointing at `#transcript`.
 *     Every one of his four instructions was carried out on all eighteen `?v=` pages and on none of the page
 *     he was looking at.
 *
 * **Both faults answered 200.** Neither was visible from a status code, a byte count or a page that renders.
 * The only instrument that sees them is one that **opens both variants and compares them**, and one that
 * **follows every control and every fragment on the page and reads where it lands**.
 *
 * ── WHAT IT CHECKS ────────────────────────────────────────────────────────────────────────────────
 *
 *   1. THE FAMILIES. Every address with a bare and a parameterised form is fetched both ways and its SHAPE
 *      compared: whether the article is on the page, whether the reading section and its labels are served,
 *      whether the design's own related block stands, whether the description slot carries the design's
 *      fixed sentence, which controls the page offers, and whether every fragment it writes resolves. A
 *      difference is a fault unless this file records why it is expected — `allow`, with the reason, and the
 *      reason is printed with the difference so an allowance cannot hide a fault quietly.
 *   2. THE FRAGMENTS. Every in-page fragment on every page fetched, resolved against that page's own ids.
 *   3. THE CONTROLS. Every control on a family page is followed and its destination's `<h1>` read, so "the
 *      button works" is a destination rather than a claim.
 *   4. THE IDENTITY. Every element that carries a per-record address in a `data-<kind>-page` attribute must
 *      also carry that record's own identity, and the address must contain it. **This is the specific rule
 *      the town tiles and the inline player's own link both broke**: a control that discards its own
 *      parameter is invisible to a status check and visible only from the reader's side.
 *   5. WHO LINKS THE BARE ADDRESS. A breadth-first crawl of the served site — seeded with `/` and every
 *      design screen, because those are the pages whose markup can carry a link at all — reporting every
 *      served page whose HTML links a declared bare address, by following links rather than by grepping
 *      source. The crawl's own coverage is printed, because a bounded crawl that does not say what it did
 *      not reach is the failure this section exists to avoid.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/check-page-variants.mjs                 # families, fragments, controls, identity, crawl 40
 *   node scripts/check-page-variants.mjs --crawl 120     # a wider link crawl
 *   node scripts/check-page-variants.mjs --no-crawl      # the structural checks only, ~10 s
 *   BASE=http://127.0.0.1:3110 node scripts/check-page-variants.mjs
 *
 * Exit status is 0 only when nothing disagreed. **The crawl is bounded on purpose**: the served surface is
 * about 15,000 addresses and the review server is a single PGlite process that answers about one request a
 * second, so a full crawl is hours. What is always fetched is every design screen, which is the only markup
 * that can carry one of these links; the rest is sampled and the sample size is printed.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASE = (process.env.BASE ?? 'http://127.0.0.1:3110').replace(/\/$/, '');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const NO_CRAWL = argv.includes('--no-crawl');
const CRAWL_BUDGET = Number(flag('--crawl', '40'));
const FOLLOW_BUDGET = Number(flag('--follow', '24'));

/* ── THE FAMILIES ────────────────────────────────────────────────────────────────────────────────
 *
 * Every reader-facing address that has a bare form and a parameterised one, and what the parameter means.
 * `param: null` records an address whose route reads no parameter — measured by asking it with one and
 * comparing, because "it takes no parameter" is a claim about a served page and not about its source.
 *
 * `allow` is the list of shape keys a difference is expected in, each with the reason. **Everything not
 * named there is a fault.** An allowance is a decision someone made and wrote down; a difference without
 * one is the fault this file exists for.
 */
const FAMILIES = [
  {
    name: 'watch-video',
    bare: '/watch-video/',
    param: '/watch-video/?v=LL8YX0pXzdI',
    parameter: '`v` selects the film. The bare address is the design’s own film — E3UBv8pmLxE — for which the archive holds no record: `?v=E3UBv8pmLxE` answers 404.',
    allow: {
      controls: 'a page with no record cannot offer “This film’s page”, and its “Low-bandwidth reading” has nothing to read — the difference is the decision, and it is stated on the page',
      controlCount: 'same decision: the bare page offers two controls, one of them inert with its reason',
    },
  },
  {
    name: 'watch',
    bare: '/watch/',
    param: '/watch/?page=2',
    parameter: '`page` selects a page of the film list; the bare address is page 1. The route reads it (`apps/ozikoro/app/design-screen/[screen]/route.ts`).',
    allow: {
      controls: 'the pager differs by page and is printed',
      cardCount: 'the films on page 2 are different films; the count and the identities are printed',
    },
  },
  {
    name: 'archive-index',
    bare: '/archive-index/',
    param: '/archive-index/?topic=cultural-heritage',
    parameter: '`topic` filters the records list. The route reads it (`url.searchParams.get(\'topic\')`).',
    allow: {},
  },
  {
    name: 'archive',
    bare: '/archive/',
    param: '/archive/?page=2',
    parameter: 'the application’s own records index reads `page`, `topic`, `q`, `place`, `ethnic`, `entity`, `role`, `period`, `source`, `completeness` and `order`.',
    allow: {
      controls: 'the filter rail and the pager are content',
      controlCount: 'a page past the first carries “← Previous” and the first does not',
    },
  },
  {
    name: 'cultural-event',
    bare: '/cultural-event/',
    param: '/cultural-event/?id=1',
    parameter: 'MEASURED: the served route reads no parameter. `fillCulturalEvent(html)` takes none, so both addresses are the same page and any query string is ignored.',
    allow: {},
  },
  {
    name: 'listen',
    bare: '/listen/',
    param: '/listen/?page=2',
    parameter: 'MEASURED: the served route reads no parameter (`fillListen(html, tracks)`); the page lists every recording the archive holds, in one view.',
    allow: {},
  },
  {
    name: 'folklore-reader',
    bare: '/folklore-reader/',
    param: '/folklore-reader/?story=x',
    parameter: 'MEASURED: the served route reads no parameter — it takes the alphabetically first story in the folklores topic, so there is no per-record address at all. That is a finding, not an allowance.',
    allow: {},
  },
  {
    name: 'igbo-calendar',
    bare: '/igbo-calendar/',
    param: '/igbo-calendar/?date=2026-01-01',
    parameter: 'MEASURED: the design screen is served at this address and reads no parameter. **`apps/ozikoro/app/igbo-calendar/page.tsx` reads `?date=`, `?day=` and `?year=` and is shadowed by the middleware’s rewrite** — so the three bookmarked views the app route documents are not reachable at the address it documents them at. That is a finding.',
    allow: {},
  },
  {
    name: 'podcast',
    bare: '/podcast/',
    param: null,
    parameter: 'MEASURED: there is no bare form — `/podcast/` answers 404. The parameterised forms are `/podcast/<slug>/transcript.txt` (the file the feed names) and `/podcast/<slug>/transcript/` (the reader’s page).',
    allow: {},
  },
];

/* ── the instrument ────────────────────────────────────────────────────────────────────────────── */

const problems = [];
const problem = (m) => { problems.push(m); console.log(`  PROBLEM  ${m}`); };

const cache = new Map();
let fetched = 0;
async function get(path) {
  if (cache.has(path)) return cache.get(path);
  let out;
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    out = { status: res.status, html: await res.text(), location: res.headers.get('location') };
  } catch (error) {
    out = { status: 0, html: '', error: String(error) };
  }
  fetched += 1;
  cache.set(path, out);
  return out;
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
const text = (s) => decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const h1Of = (html) => {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  return m ? text(m[1]) : null;
};
const titleOf = (html) => {
  const m = /<title>([\s\S]*?)<\/title>/.exec(html);
  return m ? text(m[1]) : null;
};

/*
 * THE SHAPE, WHICH IS THE THING THAT MUST NOT DIFFER. Every key here is a question the owner's instructions
 * are made of: is the article on the page, is the reading section served, is the design's boilerplate in the
 * description slot, which controls does the page offer, and does every fragment it writes land.
 *
 * CONTENT IS NOT HERE — the `<h1>`, the `<title>`, the film's own id, the number of cards. Two addresses of
 * the same family are *about* different things and must be; they must not be *shaped* differently.
 */
function shapeOf(html) {
  const ids = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]));
  const controls = [...html.matchAll(/<a\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>[\s\S]*?<\/a>/g)]
    .map((m) => `${text(m[0])} => ${(/href="([^"]*)"/.exec(m[0])?.[1]) ?? '(inert, no href)'}`);
  const fragments = [...html.matchAll(/href="([^"]*#[^"]*)"/g)].map((m) => m[1]);
  const dead = fragments.filter((href) => {
    const fragment = href.slice(href.indexOf('#') + 1);
    return fragment !== '' && !ids.has(fragment);
  });
  const sections = [...html.matchAll(/<section\b[^>]*\bclass="([^"]*)"/g)]
    .map((m) => m[1].split(/\s+/).sort().join(' '));
  const cards = [...html.matchAll(/<button\b[^>]*\bclass="[^"]*sx-video-card[^"]*"[^>]*>/g)]
    .map((m) => /data-video-id="([^"]*)"/.exec(m[0])?.[1] ?? '?');
  return {
    article: /class="[^"]*\bprose\b/.test(html),
    readingSection: ids.has('transcript'),
    readingPanel: ids.has('transcript-copy'),
    onThisPageNav: /On this page/.test(html),
    readingHeading: /Read when video is difficult to load/.test(html),
    transcriptClaim: /transcript has not been supplied|Transcript status:|Transcript-first view/.test(html),
    relatedBlock: ids.has('related-video'),
    relatedEyebrow: /<p class="eyebrow">Related viewing<\/p>/.test(html),
    designBoilerplateInCopy: /A sourced viewing page keeps the film/.test(html),
    fragmentsResolve: dead.length === 0,
    controlCount: controls.length,
    controls: controls.join(' | '),
    cardCount: cards.length,
    /* ── printed, never compared: these are the two addresses being ABOUT different things ── */
    h1: h1Of(html),
    title: titleOf(html),
    facts: (/<p class="sx-video-facts">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '')
      .replace(/<\/span>/g, ' | ').replace(/<[^>]+>/g, '').trim(),
    description: text(/<p class="sx-video-copy">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? ''),
    deadFragments: dead,
    sections: sections.join(' | '),
    cards: cards.join(','),
  };
}

/*
 * THE SHAPE KEYS, WHICH IS THE WHOLE POINT OF THE FILE. Every one is a question the owner's instructions are
 * made of; content is deliberately absent, because two addresses of one family are about different things and
 * the check must not call that a fault.
 */
const COMPARED = [
  'article',
  'readingSection',
  'readingPanel',
  'onThisPageNav',
  'readingHeading',
  'transcriptClaim',
  'relatedBlock',
  'relatedEyebrow',
  'designBoilerplateInCopy',
  'fragmentsResolve',
  'controlCount',
  'controls',
  'cardCount',
];

function diffShapes(bare, param) {
  const rows = [];
  for (const key of COMPARED) {
    const a = JSON.stringify(bare[key] ?? null);
    const b = JSON.stringify(param[key] ?? null);
    if (a !== b) rows.push({ key, bare: a, param: b });
  }
  return rows;
}

/*
 * ── FAULTS THAT ARE DECLARED RATHER THAN FIXED HERE ──────────────────────────────────────────────
 *
 * A fragment fault that is inherited from the design deliverable is reported by name and does not fail the
 * run unless `--strict` is passed. **This is not a suppression**: the entry is a line of code with a reason
 * beside it, it is printed on every run, and the run says how many of its problems were declared. What it
 * stops is a check that is red on a healthy tree for a fault nobody is going to fix today — because a control
 * that is always red is a control nobody reads.
 */
const DECLARED_FRAGMENT_FAULTS = [
  {
    match: /^\/watch\/?(\?|$)/,
    fragments: ['short', 'oral', 'places', 'conversations', 'series'],
    why: 'the design’s own `watch.html` writes five fragment controls and draws only two sections with ids '
      + '(`#new` and `#series`); `#short`, `#oral`, `#places` and `#conversations` name sections the deliverable '
      + 'never drew, and `#series` is absent on any page of the list that draws no series section. **It is the '
      + 'deliverable’s markup and not a fill’s, it is identical on the bare and the parameterised address — so it '
      + 'is not the variant fault this round is for — and `/watch/` is being edited by another round.** Left '
      + 'standing and reported here rather than silently accepted.',
  },
  {
    match: /^\/about\/?(\?|$)/,
    fragments: ['entrust', 'terms', 'privacy', 'access', 'partners', 'licensing', 'contact'],
    why: 'the design’s own footer links `about.html#entrust`, `#privacy`, `#access`, `#partners`, `#licensing` '
      + 'and `#contact` from fourteen of its screens — and **the deliverable’s own `about.html` draws only three '
      + 'ids: `#main`, `#faq` and `#terms`.** So the ids these links name have never existed on any page, in the '
      + 'deliverable or on the site. It is the same class as the `/watch/` nav above and is inherited rather than '
      + 'produced by a fill. Left standing and reported here rather than silently accepted.',
  },
];

const isDeclared = (path, fragment) => DECLARED_FRAGMENT_FAULTS.some(
  (entry) => entry.match.test(path) && entry.fragments.includes(fragment)
);

const STRICT = argv.includes('--strict');
const declared = [];
const declare = (m) => { declared.push(m); console.log(`  DECLARED FAULT (not fixed here)  ${m}`); };

/* ── 4. THE IDENTITY RULE ────────────────────────────────────────────────────────────────────────
 *
 * Every element carrying a per-record address must carry that record's identity, and the address must
 * contain it. Written generically over `data-<kind>-id` / `data-<kind>-slug` beside `data-<kind>-page`
 * because the town tiles and the inline player are two instances of one fault, and the third will not be a
 * film.
 */
function identityRows(html) {
  const rows = [];
  for (const tag of html.matchAll(/<[^>]*\bdata-[a-z-]+-page="[^"]*"[^>]*>/g)) {
    const element = tag[0];
    const page = /data-([a-z-]+)-page="([^"]*)"/.exec(element);
    if (!page) continue;
    const kind = page[1];
    const address = page[2];
    const identity = new RegExp(`data-${kind}-(?:id|slug|key)="([^"]*)"`).exec(element);
    rows.push({
      kind,
      address,
      identity: identity?.[1] ?? null,
      ok: identity ? address.includes(identity[1]) : false,
      why: identity
        ? `carries data-${kind}-id="${identity[1]}"`
        : `carries an address and no data-${kind}-id`,
    });
  }
  return rows;
}

function identityCheck(url, html) {
  const rows = identityRows(html);
  for (const row of rows) {
    if (!row.ok) {
      problem(`${url}: a ${row.kind} control builds "${row.address}" from ${row.why} — the control discards the identity it is for`);
    }
  }
  return rows;
}

/* ── the crawl's seeds: `/` and every design screen ────────────────────────────────────────────────
 *
 * The design screens are generated from the directory, as the middleware generates its rewrite set, rather
 * than typed here — a screen added to the deliverable is crawled without anyone remembering this file.
 */
function designScreenRoutes() {
  const dir = join(ROOT, 'apps', 'ozikoro', 'public', 'design', 'screens');
  if (!existsSync(dir)) return ['/'];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => {
      const name = f.replace(/\.html$/, '');
      return name === 'home' ? '/' : `/${name}/`;
    });
}

/* ── run ───────────────────────────────────────────────────────────────────────────────────────── */
console.log(`check-page-variants: ${BASE}`);

console.log('\n1. THE FAMILIES — a bare address against its parameterised form\n');

const familyShapes = [];
for (const family of FAMILIES) {
  const bare = await get(family.bare);
  const param = family.param ? await get(family.param) : null;
  console.log(`  ${family.name}`);
  console.log(`      ${family.bare.padEnd(42)} ${bare.status}  h1=${JSON.stringify(h1Of(bare.html))}`);
  if (family.param) console.log(`      ${family.param.padEnd(42)} ${param.status}  h1=${JSON.stringify(h1Of(param.html))}`);
  console.log(`      parameter: ${family.parameter}`);

  if (family.param && bare.status === 200 && param.status === 200) {
    const bareShape = shapeOf(bare.html);
    const paramShape = shapeOf(param.html);
    const rows = diffShapes(bareShape, paramShape);
    familyShapes.push({ family, bare: bareShape, param: paramShape, rows });
    for (const [label, shape] of [['bare ', bareShape], ['param', paramShape]]) {
      console.log(
        `      ${label}  article=${shape.article} readingSection=${shape.readingSection} `
        + `onThisPage=${shape.onThisPageNav} boilerplate=${shape.designBoilerplateInCopy} `
        + `relatedBlock=${shape.relatedBlock} controls=${shape.controlCount} cards=${shape.cardCount} `
        + `fragments=${shape.fragmentsResolve ? 'all resolve' : `DEAD ${JSON.stringify(shape.deadFragments)}`}`
      );
    }
    if (rows.length === 0) {
      console.log('      shape: the two addresses agree on every shape key');
    } else {
      for (const row of rows) {
        const allowed = family.allow[row.key];
        console.log(`      shape ${allowed ? 'DIFFERS (allowed)' : 'DIFFERS (FAULT)'}  ${row.key}`);
        console.log(`          bare:  ${row.bare}`);
        console.log(`          param: ${row.param}`);
        if (allowed) console.log(`          why this is expected: ${allowed}`);
        else problem(`${family.name}: ${row.key} differs between ${family.bare} and ${family.param}`);
      }
    }
    for (const [key, why] of Object.entries(family.allow)) {
      if (!rows.some((r) => r.key === key)) {
        console.log(`      note: the allowance for "${key}" was not needed and should be withdrawn — ${why}`);
      }
    }
  } else if (family.param && (bare.status !== 200 || param.status !== 200)) {
    console.log(`      not compared: ${family.bare} answers ${bare.status} and ${family.param} answers ${param.status}`);
  } else {
    console.log(`      no parameterised form: ${family.bare} answers ${bare.status}`);
  }
  console.log('');
}

/*
 * ── THE SITE'S OWN SCREENS ARE FETCHED BEFORE THE FRAGMENT CHECK, SO THE CHECK COVERS THEM ──────────
 *
 * A fragment fault is inherited from the design's own footer and nav in most of what this file finds, and
 * those links are written on screens that are not in `FAMILIES`. So the crawl's fetch pass runs here — the
 * reading of it is printed as section 5 — and the fragment, control and identity checks then see every page
 * the site's own markup was read from rather than only the eight families.
 */
const bareAddresses = FAMILIES.map((f) => f.bare);
const crawl = { seeds: [], found: new Map(), looked: 0, budget: CRAWL_BUDGET };

if (!NO_CRAWL) {
  console.log('\n  fetching every design screen and following its links, so the checks below cover them …');
  const seeds = [...new Set([...designScreenRoutes(), ...FAMILIES.flatMap((f) => [f.bare, f.param].filter(Boolean))])];
  crawl.seeds = seeds;
  const queue = [...seeds];
  const seen = new Set();
  const record = (path, html) => {
    for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
      const href = m[1];
      const url = new URL(href, `${BASE}${path}`);
      if (url.origin !== BASE) continue;
      const address = url.pathname + (url.search || '');
      if (bareAddresses.includes(address)) {
        if (!crawl.found.has(url.pathname)) crawl.found.set(url.pathname, []);
        crawl.found.get(url.pathname).push(`${path}  →  ${href}`);
      }
      if (url.search === '' && url.hash === '') queue.push(url.pathname);
    }
  };
  /*
   * EVERY SEED IS LOOKED AT UNCONDITIONALLY, AND THE BUDGET IS FOR WHAT IS BEYOND THEM.
   *
   * The design's own markup is the only place a link to one of these addresses can be written (the archive's
   * fills write the parameterised form), so the screens are not a sample and must not be truncated by a
   * budget — a budget that cut the seed list short would report "no page links it" about pages it never
   * opened, which is the same vacuous pass this whole file exists to refuse.
   */
  for (const path of seeds) {
    if (seen.has(path)) continue;
    seen.add(path);
    const page = await get(path);
    crawl.looked += 1;
    if (page.status === 200) record(path, page.html);
  }
  while (queue.length > 0 && crawl.looked < seeds.length + CRAWL_BUDGET) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const page = await get(path);
    crawl.looked += 1;
    if (page.status === 200) record(path, page.html);
  }
  crawl.seen = seen;
} else {
  console.log('\n  --no-crawl: only the family pages are checked for fragments, controls and identity');
}
/*
 * ── THE FRAGMENT CHECK, AND ITS SCOPE ────────────────────────────────────────────────────────────
 *
 * A fragment is a page's own statement about where a control should take the reader, so **the question is
 * always asked of the page that OWNS the fragment and never of the page it is written on**: `/about/#entrust`
 * in the footer of `/archive-index/` is a claim about `/about/`. Resolving it against `/archive-index/` — which
 * is what the first version of this section did — reports six faults that are not there and misses the one that
 * is.
 *
 * The check is FATAL for the pages this file is about: the family pages, bare and parameterised. What the
 * crawl finds on the rest of the site — article pages, the design's other screens — is collected by the same
 * function and printed as section 6, reported with its count rather than failing a run for a fault on a page
 * this check was not asked about. `--strict` makes those fatal too.
 */
const familyPaths = new Set(FAMILIES.flatMap((f) => [f.bare, f.param].filter(Boolean)));

/**
 * Every fragment a page writes that its owner does not carry.
 *
 * Returns the in-page faults and the cross-page ones separately, because they are different claims: an
 * in-page anchor is this document's own, and a cross-page one is another document's promise.
 */
async function fragmentFaults(path, html) {
  const inPage = [];
  const crossPage = [];
  const ownIds = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]));
  const own = new URL(path, BASE);
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]*#[^"]*)"/g)) {
    const href = m[1];
    const fragment = href.slice(href.indexOf('#') + 1);
    if (fragment === '') continue;
    const resolved = new URL(href, `${BASE}${path}`);
    const destination = resolved.pathname + (resolved.search || '');
    const isOwnPage = resolved.pathname === own.pathname && (resolved.search || '') === (own.search || '');
    if (isOwnPage) {
      if (!ownIds.has(fragment)) inPage.push({ href, fragment, destination });
      continue;
    }
    const dest = await get(destination);
    if (dest.status !== 200) { crossPage.push({ href, fragment, destination, status: dest.status }); continue; }
    const destIds = new Set([...dest.html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]));
    if (!destIds.has(fragment)) crossPage.push({ href, fragment, destination, status: dest.status });
  }
  return { inPage, crossPage };
}

function reportFragmentFault(path, fault, fatal) {
  const line = `${path}: ${fault.href} names #${fault.fragment}, which ${fault.destination === path ? 'the page' : fault.destination} does not carry`;
  if (isDeclared(fault.destination, fault.fragment) || isDeclared(path, fault.fragment)) {
    declare(line);
    if (STRICT) problem(line);
    return;
  }
  if (fatal) problem(line);
  else alsoFound.push({ path, fragment: fault.fragment, href: fault.href, destination: fault.destination });
}

const alsoFound = [];

console.log('\n2. THE FRAGMENTS — every fragment a FAMILY page writes, resolved against the page that owns it\n');
{
  let inPage = 0;
  let crossPage = 0;
  for (const path of familyPaths) {
    const page = await get(path);
    if (page.status !== 200) continue;
    const { inPage: own, crossPage: cross } = await fragmentFaults(path, page.html);
    inPage += own.length;
    crossPage += cross.length;
    for (const fault of own) reportFragmentFault(path, fault, true);
    for (const fault of cross) reportFragmentFault(path, fault, true);
  }
  console.log(`  ${inPage} dead in-page fragment(s) and ${crossPage} dead cross-page fragment(s) on the ${familyPaths.size} family page(s)`);
  for (const entry of DECLARED_FRAGMENT_FAULTS) {
    console.log(`\n  declared, and NOT fixed here: ${entry.why}`);
  }
}

console.log('\n3. THE CONTROLS — every control on each family page, followed, and its destination’s h1 read\n');
{
  const seen = new Set();
  let followed = 0;
  let skipped = 0;
  for (const family of FAMILIES) {
    for (const path of [family.bare, family.param].filter(Boolean)) {
      const page = await get(path);
      if (page.status !== 200) continue;
      const hrefs = [...page.html.matchAll(/<a\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>[\s\S]*?<\/a>/g)]
        .map((m) => ({ label: text(m[0]), href: /href="([^"]*)"/.exec(m[0])?.[1] ?? null }))
        .filter((c) => c.href);
      for (const control of hrefs) {
        const label = `${path} → "${control.label}" (${control.href})`;
        if (/^[a-z]+:/i.test(control.href) || control.href.startsWith('//')) {
          console.log(`  ${label}\n      external — not fetched`);
          continue;
        }
        const resolved = new URL(control.href, `${BASE}${path}`);
        const target = resolved.pathname + (resolved.search || '');
        const fragment = resolved.hash ? resolved.hash.slice(1) : '';
        if (seen.has(target + resolved.hash)) { skipped += 1; continue; }
        seen.add(target + resolved.hash);
        if (followed >= FOLLOW_BUDGET) {
          skipped += 1;
          continue;
        }
        followed += 1;
        const dest = await get(target);
        const landed = dest.status >= 300 && dest.status < 400 && dest.location ? ` → ${dest.location}` : '';
        let fragmentNote = '';
        if (fragment && dest.status === 200) {
          const ids = new Set([...dest.html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]));
          fragmentNote = ids.has(fragment) ? `  #${fragment} present` : `  #${fragment} MISSING`;
          if (!ids.has(fragment)) {
            const line = `${target} does not carry #${fragment}, which ${path} points at`;
            if (isDeclared(target, fragment)) {
              declare(line);
              if (STRICT) problem(line);
            } else {
              problem(line);
            }
          }
        }
        console.log(`  ${label}\n      ${dest.status}${landed}  h1=${JSON.stringify(h1Of(dest.html))}${fragmentNote}`);
        if (dest.status >= 400) problem(`${path}: the control "${control.label}" answers ${dest.status} at ${target}`);
        if (dest.status >= 300 && dest.status < 400 && dest.location && !dest.location.startsWith(BASE)) {
          console.log(`      note: leaves the site for ${dest.location}`);
        }
      }
    }
  }
  console.log(`  ${followed} destination(s) followed, ${skipped} skipped (already followed, or past the ${FOLLOW_BUDGET}-control budget)`);
}

console.log('\n4. THE IDENTITY — a per-record address must carry the record it is for\n');
{
  let rows = 0;
  for (const [path, page] of cache) {
    if (page.status !== 200) continue;
    for (const row of identityCheck(path, page.html)) rows += 1;
    const cards = [...page.html.matchAll(/<button\b[^>]*\bclass="[^"]*sx-video-card[^"]*"[^>]*>/g)]
      .map((m) => m[0])
      .filter((c) => !/data-video-page=/.test(c));
    if (cards.length > 0) {
      console.log(`  ${path}: ${cards.length} film card(s) carry no data-video-page — the archive holds no record for them, and the extended watch.js hides "This film’s page" for each`);
    }
  }
  console.log(`  ${rows} identity-bearing control(s) checked`);
}

if (!NO_CRAWL) {
  console.log('\n5. WHO LINKS A BARE ADDRESS — following links from / and every design screen\n');
  for (const [address, sources] of crawl.found) {
    console.log(`  ${address}`);
    for (const source of sources) console.log(`      ${source}`);
  }
  if (crawl.found.size === 0) console.log('  no fetched page links a declared bare address');
  console.log(`\n  coverage: ${crawl.seen.size} address(es) looked at — all ${crawl.seeds.length} seeds plus ${Math.max(0, crawl.looked - crawl.seeds.length)} followed`);
  console.log(`            ${designScreenRoutes().length} design screens, the complete set from apps/ozikoro/public/design/screens/`);
  console.log(`            ${[...cache.values()].filter((p) => p.status !== 200).length} of the ${cache.size} fetched page(s) did not answer 200`);
  console.log('  It is NOT a full crawl of the site: the served surface is about 15,000 addresses and this review');
  console.log('  server answers about one request a second. Every design screen was fetched, because the design’s');
  console.log('  own markup is the only place one of these links can be written; the archive’s fills write the');
  console.log('  parameterised form, which this section does not need to find.');
} else {
  console.log('\n5. WHO LINKS A BARE ADDRESS — skipped (--no-crawl)\n');
}

console.log('\n6. ALSO FOUND WHILE FOLLOWING LINKS — reported, not fatal unless --strict\n');
{
  let pages = 0;
  for (const [path, page] of cache) {
    if (page.status !== 200 || familyPaths.has(path)) continue;
    pages += 1;
    const { inPage, crossPage } = await fragmentFaults(path, page.html);
    for (const fault of [...inPage, ...crossPage]) reportFragmentFault(path, fault, false);
  }
  const byFragment = new Map();
  for (const f of alsoFound) {
    const key = `${f.destination}#${f.fragment}`;
    if (!byFragment.has(key)) byFragment.set(key, { key, pages: new Set(), example: f.path });
    byFragment.get(key).pages.add(f.path);
  }
  for (const v of [...byFragment.values()].sort((a, b) => b.pages.size - a.pages.size)) {
    console.log(`  ${v.key}  —  written on ${v.pages.size} page(s), e.g. ${v.example}`);
  }
  if (alsoFound.length === 0) console.log('  nothing beyond the family pages');
  console.log(`  ${alsoFound.length} dead fragment(s) across ${pages} page(s) outside the families`);
}

console.log(
  `\n${problems.length === 0 ? 'OK' : 'FAILED'}: ${problems.length} problem(s), ${declared.length} declared `
  + `fault(s) not fixed here, ${fetched} request(s) made`
);
if (declared.length > 0) {
  console.log('  declared faults are printed above and are fatal only under --strict:');
  for (const d of declared) console.log(`  ~ ${d}`);
}
if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  - ${p}`);
}
process.exit(problems.length === 0 ? 0 : 1);
