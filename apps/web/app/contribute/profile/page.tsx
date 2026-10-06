import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '@/lib/session';
import { Head } from '../ui';

export const dynamic = 'force-dynamic';

const ROLE: Record<string, string> = {
  contributor: 'Contributor',
  editor: 'Editor',
  admin: 'Administrator',
  owner: 'Owner',
};

export default async function Page() {
  const current = await getCurrentAccount();
  /*
   * The layout redirects a signed-out visitor too, but Next renders a layout and its page
   * CONCURRENTLY, so this page still runs for them. Asserting the session away with `current!` made
   * every signed-out request throw a TypeError server-side before the redirect won. Guarding here
   * means the redirect is the only thing that happens.
   */
  if (!current) redirect('/signin?error=Sign+in+to+contribute.');
  const account = current.account;

  return (
    <>
      <Head
        title="Your profile"
        lede="Who you are on Ozituma, and the things attached to your account."
        children={<Link className="cd-btn" href="/contribute/account">Full account page</Link>}
      />

      <div className="cd-panel">
        <h2>Account</h2>
        <table className="cd-table" style={{ marginTop: '0.6rem' }}>
          <tbody>
            <tr><th scope="row">Name</th><td>{account.displayName ?? '—'}</td></tr>
            <tr><th scope="row">Email</th><td>{account.email}</td></tr>
            <tr><th scope="row">Role</th><td>{ROLE[account.role] ?? account.role}</td></tr>
            <tr><th scope="row">Contributions</th><td>Shown on <Link href="/contribute">the dashboard</Link></td></tr>
          </tbody>
        </table>
      </div>

      <div className="cd-panel">
        <h2>Password</h2>
        <p className="cd-hint">
          Change it from the full account page, with your current password. If you have forgotten it,
          sign out and use the recovery link on the sign-in page.
        </p>
        <div className="cd-actions">
          <Link className="cd-btn cd-btn-quiet" href="/contribute/account">Change your password</Link>
          <Link className="cd-btn cd-btn-quiet" href="/forgot">I have forgotten it</Link>
        </div>
      </div>

      <div className="cd-panel">
        <h2>API access</h2>
        <p className="cd-hint">
          If you build with Ozituma, your key and its usage are on the full account page.
        </p>
        <div className="cd-actions">
          <Link className="cd-btn cd-btn-quiet" href="/contribute/account">Your API key</Link>
          <Link className="cd-btn cd-btn-quiet" href="/developers">The developer docs</Link>
        </div>
      </div>

      <div className="cd-panel">
        <h2>Signing out</h2>
        <p className="cd-hint">This ends the session on this device only.</p>
        <form method="post" action="/api/auth/signout">
          <button className="cd-btn cd-btn-quiet" type="submit">Sign out</button>
        </form>
      </div>
    </>
  );
}
