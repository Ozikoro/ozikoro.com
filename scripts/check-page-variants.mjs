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
 *   node scripts/check-page-variants.mjs                 # families, fragments, EVERY article, controls, crawl 40
 *   node scripts/check-page-variants.mjs --articles 100  # a bounded, spread sample of the article family
 *   node scripts/check-page-variants.mjs --no-articles   # skip the article family (it is the slow pass)
 *   node scripts/check-page-variants.mjs --crawl 120     # a wider link crawl
 *   node scripts/check-page-variants.mjs --no-crawl      # the structural checks only, ~10 s
 *   BASE=http://127.0.0.1:3110 node scripts/check-page-variants.mjs
 *   node scripts/check-page-variants.mjs --strict        # declared faults fail the run too
 *
 * Exit status is 0 only when nothing disagreed.
 *
 * ── WHAT IS COVERED, WHAT IS SAMPLED, AND HOW LONG EACH TAKES ─────────────────────────────────────
 *
 * **Every claim below is printed by the run itself**, because a bounded instrument that does not say what it
 * did not reach is the failure this file exists to refuse.
 *
 *   the eight FAMILIES, bare and parameterised      all of them, always, in section 1 and 2
 *   the design's own 52 screens                     all of them, always — the complete set, read from the
 *                                                   directory, and it cannot be truncated by the crawl budget
 *   the ARTICLE family — every published record     **all 1,051**, from `/sitemap/histories`, in section 2b.
 *       This is the largest surface this check owns and it is where the `#listen` fault lived: 1,051
 *       records each write `/<slug>/#listen` in their own section nav, and the 40-page link crawl below
 *       reached **none** of them on the run that found it. At about 0.6 s a record it costs about eleven
 *       minutes, which is why `--articles N` exists; **the run prints how many it checked and how long it
 *       took either way.** A pass that samples is acceptable *if it says so*; this one says so on every run.
 *   everything else the crawl reaches              SAMPLED, printed with its size, non-fatal unless --strict
 *
 * The link crawl beyond the seeds is bounded on purpose: the served surface is about 15,000 addresses and
 * the review server is a single PGlite process, so a full crawl is hours. Every design screen is fetched,
 * because the design's own markup is the only place one of these links can be written.
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
const NO_ARTICLES = argv.includes('--no-articles');
const CRAWL_BUDGET = Number(flag('--crawl', '40'));
const FOLLOW_BUDGET = Number(flag('--follow', '24'));
/** `--articles all` (the default) or a count. The article family is the one pass big enough to need a cap. */
const ARTICLE_BUDGET = (() => {
  const raw = flag('--articles', 'all');
  if (raw === 'all') return Infinity;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Infinity;
})();

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

/** The clock the final summary prints, so the article family's cost is visible in the run's own terms. */
const startedAt = Date.now();

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

/*
 * ── A PAGE THAT DID NOT ANSWER IS A PROBLEM, AND THIS IS THE LINE THAT MUST NOT BE REMOVED ─────────
 *
 * MEASURED, BEFORE THIS WAS HERE: run this file with `BASE` pointed at a port with nothing on it and it
 * printed **`OK: 0 problem(s)` and exited 0**. Every family page came back `0`, every guard in the file is
 * written `status === 200` so every check was skipped, the crawl found no links because it had no HTML to
 * read, and the gate reported the site as working — **while there was no site to report on.** That is the
 * same fault `verify-round-344.mjs` was found carrying this hour, when the whole site was down and it printed
 * `PROBLEMS: 0 — GATE PASSED` over 1,762 targets that had never been read. A check that passes when it
 * cannot reach the page it is about is worse than no check, because it is read as evidence.
 *
 * SO AN UNANSWERED PAGE IS A FAULT IN ITS OWN RIGHT, whatever else was or was not measured, and it is
 * reported once per address rather than once per check that skipped it.
 *
 * `status === 0` IS THE THING REPORTED, AND THE NARROW SCOPE IS DELIBERATE. `0` means the request never
 * produced an HTTP answer — connection refused, DNS failure, a timeout — which can only ever be an
 * instrument that could not measure. A 404 or a 403 is a real answer from a real page and is already handled
 * where it belongs: `FAMILIES` records addresses that answer 404 by design (`/podcast/` has no bare form)
 * and the control pass reports a non-2xx destination against the control that named it. Failing the run for
 * every non-200 would report the auth gate and the declared 404s as faults, which is the noise that makes a
 * red gate unreadable — and it is why the round-344 fix names its exemptions rather than counting them.
 */
function reportUnansweredPages() {
  const unanswered = [...cache].filter(([, page]) => page.status === 0);
  for (const [path, page] of unanswered) {
    problem(`${path}: no answer at all${page.error ? ` (${page.error})` : ''} — this check cannot report on a page it did not read`);
  }
  return unanswered.length;
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
/*
 * ── WHAT A FRAGMENT CAN LAND ON ───────────────────────────────────────────────────────────────────
 *
 * `id` is the one everybody writes, and it is not the only one a browser honours. **The HTML standard's own
 * "find a potential indicated element" step returns the first element with that `id`, and, failing that, the
 * first `<a>` whose `name` attribute equals the fragment** — the pre-HTML5 anchor, which is obsolete markup
 * and live behaviour in every browser.
 *
 * **THAT IS NOT A PEDANTIC DISTINCTION HERE.** The archive's one footnote record,
 * `/beyond-wrestling-sport-in-pre-colonial-west-africa/`, marks both ends of every footnote with `name` on an
 * `<a>` — `<a href="#_ftn1" name="_ftnref1">[1]</a>` in the text and `<a href="#_ftnref1" name="_ftn1">[1]</a>`
 * at the foot — and carries no ids for either. A check that only reads `id` calls all seventeen links dead
 * when the browser follows every one of them, which is the same fault in the instrument as in the page: **a
 * claim about a target that was never measured.** The WordPress dump, the only source that can settle it,
 * holds `href="#_ftn…"` 17 times, `name="_ftn…"` 17 times and `id="_ftn…"` zero times.
 *
 * `id` is read everywhere; `name` is read only on `<a>`, because that is the only element the rule applies
 * to — a `<meta name>` or an `<input name>` is not a destination and must never be counted as one.
 */
const targetsOf = (html) => {
  const ids = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<a\b[^>]*\bname="([^"]*)"/g)) ids.add(m[1]);
  return ids;
};

/**
 * Every fragment a page writes that does not land, resolved against **the page the href names**.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT WHAT THE FIRST VERSION OF `shapeOf` DID.
 *
 * `shapeOf` tested each fragment against the ids of the page it was reading. On `/watch/?page=2` the nav
 * writes `/watch/?page=1#series` — **a link that names page 1 and its section**, written on a page that does
 * not carry the section itself because that section's films are on page 1. The first version therefore
 * reported two dead fragments on a page whose links both work, and failed the run with
 *
 *     PROBLEM  watch: fragmentsResolve differs between /watch/ and /watch/?page=2
 *
 * — a false positive made by measuring the thing in front of the instrument instead of the thing the link is
 * about. `fragmentFaults` below has owned the correct rule since round 355 (it is why `/about/#entrust`,
 * written in a footer on another screen, is judged against `/about/`), but the SHAPE comparison never used it.
 *
 * THE RULE, AND BOTH HALVES OF IT:
 *
 *   * a BARE `#fragment` is this document's own claim about itself, so it is judged against this page's ids;
 *   * an href that NAMES a page (`/watch/?page=1#series`, `about.html#entrust`) is judged against **that**
 *     page's ids, fetched — the target named by the href must exist on the page the href resolves to.
 *
 * IT IS NOT A LOOSENING. Every fragment is still required to land somewhere real: a destination that does not
 * answer, or answers without the fragment, is still recorded dead and still fails the comparison. The only
 * thing that stopped happening is judging a page's link against a document the link does not point at.
 */
async function fragmentTargets(html, path) {
  const own = new URL(path, BASE);
  const ownTargets = targetsOf(html);
  const dead = [];
  for (const m of html.matchAll(/href="([^"]*#[^"]*)"/g)) {
    const href = m[1];
    const fragment = href.slice(href.indexOf('#') + 1);
    if (fragment === '') continue;
    let resolved;
    try {
      resolved = new URL(href, `${BASE}${path}`);
    } catch {
      dead.push(href);
      continue;
    }
    const isOwnPage = resolved.pathname === own.pathname && (resolved.search || '') === (own.search || '');
    if (isOwnPage) {
      if (!ownTargets.has(fragment)) dead.push(href);
      continue;
    }
    const destination = resolved.pathname + (resolved.search || '');
    const dest = await get(destination);
    if (dest.status !== 200 || !targetsOf(dest.html).has(fragment)) dead.push(href);
  }
  return dead;
}

async function shapeOf(html, path) {
  const ids = targetsOf(html);
  const controls = [...html.matchAll(/<a\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>[\s\S]*?<\/a>/g)]
    .map((m) => `${text(m[0])} => ${(/href="([^"]*)"/.exec(m[0])?.[1]) ?? '(inert, no href)'}`);
  const dead = await fragmentTargets(html, path);
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
 *
 * ── AND THE TWO ENTRIES THAT STOOD HERE ARE GONE, WHICH IS THE POINT OF THE PARAGRAPH ABOVE ────────
 *
 * Round 355 declared four sets of dead fragments rather than fix them, two of them here: `/watch/`'s five
 * names over two sections, and the design's six `about.html` fragments over the three ids the page carries.
 * **Both were described as "inherited" and both were fixable at serve time**, which is what "do not declare
 * something fixable as inherited" means. They are fixed now, in the fills and in `designScreenLinks`, and the
 * entries are deleted rather than left standing over a fault that no longer exists — because an allowance
 * that is no longer needed is a lie about the tree, and this file prints one when it finds it (see the
 * "allowance was not needed" note in section 1).
 *
 * The mechanism stays, because a class that genuinely cannot be fixed at serve time will exist again. It is
 * empty, and the run says `0 declared fault(s)` so an empty list is visible rather than assumed.
 */
const DECLARED_FRAGMENT_FAULTS = [];

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
    const bareShape = await shapeOf(bare.html, family.bare);
    const paramShape = await shapeOf(param.html, family.param);
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
  const ownIds = targetsOf(html);
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
    if (!targetsOf(dest.html).has(fragment)) crossPage.push({ href, fragment, destination, status: dest.status });
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
  /*
   * `--strict` MEANS WHAT THE FILE SAYS IT MEANS, on this call as well as on the declared one.
   *
   * The section below prints what the crawl found on the rest of the site — article pages, the design's other
   * screens — as reported rather than fatal, and `--strict` is documented as making those fatal too. **It did
   * not**: the call passed `false` and only a DECLARED fault was ever promoted, so a run of
   * `--strict` was green on a tree carrying the very faults it was said to refuse. It is a one-word
   * difference between a control and a decoration, which is why it is written down here.
   */
  if (fatal || STRICT) problem(line);
  if (!fatal) alsoFound.push({ path, fragment: fault.fragment, href: fault.href, destination: fault.destination });
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

/*
 * ── 2b. THE ARTICLE FAMILY, WHICH IS 1,051 PAGES AND WAS NOT COVERED AT ALL ───────────────────────
 *
 * **THE BLIND SPOT THIS SECTION CLOSES.** Every one of the archive's published records is served through
 * `apps/ozikoro/app/[slug]/route.ts`, and every one of them renders the design's own section nav — "In this
 * history" and "Reading tools". Until this section existed, **none of those pages was checked unless the
 * forty-page link crawl below happened to walk to one**, which on the run that found the fault it reached
 * none of them: the crawl's budget is spent on the design's own 52 screens and their neighbours. So the
 * archive's largest surface was outside the check that exists for exactly its fault.
 *
 * **THE ADDRESSES COME FROM THE SITE, NOT FROM A LIST IN THIS FILE AND NOT FROM A DATABASE QUERY.** The
 * sitemap's `histories` group is the complete set of published record addresses, generated by the same code
 * that writes the site's own sitemap, so a record added or unpublished tomorrow changes this list with no
 * edit here. A hand-written sample would go stale in the direction that matters — silently checking pages
 * that still exist while the new ones go unlooked-at.
 *
 * **THE FAULTS ARE AGGREGATED RATHER THAN PRINTED 1,051 TIMES**, because the nav is one shape written by one
 * fill: the `#listen` fault this section was added for was on 1,049 records at once. Each distinct
 * `destination#fragment` is one line with the number of records that write it and one example, which is the
 * same shape section 6 uses for what it finds. **They are FATAL, without `--strict`** — an article's nav is
 * the page's own claim about itself, which is exactly `fragmentFaults`' in-page case, and this is a family
 * this check owns.
 */
const articlePaths = new Set();
if (!NO_ARTICLES) {
  console.log('\n2b. THE ARTICLE FAMILY — every published record’s own nav, resolved against itself\n');
  const started = Date.now();
  const sitemap = await get('/sitemap/histories');
  const all = sitemap.status === 200
    ? [...sitemap.html.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((m) => {
          try {
            return new URL(m[1]).pathname;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    : [];
  /*
   * A BOUNDED SAMPLE IS A STRIDE, NOT THE FIRST N.
   *
   * The sitemap is written newest-first, so `slice(0, 100)` would check the hundred newest records and
   * nothing older — and a record imported from WordPress in 2015 is exactly as capable of writing a dead
   * fragment as one published this morning. The stride walks the whole list, so a bounded run still spans
   * the archive. Which addresses it took is not printed one by one; **how many of how many were taken is**,
   * because that is the number that decides whether the run can be believed.
   */
  const limit = Math.min(ARTICLE_BUDGET, all.length);
  const step = limit >= all.length || limit === 0 ? 1 : all.length / limit;
  const chosen = [];
  for (let i = 0; i < limit; i += 1) chosen.push(all[Math.floor(i * step)]);
  for (const path of chosen) articlePaths.add(path);

  const byFault = new Map();
  let checked = 0;
  let notFound = 0;
  let faults = 0;
  for (const path of chosen) {
    const page = await get(path);
    if (page.status !== 200) {
      notFound += 1;
      continue;
    }
    checked += 1;
    const { inPage, crossPage } = await fragmentFaults(path, page.html);
    for (const fault of [...inPage, ...crossPage]) {
      faults += 1;
      const key = `${fault.destination}#${fault.fragment}`;
      if (!byFault.has(key)) byFault.set(key, { key, pages: new Set(), example: path });
      byFault.get(key).pages.add(path);
      problem(`${path}: ${fault.href} names #${fault.fragment}, which ${fault.destination === path ? 'the page' : fault.destination} does not carry`);
    }
  }
  for (const v of [...byFault.values()].sort((a, b) => b.pages.size - a.pages.size)) {
    console.log(`  ${v.key}  —  written on ${v.pages.size} record(s), e.g. ${v.example}`);
  }
  if (faults === 0) console.log('  every fragment on every record checked resolves, in-page and across pages');
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  ${checked} of ${all.length} published record address(es) checked — from /sitemap/histories, `
    + `which is the complete set`);
  if (checked < all.length) {
    console.log(`  ** ${all.length - checked} record(s) were NOT looked at this run `
      + `(--articles ${ARTICLE_BUDGET === Infinity ? 'all' : ARTICLE_BUDGET}) — a stated blind spot, not a pass`);
  }
  if (notFound > 0) console.log(`  ${notFound} address(es) from the sitemap did not answer 200`);
  console.log(`  ${faults} dead fragment(s) across the ${checked} record(s) checked, in ${seconds} s`);
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
          const ids = targetsOf(dest.html);
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
    if (page.status !== 200 || familyPaths.has(path) || articlePaths.has(path)) continue;
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

/*
 * THE LAST QUESTION BEFORE THE VERDICT: DID THE PAGES ANSWER AT ALL?
 *
 * It runs here, after every measurement, so that a site which is down cannot be reported as a site with
 * nothing wrong with it. See `reportUnansweredPages` — `BASE` pointed at a closed port used to print
 * `OK: 0 problem(s)` and exit 0.
 */
reportUnansweredPages();

console.log(
  `\n${problems.length === 0 ? 'OK' : 'FAILED'}: ${problems.length} problem(s), ${declared.length} declared `
  + `fault(s) not fixed here, ${fetched} request(s) made`
);
/*
 * THE COVERAGE AND THE CLOCK, SAID OUT LOUD ON EVERY RUN.
 *
 * A check that samples is acceptable **if it says so**; the two numbers below are what make that true or not.
 * `articleFamilies` is the count of published record addresses this run actually opened, out of the complete
 * set taken from `/sitemap/histories`, and `seconds` is the whole run — because the article family is eleven
 * of those minutes and a reader of the output is entitled to know that before they re-run it.
 */
{
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const articles = NO_ARTICLES
    ? 'the article family was SKIPPED (--no-articles): none of the published records was checked'
    : `${articlePaths.size} article page(s) checked, each one a published record`;
  console.log(`  coverage: ${articles}; ${designScreenRoutes().length} design screens; ${familyPaths.size} family page(s); `
    + `${crawl.looked} address(es) in the link crawl`);
  console.log(`  elapsed: ${seconds} s`);
}
if (declared.length > 0) {
  console.log('  declared faults are printed above and are fatal only under --strict:');
  for (const d of declared) console.log(`  ~ ${d}`);
}
if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  - ${p}`);
}
process.exit(problems.length === 0 ? 0 : 1);
