import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create an account · Ozituma Learn',
  description: 'Create one Ozituma account and keep your Igbo progress.',
};

/**
 * Create an account.
 *
 * The same account as the dictionary's — this is not a second sign-up, it is the same one reached
 * from a different page, writing the same `account` row. A learner who already has one and lands
 * here is sent to sign in rather than shown a form that would fail on a duplicate address.
 *
 * The minimum age rule (§18 #5) is stated rather than silently enforced by a date picker nobody
 * reads. It is a real decision the owner has made and the person signing up is entitled to see it.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentAccount();
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '/practice';

  if (current) redirect(next.startsWith('/') ? next : '/practice');

  const error = typeof params.error === 'string' ? params.error : null;

  return (
    <div className="wrap wrap-narrow">
      <section className="learn-hero">
        <p className="learn-eyebrow">Account</p>
        <h1 className="learn-hero-title">Create an account</h1>
        <p className="hero-lede">
          One account for Ozituma Learn and the dictionary. It saves your progress and keeps your
          review queue — and nothing on this site is behind it.
        </p>
      </section>

      {error ? (
        <div className="notice notice-warn" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      <form className="card" method="post" action="/api/auth/join">
        <input type="hidden" name="next" value={next} />

        <label className="learn-recall-label" htmlFor="join-email">
          Email
        </label>
        <input
          id="join-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="learn-recall-input"
        />

        <label className="learn-recall-label" htmlFor="join-name" style={{ marginTop: '0.9rem' }}>
          Name <span className="muted">(optional)</span>
        </label>
        <input
          id="join-name"
          name="displayName"
          type="text"
          autoComplete="name"
          maxLength={80}
          className="learn-recall-input"
        />

        <label className="learn-recall-label" htmlFor="join-password" style={{ marginTop: '0.9rem' }}>
          Password
        </label>
        <input
          id="join-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          className="learn-recall-input"
        />

        {/*
          The policy is stated rather than enforced client-side. The server is the thing that
          actually rejects a weak password, and a client-side-only rule is theatre: it stops nobody
          who posts the form directly.
        */}
        <p className="muted" style={{ fontSize: '0.84rem', marginTop: '0.5rem' }}>
          At least 8 characters. Common passwords and your own email address are refused.
        </p>

        <div className="learn-actions" style={{ marginTop: '1.1rem' }}>
          <button className="button" type="submit">
            Create account
          </button>
          <Link className="button button-secondary" href="/signin">
            I already have one
          </Link>
        </div>

        <p className="muted" style={{ fontSize: '0.84rem', marginTop: '0.9rem' }}>
          Accounts are for ages 13 and over. Under 18 needs a parent or guardian to know about it.
          See the{' '}
          <a href={`${process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/privacy`}>privacy note</a>
          .
        </p>
      </form>
    </div>
  );
}
