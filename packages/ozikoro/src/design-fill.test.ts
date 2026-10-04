/**
 * The placeholder links on the design's screens, and the transform that removes them.
 *
 * WHY THIS TEST READS THE REAL SCREENS
 *
 * `fillDashboardLinks` matches the design's own markup by label — `Saved histories`, `Open workspace`,
 * `System overview`. **A label typed differently in the design and in the map does not throw: it keeps its
 * `href="#"` and leaves a link that looks identical to a working one.** That is the same class of fault as
 * the one this work exists to remove, so the assertions run against the real handed-over HTML files rather
 * than against fixtures, and a design screen that gains a new item fails here before it reaches a reader.
 *
 * IT COVERS TWO SETS OF SCREENS. The fourteen dashboards came first; a later measurement found **thirty-six
 * more `href="#"` across six screens served live at `/publication/`, `/researcher-profile/`, `/academy/`,
 * `/archive-index/`, `/upload/` and `/watch/`.** Both sets are asserted, because a transform that covers one
 * of them and not the other is exactly the kind of half-done pass this test exists to fail.
 *
 * WHAT IS ASSERTED
 *
 *   1. no covered screen keeps a single `href="#"` after the transform, and the count removed matches the
 *      design's own count, so a screen that stops being filled is still covered;
 *   2. a real destination keeps its label and gains a root-relative `href`;
 *   3. a label with nothing behind it stops being a link and says so in its own text;
 *   4. every leftover label is named in `DASHBOARD_UNBUILT_MAP`, so the report in
 *      `docs/dashboard-functions.md` cannot silently fall behind the screens;
 *   5. the design's own files are byte-identical afterwards — the transform is in memory only.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DASHBOARD_UNBUILT_MAP, LINKED_SCREENS, fillAbout, fillDashboardLinks } from './design-fill.ts';
import { MARQUEE_PLACES, fillHome, fillMarquee } from './design-fill.ts';
import { extractArchiveFilms, fillWatch, renderFilmCard } from './design-fill.ts';
import { extendWatchScript, fillWatchVideo } from './design-fill.ts';
import { COLLECTION_CAMERA_SIGN, renderCollection } from './design-fill.ts';
import {
  AFRICAN_COUNTRIES,
  AFRICAN_COUNTRY_COUNT,
  MARKET_DAY_ANCHOR,
  countryOptions,
  extendMarketDaysScript,
  fillCulturalCalendar,
  fillIgboCalendar,
} from './design-fill.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The deliverable's screens, four levels up: packages/ozikoro/src -> the repository root. */
const SCREENS = join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'screens');
/**
 * The deliverable's own copy of `market-days.js`, which the archive extends at serve time.
 *
 * **Read from the deliverable rather than from `apps/ozikoro/public/design/`, and asserted byte-identical
 * afterwards**, so this test proves the extension is a transform in memory and not an edit to either copy.
 */
const SCRIPT = join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'market-days.js');

function dashboards(): { name: string; html: string }[] {
  return readdirSync(SCREENS)
    .filter((f) => f.startsWith('dashboard-') && f.endsWith('.html'))
    .sort()
    .map((f) => ({ name: f.replace(/\.html$/, ''), html: readFileSync(join(SCREENS, f), 'utf8') }));
}

/**
 * The screens the SAME transform covers and which are not dashboards.
 *
 * Read from `LINKED_SCREENS` rather than typed again, so **a screen added to the transform is asserted
 * against the real file automatically** and a screen quietly removed from it fails here instead of passing
 * because the test still lists it.
 */
function linkedScreens(): { name: string; html: string }[] {
  return LINKED_SCREENS.map((name) => ({ name, html: readFileSync(join(SCREENS, `${name}.html`), 'utf8') }));
}

test('every dashboard is free of placeholder links after the transform', () => {
  const screens = dashboards();
  assert.ok(screens.length >= 14, `expected the fourteen dashboards; found ${screens.length}`);

  for (const { name, html } of screens) {
    const before = (html.match(/href="#"/g) ?? []).length;
    const after = fillDashboardLinks(html, name);
    const left = (after.match(/href="#"/g) ?? []).length;

    assert.equal(left, 0, `${name}: ${left} of ${before} placeholder links survived the transform`);
    /*
     * AND THE SAME NUMBER COMES OUT SOMEWHERE.
     *
     * A screen with no placeholders would pass the assertion above for the wrong reason. Each of the
     * fourteen carries at least one today, so **a screen whose links quietly stop being rewritten shows up
     * as a marker count of zero rather than as a silent pass.** The design's own `<a class="skip"
     * href="#main">` is not a placeholder and must not be counted — it is still counted here as an anchor,
     * which is why the comparison is against the marker rather than against the anchor.
     */
    const marked = (after.match(/>— Not built yet<\/span>/g) ?? []).length;
    if (before > 0) {
      assert.ok(
        marked > 0 || /href="\//.test(after),
        `${name}: ${before} placeholders went, but nothing was marked or wired`
      );
    }
  }
});

test('a label with a real page behind it becomes that page’s address', () => {
  const out = fillDashboardLinks(screen('dashboard-admin'), 'dashboard-admin');

  assert.match(out, /<nav class="sx-dash-nav"[^>]*><a href="\/admin\/">System overview<\/a>/);
  assert.match(out, /<a href="\/account\/">Account settings<\/a>/);
  assert.match(out, /<a href="\/">Return to public site<\/a>/);
  // The tile is the same label and must take the same destination.
  assert.match(out, /<a class="sx-state" href="\/admin\/">/);
});

test('one label can mean a different place to a different role', () => {
  /*
   * The administrator's `Media` is the media REGISTER; everyone else's is the photograph library.
   *
   * It pointed at `/admin/rights/` while the rights queue was the only surface that listed media at all.
   * `/admin/media/` now exists and answers "what do we hold", so the administrator's item reaches it and the
   * rights queue keeps `Sources`, which is the permissions and provenance work.
   */
  assert.match(fillDashboardLinks(screen('dashboard-admin'), 'dashboard-admin'), /<a href="\/admin\/media\/">Media<\/a>/);
  assert.match(fillDashboardLinks(screen('dashboard-admin'), 'dashboard-admin'), /<a href="\/admin\/rights\/">Sources<\/a>/);
  assert.match(
    fillDashboardLinks(screen('dashboard-knowledge-holder'), 'dashboard-knowledge-holder'),
    /<a href="\/photographs\/">Media<\/a>/
  );
});

test('a label with nothing behind it stops being a link and says so', () => {
  const out = fillDashboardLinks(screen('dashboard-reader'), 'dashboard-reader');

  // No `href`, so it is not a link and cannot be focused; the label is kept for the reader.
  assert.match(out, /<a aria-disabled="true" title="Not built yet[^"]*">Saved histories /);
  assert.doesNotMatch(out, /<a[^>]*href="#"[^>]*>Saved histories/);
  // The tile's promise is replaced, not merely annotated.
  assert.match(out, /<div class="sx-state" aria-disabled="true">/);
  assert.match(out, /Not built yet — nothing to open\./);
  // `Collections` has a real destination, so its tile must keep the promise and the link.
  assert.match(out, /<a class="sx-state" href="\/archive\/">/);
  assert.doesNotMatch(out, /Saved histories<\/h3><p class="small muted">Open workspace/);
});

test('every non-dashboard screen in the transform is free of placeholder links too', () => {
  /*
   * THIRTY-SIX DEAD LINKS WERE FOUND ON SIX SCREENS NOBODY HAD CALLED A DASHBOARD.
   *
   * `/publication/`, `/researcher-profile/`, `/academy/`, `/archive-index/`, `/upload/` and `/watch/` are
   * served live and return 200. **A dead link is the same fault wherever it is**, so the same transform covers
   * them and the same assertion holds them to it — including the count, because a screen whose placeholders
   * stop being rewritten would otherwise pass by having none left to rewrite.
   *
   * A LATER MEASUREMENT ADDED FOUR MORE, AND THEY CARRIED NO PLACEHOLDER AT ALL: `home`, `documents`,
   * `publications` and `404`. Their fault was the other half of the same transform — a menu written as bare
   * sibling filenames, which resolves one level too deep at `/documents/`, `/publications/` and `/404/`.
   * **Each of those three screens answered 200 with every menu item and the whole footer 404ing.** So the
   * loop below asserts the resolution as well as the placeholder, and a screen that stops being rewritten
   * fails here whichever half of the transform it needed.
   *
   * AND AN ELEVENTH, `listen`, FOR THE OTHER HALF OF THAT SAME FAULT — measured: its own menu items
   * (`/listen/home.html`, `/listen/archive-index.html`, `/listen/watch.html`, `/listen/collections.html`)
   * all answered 404 while the identical items on `/watch/` resolved. It carries no `href="#"` either, so it
   * is the sibling-resolution assertion that holds it, not the placeholder one.
   */
  const screens = linkedScreens();
  assert.equal(screens.length, 11, `expected the eleven non-dashboard screens; found ${screens.length}`);

  let totalBefore = 0;
  for (const { name, html } of screens) {
    const before = (html.match(/href="#"/g) ?? []).length;
    const after = fillDashboardLinks(html, name);
    const left = (after.match(/href="#"/g) ?? []).length;
    totalBefore += before;

    assert.equal(left, 0, `${name}: ${left} of ${before} placeholder links survived the transform`);
    if (before > 0) {
      const marked = (after.match(/>— Not built yet<\/span>/g) ?? []).length;
      assert.ok(
        marked > 0 || /href="\//.test(after) || /href="https:/.test(after),
        `${name}: ${before} placeholders went, but nothing was marked or wired`
      );
    }
    /*
     * AND NOT ONE BARE SIBLING FILENAME IS LEFT. This is the assertion that would have caught the owner's
     * report: on `/` the `researcher-profile.html` item survived every check because it resolved, and it
     * resolved to a page that answers 200 and is not the page the label promises.
     */
    assert.doesNotMatch(after, /href="[a-z0-9-]+\.html/, `${name}: a relative screen link survived the transform`);
    assert.doesNotMatch(after, /<a href="\/researcher-profile\/"/, `${name}: a link still reaches the single-profile screen`);
  }

  // The design carries thirty-six across the six screens that have placeholders; the four added later carry
  // none, which is why the count is still 36 and is asserted separately from the size of the set.
  assert.equal(totalBefore, 36, `expected 36 placeholders across the six screens that carry them; found ${totalBefore}`);
});

test('a bare button label on a non-dashboard screen becomes a non-link that says why', () => {
  const out = fillDashboardLinks(screen('upload'), 'upload');

  assert.match(out, /<a class="btn btn-quiet" aria-disabled="true" title="Not built yet[^"]*">Save as draft /);
  assert.doesNotMatch(out, /<a[^>]*href="#"[^>]*>Save as draft/);
  // The academy screen names its own destination in its text, so its courses keep a real address.
  assert.match(fillDashboardLinks(screen('academy'), 'academy'), /<a href="https:\/\/learn\.ozituma\.com\/">Igbo from the beginning<\/a>/);
  // The archive's own indexes are wired; the design's example topics are not.
  assert.match(fillDashboardLinks(screen('archive-index'), 'archive-index'), /<a class="small" href="\/clans\/">All 62 clans →<\/a>/);
  assert.match(fillDashboardLinks(screen('researcher-profile'), 'researcher-profile'), /<a href="\/researchers\/">Researchers<\/a>/);
});

test('the menu’s `Researchers` item is the directory, and stops claiming to be the page', () => {
  /*
   * THE OWNER'S REPORT, AS AN ASSERTION.
   *
   * *"on the menu, the 'Researchers' is not working, it is dead link."* The item was not dead: every one of
   * the seventeen anchors that said *Researchers*, *Researcher profiles* or *Researchers and publications*
   * resolved to `/researcher-profile/`, **one real contributor's page, which answers 200.** So the assertion
   * cannot be "the link resolves" — it has to be the address, on every screen that carries the menu.
   */
  for (const { name, html } of linkedScreens()) {
    const out = fillDashboardLinks(html, name);
    assert.doesNotMatch(out, /href="\/researcher-profile\/"/, `${name}: the menu still reaches the single-profile screen`);
    assert.doesNotMatch(out, /href="researcher-profile\.html"/, `${name}: a relative profile link survived`);
  }
  assert.match(fillDashboardLinks(screen('researcher-profile'), 'researcher-profile'), /<li><a href="\/researchers\/">Researchers<\/a><\/li>/);

  /*
   * AND THE THREE SCREENS THAT MARKED IT `aria-current="page"` NO LONGER DO — because the marker now sits on
   * a link to another page. `/researchers/` is the application's directory, not a design screen, so no
   * design screen can honestly claim it as the page the reader is on.
   */
  for (const name of ['publication', 'researcher-profile', 'upload']) {
    const out = fillDashboardLinks(screen(name), name);
    assert.doesNotMatch(out, /aria-current="page">Researchers/, `${name}: the current-page marker survived on a link elsewhere`);
  }
});

test('a relative link with a fragment keeps the fragment and stops being relative', () => {
  /*
   * THE PATTERN THAT MISSED THIRTEEN LINKS ON EVERY PAGE.
   *
   * The design writes `about.html#terms`, `upload.html#community-knowledge` and `projects.html?status=ongoing`.
   * The earlier pattern required the closing quote immediately after `.html`, so **every one of those stayed
   * relative** and resolved against the served directory — `/archive-index/about.html#entrust`, which 404s.
   */
  const out = fillDashboardLinks(screen('archive-index'), 'archive-index');

  assert.match(out, /href="\/about\/#entrust"/);
  assert.match(out, /href="\/about\/#terms"/);
  assert.doesNotMatch(out, /href="about\.html/);
  assert.doesNotMatch(out, /href="[a-z0-9-]+\.html/);
});

test('every unbuilt label on the real screens is accounted for in the report map', () => {
  /*
   * BOTH SETS, BECAUSE THE REASON TABLE IS WHAT THE REPORT IS WRITTEN FROM.
   *
   * A label marked `Not built yet` with no entry here says nothing about what would have to be built, and the
   * document that answers the owner's question is generated from this map. The six non-dashboard screens
   * introduced a dozen new labels, so they are asserted here too — **a screen outside this loop could carry
   * twenty unmarked omissions and the test would still pass.**
   */
  const missing = new Set<string>();
  for (const { name, html } of [...dashboards(), ...linkedScreens()]) {
    const out = fillDashboardLinks(html, name);
    for (const m of out.matchAll(/<a[^>]*aria-disabled="true"[^>]*>([^<]*?)\s*<span class="small muted">— Not built yet/g)) {
      const label = decode(m[1] ?? '');
      if (label && !(label in DASHBOARD_UNBUILT_MAP)) missing.add(label);
    }
    // The tiles carry the heading rather than the anchor's own text.
    for (const m of out.matchAll(/<div class="sx-state" aria-disabled="true">[\s\S]*?<h3[^>]*>([^<]*)<\/h3>/g)) {
      const label = decode(m[1] ?? '');
      if (label && !(label in DASHBOARD_UNBUILT_MAP)) missing.add(label);
    }
  }
  assert.deepEqual(
    [...missing].sort(),
    [],
    'these labels are marked "Not built yet" on a screen but have no entry saying what would have to be built'
  );
});

/**
 * The label as a reader sees it.
 *
 * The design writes `Supervisor &amp; institution`, and the map's keys are written the way a person reads
 * the words — **a test that compared raw HTML against a human-readable key would report a false miss, and
 * a false miss is what teaches the next person to widen the map until it agrees with anything.**
 */
function decode(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").trim();
}

test('the design’s own files are not what changed', () => {
  for (const { name, html } of [...dashboards(), ...linkedScreens()]) {
    const before = html;
    fillDashboardLinks(html, name);
    assert.equal(html, before, `${name}: the transform mutated the screen in place`);
  }
});

/** One screen's markup, read fresh — kept last so the tests above read as prose. */
function screen(name: string): string {
  return readFileSync(join(SCREENS, `${name}.html`), 'utf8');
}

/* ------------------------------------------------------------------------------------------------
 * THE CULTURAL CALENDAR — THE SCREEN THE FILL DELETED, AND THE COUNTRY LIST IT NEVER HAD
 * ---------------------------------------------------------------------------------------------- */

/**
 * The calendar at a known month and event count.
 *
 * **THE MONTH IS PASSED IN RATHER THAN TAKEN FROM THE CLOCK**, because the grid's day cells and its leading
 * blanks are computed from it: a test that read `new Date()` would pass in October and fail in March, which is
 * the kind of fault that teaches the next person to loosen the assertion until it agrees with anything.
 */
function calendarAt(year: number, monthIndex: number, events: number): string {
  const label = new Date(Date.UTC(year, monthIndex - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  });
  return fillCulturalCalendar(screen('cultural-calendar'), { label, year, monthIndex, events, anchor: MARKET_DAY_ANCHOR });
}

test('the calendar’s four affordances survive the fill, which they did not before', () => {
  /*
   * WHAT WENT WRONG, AND WHY THIS TEST IS WRITTEN AGAINST THE REAL SCREEN
   *
   * The fill ended with `fillContainer(out, /<div class="sx-event-layout"[^>]*>/, …)`. That container holds
   * **the month grid AND the selected-date panel** — the whole interactive body of the screen — so the pass
   * written to say "the archive holds 0 events" also deleted the grid, the panel, and the three controls
   * inside it. Measured on the served page: 1,572 bytes gone and four strings the design draws missing:
   * "Read event story", "Submit an event", "Suggest a correction", and the sentence that explains the whole
   * interaction model, "Only dates with event entries are interactive."
   *
   * **A test written against a fixture would have passed**, because the fixture would have been the output of
   * the same mistake. These assertions run against the handed-over HTML.
   */
  const out = calendarAt(2026, 10, 0);

  assert.match(out, />Read event story<\/a>/);
  assert.match(out, />Submit an event<\/a>/);
  assert.match(out, />Suggest a correction<\/a>/);
  assert.match(out, /Only dates with event entries are interactive\./);
  // The container the old fill emptied is still there, and so are its two halves.
  assert.match(out, /<div class="sx-event-layout">/);
  assert.match(out, /<div class="sx-cultural-grid"[^>]*>/);
  assert.match(out, /<aside class="sx-event-day-panel"/);
});

test('the calendar grid is plain days for the month it names, and no invented event', () => {
  const out = calendarAt(2026, 10, 0);

  // October 2026's 1st is a Thursday, so three blanks line the 1st up under `Thu`.
  assert.match(
    out,
    /aria-label="October 2026 cultural events calendar"\s+data-market-month="2026-10">\s*<style>[\s\S]*?<\/style>\s*<div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day" data-market-day-cell><span>1<\/span><\/div>/
  );
  // 31 numbered days, and 3 blanks — the design's own grid held 28 cells, four of which were examples.
  assert.equal((out.match(/<div class="sx-cultural-day" data-market-day-cell><span>\d+<\/span><\/div>/g) ?? []).length, 31);
  assert.equal((out.match(/sx-cultural-day is-empty/g) ?? []).length, 3);

  /*
   * THE MONTH GRID HOLDS THE MARKET-DAY HOOK AND THE MONTH IT IS FOR, AND NO MARKET DAY OF ITS OWN.
   *
   * The hook is per cell and the month is stated once, on the grid: **the fill writes neither `Eke` nor `Orie`
   * nor any other day of the cycle**, because the cycle is reckoned in one place and it is not this file. The
   * same month the heading names is the month the cells are stamped for.
   */
  // The COUNT is of cells rather than of the string: the style block's own selectors contain it as well.
  assert.equal((out.match(/<div class="sx-cultural-day" data-market-day-cell>/g) ?? []).length, 31);
  assert.equal((out.match(/data-market-month="2026-10"/g) ?? []).length, 1);
  for (const day of ['Eke', 'Orie', 'Afọ', 'Nkwọ']) {
    assert.ok(!out.includes(`<small class="muted sx-cal-market-day">${day}`), `the fill wrote the market day ${day} itself instead of leaving it to market-days.js`);
  }
  // The screen loads the one script that reckons the cycle, and exactly one tag of it.
  assert.equal((out.match(/market-days\.js/g) ?? []).length, 1, 'the grid has no market-day script, or more than one');
  assert.match(out, /<script src="\/design\/market-days\.js" defer><\/script>/);

  /*
   * THE ONE STYLE BLOCK, AND WHERE IT IS.
   *
   * `.sx-cultural-day > span` is `display:block` and the cell's own padding is written for the BUTTON the design
   * puts inside an event date, so a plain date and its market day sat hard against the cell's corner with no
   * space between them. The correction has to be in the served page — `public/design/` may not change — **and it
   * has to be in the BODY**: the route replaces the whole `<head>` with the generated SEO head after this fill
   * returns, so a rule written into the head is discarded before anyone sees it. It is also written in AFTER
   * `fillContainer`, because that call replaces everything between the grid's tags.
   */
  assert.match(out, /<div class="sx-cultural-grid"[^>]*><style>\s*\.sx-cultural-day\[data-market-day-cell\]\{padding:\.65rem\}/);
  assert.ok(!out.slice(0, out.indexOf('</head>')).includes('sx-cal-market-day'), 'the market-day rule is in the head, which the route replaces');

  /*
   * AND NOT ONE TRACE OF THE DESIGN'S EXAMPLE EVENTS. Each of these appears in the design file and would be a
   * published cultural-event claim if it survived — a date, an event count, a title, an organiser.
   */
  for (const gone of ['has-event', 'data-event-date', 'Verified event title appears here', '2 events', 'Community-submitted event', 'Exhibition event pattern', 'data-title=']) {
    assert.ok(!out.includes(gone), `the design's example event survived the fill as: ${gone}`);
  }
});

/*
 * ================================================================================================
 * THE MARKET DAY ON EVERY DATE OF THE MONTH GRID, STAMPED BY THE SCRIPT THAT RECKONS THE CYCLE
 * ================================================================================================
 *
 * The two tests below are the whole of this round's claim: **the fill leaves the cells waiting, and the
 * design's own `marketDay()` answers them.** Neither can be proved by reading markup — the label exists only
 * after the script runs — so the second test RUNS the served script in a stub of the two DOM calls it makes and
 * reads what it wrote into the cells. That is the difference between "the markup is present" and "the page
 * shows a market day", and it is exactly the difference that made the blank market-day stamp earlier today.
 */
test('the market-day hook is on every cell and the month marker on the grid, and neither is an event', () => {
  const out = calendarAt(2026, 10, 0);
  const grid = out.slice(
    out.indexOf('<div class="sx-cultural-grid"'),
    out.indexOf('<aside class="sx-event-day-panel"')
  );

  // 31 cells, each one declaring that it wants the cycle's day for its own date.
  assert.equal((out.match(/<div class="sx-cultural-day" data-market-day-cell>/g) ?? []).length, 31);
  // And one month, stated once, in the same tag as the grid's own accessible name.
  assert.equal((out.match(/data-market-month="2026-10"/g) ?? []).length, 1);
  /*
   * THE CELLS STAY INERT. The label is CONTEXT for the date and not a claim about an event: no link, no button,
   * no hover state, and none of the hooks the grid's CSS reads as "this day has something".
   */
  for (const claim of ['has-event', 'data-event-', '<button', '<a ']) {
    assert.ok(!grid.includes(claim), `the month grid claims an event, or an interaction, with: ${claim}`);
  }
});

test('the design’s own script stamps Eke, Orie, Afọ and Nkwọ on the grid, four days apart, from its anchor', () => {
  const out = calendarAt(2026, 10, 0);
  const marker = /data-market-month="(\d{4})-(\d{2})"/.exec(out);
  assert.ok(marker, 'the grid carries no month marker, so nothing can stamp it');
  const cells = (out.match(/<div class="sx-cultural-day" data-market-day-cell>/g) ?? []).length;
  assert.equal(cells, 31);

  /*
   * RUN THE SERVED SCRIPT, IN A STUB OF THE TWO CALLS IT MAKES.
   *
   * `document.querySelector("[data-market-month]")` and `createElement("small")` are the whole of what the
   * spliced lines touch; everything else the script asks for is absent here and its dispatches return early,
   * exactly as they do on the cultural calendar, which has none of those elements either.
   */
  const stamped: string[] = [];
  const cellStubs = Array.from({ length: cells }, () => ({
    appendChild(element: { className: string; textContent: string }) {
      stamped.push(element.textContent);
    },
  }));
  const gridStub = {
    getAttribute: () => `${marker[1]}-${marker[2]}`,
    querySelectorAll: () => cellStubs,
  };
  const scope = globalThis as unknown as { document?: unknown; window?: unknown };
  const realDocument = scope.document;
  const realWindow = scope.window;
  scope.document = {
    querySelector: (selector: string) => (selector === '[data-market-month]' ? gridStub : null),
    /* `dataset` is here because the script's own mobile-navigation tail sets one on the element it builds. */
    createElement: () => ({ className: '', textContent: '', dataset: {} }),
    querySelectorAll: () => [],
    head: { appendChild: () => undefined },
  };
  scope.window = { location: { href: 'http://127.0.0.1:3110/cultural-calendar/' } };
  try {
    // eslint-disable-next-line no-new-func
    new Function(extendMarketDaysScript(readFileSync(SCRIPT, 'utf8')))();
  } finally {
    if (realDocument === undefined) delete scope.document; else scope.document = realDocument;
    if (realWindow === undefined) delete scope.window; else scope.window = realWindow;
  }

  /*
   * THE RECKONING IS THE DESIGN'S, AND IT IS CHECKED BY THE ARITHMETIC RATHER THAN BY THE SCRIPT.
   *
   * The frame is the design's own two constants, written out here on purpose: `["Eke","Orie","Afọ","Nkwọ"]`
   * indexed from 1 at `Date.UTC(2026, 0, 1)`. **1 January 2026 is Orie** — the page's stated anchor — and the
   * expected day of each cell is that index advanced by the whole days between the 1st of January and the cell's
   * own date. A second implementation of the cycle inside the extension would have to agree with this line to
   * pass, and the assertion that the script itself has one `marketDay` is what keeps the two from existing at
   * once.
   */
  const cycle = ['Eke', 'Orie', 'Afọ', 'Nkwọ'];
  const anchorUtc = Date.UTC(2026, 0, 1);
  const expected = Array.from({ length: cells }, (_, index) => {
    const utc = Date.UTC(Number(marker[1]), Number(marker[2]) - 1, index + 1);
    const delta = Math.round((utc - anchorUtc) / 86400000);
    return cycle[((1 + delta) % 4 + 4) % 4];
  });

  assert.equal(stamped.length, cells, 'a cell the fill drew was left without a market day');
  assert.deepEqual(stamped, expected);
  // The anchor itself, which no cell of October can show: the 1st of January 2026 is Orie.
  assert.equal(cycle[((1 + 0) % 4 + 4) % 4], 'Orie');
  // And the four-day cycle, checked against four days of this month rather than one.
  assert.deepEqual(stamped.slice(0, 5), ['Afọ', 'Nkwọ', 'Eke', 'Orie', 'Afọ']);
  assert.deepEqual(stamped.slice(28, 31), ['Afọ', 'Nkwọ', 'Eke']);
  // Every label is one of the four days, and no cell carries anything else.
  assert.deepEqual([...new Set(stamped)].sort(), ['Afọ', 'Eke', 'Nkwọ', 'Orie'].sort());
  /*
   * AND THE CYCLE IS THE DESIGN'S OWN FUNCTION, CALLED AND NOT REIMPLEMENTED. `marketDay`, the anchor and the
   * array of the four days each appear exactly once in the served script; a copy of any of them would be a
   * second reckoning of one cycle, which is what the cross-screen agreement below depends on not existing.
   */
  const extended = extendMarketDaysScript(readFileSync(SCRIPT, 'utf8'));
  assert.equal((extended.match(/const marketDay = /g) ?? []).length, 1);
  assert.equal((extended.match(/const days = \["Eke", "Orie", "Afọ", "Nkwọ"\];/g) ?? []).length, 1);
  assert.equal((extended.match(/const anchor = Date\.UTC\(2026, 0, 1\);/g) ?? []).length, 1);
  assert.equal((extended.match(/const anchorIndex = 1;/g) ?? []).length, 1);
});

test('the calendar panel is honest before its script runs, and keeps every hook the script needs', () => {
  /*
   * `cultural-calendar.js` fills the panel when a date is clicked. **With no event there is no date to click,
   * so the panel's HTML is what a reader sees — including a reader whose JavaScript never arrives, which on
   * this audience's connections is a real case rather than a theoretical one.** "Choose a highlighted date"
   * over a grid with nothing highlighted is the page describing an interface it does not have.
   */
  const out = calendarAt(2026, 10, 0);

  assert.doesNotMatch(out, /Choose a highlighted date/);
  assert.match(out, /<h2 data-event-title>No event is recorded<\/h2>/);
  assert.match(out, /<span class="sx-event-badge" data-event-status>No date has an event<\/span>/);
  assert.match(out, /<p data-event-description>The archive holds no event record[\s\S]*?<\/p>/);
  // The hooks the script looks for are all still present, so the same markup works the day an event exists.
  for (const hook of ['data-event-panel', 'data-event-title', 'data-event-status', 'data-event-meta', 'data-event-description', 'data-event-story']) {
    assert.ok(out.includes(hook), `the panel lost the hook its own script looks for: ${hook}`);
  }
  // The month the page names is the month the panel names, and it is not the design's example month.
  assert.doesNotMatch(out, /October 2026 · demonstration month/);
  assert.match(out, /<time>October 2026 · no verified event<\/time>/);
});

test('a control with no route behind it stops being a link and says why', () => {
  /*
   * THE OWNER'S RULE, APPLIED WHERE HE ASKED FOR IT: **do not invent a working submission endpoint, and do
   * not delete the control either.** `/donate/` and `/sponsors/` keep their forms and disable them; these two
   * keep their labels and their design classes and lose only their `href`, so they cannot be clicked, cannot
   * be focused, and announce what is missing.
   */
  const out = calendarAt(2026, 10, 0);

  assert.doesNotMatch(out, /href="upload\.html">(Submit an event|Suggest a correction)/);
  assert.match(out, /<a class="btn" aria-disabled="true" style="color:var\(--on-night-muted\);opacity:\.8" title="Not built yet[^"]*">Submit an event<\/a>/);
  assert.match(out, /<a class="btn btn-quiet" aria-disabled="true" style="color:var\(--on-night-muted\);opacity:\.8" title="Not built yet[^"]*">Suggest a correction<\/a>/);
  /*
   * AND THE LABEL IS STILL READABLE ONCE IT STOPS BEING A LINK.
   *
   * Measured in the browser before this assertion existed: `Suggest a correction` rendered `rgb(29,26,22)` on
   * the panel's dark green — **1.13:1**, text nobody can read — because the quiet-button rule colours its text
   * for the cream and gold it was drawn over. The colour is now the design's own on-night token, and the
   * assertion is that it is set rather than that a specific hex is.
   */
  assert.equal((out.match(/color:var\(--on-night-muted\);opacity:\.8/g) ?? []).length, 2, 'both inert controls must carry the readable disabled colour');
  // The reason is in the page and not only in a tooltip, because a phone reader never sees a tooltip.
  assert.match(out, /<strong>No submission route exists on this site yet<\/strong>/);
  // The one affordance that CAN honestly work keeps its link and reaches a real page.
  assert.match(out, /<a class="btn btn-gold" data-event-story href="\/cultural-event\/">Read event story<\/a>/);
});

test('the country selector holds the countries of Africa, grouped by the region beside it', () => {
  /*
   * THE FAULT: a Country control labelled "All countries" over `Nigeria · Ghana · Kenya`, beside a Region
   * control offering the whole continent. The list is added at SERVE time — `public/design/` is inviolable —
   * which is why this asserts on the fill's output rather than on the design file.
   */
  const out = calendarAt(2026, 10, 0);
  const select = out.slice(
    out.indexOf('<span>Country</span>'),
    out.indexOf('</label>', out.indexOf('<span>Country</span>'))
  );

  // The design's own three are kept: a country list that dropped them to add others would be a regression.
  for (const kept of ['All countries', 'Nigeria', 'Ghana', 'Kenya']) {
    assert.ok(select.includes(`<option>${kept}</option>`), `the selector lost ${kept}`);
  }
  // 54 sovereign states, each exactly once, plus the empty choice.
  const options = select.match(/<option>/g) ?? [];
  assert.equal(options.length, AFRICAN_COUNTRY_COUNT + 1, `expected ${AFRICAN_COUNTRY_COUNT} countries and "All countries"; found ${options.length - 1}`);
  assert.equal(AFRICAN_COUNTRY_COUNT, 54, `the African Union has 54 member states; this list holds ${AFRICAN_COUNTRY_COUNT}`);
  assert.equal(new Set(AFRICAN_COUNTRIES.flatMap((r) => r.countries)).size, 54, 'a country is listed twice');

  /*
   * GROUPED BY THE REGION CONTROL'S OWN FIVE REGIONS, in the design's order, and alphabetical inside each —
   * **the one ordering a reader cannot read as a ranking.** `All countries` stays outside the groups, because
   * it is the empty choice rather than a country.
   */
  const groups = [...select.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['North Africa', 'West Africa', 'Central Africa', 'East Africa', 'Southern Africa']);
  // `All countries` comes before the first group, because it is the empty choice rather than a country.
  assert.ok(
    select.indexOf('<option>All countries</option>') < select.indexOf('<optgroup'),
    'the empty choice must come before the groups'
  );
  for (const r of AFRICAN_COUNTRIES) {
    assert.deepEqual(
      r.countries,
      [...r.countries].sort((a, b) => a.localeCompare(b, 'en')),
      `${r.region} is not alphabetical, so its order could be read as a ranking`
    );
  }

  // A handful of the states the served page did not have, from a different region each.
  for (const country of ['Ethiopia', 'Senegal', 'Democratic Republic of the Congo', 'Eswatini', 'Egypt']) {
    assert.ok(select.includes(`<option>${country}</option>`), `the selector is missing ${country}`);
  }
  // And the countries deliberately NOT in it, named rather than buried.
  for (const excluded of ['Western Sahara', 'Somaliland', 'Réunion', 'Mayotte', 'Canary Islands']) {
    assert.ok(!select.includes(`<option>${excluded}</option>`), `${excluded} is not a sovereign state and must not be listed`);
  }
});

test('the country options are a pure function of the list, so the page cannot disagree with itself', () => {
  const html = countryOptions();
  assert.match(html, /^<option>All countries<\/option>/);
  assert.equal((html.match(/<optgroup /g) ?? []).length, AFRICAN_COUNTRIES.length);
  assert.equal(countryOptions(), html, 'the options changed between two calls');
  // The design file is not what changed — the list is added to the SERVED page only.
  assert.doesNotMatch(screen('cultural-calendar'), /<optgroup label="North Africa">/);
});

test('today’s Igbo market day is a compact stamp filled by the design’s own script', () => {
  /*
   * THE OWNER'S ADDITION: *"can you add igbo market day on the calendars? i mean, make it smaller at the top,
   * or anywhere that will make it fit into the design of the event calendar"*.
   *
   * **THE DAY IS NOT COMPUTED HERE.** `market-days.js` does it, and a second reckoning of the same cycle in
   * TypeScript would eventually disagree with the first. What this asserts is that the hooks the script fills
   * are present, that the script is LOADED on a screen that did not load it, and that the stamp says what it
   * is — one archive's demonstration from a fixed anchor.
   */
  const out = calendarAt(2026, 10, 0);

  // The two hooks the design's script looks for.
  assert.match(out, /<strong data-market-day>Market day<\/strong>/);
  assert.match(out, /<time data-modern-date>Today<\/time>/);
  /*
   * AND THE PER-CELL HOOK DID NOT SUPPRESS IT. `data-market-day-cell` CONTAINS `data-market-day`, so a guard
   * written as `includes('data-market-day')` — which this fill had — stops inserting the stamp the moment the
   * cells carry their own hook. **The failure is silent: the markup the page keeps looks complete, and the one
   * sentence that states the anchor is simply not there.** So both hooks are counted, and the grid's must not
   * be miscounted for the stamp's.
   */
  assert.equal((out.match(/[\s"']data-market-day(?![\w-])/g) ?? []).length, 1, 'the compact stamp is missing, or inserted twice');
  assert.equal((out.match(/<div class="sx-cultural-day" data-market-day-cell>/g) ?? []).length, 31);

  /*
   * THE SCRIPT TAG, WHICH THE DESIGN'S CULTURAL CALENDAR DID NOT HAVE.
   *
   * Measured: `cultural-calendar.html` loaded `../cultural-calendar.js` and `../mobile-nav.js` and **not**
   * `../market-days.js`. Without this line the two spans would render empty — the label with no day — which is
   * the same class of fault as the missing scripts the owner reported before.
   *
   * **THE PATH IS ASSERTED ABSOLUTE, BECAUSE A RELATIVE ONE SILENTLY FAILS.** The route rewrites
   * `src="../name.js"` into `/design/name.js` BEFORE the fills run, so a tag inserted by a fill never passes
   * through that rewrite; and with the SEO head having replaced the design's `<head>` there is no
   * `<base href="/">` to catch it either. The first version of this insertion wrote `../market-days.js` and the
   * stamp rendered "Market day · Today" — the placeholders — which the browser pass caught and this assertion
   * now holds.
   */
  assert.match(out, /<script src="\/design\/market-days\.js" defer><\/script>/);
  assert.equal((out.match(/market-days\.js/g) ?? []).length, 1, 'the script tag was inserted more than once');
  // And the design's own two scripts are still there, unreordered.
  assert.match(out, /<script src="[^"]*cultural-calendar\.js" defer><\/script>/);
  assert.match(out, /<script src="[^"]*mobile-nav\.js" defer><\/script>/);

  // It is a stamp and not a section: it goes before "Events by date", and it uses the design's own classes.
  assert.ok(out.indexOf('data-market-day') < out.indexOf('sx-calendar-intro'), 'the stamp must come before the month');
  assert.match(out, /<div class="spread" style="gap:var\(--s-3\)">/);
  assert.match(out, /<p class="sx-source-note small"/);

  // The basis is stated, and it is the SAME sentence the Igbo calendar states.
  assert.ok(out.includes(MARKET_DAY_ANCHOR), 'the stamp does not name its anchor');
  assert.match(out, /not a claim that every Igbo community uses the same one/);
  assert.match(out, /<a href="\/igbo-calendar\/">The Igbo calendar<\/a> states the basis in full\./);
  assert.match(fillIgboCalendar(screen('igbo-calendar')), new RegExp(MARKET_DAY_ANCHOR));
});

/* ------------------------------------------------------------------------------------------------
 * THE IGBO CALENDAR — THE ACCOUNT THE OWNER SENT, AND WHERE THE PAGE SAYS IT CAME FROM
 * ---------------------------------------------------------------------------------------------- */

/**
 * The Igbo calendar page, filled.
 *
 * Read from the real design screen rather than from a fixture, for the reason the whole file gives: **a fill
 * matches the design's own markup, so a fixture that agrees with the fill proves nothing about the page.** The
 * assertions below are about the design's markup SURVIVING the fill as much as about the new material arriving
 * — the fault `fillCulturalCalendar` records, where one container-level replacement deleted four of the
 * screen's own affordances while every new sentence appeared correctly.
 */
const igbo = () => fillIgboCalendar(screen('igbo-calendar'));

test('the Igbo calendar keeps every part of the design, and the account goes below it', () => {
  const out = igbo();
  const design = screen('igbo-calendar');

  /*
   * THE DESIGN'S OWN CONTENT IS STILL THERE, COUNTED RATHER THAN EYEBALLED.
   *
   * The new material is appended inside the same `<section>` as the design's own body, so the failure mode is
   * a boundary found in the wrong place: too early deletes the month view, too late lands the block outside
   * `main`. Counting the design's own hooks after the fill is what tells the two apart.
   */
  for (const hook of [
    'data-market-day', 'data-modern-date', 'data-date-input', 'data-calendar-grid', 'data-prev-month',
    'data-next-month', 'data-upcoming-select', 'data-upcoming-results', 'data-year-input', 'data-year-grid',
    'sx-market-week', 'sx-month-section', 'sx-year-section', 'sx-basis-note',
  ]) {
    assert.equal(
      (out.match(new RegExp(hook, 'g')) ?? []).length,
      (design.match(new RegExp(hook, 'g')) ?? []).length,
      `${hook}: the design's markup changed count`
    );
  }
  // Four day cards, and the twelve-month grid container, are still drawn by the design.
  assert.equal((out.match(/data-day-card=/g) ?? []).length, 4);

  // The anchor caveat the fill already made is unchanged, and it is still the same sentence.
  assert.ok(out.includes(MARKET_DAY_ANCHOR), 'the page no longer names its anchor');
  assert.match(out, /It is this archive's demonstration of one reckoning/);

  // The new material is BELOW the design's own last block — the owner's "put these things below there".
  const basis = out.indexOf('<div class="sx-basis-note">');
  const year = out.indexOf('<details class="sx-year-section" id="full-year">');
  const account = out.indexOf('<section class="wrap section sx-cal-account">');
  assert.ok(basis !== -1 && year !== -1 && account !== -1, 'a part of the page is missing');
  assert.ok(account > basis, 'the account must follow the design’s own closing note');
  assert.ok(account > year, 'the account must follow the full-year calendar');
  /*
   * AND IT IS INSIDE `main`, so it is part of the page rather than a block after the footer. The account's
   * section must close before the page's own last `</main>` — checked by the section's close, not its open, so
   * a block spliced into the middle of `main` and one spliced after it cannot both pass.
   */
  const accountEnd = out.indexOf('</section>', account + 40);
  assert.ok(accountEnd !== -1 && accountEnd < out.lastIndexOf('</main>'), 'the account must sit inside main');
});

test('the account’s sections are all present, in the order the page reads', () => {
  const out = igbo();
  const headings = [
    'The system',
    'The days of the week',
    'The thirteen months',
    'Festivals named in this account',
    'Naming after dates',
    'What the archive can substantiate about this account',
    'Sources and how to read them',
  ];
  let at = -1;
  for (const heading of headings) {
    const found = out.indexOf(`<h2>${heading}</h2>`);
    assert.ok(found !== -1, `missing section: ${heading}`);
    assert.ok(found > at, `section out of order: ${heading}`);
    at = found;
  }
});

test('every claim names its source, and the Nri account is marked as Nri’s', () => {
  const out = igbo();

  /*
   * THE ATTRIBUTION IS THE POINT OF THIS WORK, SO IT IS ASSERTED BY NAME RATHER THAN BY A COUNT.
   *
   * The article is named as the source; the two works it relies on most are named where their claims are; the
   * revision is given so a reader can fetch the exact text; and the two references with the weakest support
   * are described as such.
   */
  assert.match(out, /Wikipedia’s <a href="https:\/\/en\.wikipedia\.org\/wiki\/Igbo_calendar">“Igbo calendar” article<\/a>/);
  assert.match(out, /revision of 18 February 2026/);
  assert.match(out, /Onwuejeogwu \(1981\)/);
  assert.match(out, /Udeani \(2007\)/);
  assert.match(out, /Isichei \(1997\)/);
  // The article's own "needs more citations" banner, reproduced rather than hidden.
  assert.match(out, /This article needs more citations/);

  /*
   * THE NRI MARK, IN THE CAPTION, THE COLUMN AND EVERY ROW.
   *
   * The article's months-and-meanings section is the Nri-Igbo calendar of the Nri kingdom by the article's own
   * words, and **presenting it as "the Igbo calendar" is exactly the universalising this archive forbids.** So
   * the marking is asserted where a reader meets it three times over, and the count of rows is asserted so a
   * month cannot be added later without a Nri tag.
   */
  assert.match(out, /it says may differ from other Igbo calendars in naming, rituals and ceremonies\. Every row is Nri’s\./);
  assert.match(out, /<th scope="col">Whose calendar, and which source<\/th>/);
  const thirteen = out.match(/<span class="sx-cal-tag">Nri-Igbo<\/span>/g) ?? [];
  assert.equal(thirteen.length, 13, 'every one of the thirteen months must carry its Nri tag');

  /*
   * AND THE MONTH NAMES THEMSELVES, WITH THEIR DIACRITICS. These are content rather than decoration: a page
   * that dropped `Ọ`, `ụ`, `ị` or `ọ` would still render, and would be wrong in the way this archive's
   * typography test exists to catch.
   */
  for (const name of [
    'Ọnwa Mbụ', 'Ọnwa Abụọ', 'Ọnwa Ife Eke', 'Ọnwa Anọ', 'Ọnwa Agwụ', 'Ọnwa Ifejiọkụ',
    'Ọnwa Alọm Chi', 'Ọnwa Ilọ Mmụọ', 'Ọnwa Ana', 'Ọnwa Okike', 'Ọnwa Ajana',
    'Ọnwa Ede Ajana', 'Ọnwa Ụzọ Alụsị',
  ]) {
    assert.ok(out.includes(name), `missing month: ${name}`);
  }
  // The tone marks and dotted letters are on the page, not stripped in transit.
  for (const character of ['ọ', 'ụ', 'ị', 'ṅ', 'ọ̀', 'ụ́']) {
    assert.ok(out.includes(character), `the diacritic ${character} did not survive the fill`);
  }
  // The variants the design's own day cards list are still stated, and the article's forms are named beside them.
  assert.match(out, /Orie, also Oye/);
  assert.match(out, /Afọ, also Afor/);
});

test('the expandable year control is keyboard-operable in both its forms', () => {
  const out = igbo();

  /*
   * THE NATIVE `<details>`, which is the whole design's own control and needs no script for its state.
   */
  assert.match(out, /<details class="sx-year-section" id="full-year">/);
  assert.match(out, /<summary><span><small>Full-year view<\/small><strong>View full year calendar<\/strong><\/span>/);

  /*
   * THE THIRTEEN MONTH ROWS, WHICH ARE BUTTONS RATHER THAN ANCHORS.
   *
   * A link would need a click handler and `preventDefault`; a `<button>` is operable by Enter and Space with no
   * script at all, so **the keyboard case is a property of the element rather than of the handler.** Each
   * button names the row it controls, and both states are written into the HTML so the descriptions are
   * readable with JavaScript switched off.
   */
  const buttons = out.match(/<button type="button" class="sx-cal-month"[^>]*>/g) ?? [];
  assert.equal(buttons.length, 13, 'one control per month');
  for (let n = 1; n <= 13; n += 1) {
    assert.ok(
      out.includes(`aria-expanded="true" aria-controls="igbo-month-note-${n}"`),
      `month ${n}: the button does not name the panel it controls`
    );
    assert.match(out, new RegExp(`<tr id="igbo-month-note-${n}" class="sx-cal-note-row">`));
  }
  /*
   * NOTHING IS MARKED HIDDEN IN THE MARKUP. The script hides the panels when it runs, so a reader without it
   * gets thirteen open descriptions rather than thirteen dead controls — **the fallback has to be "everything
   * readable", because the alternative is a control that announces a state it does not have.**
   */
  assert.ok(!/sx-cal-note-row"[^>]* hidden/.test(out), 'a note row is written hidden, so no-JS readers lose it');
  // A visible focus ring is declared for the controls this page adds, including the new summary elements.
  assert.match(out, /:is\(a, button, summary\):focus-visible \{ outline: 3px solid var\(--focus, #1b4f8a\)/);
  // The toggle ships with the page, and it is a script rather than a hope.
  assert.match(out, /querySelectorAll\("\.sx-cal-account \.sx-cal-month"\)/);
});

test('the account keeps the archive’s own rules: no event claim, no invented origin, no conversion', () => {
  const out = igbo();

  // **NO EVENT IS CLAIMED.** `/cultural-calendar/` holds zero events and the page has to say the same.
  assert.match(out, /the archive holds no event record for any of them/);
  assert.match(out, /the archive holds no event for any of these festivals/);
  assert.ok(!/ozikoro_event/.test(out), 'the page must not name a table it does not use');

  /*
   * THE ORIGIN SENTENCE IS A TRADITION, NOT AN EVENT. The article's line about the day-spirits being created
   * by Chineke carries no reference, and the archive forbids describing a people as having a non-Igbo origin —
   * so the page records the tradition as a tradition and says the article gives it no reference.
   */
  assert.match(out, /It is set down here as the tradition it is\./);
  assert.match(out, /The article gives it no reference, the archive holds no support for it/);

  // **NO CONVERSION IS INVENTED.** The article gives ranges, so the page prints ranges and says so.
  assert.match(out, /The Gregorian column is a range and not a date\./);
  assert.match(out, /this page prints no such conversion/);

  // The eight-day cycle is recorded and deliberately not drawn.
  assert.match(out, /This page does not draw an eight-day cycle/);

  // The strongest agreement between the page and the article is quoted in the article's own words.
  assert.match(out, /neither universal nor synchronized, so various groups will be at different stages of the week, or even year/);
});

test('the archive’s own verification of the account is stated, not omitted', () => {
  const out = igbo();
  assert.match(out, /The archive can substantiate this/);
  assert.match(out, /Not verified here/);
  // The four records that carry the check, by name, so a reader can go to them.
  for (const title of [
    'Traditional Igbo calendar and lunar/solar alignments',
    'Iguaro: The Igbo Calendar, Culture, and Cosmology',
    'Igu Aro: The Sacred Proclamation of the Igbo Lunar Year from Nri',
    'Symbolism of the Four Market Days in Igbo Culture',
    'Mgbeke: Origin and Etymology and the Derogatory Reputation in Pop Culture',
  ]) {
    assert.ok(out.includes(title), `the check does not name its record: ${title}`);
  }
  /*
   * AND THE LIMIT OF THE CHECK IS STATED. A page that says "verified" without saying what verified it, or
   * without saying that the check was not a live query, has overclaimed.
   */
  assert.match(out, /states it independently of the article/);
  assert.match(out, /and not against a live query/);
  // The works the article cites are all listed with what each is cited for.
  assert.match(out, /The works the article cites, and what each is cited for/);
  assert.match(out, /Which claim rests on which reference/);
});

/**
 * `/market-days/` IS A SEPARATE, OLDER SCREEN AND THE FILL SERVES BOTH.
 *
 * The task that added this account named both addresses, and **they are not the same file**: `market-days.html`
 * is smaller, has no full-year grid, and states its basis in different words — *"The supplied helper sets 1
 * January 2026 as Orie…"*. A fill written only against `igbo-calendar` would leave that screen with the design
 * talking about its own helper, so both sentences are asserted here rather than assumed to be shared.
 */
test('the other screen that loads this script states its anchor too', () => {
  const out = fillIgboCalendar(screen('market-days'));
  assert.match(out, /This page reckons the cycle from a fixed anchor: 1 January 2026 taken as Orie, repeating the four-day cycle\./);
  assert.match(out, /It is this archive's demonstration of one reckoning/);
  assert.match(out, /verify the anchor, the community basis, the timezone, the spellings and whether the day changes at sundown\./);
  assert.ok(!out.includes('The supplied helper sets'), 'the design is still talking about its own helper');
  // The account arrives on this screen too, and the page-specific wording is not used on it.
  assert.match(out, /<section class="wrap section sx-cal-account">/);
  assert.ok(!out.includes('Below the calendar above'), 'the account still assumes the full-year screen');
  assert.ok(out.includes('the reckoning above'), 'the account no longer refers to the page at all');
  // Its own content survives: the day cards, the lookup and the month view are the design's.
  for (const hook of ['data-market-day', 'data-date-input', 'data-calendar-grid', 'data-prev-month']) {
    assert.ok(out.includes(hook), `market-days lost ${hook}`);
  }
  // This screen has no year grid in its design, so no year-grid extension is claimed for it.
  assert.ok(!out.includes('data-year-grid'), 'market-days is not the screen with the full-year grid');
});

/**
 * NO MARKDOWN ASTERISKS, WHICH THE SERVED PAGE SHOWED AS LITERAL TEXT.
 *
 * The description columns of the verification table are escaped plain text, and three of them were written with
 * `**bold**` out of habit. **A test that only looked for the sentences passed while the page printed the
 * asterisks**, which is why this reads the rendered output for the characters rather than for the words.
 */
test('no markdown syntax reaches the served page as literal text', () => {
  const out = igbo();
  assert.ok(!out.includes('**'), 'a markdown bold marker is being served as literal text');
  assert.ok(!/\*\*[^*]+\*\*/.test(out), 'a markdown bold pair is being served as literal text');
  // The emphasis that is meant to be there is HTML, and it is present where the design's own classes allow it.
  assert.match(out, /<strong>This page therefore prints no such conversion<\/strong>/);
  assert.match(out, /<strong>It is recorded here as the tradition it is, not as an event\.<\/strong>/);
});

test('the year grid’s months are made expandable, and the reckoning is untouched', () => {
  const base = readFileSync(SCRIPT, 'utf8');
  const once = extendMarketDaysScript(base);
  const twice = extendMarketDaysScript(once);

  /*
   * IT PARSES, WHICH IS THE FAILURE THIS TEST EXISTS FOR.
   *
   * The extension rebuilds a one-line function that contains template literals with `${…}` in them, and the
   * first four attempts at splicing it produced scripts that did not parse or that called the wrapper from
   * OUTSIDE `renderYear`. **Neither was visible in the page's markup: the HTML was correct and the whole
   * script was dead**, which is the fault this whole file exists to remove. So the result is parsed here, with
   * the same parser the browser uses, rather than read.
   */
  assert.doesNotThrow(() => new Function(once), 'the extended script does not parse');
  // Idempotent: the route reads the file per request, so a second pass must not replace the builder again.
  assert.equal(once, twice, 'the extension is not idempotent');
  assert.equal((once.match(/function renderYear\(\)/g) ?? []).length, 1, 'the year builder was duplicated');

  /*
   * THE FIVE-DAY RECKONING IS THE DESIGN'S, AND SO ARE THE FOUR-DAY GRID AND THE MONTH VIEW.
   *
   * Every line of the design's file must still be present in the extended copy — as a line of its own, or as
   * the PREFIX of the one line the extension replaces. **A test that only counted lines would pass on a
   * version that had dropped the four-day month grid**, which is the fault `fillCulturalCalendar` records for
   * a container-level edit, so both directions are checked: the design's lines survive, and the functions the
   * design's own four-day work lives in are each still declared exactly once.
   */
  const extended = new Set(once.split('\n'));
  for (const line of base.split('\n')) {
    /*
     * THE BUILDER ITSELF IS THE ONE LINE THAT MAY BE GONE, AND IT IS NAMED RATHER THAN ALLOWED FOR.
     *
     * Every other line has to survive verbatim, or as the prefix of the one line that was extended. The year
     * builder is the sole exception — it is REPLACED — so it is listed here explicitly, and the assertions
     * below prove the replacement happened rather than the line merely going missing.
     */
    if (line.includes('function renderYear(){')) continue;
    const bare = line.replace(/\n$/, '');
    const kept = extended.has(line) || [...extended].some((l) => l.startsWith(bare) && l.length > line.length);
    assert.ok(kept, `the extension dropped a line the design wrote: ${line.slice(0, 60)}`);
  }
  // The minified builder is gone and a readable one stands in its place, with the card and the day span intact.
  assert.ok(!once.includes('function renderYear(){if(!yearInput'), 'the minified builder is still there');
  assert.match(once, /card\.innerHTML = `<h3>\$\{name\}<\/h3><div>\$\{days\}<\/div>`;/);
  assert.equal((once.match(/function render\(\)\{/g) ?? []).length, 1, 'the month view builder was rewritten');
  assert.equal((once.match(/function renderUpcoming\(\)/g) ?? []).length, 1);
  /*
   * THE RECKONING IS THE DESIGN'S OWN FUNCTION, CALLED AND NOT REIMPLEMENTED.
   *
   * `marketDay` is declared once and is still the design's arrow function with its own two constants, and the
   * day cells the rebuilt year builder emits still ask it for the day. **A second implementation of the
   * four-day cycle in this extension would be a second reckoning of one cycle**, and this assertion is what
   * stops one being added quietly.
   */
  assert.equal((once.match(/const marketDay = /g) ?? []).length, 1);
  assert.match(once, /const marketDay = date => \{ const utc = Date\.UTC\(date\.getFullYear\(\), date\.getMonth\(\), date\.getDate\(\)\); const delta = Math\.round\(\(utc-anchor\)\/86400000\); return days\[\(\(anchorIndex\+delta\)%4\+4\)%4\]; \};/);
  assert.match(once, /const anchor = Date\.UTC\(2026, 0, 1\);/);
  assert.match(once, /data-market="\$\{marketDay\(d\)\}"/);

  /*
   * AND EACH MONTH IS A NATIVE DISCLOSURE, WITH THE MONTH'S OWN HEADING AS ITS SUMMARY.
   *
   * `<details>`/`<summary>` is operable by keyboard and by assistive technology with no script of its own, so
   * the control the owner asked for is a property of the element rather than of a handler. The heading is
   * MOVED into the summary rather than copied, so the month name is in the document outline once.
   */
  assert.match(once, /const panel = document\.createElement\("details"\);/);
  assert.match(once, /head\.innerHTML = card\.querySelector\("h3"\)\.innerHTML;/);
  assert.match(once, /panel\.className = "sx-cal-year-card";/);
  // The year control's own change listener survives, and the grid is still built on load.
  assert.match(once, /yearInput\?\.addEventListener\("change",renderYear\);renderYear\(\);/);
  // The design's own file on disk is unchanged: the extension is a transform in memory.
  assert.equal(readFileSync(SCRIPT, 'utf8'), base);
});

/*
 * ================================================================================================
 * THE ROTATING NAMES ON THE FRONT PAGE.
 * ================================================================================================
 *
 * `home.html`'s marquee is twelve town and clan names written twice, and every one of them was plain
 * `<li>` text: **the front page held no link to any town or clan.** The fill makes them links, and the
 * assertions here read the real screen rather than a fixture, for the reason the rest of this file does —
 * a name typed differently in the design and in `MARQUEE_PLACES` does not throw, it silently leaves a
 * name unlinked, and a reader cannot tell that from a name that has no record.
 */
const HOME = readFileSync(join(SCREENS, 'home.html'), 'utf8');

/** The design's own marquee names, in order, read out of the real screen. */
function designMarqueeNames(): string[] {
  const start = HOME.indexOf('<div class="sx-marquee-track"');
  const ulOpen = HOME.indexOf('<ul>', start);
  const ulClose = HOME.indexOf('</ul>', ulOpen);
  return [...HOME.slice(ulOpen, ulClose).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!.trim());
}

/** Every resolved link, as the route would build it when all eleven records are published. */
function allMarqueeLinks() {
  return MARQUEE_PLACES.map((p) => ({ label: p.label, href: `/town/${p.slug}/` }));
}

/**
 * The track's own `<ul>` out of a served or transformed screen.
 *
 * **Scoped deliberately**: the marquee also holds `a.sx-market-tab`, which is a real link to the Igbo market
 * calendar and is not part of this transform. A page-wide count of anchors would count it and pass a
 * transform that had added a tab stop to the wrong half.
 */
function marqueeList(html: string): string {
  const start = html.indexOf('sx-marquee-track');
  const ulOpen = html.indexOf('<ul', start);
  const ulClose = html.indexOf('</ul>', ulOpen);
  return html.slice(ulOpen, ulClose);
}

test('the marquee map covers the design as it stands, and Ubulu-Uku is the one name left out', () => {
  const names = new Set(designMarqueeNames());
  for (const place of MARQUEE_PLACES) {
    assert.ok(names.has(place.label), `MARQUEE_PLACES names "${place.label}", which the design's marquee does not show`);
  }
  /*
   * ONE NAME IS DELIBERATELY UNMAPPED, AND IT IS NAMED HERE.
   *
   * `Ubulu-Uku` has no published record in the register — as a name or as an alias — and `/town/ubulu-uku/`
   * returns 404. **It is left as plain text rather than pointed at a guess.** Pinning it means a record
   * appearing for it, or the design renaming an item, fails here and forces the decision rather than
   * letting the list drift.
   */
  const unmapped = [...names].filter((n) => !MARQUEE_PLACES.some((p) => p.label === n));
  assert.deepEqual(unmapped, ['Ubulu-Uku']);
});

test('the track stops being aria-hidden and the list gains a name, so the content is announced once', () => {
  const out = fillMarquee(HOME, allMarqueeLinks());
  assert.ok(!out.includes('<div class="sx-marquee-track" aria-hidden="true">'), 'the track is still aria-hidden');
  assert.match(out, /<div class="sx-marquee-track"><ul aria-label="Communities in the archive">/);
});

test('the first half is reachable and the duplicate half is hidden — one reachable copy, not two', () => {
  const out = fillMarquee(HOME, allMarqueeLinks());
  const ulOpen = out.indexOf('<ul aria-label="Communities in the archive">');
  const lis = [...out.slice(ulOpen, out.indexOf('</ul>', ulOpen)).matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)];
  assert.equal(lis.length, 24, 'the design writes the list twice and the loop needs both halves');

  const hidden = lis.filter((m) => m[1]!.includes('aria-hidden="true"'));
  assert.equal(hidden.length, 12, 'exactly the duplicate half is hidden');
  // The hidden half is the SECOND half: the seam is `translateX(-50%)`, so the first copy is the real one.
  assert.ok(!lis.slice(0, 12).some((m) => m[1]!.includes('aria-hidden')), 'the first half must stay announced');

  /*
   * AND NO TAB STOP SURVIVES INSIDE A HIDDEN HALF. **A focusable link inside `aria-hidden` is the bug this
   * whole transform exists to avoid**: a screen reader is told to ignore the region while the keyboard still
   * walks into it.
   */
  for (const m of hidden) {
    const anchors = [...m[2]!.matchAll(/<a\b[^>]*>/g)].map((a) => a[0]);
    for (const anchor of anchors) {
      assert.ok(anchor.includes('tabindex="-1"'), `a link inside the hidden half is still a tab stop: ${anchor}`);
    }
  }
});

test('the keyboard reaches exactly one stop per real name, and none in the duplicate', () => {
  const list = marqueeList(fillMarquee(HOME, allMarqueeLinks()));
  const stops = [...list.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((a) => !a.includes('tabindex="-1"'));
  // Eleven: the design's twelve minus Ubulu-Uku, which has no record to reach.
  assert.equal(stops.length, 11, `expected one reachable link per resolved name; got ${stops.length}`);
  // Every stop is a real address, and none of them is a placeholder.
  for (const a of stops) assert.match(a, /^<a href="\/town\/[a-z0-9-]+\/" style="color:inherit">$/);
});

test('the link carries inherit colour, because the design link colour is unreadable on this band', () => {
  /*
   * `--link` is `#0d5c45` and the marquee's band is `--emerald-deep`, `#062e22`: about 1.85:1, so a bare
   * anchor here would render the names almost invisible. The design's own rule for a link on a dark band is
   * `.sx-dark a { color: var(--gold-bright) }`, so these inherit the marquee's own colour instead.
   */
  const list = marqueeList(fillMarquee(HOME, allMarqueeLinks()));
  // Twenty-two: eleven reachable in the first half, and the same eleven again in the hidden duplicate.
  const rendered = [...list.matchAll(/<a href="\/town\/[^"]+"([^>]*)>/g)].map((m) => m[1]!);
  assert.equal(rendered.length, 22, `expected a link on both halves of all eleven names; got ${rendered.length}`);
  for (const attrs of rendered) assert.ok(attrs.includes('style="color:inherit"'), `no inherited colour: ${attrs}`);
});

test('a name with no record stays plain text rather than being pointed at a guess', () => {
  const out = fillMarquee(HOME, allMarqueeLinks());
  assert.ok(out.includes('<li>Ubulu-Uku</li>'), 'Ubulu-Uku must stay plain text in the first half');
  assert.ok(!out.includes('/town/ubulu-uku/'), 'no link may be invented for a name with no record');
});

test('a marquee that resolves nothing is left exactly as the design has it', () => {
  // The design's own markup, with its aria-hidden intact — the screen degrades to the design, not to a
  // page that has lost a property it had.
  assert.equal(fillMarquee(HOME, []), HOME);
  assert.equal(fillMarquee(HOME, [{ label: 'A Town The Design Does Not Show', href: '/town/x/' }]), HOME);
});

test('the design screen on disk is untouched: the transform is in memory only', () => {
  const before = readFileSync(join(SCREENS, 'home.html'), 'utf8');
  fillMarquee(HOME, allMarqueeLinks());
  fillHome(HOME, [{ title: 'A record', href: '/a-record/', topic: null }], allMarqueeLinks());
  assert.equal(readFileSync(join(SCREENS, 'home.html'), 'utf8'), before);
});

/*
 * ==================================================================================================
 * THE WATCH SECTION: THE FILMS THE ARCHIVE HOLDS, AND THE DESIGN'S OWN KEPT
 * ==================================================================================================
 *
 * WHY THESE RUN AGAINST THE REAL `watch.html` AND NOT A FIXTURE
 *
 * The fill used to **replace** the first film grid's whole inner content. The design's first grid holds three
 * cards, and two of them are the [Re:]Entanglements Project films — "Faces | Voices" and "Unspoken Stories 1:
 * Onyeso" — so the fill deleted them from the served page, including the one film the design gives a whole
 * page at `/watch-video/`. **A fixture would not have caught that**: the fault is in the relationship between
 * the fill and this particular screen, so the screen is the input, as it is for the marquee above.
 *
 * The extraction assertions are the second half. `substring(… from 'youtube…/embed/…')` returned one film per
 * article, and the Egedege article embeds three, so six films were lost silently. A test that used one embed
 * per article would have passed against the fault.
 */
const WATCH = readFileSync(join(SCREENS, 'watch.html'), 'utf8');

/** Every `data-video-id` on a page, in order — the page's own list of the films it claims. */
const filmIds = (html: string) => [...html.matchAll(/data-video-id="([^"]*)"/g)].map((m) => m[1]!);

/**
 * The cards inside one `<section id="…">`, or `null` when this page does not draw that section at all.
 *
 * **`null` and `[]` are different answers and the difference is the point**: a section that is drawn with an
 * empty grid is the fault the owner found, and a section that is not drawn is the fix. A helper that returned
 * `[]` for both could not tell them apart.
 */
const sectionIds = (html: string, id: string): string[] | null => {
  const start = html.indexOf(`<section class="sx-watch-section" id="${id}"`);
  if (start === -1) return null;
  const end = html.indexOf('</section>', start);
  return filmIds(html.slice(start, end));
};

/** One article row, shaped the way the route passes it. */
const record = (slug: string, title: string, topic: string | null, body_html: string) =>
  ({ slug, title, topic, body_html });

/**
 * One embed frame, in the archive's own shape: **no `src`**, the address in `data-trx-lazyload-src`, and the
 * film's title — when the archive recorded one — in the `title` attribute beside it.
 */
const EMBED = (id: string, title?: string) =>
  `<figure class="wp-block-embed is-type-video"><iframe${title === undefined ? '' : ` title="${title}"`}` +
  ` data-trx-lazyload-src="https://www.youtube.com/embed/${id}?feature=oembed" width="560" height="315"` +
  ` frameborder="0" allowfullscreen></iframe></figure>`;

test('every embed in an article is extracted, not only the first', () => {
  // The Egedege article really embeds three films. The first-match-only query returned one of them, so three
  // is the assertion that would have failed before this work.
  const body = `<p>text</p>${EMBED('ekO2hKFsbEk')}${EMBED('c9hMdWsZDJY')}${EMBED('jVNIwrESgQ4')}`;
  const films = extractArchiveFilms([
    record('the-egedege-dance', 'The Egedege Dance', 'Cultural Heritage', body),
  ]);
  assert.deepEqual(films.map((f) => f.id), ['ekO2hKFsbEk', 'c9hMdWsZDJY', 'jVNIwrESgQ4']);
});

test('one card per film, and the record count is the number of articles that carry it', () => {
  // `jOMjbchyNXg` is genuinely embedded by two published articles. One card, saying two records.
  const films = extractArchiveFilms([
    record('mmili-nkisi-day', 'Mmili Nkisi Day', 'Cultural Heritage', EMBED('jOMjbchyNXg')),
    record('nkisi-river', 'Nkisi River', 'Cultural Heritage', EMBED('jOMjbchyNXg')),
  ]);
  assert.equal(films.length, 1, 'one film must be one card');
  assert.equal(films[0]!.records, 2);
  // The newest-published record arrives first and is the one the card names.
  assert.equal(films[0]!.href, '/mmili-nkisi-day/');
});

test('an article that embedded the same film twice still counts one record', () => {
  const films = extractArchiveFilms([
    record('a', 'A Record', null, `${EMBED('8fD66TzRmEg')}${EMBED('8fD66TzRmEg')}`),
  ]);
  assert.equal(films.length, 1);
  assert.equal(films[0]!.records, 1);
});

test("the film's own title is used where the archive recorded one, the record's where it did not", () => {
  const films = extractArchiveFilms([
    record('peacocks', 'Peacocks International Guitar Band', 'Biography', EMBED('E-bbdBIH4Wg', 'Eddie Quansa')),
    record('nkwa', 'Nkwa Umuagbogho Dance', 'Cultural Heritage', EMBED('lAtHAK-5WZw', 'YouTube video player')),
    record('plain', 'A Record With No Embed Title', 'Ethnohistory', EMBED('Hr30SGgC8LY')),
  ]);
  const byId = new Map(films.map((f) => [f.id, f]));
  assert.equal(byId.get('E-bbdBIH4Wg')!.title, 'Eddie Quansa');
  assert.equal(byId.get('E-bbdBIH4Wg')!.titleFrom, 'film');
  // "YouTube video player" is WordPress's placeholder, not a title: a card must not claim a film is called it.
  assert.equal(byId.get('lAtHAK-5WZw')!.title, 'Nkwa Umuagbogho Dance');
  assert.equal(byId.get('lAtHAK-5WZw')!.titleFrom, 'record');
  assert.equal(byId.get('Hr30SGgC8LY')!.title, 'A Record With No Embed Title');
  assert.equal(byId.get('Hr30SGgC8LY')!.titleFrom, 'record');
});

test('a cited link is not a film: only an embed is extracted', () => {
  // The class this refuses, carrying both measurements that justify it: a deleted upload, and an address
  // whose id is ten characters long and therefore not a YouTube id at all.
  const cited = 'Marre, J. (1985). Beats of the Heart. [Film]. Retrieved from https://youtu.be/7f81_erOkxM '
    + 'and for a glimpse you may watch https://www.youtube.com/watch?v=kmux4aLXc1';
  assert.deepEqual(extractArchiveFilms([record('area-scatter', 'Area Scatter', null, cited)]), []);
});

test("the design's own cards survive the fill, including Faces | Voices, which has its own page", () => {
  const films = extractArchiveFilms([
    record('some-article', 'Some Article', 'Cultural Heritage', EMBED('Hr30SGgC8LY')),
  ]);
  const ids = filmIds(fillWatch(WATCH, films));
  for (const designId of ['E3UBv8pmLxE', 'NBj1CvaDgbM', '0_MvyVVGcxE', '3NnklFf2rXA', 'g1z_-5jqPG0', 'TwFgd11nvEg']) {
    assert.ok(ids.includes(designId), `${designId} must still be on the page after the fill`);
  }
  assert.ok(ids.includes('Hr30SGgC8LY'), 'the archive film must be added');
  // And no id twice: the grid is a film list, not an embedding list.
  assert.equal(new Set(ids).size, ids.length, `an id is on the page twice: ${ids.join(', ')}`);
});

test('a film the design already shows is not added a second time', () => {
  const films = extractArchiveFilms([record('x', 'X', null, EMBED('E3UBv8pmLxE'))]);
  assert.equal(filmIds(fillWatch(WATCH, films)).filter((id) => id === 'E3UBv8pmLxE').length, 1);
});

test('a fill with nothing to add leaves every card the design drew', () => {
  assert.deepEqual(filmIds(fillWatch(WATCH, [])), filmIds(WATCH));
});

test('an archive card names no publisher and no duration that the record does not hold', () => {
  const films = extractArchiveFilms([record('x', 'X', 'Cultural Heritage', EMBED('8fD66TzRmEg', 'A Film'))]);
  const card = renderFilmCard(films[0]!);
  assert.ok(
    card.includes('https://i.ytimg.com/vi/8fD66TzRmEg/hqdefault.jpg'),
    'the poster frame must be the frame that exists for every film'
  );
  assert.ok(!card.includes('maxresdefault'), 'maxresdefault does not exist for every film and must not be used');
  assert.ok(card.includes('publisher not recorded'), 'an unrecorded publisher must be stated, not filled');
  assert.ok(!/duration/i.test(card), 'no duration may be claimed: the archive records none');
});

test('the watch screen on disk is untouched: the fill is in memory only', () => {
  const before = readFileSync(join(SCREENS, 'watch.html'), 'utf8');
  fillWatch(WATCH, extractArchiveFilms([record('x', 'X', null, EMBED('8fD66TzRmEg'))]));
  assert.equal(readFileSync(join(SCREENS, 'watch.html'), 'utf8'), before);
});

test('a WordPress entity in a record title is decoded, not printed', () => {
  // `ojeh-arishi-festival-of-aboh-kingdom-…` really carries `&#038;` in its title, and it is one of the 19
  // articles that embed a film. Escaping without decoding first renders "Ojeh &#038; Arishi" to the reader.
  const films = extractArchiveFilms([
    record('ojeh', 'Ojeh &#038; Arishi Festival of Aboh Kingdom', 'Cultural Heritage', EMBED('SHPEwGDOI7c')),
  ]);
  assert.equal(films[0]!.title, 'Ojeh & Arishi Festival of Aboh Kingdom');
  const card = renderFilmCard(films[0]!);
  assert.ok(card.includes('<h3>Ojeh &amp; Arishi Festival of Aboh Kingdom</h3>'), 'the title must be escaped once, after decoding');
  assert.ok(!card.includes('&#038;'), 'the entity must not survive into the markup as text');
});

/*
 * ==================================================================================================
 * THE MUSIC THE OWNER ASKED OFF THE PAGE, AND THE FILMS THAT MUST SURVIVE IT
 * ==================================================================================================
 *
 * The owner said *"on the watch, remove the musics."* The six ids are named in `WATCH_MUSIC_FILMS` with the
 * reason for each; these tests hold the two edges of that decision — the six are not drawn, and the dance and
 * oral records around them are untouched — and check that the exclusion is a SELECTION and not a deletion:
 * `extractArchiveFilms` still returns the music, so the record keeps the film and a future round has only to
 * delete a line of the map to put a card back.
 */
const MUSIC_IDS = ['8fD66TzRmEg', 'E-bbdBIH4Wg', 'Gk5jUcXeUHc', 'NcBE2UH8WOc', '5a6tJhLpPa4', 'az6b5avH_Zc'];

test('the six films that are music are not drawn on /watch/, and the record still holds them', () => {
  const films = extractArchiveFilms([
    record('peacocks', 'Peacocks International Guitar Band', 'Biography',
      EMBED('8fD66TzRmEg', 'The Peacocks International Guitar Band  - Feresirima') + EMBED('E-bbdBIH4Wg', 'Eddie Quansa')),
    record('christy', 'Christy Essien-Igbokwe', 'Biography', EMBED('Gk5jUcXeUHc', 'Seun Rere (Live)')),
    record('okiri', 'Mike Okiri', 'Biography', EMBED('NcBE2UH8WOc', 'Time Na Money')),
    record('cloud-7', 'Cloud 7', 'Biography', EMBED('5a6tJhLpPa4', 'Beautiful Woman')),
    record('bajan', 'Bajan Folk Music About Jaja of Opobo', 'Discography', EMBED('az6b5avH_Zc', 'King Ja Ja - Sing Out Barbados')),
    // One non-music film beside them, so the assertion cannot pass by the fill drawing nothing at all.
    record('egedege', 'The Egedege Dance', 'Cultural Heritage', EMBED('ekO2hKFsbEk')),
  ]);
  // The extraction is untouched: every one of the six is still a film the archive holds.
  for (const id of MUSIC_IDS) {
    assert.ok(films.some((f) => f.id === id), `${id} must still be extracted from its record`);
  }
  const ids = filmIds(fillWatch(WATCH, films));
  for (const id of MUSIC_IDS) {
    assert.ok(!ids.includes(id), `${id} is music and must not be drawn on the page`);
  }
  assert.ok(ids.includes('ekO2hKFsbEk'), 'the dance film beside them must still be drawn');
});

test('the dance and oral films are NOT removed: no film is dropped for having "dance" in its title', () => {
  // The boundary the owner set: a performance that is danced and played at once is ambiguous, and an
  // archival film removed on a guess is worse than one music video left on the page. Each of these records
  // carries a music label of its own (`Igbo Music`, `Ogene music`, `traditional music`), which is exactly
  // why a label rule could not draw this line.
  const films = extractArchiveFilms([
    record('nkwa', 'Nkwa Ụmụagboghọ Dance', 'Cultural Heritage', EMBED('NIR5CcOUoas') + EMBED('lAtHAK-5WZw')),
    record('ikpirikpi', 'The Ikpirikpi-ogu War Dance', 'Cultural Heritage', EMBED('lg_dSLOKywk') + EMBED('0g2hAF8NdOA')),
    record('egedege', 'The Egedege Dance', 'Cultural Heritage', EMBED('ekO2hKFsbEk') + EMBED('c9hMdWsZDJY') + EMBED('jVNIwrESgQ4')),
    record('atilogwu', 'Atilogwu Dance', 'Cultural Heritage', EMBED('u4ZadZ5hyWs') + EMBED('_w9v21ndnm4')),
    record('egwu-ogene', 'Egwu Ogene: The Heartbeat of Igbo Culture and Music', 'Cultural Heritage', EMBED('la4vThM0MUo')),
    record('cuba', 'Carabalí Isuama', 'Historical Studies', EMBED('bPXKduoup8I')),
  ]);
  // Both pages, because eleven archive films plus the design's own six are more than one page of 15. The
  // subject of this test is that no film is DROPPED, not which of the two pages draws it — and since the
  // design's own six cards are drawn first, the last two of these eleven are on page 2.
  const ids = [...filmIds(fillWatch(WATCH, films)), ...filmIds(fillWatch(WATCH, films, { page: 2 }))];
  for (const f of films) {
    assert.ok(ids.includes(f.id), `${f.id} (${f.title}) must stay: it is a danced or oral performance, not a record`);
  }
});

/*
 * ==================================================================================================
 * 15 A PAGE, WITH A NEXT THAT NEEDS NO SCRIPT
 * ==================================================================================================
 *
 * The owner: *"reduce the list that shows on the page to showing 15 videos, while the rest can be seen when
 * you click next"*. The archive's own paging is the model — `apps/ozikoro/app/archive/page.tsx` reads `page`
 * from the query, clamps it with `Math.max(1, parseInt(...) || 1)`, and draws real `rel="prev"`/`rel="next"`
 * links with a "page N of M" statement — and these tests hold the same four properties on `/watch/`.
 */
/** Eleven characters, as a YouTube id is, and not one of the archive's real ids. */
const synthId = (i: number) => `flm${String(i).padStart(8, '0')}`;
/** `n` archive films, none of them music, each from its own record. */
const synthFilms = (n: number) => extractArchiveFilms(
  Array.from({ length: n }, (_, i) => record(`record-${i}`, `Record ${i}`, 'Cultural Heritage', EMBED(synthId(i))))
);

test('page 1 of /watch/ draws 15 cards, and the pager says which page of how many', () => {
  // 3 design cards in the first grid + 18 archive films + 3 in the series grid = 24 cards, which is the real
  // number after the music is removed from the archive's 24 films. 24 cards at 15 a page is 2 pages.
  const films = synthFilms(18);
  const page1 = fillWatch(WATCH, films);
  assert.equal(filmIds(page1).length, 15, 'page 1 must draw exactly 15 cards');
  assert.ok(page1.includes('page 1 of 2'), 'the page must state which page of how many');
  assert.ok(page1.includes('Showing films 1–15 of 24'), 'the count must come from the real cards');
  assert.ok(page1.includes('href="/watch/?page=2"'), 'Next must be a real link, not a script');
  // Root-absolute, because the head this route writes carries `<base href="/">`: a relative `?page=2`
  // resolves against the site root and lands on the front page. The browser run measured that.
  assert.ok(!page1.includes('href="?page=2"'), 'a relative pager link resolves against <base href="/">');
  assert.ok(!/<script[^>]*>[^<]*page=/i.test(page1), 'paging must not be done in script');
});

test('page 2 draws the rest, and no film stands on both pages', () => {
  const films = synthFilms(18);
  const page1 = fillWatch(WATCH, films);
  const page2 = fillWatch(WATCH, films, { page: 2 });
  const ids1 = filmIds(page1);
  const ids2 = filmIds(page2);
  assert.equal(ids2.length, 9, 'page 2 must draw the remaining 9 cards');
  assert.equal(new Set(ids2).size, ids2.length, 'no card may appear twice on page 2');
  const both = ids1.filter((id) => ids2.includes(id));
  assert.deepEqual(both, [], `a film stands on both pages: ${both.join(', ')}`);
  // Every distinct film the fill was given is on one page or the other, plus the design's own six.
  assert.equal(new Set([...ids1, ...ids2]).size, 24, 'the two pages together must be every distinct card');
  assert.ok(page2.includes('page 2 of 2'));
  assert.ok(page2.includes('rel="prev"'), 'page 2 must offer a way back');
  assert.ok(!page2.includes('rel="next"'), 'there is no page 3 and no link may pretend otherwise');
});

test('the pager appears only when there is more than one page, and the count is not hard-coded', () => {
  // Six design cards plus three archive films: nine cards, one page, no pager and no "of 2".
  const onePage = fillWatch(WATCH, synthFilms(3));
  assert.equal(filmIds(onePage).length, 9);
  assert.ok(!onePage.includes('aria-label="Pagination"'), 'a single page needs no pager');
  // Sixteen cards in the first grid plus three in the series is nineteen — two pages, at 15 a page.
  const twoPages = fillWatch(WATCH, synthFilms(16));
  assert.equal(filmIds(twoPages).length, 15);
  assert.ok(twoPages.includes('page 1 of 2'));
});

test('the control sits between the two sections — under the main videos, above Unspoken Stories', () => {
  /*
   * The owner's words: *"it is supposed to show under the main videos before unspoken stories own"*. The
   * control used to be inserted before `</main>`, which put it below both sections and below the second
   * section's films. The order in the served document is what this test reads.
   */
  const films = synthFilms(18);
  const page1 = fillWatch(WATCH, films);
  const pagerAt = page1.indexOf('aria-label="Pagination"');
  assert.ok(pagerAt !== -1, 'a two-page index needs its control');
  const section1End = page1.indexOf('</section>', page1.indexOf('<section class="sx-watch-section" id="new"'));
  const section2Start = page1.indexOf('<section class="sx-watch-section" id="series"');
  assert.ok(section1End !== -1 && section2Start !== -1, 'both design sections are on page 1');
  assert.ok(pagerAt > section1End, 'the control must come after the main videos');
  assert.ok(pagerAt < section2Start, 'and before the Unspoken Stories section, as the owner asked');

  // On page 2 the second section is not drawn, so the control stands after the only section there — which is
  // still where it is needed, for "Previous".
  const page2 = fillWatch(WATCH, films, { page: 2 });
  const pager2At = page2.indexOf('aria-label="Pagination"');
  const section1End2 = page2.indexOf('</section>', page2.indexOf('<section class="sx-watch-section" id="new"'));
  assert.ok(pager2At > section1End2, 'page 2 keeps the control under the section it pages');
});

test('a page past the end shows the count and a link, never another page’s films', () => {
  const films = synthFilms(18);
  const beyond = fillWatch(WATCH, films, { page: 99 });
  assert.deepEqual(filmIds(beyond), [], 'page 99 must not show page 1 or page 2’s cards');
  // No section either: this page draws no films, so a heading over an empty grid would be the fault the owner
  // found on page 1 of the real page. A page that does not exist must not wear the sections of one that does.
  assert.equal(sectionIds(beyond, 'new'), null, 'no first section on a page that does not exist');
  assert.equal(sectionIds(beyond, 'series'), null, 'no second section either');
  assert.ok(beyond.includes('There is no page 99'), 'the page must say so');
  assert.ok(beyond.includes('24 films in 2 pages'), 'and state the real size of the index');
  assert.ok(beyond.includes('href="/watch/?page=1"'), 'and offer the way back');
  assert.ok(beyond.includes('/watch/?page=1#new'), 'and the anchors go to the page that draws them');
});

test('page 0, a negative page and a page that is not a number all fall back to page 1', () => {
  // Exactly what /archive/ does: Math.max(1, parseInt(...) || 1). Every one of these is the first page.
  const films = synthFilms(18);
  const first = filmIds(fillWatch(WATCH, films));
  for (const page of [0, -3, Number.NaN]) {
    assert.deepEqual(filmIds(fillWatch(WATCH, films, { page })), first, `page ${page} must be page 1`);
  }
});

test('a pager link keeps every other parameter the reader arrived with', () => {
  const films = synthFilms(18);
  const html = fillWatch(WATCH, films, { page: 1, query: '?ozpreview=abc123&page=1' });
  assert.ok(html.includes('href="/watch/?ozpreview=abc123&amp;page=2"'), 'the design preview must survive Next');
});

test('a section with no cards on this page is not drawn, and its anchor is carried to the page that draws it', () => {
  /*
   * THIS TEST SUPERSEDES ONE THAT ASSERTED THE NOTE — `"These films are on page 2 of this list."` — kept in
   * the section shell on page 1 so its heading still stood over something. **The owner found that shell on
   * `/watch/` and asked why "Unspoken Stories" was empty.** A heading with no cards under it, with or without
   * a sentence explaining it, is the fault: the section must not be drawn on a page that has none of its
   * films, and the note is gone with it.
   *
   * The design's own second section is not irrelevant — it carries the owner's `[Re:]Entanglements` films —
   * so it is not removed either: it is drawn on the page that has its cards. What makes that the same page 1
   * the reader lands on is that the design's own six cards are drawn first (see `fillWatch`): twelve in
   * section 1 and three in section 2, with section 1's remaining nine on page 2.
   */
  const films = synthFilms(18);
  const page1 = fillWatch(WATCH, films);
  assert.equal(sectionIds(page1, 'new')?.length, 12, 'section 1 draws twelve cards on page 1');
  assert.equal(sectionIds(page1, 'series')?.length, 3, 'section 2 draws its own three cards on page 1');
  assert.ok(!page1.includes('These films are on page'), 'no page may point at another page for its films');

  const page2 = fillWatch(WATCH, films, { page: 2 });
  assert.equal(sectionIds(page2, 'new')?.length, 9, 'section 1 continues with nine cards on page 2');
  assert.equal(sectionIds(page2, 'series'), null, 'a section with no cards here is not drawn at all');
  assert.ok(!page2.includes('These films are on page'), 'and it is not explained instead of drawn');
  // The design's own filter row links to `#series`, and "Selected films" links to it too ("Browse series ↓").
  // With the section gone from this page, that anchor must go to the page that draws it — not be left
  // pointing at nothing.
  assert.ok(page2.includes('/watch/?page=1#series'), 'the anchor must be carried to the page that has it');
  assert.ok(!page2.includes('href="#series"'), 'a bare `#series` would point at a section that is not here');
});

/* ============================================================================================
 * ROUND 332 — `/listen/` IS A DERIVATION OF THE EPISODE RECORDS, NOT A LIST OF ARTICLES
 * ============================================================================================
 *
 * THE OWNER'S RULE, VERBATIM
 *
 *   "every article with youtube embeded on this blog must automatically appear in watch, same way every
 *    audio inside an article on this website must appear on listen."
 *
 * The page this replaced drew the twelve newest PUBLISHED ARTICLES and gave each a ▶ glyph and the word
 * `Read`, while the archive held three episodes. **It listed twelve things a reader could not hear.** These
 * assertions hold the two properties that make the replacement a derivation rather than a selection: one row
 * per recording handed to it, and nothing drawn that it was not handed.
 *
 * THEY READ THE REAL `listen.html` for the same reason the round-330 block reads `watch.html`: the design's
 * example episode is the thing being removed, and a fixture would not contain it.
 */
import { fillListen, narratorPhrase, type RealTrack } from './design-fill.ts';

const LISTEN = readFileSync(join(SCREENS, 'listen.html'), 'utf8');

/** One recording, shaped the way the route builds it — every field a fact off the episode row. */
const track = (over: Partial<RealTrack> = {}): RealTrack => ({
  title: 'Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots',
  href: '/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/',
  series: 'Historical Studies',
  image: '/media/ozikoro/11234-ute-king.webp',
  length: '2m 24s',
  narrator: narratorPhrase('human', 'Idenze Ezeme'),
  narratorKind: 'human',
  playable: true,
  audioUrl: '/media/ozikoro/episodes/ute-okpu.mp3',
  episode: 'ute-okpu-an-ika-igbo-clan-and-its-nri-roots',
  externalService: null,
  disclosure: 'Read by a person. The words are the article’s own.',
  ...over,
});

const trackRows = (html: string) => [...html.matchAll(/<a class="sx-track"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[0]!);

test('/listen/ draws one row per recording and removes every one of the design’s six example rows', () => {
  const tracks = [
    track(),
    track({ title: 'How the tortoise got his bumpy shell', href: '/how-tortoise-got-his-bumpy-shell/', narratorKind: 'synthetic_own_voice', narrator: narratorPhrase('synthetic_own_voice', 'Idenze Ezeme (synthetic)') }),
    track({ title: 'Igbo folklore: twelve timeless tales', href: '/igbo-folklore-twelve-timeless-tales-of-wisdom-wonder-and-moral-heritage/', narratorKind: 'synthetic_generic', narrator: narratorPhrase('synthetic_generic', null) }),
  ];
  const out = fillListen(LISTEN, tracks);
  assert.equal(trackRows(out).length, 3, 'three recordings, three rows');
  // The design's own six examples are records of nothing. Not one of their titles, durations or links may
  // survive a filled page: the library is the archive's, not the demonstration's.
  for (const example of [
    'The masquerade that judges the living',
    'Why the tortoise’s shell is not smooth',
    'Izuogu: a town remembers its founders',
    'The Obi of Igbodo and the meaning of kingship',
    'String games and the memory of play',
    'The Ika people: origins and migrations',
  ]) {
    assert.ok(!out.includes(example), `the design's example row "${example}" must not be served`);
  }
  assert.ok(!out.includes('>Sample<'), 'no row may claim the design’s placeholder duration');
  assert.ok(!out.includes('>Soon<'), 'and none may claim a recording is coming');
  assert.ok(out.includes('3 recordings approved and published'), 'the note counts the rows above it');
  assert.ok(!out.includes('no recordings are published yet'), 'the design’s own note must be replaced, not kept');
});

test('a recording that is a FILE gives the feature card the design’s own button and one <audio> element', () => {
  const out = fillListen(LISTEN, [track()]);
  assert.match(out, /<audio data-listen-audio preload="none" src="\/media\/ozikoro\/episodes\/ute-okpu\.mp3">/);
  assert.match(out, /<button class="btn btn-gold" type="button" data-listen-toggle aria-pressed="false">/);
  assert.match(out, /href="\/podcast\/ute-okpu-an-ika-igbo-clan-and-its-nri-roots\/transcript\.txt"/);
  assert.ok(out.includes('2m 24s'), 'the length is the measured duration');
  assert.ok(!out.includes('The Ikoro: the drum that spoke for a town'), 'the example episode’s title goes');
  assert.ok(!out.includes('recording awaiting approval'), 'and so does its claim');
  // Exactly one player: a second `<audio>` would make the script's `querySelector` pick one at random.
  assert.equal((out.match(/<audio\b/g) ?? []).length, 1, 'one audio element, not one per row');
  /*
   * AND THE CARD NEEDS SOMEWHERE FOR THE PLAYER TO SAY IT FAILED. `audio-listen.js` reports a refused autoplay
   * or a missing file by writing *"Could not play: …"* into `[data-listen-status]`; the design's feature card
   * has no such element, so without this one a failed press is indistinguishable from a control nobody
   * touched. A second agent found this by pressing the button on the built page.
   */
  assert.match(out, /<p class="small" data-listen-status aria-live="polite">Ready to listen<\/p>/);
});

test('a recording held on a service PAGE becomes a link that leaves, never a button that cannot play', () => {
  const out = fillListen(LISTEN, [
    track({ playable: false, audioUrl: 'https://open.spotify.com/episode/abc', externalService: 'spotify', length: null }),
  ]);
  assert.ok(!out.includes('<audio'), 'a Spotify page is not an <audio src>');
  assert.ok(!out.includes('data-listen-toggle'), 'and there is no button for it to drive');
  assert.match(out, /<a class="btn btn-gold" href="https:\/\/open\.spotify\.com\/episode\/abc"[^>]*target="_blank" rel="noopener noreferrer">/);
  assert.ok(out.includes('Listen on Spotify'), 'the card names the service that holds it');
  assert.ok(out.includes('data-playable="no"'), 'the row states that it does not play in place');
  assert.match(out, /data-narrator-kind="human"/, 'and who is speaking');
});

test('with nothing approved the page says so: no feature section, no list, and not one invented row', () => {
  const out = fillListen(LISTEN, []);
  assert.ok(!out.includes('sx-listen-feature'), 'a "Featured episode" over an episode that does not exist is the fault');
  assert.ok(!out.includes('sx-tracklist'), 'an empty numbered list is still a list');
  assert.ok(!out.includes('sx-track'), 'and not one example row may survive');
  assert.ok(!out.includes('Sample') && !out.includes('Soon'), 'no placeholder duration or promise');
  assert.ok(out.includes('No recording is published yet'), 'the page states the empty state in words');
  // The list's heading stays — the section is the page's, and it says what will appear.
  assert.ok(out.includes('id="all-episodes"'), 'the library heading remains');
});

test('the note is derived from the rows, so the sentence and the page cannot disagree', () => {
  assert.ok(fillListen(LISTEN, [track()]).includes('1 recording approved and published'));
  assert.ok(fillListen(LISTEN, [track(), track()]).includes('2 recordings approved and published'));
});

test('the narrator is the record’s own value, and an unrecorded kind is not guessed', () => {
  assert.equal(narratorPhrase('human', 'Idenze Ezeme'), 'Read by a person · Idenze Ezeme');
  assert.equal(narratorPhrase('synthetic_own_voice', null), 'Synthetic voice, the author’s own');
  assert.equal(narratorPhrase('synthetic_generic', null), 'Synthetic voice');
  assert.equal(narratorPhrase(null, null), 'Narrator not recorded');
  assert.equal(narratorPhrase(undefined, undefined), 'Narrator not recorded');
});

test('/listen/ is a linked screen, so its own menu stops 404ing', () => {
  /*
   * MEASURED BEFORE THIS ROUND: `/listen/home.html`, `/listen/archive-index.html`, `/listen/watch.html` and
   * `/listen/collections.html` all answered 404 — because `listen` was not in `LINKED_SCREENS` and so got
   * neither the `fillDashboardLinks` rewrite nor the `<base href="/">` its siblings have. A 404 is at least
   * honest; the class this repository fears more is the 200 on the wrong page.
   */
  assert.ok(LINKED_SCREENS.includes('listen'), 'listen must be in the set that gets its links rewritten');
  const out = fillDashboardLinks(LISTEN, 'listen');
  assert.match(out, /<head><base href="\/">/);
  for (const [from, to] of [
    ['home.html', '/'],
    ['archive-index.html', '/archive/'],
    ['watch.html', '/watch/'],
    ['collections.html', '/collections/'],
  ] as const) {
    assert.ok(!out.includes(`href="${from}"`), `${from} must not survive as a relative link on /listen/`);
    assert.ok(out.includes(`href="${to}"`), `${from} must resolve to ${to}`);
  }
});

test('the Photographs card carries a drawn camera and not a photograph', () => {
  /*
   * THE OWNER'S FAULT, AS AN ASSERTION. The card for the 3,462 photographs was illustrated by one arbitrary
   * photograph out of the media table — the archive's oldest image record, which is a picture belonging to an
   * article and not a picture of the collection — while the other three cards carried a sign naming what they
   * hold. He asked for the sign.
   *
   * THIS IS TESTED ON `renderCollection` AND NOT ON THE ROUTE, because the route needs a database and the
   * decision worth protecting is the renderer's: **a card that names a drawn sign must not render an `img`,
   * even when it is handed an image.** The card below is deliberately given one, so the precedence is asserted
   * rather than assumed.
   *
   * THE EMOJI IS ASSERTED AGAINST BY NAME. U+1F4F7 is the only camera character Unicode has, and Chrome paints
   * it with Apple Color Emoji: measured on this page at `4rem` it is a grey-and-steel camera that ignores the
   * design's `color` and sits beside three gold line drawings. On a machine without an emoji font it is a tofu
   * box. `stroke="currentColor"` is the assertion that the sign takes the design's colour rather than its own,
   * and `width="1em"` is the one that ties its size to the design's own `font: 400 4rem`.
   */
  const card = renderCollection({
    label: 'Visual archive',
    name: 'Photographs',
    href: '/photographs',
    cta: '3,462 image records',
    image: '/media/ozikoro/11234-ute-king.webp',
    glyph: null,
    drawnGlyph: COLLECTION_CAMERA_SIGN,
  });
  assert.ok(!card.includes('<img'), 'the photographs card must not carry a photograph');
  assert.match(card, /<span class="sx-collection-glyph" aria-hidden="true"><svg /, 'the sign must sit in the design\'s own glyph slot');
  assert.ok(!card.includes('\u{1F4F7}'), 'the sign must not be the camera emoji, which renders in colour');
  assert.match(card, /stroke="currentColor"/, 'the sign must take the design\'s colour, not one of its own');
  assert.match(card, /width="1em" height="1em"/, 'the sign must size itself from the design\'s font-size');
  assert.ok(card.includes('href="/photographs"'), 'the card must still lead where it led');
});

test('the about page puts the fill\'s own paragraph inside the design\'s content column', () => {
  /*
   * THE OWNER'S LAYOUT FAULT, AS AN ASSERTION.
   *
   * *"the place written 'Of 1,051 published histories … largest open problem' does not even stay well on the
   * website, rather it is even moving far left outside the website."*
   *
   * Measured in Chrome at 1440 px: the paragraph's box was `{x: 0, w: 475.9}` while the section beneath it
   * began at `x: 136`, so it hung 136 px to the left of every other element on the page. At 390 px it ran
   * from edge to edge with no padding. **`documentElement.scrollWidth` equalled the viewport at all three
   * widths**, so a scrollWidth check called the page healthy: a block cannot be wider than its containing
   * block, and the fault was that its containing block was the window rather than the column.
   *
   * The cause was placement, not CSS: the fill inserted the paragraph as the previous sibling of
   * `<section class="sx-principles">`, which is a direct child of `<main>`, so the paragraph became one too.
   * Every other block on the page is inside `.wrap`, which is what supplies the column. Nothing in
   * `public/design/` is at fault and nothing there is changed.
   *
   * WHAT IS ASSERTED: the paragraph is inside a `.wrap`, and its containing element is therefore the same
   * one the design's own sections use. `max-width:64ch` stays on the paragraph, so the measure is unchanged.
   */
  const html = readFileSync(join(SCREENS, 'about.html'), 'utf8');
  const out = fillAbout(html, {
    published: 1051, inReview: 0, media: 3488, towns: 188,
    sources: 293, licences: 61, folklores: 41, photographs: 3462, documents: 12,
    contributors: [],
  });
  assert.ok(
    out.includes('<div class="wrap"><p class="small muted" style="max-width:64ch;margin-bottom:var(--s-5)">Of 1,051 published histories'),
    'the principles paragraph must be inside a .wrap, which is the design\'s content column'
  );
  assert.ok(
    !out.includes('</section><p class="small muted"'),
    'no paragraph may be inserted as a bare sibling of a `<section>` directly under `<main>`'
  );
  /*
   * AND THE EDITORIAL NOTE ABOUT WHY IT IS PRINTED GOES. *"That is printed here rather than left for a
   * reader to find out later, because it is the archive's largest open problem."* — that is the archive
   * explaining its own editorial choice to a reader. The figures themselves stay; the note about the act of
   * printing them does not.
   */
  assert.ok(!out.includes('printed here rather than left for a reader'), 'the editorial aside is removed');
});

test('the people note does not claim the authors supplied no portrait, a card shows the one that exists, and a monogram tile carries no caption', () => {
  /*
   * THE OWNER'S QUESTION, AS AN ASSERTION. *"also, what is the relevant of this '… Portraits are monogram
   * tiles because no author on ozikoro.com has uploaded one — no stock faces are used.'?"*
   *
   * The sentence was false. The WordPress usermeta table, which the archive holds in its own SQL dump at
   * `data/ozikoro-wp/dbdump/sql/`, carries a `sabox-profile-image` for **six of the eleven** published
   * contributors, and every one of those files is already in this archive's media store — the REST import
   * read Gravatar's `avatar_urls` and never looked. It was also the wrong kind of sentence: it told a reader
   * how the site was built rather than anything about the people.
   *
   * WHAT IS ASSERTED: the note claims no such thing, the reasoning behind a monogram is not printed at a
   * reader, and `personCard` prefers a real portrait while still drawing a monogram when there is none.
   * **A card must never render a Gravatar URL**, so a `d=mm` silhouette is asserted against by name: that is
   * the stock face the archive's rule forbids.
   *
   * AND THE CAPTION OVER THE MONOGRAM IS ASSERTED ABSENT, ON THE OWNER'S READING OF HIS OWN PAGE. He read
   * *"No portrait supplied"* over a monogram tile and asked for those four words to go: *"the profiles of
   * authors with no images supplied shouldnt show this written words 'No portrait supplied' on it. remove
   * only that written words."* **The assertion is written as a negative AND as a positive, because the two
   * halves are one decision:** the words must not return, and the monogram must not go with them. A test
   * that only asserted the caption absent would pass just as happily on a card with no tile at all, which is
   * the fault the owner did *not* ask for. The tile's accessible name is asserted too: the monogram is
   * `aria-hidden`, so the label is the only place the absence is stated for a reader who cannot see it, and
   * *that* statement is deliberately kept.
   */
  const html = readFileSync(join(SCREENS, 'about.html'), 'utf8');
  const out = fillAbout(html, {
    published: 1051, inReview: 0, media: 3488, towns: 188,
    sources: 293, licences: 61, folklores: 41, photographs: 3462, documents: 12,
    contributors: [
      { slug: 'nze', name: 'Idenze Ezeme', records: 791, bio: 'Igbo history and culture enthusiast.', avatarUrl: '/media/ozikoro/620-IMG_9354-1.jpeg' },
      { slug: 'aka', name: 'Akachukwu Vitalis', records: 2, bio: null, avatarUrl: '/media/ozikoro/3560-akachukwu.jpg' },
      { slug: 'camela', name: 'Camela Chimezirim', records: 0, bio: null, avatarUrl: null },
      { slug: 'okenwa', name: 'Kenechukwu Umeghalu', records: 4, bio: null, avatarUrl: null },
    ],
  });
  assert.ok(!out.includes('no author on ozikoro.com has uploaded one'), 'the false claim is gone');
  assert.ok(!out.includes('no stock faces are used'), 'the archive\'s own drawing rules are not printed at a reader');
  assert.ok(out.includes('Biographies and portraits are shown where the author supplied them.'),
    'the note keeps the one honest reader-facing sentence, including why the list is in this order');
  assert.ok(out.includes('<img src="/media/ozikoro/620-IMG_9354-1.jpeg" alt="Portrait of Idenze Ezeme"'),
    'a contributor with an uploaded portrait is shown it');
  assert.ok(out.includes('<img src="/media/ozikoro/3560-akachukwu.jpg" alt="Portrait of Akachukwu Vitalis"'),
    'a portrait is shown even where there is no biography');
  assert.match(out, /Monogram tile for Kenechukwu Umeghalu: no portrait has been supplied/,
    'a contributor with no portrait keeps the accessible name on the tile, which is where the fact survives');
  assert.ok(!out.includes('No portrait supplied'),
    'the caption the owner removed is not printed over a monogram tile, and no sentence replaced it');
  assert.match(out, /aria-hidden="true"[^>]*>KU<\/span>/,
    'the monogram the owner chose to keep in place of a portrait still renders');
  assert.ok(out.includes('No biography has been supplied. Named here by the work alone.'),
    'a contributor with no biography says so in reader-facing words');
  assert.ok(!/gravatar/i.test(out), 'no Gravatar default may be rendered as a person\'s portrait');
});

/* ------------------------------------------------------------------------------------------------
 * ROUND 338 — ONE FILM'S PAGE, AND THE LINE THAT LINKS IT
 * ---------------------------------------------------------------------------------------------- */

test('watch.js is extended by one line, and a file without the anchor is left alone', () => {
  /*
   * WHY THE EXTENSION EXISTS AT ALL. The design's card plays a film in place, so the only place that knows
   * which film a reader chose is `open(card)` inside `watch.js` — and `fillWatch` puts a film-page link in the
   * inline player for it to point at. `public/design/watch.js` is inviolable, so the line is spliced at request
   * time and served from `/design-screen-assets/watch.js`.
   */
  const base = readFileSync(
    join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'watch.js'),
    'utf8'
  );
  const once = extendWatchScript(base);
  assert.notEqual(once, base, 'the film-page line was not spliced in, so the link would never follow the player');
  assert.match(once, /inline-player-page/, 'the link this line exists for is not named');
  assert.match(once, /\/watch-video\/\?v=/, 'the film page address the link is pointed at is not written');
  /* It parses, rather than merely reading correctly: a script that does not parse takes the player with it. */
  assert.doesNotThrow(() => new Function(once), 'the extended script does not parse');
  // Idempotent, because the route reads the file on every request.
  assert.equal(extendWatchScript(once), once, 'the extension is not idempotent');
  assert.equal((once.match(/inline-player-page/g) ?? []).length, 1, 'the line was spliced in more than once');

  /*
   * AND A FILE THIS PASS DOES NOT RECOGNISE IS RETURNED UNCHANGED RATHER THAN HALF-EXTENDED. The extension is
   * a convenience on top of a player that works; a throw from here would take the player away, which is the
   * trade `extendMarketDaysScript` already records.
   */
  const stranger = 'var x = 1; // a script with no anchor\n';
  assert.equal(extendWatchScript(stranger), stranger, 'a file this pass cannot read was altered');
});

test('one film’s page is filled from the record, and never with the design’s publisher', () => {
  /*
   * MEASURED BEFORE THIS: `/watch-video/` had one address and one film. `/watch/` draws 24 archive films, and a
   * viewing page for any of them showed the design's `Faces | Voices` — its publisher, its YouTube id, its
   * project-page link. **A card that names one film and opens a page about another is the wrong-destination
   * fault at 200.**
   */
  const screen = readFileSync(
    join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'screens', 'watch-video.html'),
    'utf8'
  );
  const film = {
    id: 'LL8YX0pXzdI',
    title: 'ILA OSO',
    titleFrom: 'film' as const,
    topic: 'Cultural Heritage',
    records: 2,
    href: '/ila-oso-a-traditional-dance/',
  };
  const out = fillWatchVideo(screen, film);

  assert.match(out, /youtube-nocookie\.com\/embed\/LL8YX0pXzdI/, 'the player still holds the design’s film');
  assert.match(out, /<h1[^>]*>ILA OSO<\/h1>/, 'the heading names a different film from the one asked for');
  assert.match(out, /youtube\.com\/watch\?v=LL8YX0pXzdI/, 'the outward link is not this film’s');
  assert.match(out, /href="\/ila-oso-a-traditional-dance\/"/, 'the holding record is not named');

  /*
   * THE TWO SENTENCES THAT ARE TRUE OF THE DESIGN'S FILM AND FALSE OF AN ARCHIVE FILM. `Published by
   * [Re:]Entanglements Project` and the project-page link are facts about one video, and the archive records
   * neither for the films it embeds. **An unrecorded field is stated in this archive, never filled.**
   */
  assert.doesNotMatch(out, /\[Re:\]Entanglements/, 'the design’s publisher came with the design’s page');
  assert.doesNotMatch(out, /re-entanglements\.net/, 'the design’s project-page link survived');
  assert.doesNotMatch(out, /E3UBv8pmLxE/, 'the design’s film id survived on another film’s page');
  assert.match(out, /Publisher: not recorded/, 'an unrecorded publisher was not stated');

  // With no film the page is the design's own, which is what `/watch-video/` linked from the home screen is.
  const own = fillWatchVideo(screen);
  assert.match(own, /youtube-nocookie\.com\/embed\/E3UBv8pmLxE/, 'the page’s own film was replaced by nothing');
  assert.match(own, /\[Re:\]Entanglements/, 'the publisher sentence is true of the design’s film and was removed');
});

test('the inline player carries the way to the film’s own page', () => {
  /*
   * A page nobody can reach is the same fault as a link that reaches nothing. `/watch/`'s cards are buttons by
   * the design's own intent, so the link lives in the one place the reader has already named a film: the inline
   * player's actions row, which `extendWatchScript` points at that film.
   */
  const screen = readFileSync(join(SCREENS, 'watch.html'), 'utf8');
  /* An id the design's own cards do not already carry, or the fill returns early with nothing to add. */
  const out = fillWatch(screen, extractArchiveFilms([
    { slug: 'x', title: 'X', topic: null, body_html: '<iframe src="https://www.youtube.com/embed/LL8YX0pXzdI"></iframe>' },
  ]));
  assert.match(out, /id="inline-player-page" href="\/watch-video\/"/, 'the player has no way to a film’s page');
});
