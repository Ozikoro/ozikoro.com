/**
 * Account and profile — the member's own record.
 *
 * A REAL GATED ROUTE, NOT A DEMONSTRATION
 *
 * The design's screen carries a banner: *"Dashboard design demonstration — all records and statuses are
 * example material."* This page shows **the signed-in account's actual record** — its address, display name,
 * role and the capabilities that role resolves to — because that is the one thing an account page can state
 * without inventing anything. The design's four sections (identity, privacy, languages, security) are kept as
 * structure, and each says what it will hold.
 *
 * THE GATE IS THE SAME ONE THE ADMINISTRATION USES
 *
 * `getCurrentAccount()` from `@/lib/session`, then a redirect to `/signin` carrying the requested path so a
 * reader arrives back where they were. Roles and capabilities come from `capabilitiesFor`, which resolves
 * them in the database — **never from a cookie, and never from anything the browser sends.**
 *
 * WHAT IT OFFERS, AND WHAT IT STILL DOES NOT
 *
 * It offers **one real operation: changing your own password**, which is required to prove the current one
 * first. That was missing, and the owner reported it in as many words — *"why is users not able to change
 * their passwords? everyone should be able to change their passwords."* Until this form existed the only way
 * to replace a password on the archive was `/forgot/`, which needs an email to arrive and costs the person
 * every session they had.
 *
 * No "delete account" and no notification toggles. Each is a real operation with a real consequence, and a
 * control that appears to work and does not is worse than one that is absent. The page says so where a reader
 * would look for them.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import { MIN_PASSWORD_LENGTH } from '@ozituma/db/accounts';
import { capabilitiesFor, getMember } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account & profile',
  description: 'Your Ozikoro account: identity, privacy, languages and security.',
  robots: { index: false, follow: false },
  alternates: { canonical: 'https://ozikoro.com/account' },
};

/** The four sections the design names, in its order. */
const SECTIONS: Array<{ n: string; title: string; promise: string; body: string }> = [
  {
    n: '01',
    title: 'Identity',
    promise: 'Name, public biography and verified affiliations.',
    body:
      'Your display name and biography are not editable here yet. The archive does not accept a public ' +
      'identity it cannot attribute, so this opens when the editorial process behind it does.',
  },
  {
    n: '02',
    title: 'Privacy',
    promise: 'Profile visibility and contact preferences.',
    body:
      'A profile is not public until you choose that, and the address you signed up with is never shown. ' +
      'The controls for it arrive with the profile.',
  },
  {
    n: '03',
    title: 'Languages',
    promise: 'Reading, writing and translation languages.',
    body:
      'Which languages you read, write and translate is what routes work to you, and it is not collected ' +
      'yet. It will be asked for here rather than inferred.',
  },
  {
    n: '04',
    title: 'Security',
    promise: 'Sessions, sign-in methods and account recovery.',
    body:
      'Your password is changed below, and changing it signs out every other device that was signed in. ' +
      'If you have forgotten it instead, the sign-in page sends a recovery link that works once.',
  },
];

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string; error?: string }>;
}) {
  const params = await searchParams;
  const current = await getCurrentAccount();
  const requestedPath = (await headers()).get('x-pathname') ?? '/account/';

  if (!current) {
    redirect(
      `/signin?error=${encodeURIComponent('Sign in to see your account.')}` +
        `&next=${encodeURIComponent(requestedPath)}`
    );
  }

  const { account } = current;
  const db = await getDb();
  const [capabilities, member] = await Promise.all([
    capabilitiesFor(db, account.id),
    getMember(db, account.id),
  ]);

  return (
    <div className="wrap section">
      <p className="eyebrow">
        <Link href="/">Ozikoro workspace</Link>
      </p>
      <h1>Account &amp; profile</h1>
      <p className="lede">Control identity, affiliations, language, access and notifications.</p>

      <section className="section">
        <h2>Your record</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Email</th>
              <td>{account.email}</td>
            </tr>
            <tr>
              <th scope="row">Display name</th>
              <td>
                {account.displayName ?? <span className="unsourced">Not set</span>}
              </td>
            </tr>
            <tr>
              <th scope="row">Role</th>
              <td>{account.role}</td>
            </tr>
            <tr>
              <th scope="row">Membership</th>
              <td>
                {member ? `${member.status}, since ${String(member.createdAt).slice(0, 10)}` : 'No member record'}
              </td>
            </tr>
            <tr>
              <th scope="row">Capabilities</th>
              <td>
                {capabilities.size > 0 ? (
                  <span className="small">{[...capabilities].sort().join(' · ')}</span>
                ) : (
                  <span className="unsourced">None</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Capabilities are resolved from the database each time this page loads, from the role above — never
          from anything your browser sends.
        </p>
      </section>

      {/*
        CHANGE YOUR OWN PASSWORD — THE OPERATION THE OWNER REPORTED AS MISSING.

        IT ASKS FOR THE CURRENT PASSWORD, WHICH IS NOT FRICTION FOR ITS OWN SAKE. This is a *change*, not a
        *reset*: the person is already signed in, so a form that accepted only a new password would turn any
        borrowed session — an unlocked machine, a copied cookie — into a permanent account takeover, because
        the real owner would be locked out by a password they never chose. `changeOwnPassword` refuses to write
        without the current one and this form has to supply it.

        THE SESSION SURVIVES. `writePassword` closes every session on the account except the token that made
        the change, so the person stays signed in here and every other device is signed out. The success
        message says exactly that, because "signed out everywhere" and "signed out everywhere except here" are
        different promises and the reader is entitled to the true one.
      */}
      <section className="section" id="password">
        <h2>Change your password</h2>
        <p className="muted">
          You are signed in, and this still asks for the password you have now. That is deliberate: a session
          left open on a shared machine must not be enough to lock you out of your own account.
        </p>

        {params.changed ? (
          <div className="notice notice--success" role="status">
            <div>
              <p className="notice__body">
                Your password is changed. Every other device that was signed in has been signed out; this one
                is still signed in.
              </p>
            </div>
          </div>
        ) : null}

        {params.error ? (
          <div className="notice notice--error" role="alert">
            <div>
              <p className="notice__body">{params.error}</p>
            </div>
          </div>
        ) : null}

        <form method="post" action="/api/auth/change-password">
          <div className="field">
            <label className="small" htmlFor="currentPassword">
              Current password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="search-input"
            />
          </div>

          <div className="field">
            <label className="small" htmlFor="newPassword">
              New password
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="search-input"
            />
            {/*
              The policy, stated in the same words the other two password forms state it. `MIN_PASSWORD_LENGTH`
              is imported rather than typed as `10`, so the sentence cannot disagree with the rule
              `assertPasswordAcceptable` actually enforces.
            */}
            <p className="wphelp">
              At least {MIN_PASSWORD_LENGTH} characters. Length is the only rule — no symbols to remember, and
              a phrase is fine.
            </p>
          </div>

          <div className="field">
            <label className="small" htmlFor="confirmPassword">
              The same new password again
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="search-input"
            />
          </div>

          <button className="btn btn--primary" type="submit">
            Change the password
          </button>
        </form>
      </section>

      <section className="section">
        <h2>What you can change</h2>
        <div className="grid">
          {SECTIONS.map((section) => (
            <div className="card" key={section.n}>
              <p className="eyebrow">{section.n}</p>
              <h3>{section.title}</h3>
              <p className="muted small">{section.promise}</p>
              <p className="small">{section.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Leaving</h2>
        <p className="muted">
          Signing out ends this session only. There is no self-service account deletion, because deleting an
          account that has contributed records is a decision with an editorial consequence and the archive has
          not settled how it handles it. An operator can close an account and the record of what it
          contributed stays.
        </p>
      </section>
    </div>
  );
}
