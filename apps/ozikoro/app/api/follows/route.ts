/**
 * POST /api/follows — follow, or stop following.
 *
 * WHY THIS IS GATED ON BEING SIGNED IN RATHER THAN ON A CAPABILITY
 *
 * Every role in the vocabulary holds `read`, and following is a reader's act — the plan lists
 * "bookmarks, follows, collections and reading history" as what the Reader role *is*. So requiring a
 * named capability would be inventing an authority that does not exist, and the honest gate is that
 * there is somebody signed in to keep the list.
 *
 * WHY `on` IS POSTED RATHER THAN ASSUMED
 *
 * The form says what it wants the state to be — `on=1` or `on=0` — and the endpoint makes that true.
 * A toggle would be a function of the current state, so two tabs, or a double submit, would each flip
 * the same row and land somewhere neither reader asked for. **"Make it so" is the same request
 * however many times it arrives**, which is also what makes a slow double-click harmless.
 *
 * WHAT A FOLLOW IS NOT
 *
 * It is not a subscription to anything that sends. The brief is explicit that the social features are
 * secondary, so this writes one row and nothing reads it to dispatch a message — the count on a
 * profile is the whole of its visible effect today, and a follow that never notifies anybody is a
 * smaller promise than one that does and fails.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError, setFollow } from '@ozikoro/platform';
import { redirectTo, requireUser, sameOrigin, jsonError, formBody } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only a path on this site may be returned to, and only the same-origin check above makes that safe. */
function safeReturn(value: string, fallback: string): string {
  const path = value.trim();
  if (path.startsWith('/') && !path.startsWith('//')) return path;
  return fallback;
}

export async function POST(request: Request): Promise<Response> {
  /*
   * THE GUARD RUNS BEFORE THE BODY IS READ. See the note in `/api/admin/entities`: an unread body is
   * what lets an anonymous request be answered with a redirect to sign in rather than a 500 from
   * `request.formData()` throwing on a request that carried no form.
   */
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const guard = await requireUser({ returnTo: '/' });
  if (!guard.ok) return guard.response;
  const accountId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const backTo = safeReturn(String(form.get('returnTo') ?? ''), '/');
  const on = String(form.get('on') ?? '') === '1';
  const kind = String(form.get('kind') ?? '').trim();

  const db = await getDb();

  try {
    if (kind === 'researcher') {
      const subjectAccountId = Number(form.get('subjectAccountId'));
      if (!Number.isInteger(subjectAccountId) || subjectAccountId <= 0) {
        return redirectTo(backTo, { error: 'That researcher does not exist.' });
      }
      await setFollow(db, { accountId, on, kind: 'researcher', subjectAccountId });
      return redirectTo(backTo, {
        saved: on ? 'Following. Their work appears on your own reading list.' : 'No longer following.',
      });
    }

    if (kind === 'topic') {
      const topicId = Number(form.get('topicId'));
      if (!Number.isInteger(topicId) || topicId <= 0) {
        return redirectTo(backTo, { error: 'That series does not exist.' });
      }
      await setFollow(db, { accountId, on, kind: 'topic', topicId });
      return redirectTo(backTo, { saved: on ? 'Following that series.' : 'No longer following that series.' });
    }

    if (kind === 'institution') {
      const institution = String(form.get('institution') ?? '').trim();
      if (institution.length === 0) return redirectTo(backTo, { error: 'Which institution?' });
      await setFollow(db, { accountId, on, kind: 'institution', institution });
      return redirectTo(backTo, {
        saved: on ? `Following work from ${institution}.` : `No longer following ${institution}.`,
      });
    }

    return redirectTo(backTo, { error: 'That is not something this site follows.' });
  } catch (error) {
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[follows]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That could not be saved. Nothing was changed.' });
  }
}
