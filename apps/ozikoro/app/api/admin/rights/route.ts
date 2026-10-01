/**
 * POST /api/admin/rights — recording what the archive may do with an item.
 *
 * Gated on `manage_media_rights`, which the plan lists as an administrator's capability and which
 * editors deliberately do not hold: deciding that a photograph may be republished is a different act
 * from deciding that an article is accurate, and conflating them is how a rights problem becomes
 * somebody's legal problem.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError, setMediaRestriction, setMediaRights, type PermissionBasis, type SubjectConsent } from '@ozikoro/platform';
import { redirectTo, requireCapability } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const mediaId = Number(form.get('mediaId'));
  const backTo = Number.isInteger(mediaId) && mediaId > 0 ? `/admin/rights/?item=${mediaId}` : '/admin/rights/';

  const guard = await requireCapability('manage_media_rights', { returnTo: backTo });
  if (!guard.ok) return guard.response;

  const text = (name: string, max = 400) => String(form.get(name) ?? '').trim().slice(0, max);
  const flag = (name: string) => form.get(name) !== null;
  const db = await getDb();

  try {
    const action = text('action', 30);

    if (action === 'save-rights') {
      const basis = text('permissionBasis', 40);
      const consent = text('subjectConsent', 40);
      const living = text('subjectIsLiving', 10);

      await setMediaRights(db, {
        mediaId,
        holderName: text('holderName', 200) || null,
        holderContact: text('holderContact', 200) || null,
        allowsPublication: flag('allowsPublication'),
        allowsDerivative: flag('allowsDerivative'),
        allowsCommercial: flag('allowsCommercial'),
        licence: text('licence', 200) || null,
        licenceUrl: text('licenceUrl', 300) || null,
        permissionBasis: (basis || null) as PermissionBasis | null,
        permissionDate: text('permissionDate', 10) || null,
        permissionNote: text('permissionNote', 1000) || null,
        subjectIsLiving: living === '' ? null : living === 'yes',
        subjectConsent: (consent || null) as SubjectConsent | null,
        actorId: guard.account.account.id,
      });
      return redirectTo(backTo, { saved: 'Rights recorded. The item\u2019s page now states them.' });
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
