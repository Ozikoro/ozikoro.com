/**
 * The workspace — what a role can do, and who holds one.
 *
 * THE ROLE MAP IS REAL DATA, WHICH IS WHY THIS PAGE CAN BE BUILT AT ALL
 *
 * The nine dashboards the brief names have no members to serve: `account`, `ozikoro_member` and
 * `ozikoro_member_role` all hold zero rows. **But `ozikoro_role_capability` holds 53** — the complete
 * role-to-capability map — so this page renders something true rather than nine empty screens dressed as
 * dashboards.
 *
 * It shows, for every role the archive defines, exactly which capabilities that role carries; and for the
 * signed-in member, which of them are actually theirs. **The second is the one that matters**: a capability
 * list is only worth showing if it is resolved rather than asserted, and `capabilitiesFor` resolves it in the
 * database on every load.
 *
 * WHICH ROLES, AND WHY THERE ARE TEN RATHER THAN NINE
 *
 * The brief names nine — reader, student, teacher, researcher, independent researcher, community knowledge
 * holder, editor, expert reviewer and admin. The table carries a tenth, **moderator**, with three capabilities
 * (`moderate`, `review_reports`, `read`). **The page shows all ten and says so**, because a role that exists in
 * the database and not on the page is how two lists come to disagree.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not draw a dashboard per role. Each of those is a distinct screen in the design
 * (`dashboard-reader`, `dashboard-editor`, `dashboard-admin` and the rest) with its own layout, and building
 * nine of them as empty states for members who do not exist would be nine pages of furniture. **What is real
 * now is the permission model**, and that is what this page shows.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import { capabilitiesFor, roleLabel } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Workspace',
  description: 'The roles the archive defines and what each one can do.',
  robots: { index: false, follow: false },
  alternates: { canonical: 'https://ozikoro.com/workspace' },
};

interface RoleRow {
  role: string;
  capability: string;
}

export default async function WorkspacePage() {
  const current = await getCurrentAccount();
  const requestedPath = (await headers()).get('x-pathname') ?? '/workspace/';

  if (!current) {
    redirect(
      `/signin?error=${encodeURIComponent('Sign in to reach the workspace.')}` +
        `&next=${encodeURIComponent(requestedPath)}`
    );
  }

  const { account } = current;
  const db = await getDb();
  const [mine, rows] = await Promise.all([
    capabilitiesFor(db, account.id),
    db.rows<RoleRow>(`select role, capability from ozikoro_role_capability order by role, capability`),
  ]);

  const byRole = new Map<string, string[]>();
  for (const row of rows) {
    const list = byRole.get(row.role) ?? [];
    list.push(row.capability);
    byRole.set(row.role, list);
  }
  const roles = [...byRole.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="wrap section">
      <p className="eyebrow">
        <Link href="/account">Account &amp; profile</Link>
      </p>
      <h1>Workspace</h1>
      <p className="lede">
        What each role can do, and which of it is yours. Roles and capabilities are resolved in the database
        on every load — never from anything your browser sends.
      </p>

      <section className="section">
        <h2>Yours</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Signed in as</th>
              <td>{account.displayName ?? account.email}</td>
            </tr>
            <tr>
              <th scope="row">Role</th>
              <td>{roleLabel(account.role as never) ?? account.role}</td>
            </tr>
            <tr>
              <th scope="row">Capabilities</th>
              <td className="small">
                {[...mine].sort().join(' · ') || <span className="unsourced">None</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>The roles this archive defines</h2>
        <p className="muted">
          {roles.length} roles, {rows.length} role-to-capability grants. The brief names nine; the table carries
          a tenth, <strong>moderator</strong>, which is listed here because a role that exists in the database
          and not on the page is how two lists come to disagree.
        </p>

        <div className="grid">
          {roles.map(([role, caps]) => {
            const held = caps.filter((c) => mine.has(c)).length;
            return (
              <div className="card" key={role}>
                <h3>{roleLabel(role as never) ?? role}</h3>
                <p className="muted small">
                  {caps.length} capabilit{caps.length === 1 ? 'y' : 'ies'}
                  {held > 0 ? ` · you hold ${held}` : ''}
                </p>
                <p className="small">{caps.sort().join(' · ')}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <h2>Role-specific workspaces</h2>
        <p className="muted">
          Each role has its own screen in the approved design — reader, student, teacher, researcher,
          independent researcher, community knowledge holder, editor, expert reviewer, moderator and admin —
          and they are not built yet. They need members: <strong>every membership table is empty</strong>, so a
          dashboard today would be furniture rather than a workspace.
        </p>
        <p className="muted">
          What is already real is the model above and the barrier it enforces. Administration is open to
          anyone holding <code>edit_entity</code>, <code>moderate</code> or <code>expert_review</code>, and it
          refuses everyone else at the layout.
        </p>
        <p>
          <Link className="btn" href="/account">
            Your account
          </Link>{' '}
          <Link className="btn" href="/admin">
            Administration
          </Link>
        </p>
      </section>
    </div>
  );
}
