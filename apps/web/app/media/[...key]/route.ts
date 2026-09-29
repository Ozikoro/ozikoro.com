/**
 * GET /media/[...key] — serve locally stored media.
 *
 * Only used by the local storage driver. In production the S3 driver returns a
 * bucket or CDN URL directly, so nothing routes through here; the guard below
 * makes that explicit rather than leaving a route that silently 404s in one
 * environment and works in another without explanation.
 *
 * Serving user-uploaded bytes from our own origin is the reason the upload path
 * sniffs container signatures. The content type here comes from the stored
 * extension, never from anything the uploader supplied.
 */
import { NextResponse } from 'next/server';
import { getStorage } from '@ozituma/db/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Types we will ever emit. Anything else is served as an opaque download. */
const SAFE_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> }
): Promise<Response> {
  const storage = getStorage();

  if (storage.driver !== 'local') {
    return NextResponse.json(
      {
        error: {
          code: 'not_found',
          message: 'Media is served from object storage in this environment.',
        },
      },
      { status: 404 }
    );
  }

  const { key } = await context.params;
  // Re-join the catch-all segments. `LocalStorage` rejects any key that would
  // resolve outside the media root, so a traversal attempt cannot escape.
  const joined = key.map((part) => decodeURIComponent(part)).join('/');

  const object = await storage.get(joined);
  if (!object) {
    return new NextResponse('Not found', { status: 404 });
  }

  const contentType = SAFE_TYPES.has(object.contentType)
    ? object.contentType
    : 'application/octet-stream';

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(object.body.length),
      // Keys contain a UUID and are never rewritten, so this is safe.
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Belt and braces: never let a browser decide this is HTML.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
