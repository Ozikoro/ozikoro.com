/**
 * POST /api/admin/password-link — make a recovery link for an account.
 *
 * WHY THIS EXISTS
 *
 * Email is not switched on for this site yet. Without this route a person who
 * forgets their password has no way back in at all, and the only alternative —
 * an administrator writing a new password and reading it down a phone line —
 * means the administrator knows a password that somebody else uses. A one-time
 * link is strictly better: it expires, it can only be used once, and it never
 * tells the person handing it over what the password ends up being.
 *
 * THE TOKEN IS IN THE RESPONSE BODY, NOT IN A URL
 *
 * There is no redirect here, because a redirect would put the token in the
 * address bar, in the browser history and in the server's own request log — three
 * copies of a live key for somebody's account. The response is a small page that
 * shows the link once and says so.
 *
 * Nothing here is a privilege escalation: an administrator can already set a
 * password on any account. This is the same power exercised in the form that
 * leaves the account holder in control of the secret.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { getAccountById, isAdmin } from '@ozituma/db/accounts';
import { RESET_TTL_MINUTES, markResetDelivered, requestPasswordReset } from '@ozituma/db/passwords';
import { getCurrentAccount } from '@/lib/session';
import { mailStatus, sendMail, siteAddress } from '@/lib/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 3rem 1.25rem; color: #1a1a1a; }
  main { max-width: 40rem; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  code { display: block; word-break: break-all; background: #f4f4f4; border: 1px solid #ddd;
         padding: 0.75rem; border-radius: 6px; font-size: 0.95rem; margin: 1rem 0; }
  p { margin: 0 0 1rem; }
  .muted { color: #666; font-size: 0.9rem; }
  a.button { display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none;
             padding: 0.6rem 1rem; border-radius: 6px; }
</style>
</head>
<body><main>${body}<p class="muted" style="margin-top:2rem"><a href="/admin">Back to the dashboard</a></p></main></body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current) {
    /*
     * A RELATIVE location, not `new URL('/signin', request.url)`. Behind the
     * proxy `request.url` is the container's own address, so the absolute form
     * sent an anonymous visitor to https://0.0.0.0:3000/signin — a redirect that
     * works on the developer's machine and nowhere else.
     */
    return new NextResponse(null, { status: 303, headers: { Location: '/signin' } });
  }
  if (!isAdmin(current.account.role)) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Only an administrator may issue a recovery link.' } },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const accountId = Number(form.get('accountId'));
  const how = String(form.get('how') ?? 'show');
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return page('No account chosen', '<h1>No account chosen</h1><p>That request had no account id.</p>', 400);
  }

  const db = await getDb();
  const account = await getAccountById(db, accountId);
  if (!account) {
    return page('No such account', '<h1>No such account</h1><p>That account no longer exists.</p>', 404);
  }

  const link = await requestPasswordReset(db, account.email, {
    userAgent: request.headers.get('user-agent'),
    ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip'),
  });
  if (!link) {
    return page(
      'No link made',
      `<h1>No link made</h1><p>${account.email} is not an active account, so a recovery link would ` +
        'be a dead end. Nothing was created.</p>',
      409
    );
  }

  const origin = (process.env.OZITUMA_SITE_URL ?? new URL(request.url).origin).replace(/\/+$/, '');
  const url = `${origin}/reset?token=${encodeURIComponent(link.token)}`;

  let sentNote = '';
  if (how === 'email') {
    const sent = await sendMail({
      to: account.email,
      subject: 'Set a new password for Ozituma',
      text: [
        `An administrator has made a link for the Ozituma account at ${account.email}.`,
        '',
        'Open it to set a new password:',
        url,
        '',
        `The link works once and stops working in ${RESET_TTL_MINUTES} minutes.`,
      ].join('\n'),
      replyTo: siteAddress(),
    });
    if (sent.delivered) {
      await markResetDelivered(db, link.token, 'email');
      sentNote = `<p>It has been emailed to <strong>${account.email}</strong>, and there is no need to pass the link on. It is shown below only in case the message does not arrive.</p>`;
    } else {
      sentNote = `<p><strong>It could not be emailed</strong> (${sent.error ?? 'unknown reason'}), so pass the link on by hand.</p>`;
    }
  } else {
    await markResetDelivered(db, link.token, 'hand');
  }

  const status = mailStatus();
  return page(
    'Recovery link',
    `<h1>Recovery link for ${account.email}</h1>
     ${sentNote}
     <p>Send this to them, or read it out. It can be used once:</p>
     <code>${url}</code>
     <p class="muted">It stops working in ${RESET_TTL_MINUTES} minutes, and it stops working sooner
     if they ask for another one or change their password. This page will not show it again —
     nothing stores it, on purpose.</p>
     <p class="muted">Email is currently ${
       status.configured ? `on, sending through ${status.transport}` : 'off'
     }${
       status.configured || !status.reason ? '.' : `: ${status.reason}`
     }</p>`
  );
}
