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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where the WordPress extraction put the files. Mirrors `packages/ozikoro/src/import/wordpress.ts`. */
const ARCHIVE_MEDIA_DIR = join(process.cwd(), '..', '..', 'data', 'media', 'ozikoro-wp');

/**
 * `ozikoro/<wpId>-<filename>`. Nothing else is addressable.
 *
 * A SPACE BELONGS IN THE FILENAME AND WAS NOT ALLOWED.
 *
 * The class was `[A-Za-z0-9._-]`, which rejects the space — and the archive holds real files whose names have
 * them, because WordPress keeps the uploaded name. **`11237-Igbo Folk Idioms in Caribbean Phrase.pdf` was on
 * disk, in the table, correctly named, and served a 404**, and the page offering it looked like a broken
 * download rather than a rejected address.
 *
 * **The traversal guard is what the pattern is for, and it still holds: no `/` is permitted after the
 * prefix, so no key can climb out of the media directory.** Spaces and the punctuation WordPress leaves in
 * filenames — parentheses, brackets, commas, apostrophes, `&` — are admitted; nothing that separates a path
 * is.
 */
const KEY_PATTERN = /^ozikoro\/\d{1,8}-[A-Za-z0-9._\- ()[\],'&+]{1,180}$/;

/**
 * The spoken records live in their own subdirectory, and the pattern above forbids `/` **on purpose** — the
 * traversal guard is what it exists for, so `..`, an absolute path and anything else never matches.
 *
 * **Widening that pattern to permit a slash would have weakened the guard for every one of the 3,750 archive
 * images to serve eight episodes.** So the episode path is a SECOND, NARROWER pattern: one fixed directory
 * name, then a filename that cannot contain a slash, a backslash or a dot-dot. **The guard is not relaxed; a
 * second door is cut that only opens onto one room.**
 */
const EPISODE_PATTERN = /^ozikoro\/episodes\/[A-Za-z0-9._\-]{1,180}$/;

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
