/**
 * check-screen-coverage.mjs — every design screen must have a route, and the route must exist.
 *
 * WHY THIS EXISTS (round 267)
 *
 * The parity check compares the routes it is HANDED against their screens. **That means a screen with no route
 * appears in no verdict at all** — and the owner found the consequence before any check did: `archive-index`
 * was being read, `/archive` existed, but 26 of the design's 51 screens had no route and the parity check
 * reported "every compared route carries its design" throughout.
 *
 * A checker that verifies only what it was asked about cannot report an omission. **This one starts from the
 * design instead**: it reads the screen directory and requires an answer for every file in it.
 *
 * THE FOUR ANSWERS A SCREEN MAY HAVE
 *
 *   route          a route renders it — named explicitly in the map below
 *   design-screen  THE GENERIC ROUTE RENDERS IT, which is how most screens are served
 *   alias          it is rendered by a route whose name differs (the design's `archive-index` is `/archive`)
 *   absent         it is deliberately not routed, with a reason that must be stated here
 *
 * ── WHY `design-screen` WAS MISSING, AND WHAT IT COST (round 338) ──────────────────────────────────
 *
 * This checker reported `NO ROUTE` for **twenty of the fifty-two screens on every commit** — the fourteen dashboards
 * plus `academy`, `account`, `donate`, `investors`, `journeys` and `sponsors` — while all twenty were answering
 * 200 to a reader, because `middleware.ts` rewrites `/<name>/` to `app/design-screen/[screen]/route.ts` for
 * every name in its `DESIGN_SCREENS` set. **The routes existed; the map had no way to say so.** A check that
 * fails identically on every commit is not a check, and this file's own header is the argument: a checker that
 * cannot report an omission also cannot report the truth.
 *
 * (`academy` was one of those twenty and is now the one entry in `ABSENT` below, because its address was
 * retired to the Academy's own host after this was written — see the entry.)
 *
 * So the fallback is now a fourth, VERIFIED answer rather than a missing one, and it is verified in the only
 * place that can make it true: the screen's name must be in the middleware's own `DESIGN_SCREENS` set, and
 * `app/design-screen/[screen]/route.ts` must exist. **Remove a name from the middleware and this check fails**,
 * which is the falsifiable form the earlier map never had.
 *
 * `ALIAS` entries are counted rather than resolved — they name a route by pattern (`/town/[slug]`) and the file
 * behind one is not always the literal path (`/folklore/[slug]` has no such file; the folklore reader is served
 * by the design-screen route). That weakness is recorded here rather than papered over.
 *
 * `absent` entries are printed rather than hidden, so the exemption is visible in the output rather than only
 * in this file.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS = 'apps/ozikoro/public/design/screens';
const APP = 'apps/ozikoro/app';
const MIDDLEWARE = 'apps/ozikoro/middleware.ts';

/**
 * The names the middleware rewrites to the design-screen route — read from the middleware rather than repeated.
 *
 * The set is written there as a `new Set<string>([...])` of quoted names, so it is read by finding that one
 * declaration and taking every quoted string in it. **A name added to the middleware is covered here without
 * anyone remembering to add it**, which is the same rule the screen list itself follows.
 */
function middlewareScreens() {
  const source = readFileSync(MIDDLEWARE, 'utf8');
  const at = source.indexOf('const DESIGN_SCREENS = new Set<string>([');
  if (at === -1) return null;
  const end = source.indexOf(']);', at);
  if (end === -1) return null;
  return new Set([...source.slice(at, end).matchAll(/['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]));
}

const DESIGN_SCREEN_FILE = join(APP, 'design-screen', '[screen]', 'route.ts');

/** screen -> the route that renders it. */
const ROUTE = {
  'home': '/', 'about': '/about', 'careers': '/careers', 'cite': '/cite',
  'documents': '/documents', 'folklore': '/folklore', 'igbo-calendar': '/igbo-calendar',
  'ledger': '/ledger', 'listen': '/design-screen/[screen]', 'material-culture': '/material-culture',
  'oral-recordings': '/oral-recordings', 'photographs': '/photographs', 'projects': '/projects',
  'publications': '/publications', 'topics': '/topics', 'watch': '/watch',
  'cultural-calendar': '/cultural-calendar', 'archive-index': '/archive', 'type-test': '/type-test',
  '404': '/not-found.tsx', 'upload': '/submit',
  /*
   * `account` IS THE ONE SCREEN THE MIDDLEWARE DOES NOT REWRITE, and it is not at `/account/` either: that
   * address is the application's own route and sends a signed-out reader to sign in. The design's account
   * screen is served at four addresses by `lib/account-screen.ts`, and `/signin` is the one it opens on.
   */
  'account': '/signin',
  /*
   * ── `document-viewer` IS THE FIRST SCREEN SERVED BY A ROUTE OF ITS OWN RATHER THAN THE GENERIC ONE ────
   *
   * It left the middleware's `DESIGN_SCREENS` set because the screen could not be served honestly: the
   * deliverable's viewer is one record's chrome around the demonstration PDF `research-download-demonstration.pdf`,
   * with a placeholder reference (`OZ-P-2026-0041`), two invented authors and a "CC BY 4.0" licence the archive
   * does not hold — and its `<object>` is refused outright by the site's own `object-src 'none'`. Measured on the
   * served page, a reader got a fabricated citation and a Download button for a demonstration file, and no preview.
   *
   * `app/document-viewer/page.tsx` takes the record from its own address (`?doc=<slug>`) and frames the file the
   * archive actually holds; with nothing named it says so and shows nothing. **The screen file is untouched and
   * is still served for design work at `/design-screen/document-viewer`**, which is the same treatment the
   * retired `academy` screen has. It is listed here rather than in `ABSENT` because it IS routed — by a page of
   * its own, which is the one thing this map has to be able to say.
   */
  'document-viewer': '/document-viewer',
};

/** screen -> the route that renders it under a different name, with the reason. */
const ALIAS = {
  'article': ['/[slug]', 'the article detail route, which serves every published entry'],
  'town': ['/town/[slug]', 'one town, under the towns index'],
  /*
   * THE REGISTER IS ONE PAGE AT `/clan-towns/`, AND THAT IS THE OWNER'S OWN INSTRUCTION.
   *
   * The owner: *"add them all to the /towns page, and maybe rename it to /clan-towns to accommodate…"* So
   * `/clan-towns/` is canonical and `/towns`, `/towns/`, `/towns.html` and `/clans/` are 301s into it, and
   * `designScreenLinks` resolves the name `towns.html` to `/clan-towns/` at serve time because the design
   * deliverable names it 17 times across 14 files and cannot be edited.
   *
   * ⚠️ THIS MAP SAID `'towns': '/towns'` AND SO REPORTED `MISSING towns — /towns — no page.tsx or route.ts`
   * ON EVERY RUN. That was true of the file tree and false about the site: the address 301s to a page that
   * exists. **A checker that reports a deliberate redirect as a missing screen is worse than one that stays
   * quiet**, because it teaches its reader to skim the red. The screen is not missing; it is served under a
   * name the owner chose.
   */
  'towns': ['/clan-towns', 'the register, renamed by the owner from /towns to /clan-towns; the old address 301s'],
  'project': ['/projects', 'a single project, under the projects index'],
  'publication': ['/publications/[slug]', 'one publication, under the publications index'],
  'researcher-profile': ['/researchers/[slug]', 'one researcher, under the researchers index'],
  'folklore-reader': ['/folklore/[slug]', 'one story, read as a continuous page'],
  'watch-video': ['/watch', 'one film, under the watch index'],
  'market-days': ['/igbo-calendar', 'the market-day tool, which is the calendar page'],
  'collections': ['/archive', 'the collections view is the archive index'],
  'cultural-event': ['/cultural-calendar', 'one event, shown on the calendar'],
};

/** screen -> why it is deliberately not routed. Must be a real reason. */
const ABSENT = {
  /*
   * ── `academy` IS THE FIRST ENTRY, AND IT IS AN ADDRESS RATHER THAN A FILE THAT IS ABSENT ──────────
   *
   * `academy` left the middleware's `DESIGN_SCREENS` set because the owner retired the page: *"delete this
   * page https://ozikoro.com/academy/ and move anyone that clicks on the academy on the top menu to
   * academy.ozikoro.com."* `middleware.ts` now answers `/academy` and `/academy/` with a **301 to the
   * Academy's own host**, so the address IS routed — to another application — and the generic design route
   * no longer answers for it.
   *
   * ⚠️ THE SCREEN FILE IS NOT GONE AND IS STILL RENDERED. The deliverable ships `screens/academy.html`, and
   * `/design-screen/academy` still serves it through the same generic route every other screen uses — the
   * treatment `towns` and `account` already have. **So this is not a screen nobody can reach; it is a
   * screen whose public address was deliberately moved to the application that now owns the subject.**
   * Saying that here rather than silently deleting the name is the point of this map: the exemption is
   * printed on every run (`absent` in the summary) instead of being invisible.
   */
  'academy': 'retired by the owner — /academy/ 301s to https://academy.ozikoro.com/ (middleware.ts); the screen itself is still served at /design-screen/academy',
};

const screens = readdirSync(SCREENS).filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, '')).sort();

let missing = 0, routed = 0, aliased = 0, absent = 0, generic = 0;
const designScreens = middlewareScreens();
if (!designScreens) {
  console.log('');
  console.log('  \x1b[31mCANNOT READ THE MIDDLEWARE\x1b[0m  middleware.ts no longer declares `DESIGN_SCREENS`, so no screen');
  console.log('  can be shown to be reachable by the generic route. A check that cannot read its own subject is a');
  console.log('  check that passes by accident, so this is a failure.');
  console.log('');
  process.exit(1);
}
console.log('');
console.log(`  Screen coverage — ${screens.length} design screens`);
console.log('');
for (const s of screens) {
  if (ROUTE[s]) {
    /*
     * A SCREEN MAY BE RENDERED BY A PAGE OR BY A ROUTE HANDLER, AND THE CHECK NOW KNOWS BOTH.
     *
     * It looked only for `page.tsx`, so `ROUTE['listen'] = '/design-screen/[screen]'` — the route handler that
     * renders `/listen/`, and every other screen that has no React page — would have been reported MISSING
     * while it was answering 200. **This is the same fault the file's own header records one level up: a
     * checker that cannot express the truth reports a fault that is not there, and the entry gets "fixed"
     * rather than the checker.** `app/design-screen/[screen]/route.ts` is a real route; whether the file is
     * named `page` or `route` is Next's business, not this map's.
     */
    const p = ROUTE[s].startsWith('/not-found')
      ? join(APP, 'not-found.tsx')
      : join(APP, ROUTE[s].slice(1), 'page.tsx');
    const handler = ROUTE[s].startsWith('/not-found') ? p : join(APP, ROUTE[s].slice(1), 'route.ts');
    if (existsSync(p) || existsSync(handler)) { routed += 1; }
    else { console.log(`  \x1b[31mMISSING\x1b[0m  ${s.padEnd(34)} ${ROUTE[s]} — no page.tsx or route.ts`); missing += 1; }
    continue;
  }
  if (ALIAS[s] && !ALIAS[s][1].startsWith('NOT YET')) { aliased += 1; continue; }
  if (ABSENT[s]) { console.log(`  absent   ${s.padEnd(34)} ${ABSENT[s]}`); absent += 1; continue; }
  /*
   * THE GENERIC ROUTE, WHICH IS HOW MOST SCREENS ARE SERVED — AND IT IS CHECKED RATHER THAN ASSUMED.
   *
   * Both halves have to hold or the address is not reachable: the middleware must rewrite this name to the
   * design-screen route, and that route must exist. Either half missing is a real fault and is reported as one.
   */
  if (designScreens && designScreens.has(s) && existsSync(DESIGN_SCREEN_FILE)) { generic += 1; continue; }
  if (designScreens && !designScreens.has(s)) {
    console.log(`  \x1b[31mNO ROUTE\x1b[0m ${s.padEnd(34)} middleware.ts does not rewrite /${s}/ to the design-screen route`);
  } else if (!existsSync(DESIGN_SCREEN_FILE)) {
    console.log(`  \x1b[31mMISSING\x1b[0m  ${s.padEnd(34)} app/design-screen/[screen]/route.ts does not exist`);
  } else {
    console.log(`  \x1b[31mNO ROUTE\x1b[0m ${s.padEnd(34)} the design has this screen and nothing renders it`);
  }
  missing += 1;
}
console.log('');
console.log(`  routed ${routed} · design-screen ${generic} · aliased ${aliased} · deliberately absent ${absent} · \x1b[31mMISSING ${missing}\x1b[0m`);
if (missing > 0) { console.log(''); console.log(`  ${missing} design screen(s) are not reachable.`); console.log(''); process.exit(1); }
console.log('');
console.log('  Every design screen has an answer.');
console.log('');
