import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create a free Ozituma account to contribute words, definitions and corrections.',
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [params, current] = await Promise.all([searchParams, getCurrentAccount()]);
  if (current) redirect('/contribute');

  return (
    <div className="wrap wrap-narrow">
      <h1>Create an account</h1>
      <p className="hero-lede">
        Free, and only needed if you want to contribute. Anyone can read the dictionary and use the
        API without one.
      </p>

      {params.error ? (
        <div className="notice notice-warn" role="alert" style={{ marginBottom: '1.25rem' }}>
          {params.error}
        </div>
      ) : null}

      <section className="section">
        <h2>What contributing involves</h2>
        <p>
          You submit a word, a meaning or a correction. An editor reviews it before it appears in the
          dictionary, so nothing you write is published unreviewed — and your submission is credited
          to the community source when it is.
        </p>
      </section>

      <form method="post" action="/api/auth/register" style={{ display: 'grid', gap: '0.85rem' }}>
        <div>
          <label htmlFor="displayName">Your name</label>
          <input
            id="displayName"
            name="displayName"
            maxLength={80}
            autoComplete="name"
            className="search-input"
            style={{ width: '100%' }}
          />
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
            Shown to editors when they review your submissions. Optional.
          </p>
        </div>

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
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="search-input"
            style={{ width: '100%' }}
          />
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
            At least 10 characters. A memorable phrase is stronger than a short complicated password.
          </p>
        </div>

        <div>
          <button className="button" type="submit">
            Create account
          </button>
        </div>
      </form>

      <p style={{ marginTop: '1.5rem' }}>
        Already have an account? <Link href="/signin">Sign in</Link>.
      </p>
    </div>
  );
}
