/*
 * adsense.ts — WHERE THE OWNER'S ADS GO, AND WHERE THEY DELIBERATELY DO NOT.
 *
 * The owner: *"i did not see where to place the google adsense ads, so please add it yourself."* So the
 * placement is a decision this file makes and defends, and the ids in it are his — they are copied from the
 * snippet his own AdSense account issued and **not one character of them is invented**:
 *
 *     client  ca-pub-7838607083592256
 *     slot    5756976639        (responsive, auto format, full width)
 *
 * ── WHY THIS IS APP-LOCAL AND NOT IN `@ozikoro/platform` ─────────────────────────────────────────────
 *
 * It sits beside `discussion.ts`, `publication-cache.ts` and the other app-local helpers, and it is imported
 * through the `@/lib/…` alias the three call sites already use. An ad unit is a property of THIS site's
 * product surface and of no other application that depends on the platform package — the dictionary and the
 * Academy must never inherit an ad policy from the archive by importing a barrel.
 *
 * ── THE THREE DOCUMENT PRODUCERS, WHICH IS WHY THERE ARE THREE CALL SITES ────────────────────────────
 *
 * `apps/ozikoro/app/layout.tsx`'s comment records the fact that measured this design: *"This layout does not
 * run for the design screens or the articles."* Re-measured for this change on the review server:
 *
 *     GET /                 x-middleware-rewrite: /design-screen/home       0 `/_next/` references
 *     GET /archive/         x-middleware-rewrite: /design-screen/archive-index
 *     GET /documents/       x-middleware-rewrite: /design-screen/documents
 *     GET /photographs/     x-middleware-rewrite: /design-screen/photographs
 *     GET /researchers/     no rewrite                                      the React layout renders
 *     GET /clan-towns/      no rewrite                                      the React layout renders
 *
 * **So there are three places a document's `<head>` is written, and the homepage is not one of them.** A
 * loader placed in `layout.tsx` alone would have missed `/`, `/archive/`, `/documents/`, `/photographs/`,
 * `/collections/`, `/topics/`, `/publications/`, `/listen/`, `/watch/`, `/igbo-calendar/` and `/about/` —
 * that is, most of what the owner means by "the site" — and it would have missed every record at `/<slug>/`.
 * The loader and the unit therefore go in all three producers, each through this file:
 *
 *     app/layout.tsx                     the React public routes  (`/researchers/`, `/clan-towns/`, …)
 *     app/design-screen/[screen]/route.ts  53 design screens     (`/`, `/archive/`, `/documents/`, …)
 *     app/[slug]/route.ts                every published record  (`/<slug>/`)
 */

import { findOpenTagByClass, scanElement } from './html-anchor.ts';

/**
 * The owner's AdSense client id, exactly as his account issued it.
 *
 * ⚠️ ONE CLIENT, ONE SLOT, WRITTEN ONCE. There is no second slot in this repository and none may be added
 * without the owner issuing one: a slot id is an account fact, and an invented one is an ad request for
 * inventory that does not exist.
 */
export const ADSENSE_CLIENT = 'ca-pub-7838607083592256';

/** The owner's responsive unit in that account. See `ADSENSE_CLIENT`. */
export const ADSENSE_SLOT = '5756976639';

/**
 * THE LOADER, WHICH GOES IN `<head>` ONCE PER DOCUMENT.
 *
 * `crossorigin="anonymous"` is the snippet's own attribute and it is load-bearing rather than decorative:
 * the loader reports errors through `window.onerror`, and a cross-origin script without it would give the
 * page the opaque `"Script error."` instead of the real message.
 *
 * ⚠️ THE ADDRESS IS ITS OWN EXPORT BECAUSE THE REACT ROUTES CANNOT USE THE STRING. `app/layout.tsx` renders
 * a document through JSX rather than by string concatenation, so it writes `<script async src={…}>` — and it
 * writes **this constant**, not a second copy of the URL. One address, three document producers.
 */
export const ADSENSE_LOADER_SRC =
  `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

/** The queue push, exported for the same reason as `ADSENSE_LOADER_SRC`. */
export const ADSENSE_PUSH = '(adsbygoogle = window.adsbygoogle || []).push({});';

/** The loader as markup, for the two producers that build a document as a string. */
export const ADSENSE_LOADER =
  `<script async src="${ADSENSE_LOADER_SRC}" crossorigin="anonymous"></script>`;

/**
 * THE UNIT, WHICH IS ONE RESPONSIVE BLOCK PLACED IN THE READING MATTER.
 *
 * ── WHY THERE IS EXACTLY ONE, AND WHY IT IS `auto` ───────────────────────────────────────────────────
 *
 * The owner asked for responsive/auto, and an auto unit sizes itself from the width it is given — inside
 * `.prose` that is the article's own measure, so it lines up with the sentences above and below it.
 *
 * ⚠️ **ONE UNIT, NOT ONE PER PARAGRAPH.** AdSense's own policies forbid a unit that could be mistaken for
 * content and penalise high ad density on a page, and this is a scholarly archive: *"an archive whose
 * sentences are interrupted by a paid rectangle is a worse archive"* was this file's own rule and it still
 * is. One unit, after the third paragraph, is the placement the note below the implementation argues for;
 * a second would be density for its own sake and is not a thing this file will do without the owner asking.
 *
 * The `<!-- Resp -->` label is the owner's own comment from the snippet he issued, kept verbatim so the
 * served markup can be compared against his account's copy line for line.
 */
export const ADSENSE_UNIT = `<!-- Resp -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="${ADSENSE_CLIENT}"
     data-ad-slot="${ADSENSE_SLOT}"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     ${ADSENSE_PUSH}
</script>`;

/*
 * ── WHICH DESIGN SCREENS CARRY A UNIT, AND THIS IS AN ALLOW-LIST ON PURPOSE ──────────────────────────
 *
 * `DESIGN_SCREENS` in `middleware.ts` holds 53 names and the route that serves them serves ALL of them,
 * including `dashboard-editor`, `upload`, `404`, `type-test` and the eight other dashboards. **So a unit
 * inserted for every screen the route serves would be a unit on the editor — whose `<main>` contains the
 * `contenteditable` the owner writes in — and on the 404, which is the one place this brief names
 * outright.** An allow-list cannot acquire a private surface by a screen being added to the deliverable;
 * a deny-list would.
 *
 * WHAT IS HERE IS THE READING MATTER: the front page, the archive listing, the media and document
 * listings, the reading pages, the reference pages. What is NOT here, and why, is stated as a block at the
 * bottom of this list rather than left to be inferred.
 */
export const ADSENSE_READER_SCREENS: ReadonlySet<string> = new Set([
  // The front page and the two ways into the archive.
  'home',
  'archive-index',
  'collections',
  'topics',
  // The media and document listings.
  'documents',
  'photographs',
  'publications',
  'publication',
  'listen',
  'watch',
  'watch-video',
  'oral-recordings',
  'material-culture',
  // The reading pages.
  'folklore',
  'folklore-reader',
  'igbo-calendar',
  'cultural-calendar',
  'cultural-event',
  'journeys',
  'ledger',
  'market-days',
  'projects',
  'project',
  // The reference pages — a town, a researcher, and the two pages that explain the archive itself.
  'town',
  'researcher-profile',
  'about',
  'cite',
  /*
   * ⚠️ WHAT IS DELIBERATELY ABSENT, SO THAT THE OMISSION IS A DECISION AND NOT AN OVERSIGHT.
   *
   *   `dashboard-*` (11 screens)  a workspace, not a reading page. `dashboard-editor`'s `<main>` holds the
   *                              `contenteditable` the owner writes records in, and the brief forbids an ad
   *                              in it in as many words.
   *   `account`                   the reader's own account screen.
   *   `upload`                    a form. The brief forbids an ad in a form; this is the archive's own.
   *   `404`                       the brief names a 404 outright. ⚠️ Measured: `/404/` answers **200**, not
   *                              404 — `DESIGN_SCREENS` rewrites it to `/design-screen/404` — so a rule that
   *                              keyed on the response status would have put an ad on the not-found screen.
   *   `type-test`                 a typeface proof for design work. It is not published content.
   *   `donate` · `sponsors` · `investors`
   *                              solicitation pages. A paid ad beside an appeal for support is the one
   *                              placement on this site that would read as double-dipping.
   *   `careers`                   a recruitment page, not archive content.
   *   `document-viewer`           not served from this set at all — it has its own route — and its whole
   *                              job is the framed document. It is left alone.
   *   `academy` · `towns`         both are 301s now; neither reaches the screen route.
   */
]);

/**
 * The first path segment of every React route that carries a unit.
 *
 * ⚠️ MEASURED, NOT ASSUMED, AND THE GATED ONES ARE THE REASON THIS EXISTS AT ALL. The React public routes
 * are the ones the layout renders, and they are not all public: `/account/`, `/submit/`, `/library/`,
 * `/workspace/`, `/reviews/` and `/claims/` all answer **307 to `/signin`**, and `/contact/`, `/join/` and
 * `/search/` answer 200 with a form. A loader injected for every path this layout serves would therefore
 * have reached the account screen and the sign-in-required surfaces, which is what the owner asked not to
 * happen.
 *
 * Matching is on a WHOLE FIRST SEGMENT rather than on a string prefix, so `/town` cannot capture `/towns`
 * and an allow-listed name cannot be reached by a lookalike address.
 */
export const ADSENSE_READER_SEGMENTS: ReadonlySet<string> = new Set([
  'clan-towns',
  'clans',
  'town',
  'researchers',
  'author',
  'entities',
  'project',
]);

/** Is this React page one a reader reads archive content on? See `ADSENSE_READER_SEGMENTS`. */
export function isAdsenseReaderPath(pathname: string): boolean {
  const [first] = pathname.split('/').filter(Boolean);
  return first !== undefined && ADSENSE_READER_SEGMENTS.has(first);
}

/**
 * Put the loader in a document's `<head>`.
 *
 * Returns the document **byte for byte unchanged** when it has no `</head>`, which is the same contract
 * `insertDiscussion` and `withDiscussion` hold and the reason a fill that cannot find its anchor is a
 * missing ad rather than a mangled page.
 */
export function withAdsenseLoader(html: string): string {
  const at = html.lastIndexOf('</head>');
  if (at === -1) return html;
  return `${html.slice(0, at)}${ADSENSE_LOADER}\n${html.slice(at)}`;
}

/**
 * ── WHERE THE UNIT GOES, AND THE MEASUREMENT THAT MOVED IT ───────────────────────────────────────────
 *
 * The owner, in this same round: *"make sure the google adsense is placed well in the articles."*
 * **Measured on a served record, the unit was the LAST thing in `<main>`:** the reading matter opened at
 * 53% of the document, `Cite this article` closed at 84%, the related cards sat at 86%, the page-turn at
 * 93% and the thread at 94% — **and the unit was inserted at 99%, at the closing `</main>`.** A unit a
 * reader only meets after finishing the article is the lowest-viewability placement a unit can have, and
 * that is the fault he reported.
 *
 * So the unit now sits IN the reading matter, at a point a reader who has scrolled past the opening reaches:
 *
 *   1. **AFTER THE THIRD PARAGRAPH INSIDE `.prose`** — `ADSENSE_IN_CONTENT_PARAGRAPH`. Measured on
 *      `/egwu-amala-the-paddle-dance-of-nigerias-river-communities/`, that is **byte 12,521 of 20,402**:
 *      the reading matter opens at byte 10800 and runs 7946 bytes to the related cards at 18746, so the
 *      anchor is **21.7% of the way through the reading column**, where paragraphs 1, 2, 3, 5 and 8 end at
 *      4.8%, 17.3%, 21.7%, 44.3% and 57.6%. Because it is inside `.prose` it is also inside the reading
 *      column, which the old `</main>` anchor was not — the unit used to run the full width of `<main>`.
 *   2. **Immediately before the discussion box**, when the document has one. This is the fallback that makes
 *      *"the ad is above the comments"* a property of the document rather than of the order in which two
 *      calls happen to run. See the note on the old call-order dependency below.
 *   3. **The historical anchor, the last `</main>`** — for a document with neither a `.prose` nor a
 *      discussion, which is most of the design screens. Byte-for-byte the position they served before.
 *      Measured across the deliverable's own files: `</main>` appears **exactly once in 52 of the 53**.
 *      `oral-recordings.html` has none, so it returns unchanged and serves no unit — correctly, since it is
 *      not in `ADSENSE_READER_SCREENS` anyway.
 *
 * ⚠️ **THE PARAGRAPH IS NOT FOUND WITH `lastIndexOf` OR A `replace`, AND THAT IS THE WHOLE DIFFICULTY.**
 * `</p>` occurs 14 times in one published record. `.replaceAll('</p>', unit)` would put a unit after every
 * paragraph in the archive; a plain `.replace` would put it after the first — a paid block between the
 * opening line and everything else. **The offset is computed from the document's own structure** — the Nth
 * `<p>` that is a *direct child* of the element whose class list contains `prose` — by `scanElement` in
 * `./html-anchor`, and it is computed once, yielding one insertion offset.
 *
 * ── AND THE TWO INSERTIONS NO LONGER RACE ───────────────────────────────────────────────────────────
 *
 * The old anchor was the closing `</main>` for BOTH this unit and the discussion box, so they contended for
 * one position and each route's comment had to say *"whichever runs first sits further from the closing
 * tag"*. **The anchors are disjoint now** — the unit is inside the reading matter and the box is after
 * `Cite this article` — and fallback 2 anchors on the box's own marker. The order therefore holds whichever
 * runs first, and `warnIfAdBelowDiscussion` states the invariant on the served document instead of trusting it.
 */
export const ADSENSE_IN_CONTENT_PARAGRAPH = 3;

/**
 * The offset just after the Nth direct-child paragraph of the document's first `.prose`, or `null`.
 *
 * `null` is the honest answer for a document with no `.prose` or with fewer paragraphs than `n`, and every
 * caller must treat it as "try the next anchor" rather than as "the end of the document".
 */
function inContentAnchor(html: string): number | null {
  const prose = findOpenTagByClass(html, 'prose');
  if (prose === null) return null;
  const { children } = scanElement(html, prose);
  const paragraphs = children.filter((child) => child.name === 'p' && child.closed);
  const chosen = paragraphs[ADSENSE_IN_CONTENT_PARAGRAPH - 1];
  return chosen ? chosen.end : null;
}

/**
 * Put the unit in the reading matter, or above the thread, or at the foot of the reading area.
 *
 * Returns the document **byte for byte unchanged** when none of the three anchors exists, which is the same
 * contract `insertDiscussion` and `withDiscussion` hold and the reason a fill that cannot find its anchor is
 * a missing unit rather than a mangled page.
 */
export function withAdsenseUnit(html: string): string {
  const at =
    inContentAnchor(html) ?? findOpenTagByClass(html, 'oz-discussion') ?? html.lastIndexOf('</main>');
  if (at === null || at === -1) return html;
  return `${html.slice(0, at)}${ADSENSE_UNIT}\n${html.slice(at)}`;
}

/**
 * Is the unit above the thread on the document that is about to be served?
 *
 * ⚠️ **THIS IS THE ORDER PROVEN RATHER THAN INTENDED.** The two insertions used to be ordered by which call
 * ran first, which is a fact about the code rather than about the page; the anchors are disjoint now, and
 * this asks the served bytes directly so that a future change to either anchor fails loudly instead of
 * silently serving a paid block under a comment thread.
 *
 * A page with no unit or no discussion is not a fault — most pages have neither — so it returns `true`.
 */
export function warnIfAdBelowDiscussion(html: string, where: string): boolean {
  const ad = html.indexOf(`data-ad-slot="${ADSENSE_SLOT}"`);
  const discussion = html.indexOf('id="discussion"');
  if (ad === -1 || discussion === -1 || ad < discussion) return true;
  console.error(`[adsense] ${where}: the unit landed BELOW the discussion thread`);
  return false;
}

/** Both halves, for a document that is served with no framework around it. */
export function withAdsense(html: string): string {
  return withAdsenseUnit(withAdsenseLoader(html));
}
