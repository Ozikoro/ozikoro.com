/**
 * POST /api/spotify/connect — begin the Spotify authorisation.
 *
 * A POST rather than a link, because it changes state: it writes a pending authorisation to
 * the database. A GET that did that could be triggered by any image tag on any page, so the
 * form that calls this is a real form with a submit button.
 *
 * What it does NOT do is carry any secret anywhere near the browser. The response is a 303
 * whose Location is Spotify's own authorisation URL, and the only things in that URL are the
 * client id, the redirect URI, the requested scopes, the state and the PKCE challenge. The
 * client secret and the code verifier stay on this server — the verifier is what makes an
 * intercepted authorisation code useless, so it must never travel.
 */
import { getDb } from '@ozituma/db/client';
import { SpotifyError, sanitiseSpotifyMessage, startSpotifyAuthorization } from '@ozikoro/platform';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { jsonError, redirectTo, requireAdministrator, sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Six attempts per five minutes, per address.
 *
 * An administrator connects once, or retries after a mistake. Nobody legitimately starts six
 * authorisations in five minutes, and each accepted request writes a row, so this bounds both
 * the abuse and the table.
 */
const LIMIT = { limit: 6, windowSeconds: 300 };

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return jsonError(403, 'forbidden', 'That request did not come from this site.');
  }

  const limited = rateLimit(`spotify-connect:${clientKey(request)}`, LIMIT);
  if (!limited.allowed) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/admin/spotify?error=${encodeURIComponent(
          'Too many connection attempts. Wait a few minutes and try again.'
        )}`,
        'Retry-After': String(limited.retryAfterSeconds),
      },
    });
  }

  // The role check is first, and nothing below it runs without it.
  const guard = await requireAdministrator({ returnTo: '/admin/spotify' });
  if (!guard.ok) return guard.response;

  try {
    const db = await getDb();
    const started = await startSpotifyAuthorization(db, {
      accountId: guard.account.account.id,
      returnTo: '/admin/spotify',
    });

    // `started.authorizeUrl` is built from constants plus configuration, never from anything
    // the caller supplied, so redirecting to it is not an open redirect.
    return new Response(null, {
      status: 303,
      headers: {
        Location: started.authorizeUrl,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    /*
     * The failure an administrator can actually act on is a configuration one, and its message
     * already names the missing variable or the unusable redirect URI. Anything unexpected is
     * logged sanitised and reported as a generic failure, because an internal error message is
     * not something to put in a URL.
     */
    if (error instanceof SpotifyError) {
      if (error.code !== 'not_configured' && error.code !== 'token_key_missing') {
        console.error('[spotify/connect]', error.code, sanitiseSpotifyMessage(error.message));
      }
      return redirectTo('/admin/spotify', { error: error.message });
    }
    console.error('[spotify/connect]', sanitiseSpotifyMessage(error));
    return redirectTo('/admin/spotify', { error: 'The Spotify connection could not be started.' });
  }
}
