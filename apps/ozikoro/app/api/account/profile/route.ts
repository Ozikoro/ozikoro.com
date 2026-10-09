/**
 * POST /api/account/profile — a signed-in person's own biography, picture and social handles.
 *
 * ── WHAT THIS ANSWERS, IN THE OWNER'S WORDS ──────────────────────────────────────────────────────────
 *
 * *"also, people should be able to edit their profiles, especially writers to change their bio, or profile
 * pictures and social media networks username"*
 *
 * Three things, and this route is the write half of all three. The read half is `/account/` (the form) and
 * `/researchers/<id>/` and `/author/<slug>/` (where a reader meets them).
 *
 * ── WHO MAY WRITE WHAT: THE ONE RULE, AND WHY THE BAR IS LOWER THAN THE PASSWORD FORM'S ──────────────
 *
 * ⚠️ **NO ACCOUNT ID IS ACCEPTED FROM THE CLIENT, AT ALL.** The account that is edited is the account the
 * session resolves to — `getCurrentAccount()` — and nothing in the form can name anybody else. There is
 * therefore no request shape, forged or accidental, that points this route at another person's record; and
 * the library functions behind it (`saveOwnProfile`, `saveOwnSocialLinks`, `setOwnAvatarUrl`) each throw
 * `not_your_profile` unless `accountId === actorId`, so a future caller that got the id wrong is refused
 * too rather than trusted.
 *
 * `/api/auth/change-password` asks for the CURRENT password as well, and that is right for a password: a
 * change to it can lock the owner out permanently, so a borrowed session must not be enough to make one.
 * **A profile edit is a different risk.** It cannot lock anybody out, the person can undo it from the same
 * screen in one click, and the fields are the ones the owner has asked them to publish. So the proof of
 * ownership required here is **the signed-in session plus a same-origin form POST** — and the thing that is
 * not negotiable is *whose* record, which is decided by the session and by nothing else.
 *
 * `sameOrigin()` is defence in depth rather than the only lock: the session cookie is `SameSite=Lax`, so a
 * browser already withholds it from a cross-site POST. It is here because every other state-changing route
 * in this app does it, and a route that omits it depends on a cookie attribute staying correct forever.
 *
 * ── THE PICTURE GOES THROUGH THE ARCHIVE'S OWN MEDIA STORE, AND THERE IS NO SECOND MECHANISM ──────────
 *
 * ⚠️ **THIS IS THE PART THAT WAS EASIEST TO GET WRONG, SO IT REUSES EVERY PIECE RATHER THAN REINVENTING ONE:**
 *
 *   the row        an `ozikoro_media` insert, exactly the shape `POST /api/admin/media/upload` writes —
 *                  including inserting it with `storage_key = null` FIRST, so a record that never gets its
 *                  bytes is invisible to every picker (they all filter on `storage_key is not null`);
 *   the bytes      `getStorage().put(key, body, contentType)` — the same driver the importer, the editor's
 *                  picker and the pronunciation recorder all use, S3 when `S3_BUCKET` is set and the local
 *                  `.data/media` tree otherwise;
 *   the key        `ozikoro/<mediaId>-<filename>`, built with `safeMediaFilename`, and **asserted against
 *                  `isAddressableMediaKey` BEFORE a byte is written** — the rule `media-key.ts` exists for,
 *                  because an uploader that cannot see the serving pattern reports success over files that
 *                  404 for ever;
 *   the serving    `GET /media/<key>`, which already exists and already serves the archive's 3,488 images;
 *   the type       `sniffMediaBytes`, so the stored MIME type is the one the BYTES proved and not the one
 *                  the browser declared. SVG is refused by name, as it is there.
 *
 * **WHY IT IS A SECOND DOOR AND NOT THE SAME ONE.** `/api/admin/media/upload` requires the `edit_entity`
 * capability, which is held by editors and administrators. An ordinary writer — the person the owner named
 * — does not hold it, so routing their own portrait through the editorial door would mean **writers cannot
 * set a picture**, which is the request. The door is new; the mechanism behind it is not.
 *
 * ⚠️ **AND THE PICTURE GOES TO `account.avatar_url`, WHICH ALREADY EXISTS.** `0033_account_avatar.sql` added
 * that column with the header *"The owner: 'one should be able to add profile picture/avatar, or change
 * it'"* and **nothing has ever written it** — measured on the live database, empty on all six accounts. So
 * this is exposing a field, not adding one, and it adds nothing to the shared `account` table that
 * ozituma.com and academy.ozikoro.com would then carry: the column is already there and they already ignore
 * it. No column is added and no constraint changes.
 *
 * ── WHY THE UPLOAD SIZE CAP IS 4 MB AND NOT THE MEDIA SCREEN'S 20 ─────────────────────────────────────
 *
 * Because a portrait is not a photograph record. The cap is stated in the refusal, in the units a person
 * thinks in, so a refused upload says how much too big the file is rather than only that it is too big.
 */
import { getDb } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import {
  SOCIAL_NETWORKS,
  mediaPath,
  saveOwnProfile,
  saveOwnSocialLinks,
  setOwnAvatarUrl,
  socialHandlesProblem,
  MemberError,
} from '@ozikoro/platform';
import { isAddressableMediaKey } from '@ozikoro/platform/media-key';
import { looksLikeSvg, safeMediaFilename, sniffMediaBytes } from '@ozikoro/platform/media-bytes';
import { getCurrentAccount } from '@/lib/session';
import { jsonError, redirectTo, sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The largest portrait this form will read.
 *
 * A route handler holds the body in memory, so an unbounded one on a public form is a way to exhaust the
 * container. 4 MB is roughly four times a phone photograph at full resolution and is far more than a
 * picture displayed at 96 px needs.
 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Every refusal is logged, for the reason the media screen's own header gives: an upload that leaves no
 * trace of having been attempted can be diagnosed only by guessing. */
function refuse(status: number, code: string, message: string, wantsJson: boolean): Response {
  console.warn(`[ozikoro/account-profile] refused ${status} ${code} — ${message.slice(0, 200)}`);
  if (wantsJson) return jsonError(status, code, message);
  return redirectTo('/account/', { error: message });
}

/** A JSON body for `fetch`, a 303 back to the form for a browser — the same both-shapes rule the auth
 * route follows, so the form works with JavaScript off. */
function wantsJson(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

function ok(request: Request, message: string): Response {
  if (wantsJson(request)) {
    return Response.json({ ok: true, message }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return redirectTo('/account/', { saved: message });
}

function fail(request: Request, message: string): Response {
  if (wantsJson(request)) {
    return Response.json({ ok: false, error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  return redirectTo('/account/', { error: message });
}

export async function POST(request: Request): Promise<Response> {
  const json = wantsJson(request);

  if (!sameOrigin(request)) {
    return refuse(403, 'cross_origin', 'That request did not come from this site.', json);
  }

  /*
   * A SIGNED-OUT REQUEST IS REFUSED BEFORE ANY FIELD IS READ, and the account comes from the session
   * cookie and from nothing the form sends.
   */
  const current = await getCurrentAccount();
  if (!current) {
    return refuse(401, 'not_signed_in', 'Sign in to change your profile.', json);
  }
  const accountId = current.account.id;

  const contentType = request.headers.get('content-type') ?? '';

  /*
   * THE PICTURE COMES AS MULTIPART AND THE TEXT FIELDS COME AS A PLAIN FORM, and both are accepted by this
   * one handler. The page posts ONE form carrying everything — a person should not have to save twice to
   * change their name and their picture — and the two are told apart by the `content-type` the browser
   * actually sent rather than by a field somebody could omit.
   */
  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(request, 'That form could not be read, so nothing was saved.');
    }

    const db = await getDb();
    const action = String(form.get('action') ?? 'save');

    /*
     * ⚠️ THE HANDLES ARE CHECKED BEFORE ANYTHING ELSE IS WRITTEN, AND THIS ORDER IS THE WHOLE POINT.
     *
     * The first version validated them inside `saveOwnSocialLinks`, which runs LAST — so a form with one
     * unusable username came back with a refusal AND a saved biography, and the person could not tell from
     * the screen which half of their form had gone in. **A partial save is the worst outcome available**, so
     * the refusal is decided here, before the picture is stored, before the biography is written and before
     * the handles are touched. Found by submitting a hostile value and reading the page back rather than by
     * reading the code, because the error message made it look like a clean refusal.
     */
    const handles = Object.fromEntries(
      SOCIAL_NETWORKS.map((n) => [n.field, String(form.get(n.field) ?? '')])
    );
    const handleProblem = socialHandlesProblem(handles);
    if (handleProblem) return fail(request, handleProblem);

    try {
      if (action === 'remove-picture') {
        await setOwnAvatarUrl(db, { accountId, actorId: accountId, avatarUrl: null });
        return ok(request, 'Your picture has been removed. Your profile shows a monogram until you add another.');
      }

      /*
       * THE PICTURE IS STORED FIRST AND THE TEXT FIELDS SECOND, so a failure to store the picture does not
       * leave a biography saved with no way for the person to tell. If the picture fails, nothing is written
       * and the refusal names the file.
       */
      const file = form.get('picture');
      if (file instanceof File && file.size > 0) {
        const stored = await storePicture(db, accountId, file);
        if (!stored.ok) return fail(request, stored.message);
      }

      await saveOwnProfile(db, {
        accountId,
        actorId: accountId,
        displayName: text(form, 'displayName', 120),
        bio: text(form, 'bio', 5000),
        website: text(form, 'website', 300),
        isPublic: form.get('isPublic') !== null,
      });

      await saveOwnSocialLinks(db, { accountId, actorId: accountId, handles });

      return ok(request, 'Your profile is saved. It is on your public profile page now.');
    } catch (error) {
      if (error instanceof MemberError) return fail(request, error.message);
      console.error('[ozikoro/account-profile] save failed:', String(error).slice(0, 400));
      return fail(request, 'Your profile could not be saved. Nothing has been changed.');
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(request, 'That form could not be read, so nothing was saved.');
    }
    const db = await getDb();
    const handles = Object.fromEntries(
      SOCIAL_NETWORKS.map((n) => [n.field, String(form.get(n.field) ?? '')])
    );
    // The same check-before-any-write rule the multipart branch states: this path has no file, but it does
    // write the biography, so an unusable handle must refuse it before the biography is committed.
    const handleProblem = socialHandlesProblem(handles);
    if (handleProblem) return fail(request, handleProblem);
    try {
      await saveOwnProfile(db, {
        accountId,
        actorId: accountId,
        displayName: text(form, 'displayName', 120),
        bio: text(form, 'bio', 5000),
        website: text(form, 'website', 300),
        isPublic: form.get('isPublic') !== null,
      });
      await saveOwnSocialLinks(db, { accountId, actorId: accountId, handles });
      return ok(request, 'Your profile is saved.');
    } catch (error) {
      if (error instanceof MemberError) return fail(request, error.message);
      console.error('[ozikoro/account-profile] save failed:', String(error).slice(0, 400));
      return fail(request, 'Your profile could not be saved. Nothing has been changed.');
    }
  }

  return refuse(415, 'unsupported_body', 'That profile did not arrive as a form.', json);
}

/** A trimmed, length-capped field; empty becomes null so "cleared" is stored as "not set". */
function text(form: FormData, name: string, max: number): string | null {
  const value = String(form.get(name) ?? '').trim().slice(0, max);
  return value.length === 0 ? null : value;
}

/**
 * Put a portrait into the archive's media store and point the account at it.
 *
 * The order is the one `/api/admin/media/upload` documents and the reason is the same: the key is
 * `ozikoro/<rowId>-<filename>`, so the row must exist before the key can be named; the row is inserted with
 * `storage_key = null`, which is exactly what every picker filters out, so a half-made record can never be
 * offered; and **if the `put` fails the row is deleted**, so a failed upload leaves nothing behind.
 */
async function storePicture(
  db: Awaited<ReturnType<typeof getDb>>,
  accountId: number,
  file: File
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message:
        `That picture is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which is larger than the ` +
        `${MAX_IMAGE_BYTES / (1024 * 1024)} MB this form will read. Resize it and try again.`,
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const head = bytes.subarray(0, 512);

  /*
   * SVG IS REFUSED BY NAME, for the reason the media screen states: it is the one image format that is a
   * script container, and it is served from this origin. `looksLikeSvg` is the same check that route uses.
   */
  if (looksLikeSvg(head)) {
    return {
      ok: false,
      message:
        'An SVG cannot be used as a profile picture. It is the one image format that can carry script, and ' +
        'the archive refuses them everywhere. A JPEG or a PNG will work.',
    };
  }

  const sniffed = sniffMediaBytes(head, (file.type || '').split(';')[0]!.trim().toLowerCase());
  if (!sniffed || sniffed.kind !== 'image') {
    return {
      ok: false,
      message:
        'That file is not an image this form stores. A profile picture must be a JPEG, PNG, GIF, WebP or ' +
        'AVIF file — and the format is checked from the file’s own first bytes, not from its name.',
    };
  }

  let mediaId: number;
  try {
    const row = await db.one<{ id: number }>(
      `insert into ozikoro_media (slug, kind, title, storage_key, mime_type, filesize_bytes, uploaded_at)
       values ($1, 'image', $2, null, $3, $4, now())
       returning id`,
      [
        `pending-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        file.name.replace(/\.[^.]*$/, '').trim().slice(0, 200) || null,
        sniffed.mime,
        bytes.length,
      ]
    );
    if (!row) throw new Error('the media row was not returned');
    mediaId = Number(row.id);
  } catch (error) {
    console.error('[ozikoro/account-profile] could not open the media record:', String(error).slice(0, 300));
    return { ok: false, message: 'A record for that picture could not be opened, so nothing was stored.' };
  }

  const key = `ozikoro/${mediaId}-${safeMediaFilename(file.name, sniffed.extension)}`;

  /*
   * THE KEY IS CHECKED AGAINST THE ROUTE THAT WILL SERVE IT, BEFORE THE BYTES ARE WRITTEN. A file the route
   * cannot address is a 404 no upload can fix, and the honest moment to say so is before the byte.
   */
  if (!isAddressableMediaKey(key)) {
    await db.query(`delete from ozikoro_media where id = $1`, [mediaId]);
    return {
      ok: false,
      message:
        'That file’s name would make an address the archive’s media route cannot serve, so nothing was ' +
        'stored. Rename the file and try again.',
    };
  }

  try {
    const stored = await getStorage().put(key, bytes, sniffed.mime);
    await db.query(`update ozikoro_media set storage_key = $1, updated_at = now() where id = $2`, [
      stored.key,
      mediaId,
    ]);
    /*
     * ⚠️ THE STORED VALUE IS `mediaPath(key)` — A PATH ON THIS SITE — AND **NOT** `getStorage().publicUrl(key)`.
     *
     * This is the one line where using the storage driver's own answer would have been wrong. `publicUrl`
     * returns a bucket or CDN address when one is configured (`https://<bucket>.s3.<region>.amazonaws.com/…`
     * or `MEDIA_PUBLIC_BASE_URL`), and **this site's Content-Security-Policy allows `img-src 'self' data:
     * https://i.ytimg.com` and the advertisement origins — nothing else.** A portrait stored as a bucket
     * address would be a picture the browser REFUSES TO DRAW, which is precisely the failure an agent measured
     * on `/researchers/` when 22 Gravatar avatars were refused by this same policy.
     *
     * So the stored value is the address the archive's OWN serving route answers: `GET /media/<key>`, which
     * reads the same object out of the same store (S3 or the local tree) and returns it from `'self'`. It is
     * also what every other image in this archive already does — `media.ts`, `archive.ts` and the author
     * portrait backfill all build `/media/<key>`, and the imported 3,488 photographs are served that way.
     *
     * `mediaPath` is that function, and it percent-encodes each segment: `MEDIA_KEY_PATTERN` deliberately
     * admits the spaces and parentheses a WordPress filename carries, and an unencoded space in an `src` is a
     * URL a browser may truncate.
     */
    await setOwnAvatarUrl(db, {
      accountId,
      actorId: accountId,
      avatarUrl: mediaPath(stored.key),
      note: `media ${mediaId}`,
    });
    console.log(`[ozikoro/account-profile] account ${accountId} set a picture: ${stored.key} (${bytes.length} bytes)`);
    return { ok: true };
  } catch (error) {
    console.error('[ozikoro/account-profile] storing the picture failed:', String(error).slice(0, 300));
    try {
      await db.query(`delete from ozikoro_media where id = $1`, [mediaId]);
    } catch {
      /* The record is left with no key, which no picker offers. The original failure is the one to report. */
    }
    return {
      ok: false,
      message: 'That picture could not be stored, and nothing was added to the archive.',
    };
  }
}

/** GET is not implemented: this form is read on `/account/`. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
}
