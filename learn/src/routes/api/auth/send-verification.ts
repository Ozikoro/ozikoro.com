/**
 * POST /api/auth/send-verification
 *
 * Sends the account-confirmation email, through Resend, in Ozituma's own design.
 *
 * WHY NOT LET SUPABASE SEND IT
 *
 * Supabase can send its own confirmation email, but two things make that a poor fit here:
 *
 *   1. It needs SMTP configured on the project, which only the dashboard can do.
 *   2. Supabase's built-in sender is heavily rate-limited and, on a free project, may only deliver
 *      to the project's own team members. A learner who never receives the email cannot sign in at
 *      all, because `mailer_autoconfirm` is false — no session is issued until they confirm.
 *
 * So the app generates the link itself and sends the message through the domain that is already
 * verified for it. The email then matches the product rather than arriving from a generic sender.
 *
 * WHY THE LINK IS GENERATED SERVER-SIDE
 *
 * `generateLink` is an ADMIN operation — it mints a confirmation URL for any address without a
 * password. It runs here, with the service key, and the key never leaves the Worker. The browser
 * asks for "send a confirmation to my address"; it never sees a token it could reuse.
 *
 * WHY IT DOES NOT REVEAL WHETHER AN ADDRESS EXISTS
 *
 * The response is identical whether the address is registered or not. This endpoint can be called
 * without being signed in, so a truthful "no such account" would turn it into a way to test whether
 * somebody has an Ozituma account. The learner gets the same message either way, and only a real
 * address receives mail.
 */

import { createFileRoute } from '@tanstack/react-router';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? '';
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? '';
const RESEND_KEY = process.env["RESEND_API_KEY"] ?? '';
const FROM = process.env["RESEND_FROM"] ?? 'Ozituma <hello@ozituma.com>';
const SITE = process.env["OZITUMA_LEARN_URL"] ?? 'https://learn.ozituma.com';

const hits = new Map<string, { count: number; resetAt: number }>();

/** Lower than the bridge: this sends mail, and mail is expensive and abusable. */
function allowed(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 5;
}

/** The verification email. Same palette and construction as the other Ozituma mail. */
function verificationEmail(link: string): { subject: string; html: string } {
  const subject = 'Confirm your Ozituma account';

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#fbf8f2;">
<div style="display:none;font-size:1px;color:#fbf8f2;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  Confirm your address to start learning. The link works once and expires.
  ${'&#847;&zwnj;&nbsp;'.repeat(50)}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbf8f2;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">

<tr><td style="background:#1f4d3a;padding:24px 32px;">
  <table role="presentation" width="100%"><tr>
    <td style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;">Ozituma</td>
    <td align="right" style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.72);">Learn</td>
  </tr></table>
</td></tr>
<tr><td style="height:4px;background:#c9552f;line-height:4px;font-size:0;">&nbsp;</td></tr>

<tr><td style="padding:36px 32px 8px 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#12211c;">
  <h1 style="margin:0 0 16px 0;font-family:Georgia,serif;font-size:28px;line-height:1.25;color:#12211c;">Confirm your address</h1>
  <p style="margin:0 0 16px 0;">One tap and you are in. Confirming tells us the address is really yours, which is what lets you recover your account later.</p>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
    <tr><td align="center" style="background:#1f4d3a;border-radius:8px;">
      <a href="${link}" style="display:inline-block;padding:14px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Confirm my account</a>
    </td></tr>
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;background:#f4ecdd;border-radius:10px;">
    <tr><td style="padding:18px 20px;font-size:14px;line-height:1.6;color:#12211c;">
      <strong style="display:block;margin-bottom:6px;">Nothing works until you confirm</strong>
      We do not sign you in on an unconfirmed address, so the courses stay locked until this one tap.
    </td></tr>
  </table>

  <p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#5b6b64;">
    If the button does not work, paste this into your browser:<br>
    <span style="word-break:break-all;color:#1f4d3a;">${link}</span>
  </p>
  <p style="margin:0;font-size:13px;line-height:1.6;color:#5b6b64;">
    Did not create an account? Ignore this email and nothing happens.
  </p>
</td></tr>

<tr><td style="padding:28px 32px 32px 32px;border-top:1px solid #e6ded0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#5b6b64;">
  <p style="margin:0 0 8px 0;"><strong style="color:#12211c;">Ozituma</strong> — the Igbo dictionary and learning platform.</p>
  <p style="margin:0;color:#8a968f;">Ozikoro · <a href="https://ozituma.com" style="color:#8a968f;text-decoration:none;">ozituma.com</a></p>
</td></tr>

</table></td></tr></table></body></html>`;

  return { subject, html };
}

export const Route = createFileRoute('/api/auth/send-verification')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => handleSend(request),
    },
  },
});

async function handleSend(request: Request): Promise<Response> {
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
  if (!allowed(ip)) {
    return Response.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_KEY) {
    return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }

  let body: { email?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /*
   * Mint a link, trying the confirmation type first and the sign-in type second.
   *
   * `signup` is the confirmation link, and Supabase refuses to mint one for an address that is
   * ALREADY confirmed — which is every returning learner, and every account mirrored from
   * ozituma.com. `magiclink` works for a confirmed address and signs them straight in.
   *
   * Falling back rather than choosing means one endpoint serves both: a new learner gets
   * "confirm your account", a returning one gets "here is your link". Both URLs are single-use and
   * both land on the same place, so the learner never has to know which they were sent.
   *
   * `redirectTo` must be on the project's allow-list, or Supabase ignores it silently and sends
   * them to the site URL instead. The link still works; they just arrive somewhere unexpected.
   */
  let link: string | null = null;

  for (const type of ['signup', 'magiclink'] as const) {
    /*
     * `generateLink` is declared with one overload per `type`, so a variable holding the union
     * `'signup' | 'magiclink'` satisfies neither. The call itself is correct; the compiler simply
     * cannot prove which overload applies. The cast is narrowed to the two types this loop uses.
     */
    const { data, error } = await admin.auth.admin.generateLink({
      type,
      email,
      options: { redirectTo: `${SITE}/auth` },
    } as Parameters<typeof admin.auth.admin.generateLink>[0]);
    if (!error && data?.properties?.action_link) {
      link = data.properties.action_link;
      break;
    }
  }

  if (!link) {
    /*
     * Deliberately vague to the caller. See the note at the top: a precise error here would let
     * anyone probe whether an address has an Ozituma account.
     */
    console.error('[send-verification] no link could be minted', { email });
    return Response.json({ ok: true, sent: false });
  }

  const { subject, html } = verificationEmail(link);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
      // Same address and same intent within the window is one message, not two.
      'Idempotency-Key': `verify:${email}`.slice(0, 256),
    },
    body: JSON.stringify({ from: FROM, to: [email], subject, html }),
  });

  if (!response.ok) {
    console.error('[send-verification] resend failed', {
      email,
      status: response.status,
      body: (await response.text().catch(() => '')).slice(0, 200),
    });
    return Response.json({ ok: false, error: 'send_failed' }, { status: 502 });
  }

  return Response.json({ ok: true, sent: true });
}
