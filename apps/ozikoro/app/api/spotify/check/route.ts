/**
 * POST /api/spotify/check — prove the connection still works.
 *
 * This is what gives "last successful check" a meaning. A stored row says the tokens were once
 * issued; a check renews the access token if it needs it and then reads the account from
 * Spotify, so a connection that has been revoked at Spotify's end is discovered here, by an
 * administrator pressing a button, rather than later by a podcast failing to publish.
 *
 * It is also the endpoint that exercises the refresh path in ordinary use, which is worth
 * having: token renewal that only ever runs unattended is token renewal nobody has seen work.
 */
import { getDb } from '@ozituma/db/client';
import { SpotifyError, sanitiseSpotifyMessage, checkSpotifyConnection } from '@ozikoro/platform';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { jsonError, redirectTo, requireAdministrator, sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ten checks per five minutes, per address.
 *
 * A check is a real call to Spotify, so this one is about being a good citizen with somebody
 * else's rate limits as much as about protecting this server.
 */
const LIMIT = { limit: 10, windowSeconds: 300 };

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return jsonError(403, 'forbidden', 'That request did not come from this site.');
  }

  const limited = rateLimit(`spotify-check:${clientKey(request)}`, LIMIT);
  if (!limited.allowed) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/admin/spotify?error=${encodeURIComponent('Too many checks. Try again shortly.')}`,
        'Retry-After': String(limited.retryAfterSeconds),
      },
    });
  }

  const guard = await requireAdministrator({ returnTo: '/admin/spotify' });
  if (!guard.ok) return guard.response;

  try {
    const db = await getDb();
    const profile = await checkSpotifyConnection(db);
    return redirectTo('/admin/spotify', {
      checked: '1',
      ...(profile.displayName ? { as: profile.displayName } : {}),
    });
  } catch (error) {
    if (error instanceof SpotifyError) {
      // The message is already sanitised at the boundary in the db layer, and is written for
      // an administrator: "Reconnect Spotify" rather than an OAuth error code.
      if (error.code !== 'not_connected') {
        console.error('[spotify/check]', error.code, sanitiseSpotifyMessage(error.message));
      }
      return redirectTo('/admin/spotify', { error: error.message });
    }
    console.error('[spotify/check]', sanitiseSpotifyMessage(error));
    return redirectTo('/admin/spotify', { error: 'The connection could not be checked.' });
  }
}
