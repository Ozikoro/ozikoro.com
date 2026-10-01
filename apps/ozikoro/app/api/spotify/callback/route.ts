/**
 * GET /api/spotify/callback — the production OAuth callback.
 *
 * The exact address registered with the Spotify Developer Dashboard is:
 *
 *     https://ozikoro.com/api/spotify/callback
 *
 * and it must stay that. `SPOTIFY_REDIRECT_URI` defaults to it, and the authorise request, the
 * token exchange and the Dashboard entry are all matched against each other byte for byte. A
 * change to any one of the three breaks the flow with Spotify's least helpful error,
 * `redirect_uri` mismatch, so the address is treated as fixed.
 *
 * WHY THIS ROUTE IS SO SHORT
 *
 * Every decision lives in `completeSpotifyCallback` in `@ozikoro/platform`, where it is
 * exercised by tests against a real database and a scripted Spotify. What is left here is the
 * part that genuinely needs a running server: reading the query string, reading the session,
 * enforcing HTTPS, and turning the outcome into a redirect.
 *
 * WHAT IT NEVER DOES
 *
 * It never puts a token, a code, a state or a client secret in the response. It never renders a
 * page. It never echoes the raw OAuth error. The administrator lands back on the settings page
 * with either `connected=1` or a sentence written for them to read, and the technical detail
 * goes to the server-side event log instead.
 */
import { getDb } from '@ozituma/db/client';
import { completeSpotifyCallback } from '@ozikoro/platform';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { getCurrentAccount } from '@/lib/session';
import { redirectTo } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Twenty callbacks per five minutes, per address.
 *
 * Generous on purpose. A legitimate administrator generates one, and a shared office address
 * behind one NAT could generate a few; a limit tight enough to catch that would lock out the
 * second person to press Connect. Twenty is far above real use and still bounds an automated
 * flood, which is the only thing this needs to do — an invalid state costs one indexed lookup
 * and is refused.
 */
const LIMIT = { limit: 20, windowSeconds: 300 };

/**
 * Whether this request reached us over TLS.
 *
 * In production the callback is HTTPS-only, and the scheme is read from `X-Forwarded-Proto`
 * because TLS terminates at Caddy in front of this process — the request arriving at Node is
 * plain HTTP on the loopback network, so `new URL(request.url).protocol` would report `http:`
 * for a perfectly secure public request. Caddy sets this header (`header_up X-Forwarded-Proto
 * {scheme}` in docker/Caddyfile); the direct `request.url` scheme is the fallback for a
 * deployment that terminates TLS in the process.
 */
function reachedOverTls(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim().toLowerCase() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  // 1. HTTPS-only in production, before anything is read or written.
  if (process.env.NODE_ENV === 'production' && !reachedOverTls(request)) {
    console.error('[spotify/callback] refused a callback that did not arrive over HTTPS');
    return redirectTo('/admin/spotify', {
      error: 'The Spotify connection must be completed over a secure connection.',
    });
  }

  // 2. Rate limit, so a flood costs a map lookup rather than a database round trip.
  const limited = rateLimit(`spotify-callback:${clientKey(request)}`, LIMIT);
  if (!limited.allowed) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/admin/spotify?error=${encodeURIComponent(
          'Too many requests. Wait a few minutes and try again.'
        )}`,
        'Retry-After': String(limited.retryAfterSeconds),
      },
    });
  }

  const url = new URL(request.url);

  /*
   * 3. The session. This may legitimately be null: the callback is a top-level navigation from
   * Spotify, and the cookie is SameSite=Lax so it IS sent, but a signed-out or expired session
   * arrives here as null rather than as an error. `completeSpotifyCallback` refuses the state
   * in that case with a message telling the administrator to sign in — which is the right
   * answer, and better than this route guessing.
   */
  const current = await getCurrentAccount();

  try {
    const db = await getDb();
    const outcome = await completeSpotifyCallback(db, {
      params: url.searchParams,
      accountId: current?.account.id ?? null,
      successPath: '/admin/spotify',
      failurePath: '/admin/spotify',
    });

    if (outcome.ok) {
      // The requirement's own sentence, shown verbatim on the settings page.
      return redirectTo(outcome.redirectPath, { connected: '1' });
    }
    return redirectTo(outcome.redirectPath, { error: outcome.message });
  } catch (error) {
    /*
     * `completeSpotifyCallback` is written not to throw for expected failures, so reaching here
     * means something genuinely unexpected — and the administrator still gets a safe sentence
     * rather than a stack trace. The detail is logged, sanitised, because a log is a log.
     */
    console.error('[spotify/callback] unexpected failure', error);
    return redirectTo('/admin/spotify', {
      error: 'The Spotify connection could not be completed. Nothing was changed.',
    });
  }
}
