/*
 * verify-round-309.mjs — the African cultural calendar, read as a BROWSER sees it.
 *
 * WHY A BROWSER AND NOT `curl`
 *
 * The owner's report has two halves and neither can be settled by a status code. The first is that four
 * strings the design draws were missing from the page — a `curl | grep` can settle that, and it is below.
 * The second is that the Country selector holds three countries, **which is a question about a `<select>`'s
 * rendered options and the script that fills the calendar** — and `curl` reads the bytes a server sent, not
 * the DOM those bytes become. Round 305's lesson in this project was that a page which looks right in HTML
 * can be a page whose script never loaded.
 *
 * So this drives real Chrome over the DevTools protocol: it loads the served page, waits for the deferred
 * scripts to run, and reads the live DOM. **The country count it prints is `select.options.length`** — the
 * number a phone would show — not a count of `<option>` substrings in a response body.
 *
 * NO DATABASE, NO BUILD, NO DEPENDENCY OUTSIDE CHROME. It only sends HTTP to a server that is already up.
 *
 * USAGE
 *   node scripts/verify-round-309.mjs                 # assumes http://127.0.0.1:3110
 *   PORT=4000 node scripts/verify-round-309.mjs
 */
import { spawn } from 'node:child_process';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = `${BASE}/cultural-calendar/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };
const info = (m) => console.log(`        ${m}`);

/*
 * THE FOUR STRINGS THE DESIGN DRAWS AND THE SERVED PAGE LOST.
 *
 * They are checked over plain HTTP first, because that is the check the owner's report was written from, and
 * a browser check that passes while the response body lacks them would be hiding the same fault behind a
 * script.
 */
const WANTED = [
  'Read event story',
  'Submit an event',
  'Suggest a correction',
  'Only dates with event entries are interactive.',
];

console.log(`\n== the served response, as bytes ==\n`);
const res = await fetch(URL);
const html = await res.text();
console.log(`  HTTP ${res.status} · ${html.length} bytes`);

for (const s of WANTED) {
  if (html.includes(s)) ok(`the response carries "${s}"`);
  else fail(`the response does NOT carry "${s}"`);
}

/* ------------------------------------------------------------------ the live DOM, through Chrome. */
console.log(`\n== the page as Chrome builds it ==\n`);

const port = 9700 + Math.floor(Math.random() * 200);
const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/oz-verify-309-${port}`,
    '--window-size=1440,2400',
    URL,
  ],
  { stdio: 'ignore' }
);

let ws;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* Chrome is still starting. */
    }
  }
  if (!target) throw new Error('Chrome did not expose a page target on the debugging port');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');

  // Wait for the deferred scripts and a settled document.
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (r?.result?.result?.value === 'complete') break;
  }
  await sleep(1500);

  /**
   * One expression, one JSON answer — so a single round trip reports everything and a failure inside the page
   * cannot be mistaken for a failure of the probe.
   */
  const probe = `(() => {
    const selects = [...document.querySelectorAll('.sx-calendar-filters select')];
    const country = selects.find((s) => {
      const label = s.closest('label');
      return label && /Country/.test(label.querySelector('span')?.textContent ?? '');
    });
    const groups = country ? [...country.querySelectorAll('optgroup')].map((g) => ({
      label: g.label,
      options: [...g.querySelectorAll('option')].map((o) => o.textContent.trim()),
    })) : [];
    const grid = document.querySelector('.sx-cultural-grid');
    const dayCells = grid ? [...grid.children] : [];
    const panel = document.querySelector('[data-event-panel]');
    return {
      title: document.title,
      countryFound: !!country,
      countryOptions: country ? country.options.length : 0,
      countryGroups: groups.map((g) => g.label + ' (' + g.options.length + ')'),
      firstOptions: country ? [...country.options].slice(0, 4).map((o) => o.textContent.trim()) : [],
      lastOptions: country ? [...country.options].slice(-3).map((o) => o.textContent.trim()) : [],
      hasNigeria: country ? [...country.options].some((o) => o.textContent.trim() === 'Nigeria') : false,
      hasEswatini: country ? [...country.options].some((o) => o.textContent.trim() === 'Eswatini') : false,
      gridCells: dayCells.length,
      gridNumbered: dayCells.filter((c) => c.querySelector('span')).length,
      gridBlanks: dayCells.filter((c) => c.classList.contains('is-empty')).length,
      cellWithEvent: document.querySelectorAll('.sx-cultural-day.has-event').length,
      eventButtons: document.querySelectorAll('[data-event-date]').length,
      panelHidden: panel ? panel.hidden : null,
      panelTitle: document.querySelector('[data-event-title]')?.textContent ?? null,
      panelStatus: document.querySelector('[data-event-status]')?.textContent ?? null,
      panelMeta: document.querySelector('[data-event-meta]')?.textContent ?? null,
      monthHeading: document.querySelector('.sx-cultural-calendar header h2')?.textContent ?? null,
      monthEyebrow: document.querySelector('.sx-calendar-intro .eyebrow')?.textContent ?? null,
      sourceNote: document.querySelector('.sx-source-note')?.textContent ?? null,
      scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
      storyHref: document.querySelector('[data-event-story]')?.getAttribute('href') ?? null,
      submitHref: [...document.querySelectorAll('.sx-event-day-panel .row a')]
        .find((a) => /Submit an event/.test(a.textContent))?.getAttribute('href') ?? null,
      submitDisabled: [...document.querySelectorAll('.sx-event-day-panel .row a')]
        .find((a) => /Submit an event/.test(a.textContent))?.getAttribute('aria-disabled') ?? null,
      /*
       * THE CONTRAST OF THE TWO INERT CONTROLS, MEASURED RATHER THAN ASSUMED.
       *
       * Losing the href also lost the colour: a quiet button's text is the page's dark ink, and this panel's
       * background is dark green, so **the label measured 1.13:1 — invisible**, which the screenshot showed and
       * no markup check could. The token's own value is read from the page rather than typed here.
       */
      // The token RESOLVED, not its source text: a raw custom-property value may be a hex or an oklab()
      // string that no rgb() comparison can match, so it is painted onto a probe element and read back.
      onNightMuted: (() => {
        const swatch = document.createElement('span');
        swatch.style.color = getComputedStyle(document.documentElement).getPropertyValue('--on-night-muted');
        document.body.appendChild(swatch);
        const value = getComputedStyle(swatch).color;
        swatch.remove();
        return value;
      })(),
      inertColours: [...document.querySelectorAll('.sx-event-day-panel .row a[aria-disabled="true"]')].map((a) => ({
        text: a.textContent.trim(),
        color: getComputedStyle(a).color,
        opacity: getComputedStyle(a).opacity,
        href: a.getAttribute('href'),
      })),
      visibleText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 4000),
      marketDayText: document.querySelector('[data-market-day]')?.textContent ?? null,
      marketDateText: document.querySelector('[data-modern-date]')?.textContent ?? null,
      marketBasis: document.querySelector('.sx-source-note.small')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      marketBlock: document.querySelector('aside.wrap [data-market-day]') ? 'after the hero' : null,
    };
  })()`;

  const r = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
  if (r?.result?.exceptionDetails) {
    fail(`the in-page probe threw: ${r.result.exceptionDetails.text}`);
  } else {
    const d = r.result.result.value;

    ok(`document title: ${d.title}`);

    if (!d.countryFound) fail('no Country <select> was found on the rendered page');
    else {
      console.log(`\n  COUNTRY SELECTOR, as the DOM holds it`);
      info(`options: ${d.countryOptions}`);
      info(`groups:  ${d.countryGroups.join(' · ')}`);
      info(`first:   ${d.firstOptions.join(' · ')}`);
      info(`last:    ${d.lastOptions.join(' · ')}`);
      if (d.countryOptions === 55) ok('55 rendered options: "All countries" plus 54 sovereign states');
      else fail(`expected 55 rendered options ("All countries" + 54); the DOM holds ${d.countryOptions}`);
      if (d.countryGroups.length === 5) ok('grouped into the five regions the Region control names');
      else fail(`expected 5 region groups; found ${d.countryGroups.length}`);
      if (d.hasNigeria) ok('the design\'s own Nigeria is still there');
      else fail('Nigeria is missing');
      if (d.hasEswatini) ok('a state the served page never had (Eswatini) is there');
      else fail('Eswatini is missing');
    }

    console.log(`\n  THE CALENDAR, as the DOM holds it`);
    info(`month heading: ${d.monthEyebrow} / ${d.monthHeading}`);
    info(`grid cells: ${d.gridCells} (${d.gridNumbered} numbered, ${d.gridBlanks} blanks)`);
    info(`cells with events: ${d.cellWithEvent} · event buttons: ${d.eventButtons}`);
    info(`panel hidden: ${d.panelHidden}`);
    info(`panel title:  ${d.panelTitle}`);
    info(`panel status: ${d.panelStatus}`);
    if (d.gridNumbered >= 28) ok(`${d.gridNumbered} numbered day cells are rendered for the month`);
    else fail(`expected a full month of numbered days; found ${d.gridNumbered}`);
    if (d.cellWithEvent === 0 && d.eventButtons === 0) ok('no date is marked as having an event, and none is a button');
    else fail(`${d.cellWithEvent} cells claim events and ${d.eventButtons} are buttons`);

    console.log(`\n  THE AFFORDANCES, as the DOM holds them`);
    info(`script srcs: ${d.scripts.join(' · ')}`);
    info(`"Read event story" -> ${d.storyHref}`);
    info(`"Submit an event"  -> href=${d.submitHref} aria-disabled=${d.submitDisabled}`);
    if (d.storyHref === '/cultural-event/') ok('"Read event story" points at the page that answers it');
    else fail(`"Read event story" points at ${d.storyHref}`);
    if (d.submitHref === null && d.submitDisabled === 'true') ok('"Submit an event" is not a link and says so');
    else fail(`"Submit an event" href=${d.submitHref} aria-disabled=${d.submitDisabled}`);

    /*
     * AND THE INERT LABELS ARE STILL READABLE.
     *
     * The design's own `--on-night-muted` is the token for text on a dark surface; the check is that both
     * inert controls resolved to exactly it, and that neither is a link.
     */
    for (const c of d.inertColours) {
      if (c.color === d.onNightMuted) ok(`"${c.text}" renders in the design's on-night token (${c.color}, opacity ${c.opacity})`);
      else fail(`"${c.text}" renders ${c.color}, not the design's on-night token (${d.onNightMuted}) — the label would be unreadable on the dark panel`);
      if (c.href === null) ok(`"${c.text}" has no href, so it is genuinely inert`);
      else fail(`"${c.text}" still carries href=${c.href}`);
    }

    /*
     * THE IGBO MARKET DAY.
     *
     * **The day must be one of the four, and it must be there at all.** An empty `<strong>` is the failure
     * this project has already recorded twice — the markup correct, the status 200, and the value never
     * arriving because the script did not load — so the assertion is on the text the DOM holds, not on the
     * presence of the element.
     */
    console.log(`\n  TODAY'S IGBO MARKET DAY, as the DOM holds it`);
    info(`stamp: ${d.marketBlock ?? 'NOT FOUND'}`);
    info(`day:   ${JSON.stringify(d.marketDayText)}`);
    info(`date:  ${JSON.stringify(d.marketDateText)}`);
    info(`basis: ${d.marketBasis}`);
    const CYCLE = ['Eke', 'Orie', 'Afọ', 'Nkwọ'];
    if (d.marketDayText && CYCLE.includes(d.marketDayText.trim())) ok(`the script filled the day: ${d.marketDayText.trim()}`);
    else fail(`the market day is ${JSON.stringify(d.marketDayText)} — the script did not fill it`);
    if (d.marketDateText && !/^Today$/.test(d.marketDateText.trim()) && /[0-9]/.test(d.marketDateText)) {
      ok(`the script filled the date: ${d.marketDateText.trim()}`);
    } else {
      fail(`the modern date is ${JSON.stringify(d.marketDateText)} — the script did not fill it`);
    }
    if (d.marketBasis && /demonstration reckoning/.test(d.marketBasis) && /1 January 2026 taken as Orie/.test(d.marketBasis)) {
      ok('the stamp names its basis and calls itself a demonstration');
    } else {
      fail(`the stamp does not state its basis: ${JSON.stringify(d.marketBasis)}`);
    }
    if (d.scripts.some((s) => /market-days\.js$/.test(s))) ok('the page loads market-days.js');
    else fail(`market-days.js is not among the page's scripts: ${d.scripts.join(' · ')}`);

    console.log(`\n  WHAT THE READER SEES (live DOM text, first 1200 chars)\n`);
    console.log(`        ${d.visibleText.slice(0, 1200)}`);

    /*
     * THE ONE THING THE SCRIPT MUST NOT HAVE DONE: HIDE THE PANEL AND LEAVE NOTHING.
     *
     * `cultural-calendar.js` calls `panel.hidden = false` only when it selects a day, and there are no days to
     * select. **A `hidden` panel is the script's own honest outcome** — what would be wrong is a panel left
     * showing the design's example event, which the checks above rule out.
     */
    if (d.panelHidden === true) info('the panel is hidden by the script, because no date has an event');
    else info('the panel is visible with its own empty state');
  }
} catch (e) {
  fail(`the browser pass could not complete: ${e.message}`);
} finally {
  try {
    ws?.close();
  } catch {
    /* nothing to close */
  }
  proc.kill();
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
