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
  /*
   * ⚠️ `/clan-towns`, NOT `/towns`. THE OWNER RENAMED THE REGISTER AND THIS MAP DID NOT FOLLOW.
   *
   * He asked for it in his own words — *"add them all to the /towns page, and maybe rename it to
   * /clan-towns to accommodate both. there's a reason the towns section have an option to select
   * ethnicities, clans, tribes, and towns"* — so `/towns`, `/towns/`, `/towns.html` and `/clans/` are all
   * 301s into `/clan-towns/`, which is the page.
   *
   * **A CHECK THAT FETCHES A 301 IS NOT COMPARING THE PAGE.** It was reading the redirect's body — or
   * whatever the fetch followed it to — while naming the route `/towns`, so the route it reported and the
   * page it measured were not the same thing. *The five mismatches below are left standing rather than
   * declared omitted*, because the page's own header records the owner's instruction for the finder and does
   * not account for the renamed h1 or for the five classes: whether those are a redesign he asked for or an
   * unfinished one is his to say, not mine to quieten.
   */
  ['/clan-towns', 'towns'],
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
const EXPECTED_OMISSIONS = {
  /*
   * `/archive` — `.grid-4`, and the page is right rather than the checker.
   *
   * `archive-index.html` carries `class="grid-4"` at its FOOTER and nowhere near the records; the design's
   * four example cards sit in a plain `<div>` and `.entry` does the layout
   * (`padding-block: var(--s-5); border-bottom: 1px solid var(--rule)` — a list, not a grid). The archive
   * was built as a React route that first flowed the records four-across in `grid-4`, and that was corrected
   * on purpose and is documented at `apps/ozikoro/app/archive/page.tsx:479`: four across squashed `--measure`
   * mid-sentence and the row hairlines did not line up.
   *
   * **REMOVAL CRITERION, stated because an omission declaration is a promise to revisit it** (see the note
   * above about the homepage's watch section, and the project's rule — waive in code, print the waiver, state
   * what removes it): remove this entry when either the design moves `grid-4` onto the records container, or
   * the archive's record list genuinely becomes a four-across grid. The waiver prints on every run.
   */
  '/archive': {
    'grid-4':
      "the design uses grid-4 at its footer; the record list is a vertical stack by .entry — see apps/ozikoro/app/archive/page.tsx:479",
  },
};

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
  /*
   * ⚠️ `/topics` AND THE ALPHABET, WHICH IS A PLACEHOLDER THE PATTERN ABOVE CANNOT SEE.
   *
   * `topics.html` draws an A–Z index: nine `<h2>` elements holding the single letters **A C E F I O P R S**.
   * The served page lists the sixteen letters that HAVE topics — A B C D E F H I L M N O P R U V — read from
   * the register rather than typed. **No topic begins with S, so there is no S heading, and the page is
   * right.** *A page that invented an empty S to match a placeholder would be the wrong fix*, and this is the
   * same rule the PLACEHOLDER regex applies to "String games photograph" and "more verified records appear
   * here" — except a one-letter heading is below the length at which that pattern can tell structure from
   * sample data.
   *
   * The letters are declared rather than the mismatch being waived, so that **a REAL heading appearing on
   * `/topics` is still compared**: only these nine strings are excused, and a tenth would fail.
   */
  '/topics': ['a', 'c', 'e', 'f', 'i', 'o', 'p', 'r', 's'],
};

/*
 * ROUTES WITH NO DESIGN SCREEN, NAMED RATHER THAN INFERRED.
 *
 * These are not parity questions — the design does not draw them, so there is no design to be held to. An
 * earlier version derived the list from a missing file, which meant a screen renamed or deleted upstream
 * would silently move a route out of the comparison instead of failing it. Naming them makes that loud.
 */
/*
 * ELEMENTS THAT RENDER ONLY IN A STATE, AND THE URL THAT PRODUCES IT.
 *
 * Some of the design's structure is conditional by nature. `archive-index.html` draws a `.chips` row of active
 * filters and an `.empty` section for a search that found nothing — and neither exists on the page until the
 * reader does something. **Comparing the unfiltered page and calling them missing would be wrong; exempting
 * them by name would be a blind spot**, which is the fault this file was just corrected for.
 *
 * So the state is produced and the element is looked for THERE. A route with entries here is still FAILING if
 * the element is absent from the triggered page, so the tolerance cannot hide a real omission.
 *
 * `route -> { selector: urlThatShouldRenderIt }`
 */
const CONDITIONAL = {
  // Keys are the class names as `missing` holds them — without the leading dot.
  '/archive': { chips: '/archive?topic=origins', empty: '/archive?place=zzzzz-no-such-place' },
};

const NO_SCREEN = {
  '/search': 'the design has no search screen',
  '/signin': 'the design has no sign-in screen',
  '/reviews': 'the design has no review-queue screen',
  '/researchers': 'the design draws researcher-profile, one researcher; an index of them is not that page',
  '/oral-recordings': 'the design routes this to Listen and draws no screen of its own',
};

/*
 * STRUCTURAL CLASSES AND HEADINGS, AND THE BLIND SPOT THIS USED TO HAVE (found in round 265).
 *
 * This collected only `sx-*` classes from `<section>` elements, and **twelve of the fifty-one design
 * screens use none** — `archive-index`, `researcher-profile`, `publication`, the dashboard set, `academy`,
 * `type-test` and the 404. **The check therefore reported "every compared route carries its design" while
 * never having read a quarter of the design.**
 *
 * The page the owner pointed at is the proof: `archive-index.html` is a `wrap` + `sidebar-layout` with a
 * `rail` of six `fieldset` filters and a `chips` row, and `/archive` had the right h1 and none of it. The
 * check called it "ok — 0 design sections, 1 headings", because zero sections is what a screen with no
 * `sx-` classes yields, and zero was compared against zero.
 *
 * **A pattern that only recognises one naming convention reports agreement wherever it does not apply** —
 * the same failure this run has recorded repeatedly, in the instrument this time.
 *
 * So the collection is the structural classes the design actually uses: anything applied to a `<section>`,
 * plus the layout wrappers that carry a screen's shape. Decorative one-offs are excluded so the comparison
 * stays about structure rather than drift.
 */
const STRUCTURAL = /^(sx-|wrap|sidebar-layout|rail|chips|spread|steps|dropzone|provenance|card|empty|record|table|grid|row|stack|split|people|paths|faq|timeline|doors|cats|strip|filterbar|toolbar|notice|hero)/;

function structure(html) {
  const sections = [...html.matchAll(/<(?:section|div|form|nav|aside)[^>]*class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => STRUCTURAL.test(c))
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

  /*
   * THE VERDICT IS COMPUTED AFTER THE EVIDENCE IS GATHERED, NOT BEFORE IT.
   *
   * This block used to be:
   *
   *     const ok = undeclared.length === 0 && missedHeadings.length === 0;
   *     console.log(`  ${ok ? 'ok' : 'FAIL'} ...`);
   *     for (const s of missing) { ... if (present at trigger) { console.log('ok'); continue; } ... }
   *     if (!ok) failures += 1;
   *
   * **`ok` was frozen one line above the loop that exists to change it.** The `CONDITIONAL` branch below
   * renders a state that should contain the section and, finding it, prints `ok` for that section — but it
   * cannot unfreeze the verdict, so a route whose only gap was a conditional section that IS present at its
   * trigger was still counted as a failure. That is the same fault the mechanism was written to remove,
   * one level up and in the other direction: a check that can print `ok` twelve times and still fail.
   *
   * So the findings are collected first and the verdict is derived from what SURVIVED the loop. `unresolved`
   * starts as the undeclared sections and loses one each time a conditional state proves it present.
   */
  const unresolved = [...undeclared];
  const detail = [];
  for (const s of missing) {
    if (s in declared) { detail.push(`         omitted  .${s}  — ${declared[s]}`); omissions += 1; continue; }

    // Conditional structure: produce the state and look for it there rather than exempting it.
    const trigger = CONDITIONAL[route]?.[s];
    if (trigger) {
      let triggered = null;
      try {
        const res = await fetch(`${BASE}${trigger}`, { signal: AbortSignal.timeout(60000), redirect: 'follow' });
        triggered = await res.text();
      } catch {
        triggered = null;
      }
      if (triggered && new RegExp(`class="[^"]*\\b${s.replace('.', '')}\\b`).test(triggered)) {
        detail.push(`         ok       .${s.replace('.', '')}  — present at ${trigger}`);
        const at = unresolved.indexOf(s);
        if (at >= 0) unresolved.splice(at, 1);
        continue;
      }
      detail.push(`         MISSING  .${s.replace('.', '')}  — absent even at ${trigger}, which should render it`);
      if (!unresolved.includes(s)) unresolved.push(s);
      continue;
    }

    detail.push(`         MISSING  .${s}`);
  }
  for (const h of missedHeadings) {
    detail.push(`         MISSING  h${h.level}: "${h.text.slice(0, 68)}"`);
  }
  for (const h of placeholders) {
    detail.push(`         earned   h${h.level}: "${h.text.slice(0, 60)}" — design placeholder, absent correctly`);
  }

  const ok = unresolved.length === 0 && missedHeadings.length === 0;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${route.padEnd(22)} ${design.sections.length} design sections, ${design.headings.length} headings`);
  for (const line of detail) console.log(line);
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
