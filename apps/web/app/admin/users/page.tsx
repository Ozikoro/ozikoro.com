import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listAccountsForAdmin } from '@ozituma/db/admin';
import { Head, Card, Notices } from '../ui';
import { Avatar } from './avatar';

export const dynamic = 'force-dynamic';

/*
 * Users, laid out the way WordPress lays out Users.
 *
 * The owner: "add account should not just show when you click on accounts. it should be when you
 * click on add account, that it will show, just like wordpress. go to wordpress 'users' and emulate
 * what they did there."
 *
 * In WordPress the list and the form are two screens: /wp-admin/users.php is a table, and the way
 * to make one is a button at the top leading to user-new.php. That is the split here — this is the
 * table, /admin/users/new is the form — because a list you scan and a form you fill are different
 * jobs and putting them on one page makes both slower.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; q?: string }>;
}) {
  const params = await searchParams;
  const db = await getDb();
  const accounts = await listAccountsForAdmin(db);

  const term = (params.q ?? '').trim().toLowerCase();
  const shown = term
    ? accounts.filter(
        (a) =>
          a.email.toLowerCase().includes(term) ||
          (a.displayName ?? '').toLowerCase().includes(term) ||
          a.role.includes(term)
      )
    : accounts;

  const roleCount = shown.reduce<Record<string, number>>((acc, a) => {
    acc[a.role] = (acc[a.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Head title="Users">
        <Link className="wpbtn" href="/admin/users/new">Add account</Link>
      </Head>
      <Notices saved={params.done} error={params.error} />

      <Card title={`${shown.length} account${shown.length === 1 ? '' : 's'}`}>
        <form method="get" action="/admin/users" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search by name, email or role"
            style={{ flex: '1 1 16rem', padding: '0.35rem 0.5rem', border: '1px solid #8c8f94', borderRadius: 4, font: 'inherit', fontSize: 14 }}
          />
          <button className="wpbtn wpbtn-quiet" type="submit">Search</button>
          {term ? <Link className="wpbtn wpbtn-quiet" href="/admin/users">Clear</Link> : null}
        </form>

        <table className="wptable">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th style={{ textAlign: 'right' }}>Contributions</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id}>
                <td>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                    <Avatar name={a.displayName ?? a.email} email={a.email} url={a.avatarUrl} />
                    <span>
                      <strong>{a.displayName ?? a.email.split('@')[0]}</strong>
                      <div className="wphelp" style={{ margin: 0 }}>{a.email}</div>
                    </span>
                  </div>
                </td>
                <td>
                  {a.role}
                  {a.status !== 'active' ? <span className="wpbadge wpbadge-off"> {a.status}</span> : null}
                </td>
                <td style={{ textAlign: 'right' }}>{a.contributions.toLocaleString()}</td>
                <td className="wphelp">{a.createdAt.slice(0, 10)}</td>
                <td className="wprow-actions" style={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/admin/users/${a.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr><td colSpan={5} className="wphelp">No account matches that.</td></tr>
            ) : null}
          </tbody>
        </table>

        <p className="wphelp" style={{ marginTop: '0.7rem' }}>
          {Object.entries(roleCount).map(([role, n]) => `${n} ${role}`).join(' · ')}
        </p>
      </Card>
    </>
  );
}
