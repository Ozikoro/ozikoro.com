import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What Ozituma collects, how it is used, how long it is kept, and how to have it deleted. No advertising, no tracking, nothing sold.',
};

/*
 * Follows the same structure and the same voice as the privacy policy at ozikoro.com, which is
 * the parent project. The one difference is deliberate and it is the whole point of the document:
 * Ozikoro's policy describes a site that collects phone numbers, mailing addresses, analytics and
 * newsletter subscriptions and shares data with third-party vendors. Ozituma does none of those
 * things, so this says what actually happens here rather than repeating claims that would be
 * false about this site. A privacy policy that overstates what is collected is not a safer
 * document; it is a wrong one.
 */
export default function PrivacyPage() {
  return (
    <div className="wrap wrap-narrow">
      <h1>Privacy Policy</h1>

      <p className="hero-lede">
        At Ozituma, the dictionary of Ozikoro, your privacy is one of our main priorities. This
        policy sets out what we collect, how we use it, and what we do to protect it.
      </p>
      <p>
        By using this website you consent to the practices described here. If you have questions, or
        want more information, write to <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>.
      </p>

      <section className="section">
        <h2>1. Information We Collect</h2>
        <p>We collect as little as the dictionary needs in order to work.</p>
        <h3>a. Personal information</h3>
        <ul>
          <li>Your name or display name, if you choose to give one.</li>
          <li>Your email address, if you create an account.</li>
          <li>A password, stored only as a salted hash. Nobody here can read it.</li>
          <li>Anything you send us directly — a correction, a word list, a recording, an email.</li>
        </ul>
        <p>
          We do not ask for and do not want your phone number, your mailing address, or your date of
          birth.
        </p>
        <h3>b. Non-personal information</h3>
        <ul>
          <li>The ordinary server logs any website keeps, which record requests to the site.</li>
          <li>What you contribute — words, meanings, proverb edits, recordings, corrections.</li>
          <li>API keys you create, stored as a hash. The key itself is shown once and never again.</li>
        </ul>
        <p>
          We do not run analytics, advertising or social tracking scripts of any kind. There is no
          cookie for a reader who is not signed in.
        </p>
      </section>

      <section className="section">
        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>To run the dictionary and keep it available.</li>
          <li>To sign you in and keep you signed in.</li>
          <li>To record who contributed what, so the record can be corrected and credited.</li>
          <li>To answer you when you write to us.</li>
          <li>To notice and stop abuse of the site or the API.</li>
        </ul>
        <p>
          We do not use what you send to advertise to you, and we do not build a profile of you.
        </p>
      </section>

      <section className="section">
        <h2>3. Sharing of Information</h2>
        <p>
          We do not sell, trade or rent your personal information to anyone. It is shared only
          where it has to be in order for the site to run — with the hosting and storage providers
          that hold the servers and the audio files — and with nobody else, unless the law requires
          it.
        </p>
      </section>

      <section className="section">
        <h2>4. Cookies and Tracking Technologies</h2>
        <p>
          One cookie is set, and only when you sign in: the session cookie that keeps you signed
          in. Signing out clears it. There are no analytics cookies, no advertising cookies and no
          third-party trackers on this site.
        </p>
      </section>

      <section className="section">
        <h2>5. Data Retention</h2>
        <p>
          An account and its keys are kept until you ask for them to be deleted, and are then
          removed. Contributions are kept as part of the dictionary record, and the paragraph on
          deleting an account below says exactly how that is handled.
        </p>
      </section>

      <section className="section">
        <h2>6. Security Measures</h2>
        <p>
          We take reasonable measures to protect what we hold: passwords and API keys are stored as
          hashes, the site is served over HTTPS, and access to the database requires access to the
          server. No online platform can promise absolute security, and we will not pretend to.
        </p>
      </section>

      <section className="section">
        <h2>7. Third-Party Links</h2>
        <p>
          This site links to other sites, including ozikoro.com and the projects of others. We are
          not responsible for their content or their privacy practices; read their policies before
          engaging with them.
        </p>
      </section>

      <section className="section">
        <h2>8. Your Privacy Rights</h2>
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>see what we hold about you, and have it corrected or deleted;</li>
          <li>opt out of any communication from us;</li>
          <li>ask for a copy of your data in a portable form;</li>
          <li>object to or restrict certain processing.</li>
        </ul>
        <p>
          To exercise any of these, write to{' '}
          <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>.
        </p>
      </section>

      <section className="section">
        <h2>9. Children&rsquo;s Privacy</h2>
        <p>
          This site is a dictionary and is not directed at children under 13. We do not knowingly
          collect information from a child under 13. If you believe a child has given us personal
          data, write to us and it will be removed.
        </p>
      </section>

      <section className="section">
        <h2>10. Changes to This Privacy Policy</h2>
        <p>
          We may update this policy. Changes are posted on this page with a new effective date, and
          what is stored changes with it — this page is not allowed to describe a practice the site
          does not follow.
        </p>
      </section>

      <section className="section">
        <h2>Deleting your account</h2>
        <p>
          Write to <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a> from the address on the
          account and say that you want it deleted. The account and its API keys are removed.
        </p>
        <p>
          Contributions that have become part of the dictionary are handled differently, and
          honestly: a word or a meaning that has been checked and published may stay, because
          removing it would remove part of the language record rather than part of your account.
          Recordings are the exception — a recording is a person&rsquo;s voice, so it is taken down
          on request. If you want a specific contribution considered, name it and we will.
        </p>
      </section>

      <section className="section">
        <h2>11. Contact Us</h2>
        <p>
          Ozituma is the dictionary of Ozikoro. Write to{' '}
          <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>, or through{' '}
          <a href="https://ozikoro.com" rel="noopener">
            ozikoro.com
          </a>
          . For a correction to an entry, the proposal form on the entry itself is the fastest route.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Effective 28 September 2026. See also: <Link href="/terms">Terms of use</Link> ·{' '}
          <Link href="/about">About</Link>
        </p>
      </section>
    </div>
  );
}
