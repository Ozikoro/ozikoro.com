/**
 * POST /api/comments — write one comment on one page, as awaiting review.
 *
 * WHAT THIS ENDPOINT CANNOT DO, AND WHY THAT IS THE POINT
 *
 * It cannot publish. `postComment` names no state, the column's own default is `pending`, and
 * `moderateComment` is the only function in the codebase that can move a row out of `pending` — and it
 * checks the `moderate` capability before it does. So **a POST here creates something a reader cannot see**,
 * which is the owner's rule in his own words: *"comments are checked before they appear."*
 *
 * WHY A PLAIN FORM ENDPOINT AND NOT A FETCH
 *
 * The same reason `/api/library` is one: the design's own rule is that a page works without JavaScript, and
 * a form that needs a script is a form that fails on the connection the brief names. A `<form method="post">`,
 * a 303 back to the page, and the new state visible in the HTML the reader lands on.
 *
 * WHY THE GUARD RUNS BEFORE THE BODY IS READ
 *
 * `/api/library` and `/api/follows` both do this, and the reason is the same: `request.formData()` throws on
 * a request that carried no form, so reading first turns an anonymous POST into a 500. The guard answers an
 * anonymous request with a redirect to sign in — the thing that person can actually fix.
 *
 * And because the body has not been read, the address to return to comes from the `Referer` header, which is
 * available without touching the body. It is validated as a path on this site by `safeReturn`, so a crafted
 * header cannot turn the sign-in redirect into an open redirect.
 */
import { getDb } from '@ozituma/db/client';
import { COMMENT_MAX_LENGTH, MemberError, postComment } from '@ozikoro/platform';
import { redirectTo, requireUser, sameOrigin, jsonError, formBody } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only a path on this site may be returned to. The same rule `/api/library` states. */
function safeReturn(value: string, fallback: string): string {
  const path = value.trim();
  if (path.startsWith('/') && !path.startsWith('//')) return path;
  return fallback;
}

/** The page the browser says it posted from, as a path, or the fallback. */
function referringPath(request: Request): string {
  const referer = request.headers.get('referer') ?? '';
  if (!referer) return '/';
  try {
    const url = new URL(referer);
    if (url.pathname.length === 0) return '/';
    return safeReturn(url.pathname, '/');
  } catch {
    return '/';
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const guard = await requireUser({ returnTo: referringPath(request) });
  if (!guard.ok) return guard.response;
  const accountId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const rawPath = String(form.get('path') ?? '');
  const backTo = safeReturn(rawPath, '/');
  const body = String(form.get('body') ?? '');
  /*
   * THE TICK BOX IS READ BY PRESENCE, NOT BY VALUE. An unticked checkbox is ABSENT from a form body entirely
   * — it is not sent as an empty string — so `Boolean(...)` is the only correct reading of it. The `1` in the
   * markup is there so a ticked box says something rather than nothing.
   */
  const isSourceOrCorrection = Boolean(form.get('sourceOrCorrection'));

  if (body.length > COMMENT_MAX_LENGTH * 2) {
    return redirectTo(backTo, { error: 'That comment is too long. Nothing was saved.' });
  }

  const db = await getDb();
  try {
    await postComment(db, { accountId, rawPath, body, isSourceOrCorrection });
    return redirectTo(backTo, { comment: 'awaiting' });
  } catch (error) {
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[comments]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That comment was not saved. Nothing was changed.' });
  }
}
