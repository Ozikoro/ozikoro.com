import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in · Ozituma Learn',
  description: 'Sign in to Ozituma Learn to keep your progress in Igbo.',
};

/**
 * Sign in.
 *
 * The form posts to /api/auth/signin and the route answers with a 303, so this works with
 * JavaScript disabled — a plain HTML form and a redirect. That is not nostalgia: a learner on a
 * mid-range Android over a slow connection is exactly the audience §13 describes, and a sign-in
 * page that requires a hydrated bundle before it does anything is the wrong shape for them.
 *
 * An already-signed-in visitor is redirected rather than shown the form again.
 */
export default async function SignInPage({
  searchParams,
}: {
  // Next.js 15 hands page props as promises. Awaiting is required, and reading
  // `searchParams.error` without awaiting yields undefined rather than throwing — which would look
  // like "no error" and silently hide every failure message.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentAccount();
  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '/practice';

  if (current) redirect(next.startsWith('/') ? next : '/practice');

  const error = typeof params.error === 'string' ? params.error : null;
  const reset = typeof params.reset === 'string';

  return (
    <div className="wrap wrap-narrow">
      <section className="learn-hero">
        <p className="learn-eyebrow">Account</p>
        <h1 className="learn-hero-title">Sign in</h1>
        <p className="hero-lede">
          One Ozituma account works here and on the dictionary. Signing in is only what saves your
          progress — every word and every exercise stays open without one.
        </p>
      </section>

      {reset ? (
        <div className="notice" style={{ marginBottom: '1rem' }}>
          Your password was changed. Sign in with the new one.
        </div>
      ) : null}

      {error ? (
        <div className="notice notice-warn" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      <form className="card" method="post" action="/api/auth/signin">
        <input type="hidden" name="next" value={next} />

        <label className="learn-recall-label" htmlFor="signin-email">
          Email
        </label>
        <input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="learn-recall-input"
        />

        <label className="learn-recall-label" htmlFor="signin-password" style={{ marginTop: '0.9rem' }}>
          Password
        </label>
        <input
          id="signin-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="learn-recall-input"
        />

        <div className="learn-actions" style={{ marginTop: '1.1rem' }}>
          <button className="button" type="submit">
            Sign in
          </button>
          <Link className="button button-secondary" href="/join">
            Create an account
          </Link>
        </div>

        <p className="muted" style={{ fontSize: '0.84rem', marginTop: '0.9rem' }}>
          Forgot your password? Set a new one on{' '}
          <a href={`${process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/forgot`}>ozituma.com</a>
          {' '}— it is the same account.
        </p>
      </form>
    </div>
  );
}
