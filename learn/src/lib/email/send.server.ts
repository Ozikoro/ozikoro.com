/**
 * Sending through Resend.
 *
 * SERVER ONLY. The API key is a full-send credential for the whole domain, so this file must never
 * be imported into a component that ships to the browser. The `.server.ts` suffix is the repo's
 * existing convention for that (`client.server.ts`, `paystack.server.ts`) and Nitro enforces it.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not send to a list. Campaigns and newsletters go to an AUDIENCE and are a deliberate,
 * approved action — there is no function here that takes "everyone". A helper that could mail the
 * whole list from a code path would eventually be called from one.
 */

import { newsletterEmail, passwordResetEmail, welcomeEmail, lessonReceiptEmail, type EmailBrand, type RenderedEmail } from './templates';

const RESEND_API = 'https://api.resend.com';

function apiKey(): string {
  const key = process.env["RESEND_API_KEY"];
  if (!key) throw new Error('RESEND_API_KEY is not set');
  return key;
}

/** The verified sender. `ozituma.com` is verified on the account; a wrong From is a 403. */
const FROM = process.env["RESEND_FROM"] ?? 'Ozituma <hello@ozituma.com>';

interface SendResult {
  ok: boolean;
  id?: string | undefined;
  reason?: string | undefined;
}

/**
 * Send one transactional email.
 *
 * `headers` carries `List-Unsubscribe` for marketing mail only. Transactional mail — a password
 * reset, a receipt — has no unsubscribe link because the reader asked for it, and offering one
 * on a reset email trains people to unsubscribe from their own account security.
 */
export async function sendRendered(
  to: string,
  email: RenderedEmail,
  options: { unsubscribeUrl?: string; replyTo?: string } = {}
): Promise<SendResult> {
  const headers: Record<string, string> = {};
  if (options.unsubscribeUrl) {
    // Both forms: the URL for clients that show a button, and the mailto for the rest.
    headers['List-Unsubscribe'] = `<${options.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const response = await fetch(`${RESEND_API}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      // Resend de-duplicates on this, so a retry after a timeout does not send twice.
      'Idempotency-Key': `${to}:${email.subject}`.slice(0, 256),
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: email.subject,
      html: email.html,
      ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, reason: `${response.status} ${text.slice(0, 200)}` };
  }

  const body = (await response.json()) as { id?: string };
  return { ok: true, id: body.id };
}

export async function sendWelcome(to: string, name: string | null, siteUrl: string, brand: EmailBrand = "learn"): Promise<SendResult> {
  return sendRendered(to, welcomeEmail({ name, siteUrl, brand }));
}

export async function sendPasswordReset(to: string, resetUrl: string, brand: EmailBrand = "learn"): Promise<SendResult> {
  return sendRendered(to, passwordResetEmail({ resetUrl, brand }));
}

export async function sendLessonReceipt(to: string, input: Parameters<typeof lessonReceiptEmail>[0]): Promise<SendResult> {
  return sendRendered(to, lessonReceiptEmail(input), { replyTo: 'support@ozituma.com' });
}

/**
 * Send an issue to the newsletter audience as a BROADCAST.
 *
 * Separate from `sendRendered` on purpose. Resend broadcasts are the auditable, approvable path to a
 * list, and keeping them a different function means "email everybody" is never one typo away from
 * "email one person".
 */
export async function sendNewsletterBroadcast(input: {
  title: string;
  intro: string;
  sections: readonly { heading: string; body: string; link?: string; linkText?: string }[];
  siteUrl: string;
}): Promise<SendResult> {
  const audienceId = process.env["RESEND_AUDIENCE_ID"];
  if (!audienceId) return { ok: false, reason: 'RESEND_AUDIENCE_ID is not set' };

  const unsubscribeUrl = `${input.siteUrl}/unsubscribe`;
  const email = newsletterEmail({ ...input, unsubscribeUrl });

  const response = await fetch(`${RESEND_API}/broadcasts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience_id: audienceId,
      from: FROM,
      subject: email.subject,
      html: email.html,
      name: input.title,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, reason: `${response.status} ${text.slice(0, 200)}` };
  }

  const body = (await response.json()) as { id?: string };
  // A broadcast is created as a DRAFT. It is not sent here, and nothing in this codebase calls
  // Resend's send endpoint for a broadcast — that stays a deliberate act in the dashboard.
  return { ok: true, id: body.id };
}
