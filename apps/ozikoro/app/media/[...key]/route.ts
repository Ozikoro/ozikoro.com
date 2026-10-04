/**
 * GET /media/<key> — the archive's own media.
 *
 * WHY THIS EXISTS
 *
 * Every one of the 3,488 media files migrated from WordPress was being served by hotlinking
 * `ozikoro.com/wp-content/uploads/...`. That works exactly as long as the old WordPress site stays
 * up, which makes the new archive's images depend on the site it is replacing. The user's original
 * instruction was to import "every single article and content like images and videos", and the
 * content half of that is this route: the files are in the archive, so the archive serves them.
 *
 * TWO SOURCES, IN ORDER
 *
 *  1. Object storage, by key. This is the production path and the only one that survives a redeploy.
 *  2. The local archive directory, which is where the extraction downloaded the files to. This is a
 *     development affordance and it is disabled in production, loudly, because a container's
 *     filesystem is ephemeral and serving from it there would look like it worked until it did not.
 *
 * WHY THE PATH IS VALIDATED SO HARD
 *
 * A route that takes a path from the URL and reads a file is a directory-traversal bug waiting to
 * happen. The key is checked against the exact shape the importer writes (`ozikoro/<id>-<name>`),
 * so `..`, an absolute path and anything else simply does not match and is refused before a
 * filesystem call is made.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { getStorage } from '@ozituma/db/storage';
import { EPISODE_KEY_PATTERN, MEDIA_KEY_PATTERN } from '@ozikoro/platform/media-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where the WordPress extraction put the files. Mirrors `packages/ozikoro/src/import/wordpress.ts`. */
const ARCHIVE_MEDIA_DIR = join(process.cwd(), '..', '..', 'data', 'media', 'ozikoro-wp');

/**
 * `ozikoro/<wpId>-<filename>`. Nothing else is addressable.
 *
 * ── THE PATTERNS LIVE IN `@ozikoro/platform/media-key` AND ARE NOT WRITTEN OUT HERE ─────────────────
 *
 * They did live here, and that is why they were wrong twice. The upload tool could not see them, so it put
 * objects in the bucket for keys this route then refused: **`ozikoro/11237-Igbo Folk Idioms in Caribbean
 * Phrase.pdf` was on disk, in the table, correctly named and served a 404** because the class omitted the
 * space; and seven `…@2x.png` retina variants plus one 212-character name were refused in exactly the same
 * way. Each was found by fetching a real key, because a regex nobody executes looks correct.
 *
 * One constant, read by the route that enforces it and by the uploader that has to satisfy it, is what stops
 * the third occurrence. **The traversal guard is unchanged and is stated there: no `/` after the fixed
 * prefix, ever.** See `packages/ozikoro/src/media-key.ts` for the measurement behind every character.
 */
const KEY_PATTERN = MEDIA_KEY_PATTERN;

/**
 * The spoken records live in their own subdirectory, and a slash is forbidden in the media pattern **on
 * purpose** — the traversal guard is what it exists for. So the episode path is a SECOND, NARROWER pattern,
 * in the same module, for the reason stated there.
 */
const EPISODE_PATTERN = EPISODE_KEY_PATTERN;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> }
): Promise<Response> {
  const { key: segments } = await context.params;
  const key = (segments ?? []).join('/');

  if (!KEY_PATTERN.test(key) && !EPISODE_PATTERN.test(key)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const extension = key.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream';
  /*
   * Immutable: a key names one file and the file never changes. The archive can be cached hard for
   * a year, which is what makes serving 3,488 images from an application feasible at all.
   */
  const cacheHeaders = { 'Cache-Control': 'public, max-age=31536000, immutable' };

  // 1. Object storage.
  try {
    const object = await getStorage().get(key);
    if (object) {
      return new NextResponse(new Uint8Array(object.body), {
        // THE EXTENSION WINS OVER A GENERIC STORED TYPE.
        //
        // Object storage reports `application/octet-stream` for anything uploaded without an explicit
        // ContentType, and that value was being preferred over the extension. **The images still arrived, so
        // the page looked right — but a browser given `octet-stream` for an `<img>` may download it instead of
        // drawing it, which is why the difference is worth fixing even though it is invisible in a fetch.**
        // A specific stored type is still respected; only the generic one defers to the extension.
        headers: {
          'Content-Type':
            object.contentType && object.contentType !== 'application/octet-stream'
              ? object.contentType
              : contentType,
          /*
           * THE LENGTH IS STATED, BECAUSE WITHOUT IT ONE OF THESE FILES HAS NO DURATION.
           *
           * This response was left to chunked transfer encoding, and the file still played — which is why the
           * fault went unnoticed. **Measured in Chrome, side by side, on the two Ute-Okpu files:** the
           * synthetic render reported `duration` 501.783 s and the owner's own recording reported `NaN`,
           * because the render carries a `Xing`/`Info` header frame declaring its own frame count and the
           * recording does not. **With no declared length and no header frame there is nothing for the browser
           * to compute a length from**, so `audio.duration` stays NaN.
           *
           * The consequences are all in the player, which is why they are worth a header: the design's
           * `<progress>` is driven by `currentTime / duration`, so the bar never moves; the status line reads
           * "Playing · " with the duration missing; and the recording cannot be seeked. **A 200 with the right
           * bytes and no length is the same class of fault as the four responses that returned 200 and were
           * unusable.**
           *
           * The body is already in memory here, so its length is known exactly. The local-file branch below
           * has always stated it; this branch simply did not.
           */
          'Content-Length': String(object.body.length),
          ...cacheHeaders,
        },
      });
    }
  } catch (error) {
    // A storage failure must not hide the file if the local copy is there; it is logged and the
    // local path is tried.
    console.error('[media] object storage read failed:', String(error).slice(0, 200));
  }

  // 2. The local archive copy, development only.
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      `[media] ${key} is not in object storage and the local archive copy is not served in ` +
        'production. Upload it with the media import before deploying.'
    );
    return new NextResponse('Not found', { status: 404 });
  }

  const filename = key.slice('ozikoro/'.length);
  const path = join(ARCHIVE_MEDIA_DIR, filename);
  try {
    const info = await stat(path);
    if (!info.isFile()) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(createReadStream(path) as unknown as ReadableStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(info.size),
        ...cacheHeaders,
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
