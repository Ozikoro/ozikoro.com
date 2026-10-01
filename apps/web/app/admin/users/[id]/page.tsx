import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { listAccountsForAdmin } from '@ozituma/db/admin';
import { Head, Card, Notices } from '../../ui';
import { Avatar } from '../avatar';

export const dynamic = 'force-dynamic';

/*
 * Edit user — WordPress's user-edit.php.
 *
 * Three things can change here, and the page says what each does: the display name, the role and
 * the picture. The email is deliberately readonly: it is the identity the account signs in with and
 * everything in the record is attributed by, so changing it is not an edit to a profile but a
 * reassignment of a person's work.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const db = await getDb();
  const accounts = await listAccountsForAdmin(db);
  const account = accounts.find((a) => a.id === Number(id));
  if (!account) notFound();

  const back = `/admin/users/${account.id}`;

  return (
    <>
      <Head title={account.displayName ?? account.email}>
        <Link className="wpbtn wpbtn-quiet" href="/admin/users">← Back to users</Link>
      </Head>
      <Notices saved={query.done} error={query.error} />

      <div className="wpgrid">
        <Card title="The account">
          <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'center', marginBottom: '0.9rem' }}>
            <Avatar name={account.displayName ?? account.email} email={account.email} url={account.avatarUrl} size={64} />
            <div>
              <strong style={{ fontSize: 15 }}>{account.displayName ?? account.email.split('@')[0]}</strong>
              <div className="wphelp">{account.email}</div>
              <div className="wphelp">
                {account.contributions.toLocaleString()} contribution{account.contributions === 1 ? '' : 's'} ·
                joined {account.createdAt.slice(0, 10)} ·
                {account.lastLoginAt ? ` last signed in ${account.lastLoginAt.slice(0, 10)}` : ' never signed in'}
              </div>
            </div>
          </div>

          <form method="post" action="/api/admin/accounts">
            <input type="hidden" name="action" value="account.avatar" />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="accountId" value={account.id} />
            <div className="wpfield">
              <label htmlFor="avatarUrl">Profile picture</label>
              <input
                id="avatarUrl"
                name="avatarUrl"
                type="text"
                defaultValue={account.avatarUrl ?? ''}
                placeholder="https://…"
                maxLength={500}
              />
              <p className="wphelp">
                A link to the picture. Leave it empty to clear it and go back to initials. Uploading a
                file is not offered yet: the site runs in a container that is replaced on every
                deploy, so an uploaded picture would disappear — a link stays where it is.
              </p>
            </div>
            <button className="wpbtn" type="submit">Save picture</button>
          </form>
        </Card>

        <Card title="What they may do">
          <form method="post" action="/api/admin/accounts">
            <input type="hidden" name="action" value="account.update" />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="accountId" value={account.id} />
            <div className="wpfield">
              <label htmlFor="role">Role</label>
              <select id="role" name="role" defaultValue={account.role}>
                <option value="contributor">Contributor</option>
                <option value="editor">Editor</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
            <div className="wpfield">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={account.status}>
                <option value="active">Active — can sign in</option>
                <option value="suspended">Suspended — cannot</option>
              </select>
            </div>
            <button className="wpbtn" type="submit">Save changes</button>
          </form>
        </Card>

        <Card title="Delete">
          <p className="wphelp" style={{ marginBottom: '0.7rem' }}>
            Their contributions stay in the record; the account is removed. This cannot be undone.
          </p>
          <form method="post" action="/api/admin/accounts">
            <input type="hidden" name="action" value="account.delete" />
            <input type="hidden" name="back" value="/admin/users" />
            <input type="hidden" name="accountId" value={account.id} />
            <button className="wpbtn wpbtn-danger" type="submit">Delete this account</button>
          </form>
        </Card>
      </div>
    </>
  );
}
