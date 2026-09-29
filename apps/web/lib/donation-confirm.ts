/**
 * Settling a donation against the gateway.
 *
 * Both confirmation paths — the donor coming back to /donate/thanks and
 * Paystack posting a webhook — need to do exactly the same thing, and the thing
 * they must not do is trust the event that triggered them:
 *
 *   - the redirect carries a reference in a query string, which anyone can type
 *   - the webhook carries a signed body, which proves Paystack sent it and
 *     proves nothing about whether the payment actually settled
 *
 * So both call this, and this asks Paystack. It is the gateway's answer, not the
 * caller's, that decides whether money is recorded as received.
 *
 * It is safe to call repeatedly: the row is updated in place by reference and
 * `markDonationPaid` will not write a second success.
 */
import type { Db } from '@ozituma/db/client';
import {
  type Donation,
  getDonation,
  markDonationFailed,
  markDonationPaid,
} from '@ozituma/db/donations';
import { verifyTransaction } from './paystack.ts';

export interface Confirmation {
  /** The row as it stands after this call, or null if we never issued it. */
  donation: Donation | null;
  /** True only when the gateway itself says the payment succeeded. */
  paid: boolean;
  /** For the log, and for the page when something went wrong. */
  message: string;
}

export async function confirmDonation(db: Db, reference: string): Promise<Confirmation> {
  const donation = await getDonation(db, reference);
  if (!donation) {
    return { donation: null, paid: false, message: 'No donation with that reference.' };
  }

  // Already settled: nothing to ask, and asking again would only give a later
  // read the chance to overwrite a good record with a thinner one.
  if (donation.status === 'success') {
    return { donation, paid: true, message: 'Already confirmed.' };
  }

  const verified = await verifyTransaction(reference);
  if ('ok' in verified) {
    return { donation, paid: false, message: verified.message };
  }

  if (!verified.paid) {
    await markDonationFailed(db, reference, {
      gatewayResponse: `Paystack reports ${verified.status}`,
      payload: verified.payload,
    });
    return { donation, paid: false, message: `The payment did not go through (${verified.status}).` };
  }

  /*
   * The amount is checked, not assumed.
   *
   * The amount was fixed server-side before the checkout page opened, so a
   * mismatch should now be impossible — which is exactly why it is worth
   * checking: if it ever fires, something upstream has changed and the record
   * should say so rather than quietly recording a figure nobody can reconcile.
   * The payment is still recorded as received, because it was: money arriving is
   * a fact and the note explains the discrepancy rather than hiding it.
   */
  const note =
    verified.amountMinor !== donation.amountMinor
      ? `amount mismatch: asked ${donation.amountMinor}, gateway says ${verified.amountMinor}`
      : verified.gatewayResponse;

  await markDonationPaid(db, reference, {
    providerId: verified.providerId,
    channel: verified.channel,
    gatewayResponse: note,
    paidAt: verified.paidAt,
    payload: verified.payload,
  });

  const settled = await getDonation(db, reference);
  return {
    donation: settled ?? { ...donation, status: 'success' },
    paid: settled ? settled.status === 'success' : true,
    message: note ?? 'Confirmed.',
  };
}
