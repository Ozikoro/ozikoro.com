import { NextResponse, type NextRequest } from 'next/server';

/**
 * Tell the layout which path it is rendering.
 *
 * A Next.js layout cannot ask for the current path, and the admin must not be wrapped in the
 * website's own header and footer — it has its own bar and its own menu, and stacking one inside
 * the other is what made the admin look spoilt. So the path is passed down as a request header and
 * the root layout reads it.
 *
 * The matcher skips static assets, which have no chrome to decide about and would only be slowed
 * down by passing through here.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  headers.set('x-host', request.headers.get('host') ?? '');

  /*
   * Whether this request is a page a person is reading, as opposed to the machinery around one.
   *
   * Only an HTML GET counts. A prefetch is the router warming a link the reader has not clicked,
   * an RSC request is a fragment of a page already counted, and neither is somebody reading.
   * Counting them would inflate every number on the analytics page.
   */
  const accept = request.headers.get('accept') ?? '';
  const prefetch =
    request.headers.get('next-router-prefetch') !== null ||
    request.headers.get('purpose') === 'prefetch' ||
    (request.headers.get('sec-purpose') ?? '').includes('prefetch');
  const countable = request.method === 'GET' && accept.includes('text/html') && !prefetch;
  headers.set('x-count', countable ? '1' : '0');

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|woff2?)$).*)'],
};
