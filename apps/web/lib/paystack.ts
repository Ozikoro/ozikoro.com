/**
 * Paystack, as little of it as this site needs.
 *
 * THE REDIRECT FLOW, DELIBERATELY
 *
 * Paystack offers two ways to take a payment: their inline widget, which runs in
 * the browser with the PUBLIC key, and a redirect to a checkout page they host,
 * which is started server-side with the SECRET key.
 *
 * This uses the redirect. Two reasons, and neither is stylistic:
 *
 *   1. The secret key never leaves the server, and the public key is not needed
 *      at all — so there is one credential to hold rather than two, and no key
 *      material in the page, in the client bundle, or in a view-source.
 *   2. The amount is fixed server-side before the donor ever reaches the
 *      checkout page. With a browser-side widget the amount is chosen in the
 *      browser, which means a donor can change it, and the only defence is
 *      verifying it afterwards.
 *
 * NOTHING HERE IS TRUSTED
 *
 * A redirect coming back from a payment page proves nothing on its own: anyone
 * can type that URL. So the thanks page does not believe the query string — it
 * asks Paystack directly, with the secret key, what happened to that reference.
 * The webhook does the same. Both then write the same row, idempotently.
 *
 * THE SECRET KEY IS NEVER LOGGED AND NEVER RETURNED
 *
 * `paystackConfigured()` exists so the page can say "donations are not set up
 * yet" rather than throwing a 500 at a donor when the key is missing.
 */

const API = 'https://api.paystack.co';

export function paystackSecret(): string | null {
  const key = process.env.PAYSTACK_SECRET_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function paystackConfigured(): boolean {
  return paystackSecret() !== null;
}

export interface InitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaystackError {
  ok: false;
  message: string;
}

/**
 * Start a transaction and get the URL to send the donor to.
 *
 * `amountMinor` is in the currency's smallest unit — kobo for naira — which is
 * what Paystack expects and what the donation row stores, so no conversion
 * happens anywhere in this codebase.
 */
export async function initializeTransaction(input: {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  /** Paystack shows this on the checkout page and in their dashboard. */
  metadata?: Record<string, unknown>;
}): Promise<InitializeResult | PaystackError> {
  const key = paystackSecret();
  if (!key) return { ok: false, message: 'Paystack is not configured on this server.' };

  let response: Response;
  try {
    response = await fetch(`${API}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
      // Paystack is the one external service this page depends on; a donor
      // staring at a spinner is worse than an honest failure.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      ok: false,
      message: `Could not reach Paystack: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  const body = (await response.json().catch(() => null)) as
    | { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string; reference?: string } }
    | null;

  if (!response.ok || !body?.status || !body.data?.authorization_url) {
    // The gateway's own message is useful to the site owner and harmless to a
    // donor, but the key must never appear in it — Paystack does not echo keys.
    return { ok: false, message: body?.message ?? `Paystack returned HTTP ${response.status}` };
  }

  return {
    authorizationUrl: body.data.authorization_url,
    accessCode: body.data.access_code ?? '',
    reference: body.data.reference ?? input.reference,
  };
}

export interface VerifiedTransaction {
  paid: boolean;
  status: string;
  amountMinor: number;
  currency: string;
  email: string | null;
  reference: string;
  providerId: string | null;
  channel: string | null;
  gatewayResponse: string | null;
  paidAt: string | null;
  payload: unknown;
}

/**
 * Ask Paystack what actually happened to a reference.
 *
 * This is the only thing that decides a donation is real. Note that the amount
 * and currency come back from the gateway and are checked against what we
 * recorded — a donor cannot pay ₦1 and have it counted as ₦10,000.
 */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction | PaystackError> {
  const key = paystackSecret();
  if (!key) return { ok: false, message: 'Paystack is not configured on this server.' };

  let response: Response;
  try {
    response = await fetch(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return {
      ok: false,
      message: `Could not reach Paystack: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  const body = (await response.json().catch(() => null)) as
    | {
        status?: boolean;
        message?: string;
        data?: {
          status?: string;
          amount?: number;
          currency?: string;
          reference?: string;
          id?: number;
          channel?: string;
          gateway_response?: string;
          paid_at?: string | null;
          customer?: { email?: string };
        };
      }
    | null;

  if (!response.ok || !body?.status || !body.data) {
    return { ok: false, message: body?.message ?? `Paystack returned HTTP ${response.status}` };
  }

  const d = body.data;
  return {
    paid: d.status === 'success',
    status: String(d.status ?? 'unknown'),
    amountMinor: Number(d.amount ?? 0),
    currency: String(d.currency ?? 'NGN'),
    email: d.customer?.email ?? null,
    reference: String(d.reference ?? reference),
    providerId: d.id === undefined ? null : String(d.id),
    channel: d.channel ?? null,
    gatewayResponse: d.gateway_response ?? null,
    paidAt: d.paid_at ?? null,
    payload: body,
  };
}

/**
 * Verify that a webhook really came from Paystack.
 *
 * Paystack signs the RAW request body with HMAC-SHA512 using the secret key and
 * sends it as `x-paystack-signature`. Two things matter and both are easy to get
 * wrong:
 *
 *   - the signature is over the exact bytes received, so the body must be read
 *     as text and hashed BEFORE it is parsed. Re-serialising parsed JSON changes
 *     key order and whitespace and the signature will never match.
 *   - the comparison must be constant-time. A plain `===` leaks, byte by byte,
 *     how much of a guessed signature was right.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): Promise<boolean> {
  const key = paystackSecret();
  if (!key || !signature) return false;

  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const expected = createHmac('sha512', key).update(rawBody, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself be a signal,
  // so the length is compared first and both are padded to match.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Paystack requires kobo/cents; the form gives naira/dollars. */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

export function fromMinorUnits(minor: number): number {
  return minor / 100;
}

/** `₦2,500` — for display only, never for arithmetic. */
export function formatMoney(minor: number, currency: string): string {
  const symbols: Record<string, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€', GHS: 'GH₵', ZAR: 'R', KES: 'KSh' };
  const symbol = symbols[currency] ?? `${currency} `;
  return `${symbol}${fromMinorUnits(minor).toLocaleString('en-NG', {
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
