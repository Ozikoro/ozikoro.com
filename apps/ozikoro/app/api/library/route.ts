/**
 * POST /api/library — save a record, unsave it, or forget that it was read.
 *
 * WHY THIS IS A PLAIN FORM ENDPOINT AND NOT A FETCH
 *
 * The design's rule, stated at the top of `/search/`, is that the whole page works without JavaScript —
 * *"a search box that needs a script is a search box that fails on the poor connection the brief names."*
 * A save is a smaller act than a search and gets the same treatment: a `<form method="post">`, a 303 back
 * to the page the reader was on, and the new state visible in the HTML they land on. Nothing here needs a
 * client bundle, and a reader with a slow connection gets the same archive as everybody else.
 *
 * WHY `on` IS POSTED RATHER THAN TOGGLED, AND WHY IT IS SENT TWICE
 *
 * The form says what it wants the state to be. **A toggle is a function of the current state, so two tabs —
 * or one double submit — each flip the same row and land somewhere neither reader asked for.** The
 * `/api/follows` endpoint records the same reasoning, and this one follows it. The `on` field is carried in
 * the form *and* checked against the action, because a save form and an unsave form are two different
 * buttons and the endpoint should not have to infer which one was pressed from the absence of a value.
 *
 * WHY A READ IS NOT RECORDED HERE
 *
 * Reading is not an act the reader performs on the archive, so there is no button for it: the record route
 * calls `recordRead` itself when a signed-in reader opens a page. What *is* here is `forget`, because
 * deleting your own history is a deliberate act and it is the reader's to take.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError, forgetRead, setSaved } from '@ozikoro/platform';
import { redirectTo, requireUser, sameOrigin, jsonError, formBody } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Only a path on this site may be returned to.
 *
 * Without this a form on the site could send a reader to any address on the internet after a save, which
 * is the open-redirect shape. A leading `//` is a protocol-relative host and is refused too.
 */
function safeReturn(value: string, fallback: string): string {
  const path = value.trim();
  if (path.startsWith('/') && !path.startsWith('//')) return path;
  return fallback;
}

export async function POST(request: Request): Promise<Response> {
  /*
   * THE GUARD RUNS BEFORE THE BODY IS READ, following `/api/admin/entities` and `/api/follows`: an unread
   * body is what lets an anonymous request be answered with a redirect to sign in rather than a 500 from
   * `request.formData()` throwing on a request that carried no form.
   */
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const guard = await requireUser({ returnTo: '/library/' });
  if (!guard.ok) return guard.response;
  const accountId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const backTo = safeReturn(String(form.get('returnTo') ?? ''), '/library/');
  const action = String(form.get('action') ?? '').trim();
  const articleId = Number(form.get('articleId'));

  const db = await getDb();

  try {
    if (action === 'save' || action === 'unsave') {
      if (!Number.isInteger(articleId) || articleId <= 0) {
        return redirectTo(backTo, { error: 'That record does not exist.' });
      }
      const on = action === 'save';
      await setSaved(db, { accountId, articleId, on });
      return redirectTo(backTo, {
        saved: on ? 'Saved to your library.' : 'Removed from your library.',
      });
    }

    if (action === 'forget') {
      if (!Number.isInteger(articleId) || articleId <= 0) {
        return redirectTo(backTo, { error: 'That record does not exist.' });
      }
      await forgetRead(db, { accountId, articleId });
      return redirectTo(backTo, { saved: 'Removed from your reading history.' });
    }

    return redirectTo(backTo, { error: 'That is not something this library does.' });
  } catch (error) {
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[library]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That could not be saved. Nothing was changed.' });
  }
}
