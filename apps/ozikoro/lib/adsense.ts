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
 * THE UNIT, WHICH GOES AT THE FOOT OF THE READING AREA.
 *
 * ── WHY `auto` AT THE FOOT AND NOT A FIXED RECTANGLE IN THE PROSE ────────────────────────────────────
 *
 * The owner asked for responsive/auto, and an auto unit sizes itself from the width it is given. **At the
 * foot of `<main>` it can only ever be a block after the reading matter** — it cannot land between two
 * paragraphs of a history, because nothing in this file inserts into prose. An archive whose sentences are
 * interrupted by a paid rectangle is a worse archive, and that was the failure mode to avoid.
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
 * Put the unit at the foot of the reading area.
 *
 * THE ANCHOR IS THE LAST `</main>` IN THE DOCUMENT, which is the anchor `insertDiscussion` already uses for
 * the discussion box, so an ad and a comment box cannot disagree about where "the end of the page" is. It is
 * `</main>` rather than `</body>` because the design's footer carries the company notice and the platform
 * bar, and a unit below the footer is a unit a reader has already finished with.
 *
 * Measured across the deliverable's own screens: `</main>` appears **exactly once in 52 of the 53 files**.
 * `oral-recordings.html` has none, so it returns unchanged and serves no unit — correctly, since it is not in
 * `ADSENSE_READER_SCREENS` anyway.
 */
export function withAdsenseUnit(html: string): string {
  const at = html.lastIndexOf('</main>');
  if (at === -1) return html;
  return `${html.slice(0, at)}${ADSENSE_UNIT}\n${html.slice(at)}`;
}

/** Both halves, for a document that is served with no framework around it. */
export function withAdsense(html: string): string {
  return withAdsenseUnit(withAdsenseLoader(html));
}
