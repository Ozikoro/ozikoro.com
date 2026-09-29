/**
 * /donate/thanks — where Paystack sends the donor back.
 *
 * THE QUERY STRING IS NOT EVIDENCE
 *
 * Paystack returns `?reference=…&trxref=…`, and anyone can type that URL. A page
 * that thanked people for money on the strength of a URL parameter would say
 * thank you to a stranger who guessed a reference and would say nothing to a
 * donor whose webhook was still in flight. So the page asks the gateway what
 * happened to that reference and reports exactly that — see lib/donation-confirm.
 *
 * The two paths can race, and it does not matter which wins: both settle the same
 * row to the same state, and `markDonationPaid` writes on the first success only.
 * A donor refreshing this page is therefore safe and sees the same answer.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { formatMoney } from '@/lib/paystack';
import { confirmDonation } from '@/lib/donation-confirm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Thank you',
  description: 'Thank you for supporting Ozikoro.',
  // A confirmation page reached from a payment provider should never be indexed.
  robots: { index: false, follow: false },
};

export default async function DonateThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const params = await searchParams;
  const reference = (params.reference ?? params.trxref ?? '').trim();

  /*
   * Three outcomes, and they are genuinely different to a donor:
   *
   *   paid    the gateway confirmed it — thank them properly
   *   unpaid  the gateway says it did not succeed — say so plainly, and say that
   *           nothing was taken, because the fear that it was is the first thing
   *           a person feels when a payment fails
   *   unknown no reference, or one we never issued — the honest answer, with the
   *           way to reach us, rather than a fake thank-you
   *
   * Anything unexpected — the database being down, Paystack being unreachable —
   * must not be reported as a failed payment, because we do not know that. It
   * falls through to `unknown`, which is what it is.
   */
  let outcome: 'paid' | 'unpaid' | 'unknown' = 'unknown';
  let amountLabel: string | null = null;
  let detail: string | null = null;

  if (reference.length > 0) {
    try {
      const db = await getDb();
      const confirmation = await confirmDonation(db, reference);
      if (confirmation.paid && confirmation.donation) {
        outcome = 'paid';
        amountLabel = formatMoney(confirmation.donation.amountMinor, confirmation.donation.currency);
      } else if (confirmation.donation) {
        outcome = 'unpaid';
        detail = confirmation.message;
      }
    } catch (error) {
      console.error(`[donate/thanks] could not confirm ${reference}`, error);
    }
  }

  return (
    <div className="wrap wrap-narrow">
      {outcome === 'paid' ? (
        <>
          <div className="name-page-head">
            <p className="name-eyebrow">Ozikoro</p>
            <h1 className="name-title">Thank you</h1>
            <p className="name-lede">
              Your donation{amountLabel ? ` of ${amountLabel}` : ''} has been received. A receipt
              from Paystack is on its way to your email.
            </p>
          </div>

          <section className="section">
            <h2>What you have paid for</h2>
            <p>
              Every entry in this dictionary can be traced to a source that was found, checked,
              licensed or bought, then read by a person before it was published. That is the slow
              part and it is the part donations pay for — not the software, which is the cheap bit.
            </p>
            <p>
              The words are free to everyone, permanently, including for commercial use through the
              API. You have just kept them that way.
            </p>
          </section>
        </>
      ) : null}

      {outcome === 'unpaid' ? (
        <>
          <div className="name-page-head">
            <p className="name-eyebrow">Ozikoro</p>
            <h1 className="name-title">That payment did not go through</h1>
            <p className="name-lede">
              Paystack reports the transaction was not completed, so nothing has been taken from
              you. If your statement says otherwise, tell us and it will be put right.
            </p>
          </div>
          {detail ? (
            <div className="notice notice-warn">
              <span className="mono" style={{ fontSize: '0.85rem' }}>
                {detail}
              </span>
            </div>
          ) : null}
          <section className="section">
            <p>
              <Link href="/donate" className="button">
                Try again
              </Link>
            </p>
          </section>
        </>
      ) : null}

      {outcome === 'unknown' ? (
        <>
          <div className="name-page-head">
            <p className="name-eyebrow">Ozikoro</p>
            <h1 className="name-title">Thank you for giving</h1>
            <p className="name-lede">
              This page could not confirm a payment from the link it was opened with. That usually
              means it was opened directly rather than after a payment.
            </p>
          </div>
          <section className="section">
            <p>
              If you have just paid and are seeing this, the payment is still being confirmed with
              the bank. It will be recorded on our side within a few minutes whether or not this
              page updates, and Paystack&rsquo;s receipt is the record of it. Nothing is lost by
              closing this page.
            </p>
            <p>
              <Link href="/donate">Back to giving</Link> · <Link href="/">Back to the dictionary</Link>
            </p>
          </section>
        </>
      ) : null}

      <section className="section">
        <h2>Keeping going</h2>
        <p>
          A dictionary grows one checked entry at a time.{' '}
          <Link href="/contribute">Contributing a word or a correction</Link> is reviewed by an
          editor and often helps more than money does.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          {reference ? <span className="mono">Reference {reference}</span> : null}
        </p>
      </section>
    </div>
  );
}
