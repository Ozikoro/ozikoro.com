import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Ozituma to contribute words and review submissions.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string; email?: string }>;
}) {
  const [params, current] = await Promise.all([searchParams, getCurrentAccount()]);
  if (current) redirect(current.canReview ? '/review' : '/contribute');

  return (
    <div className="wrap wrap-narrow">
      <h1>Sign in</h1>

      {params.reset ? (
        <div className="notice" role="status" style={{ marginBottom: '1.25rem' }}>
          Your new password is set. Sign in with it — every device that was signed in has been
          signed out.
        </div>
      ) : null}

      {params.error ? (
        <div className="notice notice-warn" role="alert" style={{ marginBottom: '1.25rem' }}>
          {params.error}
        </div>
      ) : null}

      <form method="post" action="/api/auth/signin" style={{ display: 'grid', gap: '0.85rem' }}>
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            defaultValue={params.email ?? ''}
            className="search-input"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="search-input"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <button className="button" type="submit">
            Sign in
          </button>
        </div>
      </form>

      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/forgot">Forgotten your password?</Link>
      </p>

      <p className="muted">
        No account yet? <Link href="/join">Create one</Link>.
      </p>
    </div>
  );
}
