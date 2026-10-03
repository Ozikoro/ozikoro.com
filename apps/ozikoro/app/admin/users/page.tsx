/**
 * /admin/users — every account, and every byline the archive credits.
 *
 * WHY THE TWO LISTS ARE ON ONE SCREEN
 *
 * The archive has one account and eleven bylines, and WordPress gave us no password hash for any of them, so
 * **the contributors who wrote 1,057 records cannot sign in and there is nothing to migrate that fixes it** —
 * they have to claim a byline, and a human has to approve the claim. The question an editor actually has is
 * "which of my writers has never signed in?", and neither table can answer it alone. So the bylines are shown
 * beside the accounts, and the difference between the two counts is the answer.
 *
 * WHY THE NUMBERS COME FIRST
 *
 * Same reason the rights screen opens on its numbers rather than its form: "1,057 records, 11 bylines and one
 * account that can sign in" is the state of the archive, and a screen that hid it behind a table would let the
 * gap go on being invisible. Every figure below is a `count(*)` over the rows it describes — **nothing on this
 * page is estimated, and an empty table says it is empty rather than showing a dash**.
 *
 * WHY THE GATE IS HERE AND NOT ONLY IN THE LAYOUT
 *
 * The layout lets editors, moderators and audio reviewers into the back office, because the editorial queues
 * are theirs. The user table is not: it carries every account's address and every writer's name, and the
 * capability that governs it is `manage_users`, which only an administrator or the owner holds. **A page that
 * relied on the layout would hand the whole account list to anyone who could open the editorial queue**, so
 * this page asks for its own capability and redirects with the reason if the answer is no.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getUserOverview, listContributors, listUserAccounts, roleLabel, type OzikoroRole } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const TABS = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'contributors', label: 'Contributors' },
] as const;

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

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; owner?: string; page?: string; saved?: string; error?: string }>;
}) {
  // The gate. Editors and moderators never reach the queries below.
  await requireCapabilityOrRedirect('manage_users', '/admin/users');

  const params = await searchParams;
  const tab = params.tab === 'contributors' ? 'contributors' : 'accounts';
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
        <Link className="btn btn--sm" href="/admin">
          Back to overview
        </Link>
      </Head>

      <Notices saved={params.saved} error={params.error} />

      <Card title="Where the archive stands">
        <AtAGlance
          rows={[
            ['Accounts', overview.accounts.toLocaleString('en-GB')],
            ['Active accounts', overview.activeAccounts.toLocaleString('en-GB')],
            ['Suspended accounts', overview.suspendedAccounts.toLocaleString('en-GB')],
            ['Contributors in the archive', overview.contributors.toLocaleString('en-GB')],
            ['Contributors with an account', overview.contributorsWithAccount.toLocaleString('en-GB')],
            ['Contributors with no account', overview.contributorsWithoutAccount.toLocaleString('en-GB')],
          ]}
        />
        <p className="help">
          {overview.contributorsWithoutAccount === 0
            ? 'Every contributor who wrote for the archive has an account.'
            : `${overview.contributorsWithoutAccount} of the ${overview.contributors} contributors credited in ` +
              `the archive have no account, and their ${overview.articlesByUnlinkedBylines.toLocaleString('en-GB')} ` +
              `of ${overview.articles.toLocaleString('en-GB')} records are attributed to a byline nobody can sign ` +
              'in as. WordPress stores no password hash, so nothing could be carried across — a claim has to be ' +
              'made and approved, and this screen does not create accounts for them.'}
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
            <Link
              key={entry.value}
              className={entry.value === tab ? 'btn btn--sm btn--primary' : 'btn btn--sm'}
              href={`/admin/users?tab=${entry.value}`}
              aria-current={entry.value === tab ? 'page' : undefined}
            >
              {entry.label}
            </Link>
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
                    <Link href={`/admin/users/${account.id}`}>{account.displayName}</Link>
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
                    <Link className="btn btn--sm" href={`/admin/users/${account.id}`}>Open</Link>
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
                <th scope="col">Records</th>
                <th scope="col">Account</th>
              </tr>
            </thead>
            <tbody>
              {contributors.contributors.map((contributor) => (
                <tr key={contributor.id}>
                  <td>
                    <Link href={`/author/${contributor.slug}`}>{contributor.displayName}</Link>
                    <div className="history__when">
                      {contributor.slug}
                      {contributor.hasBio ? null : ' · no biography'}
                    </div>
                  </td>
                  <td className="small">{contributor.articles.toLocaleString('en-GB')}</td>
                  <td className="small">
                    {contributor.accountId ? (
                      <>
                        <Link href={`/admin/users/${contributor.accountId}`}>{contributor.accountEmail}</Link>
                        {contributor.accountName && contributor.accountName !== contributor.displayName ? (
                          <div className="history__when">
                            the account is named {contributor.accountName}, which does not match the byline
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        No account
                        <div className="history__when">
                          {contributor.claimStatus === 'pending'
                            ? 'a claim is waiting for review'
                            : contributor.claimStatus === 'rejected'
                              ? 'a claim was rejected'
                              : 'has never signed in and has not claimed this byline'}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <nav className="row" style={{ marginTop: '1rem' }} aria-label="Pagination">
          {page > 1 ? (
            <Link className="btn btn--sm" href={query({ page: String(page - 1) })}>← Previous</Link>
          ) : <span />}
          <span className="small muted">page {page}</span>
          {rowsOnPage === PAGE_SIZE && page * PAGE_SIZE < showing ? (
            <Link className="btn btn--sm" href={query({ page: String(page + 1) })}>Next →</Link>
          ) : <span />}
        </nav>
      </Card>
    </>
  );
}
