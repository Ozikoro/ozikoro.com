/**
 * /donate — supporting Ozikoro.
 *
 * The page is a plain HTML form: no JavaScript, no card field, no third-party
 * script. Everything about a card is entered on Paystack's own checkout page,
 * which is where a payment form belongs — this page never sees a card number
 * and no payment script runs on it.
 *
 * The amount presets are radios and the "other" box is a separate field; the
 * handler takes the box when it is filled and the radio otherwise. Two fields
 * rather than one because a form that needs JavaScript to combine them would not
 * work for someone on a slow connection or with scripting off, and asking for
 * money is the last place to be fussy about how.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { donationTotals } from '@ozituma/db/donations';
import { formatMoney, paystackConfigured } from '@/lib/paystack';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Support Ozikoro',
  description:
    'Ozikoro and Ozituma are funded by the people who use them. Donate directly to keep the dictionary free, open and growing.',
};

const PRESETS = [1000, 2500, 5000, 10000, 25000, 50000];

/** What the money is actually spent on. Specific, because vagueness is not trust. */
const USES: Array<{ title: string; body: string }> = [
  {
    title: 'Keeping the dictionary online',
    body: 'Servers, storage for the pronunciations, and the bandwidth that serves the free API.',
  },
  {
    title: 'Getting the sources',
    body: 'Reading, correcting and completing entries by hand, which is the slow part and the part that cannot be rushed.',
  },
  {
    title: 'Listening to the recordings',
    body: 'Checking the pronunciation archive by machine so that a bad or truncated recording is found before a learner meets it.',
  },
  {
    title: 'Building the rest of the archive',
    body: 'The history and cultural record at ozikoro.com — folktales, proverbs, practices and the languages that carry them.',
  },
];

export default async function DonatePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; amount?: string }>;
}) {
  const params = await searchParams;

  // The totals are a courtesy and the table may not exist on a fresh install, so
  // a failure here must never take the page down — this is the one page that
  // must always render.
  let totals: { count: number; totalMinor: number; currency: string } | null = null;
  try {
    const db = await getDb();
    const t = await donationTotals(db);
    if (t.count > 0) totals = t;
  } catch {
    totals = null;
  }

  const configured = paystackConfigured();

  return (
    <div className="wrap wrap-narrow">
      <div className="name-page-head">
        <p className="name-eyebrow">Ozikoro</p>
        <h1 className="name-title">Support the work</h1>
        <p className="name-lede">
          Ozikoro is the archive; Ozituma is its dictionary. Both are built in the open, given
          away free, and paid for by the people who find them useful. If that includes you, you can
          give directly — no middleman, no platform taking a cut beyond the card fee.
        </p>
      </div>

      {params.error ? (
        <div className="notice notice-warn" role="alert">
          {params.error}
        </div>
      ) : null}

      {!configured ? (
        <div className="notice notice-warn">
          <strong>Donations are not open yet.</strong> The payment account is still being set up.
          Everything else on the site works as normal.
        </div>
      ) : null}

      <section className="section">
        <h2>Where it goes</h2>
        <div className="grid">
          {USES.map((use) => (
            <div className="card" key={use.title}>
              <h3>{use.title}</h3>
              <p className="card-meta" style={{ fontSize: '0.92rem' }}>
                {use.body}
              </p>
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          What it does not pay for: advertising, tracking, or a wall around the data. The dictionary
          stays free and the API stays free, and nothing here needs an account to read.
        </p>
      </section>

      <section className="section">
        <h2>Give once</h2>
        <form method="post" action="/api/donate">
          <fieldset
            style={{ border: 'none', padding: 0, margin: '0 0 1rem' }}
            disabled={!configured}
          >
            <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Amount</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {PRESETS.map((amount, index) => (
                <label
                  key={amount}
                  className="chip"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
                >
                  <input
                    type="radio"
                    name="amount"
                    value={amount}
                    defaultChecked={index === 1}
                    style={{ margin: 0 }}
                  />
                  <span>₦{amount.toLocaleString('en-NG')}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label htmlFor="other" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
            Or another amount, in naira
          </label>
          <input
            id="other"
            name="other"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 7500"
            className="search-input"
            style={{ width: '100%' }}
            disabled={!configured}
          />
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.35rem 0 1.25rem' }}>
            Leave this empty to give the amount selected above. A minimum of ₦100 keeps the card fee
            from swallowing the gift.
          </p>

          <label htmlFor="name" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
            Your name <span className="muted">(optional)</span>
          </label>
          <input
            id="name"
            name="name"
            maxLength={120}
            autoComplete="name"
            className="search-input"
            style={{ width: '100%' }}
            disabled={!configured}
          />
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.35rem 0 1.25rem' }}>
            Only used to say thank you. Nothing is published without asking you.
          </p>

          <label htmlFor="email" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="search-input"
            style={{ width: '100%' }}
            disabled={!configured}
          />
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.35rem 0 1.25rem' }}>
            Where the receipt goes. It is not added to a mailing list and not shared.
          </p>

          <label htmlFor="message" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
            A message <span className="muted">(optional)</span>
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            maxLength={500}
            className="search-input"
            style={{ width: '100%', resize: 'vertical' }}
            disabled={!configured}
          />

          {/* Honeypot. Hidden from people, irresistible to scripts. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
            <label htmlFor="website">Website</label>
            <input id="website" name="website" tabIndex={-1} autoComplete="off" />
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <button className="button" type="submit" disabled={!configured}>
              Continue to payment
            </button>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.75rem 0 0' }}>
            You will go to Paystack&rsquo;s secure page to pay by card, bank transfer or USSD.
            Ozituma never sees or stores your card details. Giving once, from anywhere in the world.
          </p>
        </form>
      </section>

      {totals ? (
        <div className="notice">
          {formatMoney(totals.totalMinor, totals.currency)} given so far by{' '}
          {totals.count === 1 ? 'one person' : `${totals.count} people`}. Thank you.
        </div>
      ) : null}

      <section className="section">
        <h2>Other ways to help</h2>
        <p>
          Money is not the only contribution that counts, and for a dictionary it is often not the
          most valuable one. <Link href="/contribute">Contributing a word or a correction</Link> is
          reviewed by an editor and goes straight into the record. If you speak a language the
          dictionary is thin in, a few minutes of your time is worth more than the equivalent in
          naira.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          For anything larger — recordings, a partnership, or a gift by
          transfer rather than card —{' '}
          <a href="https://ozikoro.com" rel="noopener">
            get in touch through Ozikoro
          </a>
          .
        </p>
      </section>
    </div>
  );
}
