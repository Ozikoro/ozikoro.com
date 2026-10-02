/*
 * check-design-parity.mjs — does each page have the design's structure?
 *
 * WHY THIS EXISTS, AND WHY THE EXISTING CHECK DID NOT CATCH THE PROBLEM
 *
 * The owner reported that the demo "has nothing to do with the actual design". Every design file was
 * byte-identical, `check-design-system.sh` passed all five of its assertions, and the homepage was five
 * generic `section.wrap` blocks where the design has seven named sections with a specific h1 and six h2s.
 *
 * **Every existing check compared files to files.** None asked whether the rendered page IS the design's
 * page. This one does: it reads the design screen's section classes and headings, reads the same from the
 * rendered route, and reports what the design has that the page does not.
 *
 * HOW TO READ THE RESULT
 *
 * A missing class is not always a defect. The brief forbids filling a screen with invented content, so a
 * section the archive cannot honestly populate is deliberately absent — `sx-home-watch` on the homepage is
 * the worked example, because the design draws films and the archive has no published film pages. Those
 * omissions are declared in `EXPECTED_OMISSIONS` below with the reason, so an intended absence is recorded
 * rather than silently tolerated, and an UNINTENDED one is loud.
 *
 * Headings are the stronger signal and are reported separately: a section can legitimately be empty, but a
 * page whose h1 is not the design's h1 has been written rather than built.
 *
 * Usage: the archive must be running. `bash scripts/check-design-parity.mjs [base-url]`
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3110';

/*
 * ROUTES A FETCHER CANNOT SEE, AND WHY THE CHECK MUST SAY SO RATHER THAN FAIL THEM
 *
 * Two conditions make a route's real content invisible to a plain GET:
 *
 *   a loading boundary   `loading.tsx` makes the page render inside a Suspense boundary, so the static HTML
 *                        a fetcher receives is the boundary's FALLBACK. /submit returned 200 with the h1
 *                        "Fetching the record" and 462 KB of __next_f chunks containing none of the page.
 *
 *   an auth gate         the page redirects or refuses before rendering for an anonymous caller, so the
 *                        boundary's fallback is again what comes back.
 *
 * **Reporting either as a missing section is a false failure** — the eighth instance in this session of an
 * instrument's limit being read as a fact about its subject. These routes are named, reported as unverified,
 * and excluded from the failure count. They are still checked for reachability, so a genuine 404 or 500 is
 * not hidden by the exemption.
 */
const BEHIND_A_BOUNDARY = {
  '/submit': {
    loading: 'apps/ozikoro/app/submit/loading.tsx',
    gate: "requireCapabilityOrRedirect('submit_work')",
    why: 'the loading fallback is what a fetcher receives, and the page needs submit_work',
  },
};

/** Is this route one a plain GET cannot see? */
function unreadable(route) {
  const entry = BEHIND_A_BOUNDARY[route];
  if (!entry) return null;
  return entry;
}
const SCREENS = 'apps/ozikoro/public/design/screens';

/*
 * Route -> design screen. Only routes the design actually draws are listed; a route with no screen has no
 * design to be held to and is not a parity question.
 */
const ROUTES = [
  ['/', 'home'],
  ['/archive', 'archive-index'],
  ['/photographs', 'photographs'],
  ['/documents', 'documents'],
  ['/listen', 'listen'],
  ['/material-culture', 'material-culture'],
  ['/towns', 'towns'],
  ['/igbo-calendar', 'igbo-calendar'],
  ['/cultural-calendar', 'cultural-calendar'],
  ['/cite', 'cite'],
  ['/careers', 'careers'],
  ['/ledger', 'ledger'],
  ['/projects', 'projects'],
  ['/about', 'about'],
  ['/publications', 'publications'],
  ['/topics', 'topics'],
  ['/folklore', 'folklore'],
  ['/submit', 'upload'],
  ['/watch', 'watch'],
  /*
   * Routes with no screen of their own, and why. These are not parity failures: the design does not draw
   * them, so there is no design to be held to.
   *
   *   /search /signin /reviews        the design has no screen for these
   *   /researchers                    the design draws `researcher-profile`, a single researcher, and the
   *                                   archive's index of researchers is not that page
   *   /town/[slug] /project/[slug]    dynamic detail routes; `town` and `project` are their screens and are
   *                                   compared by sampling one record rather than by a fixed path
   */
];

/*
 * Sections the archive cannot honestly fill, with the reason. Declared, not tolerated.
 */
/*
 * THE DESIGN'S OWN DEMONSTRATION CONTENT, WHICH THE BRIEF FORBIDS REPRODUCING.
 *
 * This check first reported fifteen of eighteen routes as failing. Reading the list showed that most of the
 * "missing" headings were the design's placeholder records — "String games photograph" with the reference
 * OZ-PH-EXAMPLE, "The Ikoro: the drum that spoke for a town" as a sample episode, "restricted publication
 * title appears here", the example project "Town histories series", and the careers screen's "in this
 * demonstration". **A page that reproduces those has done the wrong thing.** The brief is explicit: replace
 * example text only with verified material, and never use prototype values from the design screens as real
 * data.
 *
 * So the check has to know which design text is a PLACEHOLDER and which is STRUCTURE. Structure is the page's
 * skeleton — a hero, a section, an h1 — and must be present. A placeholder is content the archive has to earn,
 * and its absence is the correct state until real material exists.
 *
 * A pattern here means: "this design heading is a placeholder, so its absence is not a defect". Anything not
 * matched is treated as structure and its absence is loud, which is the safe direction — a new placeholder
 * shows up as a failure and gets triaged, rather than being silently tolerated.
 */
/*
 * The design's own demonstration content, whose absence is the CORRECT state rather than a defect.
 *
 * `market week and ritual office` is the design's example publication: the brief forbids treating a
 * demonstration as an official publication, so a page that reproduced it would have done the wrong
 * thing. Anything not matched here is treated as structure and its absence is loud.
 */
const PLACEHOLDER = /(sample record|string games photograph|ikoro drum photograph|more verified records|oz-|example|appears here|demonstration|sample episode|no verified vacancies|the ikoro: the drum|town histories series|restricted publication|approved summary|market week and ritual office)/i;

/*
 * NOTHING IS DECLARED OMITTED.
 *
 * The homepage's watch section sat here for six rounds with the reason "the archive holds 13 video records and
 * no published film pages". That stopped being true when /watch was built, and this check went on reporting
 * the homepage as PASSING, because it had been told the omission was intended.
 *
 * **An omission declaration is a promise to revisit it, and nothing here enforced that promise.** The entry is
 * removed rather than kept for the next case, and the lesson is recorded: if something has to be declared
 * absent, record WHY and what would make it present, so the condition can be tested rather than trusted.
 */
const EXPECTED_OMISSIONS = {};

/*
 * HEADINGS THAT BELONG TO A DECLARED-ABSENT SECTION.
 *
 * The first version of this check reported the homepage as failing on the watch section's h2 — the same
 * fact as the declared section omission, counted twice. A section that is deliberately absent takes its
 * headings with it, so they are listed here against the route they belong to rather than left to trip the
 * heading comparison.
 */
const OMITTED_SECTION_HEADINGS = {
  '/': ['see the archive. hear its voices.'],
};

/*
 * ROUTES WITH NO DESIGN SCREEN, NAMED RATHER THAN INFERRED.
 *
 * These are not parity questions — the design does not draw them, so there is no design to be held to. An
 * earlier version derived the list from a missing file, which meant a screen renamed or deleted upstream
 * would silently move a route out of the comparison instead of failing it. Naming them makes that loud.
 */
const NO_SCREEN = {
  '/search': 'the design has no search screen',
  '/signin': 'the design has no sign-in screen',
  '/reviews': 'the design has no review-queue screen',
  '/researchers': 'the design draws researcher-profile, one researcher; an index of them is not that page',
  '/oral-recordings': 'the design routes this to Listen and draws no screen of its own',
};

/** Section classes and h1/h2 text, from either a design screen or a rendered page. */
function structure(html) {
  const sections = [...html.matchAll(/<section[^>]*class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => c.startsWith('sx-'))
    .filter((c, i, a) => a.indexOf(c) === i);
  const headings = [...html.matchAll(/<h([12])[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({
    level: Number(m[1]),
    text: m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&mdash;/g, '—')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase(),
  }));
  return { sections, headings };
}

const norm = (s) => s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Compare only the words, so "Fresh from\nthe archive" matches "Fresh from the archive". */
function headingMatches(design, page) {
  const d = norm(design);
  return page.some((p) => {
    const q = norm(p);
    return q === d || q.startsWith(d) || d.startsWith(q);
  });
}

let failures = 0, omissions = 0, checked = 0, unverified = 0;
const noScreen = [];

for (const [route, screen] of ROUTES) {
  const screenPath = join(SCREENS, `${screen}.html`);
  if (!existsSync(screenPath)) {
    noScreen.push(`${route} — expected screens/${screen}.html, which does not exist`);
    continue;
  }

  const design = structure(await readFile(screenPath, 'utf8'));
  let page;
  try {
    const res = await fetch(`${BASE}${route}`, { signal: AbortSignal.timeout(60000), redirect: 'follow' });
    if (!res.ok) { console.log(`  ${'HTTP ' + res.status}  ${route.padEnd(24)} (not rendered)`); failures += 1; continue; }
    page = structure(await res.text());
  } catch (error) {
    console.log(`  UNREACHABLE  ${route.padEnd(24)} ${error.message}`);
    failures += 1;
    continue;
  }

  const unreadableReason = unreadable(route);
  if (unreadableReason) {
    /*
     * Reachability is still checked, so a real 404 or 500 is not hidden. The structure comparison is not run,
     * because what came back is the boundary's fallback and comparing it would be comparing the wrong page.
     */
    const reached = page.sections.length + page.headings.length > 0;
    console.log(`  ${reached ? 'UNVERIFIED' : 'FAIL'} ${route.padEnd(22)} ${unreadableReason.why}`);
    if (!reached) failures += 1;
    unverified += 1;
    continue;
  }

  checked += 1;
  const missing = design.sections.filter((s) => !page.sections.includes(s));
  const declared = EXPECTED_OMISSIONS[route] ?? {};
  const undeclared = missing.filter((s) => !(s in declared));
  const pageText = page.headings.map((p) => p.text);
  const omittedHeadings = OMITTED_SECTION_HEADINGS[route] ?? [];
  const missedHeadings = design.headings
    .filter((h) => !headingMatches(h.text, pageText))
    // A placeholder's absence is the correct state, not a defect. See PLACEHOLDER above.
    .filter((h) => !PLACEHOLDER.test(h.text))
    // A heading inside a declared-absent section goes with the section.
    .filter((h) => !omittedHeadings.some((o) => norm(h.text).startsWith(norm(o)) || norm(o).startsWith(norm(h.text))));
  const placeholders = design.headings
    .filter((h) => !headingMatches(h.text, pageText) && PLACEHOLDER.test(h.text));

  const ok = undeclared.length === 0 && missedHeadings.length === 0;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${route.padEnd(22)} ${design.sections.length} design sections, ${design.headings.length} headings`);
  for (const s of missing) {
    if (s in declared) { console.log(`         omitted  .${s}  — ${declared[s]}`); omissions += 1; }
    else console.log(`         MISSING  .${s}`);
  }
  for (const h of missedHeadings) {
    console.log(`         MISSING  h${h.level}: "${h.text.slice(0, 68)}"`);
  }
  for (const h of placeholders) {
    console.log(`         earned   h${h.level}: "${h.text.slice(0, 60)}" — design placeholder, absent correctly`);
  }
  if (!ok) failures += 1;
}

console.log('');
if (noScreen.length > 0) {
  console.log(`  ${noScreen.length} route(s) have no design screen and were not compared:`);
  for (const r of noScreen) console.log(`    ${r}`);
}
console.log(`  compared ${checked} route(s) against their design screen`);
console.log(`  unverified, behind a loading boundary or an auth gate ${unverified}`);
console.log(`  declared omissions ${omissions}`);
if (failures > 0) {
  console.log(`  ${failures} ROUTE(S) DO NOT MATCH THEIR DESIGN`);
} else {
  console.log('  Every compared route carries its design\'s structure and headings.');
}
process.exit(failures > 0 ? 1 : 0);
