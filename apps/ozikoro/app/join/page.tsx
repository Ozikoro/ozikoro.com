import Link from 'next/link';
import type { Metadata } from 'next';

/*
 * JOINING OZIKORO.
 *
 * WHY THIS PAGE HAD TO EXIST
 *
 * The owner's report: **"My Ozikoro" led straight to a sign-in form.** That is a dead end for anyone who has
 * not joined — the site offered a door with no way to reach it — and registration turned out to exist in the
 * library but with no route exposing it, so the only accounts that could sign in were ones made by hand.
 *
 * WHAT A NEW MEMBER GETS
 *
 * An account, shared with ozituma.com and learn.ozituma.com, plus a member profile and the `reader` role.
 * **`reader` is stated on the page** rather than left implied, because a new member should know what they can
 * do before they hand over an address: read, keep a collection, and submit work for review. Everything above
 * that is granted by an administrator.
 *
 * AFFILIATION IS NOT ASKED FOR
 *
 * The brief is explicit that independent and community researchers must never be required to have a
 * university. So there is no institution field here, and the profile's `institution` stays optional and
 * editable later.
 */
export const metadata: Metadata = {
  title: 'Join Ozikoro',
  description:
    'Create an Ozikoro account to keep a collection, submit a history for review, and cite the archive.',
  robots: { index: true, follow: true },
};

/** Only ever a path on this site, so `?next=` cannot become a redirect elsewhere. */
function safeNext(value: string | undefined): string {
  const path = (value ?? '').trim();
  if (path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')) return path;
  return '/dashboard-reader';
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; email?: string; name?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);

  return (
    <div className="admin-shell" style={{ maxWidth: '32rem', paddingTop: '3rem' }}>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__kicker">Ozikoro</p>
          <h1 className="page-header__title">Join Ozikoro</h1>
          <p className="page-header__lede">
            An account keeps your collection, lets you send a history to the archive for review, and lets you
            cite records by their permanent address. It is the same account for the dictionary at ozituma.com
            and the courses at learn.ozituma.com.
          </p>
        </div>
      </header>

      {params.error ? (
        <div className="notice notice--error" role="alert" id="join-error">
          <div>
            <p className="notice__title">Not created</p>
            <p className="notice__body">{params.error}</p>
          </div>
        </div>
      ) : null}

      <form className="panel" method="post" action="/api/auth/register">
        <div className="panel__body">
          <input type="hidden" name="next" value={next} />

          <div className="field">
            <label htmlFor="display_name">Your name</label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              autoComplete="name"
              defaultValue={params.name ?? ''}
              required
            />
            <p className="field__hint">
              This is the name shown on anything you contribute. A pen name is fine.
            </p>
          </div>

          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={params.email ?? ''}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>

          <div className="field">
            <label htmlFor="password_again">Password again</label>
            <input
              id="password_again"
              name="password_again"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>

          {/*
            WHAT A READER GETS, SAID BEFORE THEY JOIN RATHER THAN AFTER.
            The role is real and it is the floor: `reader` holds read, bookmark and collection. Everything
            above it is granted by an administrator.
          */}
          <div className="notice">
            <div>
              <p className="notice__title">What you can do straight away</p>
              <p className="notice__body">
                Read every record, keep a collection, and submit a history or a photograph for review. Anything
                beyond that — publishing, moderating, editing places — is granted by an administrator, and you
                can be an independent researcher or a community knowledge holder without any institution
                behind you.
              </p>
            </div>
          </div>

          <button className="btn btn-primary" type="submit">
            Create my account
          </button>
        </div>
      </form>

      <p className="small muted" style={{ marginTop: '1.5rem' }}>
        Already have an account? <Link href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</Link>.
      </p>
    </div>
  );
}
