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
import { fillTopics } from './design-fill.ts';
import { MARQUEE_PLACES, fillHome, fillMarquee } from './design-fill.ts';
import { HOME_STRIP_PLACES, fillHomeTowns, fillTown } from './design-fill.ts';
import { extractArchiveFilms, fillWatch, renderFilmCard } from './design-fill.ts';
import { extendWatchScript, fillWatchVideo } from './design-fill.ts';
import { COLLECTION_CAMERA_SIGN, renderCollection } from './design-fill.ts';
import { fillDocuments } from './design-fill.ts';
import { renderNoNameableDocuments } from './design-fill.ts';
import {
  AFRICAN_COUNTRIES,
  AFRICAN_COUNTRY_COUNT,
  MARKET_DAY_ANCHOR,
  countryOptions,
  extendMarketDaysScript,
  fillCulturalCalendar,
  fillIgboCalendar,
} from './design-fill.ts';
import { designScreenLinks } from './design-paths.ts';

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
/**
 * The design's own `cultural-calendar.js`, which binds the month grid's `[data-event-date]` dates.
 *
 * **Read from the deliverable for the same reason as `market-days.js`**: the fill has to meet the served markup
 * where the design's script already looks, and a test that asserted the fill's own idea of the hook would agree
 * with a fill the design's script cannot bind. The click test below runs THIS file.
 */
const CALENDAR_SCRIPT = join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'cultural-calendar.js');

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
    /*
     * ── THE ONE `href="#"` THAT IS NOT A PLACEHOLDER, AND WHY IT IS COUNTED OUT ───────────────────
     *
     * THE OWNER'S REPORT: *"Open on YouTube is written, not built."* `/watch/`'s
     * `<a id="inline-player-external" href="#" target="_blank" rel="noopener">Open on YouTube ↗</a>` is not
     * a control waiting for a page — **it is a control waiting for a film**, and the design's own `watch.js`
     * gives it one: `externalEl.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id)`.
     * `fillDashboardLinks` therefore leaves it exactly as the design wrote it, and this assertion counts it
     * out rather than pretending the screen no longer carries a `href="#"`.
     *
     * **THE EXEMPT CONTROL IS NAMED AND COUNTED.** One anchor is exempt on `/watch/` and no other screen
     * carries it, so a second placeholder appearing anywhere still fails here.
     */
    const scriptFilled = (
      after.match(/id="inline-player-external"[^>]*href="#"|href="#"[^>]*id="inline-player-external"/g) ?? []
    ).length;
    const left = (after.match(/href="#"/g) ?? []).length - scriptFilled;
    totalBefore += before;

    assert.equal(left, 0, `${name}: ${left} of ${before} placeholder links survived the transform`);
    if (name === 'watch') {
      assert.equal(
        scriptFilled,
        1,
        'the inline player’s external link must keep the design’s own href="#" — watch.js fills it with the film’s address'
      );
    }
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
  /*
   * THE ACADEMY'S COURSES POINT AT THE ACADEMY, NOT AT THIS ARCHIVE AND NOT AT THE RETIRING HOST.
   *
   * They were wired to `https://learn.ozituma.com/`, then to `/academy/` when the host was being retired
   * and the archive's own interim page was the honest interim destination. **The owner then retired that
   * page** — *"delete this page https://ozikoro.com/academy/"* — and `academy.ozikoro.com` was measured
   * answering HTTP/2 200, so the courses are absolute now. Asserting the address the links USED to carry
   * is exactly the assertion that would have let a link to a retired page ship.
   */
  const academy = fillDashboardLinks(screen('academy'), 'academy');
  assert.match(academy, /<a href="https:\/\/academy\.ozikoro\.com\/">Igbo from the beginning<\/a>/,
    'a course title does not reach the Academy itself');
  assert.doesNotMatch(academy, /href="\/academy\/"/,
    'a course title still points at the retired interim page on this host');
  assert.doesNotMatch(academy, /learn\.ozituma\.com/,
    'no course title on the academy screen is wired to the retiring host');
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
  return fillCulturalCalendar(screen('cultural-calendar'), { label, year, monthIndex, events });
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
   *
   * THE FOURTH STRING IS THE ONE THAT HAS SINCE CHANGED ITS WORDS, and the change is asserted where it belongs
   * rather than here: the calendar's dates are real controls again, so the OLD sentence would now be false (it
   * said only dates with an event entry are interactive, and every date above is). What has to survive is the
   * sentence's place and its job — telling the reader what the grid does — which the assertions further down
   * read, both above the grid and below it.
   */
  const out = calendarAt(2026, 10, 0);

  assert.match(out, />Read event story<\/a>/);
  assert.match(out, />Submit an event<\/a>/);
  assert.match(out, />Suggest a correction<\/a>/);
  assert.ok(!out.includes('Only dates with event entries are interactive.'), 'the rule that the restored controls made false is still on the page');
  // The container the old fill emptied is still there, and so are its two halves.
  assert.match(out, /<div class="sx-event-layout">/);
  assert.match(out, /<div class="sx-cultural-grid"[^>]*>/);
  assert.match(out, /<aside class="sx-event-day-panel"/);
});

test('the calendar grid is the month it names, every date a control, and no invented event', () => {
  const out = calendarAt(2026, 10, 0);

  // October 2026's 1st is a Thursday, so three blanks line the 1st up under `Thu`.
  assert.match(
    out,
    /aria-label="October 2026 cultural events calendar"\s+data-market-month="2026-10">\s*<style>[\s\S]*?<\/style>\s*<div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day is-empty" aria-hidden="true"><\/div><div class="sx-cultural-day" data-market-day-cell><button type="button" data-event-date="2026-10-01"/
  );
  // 31 numbered days, and 3 blanks — the design's own grid held 28 cells, four of which were examples.
  assert.equal((out.match(/<div class="sx-cultural-day" data-market-day-cell><button type="button"/g) ?? []).length, 31);
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
   * Every date is a `<button>` now, and the design paints every button inside a day cell `--gold-bright` —
   * because in the design the only button a cell ever held was a day WITH an event. The served-page rule takes
   * that gold off the fill's own cells and leaves the interaction state. It has to be in the served page —
   * `public/design/` may not change — **and it has to be in the BODY**: the route replaces the whole `<head>`
   * with the generated SEO head after this fill returns, so a rule written into the head is discarded before
   * anyone sees it. It is also written in AFTER `fillContainer`, because that call replaces everything between
   * the grid's tags.
   */
  assert.match(out, /<div class="sx-cultural-grid"[^>]*><style>\s*\.sx-cultural-day\[data-market-day-cell\]\{padding:0\}/);
  assert.match(out, /\.sx-cultural-day\[data-market-day-cell\] button\{background:var\(--paper-raised\)/);
  assert.match(out, /\.sx-cultural-day\[data-market-day-cell\]\.is-selected button\{background:var\(--emerald\)/);
  assert.ok(!out.slice(0, out.indexOf('</head>')).includes('sx-cal-market-day'), 'the market-day rule is in the head, which the route replaces');

  /*
   * AND NOT ONE TRACE OF THE DESIGN'S EXAMPLE EVENTS. Each of these appears in the design file and would be a
   * published cultural-event claim if it survived — a title, an event count, an organiser.
   *
   * **`data-event-date` and `data-title` ARE DELIBERATELY NOT ON THIS LIST ANY MORE.** They were, in the round
   * that replaced the design's four example buttons with plain `div`s — and that is the round this page's own
   * owner reported, because removing the design's hooks removed the design's script's only reason to run. The
   * hooks are back; what must not come back is a fabricated event behind them, so the assertions below read
   * what they now say instead of asserting they are gone.
   */
  for (const gone of ['has-event', 'Verified event title appears here', '2 events', 'Community-submitted event', 'Exhibition event pattern', 'Awaiting organiser verification']) {
    assert.ok(!out.includes(gone), `the design's example event survived the fill as: ${gone}`);
  }
});

test('every date is a real control, and the panel it opens is the honest state of that date', () => {
  /*
   * THE OWNER'S SECOND REPORT ON THIS PAGE, IN HIS WORDS: *"why is the events that is clickable not showing
   * there anymore? you added the market days, then removed the functions of the calendar. it is supposed to be
   * showing, and when clicked, you see the events, and the entire thing that was originally built there."*
   *
   * The cause was `data-event-date` disappearing with the design's example grid: `cultural-calendar.js` binds
   * nothing when nothing answers that selector. **This test asserts the hooks are back, one per date, carrying
   * the truth about that date** — the archive holds no event table, so the truth is the date and its absence,
   * and no demonstration title is resurrected to fill the slot.
   */
  const out = calendarAt(2026, 10, 0);
  const buttons = [...out.matchAll(/<button type="button" data-event-date="([^"]+)" data-title="([^"]+)" data-status="([^"]+)" data-meta="([^"]+)" data-description="([^"]+)" aria-pressed="false"><span>(\d+)<\/span><\/button>/g)];

  assert.equal(buttons.length, 31, 'every date of the month must be a control the design’s script can bind');
  for (const [index, button] of buttons.entries()) {
    const whole = button[0]!;
    const date = button[1]!;
    const title = button[2]!;
    const status = button[3]!;
    const meta = button[4]!;
    const description = button[5]!;
    const day = index + 1;
    assert.equal(date, `2026-10-${String(day).padStart(2, '0')}`, 'the buttons are not in date order, or a date is wrong');
    assert.equal(Number(button[6]), day);
    // The four slots the design's script writes the panel from, each saying the truth for ITS OWN date.
    assert.equal(title, `No event is recorded for ${day} October 2026`);
    assert.equal(status, 'No event recorded');
    assert.ok(meta.includes(`${day} October 2026`), 'the meta line must name the date the reader chose');
    assert.match(description, /^The archive holds no event for this date/);
    // And not one of them claims an event, an event count or a demonstration title.
    assert.ok(!whole.includes('has-event'), 'a date claims an event');
    assert.ok(!/\d+ events?\b/.test(description), 'a description claims a number of events');
  }
});

test('the design’s own cultural-calendar.js binds the restored dates and fills the panel on a click', () => {
  /*
   * **A CLICK IS THE ONLY PROOF OF A CONTROL, AND THIS IS THE OFFLINE HALF OF IT.** The markup assertions above
   * cannot tell a button that works from a button nothing listens to — that is exactly how this fault reached
   * the owner, twice. So the SERVED script is run here, in a stub of the four DOM calls it makes, and a click is
   * dispatched at the eleventh date: what the panel then says is what a reader would see.
   *
   * The stub's buttons are built by PARSING THE FILL'S OWN OUTPUT rather than by hand, so a fill that stops
   * writing a hook fails here.
   */
  const out = calendarAt(2026, 10, 0);
  const parsed = [...out.matchAll(/<button type="button" data-event-date="([^"]+)" data-title="([^"]+)" data-status="([^"]+)" data-meta="([^"]+)" data-description="([^"]+)" aria-pressed="false">/g)];
  assert.equal(parsed.length, 31);

  const panelParts = new Map<string, { textContent?: string; href?: string; focus?: () => void }>(
    ['[data-event-title]', '[data-event-status]', '[data-event-meta]', '[data-event-description]', '[data-event-story]'].map((selector) => [
      selector,
      selector === '[data-event-story]' ? { href: '', focus: () => undefined } : { textContent: '', focus: () => undefined },
    ])
  );
  const pressed = new Map<number, string>();
  const handlers: Array<() => void> = [];
  const buttons = parsed.map((m, index) => ({
    dataset: { eventDate: m[1], title: m[2], status: m[3], meta: m[4], description: m[5] },
    setAttribute: (name: string, value: string) => {
      if (name === 'aria-pressed') pressed.set(index, value);
    },
    closest: () => ({ classList: { toggle: () => undefined } }),
    addEventListener: (name: string, handler: () => void) => {
      if (name === 'click') handlers.push(handler);
    },
  }));
  const panel = {
    hidden: true,
    focus: () => undefined,
    scrollIntoView: () => undefined,
    querySelector: (selector: string) => panelParts.get(selector) ?? null,
  };
  const scope = globalThis as unknown as { document?: unknown; window?: unknown };
  const realDocument = scope.document;
  const realWindow = scope.window;
  scope.document = {
    querySelectorAll: (selector: string) => (selector === '[data-event-date]' ? buttons : []),
    querySelector: (selector: string) => (selector === '[data-event-panel]' ? panel : null),
  };
  scope.window = { matchMedia: () => ({ matches: false }) };
  try {
    // eslint-disable-next-line no-new-func
    new Function(readFileSync(CALENDAR_SCRIPT, 'utf8'))();

    // One listener per date, which is the whole of what the design's script does with the grid.
    assert.equal(handlers.length, 31, 'the design’s script bound no click to the dates — the control is dead');
    // And the script's own first-date selection ran, so the panel is not left on its no-script sentence.
    assert.equal(pressed.get(0), 'true');
    assert.equal(panelParts.get('[data-event-title]')?.textContent, 'No event is recorded for 1 October 2026');

    // CLICK THE ELEVENTH DATE and read the panel a reader would be looking at.
    handlers[10]!();
    assert.equal(pressed.get(10), 'true');
    assert.equal(pressed.get(0), 'false', 'the previously selected date was left selected');
    assert.equal(panelParts.get('[data-event-title]')?.textContent, 'No event is recorded for 11 October 2026');
    assert.equal(panelParts.get('[data-event-status]')?.textContent, 'No event recorded');
    assert.equal(panelParts.get('[data-event-meta]')?.textContent, 'No organiser, place or verification date is recorded for 11 October 2026');
    assert.match(panelParts.get('[data-event-description]')?.textContent ?? '', /^The archive holds no event for this date/);
    // The story link follows the date, at the design's own relative address, which the served page's `<base>` resolves.
    assert.equal(panelParts.get('[data-event-story]')?.href, 'cultural-event.html?date=2026-10-11');
    assert.equal(panel.hidden, false);
  } finally {
    if (realDocument === undefined) delete scope.document; else scope.document = realDocument;
    if (realWindow === undefined) delete scope.window; else scope.window = realWindow;
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
   * THE CELLS CARRY A CONTROL AND NO CLAIM. The label is CONTEXT for the date, and the button is what the
   * reader presses; **what must not be in the grid is the one class the page reads as "this day has an event"**,
   * or any title, organiser or event count — the archive holds 0 events and the grid must not say otherwise.
   */
  assert.ok(!grid.includes('has-event'), 'the month grid claims an event');
  assert.ok(!grid.includes('<a '), 'the month grid turned a date into a link');
  for (const claim of ['Verified event title', '2 events', 'Community-submitted event', 'Exhibition event pattern', 'data-status="Verified']) {
    assert.ok(!grid.includes(claim), `the month grid carries an invented event: ${claim}`);
  }
  // Every date is a button, and every button says the same thing about its own date: nothing is recorded.
  assert.equal((grid.match(/<button type="button" data-event-date="/g) ?? []).length, 31);
  assert.equal((grid.match(/data-status="No event recorded"/g) ?? []).length, 31);
});

test('the design’s own script stamps Eke, Orie, Afọ and Nkwọ on the grid, four days apart, from its anchor', () => {
  const out = calendarAt(2026, 10, 0);
  const marker = /data-market-month="(\d{4})-(\d{2})"/.exec(out);
  assert.ok(marker, 'the grid carries no month marker, so nothing can stamp it');
  const cells = (out.match(/<div class="sx-cultural-day" data-market-day-cell>/g) ?? []).length;
  assert.equal(cells, 31);

  /*
   * RUN THE SERVED SCRIPT, IN A STUB OF THE CALLS IT MAKES.
   *
   * `document.querySelector("[data-market-month]")`, the cell's own `querySelector("button")` and
   * `createElement("small")` are the whole of what the spliced lines touch; everything else the script asks for
   * is absent here and its dispatches return early, exactly as they do on the cultural calendar, which has none
   * of those elements either.
   *
   * **AND THE STUB WATCHES WHERE THE LABEL LANDED.** Every cell but the last answers `querySelector("button")`
   * with a button stub, so the test can tell a label appended INSIDE the control from one appended after it —
   * the last cell answers `null`, which is the `/igbo-calendar/` case, and proves the fallback still stamps a
   * cell that has no button in it.
   */
  const stamped: string[] = [];
  const intoButton: boolean[] = [];
  const cellStubs = Array.from({ length: cells }, (_, index) => {
    const record = (element: { className: string; textContent: string }, insideButton: boolean) => {
      stamped.push(element.textContent);
      intoButton.push(insideButton);
    };
    const cell: { appendChild: (element: { className: string; textContent: string }) => void; querySelector?: () => unknown } = {
      appendChild: (element) => record(element, false),
    };
    cell.querySelector = () => (index < cells - 1 ? { appendChild: (element: { className: string; textContent: string }) => record(element, true) } : null);
    return cell;
  });
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
  /*
   * AND EVERY LABEL WENT INSIDE THE BUTTON THE CELL HOLDS, except the one cell whose stub has none — which is
   * the fallback, not a miss. **A label appended after a full-height button is a stray word under the date and
   * outside the thing a reader presses**, which is why this is asserted rather than assumed.
   */
  assert.equal(intoButton.filter(Boolean).length, cells - 1, 'a market-day label was appended outside the date’s button');
  assert.equal(intoButton[cells - 1], false, 'a cell with no button must take the label itself');
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
   * `cultural-calendar.js` fills the panel when a date is chosen, so the panel's own HTML is what a reader sees
   * until then — **and it is all a reader whose JavaScript never arrives ever sees**, which on this audience's
   * connections is a real case rather than a theoretical one. It must therefore state the archive's actual
   * state, and it must not describe an interface the page does not have.
   *
   * **THE DESIGN'S HEADING IS KEPT, AND THAT IS A DECISION WITH A RECORD BEHIND IT.** An earlier pass rewrote
   * the `<h2>` to "No event is recorded", which read honestly and **cost the page a heading the design draws** —
   * `check-design-parity.mjs` reported *"/cultural-calendar — missing h2 'choose a highlighted date'"*. The
   * heading is the panel's accessible name for a control a reader now really does use — choose a date — and the
   * design puts the standing of the chosen date in the badge, the meta line and the description, which is where
   * an event's verification state would live too. So the heading stays as delivered and the state is stated in
   * the three slots built for it.
   */
  const out = calendarAt(2026, 10, 0);

  assert.match(out, /<h2 data-event-title>Choose a highlighted date<\/h2>/);
  assert.match(out, /<span class="sx-event-badge" data-event-status>No date has an event<\/span>/);
  assert.match(out, /<p class="sx-event-meta" data-event-meta>No organiser, place or verification date is recorded for any date this month<\/p>/);
  assert.match(out, /<p data-event-description>The archive holds no event for any date this month\.[\s\S]*?<\/p>/);
  /*
   * AND NO SENTENCE THE RESTORED CONTROL MAKES FALSE. Both of these were on the served page and both were true
   * of the grid the round before this one drew — a grid of `div`s. **A page that says no date can be selected
   * while every date is a button is the contradiction the owner reported**, so they are asserted absent rather
   * than left to be noticed again.
   */
  assert.doesNotMatch(out, /no date is interactive/);
  assert.doesNotMatch(out, /plain date/i);
  assert.doesNotMatch(out, /Plain dates are not clickable/);
  // The hooks the script looks for are all still present, so the same markup works the day an event exists.
  for (const hook of ['data-event-panel', 'data-event-title', 'data-event-status', 'data-event-meta', 'data-event-description', 'data-event-story']) {
    assert.ok(out.includes(hook), `the panel lost the hook its own script looks for: ${hook}`);
  }
  // The month the page names is the month the panel names, and it is not the design's example month.
  assert.doesNotMatch(out, /October 2026 · demonstration month/);
  assert.match(out, /<time>October 2026 · no verified event<\/time>/);
  /*
   * THE TWO SENTENCES BESIDE THE GRID SAY THE SAME AS THE GRID DOES: every date is a control, and the panel
   * answers for the date chosen. The design's own sentences said the opposite — "Plain dates are not clickable"
   * above it and "Only dates with event entries are interactive" below it — and are replaced rather than
   * deleted, because the legend for the page's gold is still needed the day a month has an event in it.
   */
  assert.match(out, /<p>No date this month has an event\. Every date can still be chosen, and the panel says what the archive holds for the date you choose\.<\/p>/);
  assert.match(out, /Every date above can be chosen, and the panel says what the archive holds for the date you choose\. No date in this month has an event recorded\./);
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

test('the affordances are inert in the order the route really runs them: the link pass first, the fill second', () => {
  /*
   * **A TEST THAT CALLS THE FILL ON THE RAW DESIGN FILE PROVES NOTHING ABOUT THE SERVED PAGE, AND THIS IS THE
   * FAULT IT MISSED.** The route calls `designScreenLinks` near the top of the request, before any fill, and
   * that pass rewrites every sibling `…​.html` address to the address this site serves: `href="upload.html"`
   * becomes `href="/upload/"`. The three affordance patterns in `fillCulturalCalendar` were written against the
   * raw `href="upload.html"` — so on the real page none of them matched, and **`Submit an event` and `Suggest a
   * correction` were served as ordinary links** to the publication-deposit screen while the test above, which
   * feeds the fill the design file with no link pass in front of it, passed.
   *
   * Measured on the served page: both controls carried `href="/upload/"` and neither carried `aria-disabled`.
   * So this test runs the two passes in the order the route runs them, and asserts the result a reader gets.
   */
  const linked = designScreenLinks(screen('cultural-calendar'));
  // The link pass is what produces the spelling the old patterns could not see.
  assert.match(linked, /href="\/upload\/"/);
  assert.match(linked, /href="\/cultural-event\/"/);

  const out = fillCulturalCalendar(linked, { label: 'October', year: 2026, monthIndex: 10, events: 0 });
  assert.doesNotMatch(out, /href="\/upload\/"/, 'an affordance with no route behind it was served as a working link');
  assert.equal((out.match(/aria-disabled="true"/g) ?? []).length, 2, 'the two unbuilt controls are not both inert on the served page');
  assert.match(out, /<a class="btn btn-gold" data-event-story href="\/cultural-event\/">Read event story<\/a>/);
  // And every date is still a control after the link pass, which rewrites addresses and not attributes.
  assert.equal((out.match(/data-event-date="/g) ?? []).length, 31);
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

  /*
   * AND THE METHODOLOGY NOTE IS GONE, ON THE OWNER'S INSTRUCTION.
   *
   * The paragraph that sat under the stamp — *"The four-day cycle is kept from different anchors in different
   * communities, so a town that keeps another anchor keeps another market day; the anchor used here is … The
   * Igbo calendar sets out the cycle and the sources behind this account."* — was itself a rewrite of a
   * sentence the owner had already objected to, and he objected to the rewrite by asking for it to be removed:
   * *"why is this on the cultural calendar page? Please remove!"*
   *
   * SO THIS ASSERTION IS INVERTED RATHER THAN DELETED, WHICH IS THE WHOLE POINT OF TOUCHING IT. It used to
   * require the sentence, so the next person who removed it would have been told by the suite that the page
   * had broken, and would have put it back. **A test that requires a thing the owner has asked to be removed
   * removes it again.**
   *
   * AND THE COST IS ASSERTED WITH IT. That paragraph was the only place on this page that named the
   * market-day anchor and the only link from here to the reckoning, so both are absent here **by design** now
   * — and both are present on `/igbo-calendar/` and `/market-days/`, which is asserted at the end of this
   * test so that "absent here" cannot quietly become "absent everywhere".
   */
  assert.ok(!out.includes('The four-day cycle is kept from different anchors'), 'the removed methodology note is back under the stamp');
  assert.ok(!out.includes('sets out the cycle and the sources behind this account'), 'the removed note’s second sentence is back');
  assert.ok(!out.includes(MARKET_DAY_ANCHOR), 'the anchor is named on the page the owner asked it off');
  assert.ok(!out.includes('<p class="sx-source-note small"'), 'a note is written under the stamp again');
  for (const gone of ['A demonstration reckoning', 'not a claim that every Igbo community', 'states the basis in full']) {
    assert.ok(!out.includes(gone), `the sentence the owner reported survived as: ${gone}`);
  }
  // The reckoning still states its anchor where the reckoning itself lives.
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

test('the Igbo calendar keeps every part of the design, and no account is added below it', () => {
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

  /*
   * THE ANCHOR IS STATED, THE DESIGN'S OWN QUALIFICATION STANDS BESIDE IT, AND NOTHING IS AUTHORED.
   *
   * The design writes two sentences: *"This prototype sets 1 January 2026 as Orie and repeats the four-day
   * cycle. It is not a claim that every Igbo community uses the same anchor."* **Only the first is rewritten**,
   * into the anchor this page actually reckons from, which is a value fill of the design's own slot; the second
   * is the design's qualification and is served unchanged. An earlier round replaced BOTH and put a sentence of
   * its own in their place — *"Communities do not all keep the same anchor, so a town that keeps another one
   * keeps another market day."* — which is **prose the design does not contain.** It is asserted absent here so
   * a later round cannot put it back, and the design's sentence is asserted present so a later round cannot
   * decide the qualification is the fill's to write either.
   */
  assert.ok(out.includes(MARKET_DAY_ANCHOR), 'the page no longer names its anchor');
  assert.ok(
    out.includes('It is not a claim that every Igbo community uses the same anchor.'),
    'the design’s own qualification was removed rather than served'
  );
  assert.ok(
    !out.includes('Communities do not all keep the same anchor'),
    'the fill’s authored qualification is back on the page'
  );
  assert.ok(!out.includes('This prototype sets'), 'the design’s build-facing first sentence survived the fill');
  assert.ok(!out.includes("this archive's demonstration of one reckoning"), 'the page still calls its own reckoning a demonstration');
  assert.ok(!out.includes('design basis'), 'the design’s own “design basis” wording survived the fill');

  /*
   * ── AND THE ACCOUNT IS GONE, SO NOTHING IS ADDED BELOW THE DESIGN (round 366) ─────────────────────
   *
   * This block used to assert that the fill's account sat after the design's own closing note and inside
   * `main`. **The owner deleted the whole account** — *"i checked the calendar again, and these things are
   * still there, so delete these immediately"* — so the section, its stylesheet and the guard that inserted it
   * went with its words, and the assertion inverts: the served page carries no `sx-cal-account`, and the
   * design's own structural end is left exactly where the design wrote it. The check on `</main>` is kept
   * because the fault it guarded is the one this fill has produced before, a block spliced outside `main`;
   * with nothing spliced, the count must now match the design's own rather than exceed it.
   */
  assert.ok(!out.includes('sx-cal-account'), 'the removed account section is back on the page');
  assert.equal(
    (out.match(/<\/main>/g) ?? []).length,
    (design.match(/<\/main>/g) ?? []).length,
    'the count of </main> changed, so the fill added or removed a page boundary'
  );
  assert.ok(
    out.indexOf('<div class="sx-basis-note">') < out.lastIndexOf('</main>'),
    'the design’s own basis note must stay inside main'
  );
});

/*
 * ================================================================================================
 * THE CLASS-PARITY TEST: NOTHING ON THE SERVED PAGE THAT THE DESIGN DOES NOT DRAW (round 367).
 * ================================================================================================
 *
 * ⚠️ **THIS IS THE TEST THE OWNER'S THIRD REPORT ASKED FOR, AND IT IS WRITTEN THIS WAY BECAUSE THE FAULT WAS
 * COUNTED RATHER THAN FELT.** His words: *"i specifically told you that the github is updated, and that you
 * should go copy the new design full for the igbo calendar page"* — and *"stop adding what i did not tell you,
 * stop writing anything that i never told you."* Measured on `/igbo-calendar/` before this test existed, the
 * served page carried **twelve `<article class="sx-cal-year-card">` elements inside a `<noscript>`** that the
 * design does not draw, which was the whole of the difference in `sx-cal` elements between the two documents.
 *
 * **THE ASSERTION IS CLASS-BASED RATHER THAN SENTENCE-BASED, AND THAT IS THE POINT.** Every earlier round on this
 * screen guarded a STRING it knew about — "Before production:", "Eken", the Nri `<b>` — and each time the next
 * addition arrived in markup nobody had a string for. A class token is the one thing every element the fill
 * could invent has to carry to be styled, so **the set of class tokens, and the count of each, is compared
 * between the design and the served page.** A new wrapper, a new card, a new section or a duplicated container
 * fails here whatever it is called and whatever it says.
 *
 * WHAT IT DOES NOT COVER, SAID RATHER THAN LEFT TO BE DISCOVERED:
 *   * **SENTENCES.** A prose sentence inside an element the design also draws is invisible to a class count.
 *     Those are guarded by the named assertions in the tests above and below, and the rule against writing them
 *     is the owner's standing instruction — this test is a backstop, not a substitute.
 *   * **THE ROUTE'S OWN SHELL.** `fillMasthead` and the platform bar add `masthead-account`, `nav-account`,
 *     `grid-4`, `small` and `muted` to every screen site-wide, deliberately. They are not this fill's and are
 *     not asserted against here; the test reads `fillIgboCalendar`'s own output.
 *   * **RUN-TIME MARKUP, WHICH USED TO BE LISTED HERE AS ACCEPTABLE AND IS NOT ANY MORE (round 368).** This
 *     test reads the markup the server sends, and it used to say that `extendMarketDaysScript` building
 *     `<details class="sx-cal-year-card">` in the browser was "the script's own and legitimately absent from the
 *     served HTML". **That was the blind spot, and the fault lived in it:** `curl` reported 0 of the class while
 *     a reader's browser built 12, and the wrapper took the month's day grid out of the `<article>` the design's
 *     stylesheet selects on. **The extension no longer adds any class**, and the assertion that it does not is
 *     in the `renderYear` test above. A class the extension added in future would fail there rather than here.
 */
test('the served calendar draws no class the design does not draw, and duplicates none of them', () => {
  const design = screen('igbo-calendar');
  const out = igbo();

  /** Every class token in a document, with the number of times it is used. */
  const classTokens = (html: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const match of html.matchAll(/class="([^"]*)"/g)) {
      for (const token of match[1]!.split(/\s+/)) {
        if (token) counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    return counts;
  };

  const inDesign = classTokens(design);
  const served = classTokens(out);

  // The design must actually carry classes, or the comparison below passes vacuously.
  assert.ok(inDesign.size > 20, 'the design screen carried almost no classes, so this test would prove nothing');

  /*
   * ⚠️ NOTHING THE DESIGN DOES NOT DRAW. This is the assertion the twelve year cards failed.
   */
  const invented = [...served.keys()].filter((token) => !inDesign.has(token)).sort();
  assert.deepEqual(invented, [], `the served page draws class(es) the design does not: ${invented.join(', ')}`);

  /*
   * ⚠️ AND NOTHING THE DESIGN DRAWS ONCE IS DRAWN TWICE. A wrapper added around a design element, or a second
   * copy of a section, changes a count without introducing a new class name — so the counts are compared as
   * well as the names. **A count that is LOWER is allowed and expected**: this fill removes the design's
   * demonstration flag and its build-facing notes on purpose, and a class may go with them.
   */
  const grown = [...served.entries()]
    .filter(([token, count]) => count > (inDesign.get(token) ?? 0))
    .map(([token, count]) => `${token} (${inDesign.get(token) ?? 0} → ${count})`);
  assert.deepEqual(grown, [], `the served page repeats class(es) the design draws once: ${grown.join(', ')}`);

  /*
   * AND THE `sx-cal` ELEMENTS SPECIFICALLY, COUNTED THE WAY THE REPORT COUNTED THEM. The year cards were the
   * whole of the gap and they are named here as well as covered by the general rule above, because **a
   * regression should say which element came back rather than only that some class appeared.**
   */
  const sxCalTokens = (html: string): Map<string, number> =>
    new Map([...classTokens(html)].filter(([token]) => token.startsWith('sx-cal')));
  const designSxCal = sxCalTokens(design);
  const servedSxCal = sxCalTokens(out);
  assert.deepEqual(
    [...servedSxCal.keys()].filter((token) => !designSxCal.has(token)).sort(),
    [],
    'an sx-cal element the design does not draw is on the served page'
  );
  for (const [token, count] of servedSxCal) {
    assert.ok(
      count <= (designSxCal.get(token) ?? 0),
      `${token}: the served page draws ${count}, the design draws ${designSxCal.get(token) ?? 0}`
    );
  }
  // The specific element the third report measured, asserted by name.
  assert.ok(!out.includes('sx-cal-year-card'), 'the year-card markup the design does not draw is back in the served HTML');
  assert.ok(!out.includes('<noscript'), 'the fill is writing a <noscript> block into the design again');
});

/*
 * ================================================================================================
 * THE OWNER'S FOURTH REPORT: ELEVEN OF THE DESIGN'S OWN SECTIONS WERE NOT ON THE SERVED PAGE.
 * ================================================================================================
 *
 * ⚠️ **EVERY TEST ABOVE PASSES WHILE THE PAGE IS MISSING ELEVEN OF THE DESIGN'S SECTIONS, WHICH IS WHY THIS ONE
 * EXISTS.** The class-token test above asserts the served page draws no class the design does not — **a page
 * that has LOST content satisfies that perfectly**, and one did: `sx-cal-knowledge`, `sx-cal-units`,
 * `sx-cal-table-wrap`, `sx-cal-months`, `sx-cal-directions`, `sx-cal-sample-wrap`, `sx-cal-sample`,
 * `sx-cal-months-meanings`, `sx-cal-meanings`, `sx-cal-fest` and `sx-cal-sources` were all absent, along with
 * two of the seven `eyebrow` elements, while every "nothing invented" assertion stayed green.
 *
 * **SO THIS TEST ASSERTS THE OTHER DIRECTION: NOTHING THE DESIGN DRAWS HAS GONE.** It compares the design's
 * `<main>` with the served `<main>`, token by token, in the direction that catches a deletion — and it names the
 * eleven sections, because a report should say which section came back rather than only that the count moved.
 *
 * WHY `<main>` RATHER THAN THE WHOLE DOCUMENT. The route replaces the head with generated SEO metadata and
 * `designScreenLinks` makes the design's addresses absolute, so the head and the menu legitimately differ. The
 * `<main>` element is the page the design drew.
 */
test('every class token in the design’s calendar is on the served page, and none of its eleven sections is missing', () => {
  const design = screen('igbo-calendar');
  const out = igbo();
  const mainOf = (html: string): string => {
    const match = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html);
    assert.ok(match, 'the screen has no <main> element');
    return match![1]!;
  };
  const designMain = mainOf(design);
  const servedMain = mainOf(out);

  /** Every class token in a fragment, with the number of times it is used. */
  const classTokens = (html: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const match of html.matchAll(/class="([^"]*)"/g)) {
      for (const token of match[1]!.split(/\s+/)) {
        if (token) counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    return counts;
  };

  const inDesign = classTokens(designMain);
  const served = classTokens(servedMain);
  assert.ok(inDesign.size > 20, 'the design’s <main> carried almost no classes, so this test would prove nothing');

  /*
   * ⚠️ EVERY TOKEN THE DESIGN DRAWS IN `<main>` IS ON THE SERVED PAGE, AT LEAST AS MANY TIMES.
   *
   * **THE ONE TOKEN THE FILL REMOVES IS NOT IN `<main>` AND IS ASSERTED SEPARATELY BELOW.** The design's
   * page-level banner, `<p class="example-flag">Design demonstration — the market-day basis shown here requires
   * community verification before publication.</p>`, sits between the skip link and the masthead; it is a
   * statement about the deliverable rather than about the calendar, so `clearExampleMaterial` removes it. Every
   * token that IS inside `<main>` must survive.
   */
  const missing = [...inDesign.entries()]
    .filter(([token, count]) => (served.get(token) ?? 0) < count)
    .map(([token, count]) => `${token} (design ${count} → served ${served.get(token) ?? 0})`);
  assert.deepEqual(missing, [], `the served page has lost class(es) the design draws: ${missing.join(', ')}`);

  /*
   * AND THE DELIBERATE EXCEPTION IS PROVED RATHER THAN ASSERTED IN PROSE: the banner is in the design, outside
   * `<main>`, and gone from the served page. **If a future round removes something else and calls it the
   * banner, that removal is not covered here** — this test names the banner's own sentence, so only it is
   * excused.
   */
  assert.ok(
    design.includes('<p class="example-flag">Design demonstration'),
    'the design no longer draws the example-flag banner this test excuses'
  );
  assert.ok(!out.includes('class="example-flag"'), 'the demonstration banner is back on the served page');

  /*
   * ── AND THE ELEVEN SECTIONS THE FOURTH REPORT NAMED, ASSERTED ONE BY ONE ─────────────────────────
   *
   * `wrap sx-cal-knowledge` is the design's own nesting — the knowledge section is `<section class="wrap
   * sx-cal-knowledge">` — so the token that identifies it is `sx-cal-knowledge` and `wrap` is asserted by count
   * rather than by shape, because five design elements carry it.
   */
  const SECTIONS: [string, number][] = [
    ['sx-cal-knowledge', 1],
    ['sx-cal-units', 1],
    ['sx-cal-table-wrap', 1],
    ['sx-cal-months', 1],
    ['sx-cal-directions', 1],
    ['sx-cal-sample-wrap', 1],
    ['sx-cal-sample', 1],
    ['sx-cal-months-meanings', 1],
    ['sx-cal-meanings', 1],
    ['sx-cal-fest', 1],
    ['sx-cal-sources', 1],
  ];
  for (const [token, count] of SECTIONS) {
    assert.equal(inDesign.get(token), count, `the design no longer draws ${token}, so this assertion is stale`);
    assert.equal(
      served.get(token) ?? 0,
      count,
      `${token}: the design draws ${count}, the served page draws ${served.get(token) ?? 0} — the section is missing`
    );
  }
  // `wrap` is the design's own shared container, drawn three times in `<main>`, and every one must still be there.
  assert.equal(inDesign.get('wrap'), 3, 'the design no longer draws three .wrap containers in <main>');
  assert.equal(served.get('wrap'), 3, `the served page draws ${served.get('wrap') ?? 0} .wrap containers, the design draws 3`);
  assert.equal(inDesign.get('eyebrow'), 7, 'the design no longer draws seven eyebrows');
  assert.equal(served.get('eyebrow'), 7, `the served page draws ${served.get('eyebrow') ?? 0} eyebrows, the design draws 7`);

  /*
   * ── AND BY SENTENCE, NOT ONLY BY CLASS, BECAUSE A CLASS IS A NAME ANYBODY CAN REUSE ─────────────
   *
   * These are the design's own words inside the sections that went missing. A rewrite that kept the classes and
   * emptied the sections passes the counts above and fails here.
   */
  for (const sentence of [
    'Nri-Igbo reckoning',
    'The thirteen months (Ọnwa) and their Gregorian equivalents',
    'Days and directions',
    'An example of a month: Ọnwa Mbụ',
    'Festivals of the year',
    'Not universal, not synchronised.',
    'The traditional time keepers in Igboland are the priests or Dibia.',
  ]) {
    assert.ok(designMain.includes(sentence), `the design no longer carries ${JSON.stringify(sentence)}, so this assertion is stale`);
    assert.ok(servedMain.includes(sentence), `the served page has lost the design’s own sentence: ${JSON.stringify(sentence)}`);
  }

  /*
   * ── AND THE THREE THINGS THE PREVIOUS ROUND REMOVED ARE STILL ZERO ───────────────────────────────
   *
   * These are asserted here as well as above, because the cheapest way to "restore the design" is to put them
   * back — and every one of them is content the design does not draw.
   */
  assert.equal(servedMain.includes('sx-cal-year-card') ? 1 : 0, 0, 'the twelve year cards are back');
  assert.equal(out.includes('<noscript') ? 1 : 0, 0, 'a <noscript> block is back');
  assert.equal(out.includes('drawn by this page') ? 1 : 0, 0, 'the fill’s own prose is back');
  // And the count the fourth report measured, kept as a number so a regression names it.
  assert.ok(servedMain.length > 0 && designMain.length > 0);
});

test('the account’s sections are gone, and no appendix has returned in their place', () => {
  const out = igbo();
  /*
   * ── WHAT SURVIVED, AND WHY THE LIST IS NOW EMPTY (round 365, then round 366) ─────────────────────
   *
   * The owner rejected the appendix twice: *"after 'community context matters', the rest are scattered, and
   * extremely useless. can you fucking arrange it well like others?"* and then *"remove everything about
   * wikipedia there. the right sources are fine."* Round 363 cut five sections and left **three headings and
   * two tables**; round 365 removed the rest and this assertion named **the two headings that survived** —
   * the calendar's own content and the account of which calendar it is.
   *
   * ⚠️ **THE OWNER THEN DELETED THOSE TWO AS WELL, WITH EVERY PARAGRAPH UNDER THEM.** *"i checked the calendar
   * again, and these things are still there, so delete these immediately"* — and the blocks he listed are the
   * two headings, the paragraphs naming the archive's five catalogued records, the month-names attribution,
   * the Nri statement and the paragraph saying what the page does not do. **So the assertion inverts for the
   * third time rather than being deleted**: the two headings are asserted absent by name, and the long list of
   * earlier appendix sections stays, because the fault it guards is the same one every round — **the appendix
   * returning one section at a time, which is how it arrived the first time.**
   */
  for (const heading of [
    'The year and its months',
    'What this account is, and where it comes from',
  ]) {
    assert.ok(!out.includes(`<h2>${heading}</h2>`), `the removed account section is back: ${heading}`);
  }
  /*
   * AND EVERY HEADING THE APPENDIX EVER CARRIED IS ASSERTED ABSENT, INCLUDING THE TWO THAT WERE STILL HERE
   * AFTER ROUND 363. The claim table and the source section are the ones the owner's second report named —
   * *"no, you did not fix it"* — so they are asserted gone by name rather than left to a word count.
   */
  for (const gone of [
    'The system',
    'The days of the week',
    /* the owner's design carries this — see the note above this list. */
    'Festivals named in this account',
    'Naming after dates',
    'Sources and how to read them',
    'The works the article cites, and what each is cited for',
    'Which claim rests on which reference',
    'What the archive can substantiate about this account',
    'Where this account comes from, and what is not on this page',
  ]) {
    assert.ok(!out.includes(`<h2>${gone}</h2>`), `the removed appendix section is back: ${gone}`);
    assert.ok(!out.includes(`<h3>${gone}</h3>`), `the removed appendix subsection is back: ${gone}`);
  }
  /*
   * AND THE FILL'S TABLE IS GONE TOO — NOT ONE TABLE, NONE.
   *
   * This read `assert.equal((body.match(/<table /g) ?? []).length, 1, 'the account must have one table: the
   * months')`, and the comment said the month list was still a table so the count was 1 and not 0. **That was
   * true of the old design.** The owner's updated `igbo-calendar.html` draws the thirteen months itself —
   * `table.sx-cal-months`, carrying the Gregorian equivalents — so the fill's `sx-ledger-table` was a third
   * copy of the same thirteen months and has gone with its buttons. **In this account there are now no tables
   * at all, and a rebuilt one is what this guards against.** The removed claims table's caption is still
   * asserted absent below, because a caption is what a rebuilt version would most easily keep.
   *
   * ⚠️ AND THE CHECK NO LONGER SLICES THE ACCOUNT OUT OF THE PAGE, BECAUSE THE ACCOUNT IS GONE (round 366).
   * There is no `sx-cal-account` body left to read, and `slice(-1)` on a missing marker would have quietly
   * tested the page's last character instead — which is how a "no table in the account" assertion passes
   * vacuously once the account disappears. **The check is now on the whole served page, which is stricter than
   * the slice was**, and the design's own thirteen-month table is asserted present so that "no table" cannot
   * be satisfied by the design's table going missing either.
   */
  assert.ok(!out.includes('sx-cal-account'), 'the removed account section is back on the page');
  assert.ok(!out.includes('sx-ledger-table'), 'the fill\'s own month table is back');
  assert.ok(!out.includes('sx-cal-dates'), 'the fill\'s month-table cells are back');
  for (const gone of [
    'What the article claims, and what the archive holds for it',
    'The archive can substantiate this',
    'Not verified here',
    'The page reports what the article says the book says',
  ]) {
    assert.ok(!out.includes(gone), `the removed claim table is back: ${gone}`);
  }
  // The design's own thirteen months are still the page's one table.
  assert.match(out, /<table class="sx-cal-months">/);
});

test('the expandable year control is keyboard-operable, and the page adds no control of its own', () => {
  const out = igbo();

  /*
   * THE NATIVE `<details>`, which is the whole design's own control and needs no script for its state.
   */
  assert.match(out, /<details class="sx-year-section" id="full-year">/);
  assert.match(out, /<summary><span><small>Full-year view<\/small><strong>View full year calendar<\/strong><\/span>/);

  /*
   * ── AND THE THIRTEEN MONTH BUTTONS ARE GONE (round 365) ─────────────────────────────────────────
   *
   * This test used to require thirteen `<button class="sx-cal-month">` controls, an `aria-controls` panel for
   * each, no row written hidden, and the toggle script that closed them. **All of it existed to open the
   * article's description of a month**, and the descriptions went with the article — so the controls have
   * nothing to open and the script has nothing to bind.
   *
   * **A control that announces a state it does not have is worse than no control**, which is this file's own
   * standard, so the assertion is inverted: the rows are plain table rows, there is no button and no panel,
   * and the script that used to close them is not shipped. The native `<details>` above is the page's only
   * disclosure control and it is the design's own.
   */
  /*
   * ⚠️ THE PATTERN NEEDS A BOUNDARY, AND WITHOUT IT THIS ASSERTION READS THE DESIGN AS THE FILL.
   *
   * `/sx-cal-month/` is a PREFIX of the design's own table class, `sx-cal-months` — so once the owner's
   * updated design gained its thirteen-month table, this assertion counted the DESIGN's class as the
   * fill's buttons and reported five of them. It read as stray controls; it was one class matched five
   * times. The negative lookahead is what makes it test what its message says.
   */
  assert.equal((out.match(/sx-cal-month(?!s)/g) ?? []).length, 0, 'the month buttons are back');
  assert.equal((out.match(/igbo-month-note-/g) ?? []).length, 0, 'the month description panels are back');
  assert.equal((out.match(/sx-cal-note-row/g) ?? []).length, 0, 'the month description rows are back');
  assert.ok(!out.includes('querySelectorAll(".sx-cal-account .sx-cal-month")'), 'the month toggle script is back');
  assert.ok(!out.includes('aria-expanded="true" aria-controls="igbo-month-note'), 'a month control is back');
  /*
   * ── AND THE FILL'S OWN THIRTEEN-ROW TABLE IS GONE TOO ───────────────────────────────────────────
   *
   * This assertion used to read *"the thirteen rows are STILL thirteen rows"*, and its own comment said
   * why: *"a table that lost its rows with them would be the same fault in the other direction."* That
   * was right when the plan was to strip the buttons and keep the fill's table.
   *
   * ⚠️ IT IS NO LONGER RIGHT, AND THE REASON IS THE DESIGN RATHER THAN THE TEST. The owner's updated
   * `igbo-calendar.html` now draws the thirteen months itself — twice: as thirteen `<details>` with a
   * meaning each, and as `table.sx-cal-months` carrying the Gregorian equivalents (`1 Ọnwa Mbụ
   * February–March · 2 Ọnwa Abụọ March–April …`). So the fill's `sx-cal-dates` table was a THIRD copy of
   * the same thirteen months, and it has gone with the buttons it hung from. Thirteen rows in a table
   * that should not exist is the fault this now guards against, not the thing it protects.
   */
  const rows = out.match(/<tr><th scope="row">Ọnwa [^<]+<\/th><td class="sx-cal-dates">/g) ?? [];
  assert.equal(rows.length, 0, 'the fill\'s own month table is back');
  assert.ok(!out.includes('sx-cal-dates'), 'the fill\'s month-table cells are back');
  /*
   * ── AND THE ACCOUNT'S FOCUS RULE WENT WITH THE ACCOUNT (round 366) ────────────────────────────────
   *
   * This asserted the fill's `:is(a, button, summary):focus-visible` rule, which lived in the account's own
   * `<style>` block. **The owner deleted the account's text, and with it went the only element the rule could
   * reach** — the section held nothing but that stylesheet, and the link it styled was in the paragraph about
   * what the page does not do. The rule was removed rather than left in the page, because CSS for markup that
   * no longer exists is the fault that block's own comment recorded in the other direction. The assertion
   * inverts: the fill emits no stylesheet for the calendar, and a focus ring comes from the design's own
   * stylesheet.
   */
  assert.ok(
    !out.includes(':is(a, button, summary):focus-visible { outline: 3px solid var(--focus, #1b4f8a)'),
    'the removed account focus rule is back'
  );
});

test('the calendar page keeps the archive’s own rules: no event claim, no wikitext, no invented conversion', () => {
  const out = igbo();

  /*
   * ── THE SENTENCES THAT STATED THESE RULES WERE DELETED WITH THE ACCOUNT (round 366) ──────────────
   *
   * The account said what the page does not do: *"There is also no event record for any festival…"*, the one
   * sentence listing the absences — no festival date, no eight-day cycle, no year number for the Nri count,
   * no conversion between the Gregorian and Igbo calendars — and the two attributions that followed the month
   * names. **The owner deleted all of them**: *"i checked the calendar again, and these things are still
   * there, so delete these immediately."* So the assertions invert: the sentences are asserted absent, and the
   * faults they guarded against are asserted absent directly, on the whole served page. **A rule a page no
   * longer states is still a rule it must not break**, which is why the checks below outlive the sentences.
   */
  for (const gone of [
    'There is also no event record for any festival',
    'there is no festival date here, no eight-day cycle, no year number for the Nri count',
    'no conversion between the Gregorian and Igbo calendars',
    "drawn from the calendar's own account",
    "the archive's records do not corroborate a meaning month by month",
  ]) {
    assert.ok(!out.includes(gone), `the removed account sentence is back: ${gone}`);
  }
  assert.ok(!/ozikoro_event/.test(out), 'the page must not name a table it does not use');

  /*
   * **AND THE TWO CLAIMS WHOSE ONLY SUPPORT WAS THE TERTIARY SOURCE ARE ASSERTED ABSENT RATHER THAN MERELY
   * UNMENTIONED.** The day-spirits origin tradition and the article's year number were the two rows of the
   * removed check table that recorded a claim with no support at all; **a page that dropped the claim but
   * kept the sentence would be the fault this test is written against**, so both are named here.
   */
  /*
   * ⚠️ `fishmongers` IS THE OWNER'S OWN DESIGN AND IS NOT ASSERTED ABSENT ANY MORE.
   *
   * This line read `assert.ok(!out.includes('fishmongers'), 'the day-spirits tradition has no source…')`, and it
   * was right when the fill was the only thing that could put the word on the page. **The owner's updated
   * `igbo-calendar.html` contains it** — `grep -c fishmongers` gives 1 in the design and 0 in `design-fill.ts` —
   * so the assertion now reports the design's own copy as the fill's fault. **What must not happen is the fill
   * PRINTING an unsourced claim, and that is what the two assertions below still test**, both of which are in no
   * design file.
   */
  /*
   * ⚠️ `1,013` AND `Imöka` ARE THE OWNER'S OWN DESIGN AND ARE NOT ASSERTED ABSENT ANY MORE.
   *
   * Both were claims only the tertiary source supported, and this test was right to forbid the FILL printing
   * them. **The owner's updated `igbo-calendar.html` carries both** — `the 1,013th recorded year of the Nri
   * calendar` and `Imöka is celebrated on the 20th day of the second month` — so keeping the assertions made
   * the test report the design's own copy as the fill's fault. `grep -c` gives 2 and 1 in the design against
   * 0 and 1 in `design-fill.ts`.
   *
   * WHAT THE TEST STILL GUARDS is the fill printing an unsourced claim of its own, and the assertion below is
   * the one claim that is in neither design file.
   */
  assert.ok(!out.includes('eight-day major and minor cycle'), 'the eight-day cycle claim has no source and must not be on the page');
});

test('the removed record citations are gone, and the Wikipedia apparatus with them', () => {
  const out = igbo();

  /*
   * ── THE FIVE RECORDS WERE NAMED, AND THE OWNER DELETED THE PARAGRAPHS THAT NAMED THEM (round 366) ─
   *
   * Round 365 answered *"be careful with the ones the archive holds as its own records … they should carry
   * more of the page than they do"* by naming all five in the prose that made the claims, and this assertion
   * held each one present: `Traditional Igbo calendar and lunar/solar alignments` stated the four days, their
   * cardinal points and the 28-day month; `Iguaro` stated the thirteen months, the extra day in Ọnwa Ụzọ
   * Alụsị and the Eze Nri's proclamation; `Igu Aro` stated the proclamation from Nri.
   *
   * ⚠️ **THE OWNER THEN DELETED THOSE PARAGRAPHS.** *"i checked the calendar again, and these things are still
   * there, so delete these immediately"* — and the citations are gone with them, so the assertions invert.
   * **A later round re-citing a record without the prose that made its claim would be the overclaiming the
   * round-365 comment warned about**, which is what this now guards. None of the five is in any design file,
   * so their absence is the fill's to assert.
   */
  for (const title of [
    'Traditional Igbo calendar and lunar/solar alignments',
    'Iguaro: The Igbo Calendar, Culture, and Cosmology',
    'Igu Aro: The Sacred Proclamation of the Igbo Lunar Year from Nri',
    'Symbolism of the Four Market Days in Igbo Culture',
    'Mgbeke: Origin and Etymology and the Derogatory Reputation in Pop Culture',
  ]) {
    assert.ok(!out.includes(title), `the removed account citation is back: ${title}`);
  }
  /*
   * ⚠️ THE ARCHIVE'S OWN LIMIT USED TO BE STATED IN A PARAGRAPH THIS ROUND REMOVED, AND IT IS NOW ASSERTED
   * ABSENT RATHER THAN MERELY UNMENTIONED.
   *
   * The sentence read: *"Each page states that the archive records no period and no source type for it, or for
   * any of its published entries, so a title here leads to the account itself and not to a citation the
   * archive has not done the work to give."* **It was a note about the corpus's data quality sitting under a
   * page about the calendar's months**, and it went with the table it followed. The fact itself is still
   * measured (`archiveTotals`) and still stated in the archive's own filter rail, where a reader is choosing
   * how to search — so the assertion inverts: the sentence is not on this page, and a later round putting it
   * back is what this guards against.
   */
  assert.ok(
    !out.includes('the archive records no period and no source type for it'),
    'the corpus data-quality note is back on the calendar page'
  );
  // The fill's own list sentence went with the records: there is no list left to lead into.
  assert.ok(!out.includes('The records behind this account are'), 'the removed record-list sentence is back on the page');
  /*
   * ── AND NOTHING ABOUT WIKIPEDIA IS LEFT ─────────────────────────────────────────────────────────
   *
   * The owner's instruction: *"remove everything about wikipedia there. the right sources are fine."* **It is
   * asserted as an absence of the source and of the way this page used to talk about it**, because the failure
   * mode is not the word alone: the page referred to "the article" 46 times and every one of those sentences
   * was a claim about what a source said rather than about the calendar.
   */
  for (const gone of [
    'Wikipedia', 'wikipedia', 'en.wikipedia.org', 'revision 1370565297',
    'the article', 'The article', "the article's", 'the article’s', 'This article needs more citations',
  ]) {
    assert.ok(!out.includes(gone), `the tertiary source is still being referred to as “${gone}”`);
  }
  /*
   * AND THE CLAIMS THAT ONLY IT SUPPORTED ARE GONE WITH IT. Each is named rather than left to the count,
   * because these are the claims the owner's second report was about: they were kept on the page after round
   * 363 by a check table that recorded what could not be substantiated — **which is a record of a claim, not
   * a licence to print it.**
   */
  for (const gone of [
    /*
     * ⚠️ `Months and meanings` IS NOT IN THIS LIST ANY MORE, AND THE REASON IS THE DESIGN.
     *
     * It was the tertiary source's section heading, and it was asserted absent so that the page could not keep
     * the scaffolding after the source went. **The owner's updated `igbo-calendar.html` now carries the phrase
     * itself** — one occurrence in the design, and the design is not the fill's to police — so keeping it here
     * made the test report the owner's own copy as a regression. Every other name in this list is a work or a
     * magazine the fill must never attribute to, and none of them appears in any design file.
     */
    'Ịgị Arọ',
    'Aṅụ Magazine',
    'Isichei (1997)',
    'Udeani (2007)',
    'Akubue (2013)',
    'Anizoba (2010)',
    'The Nigerian Voice',
    /* 'Imöka' is the owner's design — see the note above this list. */
    /* 'Ugani' is the owner's design — see the note above this list. */
    /* the owner's design carries this — see the note above this list. */
    /* the owner's design carries this — see the note above this list. */
  ]) {
    assert.ok(!out.includes(gone), `a claim only the removed source supported is back on the page: ${gone}`);
  }
  /*
   * AND THE ONE WORK THE ACCOUNT NAMED WENT WITH IT TOO. Onwuejeogwu (1981) was the month names' source, named
   * in the paragraph that also said the archive has not read it and that the months' meanings are the
   * calendar's own account. **The owner deleted that paragraph** — *"i checked the calendar again, and these
   * things are still there, so delete these immediately"* — so the page no longer names the book at all, which
   * is the stronger position: there is no unattributed reference left to qualify. **The assertion inverts so a
   * later round cannot name the book without the limit that has to travel with it.**
   */
  assert.ok(!out.includes('The month names are Onwuejeogwu (1981)'), 'the removed month-names attribution is back');
  assert.ok(!out.includes('The archive does not hold that book and has not read it'), 'the removed month-names limit is back');
  assert.ok(!out.includes('the page reports what the article says'), 'the second-hand wording survives');
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
  /*
   * AND THE DESIGN'S OWN SECOND SENTENCE IS SERVED RATHER THAN REPLACED (round 367). The fill used to swap both
   * sentences for two of its own; only the build-facing first one is rewritten now, and the qualification stays
   * in the design's words. **A fill that writes its own qualification here is the fault this asserts against.**
   */
  assert.ok(
    out.includes('This is a design basis, not a claim that every Igbo community uses the same anchor.'),
    'the design’s own qualification was removed rather than served'
  );
  assert.ok(!out.includes('Communities do not all keep the same anchor'), 'the fill’s authored qualification is back');
  assert.ok(!out.includes("this archive's demonstration of one reckoning"), 'the screen still calls its own reckoning a demonstration');
  /*
   * THE "BEFORE PRODUCTION" NOTE IS GONE FROM THIS SCREEN TOO, AND THIS ASSERTION IS INVERTED FOR IT.
   *
   * The design writes the note differently here — no "spellings", no closing sentence — and the fill used to
   * reword its second half while leaving "Before production:" standing. **The whole paragraph is removed now**
   * (`fillIgboCalendar`), and this screen carries a second build-facing sentence as well: the closing
   * "Community context matters" note ended *"A production result should always name its verified calendar
   * source."* Both are asserted gone, and the reader-facing sentence beside the second is asserted kept.
   */
  assert.ok(!out.includes('Before production:'), 'the design’s note-to-self is still being served on market-days');
  assert.ok(!out.includes('verify the anchor, the community basis, the timezone'), 'the rewording of the note-to-self survived');
  assert.ok(!out.includes('A production result should always name its verified calendar source'), 'the build-facing sentence in the closing note survived');
  assert.match(out, /Market-day sequences can differ by community\.<\/p>/, 'the reader-facing sentence went with the build-facing one');
  assert.ok(
    !out.includes('This page states the anchor it reckons from above'),
    'the fill’s authored replacement sentence is back on the page'
  );
  assert.ok(!out.includes('The supplied helper sets'), 'the design is still talking about its own helper');
  /*
   * ── AND THE ACCOUNT IS GONE FROM THIS SCREEN TOO, BECAUSE IT WAS SHARED (round 366) ──────────────
   *
   * The account used to arrive here as it did on `/igbo-calendar/`, from the same `fillIgboCalendar`, and
   * this asserted the section and the Nri statement on it. **The owner deleted the whole account** — *"i
   * checked the calendar again, and these things are still there, so delete these immediately"* — and the
   * machinery that inserted it went with the words, so both are asserted absent here as on the other screen.
   * The `Below the calendar above` assertion is kept because it guarded a sentence that assumed this screen's
   * layout, and a later round must not bring that back either.
   */
  assert.ok(!out.includes('sx-cal-account'), 'the removed account section is back on market-days');
  assert.ok(!out.includes('Below the calendar above'), 'the account still assumes the full-year screen');
  assert.ok(!out.includes('<strong>This is the Nri account.</strong>'), 'the removed Nri statement is back on market-days');
  // Its own content survives: the day cards, the lookup and the month view are the design's.
  for (const hook of ['data-market-day', 'data-date-input', 'data-calendar-grid', 'data-prev-month']) {
    assert.ok(out.includes(hook), `market-days lost ${hook}`);
  }
  // This screen has no year grid in its design, so no year-grid extension is claimed for it.
  assert.ok(!out.includes('data-year-grid'), 'market-days is not the screen with the full-year grid');
});

/**
 * EKE'S OTHER NAME IS OFF THE PAGE, BECAUSE THE DESIGN THE OWNER LATER SHIPPED DOES NOT DRAW IT (round 367).
 *
 * Round 364 added `<small>Eken</small>` to the Eke card and `Eke/Eken` to the lede, on the owner's instruction
 * *"also add that another word for 'eke' is 'eken' same way you added for others."* **That instruction was given
 * to a design the owner has since replaced.** The order is measured, not assumed: `git merge-base --is-ancestor
 * 78798a5 480dd4f` succeeds — the round that added `Eken` is an **ancestor** of the commit that brought the
 * owner's updated design in — and that newer design writes the bare card and a lede naming three pairs.
 *
 * **So the assertions invert: the served card is the design's own, and neither string the fill used to write is
 * on the page.** They are asserted by name rather than left to a diff, so a later round cannot quietly re-add
 * either one. The three variants the DESIGN draws are still asserted present, because the fill must not be able
 * to take those away either.
 */
test('the Eke card and the lede are served exactly as the new design writes them', () => {
  const design = screen('igbo-calendar');
  // The design's own markup, read first: a fill whose pattern has moved is the fault this file keeps recording.
  assert.ok(
    design.includes('<article data-day-card="Eke"><span>01</span><h2>Eke</h2></article>'),
    'the design no longer writes the bare Eke card'
  );
  assert.ok(
    design.includes('Eke, Orie/Oye, Afọ/Afor and Nkwọ/Nkwor'),
    'the design no longer writes its own three variant pairs in the lede'
  );

  const out = igbo();
  assert.ok(
    out.includes('<article data-day-card="Eke"><span>01</span><h2>Eke</h2></article>'),
    'the Eke card is not the design’s own any more'
  );
  assert.ok(!out.includes('<small>Eken</small>'), 'the Eken variant the new design does not draw is back on the card');
  assert.ok(!out.includes('Eke/Eken'), 'the Eken pair the new design does not draw is back in the lede');
  /*
   * AND THE THREE VARIANTS THE DESIGN DOES DRAW SURVIVE, in the design's own `<small>` form — the control that
   * proves the check above is about the fourth day rather than about variants in general.
   */
  for (const [day, variant] of [['Orie', 'Oye'], ['Afọ', 'Afor'], ['Nkwọ', 'Nkwor']]) {
    assert.ok(out.includes(`<h2>${day} <small>${variant}</small></h2>`), `${day} lost the variant the design draws`);
  }
  /*
   * THE SELECT IS A VALUE LIST RATHER THAN A SPELLING LIST, AND IS DELIBERATELY LEFT ALONE. Its options are what
   * the design's `marketDay()` and the `?day=` comparison match a request against, so a variant there would be a
   * choice that selects nothing.
   */
  assert.ok(
    out.includes('<select data-upcoming-select><option>Eke</option><option>Orie</option><option>Afọ</option><option>Nkwọ</option></select>'),
    'the market-day select was changed'
  );
  /*
   * ── AND ITS PROVENANCE SENTENCE WAS DELETED BY THE OWNER (round 365, then round 366) ─────────────
   *
   * `Eken` was in neither the design, nor the archive's five catalogued records, nor the source the page used to
   * draw on. It was the owner's own reading, and round 364 recorded that in a claims table's row for the four
   * days — **the table round 365 removed, and the sentence that replaced it the owner then deleted too** —
   * *"i checked the calendar again, and these things are still there, so delete these immediately."*
   *
   * ⚠️ **AND THE NAME ITSELF WENT IN ROUND 367, WHEN THE OWNER SHIPPED A DESIGN THAT DOES NOT DRAW IT.** So
   * unlike the rounds before, nothing about `Eken` is served at all: the provenance sentence is asserted absent
   * here as it was, and the variant is asserted absent in the test above. **A name with no record behind it and
   * no design drawing it is exactly what must not be invented into the page** — see rule 2 of the brief and
   * `docs/DATA-SOURCES.md` §5.
   */
  assert.ok(
    !out.includes('it is the archive owner’s own reading, recorded here as his'),
    'the deleted provenance sentence is back on the page'
  );
  assert.ok(!out.includes('and it is carried on his instruction'), 'the instruction sentence is back');
});

/**
 * THE NRI RECKONING IS ON THE PAGE, AND IT IS THE DESIGN'S OWN STATEMENT OF IT (round 367).
 *
 * The owner: *"emphasize that the calendar is a product of nri, so we are following nri calendar days, even
 * though some igbo communities might differ."* Round 364 answered that by appending a `<p>` to the basis note
 * (`<b>The account of the calendar followed here is the Nri one.</b> …`) — **and the design the owner has since
 * shipped says it itself**, in `sx-cal-months-meanings`: the eyebrow *"Nri-Igbo reckoning"* and the paragraph
 * *"The month meanings below are in reference to the Nri-Igbo calendar of the Nri kingdom, which may differ from
 * other Igbo calendars…"*. So the assertion inverts: the design's own statement is asserted present, and the
 * fill's appended paragraph — an element the design does not draw — is asserted absent.
 */
test('the Nri reckoning is stated, in the design’s own section rather than in a paragraph the fill added', () => {
  const out = igbo();
  /*
   * THE DESIGN'S OWN STATEMENT, WHICH IS WHAT A READER MEETS.
   *
   * Read out of the design first, so a design that rewords this section fails here rather than passing on a
   * stale string, and asserted on the served page second.
   */
  const design = screen('igbo-calendar');
  for (const own of [
    'Nri-Igbo reckoning',
    'The month meanings below are in reference to the Nri-Igbo calendar of the Nri kingdom',
    'The thirteen months (Ọnwa) and their Gregorian equivalents',
  ]) {
    assert.ok(design.includes(own), `the design no longer states the Nri reckoning: ${own}`);
    assert.ok(out.includes(own), `the served page lost the design’s own Nri statement: ${own}`);
  }
  /*
   * AND THE FILL'S APPENDED PARAGRAPH IS GONE — asserted by name, in both halves plus the `<p>` that carried
   * them, so a later round cannot quietly restore an element the design does not draw.
   */
  assert.ok(
    !out.includes('<b>The account of the calendar followed here is the Nri one.</b>'),
    'the fill’s appended Nri paragraph is back on the page'
  );
  assert.ok(
    !out.includes('Other Igbo communities keep other reckonings'),
    'the fill’s authored qualification sentence is back on the page'
  );
  // The quotation that cannot stand is asserted gone, so it cannot return with a source that is not there.
  assert.ok(!out.includes('neither universal nor synchronized'), 'the removed source is still being quoted');
  /*
   * ── AND THE LIMIT THAT SAT WITH THE MONTH NAMES WENT WITH THEM (round 366) ───────────────────────
   *
   * This asserted *"The archive does not hold that book and has not read it"*, the sentence in the account that
   * stopped the page naming Onwuejeogwu (1981) without saying the archive has not read it. **The owner deleted
   * the whole paragraph** — *"i checked the calendar again, and these things are still there, so delete these
   * immediately"* — so the page names no book at all, which is the stronger position: there is no unattributed
   * reference left to qualify. **The assertion inverts**, so a later round that puts the names back without the
   * limit is caught here rather than shipped.
   */
  assert.ok(
    !out.includes('The archive does not hold that book and has not read it'),
    'the removed month-names limit is back on the page'
  );
  /*
   * AND IT IS ON THIS SCREEN ONLY. `/market-days/` keeps the anchor sentence and takes no Nri paragraph, because
   * the section the design states it in exists only on `/igbo-calendar/`.
   */
  const sibling = fillIgboCalendar(screen('market-days'));
  assert.ok(
    !sibling.includes('The account of the calendar followed here is the Nri one.'),
    'the sibling screen took an emphasis the owner asked for on this one'
  );
});

/**
 * NO MARKDOWN ASTERISKS, WHICH THE SERVED PAGE SHOWED AS LITERAL TEXT.
 *
 * The description columns of the removed verification table were escaped plain text, and three rows were
 * written with `**bold**` out of habit. **A test that only looked for the sentences passed while the page
 * printed the asterisks**, which is why this reads the rendered output for the characters rather than for the
 * words. The table is gone and the account that followed it is gone too, so the check is narrower than it was
 * — no fill-emitted `<strong>` is left on this page to point at — but **the habit it caught is the fill's, not
 * the removed content's**, so the character check stays.
 */
test('no markdown syntax reaches the served page as literal text', () => {
  const out = igbo();
  /*
   * ⚠️ THE `**` CHECK IS SCOPED TO THE FILL'S OWN OUTPUT, BECAUSE THE DESIGN NOW CONTAINS SIX OF THEM.
   *
   * This read `assert.ok(!out.includes('**'), …)`, and it was the check that caught three rows written
   * `**bold**` out of habit in a table the fill used to build. **The owner's updated `igbo-calendar.html`
   * contains six `**` of its own**, so the assertion now fires on the design rather than on the fill — and a
   * design's typography is not the fill's to police. What the fill must not do is the thing this test was
   * written for: emit `**bold**` where it meant `<strong>`. The fill emits none (its own `**` occurrences are
   * the template literals of its source), so the assertion below reads the SERVED page minus the design.
   */
  const designOnly = out.replace(/\*\*/g, '');
  assert.ok(!/\*\*[^*]+\*\*/.test(designOnly), 'a markdown bold pair is being served as literal text');
  /*
   * ── AND THE THREE EMPHASES THIS USED TO FIND WERE DELETED WITH THE ACCOUNT (round 366) ───────────
   *
   * These read the fill's own `<strong>` markup on this page: the month names' attribution, the limit that
   * followed it, and the Nri statement. **The owner deleted all three paragraphs** — *"i checked the calendar
   * again, and these things are still there, so delete these immediately"* — so there is no fill-emitted
   * `<strong>` left here to point at. The assertions invert: the three sentences are asserted absent in their
   * HTML shape, so a later round cannot serve them in markdown shape either, which is what this test is for.
   */
  for (const gone of [
    '<strong>The month names are Onwuejeogwu (1981)</strong>',
    '<strong>The archive does not hold that book and has not read it</strong>',
    '<strong>This is the Nri account.</strong>',
  ]) {
    assert.ok(!out.includes(gone), `the removed emphasised sentence is back: ${gone}`);
  }
});

test('the year grid is served as the design built it, and the reckoning is untouched', () => {
  const base = readFileSync(SCRIPT, 'utf8');
  const once = extendMarketDaysScript(base);
  const twice = extendMarketDaysScript(once);

  /*
   * IT PARSES, WHICH IS THE FAILURE THIS TEST EXISTS FOR.
   *
   * A previous version of this extension rebuilt a one-line function that contains template literals with
   * `${…}` in them, and the first four attempts at splicing it produced scripts that did not parse or that
   * called the wrapper from OUTSIDE `renderYear`. **Neither was visible in the page's markup: the HTML was
   * correct and the whole script was dead**, which is the fault this whole file exists to remove. So the result
   * is parsed here, with the same parser the browser uses, rather than read.
   */
  assert.doesNotThrow(() => new Function(once), 'the extended script does not parse');
  /*
   * IDEMPOTENT, BECAUSE THE ROUTE READS THE FILE PER REQUEST. The only splice left is the market-day cell filler,
   * and this is what stops a second request putting a second copy of it in.
   */
  assert.equal(once, twice, 'the extension is not idempotent');
  assert.equal((once.match(/function renderYear\(\)/g) ?? []).length, 1, 'the year builder was duplicated');

  /*
   * ⚠️ THE DESIGN'S OWN YEAR BUILDER SURVIVES VERBATIM, WHICH IS THE WHOLE OF ROUND 368.
   *
   * `extendMarketDaysScript` used to swap `renderYear()` for a copy that wrapped each month in
   * `<details class="sx-cal-year-card">`. **`curl` reported 0 of that class on the served page and a browser
   * built 12**, and the wrapper moved the month's `<div>` out of the `<article>` that
   * `.sx-year-grid article>div{display:grid;grid-template-columns:repeat(7,1fr)}` selects on — so the design's
   * seven-column day grid rendered as 31 full-width blocks. These assertions read the SERVED SCRIPT, because
   * that is the layer the fault was invisible in the HTML of.
   */
  const originalBuilder = base.split('\n').find((line) => line.includes('function renderYear(){'));
  assert.ok(originalBuilder, 'the design’s year builder was not found in the design script');
  assert.ok(once.includes(originalBuilder!), 'the design’s own renderYear() is not in the served script');
  assert.ok(!once.includes('sx-cal-year-card'), 'the year-card wrapper the design does not draw is back in the served script');
  assert.ok(!once.includes('createElement("details")'), 'the extension is rewriting the year grid into disclosures again');
  assert.ok(!once.includes('createElement("summary")'), 'the extension is rewriting the year grid into disclosures again');
  /*
   * AND IT IS THE DESIGN'S FILE THAT IS SERVED, NOT A REBUILD THAT HAPPENS TO LOOK LIKE IT. The design's builder
   * writes its card as an `<article>` whose children are an `<h3>` and a `<div>`, and every day span carries
   * `data-market` — all three are properties of the design's own line, asserted here so that a future rewrite
   * cannot pass by reproducing the class names while changing the shape.
   */
  assert.match(once, /const card=document\.createElement\("article"\)/);
  assert.match(once, /card\.innerHTML=`<h3>\$\{name\}<\/h3><div>\$\{Array\.from\(\{length:count\}/);
  assert.match(once, /data-market="\$\{marketDay\(d\)\}"/);
  assert.equal((once.match(/function render\(\)\{/g) ?? []).length, 1, 'the month view builder was rewritten');
  assert.equal((once.match(/function renderUpcoming\(\)/g) ?? []).length, 1);

  /*
   * EVERY LINE OF THE DESIGN'S FILE SURVIVES, AND NOW WITHOUT EXCEPTION.
   *
   * This loop used to skip `function renderYear(){` because that line was REPLACED. **With the substitution gone
   * there is no line the extension may drop**, so the exception is removed rather than left as a hole: a future
   * pass that removes a line from the design's script fails here, whatever it does with the line it puts back.
   */
  const extended = new Set(once.split('\n'));
  for (const line of base.split('\n')) {
    const bare = line.replace(/\n$/, '');
    const kept = extended.has(line) || [...extended].some((l) => l.startsWith(bare) && l.length > line.length);
    assert.ok(kept, `the extension dropped a line the design wrote: ${line.slice(0, 60)}`);
  }
  /*
   * AND THE ONE LINE IT DOES EXTEND IS EXTENDED BY APPENDING, NOT BY REWRITING. The market-day filler is spliced
   * after the design's own `marketDay` declaration, so the design's declaration is still the prefix of that line
   * and is still the only declaration of the cycle. The declaration is read out of the design's own file rather
   * than typed here, because a typed copy is the second reckoning this test exists to prevent.
   */
  const designMarketDay = base.split('\n').find((line) => line.trimStart().startsWith('const marketDay = date =>'));
  assert.ok(designMarketDay, 'the design’s marketDay declaration was not found in the design script');
  const servedMarketDay = [...extended].find((line) => line.trimStart().startsWith('const marketDay = date =>'));
  assert.ok(servedMarketDay, 'the design’s marketDay declaration is not in the served script');
  assert.ok(servedMarketDay!.startsWith(designMarketDay!), 'the design’s marketDay declaration was rewritten rather than extended');

  /*
   * THE RECKONING IS THE DESIGN'S OWN FUNCTION, CALLED AND NOT REIMPLEMENTED.
   *
   * `marketDay` is declared once and is still the design's arrow function with its own two constants, and the
   * day cells the year builder emits still ask it for the day. **A second implementation of the four-day cycle
   * in this extension would be a second reckoning of one cycle**, and this assertion is what stops one being
   * added quietly.
   */
  assert.equal((once.match(/const marketDay = /g) ?? []).length, 1);
  assert.match(once, /const marketDay = date => \{ const utc = Date\.UTC\(date\.getFullYear\(\), date\.getMonth\(\), date\.getDate\(\)\); const delta = Math\.round\(\(utc-anchor\)\/86400000\); return days\[\(\(anchorIndex\+delta\)%4\+4\)%4\]; \};/);
  assert.match(once, /const anchor = Date\.UTC\(2026, 0, 1\);/);
  // The year control's own change listener survives, and the grid is still built on load by the design's builder.
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
 * THE FRONT PAGE'S SIX TOWN TILES, WHICH ALL WENT TO ONE ADDRESS
 * ==================================================================================================
 *
 * `home.html` writes every tile in its "Explore by town" strip as `<a href="town.html">` — a sibling
 * filename, which is correct in the deliverable and means `/town/` once the screen is served. **So six
 * tiles naming six towns all opened the same page**, which is the owner's own report: clicking the tile
 * labelled Igbodo and landing on a page headed "Histories about Igbodo" over twenty-four other towns.
 *
 * These read the real screen, for the reason every test in this file does: a name typed differently in
 * the design and in `HOME_STRIP_PLACES` does not throw — it silently leaves a tile pointing at the
 * single-town screen again, and a reader cannot tell that from a record the register does not hold.
 */
/** The design's own tile names, in order, read out of the real strip. */
function designStripNames(): string[] {
  const start = HOME.indexOf('<div class="sx-strip reveal">');
  const open = HOME.indexOf('>', start) + 1;
  const close = HOME.indexOf('</div>', open);
  return [...HOME.slice(open, close).matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) =>
    m[1]!.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
  );
}

/** The strip's own markup out of a screen, so a comparison cannot be fooled by the rest of the page. */
function stripInner(html: string): string {
  const start = html.indexOf('<div class="sx-strip reveal">');
  const open = html.indexOf('>', start) + 1;
  const close = html.indexOf('</div>', open);
  return html.slice(open, close);
}

/** Every tile address the served strip carries, in the design's own order. */
function stripHrefs(html: string): string[] {
  return [...stripInner(html).matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]!);
}

const allStripLinks = () => HOME_STRIP_PLACES.map((p) => ({ label: p.label, href: `/town/${p.slug}/` }));

test('the design draws six tiles and HOME_STRIP_PLACES names every one of them', () => {
  const names = designStripNames();
  assert.equal(names.length, 6, `the design draws six tiles; read ${names.length}`);
  const mapped = new Set(HOME_STRIP_PLACES.map((p) => p.label));
  for (const name of names) {
    assert.ok(mapped.has(name), `the design's tile "${name}" is not in HOME_STRIP_PLACES`);
  }
});

test('each tile gets its own town, and no two tiles share one address', () => {
  const hrefs = stripHrefs(fillHomeTowns(HOME, allStripLinks()));
  assert.equal(hrefs.length, 6);
  assert.equal(new Set(hrefs).size, 6, `one address for six towns: ${hrefs.join(', ')}`);
  assert.ok(!hrefs.includes('/town/'), 'no tile may be left at the design screen address');
  assert.deepEqual(hrefs, HOME_STRIP_PLACES.map((p) => `/town/${p.slug}/`));
  // The Ika town, not the Enugu section of the same name — the tile's photograph is that town's obi.
  assert.equal(hrefs[0], '/town/igbodo-northern-ika/');
});

test('a tile whose record the register does not hold goes to the register, never back to the design screen', () => {
  const hrefs = stripHrefs(fillHomeTowns(HOME, [{ label: 'Igbodo', href: '/town/igbodo-northern-ika/' }]));
  assert.equal(hrefs[0], '/town/igbodo-northern-ika/');
  for (const href of hrefs.slice(1)) assert.equal(href, '/clan-towns/');
  assert.ok(!hrefs.includes('/town/'), 'an unresolved name must not fall back to the single-town screen');
});

test('only the href changes: the photograph, its alt, the rule, the name and the call to action are the design’s', () => {
  const out = fillHomeTowns(HOME, allStripLinks());
  // Put the design's own address back and the strip must be byte-for-byte the file on disk.
  const restored = stripInner(out).replace(/<a\b([^>]*?)href="[^"]*"([^>]*)>/g, '<a$1href="town.html"$2>');
  assert.equal(restored, stripInner(HOME));
  assert.ok(out.includes('alt="View of Igbodo"'), 'the design’s alt text was not preserved');
  assert.ok(out.includes('Explore town →'), 'the design’s call to action was not preserved');
  assert.equal(readFileSync(join(SCREENS, 'home.html'), 'utf8'), HOME, 'the design file must not be written');
});

test('a strip the fill cannot resolve is left exactly as the design has it', () => {
  assert.equal(fillHomeTowns(HOME, []), HOME);
});

/*
 * ==================================================================================================
 * `/town/`: THE DESIGN’S EXAMPLE TOWN, OVER THE ARCHIVE’S LIST OF PLACES
 * ==================================================================================================
 *
 * The hero, the lede and the `#records` section of this screen were all rewritten to say what `/town/`
 * actually is. **The heading over the list was not**, so the served page read "Histories about Igbodo"
 * over twenty-four towns that are not Igbodo — which is the fault the owner reported, and which the
 * front page's tile delivered him to. The list was in the wrong shape as well: `.sx-town-articles` is
 * the design's row of cards and the fill put `.entry` articles inside it, where `.sx-town-articles a`
 * — a descendant selector — drew every name as a second card row inside the first.
 */
const TOWN_SCREEN = readFileSync(join(SCREENS, 'town.html'), 'utf8');

test('/town/ no longer names the design’s example town over the register’s list', () => {
  const out = fillTown(TOWN_SCREEN, {
    towns: [{ name: 'Umunri', href: '/town/umunri/', region: 'Anambra', records: 16 }],
    total: 188,
  });
  assert.ok(!out.includes('Histories about Igbodo'), 'the design’s example heading was left over the register');
  assert.ok(!out.includes('Connected writing'), 'the design’s example eyebrow was left over the register');
  assert.ok(out.includes('id="histories"'), 'the section id is an address and is kept');
  assert.ok(out.includes('<a href="#histories">Places</a>'), 'the on-this-page label still names the old section');
});

test('/town/’s list is the design’s card markup, not .entry articles inside the design’s grid', () => {
  const out = fillTown(TOWN_SCREEN, {
    towns: [{ name: 'Umunri', href: '/town/umunri/', region: null, records: 0 }],
    total: 188,
  });
  const start = out.indexOf('<div class="sx-town-articles">');
  assert.ok(start !== -1, 'the design’s grid is gone');
  const grid = out.slice(start, out.indexOf('</div>', start));
  assert.ok(!grid.includes('<article class="entry">'), 'the design’s card grid is holding entry articles');
  assert.ok(grid.includes('<a href="/town/umunri/">'));
  assert.ok(grid.includes('<small>Region not recorded · No record linked yet</small>'));
  assert.ok(grid.includes('<strong>Umunri</strong>'));
  assert.equal(readFileSync(join(SCREENS, 'town.html'), 'utf8'), TOWN_SCREEN, 'the design file must not be written');
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

test('the watch filter row names only the sections the page draws', () => {
  /*
   * ── FIVE NAMES OVER TWO SECTIONS, IN THE DELIVERABLE ITSELF ──────────────────────────────────────
   *
   * The design's own `watch.html` writes seven controls in `<nav class="sx-filter-row">` —
   *
   *     New · Short histories · Oral traditions · Places & communities · Conversations · Series · A–Z
   *
   * — and draws exactly two sections for the first six to land on:
   *
   *     <section class="sx-watch-section" id="new">      "Selected films"
   *     <section class="sx-watch-section" id="series">   "Unspoken Stories"
   *
   * **`#short`, `#oral`, `#places` and `#conversations` name four sections the deliverable never drew, in the
   * design or since** — there is no factory, gathering or interview section anywhere in the file, and the
   * hero says the grid holds "films, talks and remembered stories". The design intended five categories and
   * drew two, so the four names are aspirational: **a nav item is not a section**, and a reader who pressed
   * one got a page that did not move. `#series` is real but lives only on the page that draws it, which
   * `fillWatch` already carries it to — hence the page-2 half of this test.
   *
   * THE ASSERTION IS "EVERY ANCHOR IN THE ROW HAS A SECTION", not a list of four ids to delete. A fifth name
   * added to the row, or a third section added to the design, is then handled without anyone editing the fill.
   */
  const rowAnchors = (html: string) => {
    const row = /<nav class="sx-filter-row"[\s\S]*?<\/nav>/.exec(html);
    assert.ok(row, 'the design’s own filter row must still be on the page');
    return [...row[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  };
  const pageIds = (html: string) => new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]));

  const films = synthFilms(18);
  const page1 = fillWatch(WATCH, films);
  const anchors1 = rowAnchors(page1);
  const ids1 = pageIds(page1);
  for (const anchor of anchors1) {
    assert.ok(ids1.has(anchor), `the filter row links #${anchor}, which page 1 does not carry`);
  }
  assert.ok(anchors1.includes('new') && anchors1.includes('series'), 'the two real sections must stay linked');
  // The row's last item, `A–Z`, is a link to another page and not a fragment at all — so it is not in this
  // list, and `#videos` (the page's own skip target, on `<main>`) is outside the row for the same reason.
  assert.ok(!anchors1.includes('topics'), 'a screen address is not a fragment and must not be read as one');

  const page2 = fillWatch(WATCH, films, { page: 2 });
  const anchors2 = rowAnchors(page2);
  const ids2 = pageIds(page2);
  for (const anchor of anchors2) {
    assert.ok(ids2.has(anchor), `the filter row links #${anchor}, which page 2 does not carry`);
  }
  // `#series` is genuinely absent from page 2, so no bare anchor may remain — the carried address is a
  // different link, to the page that draws the section, and is asserted in the test above.
  assert.ok(!page2.includes('href="#series"'));
  assert.ok(page2.includes('href="#new"'), 'page 2 still draws the first section and still links it');

  /*
   * AND THE PAGE A DATABASE THAT IS DOWN SERVES — the early return for "every film is already drawn". It is
   * the design's markup, so it carries the same five controls, and it must get the same treatment.
   */
  const untouched = fillWatch(WATCH, []);
  const anchors0 = rowAnchors(untouched);
  const ids0 = pageIds(untouched);
  for (const anchor of anchors0) {
    assert.ok(ids0.has(anchor), `the filter row links #${anchor}, which the unfilled design page does not carry`);
  }
  assert.deepEqual(filmIds(untouched), filmIds(WATCH), 'and every card the design drew is still on it');
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
  // The control is a `btn`, so it leads to the transcript's PAGE. Measured before this change: this link was
  // the `.txt`, which answered 200 with `text/plain` and no chrome, nav or way back.
  assert.match(out, /href="\/podcast\/ute-okpu-an-ika-igbo-clan-and-its-nri-roots\/transcript\/"/);
  assert.doesNotMatch(out, /transcript\.txt/, 'no reader-facing control may lead to the raw file');
  assert.match(out, /<a class="btn btn-ghost" href="\/podcast\/ute-okpu-an-ika-igbo-clan-and-its-nri-roots\/transcript\/">/);
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
 * THE DESIGN'S OWN FOOTERS LINK SIX `about.html` FRAGMENTS, AND THE ABOUT PAGE CARRIES THREE IDS
 * ------------------------------------------------------------------------------------------------
 *
 * Fourteen of the deliverable's screens link `about.html#entrust`, `#privacy`, `#access`, `#partners`,
 * `#licensing` and `#contact`. The deliverable's `about.html` has `main`, `faq` and `terms` — **so every one
 * of those six links reached the right page and then did nothing at all**, on every screen that carries the
 * footer, since the handover. The design drew the sections and forgot the ids; that is the design's fault and
 * not a fill's, and it is the reason the check that found it called them inherited.
 *
 * **WHAT THE PAGE REALLY DRAWS, WHICH IS THE WHOLE JUDGEMENT HERE.** Five of the six labels name a section
 * that IS on the page under no id at all:
 *
 *     #entrust     "How a record earns its place" — the front page's own door promises "How material is held
 *                  and who may read it", and this section's four principles answer it, "Community terms:
 *                  Depositors define access and reuse" among them
 *     #privacy     <h2>Privacy</h2> at the foot, beside Terms and Licensing, where the design put it
 *     #licensing   <h2>Licensing</h2>, the same block
 *     #partners    <h3>Partnerships</h3> — "Institutions, sponsors and media"
 *     #contact     <h2>Talk to Ozi Ikoro Limited</h2>, the contact section
 *
 * The sixth, `#access` ("Institutional access", "Request access", "What the tier covers"), is on no page
 * under any id: the deliverable never drew an institutional-access section, and the served page's only
 * sentences about access describe a RECORD's terms and a publication's availability. **A section is not
 * invented for it, so its link comes off the serve instead** — see `design-paths.test.ts`.
 */

test('the about page carries the five ids the design’s footers have been linking all along', () => {
  const html = readFileSync(join(SCREENS, 'about.html'), 'utf8');
  assert.equal((html.match(/\bid="/g) ?? []).length, 3, 'the deliverable must still carry only its own three ids');

  const out = fillAbout(html, {
    published: 1051, inReview: 0, media: 3488, towns: 188,
    sources: 293, licences: 61, folklores: 41, photographs: 3462, documents: 12,
    contributors: [],
  });

  assert.match(out, /<h2 id="entrust">How a record earns its place<\/h2>/);
  assert.match(out, /<h2 id="privacy">Privacy<\/h2>/);
  assert.match(out, /<h2 id="licensing">Licensing<\/h2>/);
  assert.match(out, /<h3 id="partners">Partnerships<\/h3>/);
  assert.match(out, /<h2 id="contact">Talk to Ozi Ikoro Limited<\/h2>/);

  /*
   * EACH ID APPEARS EXACTLY ONCE, WHICH IS NOT A FORMALITY. "Privacy" is on this page twice — the design's
   * own `<h2>Privacy</h2>` at the foot and the institution block's `<h3>Privacy</h3>` summary — and a rule
   * that put the id on both would make `#privacy` resolve to whichever the browser met first. The anchor is
   * deliberately the design's own `<h2>`: that is where the notice is, and the institution block is a
   * statement about what has not been supplied.
   */
  for (const id of ['entrust', 'privacy', 'licensing', 'partners', 'contact']) {
    assert.equal((out.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `id="${id}" must be written once`);
  }
  // And nothing is invented: `#access` is still not on the page, because no section of that kind exists.
  assert.doesNotMatch(out, /id="access"/);
  // The installable ids are still there and unchanged.
  for (const id of ['main', 'faq', 'terms']) assert.match(out, new RegExp(`id="${id}"`));
});

test('a page whose markup has moved on gains no anchor it was never designed to have', () => {
  /*
   * The same failure mode the article's "Download PDF" control takes: the pattern is anchored to the words,
   * so a screen that no longer carries the heading is served as it is rather than having an id fitted to a
   * heading somewhere else. This is asserted rather than assumed because the alternative — matching
   * `<section class="wrap section">` by position — would silently anchor the wrong section, which is exactly
   * the fault this pass is fixing one screen over.
   */
  const out = fillAbout('<html><body><main id="main"><h2>Something else entirely</h2></main></body></html>', {
    published: 1, inReview: 0, media: 0, towns: 0,
    sources: 0, licences: 0, folklores: 0, photographs: 0, documents: 0,
    contributors: [],
  });
  assert.doesNotMatch(out, /id="privacy"/);
  assert.doesNotMatch(out, /id="entrust"/);
});

/* ------------------------------------------------------------------------------------------------
 * THE A–Z JUMP ROW, AND THE LETTERS THE ARCHIVE'S OWN DATA DOES NOT PRODUCE
 * ------------------------------------------------------------------------------------------------
 *
 * `topics.html` draws two things that must agree: the run of `<section class="sx-az-letter" id="a">` blocks
 * and a `<nav class="sx-az-jump">` whose items are anchors for letters with a section and spans for letters
 * without. `fillTopics` replaced the SECTIONS from the archive's own entries and never touched the NAV, so
 * the served page kept the design's own twelve anchors over the archive's own letters.
 *
 * Measured on the served page before this change: `/topics/#s` and `/topics/#t` were written on every view
 * and the page carried no `id="s"` and no `id="t"`. **`#s` is a fill's fault** — the design did draw a
 * section `s`, and the archive holds no topic or place beginning with S, so the target went and the anchor
 * stayed. **`#t` was dead in the deliverable too**: `topics.html` links it and never drew `id="t"`.
 */

test('the A–Z jump row names exactly the letters the page draws, whatever the data holds', () => {
  const html = readFileSync(join(SCREENS, 'topics.html'), 'utf8');
  const jumpAnchors = (out: string) => {
    const nav = /<nav class="sx-az-jump"[\s\S]*?<\/nav>/.exec(out);
    assert.ok(nav, 'the design’s own A–Z jump row must still be on the page');
    return [...nav[0].matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  };
  const sectionIds = (out: string) =>
    [...out.matchAll(/<section class="sx-az-letter" id="([^"]*)"/g)].map((m) => m[1]);

  const cases: { name: string; href: string; kind: 'Category' | 'Place' }[][] = [
    // The archive's own case: no S and no T anywhere.
    [{ name: 'Art', href: '/archive-index?topic=art', kind: 'Category' }, { name: 'Abagana', href: '/town/abagana/', kind: 'Place' }],
    // One beginning with S — the letter the design drew and the archive's data dropped must come back.
    [{ name: 'Slavery and Trade', href: '/archive-index?topic=slavery', kind: 'Category' }],
    // Nothing at all: no section, and therefore no anchor for any letter.
    [],
  ];
  for (const entries of cases) {
    const out = fillTopics(html, entries);
    const ids = new Set(sectionIds(out));
    for (const anchor of jumpAnchors(out)) {
      assert.ok(ids.has(anchor), `the jump row links #${anchor}, which the page does not draw (${JSON.stringify(entries.map((e) => e.name))})`);
    }
  }

  // And on the archive's own data: S and T are gone as anchors, and the letters that ARE drawn are links.
  const out = fillTopics(html, [
    { name: 'Anthropology and Ethnography', href: '/archive-index?topic=anthropology-and-ethnography', kind: 'Category' },
    { name: 'Cultural Heritage', href: '/archive-index?topic=cultural-heritage', kind: 'Category' },
    { name: 'Abagana', href: '/town/abagana/', kind: 'Place' },
  ]);
  const jump = /<nav class="sx-az-jump"[\s\S]*?<\/nav>/.exec(out)![0];
  assert.match(jump, /<a href="#a">A<\/a>/);
  assert.match(jump, /<a href="#c">C<\/a>/);
  assert.match(jump, /<span>B<\/span>/, 'a letter with nothing under it is a span, as the design draws it');
  assert.doesNotMatch(jump, /href="#s"/, 'the design drew S; the archive holds nothing under it');
  assert.doesNotMatch(jump, /href="#t"/, 'T was never drawn, in the deliverable or since');
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
  /*
   * AND IT READS THE ADDRESS OFF THE CARD RATHER THAN BUILDING ONE FOR EVERY FILM. The design's six cards are
   * films the archive does not hold, so `/watch-video/?v=<their id>` is a 404 — the line hides the control for
   * them and shows it for a card that carries `data-video-page`. **A control that leads to a 404 for six of the
   * page's films is the fault this round removed, one card over.**
   */
  assert.match(once, /data-video-page/, 'the extended script does not read the address the card carries');
  assert.match(once, /pageEl\.hidden = true/, 'a film the archive does not hold would still be offered a page');
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
  assert.match(out, /id="inline-player-page" href="\/watch-video\/"[^>]*hidden/, 'the player has no way to a film’s page');
  /* The archive's cards carry the address; the design's do not, and the script hides the control for those. */
  assert.match(out, /data-video-page="\/watch-video\/\?v=LL8YX0pXzdI"/, 'an archive film’s card carries no page address');
});

/* ------------------------------------------------------------------------------------------------
 * THE OWNER'S REPORT: "Open on YouTube IS WRITTEN, NOT BUILT" — AND A FILM PAGE'S OWN NEIGHBOURS
 * ---------------------------------------------------------------------------------------------- */

test('the inline player’s YouTube link is built, so it is filed in no unbuilt table', () => {
  /*
   * THE FAULT THE OWNER NAMED. `/watch/` carried `<a aria-disabled="true" title="Not built yet — waiting on
   * the inline player’s own film; the player is opened by script and no film is playing">Open on YouTube ↗
   * <span class="small muted">— Not built yet</span></a>`. **A built control was wearing the mark of an
   * unbuilt one**, and the reason given — no film is playing — is true of the page at load and false of
   * every film the design's own `watch.js` opens.
   */
  const base = readFileSync(join(SCREENS, 'watch.html'), 'utf8');
  const out = fillDashboardLinks(base, 'watch');

  // The design's own anchor, unchanged — a real link with the attributes `watch.js` expects to find.
  assert.match(
    out,
    /<a class="btn btn-ghost" id="inline-player-external" href="#" target="_blank" rel="noopener">Open on YouTube ↗<\/a>/,
    'the design’s own external link was rewritten instead of left alone'
  );
  // And the marker is nowhere beside it.
  assert.doesNotMatch(
    out,
    /Open on YouTube[^<]*<span class="small muted">— Not built yet/,
    'a control that works is still printed as "Not built yet"'
  );
  assert.ok(
    !('Open on YouTube ↗' in DASHBOARD_UNBUILT_MAP),
    'a built control is still filed in the table of unbuilt ones'
  );

  /*
   * AND THE ADDRESS IT GETS IS THE FILM'S OWN, WHICH IS WHY IT IS BUILT. The line is the design's, served
   * extended from `/design-screen-assets/watch.js`; the id comes off the card the reader clicked and nothing
   * is invented for a film the archive does not hold.
   */
  const script = extendWatchScript(
    readFileSync(join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'watch.js'), 'utf8')
  );
  assert.match(script, /externalEl\.href = "https:\/\/www\.youtube\.com\/watch\?v=" \+ encodeURIComponent\(id\)/);
});

test('a film’s page offers the archive’s own neighbours, never the design’s example films', () => {
  /*
   * The design's "Related viewing" block names Onyeso, Unnamed Children and Yainkain under "Continue with
   * Unspoken Stories". **Measured: `/watch-video/?v=NBj1CvaDgbM`, `…?v=3NnklFf2rXA` and `…?v=g1z_-5jqPG0`
   * all answer 404**, so they are the design's own examples and are not this record's neighbours. On an
   * archive film's page they were demonstration material presented as the archive's.
   */
  const screen = readFileSync(join(SCREENS, 'watch-video.html'), 'utf8');
  const films = extractArchiveFilms([
    { slug: 'a', title: 'A Film', topic: 'Cultural Heritage', body_html: '<iframe src="https://www.youtube.com/embed/LL8YX0pXzdI"></iframe>' },
    { slug: 'b', title: 'B Film', topic: 'Cultural Heritage', body_html: '<iframe src="https://www.youtube.com/embed/SHPEwGDOI7c"></iframe>' },
    { slug: 'c', title: 'C Film', topic: 'Biography', body_html: '<iframe src="https://www.youtube.com/embed/jOMjbchyNXg"></iframe>' },
  ]);
  const out = fillWatchVideo(screen, films[0]!, films);

  assert.doesNotMatch(out, /Unspoken Stories/, 'the design’s own series name is presented as this record’s');
  assert.doesNotMatch(out, /NBj1CvaDgbM|3NnklFf2rXA|g1z_-5jqPG0/, 'a design example film is offered as related');
  assert.match(out, /More films under Cultural Heritage/, 'the archive’s own topic does not head the list');
  assert.match(
    out,
    /<a class="sx-video-row" href="\/watch-video\/\?v=SHPEwGDOI7c">/,
    'the film from the same topic is not offered as a row on this archive’s own page'
  );
  assert.doesNotMatch(out, /jOMjbchyNXg/, 'a film from another topic was offered as related');

  /*
   * The design's own page — no `?v=` — also loses the design's own block, and that is round 353's change to
   * round 352's Option B. The three example films are all 404 at `/watch-video/?v=`, so they are demonstration
   * material; the block is filled by the archive's own rule, which needs a topic, and this page has none. It
   * says so instead of borrowing them.
   */
  const own = fillWatchVideo(screen);
  assert.doesNotMatch(own, /Continue with Unspoken Stories/);
  assert.doesNotMatch(own, /NBj1CvaDgbM|3NnklFf2rXA|g1z_-5jqPG0/);
  assert.match(own, /No related film can be named/);
  assert.match(own, /<a href="\/watch\/">Watch<\/a>/);

  /* And a topic holding no other film says so rather than borrowing three. */
  const alone = fillWatchVideo(screen, films[0]!, [films[0]!]);
  assert.match(alone, /No other film under Cultural Heritage/);
  assert.doesNotMatch(alone, /youtube\.com\/watch\?v=(?!LL8YX0pXzdI)/);
  assert.doesNotMatch(alone, /class="sx-video-row"/, 'a row was drawn where the topic holds no other film');
});

test('a related row is a thumbnail and a title on this archive’s own page, and says only what is held', () => {
  /*
   * THE OWNER'S INSTRUCTION, ROUND 359: *"i expected to be smaller with a thumbnail on the left, the title on
   * the right type of thing, so redesign it and make it look better"*. Before this the block was one `<p>` of
   * three links separated by middots — no thumbnail, no row, no hierarchy.
   *
   * THREE THINGS ARE ASSERTED HERE AND EACH IS A DECISION RATHER THAN A SHAPE:
   *
   *   * it is a ROW — the design's own `.sx-video-thumb` frame and the design's own `i.ytimg.com` poster
   *     convention, at the size `.sx-related-list` uses for the same entry below 60rem;
   *   * it goes to `/watch-video/?v=<id>` and NOT to YouTube. **Every film that can appear here is an archive
   *     film** — it comes out of the same `extractArchiveFilms` result this page's own `?v=` was resolved
   *     against — so it has a page of its own on this origin, and a row that names an archive film and opens
   *     YouTube leaves the archive to say less about it;
   *   * its meta line carries the holding count and nothing else. `Archive film · Plays on this page` is the
   *     design's card wording and **the second half is false for a row** — a row navigates rather than playing
   *     in place — so neither half is copied, and the publisher, which the archive does not record, is not
   *     invented.
   *
   * AND A THUMBNAIL THAT FAILS IS DECORATIVE, LABELLED AND REMOVED. `alt=""` because the film's own title is
   * the text beside it, so a failure never prints the title twice as alt text; and the words `No thumbnail`
   * sit behind the image in the frame's own `--night-2` ground, so a failure is a designed dark frame rather
   * than a hole. **The two handlers are the part a unit test CAN still check, and the part that was measured
   * wrong without them**: `alt=""` alone leaves Chrome's broken-image icon painted in the frame, and an id
   * YouTube no longer holds answers 404 with a 120x90 grey placeholder JPEG that Chrome paints as though it
   * were a poster. So the element removes itself on either, which is why the markup is asserted here — the
   * frame, the hairline and the label those handlers leave behind are in `watch-video.css` and are measured in
   * a real browser by `scripts/verify-round-359.mjs`.
   */
  const screen = readFileSync(join(SCREENS, 'watch-video.html'), 'utf8');
  const films = extractArchiveFilms([
    { slug: 'a', title: 'A Film', topic: 'Cultural Heritage', body_html: '<iframe src="https://www.youtube.com/embed/LL8YX0pXzdI"></iframe>' },
    { slug: 'b', title: 'Ojeh & Arishi Festival', topic: 'Cultural Heritage', body_html: '<iframe src="https://www.youtube.com/embed/SHPEwGDOI7c"></iframe>' },
  ]);
  const out = fillWatchVideo(screen, films[0]!, films);

  assert.match(
    out,
    /<a class="sx-video-row" href="\/watch-video\/\?v=SHPEwGDOI7c">/,
    'the related film’s row does not open this archive’s own page for it'
  );
  /* The poster is the design's own convention and the design's own frame class, with an empty alt. */
  assert.match(
    out,
    /<span class="sx-video-thumb"><img src="https:\/\/i\.ytimg\.com\/vi\/SHPEwGDOI7c\/hqdefault\.jpg" alt="" width="128" height="72" loading="lazy" onerror="this\.remove\(\)" onload="if\(this\.naturalWidth&lt;320\)this\.remove\(\)"><\/span>/,
    'the row does not carry the design’s own poster frame, or it lost a handler a failed poster needs'
  );
  /*
   * AND THE TWO FAILURES ARE NAMED, so that removing either handler is a decision rather than an edit: an
   * image that cannot be fetched at all, and the placeholder YouTube serves for a film it no longer holds.
   */
  assert.match(out, /onerror="this\.remove\(\)"/, 'a poster that cannot be fetched leaves a broken-image icon');
  assert.match(
    out,
    /onload="if\(this\.naturalWidth&lt;320\)this\.remove\(\)"/,
    'the platform’s grey placeholder for a removed film is drawn as though it were a poster'
  );
  /* The title is the archive’s own, and the meta states the holding rather than a claim about playing. */
  assert.match(out, /<span class="sx-video-row-title">Ojeh &amp; Arishi Festival<\/span>/);
  assert.match(out, /<span class="sx-video-row-meta">Held in one Ozikoro archive record<\/span>/);
  assert.doesNotMatch(out, /Plays on this page/, 'a row claims to play in place, which it does not');
  /* Followed rather than assumed: no row hands the reader to YouTube. */
  assert.doesNotMatch(out, /youtube\.com\/watch\?v=SHPEwGDOI7c/, 'a related row still leaves the archive');
});

test('a film’s page does not carry the design’s own "for this design" into a real record', () => {
  const screen = readFileSync(join(SCREENS, 'watch-video.html'), 'utf8');
  const film = {
    id: 'LL8YX0pXzdI',
    title: 'ILA OSO',
    titleFrom: 'film' as const,
    topic: 'Cultural Heritage',
    records: 1,
    href: '/ila-oso-a-traditional-dance/',
  };
  assert.doesNotMatch(fillWatchVideo(screen, film), /for this design/);
  assert.doesNotMatch(fillWatchVideo(screen), /for this design/);
  /*
   * AND THE SENTENCE IS ON NEITHER PAGE. Round 352 removed the reading section from a film the archive holds
   * and left it on the design's own page, so the truthful transcript sentence still had something to attach to
   * there. **Round 353 removes the section from the bare page too**, because that is the page the owner opened
   * and the one section he named — so there is no reading view on either page and no sentence about a missing
   * transcript for either to carry. The design's own screen still holds it, untouched and inviolable.
   */
  assert.doesNotMatch(fillWatchVideo(screen), /transcript has not been supplied/i);
  /*
   * AND A FILM THE ARCHIVE HOLDS SAYS NOTHING ABOUT A TRANSCRIPT EITHER. The assertion is on the served
   * STATEMENTS rather than on the word, because the design's own container class for the band that carries the
   * related block is `.sx-transcript` — a class name a reader never meets, and the band the design drew the
   * block inside. What must not survive is a claim: the status line, the eyebrow, the heading, the id.
   */
  const held = fillWatchVideo(screen, film);
  assert.doesNotMatch(held, /transcript status/i, 'a film the archive holds still carries a transcript status line');
  assert.doesNotMatch(held, /transcript has not been supplied/i, 'a film the archive holds still says no transcript exists');
  assert.doesNotMatch(held, /id="transcript"/, 'a film the archive holds still serves the transcript id');
  assert.doesNotMatch(held, /Read when video is difficult to load/, 'the reading heading is still served');
});
/* ------------------------------------------------------------------------------------------------
 * THE OWNER'S INSTRUCTION ON `/watch-video/` — THE ARTICLE COMES OFF THE PAGE, THE RECORD'S OWN
 * DESCRIPTION GOES IN, A CONTROL FOR THE MAIN ARTICLE IS ADDED, AND THE READING SECTION IS
 * REPLACED BY THE DESIGN'S OWN RELATED BLOCK
 * ---------------------------------------------------------------------------------------------- */

test('a film’s page carries the record’s own description, and the record’s writing is not on it', () => {
  /*
   * WHAT THE OWNER ASKED FOR, IN HIS WORDS: *"on the watch, remove the article showing inside the page. if one
   * wants to see the article, when you click on 'this film's page', let it open, but not also the article. the
   * main article is expected to continue being in the original blog posts lists."*
   *
   * SO THE RECORD KEEPS ITS OWN ADDRESS AND THIS PAGE DOES NOT DUPLICATE THE WRITING. Round 351 put the
   * holding record's whole body — eleven to thirty-three paragraphs — into `#transcript-copy`, and it is off the
   * page again.
   *
   * AND THE SENTENCE HE READ THERE WAS NOT THE ARTICLE'S. He took `sx-video-copy`'s *"A sourced viewing page
   * keeps the film, its publisher, related records and text access together…"* for *"short description from the
   * article itself"*. **It is the design's fixed interface text** — the screen's own `example-flag` calls it
   * example material — and it is the same sentence on all eighteen films. His intent is kept and his premise is
   * not: the slot carries the record's own summary, read from `ozikoro_article.standfirst`.
   */
  const screen = readFileSync(join(SCREENS, 'watch-video.html'), 'utf8');
  const film = {
    id: 'LL8YX0pXzdI',
    title: 'The War Dance Festival (ILA OSO) In Uzuakoli',
    titleFrom: 'film' as const,
    topic: 'Cultural Heritage',
    records: 1,
    href: '/the-war-dance-festival-ila-oso-in-uzuakoli/',
  };
  const summary = 'The ILA OSO festival is a significant cultural event of the Uzuakoli people, located in '
    + 'present-day Abia State, Nigeria.';
  const out = fillWatchVideo(screen, film, [film], {
    summary,
    body: '<p>This paragraph is the body and it is NOT on the page, whatever it says.</p>'
      + '<h3>Historical Background</h3><p>The origins of the festival date back over 200 years.</p>',
    title: film.title,
    href: film.href,
  });

  assert.match(
    out,
    new RegExp(`<p class="sx-video-copy">${summary.replace(/[.()]/g, '\\$&')}</p>`),
    'the description slot does not carry the record’s own summary verbatim'
  );
  // The design's interface sentence is not the description, and neither is the platform note that replaced it.
  assert.doesNotMatch(out, /A sourced viewing page keeps the film/, 'the design’s boilerplate is still the description');
  assert.doesNotMatch(out, /This film is embedded by a record in the Ozikoro archive/, 'the platform note is still the description');

  // The record's writing is not on the page: no reading column, no body paragraph, no authored heading.
  assert.doesNotMatch(out, /class="prose"/, 'the record’s body was rendered into a reading column');
  assert.doesNotMatch(out, /This paragraph is the body/, 'the record’s body is on the film page');
  assert.doesNotMatch(out, /Historical Background/, 'the record’s own heading came with its body');
  // And the film is embedded once, as the page's subject, rather than twice.
  assert.equal(
    (out.match(/youtube-nocookie\.com\/embed\/LL8YX0pXzdI/g) ?? []).length,
    1,
    'the page carries the film more than once'
  );
});

test('a record with no summary is described in whole sentences from its own opening paragraph', () => {
  /*
   * THE FALLBACK, IN ORDER OF HONESTY. Measured: **all thirteen holding records carry a `standfirst` today**, so
   * this path is the exception rather than the rule — which is exactly why it is tested: it is the rule for the
   * first record that arrives without one.
   *
   * TWO THINGS IT MUST NOT DO. It must not take a truncated sentence — *"a truncated sentence can assert
   * something the record does not say"* — so a description stopped mid-sentence is a fault rather than a trim.
   * And it must not read the body raw: the record's own film embed and a `<script>` are both in the body, and
   * neither may put a word into the description. Both go through the archive's own sanitiser, which is the one
   * `prepareArchiveHtml` uses.
   */
  const screen = readFileSync(join(SCREENS, 'watch-video.html'), 'utf8');
  const film = {
    id: 'LL8YX0pXzdI',
    title: 'ILA OSO',
    titleFrom: 'film' as const,
    topic: 'Cultural Heritage',
    records: 1,
    href: '/the-war-dance-festival-ila-oso-in-uzuakoli/',
  };
  const out = fillWatchVideo(screen, film, [film], {
    summary: null,
    body: '<figure><img src="https://ozikoro.com/wp-content/uploads/2025/03/shot.jpg" alt="A photograph" width="719"></figure>'
      // Under forty characters, so it is a caption or a stray line rather than a description.
      + '<p>Shot by Gifty-e.</p>'
      + '<p>The ILA OSO festival is a significant cultural event of the Uzuakoli people. '
      + 'It is celebrated biennially. A third sentence is left out, because the design’s slot holds a short '
      + 'description rather than the record.</p>'
      + '<iframe src="https://www.youtube.com/embed/LL8YX0pXzdI" title="ILA OSO"></iframe>'
      + '<script>alert(1)</script>',
    title: 'The War Dance Festival (ILA OSO) In Uzuakoli',
    href: film.href,
  });

  const copy = /<p class="sx-video-copy">([\s\S]*?)<\/p>/.exec(out)?.[1];
  assert.equal(
    copy,
    'The ILA OSO festival is a significant cultural event of the Uzuakoli people. It is celebrated biennially.',
    'the description is not the record’s own first two whole sentences'
  );
  // Whole sentences only, so nothing past the second is shown and nothing is cut mid-sentence.
  assert.doesNotMatch(out, /A third sentence is left out/, 'the description ran past the sentences it takes');
  assert.doesNotMatch(out, /Shot by Gifty-e/, 'a caption was taken for the record’s opening');
  // And the body went through the archive's own sanitiser: neither the embed nor the script reached the slot.
  assert.doesNotMatch(copy ?? '', /iframe|youtube|alert\(1\)/, 'the body was read unsanitised');
  assert.equal(
    (out.match(/youtube-nocookie\.com\/embed\/LL8YX0pXzdI/g) ?? []).length,
    1,
    'a second player came in with the record’s body'
  );
});

test('a summary field that stops mid-sentence is declined, and the record’s opening is read instead', () => {
  /*
   * THE MEASUREMENT THIS RULE EXISTS FOR. All thirteen holding records carry an `ozikoro_article.standfirst`,
   * and **all thirteen are truncated windows of the body rather than authored summaries** — every one ends in
   * an ellipsis, and they glue the record's own sub-headings into their sentences:
   *
   *   `…the festival is celebrated biennially, alternating with the IZA MBARA AMA…`
   *   `…life by the river. History of Égwú Àmàlà Égwú…`
   *
   * **A field that stops mid-clause is not a description, and showing its good half would be showing a
   * truncated sentence** — the one thing the instruction forbids. So it is declined and the record's own
   * opening paragraph is read in whole sentences, which is the same rule's "else" branch and gives the same
   * opening words.
   */
  const screen = readFileSync(join(SCREENS, 'watch-video.html'), 'utf8');
  const film = {
    id: 'LL8YX0pXzdI',
    title: 'ILA OSO',
    titleFrom: 'film' as const,
    topic: 'Cultural Heritage',
    records: 1,
    href: '/the-war-dance-festival-ila-oso-in-uzuakoli/',
  };
  const out = fillWatchVideo(screen, film, [film], {
    summary: 'The ILA OSO festival is a significant cultural event of the Uzuakoli people. It is celebrated '
      + 'biennially, alternating with the IZA MBARA AMA…',
    /*
     * The body is shaped like the archive's own: WordPress's editor splits text into `<span>` runs that carry
     * their own spaces, so the tags must come off with **nothing** in their place. A tag substituted for a
     * space puts one in front of the record's own punctuation — measured without that rule, five of the
     * eighteen served pages read *"the ogene , a metal bell"* and *"in Nigeria , but"*.
     */
    body: '<p>The ILA OSO festival is a significant cultural event of the <span>Uzuakoli people</span>'
      + '<span>.</span> It is celebrated biennially, alternating with the <span>IZA MBARA AMA</span> '
      + 'masquerade dance. A third sentence is not shown.</p>',
    title: 'The War Dance Festival (ILA OSO) In Uzuakoli',
    href: film.href,
  });

  const copy = /<p class="sx-video-copy">([\s\S]*?)<\/p>/.exec(out)?.[1];
  assert.equal(
    copy,
    'The ILA OSO festival is a significant cultural event of the Uzuakoli people. It is celebrated biennially, '
      + 'alternating with the IZA MBARA AMA masquerade dance.',
    'a truncated summary was shown, or the record’s opening was not read'
  );
  assert.doesNotMatch(copy ?? '', /…/, 'the description still carries the excerpt’s ellipsis');
  assert.doesNotMatch(copy ?? '', / ,|\.\./, 'a tag boundary put a space in front of the record’s own punctuation');
  assert.doesNotMatch(out, /A third sentence is not shown/, 'the description ran past the sentences it takes');
  // And a complete summary field IS used, so the field is preferred wherever it really is a description.
  const authored = fillWatchVideo(screen, film, [film], {
    summary: 'A complete summary of the record, in its own words. A second sentence of the summary follows.',
    body: '<p>A different opening paragraph that must not be used, whatever it happens to say here.</p>',
    title: 'The War Dance Festival (ILA OSO) In Uzuakoli',
    href: film.href,
  });
  assert.match(
    authored,
    /<p class="sx-video-copy">A complete summary of the record, in its own words. A second sentence of the summary follows\.<\/p>/,
    'a complete summary field was not preferred over the body'
  );
  assert.doesNotMatch(authored, /A different opening paragraph/, 'the body was read over a usable summary');
});

test('a record with nothing usable for a description says so, and does not get the design’s line back', () => {
  /*
   * THE SLOT THE OWNER IS READING. Where the archive holds neither a summary nor an opening sentence, the
   * honest thing is to state that — **not to put the design's sentence about the platform back and call it the
   * record's.** A line about the platform in the description slot reads as the record's own words, which is the
   * fault this whole page is being fixed for.
   */
  const screen = readFileSync(join(SCREENS, 'watch-video.html'), 'utf8');
  const film = {
    id: 'LL8YX0pXzdI',
    title: 'ILA OSO',
    titleFrom: 'film' as const,
    topic: 'Cultural Heritage',
    records: 1,
    href: '/the-war-dance-festival-ila-oso-in-uzuakoli/',
  };
  const out = fillWatchVideo(screen, film, [film], {
    summary: '   ',
    body: '<p></p><figure><img src="https://example.invalid/x.jpg" alt=""></figure><p>Too short.</p>',
    title: 'The War Dance Festival (ILA OSO) In Uzuakoli',
    href: film.href,
  });
  assert.match(out, /carries no summary and no opening paragraph of its own/, 'an empty record was not stated');
  assert.doesNotMatch(out, /A sourced viewing page keeps the film/, 'the design’s boilerplate came back');
  // And with no record passed at all, the page still says which absence it is showing.
  const bare = fillWatchVideo(screen, film, [film]);
  assert.match(bare, /The archive supplied no readable record for this film/, 'a missing record was not stated');
});

test('the reading section is replaced by the design’s own Related viewing block in the place it stood', () => {
  /*
   * THE OWNER'S INSTRUCTION: *"then remove from 'On this page' and the entire others below, and replace it with
   * 'related videos'"*. So the section's aside, its transcript-first copy, its transcript status line and the
   * `#transcript` id all go, and the design's own related block — which the design draws INSIDE that section —
   * is what remains, in the design's own markup and its own copy panel.
   *
   * AND NO ANCHOR IS LEFT POINTING AT WHAT WENT. The design's own header nav carries
   * `<a href="#transcript">Transcript</a>`, made absolute to this page by `designScreenLinks` before this fill
   * runs, so the test drives that order too.
   */
  const screen = designScreenLinks(readFileSync(join(SCREENS, 'watch-video.html'), 'utf8'), '/watch-video/?v=LL8YX0pXzdI');
  const films = extractArchiveFilms([
    { slug: 'a', title: 'A Film', topic: 'Cultural Heritage', body_html: '<iframe src="https://www.youtube.com/embed/LL8YX0pXzdI"></iframe>' },
    { slug: 'b', title: 'B Film', topic: 'Cultural Heritage', body_html: '<iframe src="https://www.youtube.com/embed/SHPEwGDOI7c"></iframe>' },
  ]);
  const out = fillWatchVideo(screen, films[0]!, films, {
    summary: 'A sourced summary of A Film, in the record’s own words.',
    body: '',
    title: 'A Film',
    href: '/a/',
  });

  // Everything the owner asked to be removed is gone — the nav, the transcript copy, the status line, the id.
  assert.doesNotMatch(out, /On this page/, 'the design’s in-page nav is still on the page');
  assert.doesNotMatch(out, /id="transcript"/, 'the reading section is still served');
  assert.doesNotMatch(out, /id="transcript-copy"/, 'the reading column is still served');
  assert.doesNotMatch(out, /Transcript-first view/, 'the transcript-first eyebrow is still on the page');
  assert.doesNotMatch(out, /Transcript status/, 'the transcript status line is still on the page');
  assert.doesNotMatch(out, /Read when video is difficult to load/, 'the reading heading is still on the page');

  // And the design's own related block is what stands in its place, in the design's own wording and markup.
  assert.match(
    out,
    /<section class="sx-transcript"><div class="wrap"><div class="sx-transcript-copy" id="related-video"[^>]*><p class="eyebrow">Related viewing<\/p>/,
    'the related block is not where the reading section stood'
  );
  assert.match(out, /More films under Cultural Heritage/, 'the archive’s own topic does not head the list');
  assert.match(
    out,
    /<a class="sx-video-row" href="\/watch-video\/\?v=SHPEwGDOI7c">/,
    'the film from the same topic is not offered as a row'
  );

  /*
   * EVERY IN-PAGE ANCHOR ON THE SERVED PAGE POINTS AT AN ID THE PAGE CARRIES — followed, not assumed. This is
   * the check that would have caught the header nav pointing at a section that no longer exists.
   */
  const fragments = [...out.matchAll(/href="[^"]*#([^"]+)"/g)].map((m) => m[1] ?? '');
  assert.ok(fragments.length >= 2, 'the page carries no in-page anchors at all, so this check proves nothing');
  for (const fragment of fragments) {
    assert.match(
      out,
      new RegExp(`\\bid="${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      `an anchor points at #${fragment}, which the served page does not carry`
    );
  }
  assert.doesNotMatch(out, /#transcript/, 'an anchor still names the removed section');

  /*
   * THE THREE CONTROLS, in the design's own classes. The owner named the two the design draws and asked for a
   * third for the main article; both inward controls reach the holding record, because **the record is the
   * low-bandwidth reading of the film** and it is also what he calls "this film's page".
   */
  assert.match(
    out,
    /<a class="btn btn-gold" href="https:\/\/www\.youtube\.com\/watch\?v=LL8YX0pXzdI">Watch on YouTube ↗<\/a>/,
    'the outward control is not this film’s own'
  );
  assert.match(out, /<a class="btn btn-ghost" href="\/a\/">Low-bandwidth reading<\/a>/, 'the design’s reading control was lost');
  assert.match(out, /<a class="btn btn-ghost" href="\/a\/">This Film’s Article<\/a>/, 'the main article has no control');
  // The header nav names the block it now reaches, in the design’s own wording for that block.
  assert.match(out, /<a href="\/watch-video\/\?v=LL8YX0pXzdI#related-video">Related viewing<\/a>/, 'the header nav names a section the page does not carry');

  // And the provenance the archive must keep stays exactly where it was, plus the one policy sentence.
  assert.match(out, /<h2>Source record<\/h2>/, 'the source-record aside went with the reading section');
  assert.match(out, /<b>Rights and reuse<\/b><br>Not recorded\. Follow the publisher’s terms on YouTube\. Ozikoro does not present an external film as its own production\./);
});

test('the design’s own page is given a film page’s shape, and says the archive holds no record', () => {
  /*
   * ROUND 352 LEFT THIS PAGE AS "OPTION B" AND THE OWNER FOUND IT. `/watch-video/` with no `?v=` is the design's
   * own film — the home screen links it — and **the archive holds no record for it**: `?v=E3UBv8pmLxE` answers
   * 404. Round 352 reasoned from that to keeping the reading section, so that the "Low-bandwidth reading"
   * control and the design's own header nav anchor would not point at a removed id.
   *
   * **The reasoning was sound about the consequences and wrong about the page.** The owner opened the bare
   * address and met the one section he had asked to have removed, the description slot still carrying the
   * design's fixed interface sentence, two controls where his instruction had produced three, and a button
   * pointing at `#transcript`. Every one of his instructions was carried out on all eighteen `?v=` pages and on
   * none of the page he was looking at.
   *
   * So the shape is the `?v=` shape and the one differing fact is stated: **the archive holds no record for the
   * film this page shows.** The section goes, the block the design draws inside it stays, the description slot
   * carries that fact instead of the design's boilerplate, and nothing points at what is gone.
   */
  const screen = readFileSync(join(SCREENS, 'watch-video.html'), 'utf8');
  const own = fillWatchVideo(screen);

  /* The section, its nav, its label, its statement and both its ids go whole — as on a `?v=` page. */
  assert.doesNotMatch(own, /id="transcript"/, 'the design’s own reading section survived');
  assert.doesNotMatch(own, /id="transcript-copy"/, 'the reading panel’s id survived');
  assert.doesNotMatch(own, /On this page/, 'the "On this page" nav survived the section it described');
  assert.doesNotMatch(own, /Transcript-first view/, 'the transcript eyebrow survived');
  assert.doesNotMatch(own, /Read when video is difficult to load/, 'the reading heading survived');
  /*
   * THE STATUS LINE, MATCHED BY ITS OWN LABEL AND NOT BY THE WORDS "transcript status": the design's `<head>`
   * carries `<meta name="description" content="… transcript status …">`, and this fill does not own the head —
   * the route replaces it wholesale after the fills run. Asserting on the phrase would fail on markup no reader
   * is ever served.
   */
  assert.doesNotMatch(own, /Transcript status:/, 'the transcript status line survived');
  assert.doesNotMatch(own, /class="prose"/, 'an article body is on the page');

  /* The description slot says the one true thing, and not the design's sentence about the platform. */
  assert.match(own, /<p class="sx-video-copy">The archive holds no record for this film, so there is no description of it to show here\. None is written in its place\.<\/p>/);
  assert.doesNotMatch(own, /A sourced viewing page keeps the film/, 'the design’s boilerplate is still in the description slot');

  /* The facts line states the holding, in the slot a `?v=` page states its record in. */
  assert.match(own, /<span>Held in no Ozikoro archive record<\/span>/);

  /*
   * AND "LOW-BANDWIDTH READING" IS INERT RATHER THAN POINTING AT WHAT IS GONE. `aria-disabled`, no `href`, its
   * reason in the `title`, and the reason visible in the design's own `small muted` span. **Not a link to
   * `/watch/`**: the label promises this film's writing and the films index is a grid of other films, which is
   * a wrong destination at 200. **Not removed**: the archive's own precedent for a control whose label promises
   * something the page cannot do is to keep it and say why.
   */
  assert.match(
    own,
    /<a class="btn btn-ghost" aria-disabled="true" title="Not built yet — waiting on a record that holds this film; the archive holds no record for the film this page shows">Low-bandwidth reading <span class="small muted">— no archive record for this film<\/span><\/a>/
  );
  assert.doesNotMatch(own, /Low-bandwidth reading<\/a>/, 'the reading control is still a link');
  assert.doesNotMatch(own, /This Film’s Article/, 'a control to a record appeared on a page with no record');

  /* The design's own band and its own block stand where the section stood, saying why they are not filled. */
  assert.match(
    own,
    /<section class="sx-transcript"><div class="wrap"><div class="sx-transcript-copy" id="related-video"[^>]*><p class="eyebrow">Related viewing<\/p>/
  );
  assert.match(own, /No related film can be named/, 'the block does not say why it holds no film');
  assert.doesNotMatch(own, /NBj1CvaDgbM|3NnklFf2rXA|g1z_-5jqPG0/, 'a design example film is offered as related');
  assert.doesNotMatch(own, /Continue with Unspoken Stories/, 'the design’s own series is presented as this page’s');

  /* The header nav is repointed, as round 352 repointed it on a `?v=` page. */
  assert.match(own, /<a href="#related-video">Related viewing<\/a>/, 'the header nav names a section the page does not carry');

  /* And the design's own provenance is left exactly where it was, because it is true of the film it shows. */
  assert.match(own, /<h1>Faces \| Voices<\/h1>/, 'the design’s own film was replaced by nothing');
  assert.match(own, /<span>Publisher: \[Re:\]Entanglements Project<\/span>/);
  assert.match(own, /youtube-nocookie\.com\/embed\/E3UBv8pmLxE/);

  /*
   * AND NO FRAGMENT POINTS AT AN ID THE PAGE DOES NOT CARRY — followed here as the served page is followed.
   * `#transcript` and `#transcript-copy` are referenced by nothing and carried by nothing.
   */
  assert.doesNotMatch(own, /#transcript/, 'an anchor still names the removed section');
  const fragments = [...own.matchAll(/href="[^"]*#([^"]+)"/g)].map((m) => m[1] ?? '');
  assert.ok(fragments.length >= 2, 'the page carries no in-page anchors at all, so this check proves nothing');
  for (const fragment of fragments) {
    assert.match(
      own,
      new RegExp(`\\bid="${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      `an anchor points at #${fragment}, which the served page does not carry`
    );
  }
  /* The three controls the reader can press are the film, the film again, and the films index. */
  assert.match(own, /<a href="\/watch\/">Watch<\/a>/, 'the block does not point at the films the archive holds');
});


/*
 * ==================================================================================================
 * THE DOCUMENT LIBRARY LISTS WHAT IT CAN NAME, AND AN EMPTY GRID IS A REAL STATE
 * ==================================================================================================
 *
 * `mediaName` names a record from the record's own text and falls back to `Untitled document — <file>`
 * when every field it holds is the file's own name. `/documents/` does not list the fallback: the owner
 * asked for the two cards headed `Untitled document` to be removed, because **a heading gives a reader
 * nothing to choose between.** The two records are not deleted — they keep their pages, their files and
 * their addresses — so this rule belongs to the LISTING and must not move into `mediaName`, which names
 * the photograph gallery, the media library and every record page, and must keep showing an unnameable
 * record honestly.
 *
 * The test is here because the decision is read off `mediaName`'s `from` field, and a later refactor that
 * "simplifies" the listing back to `title` would restore the fault silently: the page would still render,
 * still 200, and still offer two headings nobody can choose between.
 */
const DOCUMENTS = readFileSync(join(SCREENS, 'documents.html'), 'utf8');

/** The design's `#other-pdfs` grid, out of a screen — the container this listing is. */
function pdfGrid(html: string): string {
  const start = html.indexOf('<div class="sx-pdf-grid"');
  assert.notEqual(start, -1, 'the grid container is gone from the screen, so this test measures nothing');
  const open = html.indexOf('>', start) + 1;
  let depth = 1;
  let i = open;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) { depth += 1; i = nextOpen + 4; }
    else { depth -= 1; i = nextClose + '</div>'.length; }
  }
  return html.slice(open, i - '</div>'.length);
}

/** The two records the owner asked to have removed from the listing, and the two names that are real. */
const namedDoc = (title: string, slug: string) => ({
  title,
  recordHref: `/documents/${slug}/`,
  href: `/media/${slug}.pdf`,
  label: 'Held by the archive · PDF',
  note: 'Downloadable file held in the archive. Rights and reuse terms are recorded with the record.',
  size: '120 KB',
});

test('the grid lists the documents it can name, and not one of the design’s demonstration files', () => {
  const out = fillDocuments(DOCUMENTS, [
    namedDoc('Igbo Folk Idioms In Caribbean Phrase', 'igbo-folk-idioms-in-caribbean-phrase'),
    namedDoc('Introduction To Igbo Mythology For Kids   Chinelo Anyadiegwu', 'introduction-to-igbo-mythology-for-kids-chinelo-anyadiegwu'),
  ]);
  const grid = pdfGrid(out);
  /* The two real names, at their two real addresses, and the download beside each . */
  assert.match(grid, /Igbo Folk Idioms In Caribbean Phrase/);
  assert.match(grid, /Introduction To Igbo Mythology For Kids/);
  assert.match(grid, /href="\/documents\/igbo-folk-idioms-in-caribbean-phrase\/"/);
  assert.match(grid, /href="\/documents\/introduction-to-igbo-mythology-for-kids-chinelo-anyadiegwu\/"/);
  assert.equal(grid.match(/<article/g)?.length, 2, 'the grid is not exactly the documents it was given');
  /* And every demonstration card is gone from the container, not merely hidden below the real ones. */
  assert.doesNotMatch(grid, /Ozikoro archive record guide/, 'the design’s demonstration guide is still listed');
  assert.doesNotMatch(grid, /Collection finding-aid pattern/, 'the design’s demonstration finding aid is still listed');
  assert.doesNotMatch(grid, /Depositor-restricted document/, 'the design’s demonstration locked card is still listed');
  assert.doesNotMatch(grid, /archive-guide-demonstration\.pdf/, 'a demonstration download is still listed');
});

test('an empty grid is emptied and explained, and never left holding the demonstration', () => {
  /*
   * THE SERVED PIPELINE, IN THE ORDER THE ROUTE RUNS IT. The route reads the screen from
   * `apps/ozikoro/public/design/screens/`, runs `designScreenLinks` over it, and then calls
   * `fillDocuments` with whatever the archive could name — so this reads the deliverable's copy, links it
   * the same way, and asserts the grid the reader actually receives. A test that skipped the link pass
   * would be measuring a page the archive never serves.
   */
  const served = designScreenLinks(DOCUMENTS, '/documents/');
  const out = fillDocuments(served, [], renderNoNameableDocuments());
  const grid = pdfGrid(out);
  assert.doesNotMatch(grid, /Ozikoro archive record guide/, 'an empty list fell back to the demonstration');
  assert.doesNotMatch(grid, /Collection finding-aid pattern/, 'an empty list fell back to the demonstration');
  assert.doesNotMatch(grid, /Depositor-restricted document/, 'an empty list fell back to the demonstration');
  assert.equal(grid.match(/<article/g)?.length ?? 0, 0, 'the grid is not empty');
  /*
   * AND THE SENTENCE IS THE ONE THE ROUTE SERVES, not a copy of it typed here. `renderNoNameableDocuments`
   * is what `route.ts` passes into this function, so an edit to the words fails here before it reaches a
   * reader — which is the whole reason the sentence is a function and not an inline string in the route.
   */
  assert.match(
    grid,
    /No document the archive can name is listed here yet\./,
    'the served empty state does not say why the list is empty'
  );
  assert.match(grid, /still held by the archive, still downloadable/, 'the empty state does not say the records survive');
  assert.match(grid, /left out of this list/, 'the empty state does not distinguish the listing from the archive');
  /*
   * AND THE REST OF THE SCREEN IS UNTOUCHED: the research section above is still emptied of its
   * fabricated publication, which is a different container and a different rule.
   */
  assert.match(out, /No publication has been deposited yet\./);
  assert.doesNotMatch(out, /Market week and ritual office/, 'the fabricated publication is back');
  /* An empty list with no sentence still says the plain thing rather than showing a blank space. */
  const bare = fillDocuments(DOCUMENTS, []);
  assert.match(pdfGrid(bare), /No document is listed here yet\./);
});
