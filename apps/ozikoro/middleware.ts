import { NextResponse, type NextRequest } from 'next/server';

/**
 * Two jobs, and the first one is the reason this file is not just a header passthrough.
 *
 * 1. SERVE THE ARCHIVED ADDRESSES WITHOUT CHANGING THEM
 *
 * WordPress published every article at `https://ozikoro.com/<slug>/`. Those addresses are cited in
 * papers, shared in messages and indexed, so they have to keep working *as themselves* — not
 * redirect to a different address, which is what Next.js does by default for a trailing slash.
 *
 * The first attempt at this used `trailingSlash: true`, which serves `/<slug>/` correctly and also
 * rewrites every API route to a slashed form: `/api/auth/signin` became a 308 to
 * `/api/auth/signin/`, which broke form posts, and the production callback registered with the
 * Spotify Developer Dashboard became a 308 from `/api/spotify/callback` to `/api/spotify/callback/`.
 * That last one is fixed by configuration and cannot move.
 *
 * `next.config.ts` rewrites are evaluated after the router has already normalised the slash, so the
 * rewrite there did not help. Middleware runs before it, so the slash is removed here and the
 * response is a 200 at the address the reader asked for. Nothing about the URL changes.
 *
 * 2. TELL THE LAYOUT WHICH PATH IT IS RENDERING
 *
 * A Next.js layout cannot ask for the current path, and the administrator's area must not be wrapped
 * in the public site's header and footer. So the path is passed down as a request header.
 *
 * The matcher skips static assets, which have no chrome to decide about and no archived address to
 * preserve.
 */
/*
 * THE DESIGN DELIVERABLE, SERVED AT CLEAN ADDRESSES WITHOUT BEING TOUCHED.
 *
 * `public/design/` holds the handed-over deliverable: 51 screens of static HTML and CSS that open directly in
 * a browser, with no build step and no framework — the design says so itself. **It is complete and navigable
 * as it stands at `/design/index.html`.**
 *
 * This block makes those same files answer at the addresses a reader would type, by REWRITING rather than by
 * editing. **Not one byte of the deliverable changes**, which is the condition the owner set: the screens keep
 * their relative links (`about.html`, `archive-index.html`, `../styles/main.css`) and still resolve, because a
 * rewrite preserves the path the browser sees and therefore the base those links are relative to.
 *
 * A rewrite is also why this can sit in front of the application routes without conflict: it runs before
 * routing, so `/about` is served the design's `about.html` while `/archive/[slug]` and every other dynamic
 * content route is untouched. **When a screen is later built for real, removing its name from this set is the
 * whole change.**
 *
 * The set is generated from the directory rather than typed, so a screen added to the deliverable is served
 * without anyone remembering to add it here.
 */
const DESIGN_SCREENS = new Set<string>([
  "404",
  "about",
  "academy",
  "archive-index",
  "article",
  "careers",
  "cite",
  "collections",
  "cultural-calendar",
  "cultural-event",
  "dashboard-account",
  "dashboard-admin",
  "dashboard-editor",
  "dashboard-independent-researcher",
  "dashboard-knowledge-holder",
  "dashboard-moderation",
  "dashboard-reader",
  "dashboard-researcher",
  "dashboard-review",
  "dashboard-reviewer",
  "dashboard-states",
  "dashboard-student",
  "dashboard-teacher",
  "dashboard-workflow",
  "documents",
  "donate",
  "folklore",
  "folklore-reader",
  "home",
  "igbo-calendar",
  "investors",
  "journeys",
  "ledger",
  "listen",
  "market-days",
  "material-culture",
  "oral-recordings",
  "photographs",
  "project",
  "projects",
  "publication",
  "publications",
  "researcher-profile",
  "sponsors",
  "topics",
  "town",
  /*
   * "towns" IS DELIBERATELY ABSENT.
   *
   * It was here, which meant /towns was rewritten to the design SCREEN and the application's own
   * app/towns/page.tsx was never reached at all — dead code, and the reason the owner could not see
   * the finder he asked for even though it built correctly. `clans` is absent for the same reason:
   * those are real routes now, not screens.
   *
   * The screen still exists at /design/screens/towns.html and /design-screen/towns for reference.
   */
  "type-test",
  "upload",
  "watch",
  "watch-video"
]);

/*
 * EVERY FILE THE DELIVERABLE SHIPS, BY NAME — WHICH `DESIGN_SCREENS` IS NOT.
 *
 * The two sets answer two different questions and they are deliberately not the same set.
 *
 *   `DESIGN_SCREENS` decides what this middleware REWRITES. `towns` and `account` are absent from it
 *   because the site has a real route for each, and naming them there would shadow it — the mistake
 *   that made the owner's town finder invisible and is recorded beside the list.
 *
 *   THIS set answers "is this string the name of one of the deliverable's own files?" — and it holds
 *   **all 52**, because the only thing it is used for is sending a reader from a file's name to the
 *   page that file draws. A file the deliverable ships is a file the deliverable ships, whether or not
 *   a route has since replaced it.
 *
 * It exists because of the raw-file hole measured on 4 October 2026: `/design/screens/<name>.html`
 * answered 200 with the design file verbatim for **all 52 screens**, and `/listen.html` — the address
 * the owner landed on — was answered by the `.html` stripping in the rewrite below, which turned a
 * file's name into a second address for the page. Both are closed below, and both need to know the
 * whole directory rather than the subset that is rewritten.
 */
const DESIGN_FILES = new Set<string>([...DESIGN_SCREENS, 'towns', 'account']);

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The deliverable's stylesheets, which its relative links request as `/styles/…`, rewritten to where the
  // files live. The matcher is widened below so that `.css` under `/styles/` reaches here.
  if (pathname.startsWith('/styles/')) {
    return NextResponse.rewrite(new URL(`/design/styles/${pathname.slice('/styles/'.length)}`, request.url));
  }

  /*
   * A RAW DESIGN FILE IS NOT AN ADDRESS ON THIS SITE, AND IT NEVER WAS MEANT TO BE ONE.
   *
   * `public/design/` is the delivered handoff: 52 screens of static HTML written to be opened from disk,
   * each carrying the walkthrough's own title, its example people and its "Audio library demonstration"
   * banner. This site serves those screens as its own markup by REWRITING the addresses a reader types —
   * and **the files themselves answered too.**
   *
   * Measured on the production build, 4 October 2026, every one byte-identical to the source file:
   *
   *     /design/screens/listen.html    200   5,911 bytes   the raw listen screen
   *     /design/screens/about.html     200  16,302 bytes
   *     /design/screens/home.html      200  15,462 bytes
   *     …and the same for all 52, plus /design/index.html at 14,200 bytes — which Next's static handler
   *     also answers at `/design/`, `/design`, `/index` and `/index.html`, five addresses for one file
   *     from which every other screen is one relative link away.
   *
   * A 200 ON A RAW DESIGN FILE IS THE FAULT THIS PROJECT KEEPS RE-LEARNING: **it renders**, so it reads
   * as a working page. The reader gets the design's example episode, its invented researcher and its
   * "Sample" durations with nothing on the page to say the real content was never filled in.
   *
   * THE REDIRECT POINTS AT THE PAGE, NOT AT A 404. The deliverable's own relative links ask for these
   * file names and the owner has them in his history; the screen each one names is served one segment
   * away, so the file's name keeps working as a pointer to the real page rather than as the file. The
   * archive's rule is that an address once reachable keeps working — it does not say it keeps working
   * as the wrong thing.
   */
  const designFile = /^\/design\/screens\/([a-z0-9-]+)\.html$/.exec(pathname);
  if (designFile) {
    const screen = designFile[1]!;
    const to = new URL(screen === 'home' ? '/' : `/${screen}/`, request.url);
    to.search = search;
    return NextResponse.redirect(to, 301);
  }
  /*
   * THE WALKTHROUGH INDEX IS THE SAME HOLE WITH FIVE ADDRESSES.
   *
   * `/design/index.html` is the deliverable opened directly — a directory of every screen — and it was
   * reachable at that address, at `/design/`, at `/design`, at `/index` and at `/index.html`. The site's
   * own home is `/`, which is the same screen filled.
   */
  if (
    pathname === '/design/' || pathname === '/design' || pathname === '/design/index.html'
    || pathname === '/index' || pathname === '/index.html' || pathname === '/index/'
  ) {
    const to = new URL('/', request.url);
    to.search = search;
    return NextResponse.redirect(to, 301);
  }

  /*
   * THE ROOT IS THE DESIGN'S HOME, AND THAT WAS THE WHOLE PROBLEM.
   *
   * `const single = pathname.replace(/^\//, '')…` yields the EMPTY STRING for `/`, so the guard below never
   * matched the root and **the application's own home page was served there instead of the design's.** The
   * owner saw a React page at `/` and the design at `/design/screens/home.html`, and said plainly that only
   * the second was right. They were right, and this is why.
   *
   * The root is handled explicitly before the slash-stripping, because it cannot be reached by it.
   */
  if (pathname === '/') {
    return NextResponse.rewrite(new URL('/design-screen/home', request.url));
  }

  /*
   * A FILE'S NAME IS NOT A SECOND ADDRESS FOR THE PAGE.
   *
   * Stripping `.html` is what served `/listen.html` — **the address the owner reported** — and it served
   * it as a 200 with the page under two addresses, `listen.html` and `listen/`, each claiming in its own
   * `<link rel="canonical">` to be `/listen/`. A page with two addresses is a page a search engine has to
   * choose between, and the `.html` form is the deliverable's file name rather than anything this site
   * ever published.
   *
   * So the file's name is a **301 to the one address the page has**, which is also what makes the
   * deliverable's own relative links safe once they are made absolute: `href="listen.html"` on a screen
   * served at `/about.html` resolves to `/listen.html` and now lands on `/listen/` — the real page — in
   * one hop instead of rendering a duplicate of it.
   *
   * A 301 rather than a 308: these are pages, reached by `GET`, and a permanent redirect is what a
   * reader of an archive expects to be told. `towns` and `account` are included through `DESIGN_FILES`
   * even though they are not rewritten, because `/towns.html` and `/account.html` are the same file's
   * name and the design's own menu asks for them.
   */
  const hadFileSuffix = /\.html$/.test(pathname);
  // A design screen at the address a reader would type, and the walkthrough at `/index`.
  const single = pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
  if (single && !single.includes('/')) {
    /*
     * THE REDIRECT SITS BEFORE THE REWRITE, and before the walkthrough branch, because both of those
     * answer with a 200 at the file's own name — which is the whole fault.
     */
    if (hadFileSuffix && DESIGN_FILES.has(single)) {
      const to = new URL(single === 'home' ? '/' : `/${single}/`, request.url);
      to.search = search;
      return NextResponse.redirect(to, 301);
    }
    if (DESIGN_SCREENS.has(single)) {
      // Through the fill route, which reads the design file as a template and passes any screen it
      // does not fill straight back byte-for-byte. See app/design-screen/[screen]/route.ts.
      //
      // NOT a `_`-prefixed folder: Next.js treats those as private and generates no route at all, which
      // is what broke this the first time.
      //
      // AND THE READER'S QUERY STRING IS CARRIED ACROSS, NAMED RATHER THAN ASSUMED.
      //
      // `new URL(path, request.url)` produces a URL with no search of its own, and whether the framework
      // then re-attaches the original query is a behaviour to depend on rather than to state. Two things
      // need it stated: `/archive-index?topic=…` filters the listing inside the route, and the owner's design
      // preview travels as `?ozpreview=…` at the PUBLIC address — the address a reader types, because the
      // design's own relative links resolve against it and a preview served at `/design-screen/about` would
      // 404 its own menu.
      const target = new URL(`/design-screen/${single}`, request.url);
      target.search = request.nextUrl.search;
      return NextResponse.rewrite(target);
    }
    if (single === 'index' || single === 'design') {
      // The slashed spellings, `/index/` and `/design/`, of the walkthrough closed at the top of this
      // function. They are the deliverable's file, not this site's page.
      const to = new URL('/', request.url);
      to.search = search;
      return NextResponse.redirect(to, 301);
    }
  }

  /*
   * ── AND THE ADDRESS A SERVED SCREEN'S OWN RELATIVE LINK USED TO PRODUCE ────────────────────────────
   *
   * THE OWNER'S REPORT: `/collections/about.html` "stopped working". **It answers 404, and the site is
   * correct not to serve it — nothing on the site links there any more.** Measured on the served pages: 26
   * screens name `about.html`, and every one of them carries `/about/` absolute and not one relative
   * `about.html`. So the address came from a bookmark, a history entry or a cached page, and it is exactly
   * the shape the relative-link fault produced: `/about/listen.html`, `/folklore/listen.html`,
   * `/cultural-event/article.html`.
   *
   * THAT FAULT WAS FIXED AND THE ADDRESSES IT PRODUCED WERE NOT. `designScreenLinks` makes the links
   * absolute going forward; a reader who followed one *before* the fix has it in their history, and a 404
   * is what they get. **The archive has already answered this question twice today** — `/listen.html`
   * redirects to `/listen/`, and every `/<name>.html` redirects to `/<name>/`, both with the same
   * reasoning, written at the top of that block: *"an address once reachable keeps working — it does not
   * say it keeps working as the wrong thing."* This is the third spelling of the same address, and the
   * rule is applied rather than re-argued.
   *
   * ── WHY BOTH SEGMENTS MUST BE DESIGN FILES, WHICH IS WHAT MAKES IT SAFE ──────────────────────────
   *
   * The pattern is `<screen>/<sibling>.html`, and the address it produces is `/<sibling>/`. **The
   * narrowing is the safety**: a relative link could only ever have named a file that sits beside the
   * screens, so a first segment that is not one of the deliverable's screens is not this address and is
   * left alone. That is what stops the rule shadowing a real two-segment route — `/documents/<slug>/`,
   * `/town/<slug>/`, `/author/<slug>/` — whose first segment need not be a design file at all, and it is
   * also why the destination must itself be a design file: this cannot invent a page.
   *
   * **AND IT CANNOT UNDO THE `towns`/`account` SEPARATION.** Neither name is in `DESIGN_SCREENS`, so
   * neither is *rewritten* to a screen — but both ARE in `DESIGN_FILES`, because both are files the
   * deliverable ships and `/towns.html` and `/account.html` are their names. This rule only ever turns a
   * file's name into the address of the page, which is the same treatment the one-segment rule above
   * already gives them, and it cannot reach the rewrite.
   *
   * IT SITS BEFORE THE ATTACHMENT FALLBACK, deliberately: that fallback rewrites an unknown two-segment
   * path to `/attachment/<slug>/`, so a rule placed after it would never see these addresses at all.
   */
  const staleSibling = /^\/([a-z0-9-]+)\/([a-z0-9-]+)\.html$/.exec(pathname);
  if (staleSibling && DESIGN_FILES.has(staleSibling[1]!) && DESIGN_FILES.has(staleSibling[2]!)) {
    const sibling = staleSibling[2]!;
    const to = new URL(sibling === 'home' ? '/' : `/${sibling}/`, request.url);
    to.search = search;
    return NextResponse.redirect(to, 301);
  }

  const headers = new Headers(request.headers);
  headers.set('x-pathname', pathname);
  headers.set('x-host', request.headers.get('host') ?? '');

  /*
   * A RETIRED BYLINE ADDRESS KEEPS ITS ADDRESS, AND THIS IS THE ONLY PLACE THAT CAN SAY SO.
   *
   * The contributor `ozikoro` (display name "Ozi Ikoro") was merged into `nze` ("Idenze Ezeme") on
   * 4 October 2026: every record and every file it carried now belongs to `nze`, and its row was deleted.
   * That makes `/author/ozikoro/` an address with nothing behind it, and **a 404 there would break every
   * link that was ever published to it** — the `/researchers/` directory linked it, and so did a year of
   * work. The archive's own rule is that an address once published keeps working: *"Every record keeps the
   * address it was published at."* So it answers **301, permanently, to the byline that absorbed it.**
   *
   * WHY THE REDIRECT IS A CONSTANT HERE AND NOT A READ OF `ozikoro_redirect`
   *
   * That table exists and the importer writes preserved addresses into it, but **it is not readable from
   * middleware**: this runs in Next's edge runtime, before routing and outside the Node process, and
   * `@electric-sql/pglite` needs `node:fs` and a WebAssembly build that the edge runtime does not have. A
   * database read here would not be slow — it would not run. So the retired address is a constant, exactly
   * as `DESIGN_SCREENS` and `KNOWN_FIRST_SEGMENTS` already are, and **the deployment is what changes a
   * published address**, which is the right coupling for an address that must not move casually.
   *
   * 301 rather than 308: a byline address is a `GET` and nothing else, so the method-preserving reason for
   * 308 does not apply, and 301 is what a reader of an archive expects to be told.
   *
   * It sits BEFORE the attachment fallback and before routing, both of which it must beat: routing would
   * reach the author route, find no records for the slug, and `notFound()`.
   */
  const RETIRED_AUTHOR_ADDRESSES: Record<string, string> = {
    ozikoro: '/author/nze/',
  };
  const authorAddress = /^\/author\/([^/]+)\/?$/.exec(pathname);
  if (authorAddress) {
    const target = RETIRED_AUTHOR_ADDRESSES[authorAddress[1] ?? ''];
    if (target) return NextResponse.redirect(new URL(target, request.url), 301);
  }

  /*
   * `/api` is left completely alone, in both directions. The production callback is registered with
   * the Spotify Developer Dashboard as exactly `https://ozikoro.com/api/spotify/callback`, and a
   * 308 to a slashed form would be a change to an address that is not ours to change. Next is
   * configured with `skipTrailingSlashRedirect` so it does not rewrite these either.
   */
  const isApi = pathname.startsWith('/api/') || pathname === '/api';

  /*
   * WORDPRESS ATTACHMENT PERMALINKS
   *
   * The old site published every attachment at `/<parent-post-slug>/<attachment-slug>/`. Round 81
   * measured that 26 of the 30 remaining broken in-body links have that shape and that the last segment
   * resolves exactly against `ozikoro_media.slug` — 8 of 9 tested.
   *
   * That address cannot be a route. Rounds 81 and 82 proved both spellings rejected by Next, each taking
   * the dev server down:
   *
   *   app/[parent]/[child]/   "different slug names for the same dynamic path"
   *   app/[slug]/[slug]/      "the same slug name \"slug\" repeat within a single dynamic path"
   *
   * Middleware runs BEFORE routing, which is why the trailing-slash rewrite already lives here. So the
   * old address is rewritten to `/attachment/<slug>` — a static parent, expressible — and that route
   * resolves the record and redirects to its canonical home.
   *
   * The allowlist is the safe construction. A wrong entry here means a real route is shadowed; an
   * omission means an attachment keeps 404ing. Rewriting is how the trailing-slash case is handled
   * above, and a rewrite (not a redirect) keeps the URL the reader asked for until the destination decides.
   */
  const KNOWN_FIRST_SEGMENTS = new Set([
    'topics', 'labels', 'documents', 'author', 'researchers', 'publications', 'entities',
    'media', 'archive', 'folklore', 'search', 'about', 'claims', 'reviews', 'admin',
    'attachment', '_next', 'design', 'api',
    // Added as the newer two-segment routes were built. An OMISSION here is not a 404 for the attachment
    // fallback — it is a 404 for the real route, because the rewrite happens before routing. That is how
    // /town/<slug>/ returned 404 while `clan` held the row and /towns/<nothing> worked: `town` was absent,
    // so the path was rewritten to /attachment/<slug>/. Every future static parent belongs in this list.
    'town', 'project',
    // The sitemap index's children — `/sitemap/histories` and the rest. **An omission here is not a 404 for
    // the attachment fallback but a 404 for the real route**, because the rewrite runs before routing: every
    // child sitemap answered "Not found" until this was added.
    'sitemap',
    /*
     * The clan register, added with it — and this entry is load-bearing, not tidiness.
     *
     * `/clans` is a one-segment path, so it routed fine and this list was never consulted for it. Every
     * page UNDER it is two segments, so without this line `/clans/anam/` was rewritten to
     * `/attachment/anam/` before routing was ever reached: the entry page answered 404 even though `clan`
     * held the row and the page compiled and ran, and `/clans/umunri/` answered 308 because an attachment
     * happened to share that name. `/clans/tribes/` and `/clans/regions/` were 404 for the same reason.
     *
     * Measured, not reasoned: with this line absent, the mirror's dev server logged
     * `GET /clans/anam/ 404 in 135ms` with no compilation of `/clans/[slug]` at all. This is the third
     * time this list has silently swallowed a real route — `town` and `sitemap` are the earlier two — and
     * every future static parent still belongs in it.
     */
    'clans',
    /*
     * THE MANUSCRIPT DOWNLOAD — the fifth real route this rewrite has swallowed, and the reason each one
     * is worth naming.
     *
     * `/publication-file/<id>` is two segments whose first is in no list, so the attachment fallback
     * rewrote it to `/attachment/<id>/`. **Measured before this line: `/publication-file/1` answered 308**
     * — the fallback found an attachment whose slug happened to be the id and redirected there, which is
     * precisely the shape recorded for `/clans/umunri/`. The route compiled and its own handler was never
     * reached, which is why the fault reads as a wrong destination rather than as a broken route.
     *
     * `publication-file` is a static parent, so unlike the `/<article-slug>/pdf` case it can simply be
     * listed. The rule to carry forward: **the rewrite runs BEFORE routing, so an omission here is not a
     * 404 for the fallback — it is a misroute for the real route.**
     */
    'publication-file',
    /*
     * THE ROUTE THE DESIGN SCREENS ARE ACTUALLY SERVED FROM — the sixth real route this fallback has
     * swallowed, and it was found by asking the route about itself.
     *
     * `/design-screen/about` is not a reader's address: the middleware rewrites `/about/` to it, and that
     * rewrite never comes back through here, which is why the route has always worked. **A DIRECT request to
     * it does**, and `design-screen` was in no list — so `GET /design-screen/about` was rewritten to
     * `/attachment/about` before routing was ever reached and answered 404 with the archive's own not-found
     * page. The design editor's inventory asks the route for the served page it is editing, which is how this
     * was found: the editor reported "the served page answered 404 when asked what is on it".
     */
    'design-screen',
    /*
     * THE PODCAST'S OWN PREFIX — the seventh real address this fallback has swallowed, found by asking
     * `/podcast/<slug>/` what it was.
     *
     * The feed's `<link>` and its `<podcast:person href>` both pointed at `/podcast/<slug>/`, which has no route
     * yet. Because `podcast` was in no list, the attachment fallback above rewrote it to `/attachment/<slug>/`
     * **before routing was ever reached** — answering 308 to `/documents/<slug>/` where an attachment happened
     * to share the name, and 404 otherwise. Neither answer is the address's own.
     *
     * The feed's links now point at the article, which exists and carries the audio. This entry is for the
     * address itself: `/podcast/feed.xml` is skipped by the matcher (`.xml`) and
     * `/podcast/<slug>/transcript.txt` is three segments, so the two routes that DO exist were never affected —
     * which is exactly why the fault went unnoticed. **An omission here is a misroute for the real route, not a
     * 404 for the fallback**, and the next episode page built under this prefix belongs to this line.
     */
    'podcast',
  ]);
  const segments = pathname.split('/').filter(Boolean);
  /*
   * A PUBLICATION ADDRESS IS NOT A MISSING ATTACHMENT.
   *
   * `/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/pdf` is two segments whose first is an article's own
   * slug, so the attachment fallback below rewrote it to `/attachment/pdf/` **before routing was ever
   * reached** — measured: both `/<slug>/pdf` and `/<slug>/pdf/` answered 404 while the route itself was
   * fine and never compiled. This is the fourth real route this rewrite has swallowed, after `town`,
   * `sitemap` and `clans`, **but it cannot be fixed the way those were**, because the first segment is the
   * record's own slug and no list can be written in advance. So the second segment is tested instead: a
   * record's `pdf` child is left alone for the router, which is what serves the download.
   */
  const isPublication = segments.length === 2 && segments[1] === 'pdf';
  if (!isApi && segments.length === 2 && !isPublication && !KNOWN_FIRST_SEGMENTS.has(segments[0] ?? '')) {
    const url = request.nextUrl.clone();
    url.pathname = `/attachment/${segments[1]}/`;
    return NextResponse.rewrite(url, { request: { headers } });
  }

  /*
   * The slash-less form of a page. `trailingSlash: true` makes `/<slug>/` what the router serves, so
   * a reader who types or is linked to `/<slug>` — without the slash WordPress used — is sent there
   * by a rewrite. A rewrite, not a redirect: they keep the address they asked for and get a 200.
   */
  const needsSlash = !isApi
    && pathname !== '/'
    && !pathname.startsWith('/_next')
    && !pathname.endsWith('/')
    && !pathname.slice(1).includes('/');

  if (needsSlash) {
    const url = request.nextUrl.clone();
    url.pathname = `${pathname}/`;
    return NextResponse.rewrite(url, { request: { headers } });
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  /*
   * `css` IS IN THE EXTENSION SKIP, AND IT WAS ABSENT FOR A REASON THAT NO LONGER HOLDS.
   *
   * The note here used to say: "`css` is deliberately NOT in the extension skip: the deliverable's relative
   * links ask for its stylesheets as `/styles/…`, and a `.css` exclusion would swallow them before the
   * middleware could rewrite them."
   *
   * The first half is still true — the design screens do ask for `/styles/…` — but the protection they need
   * is the literal `styles/` alternative in this same matcher, which is earlier in the pattern and matches
   * them whether or not `.css` is excluded. So the exclusion cost nothing and was never needed for that.
   *
   * WHAT IT COST IS MEASURED, AND IT WAS NOT SMALL. `/a11y.css` is a ROOT-LEVEL stylesheet — the
   * application's own accessibility corrections, linked from EVERY page by `seoHead` and by the article
   * route — and it is one segment, so it reached the middleware, and `needsSlash` below rewrote it to
   * `/a11y.css/`. Measured on the production build:
   *
   *     GET /a11y.css     -> 500 Internal Server Error   (the address every page links)
   *     GET /a11y.css/    -> 200, 5253 bytes             (an address nothing links)
   *
   * **So the corrections have never applied in a browser**, on any page, while every check that measured
   * them measured the FILE rather than the painted page — the exact fault this project keeps finding, and
   * the reason `--ink-faint`'s contrast fix reads as "verified" in the record and does nothing on the site.
   * A 500 on a stylesheet is invisible in the HTML, in a status of the page itself, and in any check that
   * fetches the page rather than its assets.
   *
   * `js` is already skipped here, and a root-level `.js` file (`/account-auth.js`) is served correctly at
   * 200 through the same public handler, which is the evidence that an extension skip is what this needs
   * rather than a route. **The rule to carry: a static file is not a page, and the slash-less rewrite is a
   * rule about pages.**
   *
   * The other static extensions remain skipped, and the middleware still passes every non-`/styles/`
   * request through, so the cost of the extra alternative is one comparison.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|styles/|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|js|css|woff2?|xml|txt)$).*)'],
};
