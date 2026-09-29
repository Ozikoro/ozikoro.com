/**
 * POST /api/webhooks/paystack
 *
 * Paystack posts here when a transaction settles. This is the reliable path:
 * the donor may close the tab, lose signal, or wander off on the checkout page
 * and never come back, so the redirect alone would lose donations. The webhook
 * arrives because Paystack's servers decided to send it.
 *
 * TWO CHECKS, AND BOTH ARE NEEDED
 *
 *   1. The signature. Paystack signs the raw body with HMAC-SHA512 over the
 *      exact bytes and sends `x-paystack-signature`. Without this the endpoint
 *      is an open invitation: anyone who learns the URL could POST "someone gave
 *      ₦500,000" and we would believe it. Because the signature is over the raw
 *      bytes, the body is read as TEXT and verified BEFORE it is parsed — a
 *      parse-then-reserialise round trip changes whitespace and key order and
 *      would never match.
 *
 *   2. The gateway itself. A valid signature proves Paystack sent the event. It
 *      does not, by itself, prove the payment settled — so the transaction is
 *      still verified directly with the API, exactly as the thank-you page does.
 *      A signed event and an independent confirmation agreeing is what makes the
 *      record trustworthy.
 *
 * WHAT IT RETURNS
 *
 * 200 for anything that was signed by Paystack, including references we do not
 * recognise. Paystack retries non-2xx responses, and retrying will never make an
 * unknown reference become known, so 200 is the honest answer to "I have
 * nothing to do with this". A 401 is reserved for a bad signature, which is the
 * one case where the caller is not Paystack at all.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { markDonationFailed } from '@ozituma/db/donations';
import { verifyWebhookSignature } from '@/lib/paystack';
import { confirmDonation } from '@/lib/donation-confirm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The events this endpoint acts on. Everything else is acknowledged and ignored. */
const CHARGE_SUCCESS = 'charge.success';
const CHARGE_FAILED = 'charge.failed';

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();

  const signature = request.headers.get('x-paystack-signature');
  if (!(await verifyWebhookSignature(rawBody, signature))) {
    // Not Paystack, or not with the key we hold. Say so and stop — nothing in
    // this request is trustworthy, including its JSON.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    // Signed but unparseable: a Paystack problem, not ours, and retrying the
    // same bytes will not help. Acknowledged so it stops being retried.
    return NextResponse.json({ received: true, handled: false, reason: 'unparseable body' });
  }

  const reference = event.data?.reference;
  if (typeof reference !== 'string' || reference.length === 0) {
    return NextResponse.json({ received: true, handled: false, reason: 'no reference' });
  }

  const db = await getDb();

  try {
    if (event.event === CHARGE_SUCCESS) {
      const confirmation = await confirmDonation(db, reference);
      return NextResponse.json({
        received: true,
        handled: confirmation.paid,
        ...(confirmation.donation ? { reference } : {}),
      });
    }

    if (event.event === CHARGE_FAILED) {
      await markDonationFailed(db, reference, {
        gatewayResponse: 'Paystack reports the charge failed',
        payload: event,
      });
      return NextResponse.json({ received: true, handled: true });
    }
  } catch (error) {
    /*
     * A failure here is OUR failure, and the payment is real, so the one thing
     * we must not do is answer 200: Paystack retries a 5xx, and a retry is
     * exactly what we want once the database is reachable again. The reference
     * is logged so a donation can be reconciled by hand in the meantime.
     */
    console.error(`[paystack webhook] ${event.event} for ${reference} failed`, error);
    return NextResponse.json({ error: 'Could not record the event' }, { status: 500 });
  }

  return NextResponse.json({ received: true, handled: false, reason: `ignored ${event.event}` });
}
