/**
 * /admin/users — every account, and every byline the archive credits.
 *
 * WHY THE TWO LISTS ARE ON ONE SCREEN
 *
 * WordPress gave us no password hash for anybody, so **the contributors who wrote the archive cannot sign in
 * and there is nothing to migrate that fixes it** — they have to claim a byline, and a human has to approve
 * the claim. The question an editor actually has is "which of my writers has never signed in?", and neither
 * table can answer it alone. So the bylines are shown beside the accounts, and the difference between the two
 * counts is the answer.
 *
 * ⚠️ **AN ACCOUNT AND A BYLINE ARE DIFFERENT CLAIMS AND THIS PAGE MUST NOT BLUR THEM.** An account is
 * somebody who can sign in; a byline is somebody who wrote something. The owner's report — *"i did not see
 * the wordpress 15 users"* — was the second list being read as the first: the screen opened on the accounts,
 * which is six people who can sign in, and the fifteen WordPress bylines were one click away and named
 * nothing about what each of them was. So the bylines are now the list this page opens on, and each one
 * carries **the role it held on ozikoro.com** (migration 0059, filled from the dump) and **whether anybody
 * behind it can sign in at all**. A byline with no account is reported as exactly that. **This screen still
 * cannot create an account, and nothing here does.**
 *
 * WHY THE NUMBERS COME FIRST
 *
 * Same reason the rights screen opens on its numbers rather than its form: "so many records, so many bylines
 * and so many accounts that can sign in" is the state of the archive, and a screen that hid it behind a table
 * would let the gap go on being invisible. **No figure below is written in this file** — every one is a
 * `count(*)` over the rows it describes, so a number that goes stale goes stale in the database and not in a
 * comment, and an empty table says it is empty rather than showing a dash.
 *
 * WHY THE GATE IS HERE AND NOT ONLY IN THE LAYOUT
 *
 * The layout lets editors, moderators and audio reviewers into the back office, because the editorial queues
 * are theirs. The user table is not: it carries every account's address and every writer's name, and the
 * capability that governs it is `manage_users`, which only an administrator or the owner holds. **A page that
 * relied on the layout would hand the whole account list to anyone who could open the editorial queue**, so
 * this page asks for its own capability and redirects with the reason if the answer is no.
 */
import { getDb } from '@ozituma/db/client';
import { getUserOverview, listContributors, listUserAccounts, roleLabel, type OzikoroRole } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

/**
 * The order the lists are offered in, and the one the page opens on.
 *
 * `contributors` first because that is the list the owner could not find: the bylines are what the archive
 * holds and the accounts are the smaller, sharper set. A tab that is second is a tab that is not read.
 */
const TABS = [
  { value: 'contributors', label: 'Contributors' },
  { value: 'accounts', label: 'Accounts' },
] as const;

/**
 * WordPress's own five built-in roles. The wording is WordPress's, so a person who knew the old site's admin
 * recognises it, and a value outside this set is shown as itself rather than mapped onto the nearest platform
 * role — **the two vocabularies are not the same and must not be made to look as though they are.**
 */
const WP_ROLE_LABEL: Record<string, string> = {
  administrator: 'Administrator',
  editor: 'Editor',
  author: 'Author',
  contributor: 'Contributor',
  subscriber: 'Subscriber',
};

const ACCOUNT_STATUSES = [
  { value: 'all', label: 'Every status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deleted', label: 'Deleted' },
];

const BYLINE_OWNERSHIP = [
  { value: 'all', label: 'All bylines' },
  { value: 'linked', label: 'Has an account' },
  { value: 'unlinked', label: 'No account' },
];

/** `19 Oct 2026`, or the plain truth when there is nothing to show. */
function day(value: string | null): string {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function roleChips(roles: string[]) {
  if (roles.length === 0) {
    /*
     * An empty role list is not an error and not a dash. Every signed-in account is a Reader — that is what
     * `ozikoro_capabilities` decides — so a member row with no roles is reported as the role it actually
     * holds, rather than as an absence a reader would have to interpret.
     */
    return <span className="small muted">Reader (every account)</span>;
  }
  return (
    <span className="chips">
      {roles.map((role) => (
        <span className="chip" key={role}>
          {roleLabel(role as OzikoroRole)}
        </span>
      ))}
    </span>
  );
}

function statusNote(status: string) {
  if (status === 'active') return <span className="small">Active</span>;
  if (status === 'suspended') return <span className="small">Suspended</span>;
  return <span className="small">Deleted</span>;
}

/**
 * The role a byline held on ozikoro.com, or the plain truth that it has not been read in.
 *
 * **`not recorded` is not the same answer as a role and is not drawn as one.** The column is filled from the
 * WordPress dump by `packages/ozikoro/src/ops/backfill-contributor-roles.ts`; a database where that has not
 * been run shows the gap rather than a guess, and it is drawn muted so it reads as an absence.
 */
function wpRoleCell(role: string | null) {
  if (!role) return <span className="small muted">not recorded</span>;
  return <span className="chip">{WP_ROLE_LABEL[role] ?? role}</span>;
}

/**
 * Whether anybody behind this byline can sign in — the distinction this whole screen exists to keep.
 *
 * The two branches are worded so that neither can be read as the other: **"No account — cannot sign in"** is
 * the state of every WordPress byline the archive holds, and the account branch names the address, links to
 * it, and says outright that this person *can* sign in. Nothing here offers to create the first from the
 * second, because that would be inventing access rather than showing a record.
 */
function signInCell(contributor: { accountId: number | null; accountEmail: string | null; claimStatus: string | null }) {
  if (contributor.accountId) {
    return (
      <>
        <span className="small">Can sign in</span>
        <div className="history__when">
          <a href={`/admin/users/${contributor.accountId}`}>{contributor.accountEmail}</a>
        </div>
      </>
    );
  }
  return (
    <>
      <span className="small">No account — cannot sign in</span>
      <div className="history__when">
        {contributor.claimStatus === 'pending'
          ? 'a claim is waiting for review'
          : contributor.claimStatus === 'rejected'
            ? 'a claim was rejected'
            : 'has never signed in and has not claimed this byline'}
      </div>
    </>
  );
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; owner?: string; page?: string; saved?: string; error?: string }>;
}) {
  // The gate. Editors and moderators never reach the queries below.
  await requireCapabilityOrRedirect('manage_users', '/admin/users');

  const params = await searchParams;
  const tab = params.tab === 'accounts' ? 'accounts' : 'contributors';
  const search = params.q?.trim() || null;
  const status = (params.status ?? 'all').trim();
  const owner = (params.owner ?? 'all').trim() as 'all' | 'linked' | 'unlinked';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const db = await getDb();
  const [overview, accounts, contributors] = await Promise.all([
    getUserOverview(db),
    listUserAccounts(db, { search, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listContributors(db, { search, owner, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  const showing = tab === 'accounts' ? accounts.total : contributors.total;
  const rowsOnPage = tab === 'accounts' ? accounts.accounts.length : contributors.contributors.length;

  const query = (extra: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    const merged: Record<string, string | undefined> = { tab, q: search ?? undefined, status, owner, ...extra };
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== 'all') usp.set(key, value);
    }
    const text = usp.toString();
    return `/admin/users${text ? `?${text}` : ''}`;
  };

  return (
    <>
      <Head title="Users and contributors">
        <a className="btn btn--sm" href="/admin">
          Back to overview
        </a>
      </Head>

      <Notices saved={params.saved} error={params.error} />

      <Card title="Where the archive stands">
        <AtAGlance
          rows={[
            ['Contributors in the archive', overview.contributors.toLocaleString('en-GB')],
            ['Contributors who can sign in', overview.contributorsWithAccount.toLocaleString('en-GB')],
            ['Contributors who cannot sign in', overview.contributorsWithoutAccount.toLocaleString('en-GB')],
            ['Accounts', overview.accounts.toLocaleString('en-GB')],
            ['Active accounts', overview.activeAccounts.toLocaleString('en-GB')],
            ['Suspended accounts', overview.suspendedAccounts.toLocaleString('en-GB')],
          ]}
        />
        {/*
          ── WHAT THE CONTRIBUTORS WERE ON WORDPRESS, WHICH IS THE FACT THE OWNER COULD NOT FIND ────────
          The breakdown is the page's own `wp_role` column grouped, so it cannot disagree with the table
          below it, and it names the null bucket as "not recorded" rather than dropping it — a breakdown that
          silently omitted the bylines it could not classify would not add up to the total on the same card.
        */}
        <p className="small muted" style={{ marginTop: '0.75rem' }}>
          On WordPress, by the role each byline held there
        </p>
        <AtAGlance
          rows={overview.wpRoles.map((entry) => [
            entry.role ? (WP_ROLE_LABEL[entry.role] ?? entry.role) : 'Not recorded',
            `${entry.contributors.toLocaleString('en-GB')} ${
              entry.contributors === 1 ? 'byline' : 'bylines'
            } · ${entry.articles.toLocaleString('en-GB')} ${
              entry.articles === 1 ? 'record' : 'records'
            }`,
          ])}
        />
        <p className="help">
          {overview.contributors === 0
            ? 'The archive credits no contributors at all. That would mean the WordPress import has not run.'
            : overview.contributorsWithoutAccount === 0
              ? `Every one of the ${overview.contributors.toLocaleString('en-GB')} contributors who wrote for the ` +
                'archive has an account and can sign in.'
              : `${overview.contributorsWithoutAccount.toLocaleString('en-GB')} of the ` +
                `${overview.contributors.toLocaleString('en-GB')} bylines the archive credits cannot sign in — ` +
                `nobody holds an account for them — and their ` +
                `${overview.articlesByUnlinkedBylines.toLocaleString('en-GB')} of ` +
                `${overview.articles.toLocaleString('en-GB')} records are attributed to a byline nobody can sign in ` +
                'as. WordPress stores no password hash, so nothing could be carried across — a claim has to be made ' +
                'and approved, and this screen does not create accounts for them.'}
        </p>
        <p className="help">
          <strong>The WordPress role is a record and not an access level.</strong> It says what the person was on
          the old site; it grants no capability, opens no screen and creates no account. The only column on this
          page that says anything about signing in is the one headed <em>Can sign in</em>.
        </p>
        <p className="help">
          <strong>This screen changes who may do what, and nothing else.</strong> It cannot create an account,
          set a password, sign in as somebody, or delete anything — see the comment at the top of
          <code> /api/admin/users</code>. Suspension is offered instead of deletion because it is reversible and
          because deleting an account would silently uncredit everything its byline wrote.
        </p>
      </Card>

      <Card title={tab === 'accounts' ? 'Accounts' : 'Contributors'}>
        <nav className="row" style={{ gap: '0.5rem', marginBottom: '1rem' }} aria-label="Lists">
          {TABS.map((entry) => (
            <a
              key={entry.value}
              className={entry.value === tab ? 'btn btn--sm btn--primary' : 'btn btn--sm'}
              href={`/admin/users?tab=${entry.value}`}
              aria-current={entry.value === tab ? 'page' : undefined}
            >
              {entry.label}
              {entry.value === 'contributors'
                ? ` (${overview.contributors.toLocaleString('en-GB')})`
                : ` (${overview.accounts.toLocaleString('en-GB')})`}
            </a>
          ))}
        </nav>

        <form method="get" action="/admin/users" className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
          <input type="hidden" name="tab" value={tab} />
          <label className="visually-hidden" htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search ?? ''}
            placeholder={tab === 'accounts' ? 'Search by email or name' : 'Search by byline'}
          />
          {tab === 'accounts' ? (
            <>
              <label className="visually-hidden" htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={status}>
                {ACCOUNT_STATUSES.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label className="visually-hidden" htmlFor="owner">Account</label>
              <select id="owner" name="owner" defaultValue={owner}>
                {BYLINE_OWNERSHIP.map((entry) => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
            </>
          )}
          <button className="btn btn--sm btn--primary" type="submit">Apply</button>
        </form>

        <p className="small muted" style={{ marginTop: '0.75rem' }}>
          {showing === 0
            ? 'Nothing matches.'
            : `${showing.toLocaleString('en-GB')} ${tab === 'accounts' ? (showing === 1 ? 'account' : 'accounts') : showing === 1 ? 'byline' : 'bylines'}` +
              (rowsOnPage < showing ? `, showing ${rowsOnPage} on page ${page}` : '')}
        </p>

        {rowsOnPage === 0 ? (
          <p className="help">
            {search
              ? `No ${tab === 'accounts' ? 'account' : 'byline'} matches “${search}”. Nothing has been hidden; the search found nothing.`
              : tab === 'accounts'
                ? 'There are no accounts at all. This is the real state of the database, not a failure to load: an account is created by `scripts/create-account.ts` or by the dictionary, and none exists yet.'
                : 'The archive credits no contributors. That would mean the WordPress import has not run.'}
          </p>
        ) : tab === 'accounts' ? (
          <table className="record" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Platform role</th>
                <th scope="col">Ozikoro roles</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">Last signed in</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {accounts.accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <a href={`/admin/users/${account.id}`}>{account.displayName}</a>
                    <div className="history__when">{account.email}</div>
                  </td>
                  <td className="small">{account.platformRole}</td>
                  <td>{roleChips(account.roles)}</td>
                  <td>
                    {statusNote(account.status)}
                    {account.emailVerified ? null : <div className="history__when">address not verified</div>}
                  </td>
                  <td className="small">{day(account.createdAt)}</td>
                  <td className="small">
                    {day(account.lastLoginAt)}
                    {account.lastLoginAt ? null : <div className="history__when">has never signed in</div>}
                  </td>
                  <td>
                    <a className="btn btn--sm" href={`/admin/users/${account.id}`}>Open</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="record" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th scope="col">Byline</th>
                <th scope="col">On WordPress</th>
                <th scope="col">Records</th>
                <th scope="col">Can sign in</th>
              </tr>
            </thead>
            <tbody>
              {contributors.contributors.map((contributor) => (
                <tr key={contributor.id}>
                  <td>
                    <a href={`/author/${contributor.slug}`}>{contributor.displayName}</a>
                    <div className="history__when">
                      {contributor.slug}
                      {contributor.hasBio ? null : ' · no biography'}
                    </div>
                  </td>
                  <td>{wpRoleCell(contributor.wpRole)}</td>
                  <td className="small">{contributor.articles.toLocaleString('en-GB')}</td>
                  <td>
                    {signInCell(contributor)}
                    {contributor.accountId && contributor.accountName &&
                    contributor.accountName !== contributor.displayName ? (
                      <div className="history__when">
                        the account is named {contributor.accountName}, which does not match the byline
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <nav className="row" style={{ marginTop: '1rem' }} aria-label="Pagination">
          {page > 1 ? (
            <a className="btn btn--sm" href={query({ page: String(page - 1) })}>← Previous</a>
          ) : <span />}
          <span className="small muted">page {page}</span>
          {rowsOnPage === PAGE_SIZE && page * PAGE_SIZE < showing ? (
            <a className="btn btn--sm" href={query({ page: String(page + 1) })}>Next →</a>
          ) : <span />}
        </nav>
      </Card>
    </>
  );
}
