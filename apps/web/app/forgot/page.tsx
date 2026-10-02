import Link from 'next/link';
import type { Metadata } from 'next';
import { RESET_TTL_MINUTES } from '@ozituma/db/passwords';
import { mailStatus, siteAddress } from '@ozituma/core';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Forgotten your password',
  description: 'Ask for a link that lets you set a new password for your Ozituma account.',
  robots: { index: false },
};

export default async function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const params = await searchParams;
  const mail = mailStatus();

  return (
    <div className="wrap wrap-narrow">
      <h1>Forgotten your password</h1>

      {params.sent ? (
        <div className="notice" role="status" style={{ marginBottom: '1.25rem' }}>
          <p style={{ margin: 0 }}>
            If that address has an account here, a message is on its way to it with a link to set a
            new password. The link works once, and it stops working in {RESET_TTL_MINUTES} minutes.
          </p>
          {mail.configured ? (
            /*
             * A recovery address on a domain whose mail is forwarded, and a new
             * sending domain, both mean the message can be accepted here and still
             * not arrive. So the way round it is stated on the page every time,
             * rather than only when this site knows it cannot send at all: a person
             * who is locked out should not have to guess what to do next.
             */
            <p style={{ marginBottom: 0, marginTop: '0.6rem' }} className="muted">
              Nothing after a few minutes? Look in the spam folder, then write to{' '}
              <a href={`mailto:${siteAddress()}`}>{siteAddress()}</a> from the same address — an
              administrator can send you a link by hand.
            </p>
          ) : (
            /*
             * Said plainly rather than hidden. Telling somebody to wait for an email
             * that this site cannot send would leave them waiting for nothing, and
             * the request has been recorded — an administrator can pass the link on.
             */
            <p style={{ marginBottom: 0, marginTop: '0.6rem' }}>
              <strong>Email is not switched on yet.</strong> Your request has been recorded, so an
              administrator can send you a link by hand. Write to{' '}
              <a href={`mailto:${siteAddress()}`}>{siteAddress()}</a> from the same address and
              mention that you asked here.
            </p>
          )}
        </div>
      ) : null}

      <p className="muted">
        Type the address you signed up with. We will send a link that lets you set a new password —
        we cannot send you the old one, because nobody here can read it.
      </p>

      <form method="post" action="/api/auth/forgot" style={{ display: 'grid', gap: '0.85rem' }}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            className="search-input"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <button className="button" type="submit">
            Send me a link
          </button>
        </div>
      </form>

      <p style={{ marginTop: '1.5rem' }} className="muted">
        Remembered it? <Link href="/signin">Sign in</Link>. No account yet?{' '}
        <Link href="/join">Create one</Link>.
      </p>
    </div>
  );
}
