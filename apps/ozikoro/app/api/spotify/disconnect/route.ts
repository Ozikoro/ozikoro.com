/**
 * POST /api/spotify/disconnect — remove Ozikoro's Spotify connection.
 *
 * WHAT THIS ACTUALLY DOES, AND WHAT IT HONESTLY CANNOT
 *
 * It destroys the stored access and refresh tokens. That is the whole of Ozikoro's copy, so
 * the connection is dead from this side immediately and no amount of retrying will produce a
 * working access token afterwards.
 *
 * It does not revoke the grant at Spotify, because Spotify publishes no endpoint that does.
 * It is an open feature request on the Web API tracker
 * (https://github.com/spotify/web-api/issues/600), and the honest response is to say so rather
 * than to call an invented URL and report success. The orphaned grant is inert without a
 * refresh token, and the settings page links the administrator to
 * https://www.spotify.com/account/apps to remove it there as well.
 *
 * A POST, not a link: a GET that destroys credentials could be triggered by any image tag.
 */
import { getDb } from '@ozituma/db/client';
import { sanitiseSpotifyMessage, disconnectSpotify } from '@ozikoro/platform';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { jsonError, redirectTo, requireAdministrator, sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT = { limit: 10, windowSeconds: 300 };

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return jsonError(403, 'forbidden', 'That request did not come from this site.');
  }

  const limited = rateLimit(`spotify-disconnect:${clientKey(request)}`, LIMIT);
  if (!limited.allowed) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/admin/spotify?error=${encodeURIComponent('Too many requests. Try again shortly.')}`,
        'Retry-After': String(limited.retryAfterSeconds),
      },
    });
  }

  const guard = await requireAdministrator({ returnTo: '/admin/spotify' });
  if (!guard.ok) return guard.response;

  try {
    const db = await getDb();
    await disconnectSpotify(db, { accountId: guard.account.account.id });
    return redirectTo('/admin/spotify', { disconnected: '1' });
  } catch (error) {
    console.error('[spotify/disconnect]', sanitiseSpotifyMessage(error));
    return redirectTo('/admin/spotify', {
      error: 'The Spotify connection could not be cleared. Nothing was changed.',
    });
  }
}
