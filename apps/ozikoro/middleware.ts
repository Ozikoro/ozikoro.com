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
  "towns",
  "type-test",
  "upload",
  "watch",
  "watch-video"
]);

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The deliverable's stylesheets, which its relative links request as `/styles/…`, rewritten to where the
  // files live. The matcher is widened below so that `.css` under `/styles/` reaches here.
  if (pathname.startsWith('/styles/')) {
    return NextResponse.rewrite(new URL(`/design/styles/${pathname.slice('/styles/'.length)}`, request.url));
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

  // A design screen at the address a reader would type, and the walkthrough at `/index`.
  const single = pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
  if (single && !single.includes('/')) {
    if (DESIGN_SCREENS.has(single)) {
      // Through the fill route, which reads the design file as a template and passes any screen it
      // does not fill straight back byte-for-byte. See app/design-screen/[screen]/route.ts.
      //
      // NOT a `_`-prefixed folder: Next.js treats those as private and generates no route at all, which
      // is what broke this the first time.
      return NextResponse.rewrite(new URL(`/design-screen/${single}`, request.url));
    }
    if (single === 'index' || single === 'design') {
      return NextResponse.rewrite(new URL('/design/index.html', request.url));
    }
  }

  const headers = new Headers(request.headers);
  headers.set('x-pathname', pathname);
  headers.set('x-host', request.headers.get('host') ?? '');

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
  // `css` is deliberately NOT in the extension skip: the deliverable's relative links ask for its
  // stylesheets as `/styles/…`, and a `.css` exclusion would swallow them before the middleware could
  // rewrite them. Every other static extension is still skipped, and the middleware passes non-`/styles/`
  // requests straight through, so the cost is one comparison.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|styles/|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|js|woff2?|xml|txt)$).*)'],
};
