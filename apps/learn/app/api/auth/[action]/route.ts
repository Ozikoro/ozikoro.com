/**
 * POST /api/auth/signin · /api/auth/join · /api/auth/signout
 *
 * Form-posting endpoints, not a JSON API, for the same reason the dictionary's are: they are used
 * by plain HTML forms, so sign-up and sign-in work with JavaScript disabled and can be exercised
 * with curl.
 *
 * ONE ACCOUNT, BOTH SITES
 *
 * There is no learn-specific account table and no learn-specific session store. This route calls
 * the same `registerAccount`, `authenticateAccount` and `createSession` the dictionary calls, in the
 * same database, and sets the same `SESSION_COOKIE`. That is what makes an account created here work
 * on ozituma.com and an account created there work here.
 *
 * The cookie is host-only unless `OZITUMA_AUTH_COOKIE_DOMAIN` is set. Set to `.ozituma.com`, one
 * session covers both hostnames and a learner does not sign in twice. Left unset, both sites still
 * work and the same credentials still open the same account — the learner simply signs in on each.
 * That is a deliberate default, because a cookie domain that does not match the host is discarded
 * silently by every browser, so the safe default is the one that cannot break sign-in.
 *
 * THE DESTINATION
 *
 * A signed-in learner lands on /practice, which is the one surface that is open today. When the
 * Level 0 and 1 courses publish, this should return them to whatever they were reading — the
 * `?next=` parameter is accepted for that and deliberately restricted to same-site paths.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import {
  AccountError,
  SESSION_COOKIE,
  authenticateAccount,
  createSession,
  registerAccount,
  revokeSession,
} from '@ozituma/db/accounts';
import { getCurrentAccount, sessionCookie, sessionMaxAgeSeconds } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A 303 to a RELATIVE location.
 *
 * Relative rather than absolute for the reason the dictionary route documents at length: an absolute
 * URL needs either a configured origin (wrong whenever the variable is stale) or the request's Host
 * header (which the caller controls, making it an open-redirect vector). A relative Location is
 * resolved by the browser against the origin it already used. 303 makes the follow-up a GET, so a
 * refresh does not resubmit the form.
 */
function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  const search = new URLSearchParams(params).toString();
  return new NextResponse(null, {
    status: 303,
    headers: { Location: search.length > 0 ? `${path}?${search}` : path },
  });
}

function formValue(form: FormData, name: string, max = 400): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

/**
 * Read the posted form, tolerating a request that has none.
 *
 * `request.formData()` THROWS when the body is missing or the content type is not a form — it does
 * not return an empty FormData. Sign-out legitimately has no body, so parsing eagerly at the top of
 * the handler took the whole action down with
 *
 *   TypeError: Content-Type was not one of "multipart/form-data" or
 *   "application/x-www-form-urlencoded".
 *
 * A browser posting a real form always sends the right content type, which is why this survived a
 * hand-built curl and would have looked fine in a browser — while breaking any client that posts
 * an empty body, which is exactly what a `fetch('/api/auth/signout', {method:'POST'})` does.
 *
 * Returning an empty FormData keeps the downstream logic unchanged: the fields are simply absent,
 * and each action already decides for itself what a missing field means.
 */
async function readForm(request: Request): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  const isForm =
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data');
  if (!isForm) return new FormData();

  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
}

/**
 * Where to send a learner after they sign in.
 *
 * Restricted to a path on this site. `next=https://evil.example` would otherwise turn the sign-in
 * endpoint into an open redirect — and a convincing one, because the link would genuinely be on
 * learn.ozituma.com and arrive after a real sign-in.
 *
 * Both `//host` and `/\host` are rejected as well as a scheme. A protocol-relative URL is treated as
 * absolute by browsers, so checking only for `http` would miss it.
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/practice';
  if (!raw.startsWith('/')) return '/practice';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/practice';
  return raw;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> }
): Promise<NextResponse> {
  const { action } = await context.params;
  const form = await readForm(request);
  const db = await getDb();

  const meta = {
    userAgent: request.headers.get('user-agent'),
    ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
  };

  if (action === 'signout') {
    // Revoked server-side, not merely cleared. Clearing the cookie alone would leave a still-valid
    // token in the hands of anyone who had copied it.
    const store = await cookies();
    const raw = store.get(SESSION_COOKIE)?.value;
    if (raw) await revokeSession(db, raw);

    const response = redirectTo('/');
    const cookie = sessionCookie();
    response.cookies.set(cookie.name, '', { ...cookie.options, maxAge: 0 });
    return response;
  }

  if (action !== 'join' && action !== 'signin') {
    return redirectTo('/signin', { error: 'Unknown action.' });
  }

  const email = formValue(form, 'email', 200);
  const password = String(form.get('password') ?? '');
  const next = safeNext(formValue(form, 'next', 300) || null);
  const backTo = action === 'join' ? '/join' : '/signin';

  if (!email || !password) {
    return redirectTo(backTo, { error: 'Email and password are both required.' });
  }

  try {
    const account =
      action === 'join'
        ? await registerAccount(db, {
            email,
            password,
            displayName: formValue(form, 'displayName', 80) || null,
          })
        : await authenticateAccount(db, email, password);

    if (!account) {
      // One message for a wrong password and an unknown account alike, so this endpoint cannot be
      // used to discover which addresses are registered.
      return redirectTo(backTo, { error: 'Those details did not match an account.' });
    }

    const session = await createSession(db, account.id, meta);
    const response = redirectTo(next, action === 'join' ? { welcome: '1' } : {});
    const cookie = sessionCookie(sessionMaxAgeSeconds());
    response.cookies.set(cookie.name, session.token, cookie.options);
    return response;
  } catch (error) {
    if (error instanceof AccountError) {
      return redirectTo(backTo, { error: error.message });
    }
    console.error('[learn auth]', error);
    return redirectTo(backTo, { error: 'Something went wrong. Please try again.' });
  }
}

/**
 * GET is not a sign-in, but it is useful to say so rather than return a bare 405 that looks like a
 * broken page. A learner who bookmarks the endpoint, or a client that follows a redirect with GET,
 * gets told where to go instead of an error.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ action: string }> }
): Promise<NextResponse> {
  const { action } = await context.params;
  const current = await getCurrentAccount();
  if (current && action === 'signout') {
    // Signing out by GET would let any image tag on any page sign a learner out. Reported, not done.
    return NextResponse.json(
      { error: { code: 'method_not_allowed', message: 'Sign out by posting the form.' } },
      { status: 405, headers: { Allow: 'POST' } }
    );
  }
  return redirectTo(action === 'join' ? '/join' : '/signin');
}
