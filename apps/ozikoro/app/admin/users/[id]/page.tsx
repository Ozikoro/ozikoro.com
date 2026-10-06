/**
 * /admin/users/[id] — one account, what it may do, what it has done, and the two things that may be changed.
 *
 * WHY THE CAPABILITIES ARE SHOWN WITH THEIR SOURCE
 *
 * "This person may publish" is not one fact, it is two: somebody granted them a role that carries `publish`,
 * or the platform role on the shared account carries it because `ozikoro_capabilities` decides that a
 * dictionary administrator holds admin's capabilities without a granted row. **They are revoked in different
 * places** — the first by the form on this page, the second by the dictionary's own administration — so a
 * screen that showed a flat list of capabilities would invite an administrator to look for a button that does
 * not exist. The origins are therefore printed beside each one.
 *
 * WHY THE ROLE FORM LISTS ONLY WHAT MAY BE GRANTED
 *
 * The select is built from `grantableRoles`, which asks the database for the rank ladder and offers only the
 * roles strictly below the actor's own. That is presentation, and the endpoint asks `mayGrantRole` again for
 * itself — a hidden option is not authorisation.
 *
 * WHY THE ACTOR'S OWN ACCOUNT HAS NO ACTIONS
 *
 * An owner outranks an owner, so the rank rule would happily let the owner strip the owner role from
 * themselves and lock the archive out of its own administration. The two buttons are therefore withdrawn when
 * the page is the actor's own, the endpoint refuses independently, and the reason is printed rather than left
 * as a mystery — **a disabled button with no explanation is indistinguishable from a broken page.**
 */
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import {
  MemberError,
  ROLE_PURPOSE,
  capabilitiesFor,
  getAccountAudit,
  getAccountBylines,
  getCapabilityDetail,
  getMemberProfile,
  getUserAccount,
  getUserRoles,
  grantableRoles,
  isLastAdministrator,
  roleLabel,
  type OzikoroRole,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../../ui';

export const dynamic = 'force-dynamic';

function stamp(value: string | null): string {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The audit row's before/after, as a sentence a person can read. */
function describeChange(before: unknown, after: unknown): string {
  /*
   * `read` returns undefined — not null — when the key is absent, and the two are not the same answer here.
   * `before` for a grant is JSON `null`, and `after` is `{"role":"researcher"}`; asking whether `status` is
   * present has to distinguish "this row is not about a status" from "the status was empty". The first
   * version returned the whole object when the key was missing and printed `[object Object]` in the change
   * column, which is worse than printing nothing: it is unreadable AND it looks like data.
   */
  const read = (value: unknown, key: string): string | undefined => {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    if (!(key in (value as Record<string, unknown>))) return undefined;
    const inner = (value as Record<string, unknown>)[key];
    return inner === null || inner === undefined ? '' : String(inner);
  };

  const from = read(before, 'status');
  const to = read(after, 'status');
  if (from !== undefined || to !== undefined) {
    return `status ${from || 'unrecorded'} → ${to || 'unrecorded'}`;
  }

  const role = read(after, 'role') || read(before, 'role');
  if (role) return `role ${role}`;

  // Anything else is a row written by a module this page does not know about. Shown as its own JSON rather
  // than as a dash, because a dash would claim the change was empty when it was merely unfamiliar.
  const render = (value: unknown) => (value === null || value === undefined ? 'nothing' : JSON.stringify(value));
  return `${render(before)} → ${render(after)}`;
}

const ACTION_LABEL: Record<string, string> = {
  grant_role: 'Role granted',
  revoke_role: 'Role removed',
  set_status: 'Membership status changed',
  set_account_status: 'Account suspended or reactivated',
};

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  /*
   * The gate is repeated here rather than inherited from the list page, because a page is reachable by URL and
   * not only by the link that leads to it. The list page checks the same capability; neither trusts the other.
   */
  const { account: current } = await requireCapabilityOrRedirect('manage_users', '/admin/users');
  const actor = current.account;

  const { id } = await params;
  const accountId = Number.parseInt(id, 10);
  if (!Number.isInteger(accountId) || accountId <= 0) notFound();

  const notices = await searchParams;
  const db = await getDb();

  let account;
  try {
    account = await getUserAccount(db, accountId);
  } catch (error) {
    if (error instanceof MemberError && error.code === 'no_account') notFound();
    throw error;
  }

  const [roles, capabilities, detail, profile, audit, bylines, lastAdministrator, actorCapabilities, offerable] =
    await Promise.all([
      getUserRoles(db, accountId),
      capabilitiesFor(db, accountId),
      getCapabilityDetail(db, accountId),
      getMemberProfile(db, accountId),
      getAccountAudit(db, accountId),
      getAccountBylines(db, accountId),
      isLastAdministrator(db, accountId),
      capabilitiesFor(db, actor.id),
      grantableRoles(db, actor.id),
    ]);

  const isSelf = actor.id === accountId;
  const mayManageRoles = actorCapabilities.has('manage_roles');
  const held = new Set(roles.map((role) => role.role));
  /*
   * The `reader` grant is hidden from the summary line.
   *
   * Every account holds Reader whether or not a row says so — that is what `ozikoro_capabilities` decides —
   * so printing it beside a real grant claims a distinction the database does not make. **It is still listed
   * in the roles table below**, because there the row is a fact about a grant (who made it, when, and with
   * what note) rather than a summary of standing, and hiding it there would hide an audit trail.
   */
  const namedRoles = roles.map((role) => role.role).filter((role) => role !== 'reader');

  return (
    <>
      <Head title={account.displayName}>
        <a className="btn btn--sm" href="/admin/users">
          All accounts
        </a>
      </Head>

      <Notices saved={notices.saved} error={notices.error} />

      {isSelf ? (
        <Notices
          info="This is your own account. The actions below are withdrawn for it, and the endpoint refuses them independently — an owner cannot demote or suspend themselves, because the recovery would be a database console."
        />
      ) : null}

      <Card title="The account">
        <AtAGlance
          rows={[
            ['Email', account.email],
            ['Display name', account.displayName],
            ['Platform role', `${account.platformRole} — the role on the shared account, used by the dictionary and the courses`],
            ['Archive roles', namedRoles.length === 0 ? 'Reader (every signed-in account)' : namedRoles.map((role) => roleLabel(role as OzikoroRole)).join(', ')],
            ['Account status', account.status],
            ['Email verified', account.emailVerified ? 'yes' : 'no'],
            ['Created', stamp(account.createdAt)],
            ['Last signed in', account.lastLoginAt ? stamp(account.lastLoginAt) : 'has never signed in'],
            ['Password last changed', account.passwordChangedAt ? stamp(account.passwordChangedAt) : 'not recorded'],
            ['Account id', `${account.id} (uuid ${account.uuid})`],
          ]}
        />
        {profile ? (
          <p className="help">
            Ozikoro profile: {profile.headline ?? 'no headline'}
            {profile.institution ? ` · ${profile.institution}` : ''}
            {profile.orcid ? ` · ORCID ${profile.orcid}` : ''} ·{' '}
            {profile.isPublic ? 'findable' : 'not listed in the research network'} · membership status {profile.status}.
          </p>
        ) : (
          <p className="help">
            This account has no Ozikoro membership row yet, which is ordinary: one is created on a first visit to
            a dashboard, and it holds only the research profile.
          </p>
        )}
      </Card>

      <Card title="Archive roles">
        {roles.length === 0 ? (
          <p className="help">
            No archive role has been granted. The account is still a Reader — that is the one role every signed-in
            account holds — and it may bookmark, build collections and read.
          </p>
        ) : (
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">What it is for</th>
                <th scope="col">Granted</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.role}>
                  <td>{roleLabel(role.role as OzikoroRole)}</td>
                  <td className="small">
                    {ROLE_PURPOSE[role.role as OzikoroRole] ?? '—'}
                    {role.note ? <div className="history__when">note: {role.note}</div> : null}
                  </td>
                  <td className="small">
                    {stamp(role.grantedAt)}
                    <div className="history__when">
                      {role.grantedByEmail ? `by ${role.grantedByEmail}` : 'by the migration, not by a person'}
                    </div>
                  </td>
                  <td>
                    {isSelf ? (
                      <span className="small muted">your own account</span>
                    ) : mayManageRoles ? (
                      <form method="post" action="/api/admin/users">
                        <input type="hidden" name="action" value="clear-role" />
                        <input type="hidden" name="accountId" value={account.id} />
                        <input type="hidden" name="role" value={role.role} />
                        <input type="hidden" name="returnTo" value={`/admin/users/${account.id}`} />
                        <label className="visually-hidden" htmlFor={`why-${role.role}`}>
                          Why this role is being removed
                        </label>
                        <input
                          id={`why-${role.role}`}
                          name="note"
                          type="text"
                          maxLength={500}
                          placeholder="why (kept on the audit row)"
                        />
                        <button className="btn btn--sm" type="submit">Remove</button>
                      </form>
                    ) : (
                      <span className="small muted">needs the manage roles permission</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isSelf && mayManageRoles ? (
          <form method="post" action="/api/admin/users" style={{ marginTop: 'var(--s-4)' }}>
            <input type="hidden" name="action" value="set-role" />
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="returnTo" value={`/admin/users/${account.id}`} />
            <div className="wpfield">
              <label htmlFor="role">Grant an archive role</label>
              <select id="role" name="role" required defaultValue="">
                <option value="" disabled>— choose a role —</option>
                {offerable.filter((role) => !held.has(role)).map((role) => (
                  <option key={role} value={role}>{roleLabel(role)}</option>
                ))}
              </select>
              <p className="wphelp">
                Only roles strictly below your own standing are listed. The rule is the database&rsquo;s
                (<code>ozikoro_role_may_grant</code>) and the endpoint asks it again, so a role that is not here
                cannot be granted by editing the request.
              </p>
            </div>
            <div className="wpfield">
              <label htmlFor="note">Why, for the record</label>
              <input id="note" name="note" type="text" maxLength={500} placeholder="kept on the grant and in the audit trail" />
            </div>
            <button className="btn btn--primary" type="submit">Grant the role</button>
          </form>
        ) : null}

        {!isSelf && !mayManageRoles ? (
          <p className="help">
            This account may see the user table but not change anybody&rsquo;s roles: that needs the
            &ldquo;manage roles&rdquo; permission, which it does not hold.
          </p>
        ) : null}
      </Card>

      <Card title="What this account may do">
        <p className="small muted">
          {capabilities.size} capabilit{capabilities.size === 1 ? 'y' : 'ies'} in total, resolved by the database
          function <code>ozikoro_capabilities</code>. Nothing here is decided by this page.
        </p>
        <table className="record">
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Comes from</th>
            </tr>
          </thead>
          <tbody>
            {detail.map((entry) => (
              <tr key={entry.capability}>
                <td className="mono small">{entry.capability}</td>
                <td className="small">
                  {entry.from.join(', ')}
                  {entry.implicit ? <div className="history__when">not a grant that can be removed on this page</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Account status">
        <AtAGlance
          rows={[
            ['Current', account.status],
            [
              'What suspension does',
              'The account cannot sign in and every live session is revoked. Nothing is deleted and nothing it wrote loses its attribution.',
            ],
            [
              'Last administrator',
              lastAdministrator ? 'this is the only account that can administer the archive' : 'no — other administrators exist',
            ],
          ]}
        />
        {isSelf ? (
          <p className="help">Your own account cannot be suspended or reactivated from here, by design.</p>
        ) : account.status === 'suspended' ? (
          <form method="post" action="/api/admin/users" style={{ marginTop: 'var(--s-4)' }}>
            <input type="hidden" name="action" value="set-status" />
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="status" value="active" />
            <input type="hidden" name="returnTo" value={`/admin/users/${account.id}`} />
            <button className="btn btn--primary" type="submit">Reactivate this account</button>
          </form>
        ) : (
          <form method="post" action="/api/admin/users" style={{ marginTop: 'var(--s-4)' }}>
            <input type="hidden" name="action" value="set-status" />
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="status" value="suspended" />
            <input type="hidden" name="returnTo" value={`/admin/users/${account.id}`} />
            <div className="wpfield">
              <label htmlFor="statusNote">Why, for the record</label>
              <input id="statusNote" name="note" type="text" maxLength={500} required minLength={3} />
              <p className="wphelp">
                A suspension that can be applied without a reason is not a suspension. The reason is stored on the
                audit row and is visible here afterwards.
              </p>
            </div>
            <button className="btn btn--danger" type="submit">Suspend this account</button>
          </form>
        )}
      </Card>

      {bylines.length > 0 ? (
        <Card title="Bylines attributed to this account">
          <table className="record">
            <tbody>
              {bylines.map((byline) => (
                <tr key={byline.id}>
                  <td>
                    <a href={`/author/${byline.slug}`}>{byline.displayName}</a>
                    <div className="history__when">{byline.slug}</div>
                  </td>
                  <td className="small">{byline.articles.toLocaleString('en-GB')} records</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card title="Bylines attributed to this account">
          <p className="help">
            None. The archive credits bylines in <code>ozikoro_contributor</code>, and no byline points at this
            account — so the records this person may have written are still attributed to a name and not to a
            sign-in. This page can see that gap; it cannot close it, because closing it is what the claim path is
            for and it takes evidence a human reads.
          </p>
        </Card>
      )}

      <Card title="Audit trail">
        {audit.length === 0 ? (
          <p className="help">
            Nothing has been recorded about this account. An empty list means no change has been made through this
            screen — not that changes were hidden.
          </p>
        ) : (
          <table className="record">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Change</th>
                <th scope="col">Who</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row, index) => (
                <tr key={`${row.createdAt}-${index}`}>
                  <td className="small">{stamp(row.createdAt)}</td>
                  <td className="small">
                    {ACTION_LABEL[row.action] ?? row.action}
                    {row.note ? <div className="history__when">{row.note}</div> : null}
                  </td>
                  <td className="small mono">{describeChange(row.before, row.after)}</td>
                  <td className="small">
                    {row.actorEmail ?? 'no actor recorded'}
                    {row.actorEmail ? null : <div className="history__when">written by a migration or a script</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
