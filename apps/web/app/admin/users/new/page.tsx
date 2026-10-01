import Link from 'next/link';
import { Head, Card, Notices } from '../../ui';

export const dynamic = 'force-dynamic';

/*
 * Add account, on its own screen — WordPress's user-new.php.
 *
 * The owner: "add account should not just show when you click on accounts. it should be when you
 * click on add account, that it will show, just like wordpress."
 *
 * The form was sitting open at the top of the accounts list, which meant every visit to that list
 * began with a form nobody had asked for. Here it is only when it is wanted.
 *
 * The password is set by the administrator and shown once rather than emailed: this installation's
 * mail is configured separately, and an account that silently never received its password is worse
 * than one whose password is handed over deliberately.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      <Head title="Add account">
        <Link className="wpbtn wpbtn-quiet" href="/admin/users">← Back to users</Link>
      </Head>
      <Notices saved={params.done} error={params.error} />

      <form method="post" action="/api/admin/accounts">
        <input type="hidden" name="action" value="account.create" />
        <input type="hidden" name="back" value="/admin/users/new" />

        <div className="wpgrid">
          <Card title="The account">
            <div className="wpfield">
              <label htmlFor="email">Email address</label>
              <input id="email" name="email" type="email" required maxLength={200} autoComplete="off" />
              <p className="wphelp">This is how they sign in, and the only identifier that cannot change.</p>
            </div>
            <div className="wpfield">
              <label htmlFor="displayName">Display name</label>
              <input id="displayName" name="displayName" type="text" maxLength={80} />
              <p className="wphelp">What appears beside their contributions. Their email is used if this is empty.</p>
            </div>
            <div className="wpfield">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="text" required minLength={12} autoComplete="off" />
              <p className="wphelp">
                Set it here and give it to them — the site does not email it. They can change it from
                their own account page.
              </p>
            </div>
          </Card>

          <Card title="What they may do">
            <div className="wpfield">
              <label htmlFor="role">Role</label>
              <select id="role" name="role" defaultValue="contributor">
                <option value="contributor">Contributor — sends words, names and recordings for review</option>
                <option value="editor">Editor — contributes, and reviews and publishes what others send</option>
                <option value="admin">Administrator — runs the site, including this screen</option>
              </select>
              <p className="wphelp">
                An editor can edit and review. Only an administrator reaches the admin at all, and
                only an administrator can create another one.
              </p>
            </div>
          </Card>
        </div>

        <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
          <button className="wpbtn" type="submit">Add account</button>
          <Link className="wpbtn wpbtn-quiet" href="/admin/users">Cancel</Link>
        </p>
      </form>
    </>
  );
}
