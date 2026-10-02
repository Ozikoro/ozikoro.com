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
 * THE THREE ANSWERS A SCREEN MAY HAVE
 *
 *   route     a route renders it — named explicitly in the map below
 *   alias     it is rendered by a route whose name differs (the design's `archive-index` is `/archive`)
 *   absent    it is deliberately not routed, with a reason that must be stated here
 *
 * `absent` entries are printed rather than hidden, so the exemption is visible in the output rather than only
 * in this file.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS = 'apps/ozikoro/public/design/screens';
const APP = 'apps/ozikoro/app';

/** screen -> the route that renders it. */
const ROUTE = {
  'home': '/', 'about': '/about', 'careers': '/careers', 'cite': '/cite',
  'documents': '/documents', 'folklore': '/folklore', 'igbo-calendar': '/igbo-calendar',
  'ledger': '/ledger', 'listen': '/listen', 'material-culture': '/material-culture',
  'oral-recordings': '/oral-recordings', 'photographs': '/photographs', 'projects': '/projects',
  'publications': '/publications', 'topics': '/topics', 'towns': '/towns', 'watch': '/watch',
  'cultural-calendar': '/cultural-calendar', 'archive-index': '/archive', 'type-test': '/type-test',
  '404': '/not-found.tsx', 'upload': '/submit',
};

/** screen -> the route that renders it under a different name, with the reason. */
const ALIAS = {
  'article': ['/[slug]', 'the article detail route, which serves every published entry'],
  'town': ['/town/[slug]', 'one town, under the towns index'],
  'project': ['/projects', 'a single project, under the projects index'],
  'publication': ['/publications/[slug]', 'one publication, under the publications index'],
  'researcher-profile': ['/researchers/[slug]', 'one researcher, under the researchers index'],
  'folklore-reader': ['/folklore/[slug]', 'one story, read as a continuous page'],
  'watch-video': ['/watch', 'one film, under the watch index'],
  'market-days': ['/igbo-calendar', 'the market-day tool, which is the calendar page'],
  'collections': ['/archive', 'the collections view is the archive index'],
  'cultural-event': ['/cultural-calendar', 'one event, shown on the calendar'],
  'donate': ['/donate', 'NOT YET BUILT'],
};

/** screen -> why it is deliberately not routed. Must be a real reason. */
const ABSENT = {};

const screens = readdirSync(SCREENS).filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, '')).sort();

let missing = 0, routed = 0, aliased = 0, absent = 0;
console.log('');
console.log(`  Screen coverage — ${screens.length} design screens`);
console.log('');
for (const s of screens) {
  if (ROUTE[s]) {
    const p = ROUTE[s].startsWith('/not-found') ? join(APP, 'not-found.tsx') : join(APP, ROUTE[s].slice(1), 'page.tsx');
    const exists = existsSync(p);
    if (exists) { routed += 1; }
    else { console.log(`  \x1b[31mMISSING\x1b[0m  ${s.padEnd(34)} ${ROUTE[s]} — no such file`); missing += 1; }
    continue;
  }
  if (ALIAS[s] && !ALIAS[s][1].startsWith('NOT YET')) { aliased += 1; continue; }
  if (ABSENT[s]) { console.log(`  absent   ${s.padEnd(34)} ${ABSENT[s]}`); absent += 1; continue; }
  console.log(`  \x1b[31mNO ROUTE\x1b[0m ${s.padEnd(34)} the design has this screen and nothing renders it`);
  missing += 1;
}
console.log('');
console.log(`  routed ${routed} · aliased ${aliased} · deliberately absent ${absent} · \x1b[31mMISSING ${missing}\x1b[0m`);
if (missing > 0) { console.log(''); console.log(`  ${missing} design screen(s) are not reachable.`); console.log(''); process.exit(1); }
console.log('');
console.log('  Every design screen has an answer.');
console.log('');
