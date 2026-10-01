/**
 * Paystack — the server side of paying for a lesson.
 *
 * WHAT THIS IS FOR
 *
 * `lesson_bookings` already carries `price_kobo`, `payment_reference` and `paid`, and the migration
 * puts a trigger on them:
 *
 *     IF (NEW.paid IS DISTINCT FROM OLD.paid OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
 *         OR NEW.price_kobo IS DISTINCT FROM OLD.price_kobo) AND auth.role() <> 'service_role'
 *       THEN RAISE EXCEPTION 'Payment fields are set by the payment server only';
 *
 * So the database has been waiting for this file. A learner cannot mark their own booking paid, and
 * neither can a teacher — only the service role can, which means only this server code.
 *
 * MONEY IS IN KOBO, INTEGERS ONLY
 *
 * Paystack takes the smallest unit, and so does this schema. Nothing here uses a float: `0.1 + 0.2`
 * is not a payment amount, and a rounding error in a price is a bug that shows up in someone's bank
 * statement rather than in a log.
 *
 * THE SIGNATURE IS THE WHOLE SECURITY MODEL
 *
 * The webhook URL is public — it has to be, Paystack calls it. So the ONLY thing separating a real
 * payment notification from anyone on the internet posting `{paid: true}` is the HMAC in
 * `x-paystack-signature`. It is checked with `timingSafeEqual` rather than `===`, because a plain
 * comparison leaks how many leading bytes were right and that is enough to forge a signature one
 * byte at a time.
 *
 * NEVER TRUST THE WEBHOOK BODY'S AMOUNT
 *
 * A webhook can be replayed, and a body can be edited by anyone who has the secret. So the amount is
 * re-read from Paystack's own verify endpoint before a booking is marked paid. The webhook says
 * "something happened to reference X"; the verify call says "and here is what X actually was".
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const PAYSTACK_API = 'https://api.paystack.co';

/** Read the secret at call time, never at import time: a Worker has no env until it is invoked. */
function secretKey(): string {
  const key = process.env["PAYSTACK_SECRET_KEY"];
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set');
  return key;
}

/** The percentage the platform keeps from each lesson. */
export const PLATFORM_COMMISSION_PERCENT = Number(process.env["PLATFORM_COMMISSION_PERCENT"] ?? '15');

/**
 * What the learner pays, and what the teacher is owed.
 *
 * Kept in one function because the two must always be derived from the same number. Computing the
 * fee at the checkout and again at the payout is how a platform quietly pays out more than it took.
 *
 * `Math.round` once, on the teacher's share, and the platform takes the remainder. Rounding both
 * would let the two halves sum to more or less than the whole.
 */
export function splitPayment(priceKobo: number): { total: number; teacherKobo: number; platformKobo: number } {
  const total = Math.max(0, Math.round(priceKobo));
  const platformKobo = Math.round((total * PLATFORM_COMMISSION_PERCENT) / 100);
  return { total, teacherKobo: total - platformKobo, platformKobo };
}

/**
 * Verify that a webhook body really came from Paystack.
 *
 * Returns false rather than throwing, because the caller's only sane response to a bad signature is
 * a 401 — and a thrown error in a request handler becomes a 500, which tells the sender their
 * forgery attempt caused a server fault.
 */
export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;

  let expected: string;
  try {
    expected = createHmac('sha512', secretKey()).update(rawBody, 'utf8').digest('hex');
  } catch {
    // No secret configured. Nothing can be verified, so nothing is trusted.
    return false;
  }

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself be a timing signal, so the
  // length is compared first — a length is not a secret, the bytes are.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface PaystackTransaction {
  reference: string;
  status: string;
  amountKobo: number;
  currency: string;
  paidAt: string | null;
  customerEmail: string | null;
}

/**
 * Ask Paystack what a reference actually was.
 *
 * This is the authority, not the webhook body. A webhook is a notification that something happened;
 * this is the record of what.
 */
export async function verifyTransaction(reference: string): Promise<PaystackTransaction | null> {
  const response = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
  });

  if (!response.ok) return null;

  const body = (await response.json()) as {
    status?: boolean;
    data?: {
      reference?: string;
      status?: string;
      amount?: number;
      currency?: string;
      paid_at?: string | null;
      customer?: { email?: string | null };
    };
  };

  const data = body?.data;
  if (!body?.status || !data?.reference) return null;

  return {
    reference: data.reference,
    status: String(data.status ?? ''),
    amountKobo: Number(data.amount ?? 0),
    currency: String(data.currency ?? 'NGN'),
    paidAt: data.paid_at ?? null,
    customerEmail: data.customer?.email ?? null,
  };
}

export interface InitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/**
 * Start a checkout for a booking.
 *
 * The reference is generated HERE and stored on the booking BEFORE the learner is sent to Paystack.
 * If it were generated by Paystack and only discovered on the callback, a learner who paid and then
 * closed the tab would have a payment nobody could match to a booking.
 *
 * `metadata.booking_id` is what the webhook uses to find the row again, and it is the only field in
 * the whole flow that ties a payment to a lesson.
 */
export async function initializeTransaction(input: {
  email: string;
  amountKobo: number;
  reference: string;
  bookingId: string;
  callbackUrl: string;
}): Promise<InitializeResult | null> {
  const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      reference: input.reference,
      callback_url: input.callbackUrl,
      // Paystack echoes metadata back on the webhook, which is how the booking is found without
      // trusting the amount in the body.
      metadata: { booking_id: input.bookingId },
    }),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as {
    status?: boolean;
    data?: { authorization_url?: string; access_code?: string; reference?: string };
  };

  const data = body?.data;
  if (!body?.status || !data?.authorization_url) return null;

  return {
    authorizationUrl: data.authorization_url,
    accessCode: String(data.access_code ?? ''),
    reference: String(data.reference ?? input.reference),
  };
}

/** Paystack references must be unique per attempt; the booking id plus a timestamp guarantees it. */
export function makeReference(bookingId: string): string {
  return `ozituma-${bookingId.slice(0, 8)}-${Date.now().toString(36)}`;
}
