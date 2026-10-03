/**
 * GET /api/podcast/download/<slug> — the raw MP3, at ANY status, as a file.
 *
 * WHY THIS EXISTS, IN THE OWNER'S OWN TERMS
 *
 * *"the audio will have an option to download the raw files before approval, so one can upload to spotify"*. That
 * is the honest publishing path, because **Spotify's Web API cannot upload an episode** — it ingests an RSS
 * feed, and this site already serves one at `/podcast/feed.xml`. Pretending otherwise would mean a "publish to
 * Spotify" button that quietly failed. So the raw file is offered for the manual route, and approval is what
 * puts the episode into the feed.
 *
 * IT IS NOT LIMITED TO PUBLISHED EPISODES, AND THAT IS DELIBERATE.
 *
 * A `pending_review` take is exactly the thing somebody wants to listen to on a proper device, and a
 * `proposed` episode has no audio to give — the same rule for every status: **if there is audio, it downloads;
 * if there is not, it says so.** Status changes what the article shows, not what the operator can fetch.
 *
 * A DELETED OR MISSING OBJECT IS A 404 WITH A REASON.
 *
 * The key is read from the row rather than from the URL, so no request can name a path of its own — **a route
 * that took the storage key from the caller would be a directory-traversal bug with an audio player in front of
 * it.** The URL parameter is only ever used to look a row up and to name the downloaded file.
 *
 * Gated on `review_audio`: this is one of the things the editor with "special access to the audio files" gets,
 * and it is not public.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import { can } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const current = await getCurrentAccount();
  if (!current) {
    return new NextResponse('Sign in to download an unreleased recording.', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const db = await getDb();
  if (!(await can(db, current.account.id, 'review_audio'))) {
    return new NextResponse('That needs the “review audio” permission.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const { slug } = await params;
  const episode = await db.one<{
    slug: string; status: string; storage_key: string | null; external_url: string | null;
  }>(
    `select slug, status, storage_key, external_url from ozikoro_episode where slug = $1`,
    [slug.replace(/\/$/, '')]
  );

  if (!episode) return new NextResponse('No such episode.', { status: 404 });

  // Narration recorded elsewhere: hand the caller to it rather than pretending to have the bytes.
  if (!episode.storage_key && episode.external_url) {
    return NextResponse.redirect(episode.external_url, 302);
  }
  if (!episode.storage_key) {
    return new NextResponse(
      `“${episode.slug}” is “${episode.status}” and has no recording yet, so there is nothing to download. ` +
        'A proposal holds the script and the cost and no audio at all.',
      { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }

  let object: Awaited<ReturnType<ReturnType<typeof getStorage>['get']>> = null;
  try {
    object = await getStorage().get(episode.storage_key);
  } catch (error) {
    console.error('[podcast download] storage read failed:', String(error).slice(0, 200));
    object = null;
  }
  if (!object) {
    return new NextResponse(
      `The row points at “${episode.storage_key}” and storage does not hold it. Nothing has been changed.`,
      { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }

  /*
   * THE FILENAME IS BUILT FROM THE SLUG, NOT FROM THE STORAGE KEY.
   *
   * A header cannot carry a quote or a newline, and the slug is archive-owned text that is already restricted
   * to a URL-safe alphabet — but it is still stripped rather than trusted, because **a header injected through
   * a filename is a response-splitting bug**, and the cost of the guard is one regular expression.
   */
  const filename = `${(episode.slug || 'episode').replace(/[^A-Za-z0-9._-]/g, '_')}.mp3`;

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      'content-type': object.contentType && object.contentType !== 'application/octet-stream'
        ? object.contentType
        : 'audio/mpeg',
      'content-length': String(object.body.length),
      // `attachment`, so a browser saves the file rather than opening a player — this is the Spotify route.
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
