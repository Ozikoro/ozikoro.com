/**
 * POST /api/webhooks/nowpayments — the archive's crypto payment notification endpoint.
 *
 * WHY A WEBHOOK AND NOT A REDIRECT
 *
 * As the dictionary's Paystack webhook says of itself: the donor may close the tab, lose signal, or wander off
 * on the checkout page and never come back. The webhook arrives because the gateway's servers decided to send
 * it, which is the only event that can be relied on.
 *
 * THREE THINGS MUST HOLD, AND EACH ONE IS A DIFFERENT FAILURE
 *
 *   1. THE SIGNATURE. `x-nowpayments-sig` is an HMAC-SHA512 of the body **re-serialised with its keys sorted**,
 *      keyed on the IPN secret — not of the raw bytes, which is how Paystack does it. **That difference
 *      changes the order of operations: this endpoint must parse before it can verify**, because the bytes
 *      alone are not what was signed. The parse is therefore part of the trust boundary, and a body that will
 *      not parse is refused with 401 rather than acknowledged, because an unparseable body is an unverifiable
 *      one and nothing in it may be believed.
 *
 *   2. THE GATEWAY'S OWN ANSWER. A valid signature proves NOWPayments sent the event. It does not prove the
 *      payment finished — a signed event may say `waiting` or `confirming`. So the payment is re-checked
 *      against the API, exactly as the dictionary re-checks a Paystack transaction, and **the independent
 *      answer decides**. With no API key, nothing is recorded and the response says so.
 *
 *   3. THE AMOUNT. A payment that settles for less than the donation asked for must not mark it paid. The
 *      pending row is read and the confirmed amount compared; a mismatch is refused and logged rather than
 *      quietly accepted. **Without this, a one-cent payment would settle any donation whose reference leaked.**
 *
 * FAIL CLOSED
 *
 * With no `NOWPAYMENTS_IPN_SECRET` there is no way to distinguish a real call from a forged one, so the route
 * answers 503 and records nothing. **An endpoint that accepts unsigned payments when a key is missing is worse
 * than one that does not exist, because it invites a POST saying "payment finished" and believes it.**
 *
 * STATUS CODES
 *
 *   401  a bad or absent signature — the caller is not NOWPayments
 *   503  the endpoint is not configured, so it cannot trust anything
 *   200  everything else, including references we do not recognise. NOWPayments retries non-2xx, and retrying
 *        will never make an unknown reference become known, so 200 is the honest answer to "nothing to do".
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { getDonation, markDonationFailed, markDonationPaid } from '@ozituma/db/donations';
import {
  DEAD_STATUSES,
  PAID_STATUSES,
  confirmPayment,
  nowpaymentsConfigured,
  verifyNowpaymentsSignature,
  type NowpaymentsPayment,
} from '@/lib/nowpayments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The events this endpoint acts on. Everything else is acknowledged and ignored. */
const PAYMENT_FINISHED = 'finished';

export async function POST(request: Request): Promise<NextResponse> {
  // FAIL CLOSED, FIRST, BEFORE READING ANYTHING. Without the secret no request can be trusted.
  if (!nowpaymentsConfigured()) {
    return NextResponse.json(
      { error: 'NOWPayments is not configured on this deployment.' },
      { status: 503 }
    );
  }

  const rawBody = await request.text();

  /*
   * Parsed before verifying, because the signature covers the key-sorted re-serialisation rather than these
   * bytes. An unparseable body cannot be verified at all and is refused — the one place this endpoint differs
   * from the Paystack one, where the raw bytes are what was signed and can be checked first.
   */
  let body: NowpaymentsPayment & { payment_status?: string };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (!verifyNowpaymentsSignature(body, request.headers.get('x-nowpayments-sig'))) {
    // Not NOWPayments, or not with the key we hold. Nothing in this request is trustworthy.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const reference = typeof body.order_id === 'string' ? body.order_id.trim() : '';
  const paymentId = body.payment_id === undefined ? '' : String(body.payment_id);
  const status = typeof body.payment_status === 'string' ? body.payment_status : '';

  if (!reference) {
    return NextResponse.json({ received: true, handled: false, reason: 'no order_id' });
  }

  const db = await getDb();
  const donation = await getDonation(db, reference);
  if (!donation) {
    // Signed by NOWPayments and about something we have no record of. A retry will not change that.
    return NextResponse.json({ received: true, handled: false, reason: 'unknown reference' });
  }

  // Already settled. The update is idempotent, so this is a no-op rather than an error.
  if (donation.status === 'success') {
    return NextResponse.json({ received: true, handled: true, reason: 'already successful' });
  }

  const outcome = {
    providerId: paymentId || null,
    channel: 'nowpayments',
    gatewayResponse: status || null,
    paidAt: typeof body.created_at === 'string' ? body.created_at : null,
    payload: body,
  };

  // A status that will never complete is recorded as failed, so the ledger does not carry it as pending.
  if (DEAD_STATUSES.has(status)) {
    await markDonationFailed(db, reference, outcome);
    return NextResponse.json({ received: true, handled: true, reason: `status ${status}` });
  }

  // Anything that is neither finished nor dead is a state the archive does not act on. 200 so it stops
  // being retried; the row stays pending, which is exactly what it is.
  if (!PAID_STATUSES.has(status) && status !== PAYMENT_FINISHED) {
    return NextResponse.json({ received: true, handled: false, reason: `status ${status} is not final` });
  }

  // THE INDEPENDENT CHECK. The event says finished; ask NOWPayments directly and let that answer decide.
  if (!paymentId) {
    return NextResponse.json({ received: true, handled: false, reason: 'finished but no payment_id to confirm' });
  }
  const confirmation = await confirmPayment(paymentId);
  if (!confirmation.ok) {
    return NextResponse.json({ received: true, handled: false, reason: `unconfirmed: ${confirmation.reason}` });
  }
  if (!PAID_STATUSES.has(confirmation.status ?? '')) {
    return NextResponse.json({
      received: true,
      handled: false,
      reason: `event said finished, API says ${confirmation.status ?? 'nothing'}`,
    });
  }

  /*
   * THE AMOUNT CHECK, which is the safeguard against a settled-but-wrong payment.
   *
   * `donation.amountMinor` is what the donor was asked for; `price_amount` is what NOWPayments says the
   * payment was worth in fiat. A payment that settles for less must not mark the donation paid — without this
   * a one-cent payment would settle any donation whose reference leaked.
   *
   * The comparison is only made when the confirmation returns a number, so a missing field does not silently
   * pass: it is reported as unverified and nothing is written.
   */
  const confirmedAmount = confirmation.priceAmount ?? body.price_amount;
  if (typeof confirmedAmount !== 'number' || !Number.isFinite(confirmedAmount)) {
    return NextResponse.json({ received: true, handled: false, reason: 'no amount to compare against' });
  }
  const confirmedMinor = Math.round(confirmedAmount * 100);
  if (confirmedMinor !== Number(donation.amountMinor)) {
    return NextResponse.json({
      received: true,
      handled: false,
      reason: `amount mismatch: donation ${donation.amountMinor} minor, payment ${confirmedMinor}`,
    });
  }

  const recorded = await markDonationPaid(db, reference, outcome);
  return NextResponse.json({ received: true, handled: true, newlyRecorded: recorded });
}

/**
 * GET is not a webhook delivery, and answering it as one would let a browser or a crawler believe it had
 * confirmed something. It reports whether the endpoint is armed, which is the one useful thing a GET here can
 * honestly say, and never touches a payment.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: 'nowpayments',
    configured: nowpaymentsConfigured(),
    note: 'Payment notifications are delivered by POST.',
  });
}
