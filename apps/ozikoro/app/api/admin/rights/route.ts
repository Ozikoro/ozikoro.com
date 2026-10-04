/**
 * POST /api/admin/rights — recording what the archive may do with an item, or with a batch of them.
 *
 * Gated on `manage_media_rights`, which the plan lists as an administrator's capability and which
 * editors deliberately do not hold: deciding that a photograph may be republished is a different act
 * from deciding that an article is accurate, and conflating them is how a rights problem becomes
 * somebody's legal problem.
 *
 * TWO ACTIONS, ONE ITEM AND MANY
 *
 * `save-rights` writes one item; `save-rights-bulk` writes the same values to every id submitted. **The
 * bulk path is a loop over the single-item write, not a bulk UPDATE**, so a batch cannot store a
 * permission that the single-item form would have refused — and because `setMediaRights` writes an audit
 * row per item, a batch of twenty leaves twenty audit rows rather than one that says "20 items changed".
 */
import { getDb } from '@ozituma/db/client';
import {
  MemberError,
  setMediaRestriction,
  setMediaRights,
  setMediaRightsBulk,
  type PermissionBasis,
  type SubjectConsent,
} from '@ozikoro/platform';
import { redirectTo, requireCapability, sameOrigin, jsonError } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The largest batch this route will accept.
 *
 * A batch is a sitting's work, not a migration: the archive's own job is to look at each item, and a
 * number large enough to make "select everything" the easy choice would make the queue decorative. 200 is
 * two hundred items an editor has personally decided about.
 */
const MAX_BULK = 200;

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();

  /*
   * Cross-site form submissions are refused.
   *
   * The session cookie is `SameSite=Lax`, which already stops a browser sending it on a cross-site
   * POST — so this is defence in depth rather than the only protection. It is added because the four
   * Spotify and auth endpoints already do exactly this, and a state-changing route that omits it
   * relies entirely on a cookie attribute continuing to be set correctly in every environment.
   */
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const mediaId = Number(form.get('mediaId'));
  const isBulk = form.get('action') === 'save-rights-bulk';
  /*
   * WHICH ITEMS A BATCH APPLIES TO IS THE EDITOR'S CHOICE, MADE WITHOUT SCRIPT.
   *
   * The screen offers two buttons rather than a "select all" control: one writes the items whose boxes
   * are ticked, the other writes every item on the page. That is a form choice, so it works with
   * JavaScript off — and it is honest, because "all 25 shown" is exactly what it says and does not
   * silently mean "all 3,488 in the archive", which a select-all on a paged queue would.
   */
  const scope = String(form.get('scope') ?? 'selected');
  const bulkIds = (scope === 'page' ? form.getAll('pageMediaId') : form.getAll('mediaId'))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  const backTo = !isBulk && Number.isInteger(mediaId) && mediaId > 0
    ? `/admin/rights/?item=${mediaId}`
    : '/admin/rights/';

  const guard = await requireCapability('manage_media_rights', { returnTo: backTo });
  if (!guard.ok) return guard.response;

  const text = (name: string, max = 400) => String(form.get(name) ?? '').trim().slice(0, max);
  const flag = (name: string) => form.get(name) !== null;
  const db = await getDb();

  /** The values a rights write carries, read once so the single and bulk paths cannot drift apart. */
  const values = () => {
    const basis = text('permissionBasis', 40);
    const consent = text('subjectConsent', 40);
    const living = text('subjectIsLiving', 10);
    return {
      holderName: text('holderName', 200) || null,
      holderContact: text('holderContact', 200) || null,
      allowsPublication: flag('allowsPublication'),
      allowsDerivative: flag('allowsDerivative'),
      allowsCommercial: flag('allowsCommercial'),
      licence: text('licence', 200) || null,
      licenceUrl: text('licenceUrl', 300) || null,
      credit: text('credit', 300) || null,
      permissionBasis: (basis || null) as PermissionBasis | null,
      permissionDate: text('permissionDate', 10) || null,
      permissionNote: text('permissionNote', 1000) || null,
      subjectIsLiving: living === '' ? null : living === 'yes',
      subjectConsent: (consent || null) as SubjectConsent | null,
    };
  };

  try {
    const action = text('action', 30);

    if (action === 'save-rights') {
      await setMediaRights(db, { mediaId, ...values(), actorId: guard.account.account.id });
      return redirectTo(backTo, { saved: 'Rights recorded. The item\u2019s page now states them.' });
    }

    if (action === 'save-rights-bulk') {
      if (bulkIds.length === 0) {
        return redirectTo(backTo, { error: 'No items were selected, so nothing was changed.' });
      }
      if (bulkIds.length > MAX_BULK) {
        return redirectTo(backTo, {
          error: `${bulkIds.length} items were selected and this screen writes at most ${MAX_BULK} at a time. Nothing was changed.`,
        });
      }

      const result = await setMediaRightsBulk(db, { mediaIds: bulkIds, ...values(), actorId: guard.account.account.id });

      /*
       * A refusal is reported, never smoothed over. If one item in the batch could not take the change —
       * a publication permission with no basis, a living subject with no consent state — the editor is told
       * which and why, because "18 of 20 saved" printed as "saved" is how a gap becomes invisible.
       */
      if (result.refused.length > 0) {
        /*
         * `[first] = refused` rather than `refused[0]`, because `noUncheckedIndexedAccess` is on and a bare
         * index access is `T | undefined` however clear the length test above makes it. The first version of
         * this line used `refused[0]` and **the repository-wide typecheck went red for it**, which refuses
         * every commit in a shared tree — a local style choice that stopped four other passes. Destructure
         * instead of asserting, and say so, because the next person will reach for `!` otherwise.
         */
        const [first] = result.refused;
        return redirectTo(backTo, {
          error: `${result.written} of ${bulkIds.length} were recorded. ${result.refused.length} were refused` +
            `${first ? `; the first was item ${first.mediaId}: ${first.reason}` : ''}.`,
        });
      }
      return redirectTo(backTo, {
        saved: `${result.written} ${result.written === 1 ? 'item' : 'items'} recorded, each with its own entry in the audit trail.`,
      });
    }

    if (action === 'restrict' || action === 'lift') {
      await setMediaRestriction(db, {
        mediaId,
        restricted: action === 'restrict',
        reason: text('reason', 500),
        resolveTakedown: action === 'lift',
        actorId: guard.account.account.id,
      });
      return redirectTo(backTo, {
        saved: action === 'restrict'
          ? 'Restricted. The item is held for the record and marked unavailable for reuse.'
          : 'Restriction lifted, and the reason kept.',
      });
    }

    return redirectTo(backTo, { error: 'That action is not one this screen offers.' });
  } catch (error) {
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[admin/rights]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That could not be saved. Nothing was changed.' });
  }
}
