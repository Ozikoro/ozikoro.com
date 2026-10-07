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
/*
 * The recovery flow's library, which already existed when this route did not.
 *
 * `requestPasswordReset` stores a random token only as a SHA-256 hash, voids any earlier open link, and
 * returns `null` for an address with no account — **the enumeration-safe answer is the library's, not an
 * invention of this route.** `resetPasswordWithToken` checks the link before spending it, so a password the
 * policy refuses does not cost the person their link, then writes the password, audits the change, voids
 * every other open link and revokes every session. Reusing it is why this route is short.
 */
import {
  RESET_TTL_MINUTES,
  changeOwnPassword,
  markResetDelivered,
  requestPasswordReset,
  resetPasswordWithToken,
} from '@ozituma/db/passwords';
import { sendMail, siteAddress } from '@ozituma/core';
import { capabilitiesFor } from '@ozikoro/platform';
import { getCurrentAccount, sessionCookie, sessionMaxAgeSeconds } from '@/lib/session';
import { mayEnterBackOffice, sameOrigin } from '@/lib/access';
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

/**
 * Does the caller want a machine-readable answer?
 *
 * The design's pages post with `accept: application/json` so they can put the server's own sentence
 * beside the form. A browser with JavaScript off posts the same form without that header and is answered
 * with a 303 carrying the message in the query string, which is what every other endpoint here does.
 * **Both shapes exist because recovery must work without JavaScript**, and a fetch response cannot be the
 * only way in.
 */
function wantsJson(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

/** The same answer in whichever of the two shapes the caller asked for. */
function answer(
  request: Request,
  json: { status: number; body: Record<string, unknown>; headers?: Record<string, string> },
  path: string,
  params: Record<string, string> = {}
): Response {
  if (wantsJson(request)) {
    return Response.json(json.body, {
      status: json.status,
      headers: { 'Cache-Control': 'no-store', ...(json.headers ?? {}) },
    });
  }
  const response = redirectTo(path, params);
  for (const [name, value] of Object.entries(json.headers ?? {})) response.headers.set(name, value);
  return response;
}

/**
 * The origin a link in an email has to be built from.
 *
 * `OZITUMA_SITE_URL` first, because an email is read somewhere else and the link has to work from there.
 * The request's own origin is only a fallback: behind a proxy it can be the container's internal name,
 * which would put an address in somebody's inbox that resolves to nothing.
 */
function siteOrigin(request: Request): string {
  const configured = process.env.OZITUMA_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(request.url).origin;
}

/**
 * The recovery message.
 *
 * Plain and text-forward, in the archive's register: no marketing tone, no exclamation marks, and no
 * claim about the archive that the archive cannot stand behind. Three things have to be in it, because a
 * person who cannot sign in cannot come back to the site to find them out — the link, how long it lasts,
 * and what to do if they did not ask for it. **Both parts are always sent**: some clients show nothing
 * but the text one, and a recovery message that arrives empty is indistinguishable from a broken site.
 */
const RESET_TEMPLATE = (link: string, minutes: number) => ({
  text: [
    'Someone asked to set a new password for the Ozikoro account at this address.',
    '',
    'If that was you, open this link:',
    link,
    '',
    `The link works once, and it stops working ${minutes} minutes from now.`,
    '',
    'If it was not you, nothing has changed and nothing needs doing. Your password is still the',
    'one you set, and this message cannot reach the account on its own — the link is the only thing',
    'in it that does anything, and it expires unused.',
    '',
    'Ozikoro — history and archive',
    'https://ozikoro.com',
  ].join('\n'),
  html: [
    '<p>Someone asked to set a new password for the Ozikoro account at this address.</p>',
    `<p>If that was you, <a href="${link}">set a new password</a>.</p>`,
    `<p>The link works once, and it stops working ${minutes} minutes from now.</p>`,
    '<p>If it was not you, nothing has changed and nothing needs doing.</p>',
    '<hr>',
    '<p>Ozikoro — history and archive<br><a href="https://ozikoro.com">ozikoro.com</a></p>',
  ].join('\n'),
});

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
   *   account                  the credentials, shared with ozituma.com
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

  /*
   * FORGOTTEN PASSWORD, WHICH THE PAGE HAD A LINK FOR AND NO ENDPOINT BEHIND.
   *
   * THE ONE ANSWER, FOR EVERY CASE.
   *
   * "If that address has an account here, a link is on its way to it" is the whole reply, and it is the
   * reply whether the account exists, is suspended, has no password, or whether mail is switched off
   * entirely. **The alternative is an account-enumeration oracle**: a form that says "no account with that
   * address" answers, for anybody who types an address into it, the question "does this person have an
   * account on Ozikoro". That is a real disclosure on a site whose members are researchers, and it is why
   * the branch that decides is inside `requestPasswordReset` and its answer is not passed on.
   *
   * The one thing that DOES differ is the rate limit, and it is keyed on the client rather than on the
   * address, so it says nothing about whether the address is registered. Five an hour, the same ceiling
   * registration uses, because both make the server send a message on a stranger's behalf.
   */
  if (action === 'forgot') {
    if (!sameOrigin(request)) {
      return answer(
        request,
        { status: 403, body: { ok: false, error: 'That request did not come from this site.' } },
        '/forgot',
        { error: 'That request did not come from this site.' }
      );
    }

    const limit = rateLimit(`forgot:${clientKey(request)}`, { limit: 5, windowSeconds: 3600 });
    if (!limit.allowed) {
      const message = 'Too many attempts. Try again shortly.';
      return answer(
        request,
        {
          status: 429,
          body: { ok: false, error: message, retryAfterSeconds: limit.retryAfterSeconds },
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        },
        '/forgot',
        { error: message }
      );
    }

    const email = String(form.get('email') ?? '').trim().slice(0, 200);

    try {
      const link = await requestPasswordReset(db, email, {
        userAgent: request.headers.get('user-agent'),
        ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
      });

      if (link) {
        const url = `${siteOrigin(request)}/reset/?token=${encodeURIComponent(link.token)}`;
        const template = RESET_TEMPLATE(url, RESET_TTL_MINUTES);
        const sent = await sendMail({
          to: link.account.email,
          subject: 'Set a new password for your Ozikoro account',
          text: template.text,
          html: template.html,
          replyTo: siteAddress(),
        });
        if (sent.delivered) {
          await markResetDelivered(db, link.token, 'email');
          /*
           * The provider's own identifier, so a message that was ACCEPTED and never arrived can be traced
           * with the provider. **The link is never logged, and neither is the address**: the link is a live
           * key for the account and a log is a copy of it, and the address is the one thing this endpoint
           * exists to avoid disclosing. The id says nothing about either.
           */
          console.log(
            `[ozikoro/auth] reset link accepted by ${sent.transport}${sent.id ? ` (id ${sent.id})` : ''}`
          );
        } else {
          /*
           * The request stands even when the message did not leave: `listOpenResetRequests` shows it to an
           * administrator, who can pass the link on by hand. **The link itself is never logged** — it is a
           * live key for the account, and a log is a copy of it. The transport's own words are logged,
           * because "Resend refused the message (403): domain is not verified" is the sentence that gets
           * mail fixed.
           */
          console.error(`[ozikoro/auth] password reset for ${link.account.email} was not emailed: ${sent.error}`);
        }
      }
    } catch (error) {
      console.error('[ozikoro/auth] forgot', error);
    }

    const message =
      'If that address has an account here, a link to set a new password has been sent to it. ' +
      `It works once and it stops working in ${RESET_TTL_MINUTES} minutes.`;
    return answer(request, { status: 200, body: { ok: true, message } }, '/forgot', { sent: '1' });
  }

  /*
   * SETTING THE NEW PASSWORD.
   *
   * Every refusal sends the person back to the form with the token still in the address, so a mistyped
   * confirmation costs them nothing — the link is only spent once a password has been accepted, which is
   * the order `resetPasswordWithToken` enforces.
   *
   * NO SESSION IS CREATED HERE, DELIBERATELY. `writePassword` revokes every session on the account, because
   * if the reason for the reset is that somebody else had the password, the session they opened with it is
   * the thing that most needs closing. Minting a new one in the same request would partly undo that, so the
   * person signs in fresh with the password they have just chosen.
   */
  if (action === 'reset') {
    if (!sameOrigin(request)) {
      return answer(
        request,
        { status: 403, body: { ok: false, error: 'That request did not come from this site.' } },
        '/reset',
        { error: 'That request did not come from this site.' }
      );
    }

    const token = String(form.get('token') ?? '').slice(0, 400);
    const password = String(form.get('password') ?? '');
    const passwordAgain = String(form.get('password_again') ?? '');

    // The same rule registration applies, in the same words, because two forms that disagree about what a
    // password is are two forms that will be fixed separately and drift.
    if (password !== passwordAgain) {
      const message = 'Those two passwords are not the same.';
      return answer(request, { status: 400, body: { ok: false, error: message } }, '/reset', {
        token,
        error: message,
      });
    }

    try {
      const account = await resetPasswordWithToken(db, token, password, {
        userAgent: request.headers.get('user-agent'),
        ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
      });

      const message = 'Your password has been changed. Sign in with the new one.';
      return answer(
        request,
        {
          status: 200,
          body: { ok: true, message, next: `/signin/?reset=1&email=${encodeURIComponent(account.email)}` },
        },
        '/signin',
        { reset: '1', email: account.email }
      );
    } catch (error) {
      const message =
        error instanceof AccountError ? error.message : 'Something went wrong. Please try again.';
      if (!(error instanceof AccountError)) console.error('[ozikoro/auth] reset', error);
      return answer(request, { status: 400, body: { ok: false, error: message } }, '/reset', {
        token,
        error: message,
      });
    }
  }

  /*
   * CHANGING THE PASSWORD OF THE ACCOUNT YOU ARE ALREADY SIGNED IN AS.
   *
   * THE OWNER'S REPORT, VERBATIM: **"why is users not able to change their passwords? everyone should be
   * able to change their passwords."** He was right, and this is the missing half of the feature. `/forgot/`
   * has existed and sends a recovery link; what a signed-in person had no way to do was replace a password
   * they still knew. `/account/page.tsx` said so in its own words — *"no 'change password'"* — and a
   * recovery email is a poor substitute for a change form **even when the mail arrives**, because it costs
   * the person their session, their inbox round-trip and any other open link.
   *
   * ── WHY THE CURRENT PASSWORD IS REQUIRED, AND WHY THAT IS THE ENTIRE POINT ────────────────────────────
   *
   * `changeOwnPassword` demands it and this route must not try to avoid that. **A form that swaps the
   * password without the old one turns a borrowed session into a permanent account takeover**: anyone at an
   * unlocked machine, or holding a copied cookie, could set a new password and lock the real owner out of
   * their own account forever. The session proves *a* browser signed in at some point; the current password
   * is the only thing that proves *this person* is the account holder. That is the difference between a
   * change-password and a password *reset*, and it is why this route cannot be a thin alias for `reset`.
   *
   * ── IT REUSES THE ONE HASHING PATH, WHICH IS THE RULE THIS REPOSITORY ALREADY SET ─────────────────────
   *
   * `changeOwnPassword` calls the same `hashPassword` (scrypt, per-password salt), the same
   * `assertPasswordAcceptable` (ten-character minimum, email rejected) and the same private `writePassword`
   * that `join` and `reset` use. **Nothing about hashing or policy is re-implemented here**, so the three
   * ways a password changes cannot drift apart. `packages/db/src/passwords.ts` says the quiet part out loud:
   * *"every path that writes `account.password_hash` is in one place, and there is exactly one of them."*
   *
   * ── THE SESSION SURVIVES THE CHANGE, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT ──────────────────
   *
   * `writePassword` revokes every session on the account, because that is right when the reason for the
   * change is that somebody else has the password. The token doing the changing is passed through
   * `keepSessionToken` so the person is not thrown out of the page they just used — signing somebody out of
   * the page where they just succeeded reads as a failure, not a precaution. **Every OTHER session is still
   * closed**, which is the part that matters, and the page says so in as many words.
   *
   * ── ANSWERED IN BOTH SHAPES, LIKE EVERY OTHER FORM HERE ──────────────────────────────────────────────
   *
   * `answer()` gives a JSON body to a caller that asked for `application/json` and a 303 carrying the message
   * in the query string to one that did not, so the form works with JavaScript off — the same rule `forgot`
   * and `reset` follow.
   */
  if (action === 'change-password') {
    if (!sameOrigin(request)) {
      return answer(
        request,
        { status: 403, body: { ok: false, error: 'That request did not come from this site.' } },
        '/account',
        { error: 'That request did not come from this site.' }
      );
    }

    /*
     * A SIGNED-OUT REQUEST IS REFUSED, AND REFUSED BEFORE ANY PASSWORD IS READ.
     *
     * The account comes from the session cookie and from nothing the form sends: **no account id is accepted
     * from the client**, so this endpoint cannot be pointed at somebody else's account by editing the form.
     */
    const current = await getCurrentAccount();
    if (!current) {
      return answer(
        request,
        { status: 401, body: { ok: false, error: 'Sign in to change your password.' } },
        '/signin',
        { error: 'Sign in to change your password.' }
      );
    }

    /*
     * Rate limited per ACCOUNT, like sign-in, and for the same reason: without it this form is an unlimited
     * oracle for guessing the current password of a session somebody has borrowed. Ten in five minutes,
     * which no honest typist reaches and a guesser cannot use.
     */
    const limit = rateLimit(`change-password:${current.account.id}`, { limit: 10, windowSeconds: 300 });
    if (!limit.allowed) {
      const message = 'Too many attempts. Wait a few minutes and try again.';
      return answer(
        request,
        {
          status: 429,
          body: { ok: false, error: message, retryAfterSeconds: limit.retryAfterSeconds },
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        },
        '/account',
        { error: message }
      );
    }

    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const newPasswordAgain = String(form.get('confirmPassword') ?? '');

    // Checked here rather than in the library because it is a property of this form, not of the password:
    // `changeOwnPassword` never sees the second field. The words match `register`'s and `reset`'s.
    if (newPassword !== newPasswordAgain) {
      const message = 'The two new passwords are not the same.';
      return answer(request, { status: 400, body: { ok: false, error: message } }, '/account', {
        error: message,
      });
    }

    try {
      await changeOwnPassword(db, current.account.id, currentPassword, newPassword, {
        userAgent: request.headers.get('user-agent'),
        ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
        // The session doing the changing is the one that survives; `writePassword` closes all the others.
        keepSessionToken: (await cookies()).get(SESSION_COOKIE)?.value ?? null,
      });

      const message =
        'Your password is changed. Every other device that was signed in has been signed out.';
      return answer(request, { status: 200, body: { ok: true, message } }, '/account', {
        changed: '1',
      });
    } catch (error) {
      /*
       * A WRONG CURRENT PASSWORD IS AN EXPECTED ANSWER, NOT A CRASH, and it is answered with the library's
       * own sentence — "That is not your current password." — beside the form. Anything that is not an
       * `AccountError` is a real fault and is logged rather than dressed up as a policy refusal.
       */
      const message =
        error instanceof AccountError ? error.message : 'Something went wrong. Please try again.';
      if (!(error instanceof AccountError)) console.error('[ozikoro/auth] change-password', error);
      return answer(request, { status: 400, body: { ok: false, error: message } }, '/account', {
        error: message,
      });
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
     * WHO THIS DOOR ADMITS, WHICH IS NO LONGER ONLY AN ADMINISTRATOR.
     *
     * It used to be `isAdmin(account.role)` and nothing else: a valid password on an account that was not the
     * dictionary's administrator produced **"That account is not an administrator on this site."** and sent
     * the person back to the sign-in page. **That made the owner's rule unusable from a browser**, because an
     * archive editor holds twenty-four capabilities and had no way in through the front door at all: the
     * editor role lives in `ozikoro_member_role`, not in the platform's `account_role`, so `isAdmin` is false
     * for every one of them.
     *
     * The admission test is now the SAME ONE THE BACK OFFICE ITSELF USES — `mayEnterBackOffice`, which the
     * admin layout has always applied. **A sign-in that admits somebody the layout then refuses would be a
     * page that redirects in a loop; a sign-in that refuses somebody the layout admits is a role that cannot
     * be used.** One function, asked in both places, is what stops the two answers diverging.
     *
     * The credentials were valid in every case here, so a refusal is still not worded like a failed sign-in —
     * and an account with no archive role at all still gets one, because the archive is not their door.
     */
    const capabilities = await capabilitiesFor(db, account.id);
    const admitted = isAdmin(account.role) || mayEnterBackOffice(account.role, capabilities);
    const destination = admitted ? next : '/signin';
    const params: Record<string, string> = admitted
      ? { welcome: '1' }
      : { error: 'That account has no role in this archive. Sign in at ozituma.com, or ask the archive for a role.' };

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
