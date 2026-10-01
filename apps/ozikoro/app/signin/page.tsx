/**
 * Sign in.
 *
 * A real form posting to a real endpoint, so it works with JavaScript disabled and can be
 * exercised with curl. `?next=` is carried through the form and validated on the way out, so an
 * administrator who was sent here from the Spotify page lands back on it.
 *
 * The account is the platform account, shared with the dictionary. The session is not: a cookie
 * cannot span ozikoro.com and ozituma.com, so signing in here is a separate act from signing in
 * there. That is stated on the page rather than left to be discovered.
 */
import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

/** Only ever a path on this site. */
function safeNext(value: string | undefined): string {
  const path = (value ?? '').trim();
  if (path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')) return path;
  return '/admin/spotify';
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; welcome?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);

  return (
    <div className="admin-shell" style={{ maxWidth: '30rem', paddingTop: '3rem' }}>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__kicker">Ozikoro administration</p>
          <h1 className="page-header__title">Sign in</h1>
        </div>
      </header>

      {params.error ? (
        <div className="notice notice--error" role="alert">
          <div>
            <p className="notice__title">Not signed in</p>
            <p className="notice__body">{params.error}</p>
          </div>
        </div>
      ) : null}

      {params.welcome ? (
        <div className="notice notice--success" role="status">
          <div>
            <p className="notice__title">Signed in</p>
            <p className="notice__body">You are signed in.</p>
          </div>
        </div>
      ) : null}

      <form className="panel" method="post" action="/api/auth/signin">
        <div className="panel__body">
          <input type="hidden" name="next" value={next} />

          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="username" required maxLength={200} />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <p className="actions">
            <button className="btn btn--primary" type="submit">
              Sign in
            </button>
            <Link className="btn" href="/">
              Back to Ozikoro
            </Link>
          </p>
        </div>
      </form>

      <div className="panel panel--quiet">
        <div className="panel__body">
          <p>
            The account is the platform account, the same one used on the dictionary. The session
            is not shared between the two sites, because a cookie cannot span two different
            domains, so signing in here is separate from signing in there.
          </p>
        </div>
      </div>
    </div>
  );
}
