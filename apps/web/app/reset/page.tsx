import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { MIN_PASSWORD_LENGTH } from '@ozituma/db/accounts';
import { checkResetToken } from '@ozituma/db/passwords';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Set a new password',
  description: 'Set a new password for your Ozituma account.',
  robots: { index: false },
};

/**
 * Where a recovery link lands.
 *
 * The token is checked before the form is drawn, so a link that has expired or
 * has already been used says so instead of inviting somebody to type a new
 * password twice and then refusing it. That check is a read, not a claim: the
 * password is only written by the form's POST, which checks the token again.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? '';
  const db = await getDb();
  const found = token ? await checkResetToken(db, token) : null;

  if (!found) {
    return (
      <div className="wrap wrap-narrow">
        <h1>That link will not work</h1>
        <p>
          A recovery link can be used once, and it stops working an hour after it was sent. This one
          has done one or the other — probably both, if you have asked for another since.
        </p>
        <p>
          <Link href="/forgot">Ask for a new link</Link>, or{' '}
          <Link href="/signin">sign in</Link> if you have remembered the password.
        </p>
      </div>
    );
  }

  const email = found.email.replace(/^(.).*(@.*)$/, '$1•••$2');

  return (
    <div className="wrap wrap-narrow">
      <h1>Set a new password</h1>
      <p className="muted">
        For the account at <strong>{email}</strong>. Setting it signs out every device that is
        signed in — including any you have forgotten about, which is usually the point.
      </p>

      {params.error ? (
        <div className="notice notice-warn" role="alert" style={{ marginBottom: '1.25rem' }}>
          {params.error}
        </div>
      ) : null}

      <form method="post" action="/api/auth/reset" style={{ display: 'grid', gap: '0.85rem' }}>
        {/* The token travels in the body, so it does not survive in a bookmark. */}
        <input type="hidden" name="token" value={token} />

        <div>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="search-input"
            style={{ width: '100%' }}
          />
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
            At least {MIN_PASSWORD_LENGTH} characters. A phrase you will remember beats a jumble you
            will not — length is the only rule here.
          </p>
        </div>

        <div>
          <label htmlFor="confirmPassword">The same password again</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="search-input"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <button className="button" type="submit">
            Set the new password
          </button>
        </div>
      </form>
    </div>
  );
}
