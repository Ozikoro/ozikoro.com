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
import { DASHBOARD_UNBUILT_MAP, LINKED_SCREENS, fillDashboardLinks } from './design-fill.ts';
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
 * The six screens the SAME transform covers and which are not dashboards.
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
   */
  const screens = linkedScreens();
  assert.equal(screens.length, 6, `expected the six non-dashboard screens; found ${screens.length}`);

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
  }

  // The design carries thirty-six across the six. A number that changed means the design changed, and the
  // count is how this test notices rather than passing on a screen that no longer has any.
  assert.equal(totalBefore, 36, `expected 36 placeholders across the six screens; found ${totalBefore}`);
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
    /aria-label="October 2026 cultural events calendar">\s*<div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day"><span>1<\/span><\/div>/
  );
  // 31 numbered days, and 3 blanks — the design's own grid held 28 cells, four of which were examples.
  assert.equal((out.match(/<div class="sx-cultural-day"><span>\d+<\/span><\/div>/g) ?? []).length, 31);
  assert.equal((out.match(/sx-cultural-day is-empty/g) ?? []).length, 3);

  /*
   * AND NOT ONE TRACE OF THE DESIGN'S EXAMPLE EVENTS. Each of these appears in the design file and would be a
   * published cultural-event claim if it survived — a date, an event count, a title, an organiser.
   */
  for (const gone of ['has-event', 'data-event-date', 'Verified event title appears here', '2 events', 'Community-submitted event', 'Exhibition event pattern', 'data-title=']) {
    assert.ok(!out.includes(gone), `the design's example event survived the fill as: ${gone}`);
  }
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
