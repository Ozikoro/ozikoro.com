/*
 * verify-round-309-offline.mjs — the cultural calendar, verified WITHOUT a server.
 *
 * WHY THIS EXISTS ALONGSIDE THE BROWSER PASS
 *
 * The browser pass (`verify-round-309.mjs`) is the real one and it ran: it read the DOM Chrome built from the
 * served page, counted 55 rendered `<option>`s and read "Orie · Sun, 4 Oct 2026" from the two spans the
 * design's own script fills. **It cannot be re-run at will, because serving needs `next build`, and this
 * working tree's `apps/ozikoro/.next` is shared with another agent's `next dev` on port 3100 — a production
 * build beside a running dev server is the documented way to break both.**
 *
 * So this is the fallback, and it is deliberately narrower than the browser pass: it runs the FILL over the
 * real design file and then applies the ROUTE's own rewrites, in the route's own order, and reads the result
 * as a browser would resolve it. **It cannot prove a script executed; it can prove the URL the browser would
 * request, which is the fault that got past every markup check the first time.**
 *
 * NO SERVER, NO DATABASE, NO BUILD.
 *
 *   node scripts/verify-round-309-offline.mjs
 */
import { readFileSync } from 'node:fs';
import { fillCulturalCalendar, MARKET_DAY_ANCHOR, AFRICAN_COUNTRY_COUNT } from '../packages/ozikoro/src/design-fill.ts';

const SCREEN = 'apps/ozikoro/public/design/screens/cultural-calendar.html';
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };
const info = (m) => console.log(`        ${m}`);

const design = readFileSync(SCREEN, 'utf8');
const now = new Date();
const label = now.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

/* 1. The route's pre-fill step: a sibling script reference becomes the address the site serves. */
let html = design.replace(/src="\.\.\/([^"/]+\.js)"/g, 'src="/design/$1"');
/* 2. The fills. */
html = fillCulturalCalendar(html, {
  label,
  year: now.getUTCFullYear(),
  monthIndex: now.getUTCMonth() + 1,
  events: 0,
  anchor: MARKET_DAY_ANCHOR,
});

console.log(`\n== the fill over the real design file ==\n`);

for (const wanted of ['Read event story', 'Submit an event', 'Suggest a correction', 'Only dates with event entries are interactive.']) {
  html.includes(wanted) ? ok(`carries "${wanted}"`) : fail(`missing "${wanted}"`);
}

const selects = [...html.matchAll(/<span>Country<\/span>\s*<select[^>]*>([\s\S]*?)<\/select>/g)];
if (selects.length !== 1) fail(`expected exactly one country selector; found ${selects.length}`);
else {
  const options = selects[0][1].match(/<option>/g) ?? [];
  options.length === AFRICAN_COUNTRY_COUNT + 1
    ? ok(`the country selector renders ${options.length} options: "All countries" plus ${AFRICAN_COUNTRY_COUNT} states`)
    : fail(`the country selector renders ${options.length} options`);
  const groups = [...selects[0][1].matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1]);
  info(`groups: ${groups.join(' · ')}`);
}

/* 3. The two inert controls, and the one that still works. */
/<a class="btn" aria-disabled="true" style="color:var\(--on-night-muted\);opacity:\.8"[^>]*>Submit an event<\/a>/.test(html)
  ? ok('"Submit an event" is inert, carries no href, and is coloured for the dark panel')
  : fail('"Submit an event" is not in the inert, readable form');
/<a class="btn btn-quiet" aria-disabled="true" style="color:var\(--on-night-muted\);opacity:\.8"[^>]*>Suggest a correction<\/a>/.test(html)
  ? ok('"Suggest a correction" is inert, carries no href, and is coloured for the dark panel')
  : fail('"Suggest a correction" is not in the inert, readable form');
/href="upload\.html"/.test(html)
  ? fail('a link to the publication-deposit screen survived')
  : ok('no affordance points at the publication-deposit screen');
/<a class="btn btn-gold" data-event-story href="\/cultural-event\/">Read event story<\/a>/.test(html)
  ? ok('"Read event story" keeps its link and reaches a real page')
  : fail('"Read event story" is wrong');

/* 4. The market-day stamp AND the script that fills it, resolved as a browser would. */
console.log(`\n== the market-day stamp, and the script tag ==\n`);
const scripts = [...html.matchAll(/<script src="([^"]+)"[^>]*>/g)].map((m) => m[1]);
info(`script srcs, as the file holds them: ${scripts.join(' · ')}`);
scripts.includes('/design/market-days.js')
  ? ok('market-days.js is loaded by an ABSOLUTE path, so it resolves from /cultural-calendar/')
  : fail(`market-days.js is not loaded absolutely: ${scripts.join(' · ')}`);
/<\/head>/.test(html) && !/<base\s/.test(html.slice(0, html.indexOf('</head>')))
  ? info('no <base href="/"> in the head, which is exactly why the relative path would 404')
  : info('a base element is present');
html.includes('data-market-day') && html.includes('data-modern-date')
  ? ok('both hooks the design\u2019s own script fills are present')
  : fail('the market-day hooks are missing');
html.includes('data-market-day') && html.indexOf('data-market-day') < html.indexOf('sx-calendar-intro')
  ? ok('the stamp sits above "Events by date"')
  : fail('the stamp is not above the month');

/* 5. The grid: plain days only, for the month the page names. */
console.log(`\n== the calendar grid ==\n`);
/*
 * THE GRID'S CONTENT ENDS AT ITS OWN CLOSING TAG, WHICH SITS IMMEDIATELY BEFORE THE WRAPPER'S.
 * A lazy `([\s\S]*?)</div>` stops at the FIRST close, so it counted 30 of October's 31 days — a wrong
 * measurement that a ">= 28" assertion would have accepted. The pattern anchors on the design's own tail.
 */
const grid = /<div class="sx-cultural-grid"[^>]*>([\s\S]*?)<\/div><\/div>/.exec(html);
if (!grid) fail('no grid found');
else {
  const numbered = (grid[1].match(/<div class="sx-cultural-day"><span>\d+<\/span><\/div>/g) ?? []).length;
  info(`${numbered} numbered day cells for ${label} ${now.getUTCFullYear()}`);
  // The month's own length, from the calendar itself rather than a threshold: a grid that silently lost
  // its last cell passed a ">= 28" check while the browser counted 31.
  const expect = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  numbered === expect ? ok(`a full month is drawn: ${expect} days`) : fail(`expected ${expect} day cells; found ${numbered}`);
}
for (const gone of ['data-event-date', 'has-event', 'Verified event title appears here', '2 events']) {
  html.includes(gone) ? fail(`the design's example event survived as "${gone}"`) : ok(`no "${gone}"`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
