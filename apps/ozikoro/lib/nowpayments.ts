/**
 * NOWPayments — signature verification and independent confirmation.
 *
 * THE SIGNATURE IS NOT OVER THE RAW BODY, AND THAT IS THE WHOLE DIFFERENCE FROM PAYSTACK
 *
 * The dictionary's Paystack webhook reads the body as text and HMACs those exact bytes, because Paystack
 * signs the bytes it sent. **NOWPayments does not.** It sends `x-nowpayments-sig`, the HMAC-SHA512 of the
 * request body **re-serialised with its keys sorted alphabetically**, keyed on the IPN secret.
 *
 * So verifying this endpoint means:
 *
 *   parse the body → sort every object's keys → JSON.stringify → HMAC-SHA512 → compare
 *
 * **This has a consequence worth stating plainly**: unlike the Paystack path, this one *must* parse before it
 * can verify, because the bytes alone are not what was signed. That makes the parse step part of the trust
 * boundary, so it is wrapped and a body that will not parse is refused rather than partially trusted.
 *
 * WHY `sortDeep` IS HAND-WRITTEN RATHER THAN A LIBRARY
 *
 * The sort has to be stable and total, including inside arrays of objects, because a single mis-ordered key
 * changes the digest. `Object.keys(obj).sort()` at every level, recursing into arrays by index, is the whole
 * algorithm and it is easier to check than a dependency.
 *
 * FAIL CLOSED
 *
 * With no `NOWPAYMENTS_IPN_SECRET` configured there is no way to tell a real call from a forged one, so
 * `nowpaymentsConfigured()` is false and the route refuses everything. **An endpoint that accepts unsigned
 * payments when a key is missing is worse than one that does not exist**, because it is an open invitation to
 * POST "payment finished" and be believed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The IPN secret from the NOWPayments dashboard. Absent means the endpoint cannot trust anything. */
export function nowpaymentsIpnSecret(): string | null {
  const value = process.env.NOWPAYMENTS_IPN_SECRET?.trim();
  return value && value.length > 0 ? value : null;
}

/** The API key, needed only for the independent confirmation step — not for verification. */
export function nowpaymentsApiKey(): string | null {
  const value = process.env.NOWPAYMENTS_API_KEY?.trim();
  return value && value.length > 0 ? value : null;
}

export function nowpaymentsConfigured(): boolean {
  return nowpaymentsIpnSecret() !== null;
}

/** Every object's keys sorted at every depth, with arrays walked by index. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortDeep(source[key]);
    return out;
  }
  return value;
}

/** The exact string NOWPayments signs. Exported so a test can assert it rather than reimplement it. */
export function canonicalSignedBody(body: unknown): string {
  return JSON.stringify(sortDeep(body));
}

/**
 * Constant-time comparison of hex digests.
 *
 * A `===` on two hex strings leaks how many leading characters matched through timing, which is enough to
 * forge a signature one byte at a time given enough attempts. `timingSafeEqual` refuses unequal lengths, so
 * the length is checked first — the length of a hex SHA-512 is not a secret.
 */
function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify the `x-nowpayments-sig` header against a parsed body.
 *
 * Returns false — never throws — for a missing header, a missing secret, or a digest that does not match.
 */
export function verifyNowpaymentsSignature(parsedBody: unknown, signature: string | null): boolean {
  const secret = nowpaymentsIpnSecret();
  if (!secret || !signature) return false;
  const expected = createHmac('sha512', secret).update(canonicalSignedBody(parsedBody), 'utf8').digest('hex');
  return digestsMatch(expected, signature.trim().toLowerCase());
}

/** The NOWPayments payment statuses this endpoint distinguishes. Only `finished` means the money arrived. */
export const PAID_STATUSES = new Set(['finished']);
/** Statuses that mean the payment will not complete. */
export const DEAD_STATUSES = new Set(['failed', 'refunded', 'expired']);

export interface NowpaymentsPayment {
  payment_id?: string | number;
  payment_status?: string;
  order_id?: string | null;
  price_amount?: number;
  price_currency?: string;
  pay_amount?: number;
  pay_currency?: string;
  actually_paid?: number;
  outcome_amount?: number;
  outcome_currency?: string;
  purchase_id?: string | number;
  created_at?: string;
}

export interface NowpaymentsConfirmation {
  ok: boolean;
  /** The status NOWPayments reports when asked directly, which is the authoritative one. */
  status?: string;
  priceAmount?: number;
  priceCurrency?: string;
  reason?: string;
}

/**
 * Ask NOWPayments what it thinks a payment's status is.
 *
 * **The second check, and it is not redundant.** A valid signature proves NOWPayments sent the event; it does
 * not prove the payment finished, because a signed event may report `waiting` or `confirming`. The house
 * pattern is that a signed event and an independent confirmation must agree before a payment is recorded as
 * received — and here the independent answer is the one that decides.
 *
 * With no API key this returns `ok: false` rather than pretending: the webhook then records nothing and says
 * so, which is the correct behaviour for a payment it cannot confirm.
 */
export async function confirmPayment(paymentId: string): Promise<NowpaymentsConfirmation> {
  const key = nowpaymentsApiKey();
  if (!key) return { ok: false, reason: 'NOWPAYMENTS_API_KEY is not configured' };

  try {
    const response = await fetch(`https://api.nowpayments.io/v1/payment/${encodeURIComponent(paymentId)}`, {
      headers: { 'x-api-key': key },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok: false, reason: `NOWPayments API returned ${response.status}` };
    const body = (await response.json()) as NowpaymentsPayment;
    return {
      ok: true,
      status: body.payment_status,
      priceAmount: typeof body.price_amount === 'number' ? body.price_amount : undefined,
      priceCurrency: typeof body.price_currency === 'string' ? body.price_currency : undefined,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'request failed' };
  }
}
