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
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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
  ]);
  const segments = pathname.split('/').filter(Boolean);
  if (!isApi && segments.length === 2 && !KNOWN_FIRST_SEGMENTS.has(segments[0] ?? '')) {
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|woff2?|xml|txt)$).*)'],
};
