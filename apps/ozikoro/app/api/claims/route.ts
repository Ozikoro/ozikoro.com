/**
 * POST /api/claims — an author claiming their own byline, and an editor deciding.
 *
 * The problem this solves is specific and real. Eleven people wrote the 1,051 records that were
 * migrated. Their bylines are in the archive and they have no accounts, so the archive attributes
 * work to names that cannot answer for it — and a byline nobody can claim is a byline nobody can
 * correct.
 *
 * Two acts, two capabilities:
 *
 *   * Requesting a claim needs only an account. The person who wrote the work is not an editor, and
 *     requiring a role to claim your own writing would lock out every one of the eleven.
 *   * Deciding a claim needs `manage_contributors`, because approving a claim hands somebody the
 *     authorship of published records and the power to change them.
 *
 * The decision is deliberately not automatic on a matching email address. The archive does not hold
 * an email for any of the eleven contributors — the column does not exist — so there is nothing to
 * match against, and a rule that guessed from a name would hand a byline to whoever registered a
 * similar one first.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError, decideContributorClaim, requestContributorClaim } from '@ozikoro/platform';
import { redirectTo, requireCapability, requireUser, sameOrigin, jsonError } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const action = String(form.get('action') ?? '').trim().slice(0, 30);
  const backTo = String(form.get('returnTo') ?? '/claims/').trim().slice(0, 200) || '/claims/';

  if (action === 'decide') {
    const guard = await requireCapability('manage_contributors', { returnTo: backTo });
    if (!guard.ok) return guard.response;
    const db = await getDb();
    try {
      await decideContributorClaim(db, {
        claimId: Number(form.get('claimId')),
        approve: String(form.get('decision') ?? '') === 'approve',
        actorId: guard.account.account.id,
        note: String(form.get('note') ?? '').trim().slice(0, 1000) || null,
      });
      return redirectTo(backTo, { saved: 'Decision recorded and the author told.' });
    } catch (error) {
      if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
      console.error('[claims]', String(error).slice(0, 300));
      return redirectTo(backTo, { error: 'That could not be saved. Nothing was changed.' });
    }
  }

  // Requesting needs a signed-in account and nothing more: it is the author's own byline.
  const guard = await requireUser({ returnTo: backTo });
  if (!guard.ok) return guard.response;
  const db = await getDb();
  try {
    await requestContributorClaim(db, {
      contributorId: Number(form.get('contributorId')),
      accountId: guard.account.account.id,
      evidence: String(form.get('evidence') ?? '').trim().slice(0, 2000) || null,
    });
    return redirectTo(backTo, {
      saved: 'Claim submitted. An editor checks it against the archive before it is granted.',
    });
  } catch (error) {
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[claims]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That could not be submitted. Nothing was changed.' });
  }
}
