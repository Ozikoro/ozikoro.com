/**
 * POST /api/auth/register · /api/auth/signin · /api/auth/signout
 *
 * Form-posting endpoints rather than JSON APIs, because they are used by plain
 * HTML forms. That means sign-up and sign-in work without JavaScript, and they
 * can be exercised with curl — which is how they are verified.
 *
 * Responses are 303 redirects so a refresh after submitting does not re-post.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import { AccountError, SESSION_COOKIE, authenticateAccount, createSession, isReviewer, registerAccount, revokeSession } from '@ozituma/db/accounts';
import {
  RESET_TTL_MINUTES,
  changeOwnPassword,
  markResetDelivered,
  requestPasswordReset,
  resetPasswordWithToken,
} from '@ozituma/db/passwords';
import { getCurrentAccount, sessionCookie, sessionMaxAgeSeconds } from '@/lib/session';
import { sendMail, siteAddress } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A 303 redirect to a RELATIVE location.
 *
 * Relative rather than absolute on purpose. `NextResponse.redirect` needs an
 * absolute URL, which would mean building one from OZITUMA_SITE_URL (wrong port
 * or host whenever it is unset or stale) or from the request's Host header
 * (which the caller controls, so it is an open-redirect vector). A relative
 * Location sidesteps both: the browser resolves it against the origin it already
 * used. 303 makes the follow-up a GET, so a refresh cannot resubmit the form.
 */
function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  const search = new URLSearchParams(params).toString();
  const location = search.length > 0 ? `${path}?${search}` : path;
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

function formValue(form: FormData, name: string, max = 400): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

function clientMeta(request: Request) {
  return {
    userAgent: request.headers.get('user-agent'),
    ipAddress:
      request.headers.get('x-forwarded-for') ??
      request.headers.get('x-real-ip') ??
      null,
  };
}

/**
 * The origin to build links from.
 *
 * OZITUMA_SITE_URL when it is set, because that is the address the site is
 * published under and a link in an email has to work from wherever it is read.
 * The request's own origin is the fallback, and it is only a fallback: behind a
 * proxy it can be the container's internal host, which would put an unusable
 * address in somebody's inbox.
 */
function siteOrigin(request: Request): string {
  const configured = process.env.OZITUMA_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(request.url).origin;
}

const RESET_TEMPLATE = (link: string, minutes: number) => ({
  text: [
    'Someone asked to set a new password for the Ozituma account using this address.',
    '',
    'If that was you, open this link:',
    link,
    '',
    `The link works once and stops working in ${minutes} minutes.`,
    '',
    `If it was not you, nothing has changed and nothing needs doing. Your password is`,
    `still the one you set, and nobody can use this message to reach the account: the`,
    `link is the only thing in it that does anything, and it will expire unused.`,
    '',
    'Ozituma — the Igbo dictionary',
    'https://ozituma.com',
  ].join('\n'),
  html: [
    '<p>Someone asked to set a new password for the Ozituma account using this address.</p>',
    '<p>If that was you, <a href="' + link + '">set a new password</a>.</p>',
    `<p>The link works once and stops working in ${minutes} minutes.</p>`,
    '<p>If it was not you, nothing has changed and nothing needs doing.</p>',
    '<hr>',
    '<p>Ozituma — the Igbo dictionary<br><a href="https://ozituma.com">ozituma.com</a></p>',
  ].join('\n'),
});

/**
 * POST /api/auth/change-password · /forgot · /reset
 *
 * Three more form endpoints, same shape as register and sign-in above, and for
 * the same reason: they have to work without JavaScript.
 *
 * `forgot` answers identically whether or not the address has an account. That is
 * the whole point of it — a form that says "no account with that address" is a
 * way to find out who is registered here.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> }
): Promise<NextResponse> {
  const { action } = await context.params;
  const form = await request.formData();
  const db = await getDb();
  const meta = clientMeta(request);

  if (action === 'change-password') {
    const current = await getCurrentAccount();
    if (!current) return redirectTo('/signin', { error: 'Sign in first.' });

    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const confirm = String(form.get('confirmPassword') ?? '');

    if (newPassword !== confirm) {
      return redirectTo('/account', { error: 'The two new passwords are not the same.' });
    }

    try {
      await changeOwnPassword(db, current.account.id, currentPassword, newPassword, {
        ...meta,
        // Keep this session: the person is standing in it, and signing them out of
        // the page they just used reads as a failure rather than a precaution.
        keepSessionToken: (await cookies()).get(SESSION_COOKIE)?.value ?? null,
      });
      return redirectTo('/account', { changed: '1' });
    } catch (error) {
      if (error instanceof AccountError) return redirectTo('/account', { error: error.message });
      console.error('[auth] change-password', error);
      return redirectTo('/account', { error: 'Something went wrong. Please try again.' });
    }
  }

  if (action === 'forgot') {
    const email = formValue(form, 'email', 200);
    if (!email) return redirectTo('/forgot', { error: 'An email address is needed.' });

    try {
      const link = await requestPasswordReset(db, email, meta);
      if (link) {
        const url = `${siteOrigin(request)}/reset?token=${encodeURIComponent(link.token)}`;
        const template = RESET_TEMPLATE(url, RESET_TTL_MINUTES);
        const sent = await sendMail({
          to: link.account.email,
          subject: 'Set a new password for Ozituma',
          text: template.text,
          html: template.html,
          replyTo: siteAddress(),
        });
        if (sent.delivered) {
          await markResetDelivered(db, link.token, 'email');
        } else {
          /*
           * Mail is not configured, or the server refused it. The request stands:
           * an administrator can see it on the review page and hand the link over,
           * which is why the failure is not silent. The link itself is never logged
           * — it is a live key for the account, and a log is a copy of it.
           */
          console.error(
            `[auth] password reset for ${link.account.email} could not be emailed: ${sent.error}`
          );
        }
      }
    } catch (error) {
      console.error('[auth] forgot', error);
    }

    // One answer for every case: sent, no such account, suspended, or mail is off.
    return redirectTo('/forgot', { sent: '1' });
  }

  if (action === 'reset') {
    const token = formValue(form, 'token', 400);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirmPassword') ?? '');

    if (password !== confirm) {
      return redirectTo(`/reset?token=${encodeURIComponent(token)}`, {
        error: 'The two passwords are not the same.',
      });
    }

    try {
      const account = await resetPasswordWithToken(db, token, password, meta);
      // Every session was revoked by the reset, including any the person taking the
      // account back did not open, so they sign in fresh.
      return redirectTo('/signin', {
        reset: '1',
        email: account.email,
      });
    } catch (error) {
      if (error instanceof AccountError) {
        return redirectTo(`/reset?token=${encodeURIComponent(token)}`, { error: error.message });
      }
      console.error('[auth] reset', error);
      return redirectTo(`/reset?token=${encodeURIComponent(token)}`, {
        error: 'Something went wrong. Please try again.',
      });
    }
  }

  /*
   * Sign-out, registration and sign-in were the original three; they share the
   * tail of this handler because their request and response shapes are identical
   * and keeping them together means the session cookie is set in exactly one
   * place, so a fix to it cannot be applied to one flow and forgotten in the other.
   */
  if (action === 'signout') {
    // Revoke server-side as well as clearing the cookie. Clearing alone would
    // leave a still-valid token in the hands of anyone who had copied it.
    const store = await cookies();
    const raw = store.get(SESSION_COOKIE)?.value;
    if (raw) await revokeSession(db, raw);

    const response = redirectTo('/');
    const cookie = sessionCookie();
    response.cookies.set(cookie.name, '', { ...cookie.options, maxAge: 0 });
    return response;
  }

  if (action !== 'register' && action !== 'signin') {
    return redirectTo('/join', { error: 'Unknown action.' });
  }

  const email = formValue(form, 'email', 200);
  const password = String(form.get('password') ?? '');
  const backTo = action === 'register' ? '/join' : '/signin';

  if (!email || !password) {
    return redirectTo(backTo, { error: 'Email and password are both required.' });
  }

  try {
    const account =
      action === 'register'
        ? await registerAccount(db, {
            email,
            password,
            displayName: formValue(form, 'displayName', 80) || null,
          })
        : await authenticateAccount(db, email, password);

    if (!account) {
      // Same message for wrong password and unknown account, so this endpoint
      // cannot be used to discover which emails are registered.
      return redirectTo(backTo, { error: 'Those details did not match an account.' });
    }

    const session = await createSession(db, account.id, meta);

    // A brand-new account is a contributor; an editor goes to the queue.
    const destination = isReviewer(account.role) ? '/review' : '/contribute';
    const response = redirectTo(destination, { welcome: '1' });
    const cookie = sessionCookie(sessionMaxAgeSeconds());
    response.cookies.set(cookie.name, session.token, cookie.options);
    return response;
  } catch (error) {
    if (error instanceof AccountError) {
      return redirectTo(backTo, { error: error.message });
    }
    console.error('[auth]', error);
    return redirectTo(backTo, { error: 'Something went wrong. Please try again.' });
  }
}
