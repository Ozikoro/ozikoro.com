/**
 * POST /api/admin/trash — restoring something, and the one act in this archive that cannot be undone.
 *
 * TWO CAPABILITIES IN ONE FILE, AND THEY ARE NOT THE SAME KIND OF THING
 *
 *   `restore_article` / `restore_media`   gated on `edit_entity`, because recovering something is an edit and
 *                                         the owner has said an editor "can recover or do anything".
 *   `purge_article` / `purge_media`       gated on **`purge_trash`**, the one capability in this archive that
 *                                         expresses a PROHIBITION rather than a permission.
 *
 * The guard for a purge is asked at the door AND again inside `trash.ts`. That is not belt-and-braces for its
 * own sake: the door is a route, and a route is a thing somebody adds a second of. **The rule lives in the
 * write** — `purgeArticle` and `purgeMedia` both call `requirePurge` — so a script, a future endpoint or a
 * job that calls them directly is refused by the same rule, and the shape of the failure is closed for the
 * one act that cannot be undone.
 *
 * WHY THE PURGE CONFIRMATION IS READ HERE AND CHECKED IN THE WRITE
 *
 * The reference the operator typed is passed through unchanged and compared inside `purgeArticle`, against a
 * reference that function derives from the row it is about to delete. **Comparing it here would compare the
 * typed string against a string this route built from the id in the same form**, which two fields of one
 * forged request can both satisfy.
 */
import { getDb } from '@ozituma/db/client';
import {
  MemberError,
  TRASH_PURGE_CAPABILITY,
  purgeArticle,
  purgeMedia,
  restoreArticle,
  restoreMedia,
} from '@ozikoro/platform';
import { formBody, jsonError, redirectTo, requireCapability, sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  // Origin first, capability second, and the body read only after both — see `/api/admin/entities`.
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  /*
   * THE DOOR ASKS FOR `edit_entity`, WHICH IS THE WEAKER OF THE TWO, DELIBERATELY.
   *
   * Restoring needs it and purging needs `purge_trash`, so a single door gated on `purge_trash` would refuse
   * an editor the RESTORE the owner has said is theirs. The stronger check is therefore made per action below
   * — and inside the write, which is where it has to hold.
   */
  const guard = await requireCapability('edit_entity', { returnTo: '/admin/trash' });
  if (!guard.ok) return guard.response;
  const actorId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const action = String(form.get('action') ?? '').trim();
  const kind = String(form.get('kind') ?? '').trim() === 'media' ? 'media' : 'article';
  const id = Number(form.get('id'));
  const backTo = '/admin/trash';
  if (!Number.isInteger(id) || id <= 0) return redirectTo(backTo, { error: 'That item was not named.' });

  /** The purge is the only action that needs the prohibition, and it is checked before anything is read. */
  if (action === 'purge') {
    if (!guard.capabilities.has(TRASH_PURGE_CAPABILITY)) {
      return redirectTo(backTo, {
        error:
          'Destroying something for good needs the “purge trash” permission, which this account does not have. ' +
          'Restoring it does not.',
      });
    }
  }

  const db = await getDb();

  try {
    if (action === 'restore') {
      const result = kind === 'media'
        ? await restoreMedia(db, { mediaId: id, actorId })
        : await restoreArticle(db, { articleId: id, actorId });
      const where = kind === 'media'
        ? 'It is a catalogue record again, and nothing about it was changed by the deletion.'
        : 'It is back as what it was — a record recovered from the bin returns to the state it was taken out of, not to a default.';
      return redirectTo(backTo, { saved: `Restored ${result.reference}. ${where}` });
    }

    if (action === 'purge') {
      /*
       * The confirmation is the string the operator typed, passed through untouched. `purgeArticle` derives
       * the expected reference from the row and compares — see the header for why it is not compared here.
       */
      const confirm = String(form.get('confirm') ?? '');

      if (kind === 'media') {
        const item = await db.one<{ slug: string; storage_key: string | null }>(
          `select slug, storage_key from ozikoro_media where id = $1`,
          [id]
        );
        const result = await purgeMedia(db, { mediaId: id, actorId, capabilities: guard.capabilities, confirm });
        return redirectTo(backTo, {
          saved:
            `Destroyed the catalogue record ${result.reference} (${item?.slug ?? id}). ` +
            'THE FILE WAS NOT DESTROYED — this archive has no way to delete an object — so it is still in ' +
            'storage and still served to anyone who has the address. The audit row recording this survives ' +
            'the deletion.',
        });
      }

      const result = await purgeArticle(db, { articleId: id, actorId, capabilities: guard.capabilities, confirm });
      const d = result.destroyed;
      return redirectTo(backTo, {
        saved:
          `Destroyed ${result.reference} for good. Taken with it: ${d.revisions} revision(s), ` +
          `${d.entities} entity link(s), ${d.sources} source link(s), ${d.labels} label link(s), ` +
          `${d.media} media placement(s). Media records are NOT destroyed — only the link from this record. ` +
          'The audit rows about it survive the deletion and cannot be undone with it.',
      });
    }

    return redirectTo(backTo, { error: 'That action is not one this screen offers.' });
  } catch (error) {
    /*
     * A `MemberError` is a refusal the operator caused and can act on — a confirmation that did not match, an
     * item that is not in the bin, a missing permission — so its message is shown. Anything else is a fault.
     */
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[admin/trash]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That could not be done. Nothing was changed.' });
  }
}
