/**
 * POST /api/auth/signin · /api/auth/signout
 *
 * The Ozikoro site's own session endpoints.
 *
 * WHY THIS EXISTS RATHER THAN REUSING THE DICTIONARY'S
 *
 * It does not duplicate the authentication: `authenticateAccount`, `createSession`,
 * `revokeSession` and the cookie policy all live in `@ozituma/db/accounts` and are the same
 * code the dictionary uses against the same account table. What is per-app is only the HTTP
 * shape, and it has to be, because ozikoro.com and ozituma.com are different registrable
 * domains — a session cookie set on one is never sent to the other, so the dictionary's
 * sign-in route cannot serve this site no matter how it is called.
 *
 * So an administrator has one account and one password, and signs in once per domain. Proper
 * SSO across the two is a separate piece of work; pretending a cookie can do it would produce
 * a sign-in that silently does nothing.
 *
 * Form posts rather than JSON, and 303 redirects, for the same reasons as the dictionary's:
 * sign-in works without JavaScript, it can be exercised with curl, and a refresh after
 * submitting does not re-post.
 */
import { cookies } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import {
  AccountError,
  SESSION_COOKIE,
  authenticateAccount,
  createSession,
  isAdmin,
  revokeSession,
} from '@ozituma/db/accounts';
import { sessionCookie, sessionMaxAgeSeconds } from '@/lib/session';
import { sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A 303 to a relative path. Absolute URLs from a Host header would be an open redirect. */
function redirectTo(path: string, params: Record<string, string> = {}): Response {
  const search = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 303,
    headers: { Location: search.length > 0 ? `${path}?${search}` : path },
  });
}

/** Only ever a path on this site, so `?next=` cannot be turned into a redirect elsewhere. */
function safeNext(value: string | null): string {
  const path = (value ?? '').trim();
  if (path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')) return path;
  return '/admin';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> }
): Promise<Response> {
  const { action } = await context.params;
  const form = await request.formData();
  const db = await getDb();

  if (action === 'signout') {
    const store = await cookies();
    const raw = store.get(SESSION_COOKIE)?.value;
    // Revoked server-side as well as cleared: clearing the cookie alone would leave a working
    // token in the hands of anyone who had copied it.
    if (raw) await revokeSession(db, raw);

    const response = redirectTo('/');
    const cookie = sessionCookie();
    response.headers.append('Set-Cookie', serializeCookie(cookie.name, '', { ...cookie.options, maxAge: 0 }));
    return response;
  }

  if (action !== 'signin') {
    return redirectTo('/signin', { error: 'Unknown action.' });
  }

  if (!sameOrigin(request)) {
    return redirectTo('/signin', { error: 'That request did not come from this site.' });
  }

  const email = String(form.get('email') ?? '').trim().slice(0, 200);
  const password = String(form.get('password') ?? '');
  const next = safeNext(form.get('next')?.toString() ?? null);

  if (!email || !password) {
    return redirectTo('/signin', { error: 'Email and password are both required.', next });
  }

  try {
    const account = await authenticateAccount(db, email, password);
    if (!account) {
      // One message for a wrong password and for an unknown account, so this endpoint cannot
      // be used to discover which addresses are registered.
      return redirectTo('/signin', { error: 'Those details did not match an account.', next });
    }

    const session = await createSession(db, account.id, {
      userAgent: request.headers.get('user-agent'),
      ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
    });

    /*
     * A signed-in account that is not an administrator is sent to the sign-in page with a
     * plain explanation rather than into an admin area it cannot use. The credentials were
     * valid, so this is not a failed sign-in and is not worded like one.
     */
    const destination = isAdmin(account.role) ? next : '/signin';
    const params: Record<string, string> = isAdmin(account.role)
      ? { welcome: '1' }
      : { error: 'That account is not an administrator on this site.' };

    const response = redirectTo(destination, params);
    const cookie = sessionCookie(sessionMaxAgeSeconds());
    response.headers.append('Set-Cookie', serializeCookie(cookie.name, session.token, cookie.options));
    return response;
  } catch (error) {
    if (error instanceof AccountError) return redirectTo('/signin', { error: error.message, next });
    console.error('[ozikoro/auth]', error);
    return redirectTo('/signin', { error: 'Something went wrong. Please try again.', next });
  }
}

/**
 * A cookie header, written by hand.
 *
 * `NextResponse` would do this, but this route builds its response as a plain `Response` so
 * that the redirect target is always a relative Location, and `Response` has no cookie helper.
 * The attributes come from the shared `sessionCookieOptions`, so the security policy still has
 * exactly one definition.
 */
function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly?: boolean; sameSite?: string; secure?: boolean; path?: string; domain?: string; maxAge?: number }
): string {
  const parts = [`${name}=${value}`, `Path=${options.path ?? '/'}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite === 'lax' ? 'Lax' : options.sameSite}`);
  return parts.join('; ');
}

/** A GET on this route is a mistake, and saying so is better than a 405 with no body. */
export async function GET(): Promise<Response> {
  return redirectTo('/signin');
}
