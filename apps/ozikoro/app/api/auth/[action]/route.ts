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
  registerAccount,
  revokeSession,
} from '@ozituma/db/accounts';
import { sessionCookie, sessionMaxAgeSeconds } from '@/lib/session';
import { sameOrigin } from '@/lib/access';
import { clientKey, rateLimit } from '@/lib/rate-limit';

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

  /*
   * JOINING, WHICH IS THE OTHER HALF OF HAVING ACCOUNTS AT ALL.
   *
   * The owner's point: **"My Ozikoro" led straight to a sign-in form, and a sign-in form is no use to
   * somebody who has not joined.** Registration existed in the library — `registerAccount` has been there
   * since the dictionary — but no route exposed it, so the only people who could sign in were ones whose
   * accounts had been created for them.
   *
   * WHAT IT CREATES, IN ONE PLACE
   *
   *   account                  the credentials, shared with ozituma.com and learn.ozituma.com
   *   ozikoro_member           the public profile row the researcher pages read
   *   ozikoro_member_role      the `reader` grant, which every other role is added to
   *
   * **`reader` is the floor and it is granted on join**, because a member with no role can do nothing and
   * would see an empty dashboard. Every capability above reading is granted by an administrator afterwards,
   * and `manage_roles` is what lets them.
   */
  if (action === 'register') {
    if (!sameOrigin(request)) {
      return redirectTo('/join', { error: 'That request did not come from this site.' });
    }

    const limit = rateLimit(`register:${clientKey(request)}`, { limit: 5, windowSeconds: 3600 });
    if (!limit.allowed) {
      return redirectTo('/join', { error: 'Too many attempts. Try again shortly.' });
    }

    const email = String(form.get('email') ?? '').trim();
    const displayName = String(form.get('display_name') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const passwordAgain = String(form.get('password_again') ?? '');
    // `safeNext` falls back to `/admin`, which is right for an administrator signing in and wrong for
    // somebody who has just joined — **they are a reader, and `/admin` would refuse them.** So the fallback
    // is decided here rather than borrowed.
    const requested = String(form.get('next') ?? '').trim();
    const intent =
      requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\')
        ? requested
        : '/dashboard-reader';

    if (password !== passwordAgain) {
      return redirectTo('/join', { error: 'Those two passwords are not the same.', email, name: displayName });
    }

    try {
      const account = await registerAccount(db, { email, displayName, password });
      // The member profile and the floor role. `on conflict do nothing` so a re-run cannot double-grant.
      await db.query(
        `insert into ozikoro_member (account_id, display_name, is_public, status)
         values ($1, $2, false, 'active') on conflict (account_id) do nothing`,
        [account.id, displayName || null]
      );
      await db.query(
        `insert into ozikoro_member_role (account_id, role, note)
         values ($1, 'reader', 'Granted on joining.') on conflict do nothing`,
        [account.id]
      );

      // Signed in immediately: making somebody who has just chosen a password type it again is friction
      // with no security value, since the password was verified by the insert above.
      const { token } = await createSession(db, account.id, {
        userAgent: request.headers.get('user-agent'),
      });
      const response = redirectTo(intent);
      const cookie = sessionCookie(sessionMaxAgeSeconds());
      response.headers.append('Set-Cookie', serializeCookie(cookie.name, token, cookie.options));
      return response;
    } catch (error) {
      const message =
        error instanceof Error && 'code' in error
          ? error.message
          : 'That account could not be created.';
      return redirectTo('/join', { error: message, email, name: displayName });
    }
  }

  if (action !== 'signin') {
    return redirectTo('/signin', { error: 'Unknown action.' });
  }

  if (!sameOrigin(request)) {
    return redirectTo('/signin', { error: 'That request did not come from this site.' });
  }

  /*
   * Sign-in is rate limited, per client and per account.
   *
   * MEASURED BEFORE THIS WAS ADDED: twenty-five rapid failed sign-ins were sent, and attempts 1 and
   * 25 returned byte-identical responses — "Those details did not match an account" every time, with
   * no throttle header. The only rate limits in the application were on the four Spotify routes, so
   * the one endpoint an unauthenticated attacker can aim at indefinitely had none. Unlimited password
   * guessing is the difference between a password being a secret and a password being a search space.
   *
   * TWO KEYS, because they stop different attacks. The client key bounds how fast one address can
   * guess. The account key bounds how fast one ACCOUNT can be guessed at, which matters because an
   * attacker with many addresses would otherwise get a fresh allowance from each.
   *
   * The limit is generous enough for someone who has forgotten which password they used, and it is
   * not a lockout: it clears itself, so nobody can lock a real account out by guessing at it.
   * Permanent lockout is itself a denial of service on the account holder, and was rejected.
   *
   * The response has the same shape as every other failure here — a redirect carrying a message — so
   * it does not reveal whether an account exists.
   */
  const signinLimit = { limit: 10, windowSeconds: 300 };
  const submitted = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 200);
  const byClient = rateLimit(`signin-client:${clientKey(request)}`, signinLimit);
  const byAccount = rateLimit(`signin-account:${submitted}`, signinLimit);
  if (!byClient.allowed || !byAccount.allowed) {
    const retry = Math.max(byClient.retryAfterSeconds, byAccount.retryAfterSeconds);
    return new Response(null, {
      status: 303,
      headers: {
        Location: `/signin?error=${encodeURIComponent('Too many attempts. Wait a few minutes and try again.')}`,
        'Retry-After': String(retry),
      },
    });
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
