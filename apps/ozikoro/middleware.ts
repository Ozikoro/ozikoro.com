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
