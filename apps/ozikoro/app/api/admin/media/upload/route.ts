/**
 * POST /api/admin/media/upload — put a file the owner chose into the archive's media store.
 *
 * ── WHY THIS ROUTE EXISTS, AND WHAT WAS MEASURED BEFORE IT DID ───────────────────────────────────────
 *
 * The media screen's own header says *"No upload, no replace and no delete. There is no field in the form
 * for a file."* That was true of `/api/admin/media`, and it was measured again before this file was written:
 * that route's actions are `save-description` and `trash`, and it writes no `storage_key`, no `mime_type` and
 * no bytes. `import:media-upload` is a **CLI script** (`packages/ozikoro/src/import/media-upload.ts`, run as
 * `npm run import:media-upload`), not a route: it moves the migrated WordPress files into object storage and
 * is not reachable from a browser.
 *
 * **So there was no upload path, and this is one.** It is built from the two pieces that already existed and
 * were verified rather than assumed:
 *
 *   1. **Storage** — `getStorage()` in `packages/db/src/storage.ts` is a `put(key, body, contentType)`
 *      interface over S3 (when `S3_BUCKET` is set) or the local filesystem, and `/media/<key>` already reads
 *      the same store through `get()`. Nothing new is invented to hold bytes.
 *   2. **The key rule** — `MEDIA_KEY_PATTERN` in `packages/ozikoro/src/media-key.ts` is the ONE constant the
 *      serving route enforces and any writer must satisfy. This route imports `isAddressableMediaKey` and
 *      **refuses the upload before writing anything** if the key it is about to make would 404. A file the
 *      route cannot address is a hole no upload can fill, and the honest moment to say so is before the byte.
 *
 * The shape of the multipart handling is copied from `app/api/admin/site-icons/route.ts`, which is this
 * codebase's working precedent: read `request.formData()` itself rather than through `formBody`, because
 * `formBody` flattens every value to a string and would turn the uploaded `File` into `"[object File]"`.
 *
 * ── THE CAPABILITY IS THE ONE THE MEDIA SCREEN ALREADY ASKS FOR ──────────────────────────────────────
 *
 * `edit_entity`, for the reason written out at the top of `../route.ts`: a photograph is content, and the
 * same capability that edits a caption adds a picture. **No new capability is invented.**
 *
 * ── WHAT IT VALIDATES, AND WHY THE DECLARED TYPE IS NOT TRUSTED ──────────────────────────────────────
 *
 * These files are served back from our own origin, so the declared type is attacker-controlled and a
 * document that claims to be a JPEG could be HTML. Every accepted type is therefore confirmed against its
 * **magic bytes** as well as its declaration, exactly as `verifyAudioSignature` does for recordings, and the
 * MIME type written to the row is the one the bytes proved.
 *
 * **SVG is refused by name.** It is an image, it is the one image format that is a script container, and the
 * archive's own sanitiser already drops `svg` from every stored body (`DROPPED_WITH_CONTENT` in
 * `packages/ozikoro/src/content.ts`). Accepting one here would store exactly the file the rest of the
 * pipeline refuses to carry.
 *
 * ── THE ROW AND THE OBJECT, IN THAT ORDER, AND WHY ───────────────────────────────────────────────────
 *
 * The key is `ozikoro/<rowId>-<filename>` and the numeric prefix is the archive's own shape (see
 * `MEDIA_KEY_PATTERN`), so the row has to exist before the key can be named. The order is therefore:
 *
 *   1. insert the row with `storage_key = null` — it is invisible to every picker, which filters on
 *      `storage_key is not null`, so a half-made record can never be offered for selection;
 *   2. `put` the bytes under the key the id gives;
 *   3. write the key onto the row.
 *
 * **If the `put` fails the row is deleted**, so a failed upload leaves nothing behind rather than an orphan
 * the owner cannot see. The one thing this cannot undo is bytes already in the bucket when the row update
 * fails; that is logged with its key and is the reason step 3 is a single `update` rather than a second
 * insert.
 */
import { getDb } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import { isAddressableMediaKey } from '@ozikoro/platform/media-key';
import { looksLikeSvg, safeMediaFilename, sniffMediaBytes } from '@ozikoro/platform/media-bytes';
import { jsonError, sameOrigin, requireCapability } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The largest upload this route will read. A route handler holds the body in memory, and an archive of
 * photographs and films has no business accepting an unbounded one on a form.
 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;


/** A slug nothing else in `ozikoro_media` holds. `slug` is `not null unique` on that table. */
async function uniqueMediaSlug(
  db: Awaited<ReturnType<typeof getDb>>,
  name: string,
  id: number
): Promise<string> {
  const root = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  const base = root.length > 0 ? root : 'upload';
  for (let n = 1; n <= 200; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await db.one<{ id: number }>(
      `select id from ozikoro_media where slug = $1 and id <> $2 limit 1`,
      [candidate, id]
    );
    if (!taken) return candidate;
  }
  return `upload-${id}`;
}

export async function POST(request: Request): Promise<Response> {
  /*
   * ORIGIN, THEN CAPABILITY, THEN THE BODY — the order `/api/admin/media` documents and the reason for it:
   * `request.formData()` throws when there is no body and no content type, and an uncaught throw out of a
   * handler is a 500 where a refusal belongs.
   */
  if (!sameOrigin(request)) {
    return jsonError(403, 'cross_origin', 'That request did not come from this site.');
  }
  const guard = await requireCapability('edit_entity', { returnTo: '/admin/posts/new' });
  if (!guard.ok) {
    return jsonError(401, 'not_signed_in', 'Sign in to add a file to the archive.');
  }
  const actorId = guard.account.account.id;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return jsonError(415, 'unsupported_body', 'That file did not arrive as a form upload.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'unreadable_body', 'That form could not be read. Nothing was stored.');
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return jsonError(400, 'missing_file', 'No file arrived with that form, so nothing could be stored.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(
      413,
      'too_large',
      `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which is larger than the ` +
        `${MAX_UPLOAD_BYTES / (1024 * 1024)} MB this form will read.`
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const head = bytes.subarray(0, 512);

  if (looksLikeSvg(head)) {
    return jsonError(
      400,
      'svg_refused',
      'An SVG is refused. It is the one image format that can carry script, and the archive’s own sanitiser ' +
        'drops SVG from every stored body — so a file accepted here could not be placed in a record anyway.'
    );
  }

  const sniffed = sniffMediaBytes(head, (file.type || '').split(';')[0]!.trim().toLowerCase());
  if (!sniffed) {
    return jsonError(
      400,
      'unrecognised_file',
      'That file is not one of the formats this form stores. It takes JPEG, PNG, GIF, WebP and AVIF images, ' +
        'MP4, QuickTime and WebM video, MP3, M4A, WAV, Ogg and WebM audio, and PDF documents — and it checks ' +
        'the file’s own first bytes rather than the name it arrived with.'
    );
  }

  const db = await getDb();
  const title = file.name.replace(/\.[^.]*$/, '').trim().slice(0, 200) || null;

  /*
   * THE ROW FIRST, WITH NO KEY. `storage_key is null` is exactly what every media picker filters out, so a
   * record that never gets its bytes is a record no screen offers.
   */
  let mediaId: number;
  try {
    const row = await db.one<{ id: number }>(
      `insert into ozikoro_media (slug, kind, title, storage_key, mime_type, filesize_bytes, uploaded_at)
       values ($1, $2, $3, null, $4, $5, now())
       returning id`,
      [`pending-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, sniffed.kind, title, sniffed.mime, bytes.length]
    );
    if (!row) throw new Error('the media row was not returned');
    mediaId = Number(row.id);
  } catch (error) {
    console.error('[ozikoro/media-upload] could not open the record:', String(error).slice(0, 300));
    return jsonError(500, 'record_failed', 'A record for that file could not be opened, so nothing was stored.');
  }

  const filename = safeMediaFilename(file.name, sniffed.extension);
  const key = `ozikoro/${mediaId}-${filename}`;

  /*
   * THE KEY IS CHECKED AGAINST THE ROUTE THAT WILL SERVE IT, BEFORE THE BYTES ARE WRITTEN. This is the rule
   * `media-key.ts` exists for: an uploader that cannot see the serving pattern reports success over files
   * that 404 for ever.
   */
  if (!isAddressableMediaKey(key)) {
    await db.query(`delete from ozikoro_media where id = $1`, [mediaId]);
    console.error('[ozikoro/media-upload] refused a key the media route cannot serve:', key);
    return jsonError(
      400,
      'unaddressable_key',
      'That file’s name would make an address the archive’s media route cannot serve, so nothing was stored. ' +
        'Rename the file and try again.'
    );
  }

  try {
    const stored = await getStorage().put(key, bytes, sniffed.mime);
    const slug = await uniqueMediaSlug(db, title ?? 'upload', mediaId);
    await db.query(
      `update ozikoro_media set storage_key = $1, slug = $2, updated_at = now() where id = $3`,
      [stored.key, slug, mediaId]
    );
    await db.query(
      `insert into ozikoro_audit (entity_type, entity_id, action, before, after, actor_id, note)
       values ('media', $1, 'upload', null, $2, $3, $4)`,
      [mediaId, JSON.stringify({ key: stored.key, mime: sniffed.mime, bytes: bytes.length }), actorId, `Added ${filename}`]
    );

    return Response.json({
      ok: true,
      item: {
        id: mediaId,
        key: stored.key,
        name: title ?? filename,
        altText: null,
        kind: sniffed.kind,
        mimeType: sniffed.mime,
        bytes: bytes.length,
      },
    });
  } catch (error) {
    console.error('[ozikoro/media-upload] storing failed:', String(error).slice(0, 300));
    try {
      await db.query(`delete from ozikoro_media where id = $1`, [mediaId]);
    } catch {
      /* The record is left with no key, which no picker offers. The original failure is the one to report. */
    }
    return jsonError(500, 'store_failed', 'That file could not be stored, and nothing was added to the archive.');
  }
}

/** GET is not implemented: the register is read through `GET /api/admin/media`. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
}
