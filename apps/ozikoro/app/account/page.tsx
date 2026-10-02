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
 * WHAT IT DELIBERATELY DOES NOT OFFER
 *
 * No "delete account", no "change password" and no notification toggles. Each is a real operation with a real
 * consequence, the archive has no accounts yet, and a control that appears to work and does not is worse than
 * one that is absent. The page says so where a reader would look for them.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getDb } from '@ozituma/db/client';
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
      'Recovery is not self-service on this platform yet. An operator can reset a password and attribute ' +
      'the change, and the page says that plainly rather than offering a form that does nothing.',
  },
];

export default async function AccountPage() {
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
