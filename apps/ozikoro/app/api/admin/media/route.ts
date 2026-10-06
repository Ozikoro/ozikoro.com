/**
 * POST /api/admin/media — what a media record says about itself, and whether it is in the archive at all.
 *
 * WHICH CAPABILITY, AND WHY IT IS `edit_entity`
 *
 * The owner's rule is that *"an editor can … write any content"*, and a photograph is content: the same
 * capability that edits a history edits a picture's name, caption, alternative text, description, creator and
 * credit, and moves it to the trash. **`edit_entity` is therefore the gate for all of it**, and the name is
 * older than the rule — it means "may edit a record in this archive", which is how every editorial screen
 * already used it.
 *
 * THE ONE THING THAT IS STILL A DIFFERENT CAPABILITY, AND WHY IT IS NOT COLLAPSED
 *
 * `/api/admin/rights` records a PERMISSION — who holds the material, on what basis, whether publication is
 * allowed, whether a living subject consented, whether it is restricted — and it asks for
 * `manage_media_rights`. An editor now holds that too (migration 0055 grants every capability except
 * `purge_trash`), so nothing is out of reach; **the two routes stay separate because the two DECISIONS are
 * separate, not because the two roles are.** A caption edit is recorded as `update_description` and a
 * permission as `record_rights`, and a trail that could not tell them apart would be a trail that cannot
 * answer "was this allowed to be published?
 *
 * WHAT THIS FILE CANNOT DO, AND WHERE THE ONE THING IT CAN NOW READ IS
 *
 * No replace and no delete here. There is no field in THIS form for a file and no code in it that could
 * write `storage_key`, `source_url`, `mime_type` or a dimension. See `updateMediaDescription` for the
 * measurement behind that scope — 3,443 objects against 3,488 rows, and 307 files in `data/media/ozikoro-wp`
 * with no row at all, which a round declined to key because keying them would mean inventing keys.
 *
 * **Uploading a NEW file is the sibling route `./upload/route.ts`, and it was added later.** This header used
 * to say *"No upload"* flatly, and that sentence went on being read after an upload path existed — so it is
 * corrected here rather than left as a claim that is now false. What this file gained at the same time is
 * `GET`, which answers the picker's search; the actions it accepts on `POST` are unchanged.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError, trashMedia, updateMediaDescription } from '@ozikoro/platform';
import { formBody, jsonError, redirectTo, requireCapability, sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/media — the register, as data, for the picker on the editing screens.
 *
 * WHY A READ ENDPOINT IS NEEDED AT ALL, WHEN THE EDITOR ALREADY RECEIVES MEDIA
 *
 * The editing screen is given a short list of media by the server (`listMediaChoices`, forty rows) and that
 * is the right shape for a page's first paint. It is the wrong shape for a search: the archive holds
 * thousands of objects and a select that can only offer the newest forty cannot answer "where is the
 * photograph of the Ọ̀nịchạ market". **This endpoint is what makes the library in the picker a library
 * rather than a recent-files list**, and it answers with the same three facts a thumbnail needs: the row's
 * id, its `storage_key` (which `/media/<key>` serves) and its kind.
 *
 * THE CAPABILITY IS THE ONE THAT ALREADY GATES THE REGISTER, and it is asked before any query runs. A
 * refusal is a JSON 401 rather than the redirect `requireCapability` would send, because the caller is a
 * `fetch` from a screen and an HTML sign-in page would be parsed as a broken answer instead of an obvious
 * one.
 *
 * NOTHING HERE WRITES, and the handlers that do are below and unchanged.
 */
export async function GET(request: Request): Promise<Response> {
  const guard = await requireCapability('edit_entity', { returnTo: '/admin/posts' });
  if (!guard.ok) return jsonError(401, 'not_signed_in', 'Sign in to read the media register.');

  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, 120);
  const kindParam = (url.searchParams.get('kind') ?? '').trim();
  const KINDS = ['image', 'video', 'audio', 'document', 'dataset', 'other'];
  const kind = KINDS.includes(kindParam) ? kindParam : null;
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '60', 10) || 60, 1), 120);

  const db = await getDb();

  /*
   * THE SAME TWO CONDITIONS `listMediaChoices` USES, SAID THE SAME WAY: a record that holds no file cannot be
   * shown as a thumbnail (there is nothing to fetch) and a record in the trash is not offered for use.
   * The search reads the title, the alternative text and the key, which are the three things a person
   * remembers about a picture.
   */
  const params: unknown[] = [];
  let where = `deleted_at is null and storage_key is not null`;
  if (kind) {
    params.push(kind);
    where += ` and kind = $${params.length}`;
  }
  if (search.length > 0) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where += ` and (title ilike ${p} or coalesce(alt_text, '') ilike ${p} or storage_key ilike ${p})`;
  }

  try {
    const totalRow = await db.one<{ n: number }>(
      `select count(*)::int as n from ozikoro_media where ${where}`,
      params
    );
    const rows = await db.rows<{
      id: number;
      storage_key: string;
      name: string;
      alt_text: string | null;
      kind: string;
    }>(
      `select id, storage_key, coalesce(title, storage_key) as name, alt_text, kind
         from ozikoro_media
        where ${where}
        order by id desc
        limit ${limit}`,
      params
    );
    return Response.json({
      ok: true,
      total: Number(totalRow?.n ?? 0),
      search,
      kind,
      items: rows.map((r) => ({
        id: Number(r.id),
        key: String(r.storage_key),
        name: String(r.name),
        altText: r.alt_text === null ? null : String(r.alt_text),
        kind: String(r.kind),
      })),
    });
  } catch (error) {
    console.error('[admin/media] read', String(error).slice(0, 300));
    return jsonError(500, 'read_failed', 'The media register could not be read just now.');
  }
}

export async function POST(request: Request): Promise<Response> {
  /*
   * The order is the archive's rule and it is the same order `/api/admin/entities` documents: the origin
   * check and the capability check both happen BEFORE the body is read, because `request.formData()` throws
   * when there is no body and no content type, and an uncaught throw is a 500 where a refusal belongs.
   */
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  // First, always. Nothing below runs for an account without the capability.
  const guard = await requireCapability('edit_entity', { returnTo: '/admin/media' });
  if (!guard.ok) return guard.response;
  const actorId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const mediaId = Number(form.get('mediaId'));
  const backTo = Number.isInteger(mediaId) && mediaId > 0 ? `/admin/media/${mediaId}` : '/admin/media';

  /*
   * AN EMPTY CONTROL IS AN EMPTY FIELD.
   *
   * Every field is passed through as the string the form sent, or null when the control was absent
   * altogether. `updateMediaDescription` trims and turns an empty string into null, and it compares against
   * the stored value before writing, so a save that changed nothing writes nothing and says so.
   */
  const value = (name: string): string | null => {
    const raw = form.get(name);
    return raw === null ? null : String(raw);
  };

  const action = String(form.get('action') ?? '').trim();
  if (action === 'trash') {
    /*
     * A DELETE IS A MOVE, and it is here rather than on the trash route because it is an act on THIS record
     * performed from THIS record's screen. `trashMedia` destroys nothing — the row keeps its text, its rights
     * record and its links, and the FILE is not touched at all — so it needs no capability beyond the one that
     * let the editor open this page. **The act that destroys is the purge, it lives on the trash screen, and it
     * asks for `purge_trash`.**
     */
    const db = await getDb();
    try {
      const result = await trashMedia(db, { mediaId, actorId, note: value('note') });
      return redirectTo('/admin/trash', {
        saved:
          `Moved ${result.reference} to the trash. The record has left the catalogue and its own page no longer ` +
          'answers; its description, its rights record and its links are where they were, and it can be ' +
          'restored from the trash. THE FILE WAS NOT DELETED — this archive has no way to delete an object — so ' +
          'the picture is still served at its own /media/ address and still appears in any record that embeds it.',
      });
    } catch (error) {
      if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
      console.error('[admin/media] trash', String(error).slice(0, 300));
      return redirectTo(backTo, { error: 'That could not be moved to the trash. Nothing was changed.' });
    }
  }

  if (action !== 'save-description') {
    return redirectTo(backTo, { error: 'That action is not one this screen offers.' });
  }


  const db = await getDb();

  try {
    const result = await updateMediaDescription(db, {
      mediaId,
      title: value('title'),
      caption: value('caption'),
      altText: value('altText'),
      description: value('description'),
      creator: value('creator'),
      credit: value('credit'),
      actorId,
    });

    if (result.changed.length === 0) {
      return redirectTo(backTo, { info: 'Nothing was different, so nothing was written.' });
    }

    const fields = result.changed.map((c) => (c.field === 'altText' ? 'alternative text' : c.field));
    return redirectTo(backTo, {
      saved: `Saved. Changed ${fields.join(', ')}. The rights record is not affected by this and is decided in the rights queue.`,
    });
  } catch (error) {
    /*
     * A `MemberError` is a refusal the editor caused and can act on — a field longer than the archive
     * accepts, a record that does not exist — so its message is shown. Anything else is a fault, and the
     * editor is told something went wrong rather than shown an internal message.
     */
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[admin/media]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That could not be saved. Nothing was changed.' });
  }
}
