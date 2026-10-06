/**
 * POST /api/admin/comments — approve or reject one waiting comment.
 *
 * WHY THIS IS NOT `/admin/reviews`
 *
 * The owner's instruction was to check whether an existing screen is the right home before inventing one, and
 * two candidates were measured rather than assumed:
 *
 *   `/admin/moderation`   **DOES NOT EXIST.** The design deliverable draws a `dashboard-moderation` screen
 *                         and `/admin/claims` is where `design-fill.ts` points the design's *Moderation*
 *                         link, but there is no such route and no such screen in this administration.
 *   `/admin/reviews`      **EXISTS, AND IS THE WRONG HOME FOR TWO MEASURED REASONS.** Its own guard is
 *                         `requireCapabilityOrRedirect('edit_entity', …)`, and a `moderator` holds `moderate`,
 *                         `read` and `review_reports` — **not `edit_entity`** — so the one role whose
 *                         definition is *"Reports, moderation of users and content, and escalation"* cannot
 *                         open it. And its own header states the rule against it: *"They are different
 *                         subjects with different state machines, so they are two panels"* — a comment
 *                         awaiting a check is a third subject with a third state machine, and folding it into
 *                         a queue that is already two panels is the mistake that header records.
 *
 * So the screen is `/admin/comments/`, gated on `moderate` — the capability the vocabulary already holds for
 * exactly this act.
 *
 * THE CAPABILITY IS CHECKED TWICE, ON PURPOSE
 *
 * Here, because a form endpoint must refuse before it reads anything; and again inside `moderateComment`,
 * because **the check at the door is a check the next caller has to remember, and the write path is where the
 * archive's own rule lives** — the same reason `purgeArticle` and `purgeMedia` call their own `requirePurge`.
 * A script or a job that reaches the store directly is refused by the same rule.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError, moderateComment } from '@ozikoro/platform';
import { redirectTo, requireCapability, sameOrigin, jsonError, formBody } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const guard = await requireCapability('moderate', { returnTo: '/admin/comments/' });
  if (!guard.ok) return guard.response;
  const moderatorId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const id = Number(form.get('id'));
  const decision = String(form.get('decision') ?? '').trim();
  if (decision !== 'approve' && decision !== 'reject') {
    return redirectTo('/admin/comments/', { error: 'That is not a decision this screen makes.' });
  }

  const db = await getDb();
  try {
    const state = await moderateComment(db, { id, approve: decision === 'approve', moderatorId });
    return redirectTo('/admin/comments/', {
      saved:
        state === 'approved'
          ? 'Approved. The comment is on its page now.'
          : 'Rejected. The comment is not shown, and the decision is recorded.',
    });
  } catch (error) {
    if (error instanceof MemberError) return redirectTo('/admin/comments/', { error: error.message });
    console.error('[admin/comments]', String(error).slice(0, 300));
    return redirectTo('/admin/comments/', { error: 'That decision was not saved. Nothing was changed.' });
  }
}
