import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of use',
  description:
    'The terms for using Ozituma: what you may do with the dictionary and its data, what is expected of you when you contribute, and the limits of what we promise.',
};

/*
 * Ozikoro.com has a privacy policy but no terms page — /terms, /terms-and-conditions and
 * /terms-conditions all return 404 — so there was nothing to copy for this one. It is written in
 * the same plain voice as the privacy policy and its sibling pages, and it says the same kind of
 * thing: what is permitted, what is expected, and what is not promised.
 *
 * The clause that matters most is the one about the record itself: this is a dictionary of living
 * languages, and it will contain mistakes. A terms page that implied otherwise would be the one
 * dishonest page on the site.
 */
export default function TermsPage() {
  return (
    <div className="wrap wrap-narrow">
      <h1>Terms of use</h1>

      <p className="hero-lede">
        These are the terms for using Ozituma, the dictionary of Ozikoro. By using the site you
        accept them.
      </p>

      <section className="section">
        <h2>1. What this site is</h2>
        <p>
          Ozituma is a free dictionary of African languages, published by Ozikoro. It is free to
          read, free to search, and free to use through its public API. There is no paid tier and
          nothing on the site is behind a payment.
        </p>
      </section>

      <section className="section">
        <h2>2. Using the dictionary</h2>
        <p>You may read, search, copy and quote the entries freely, including commercially.</p>
        <p>
          If you use the API, use it within reason: create a key through your own account, keep it
          to yourself, and do not resell the API itself or present it as your own service. We do not
          publish a hard rate limit, and a client that makes the site slow for everyone else will be
          blocked.
        </p>
      </section>

      <section className="section">
        <h2>3. Contributing</h2>
        <p>
          Anyone with an account can propose a word, a meaning, a correction, a proverb or a
          recording. An editor reads every submission before it is published.
        </p>
        <p>By contributing, you confirm that:</p>
        <ul>
          <li>what you send is yours to send, or comes from something you are free to share;</li>
          <li>
            a recording is your own voice, and you are willing for it to be published with your name
            beside it as the speaker;
          </li>
          <li>
            what you add is offered to Ozikoro to publish, adapt and keep as part of the dictionary
            record.
          </li>
        </ul>
        <p>
          Do not send anything you do not have the right to send. If we are told that a submission
          infringes someone else&rsquo;s rights, it will be removed.
        </p>
      </section>

      <section className="section">
        <h2>4. Accuracy, and what we do not promise</h2>
        <p>
          The dictionary is the best record we can keep, and it is a record of living languages: it
          contains mistakes. Where we are not sure of a reading we leave it out rather than guess,
          but that does not make what is published authoritative. Check anything you intend to rely
          on, and tell us when you find something wrong.
        </p>
        <p>
          We do not promise that the site will always be available, that the API will not change, or
          that the data is free of errors. The dictionary is offered as it is.
        </p>
      </section>

      <section className="section">
        <h2>5. Accounts</h2>
        <p>
          Keep your password to yourself. You are responsible for what is done with your account.
          Do not create an account to abuse the site, to add material you have no right to add, or
          to mislead anyone about who wrote an entry. We may close an account that does those
          things.
        </p>
      </section>

      <section className="section">
        <h2>6. What you may not do</h2>
        <ul>
          <li>Attempt to break, overload, or gain unauthorised access to the site or its data.</li>
          <li>Scrape the site in a way that degrades it for other people — use the API instead.</li>
          <li>Present Ozikoro&rsquo;s record as someone else&rsquo;s work, or as your own.</li>
          <li>Add content that is unlawful, or that attacks any person or people.</li>
        </ul>
      </section>

      <section className="section">
        <h2>7. Copyright</h2>
        <p>
          The dictionary, its text and its data belong to Ozikoro. The names, proverbs and language
          material recorded here belong to the people they came from, and are kept here in trust for
          them. Your own contributions remain yours; by sending them you allow us to publish and
          keep them as part of the record, as section 3 says.
        </p>
      </section>

      <section className="section">
        <h2>8. Changes to these terms</h2>
        <p>
          We may update these terms. The version published on this page is the one that applies, and
          the effective date below changes when it does.
        </p>
      </section>

      <section className="section">
        <h2>9. Contact</h2>
        <p>
          Ozituma is the dictionary of Ozikoro, founded by Idenze Ezeme. Write to{' '}
          <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Effective 28 September 2026. See also: <Link href="/privacy">Privacy Policy</Link> ·{' '}
          <Link href="/about">About</Link>
        </p>
      </section>
    </div>
  );
}
