import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { adminDashboard } from '@ozituma/db/dashboard';
import {
  listAccountsForAdmin,
  listSection,
  listSections,
  searchContent,
  type SectionKey,
} from '@ozituma/db/admin';
import { RESET_TTL_MINUTES, listOpenResetRequests } from '@ozituma/db/passwords';
import { getCurrentAccount } from '@/lib/session';
import { isAdmin } from '@ozituma/db/accounts';
import { mailStatus } from '@/lib/mail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin',
  description: 'The state of the dictionary.',
  robots: { index: false },
};

function n(value: number): string {
  return value.toLocaleString('en-GB');
}

function money(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    // An unknown currency code must not take the page down.
    return `${currency} ${major.toLocaleString('en-GB')}`;
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string; q?: string; section?: string; page?: string }>;
}) {
  const params = await searchParams;
  const current = await getCurrentAccount();
  if (!current) redirect('/signin?error=Sign+in+to+reach+the+dashboard.');
  /*
 * The owner passes this check as well as an admin: ownership is a fact about the
 * project, not a separate permission, so `role !== 'admin'` would have locked the
 * owner out of their own dashboard.
 */
  if (!isAdmin(current.account.role)) redirect('/account');

  const db = await getDb();
  const [data, resets, adminAccounts] = await Promise.all([
    adminDashboard(db),
    listOpenResetRequests(db),
    listAccountsForAdmin(db),
  ]);
  const searchTerm = typeof params.q === 'string' ? params.q.trim() : '';
  const content = searchTerm.length >= 2 ? await searchContent(db, searchTerm) : [];
  /*
   * The sections, and one of them open.
   *
   * The owner: "on the admin, I should be able to see everything, including sections
   * emulating wordpress open source where i can see everything, edit and feel good about
   * the dashboard, like a real dashboard." The counts were already here; what was missing
   * was a way to open a section and work down it, which is this.
   */
  const sections = await listSections(db);
  const openSection = (typeof params.section === 'string' ? params.section : '') as SectionKey | '';
  const openPage = Number(params.page ?? '1') || 1;
  const listing =
    openSection && sections.some((section) => section.key === openSection)
      ? await listSection(db, openSection, openPage)
      : null;
  const { dictionary, audio, accounts, queue, donations } = data;
  // Whether recovery email works decides what the account buttons say, so the
  // page has to know before it draws them.
  const mail = mailStatus();

  const figures: { label: string; value: string; note?: string }[] = [
    { label: 'words', value: n(dictionary.words), note: `${n(dictionary.publishedWords)} published` },
    { label: 'meanings', value: n(dictionary.definitions) },
    { label: 'names', value: n(dictionary.names) },
    {
      label: 'proverbs',
      value: n(dictionary.proverbs),
      note: `${n(dictionary.translatedProverbs)} with English`,
    },
    {
      label: 'recordings',
      value: n(audio.total),
      note: `${n(audio.dialect)} dialect, ${n(audio.sentences)} on sentences`,
    },
    { label: 'relations between words', value: n(dictionary.relations) },
    { label: 'varieties', value: n(dictionary.dialects) },
    { label: 'accounts', value: n(accounts.total), note: `${n(accounts.signedInLast30)} signed in this month` },
  ];

  return (
    <div className="wrap">
      <div className="name-page-head">
        <p className="name-eyebrow">Administrator</p>
        <h1 className="name-title">Admin dashboard</h1>
        <p className="name-lede">
          Every number here is counted from the live tables, not estimated. Signed in as{' '}
          {current.account.email}.
        </p>
      </div>

      {params.done ? (
        <div className="notice" role="status" style={{ marginBottom: '1.25rem' }}>
          {params.done}
        </div>
      ) : null}
      {params.error ? (
        <div className="notice notice-warn" role="alert" style={{ marginBottom: '1.25rem' }}>
          {params.error}
        </div>
      ) : null}

      <div className="grid">
        {figures.map((figure) => (
          <div className="card" key={figure.label}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {figure.value}
            </div>
            <div className="card-meta">{figure.label}</div>
            {figure.note ? <div className="card-meta">{figure.note}</div> : null}
          </div>
        ))}
      </div>

      <section className="section">
        <h2>Everything, by section</h2>
        <p className="muted" style={{ fontSize: '0.95rem' }}>
          Each count is live. Open one to work down the list — every entry there can be opened,
          hidden or deleted.
        </p>
        <div className="grid" style={{ marginTop: '1rem' }}>
          {sections.map((section) => (
            <div className="card" key={section.key}>
              <div style={{ fontSize: '1.4rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {n(section.total)}
              </div>
              <div className="card-meta">
                {section.key === 'submissions'
                  ? `${n(section.live)} waiting`
                  : `${n(section.live)} live`}
              </div>
              <h3 style={{ margin: '0.6rem 0 0.3rem', fontSize: '1rem' }}>
                <Link href={`/admin?section=${section.key}`}>{section.label}</Link>
              </h3>
              <p className="card-meta" style={{ margin: 0 }}>{section.note}</p>
            </div>
          ))}
        </div>

        {listing ? (
          <>
            <h3 style={{ marginTop: '1.75rem' }}>
              {listing.label}{' '}
              <span className="muted" style={{ fontWeight: 400, fontSize: '0.9rem' }}>
                {n(listing.total)} in all, page {listing.page} of {Math.max(1, listing.pages)}
              </span>
            </h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>State</th>
                  <th>Open</th>
                  <th>Hide or delete</th>
                </tr>
              </thead>
              <tbody>
                {listing.rows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td>
                      <strong>{row.title}</strong>
                      {row.subtitle ? (
                        <div className="muted" style={{ fontSize: '0.82rem' }}>
                          {row.subtitle}
                        </div>
                      ) : null}
                    </td>
                    <td className="muted">{row.status}</td>
                    <td>
                      <Link className="button button-secondary" href={row.url}>
                        Open
                      </Link>
                    </td>
                    <td>
                      {/* Recordings and submissions are read here and acted on where the
                          whole of them can be seen. */}
                      {listing.key === 'recordings' || listing.key === 'submissions' ? (
                        <span className="muted" style={{ fontSize: '0.85rem' }}>
                          {listing.key === 'recordings' ? 'listen on the entry' : 'decide in review'}
                        </span>
                      ) : (
                        <form
                          action="/api/admin/accounts"
                          method="post"
                          style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}
                        >
                          <input type="hidden" name="action" value="content.remove" />
                          <input
                            type="hidden"
                            name="back"
                            value={`/admin?section=${listing.key}&page=${listing.page}`}
                          />
                          <input type="hidden" name="kind" value={row.kind} />
                          <input type="hidden" name="id" value={row.id} />
                          <button className="button button-secondary" type="submit" name="mode" value="hide">
                            Hide
                          </button>
                          <button className="button button-secondary" type="submit" name="mode" value="delete">
                            Delete
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listing.pages > 1 ? (
              <p style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                {listing.page > 1 ? (
                  <Link
                    className="button button-secondary"
                    href={`/admin?section=${listing.key}&page=${listing.page - 1}`}
                  >
                    ← Previous
                  </Link>
                ) : null}
                {listing.page < listing.pages ? (
                  <Link
                    className="button button-secondary"
                    href={`/admin?section=${listing.key}&page=${listing.page + 1}`}
                  >
                    Next →
                  </Link>
                ) : null}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="section">
        <h2>Contributions</h2>
        <ul className="hero-stats">
          <li>
            <strong>{n(queue.pending)}</strong>
            <span>awaiting review</span>
          </li>
          <li>
            <strong>{n(queue.approved)}</strong>
            <span>approved</span>
          </li>
          <li>
            <strong>{n(queue.merged)}</strong>
            <span>merged</span>
          </li>
          <li>
            <strong>{n(queue.rejected)}</strong>
            <span>not accepted</span>
          </li>
          <li>
            <strong>{n(queue.contributors)}</strong>
            <span>contributors</span>
          </li>
        </ul>

        {data.recentSuggestions.length > 0 ? (
          <table className="table" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Kind</th>
                <th>What was edited</th>
                <th>From</th>
                <th>When</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recentSuggestions.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.kind.replace(/_/g, ' ')}</td>
                  {/*
                    The direct link to what was edited. The owner: "when i go to the dashboard to see
                    the edits, I can easily see the direct link to the edited words, names, proverbs".
                    Without it the table names the kind of submission and the contributor and leaves
                    the reviewer to find the entry themselves — and the entry may have been renamed
                    since, which is why the link is resolved from the ids the submission was made
                    against rather than from its text.
                  */}
                  <td>
                    {entry.target ? (
                      <Link href={entry.target.url}>{entry.target.label}</Link>
                    ) : (
                      <span className="muted">not linked</span>
                    )}
                  </td>
                  <td className="muted">{entry.submittedByName ?? 'unknown'}</td>
                  <td className="muted">{formatDate(entry.submittedAt)}</td>
                  <td>
                    <span className={entry.status === 'pending' ? 'chip' : 'chip chip-common'}>
                      {entry.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No contributions have been submitted yet.</p>
        )}

        <p style={{ marginTop: '1rem' }}>
          <Link className="button" href="/review">
            Open the review queue
          </Link>
        </p>
      </section>

      <section className="section">
        <h2>Accounts</h2>
        <ul className="hero-stats">
          <li>
            <strong>{n(accounts.contributors)}</strong>
            <span>contributors</span>
          </li>
          <li>
            <strong>{n(accounts.editors)}</strong>
            <span>editors</span>
          </li>
          <li>
            <strong>{n(accounts.admins)}</strong>
            <span>administrators</span>
          </li>
          <li>
            <strong>{n(accounts.suspended)}</strong>
            <span>suspended</span>
          </li>
        </ul>
        {/*
          Every account, with the controls to change it.
          The owner: "an admin should be able to edit, delete, add and edit any part of
          the website from the admin." A table that only lists people is a report, not an
          admin, so each row carries its own form: the role, whether the account may sign
          in, a password link, and removal.
        */}
        <details open style={{ marginTop: '1.25rem' }}>
          <summary>Add an account</summary>
          <form
            action="/api/admin/accounts"
            method="post"
            style={{ display: 'grid', gap: '0.6rem', maxWidth: '34rem', marginTop: '0.75rem' }}
          >
            <input type="hidden" name="action" value="account.create" />
            <input type="hidden" name="back" value="/admin" />
            <div>
              <label htmlFor="new-email">Email</label>
              <input id="new-email" name="email" type="email" required className="search-input" style={{ width: '100%' }} />
            </div>
            <div>
              <label htmlFor="new-name">Name</label>
              <input id="new-name" name="displayName" maxLength={80} className="search-input" style={{ width: '100%' }} />
            </div>
            <div>
              <label htmlFor="new-password">A first password to hand over</label>
              <input id="new-password" name="password" type="text" required minLength={10} className="search-input" style={{ width: '100%' }} />
              <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
                At least 10 characters. Send it to them yourself — they can change it from their
                own page. It is recorded that an administrator set it.
              </p>
            </div>
            <div>
              <label htmlFor="new-role">Role</label>
              <select id="new-role" name="role" className="search-input" defaultValue="contributor">
                <option value="contributor">Contributor — can submit, cannot review</option>
                <option value="editor">Editor — can review the queue</option>
                <option value="admin">Administrator — everything below the owner</option>
              </select>
            </div>
            <div>
              <button className="button" type="submit">Add the account</button>
            </div>
          </form>
        </details>

        {adminAccounts.length > 0 ? (
          <table className="table" style={{ marginTop: '1.25rem' }}>
            <thead>
              <tr>
                <th>Account</th>
                <th>Role and access</th>
                <th>Joined</th>
                <th>Password</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {adminAccounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    {account.displayName ? `${account.displayName} · ` : ''}
                    <span className="muted">{account.email}</span>
                    {account.status !== 'active' ? (
                      <>
                        {' '}
                        <span className="chip">{account.status}</span>
                      </>
                    ) : null}
                    <div className="muted" style={{ fontSize: '0.8rem' }}>
                      {account.contributions} contribution{account.contributions === 1 ? '' : 's'}
                      {account.lastLoginAt
                        ? ` · last signed in ${formatDate(account.lastLoginAt)}`
                        : ' · never signed in'}
                    </div>
                  </td>
                  <td>
                    <form
                      action="/api/admin/accounts"
                      method="post"
                      style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <input type="hidden" name="action" value="account.update" />
                      <input type="hidden" name="accountId" value={account.id} />
                      <input type="hidden" name="back" value="/admin" />
                      <select name="role" defaultValue={account.role} className="search-input">
                        <option value="contributor">contributor</option>
                        <option value="editor">editor</option>
                        <option value="admin">admin</option>
                        {account.role === 'owner' ? <option value="owner">owner</option> : null}
                      </select>
                      <select name="status" defaultValue={account.status === 'suspended' ? 'suspended' : 'active'} className="search-input">
                        <option value="active">active</option>
                        <option value="suspended">suspended</option>
                      </select>
                      <button className="button button-secondary" type="submit">Save</button>
                    </form>
                  </td>
                  <td className="muted">{formatDate(account.createdAt)}</td>
                  <td>
                    <form action="/api/admin/password-link" method="post">
                      <input type="hidden" name="accountId" value={account.id} />
                      <button className="button button-secondary" type="submit" name="how" value={mail.configured ? 'email' : 'show'}>
                        {mail.configured ? 'Email a link' : 'Make a link'}
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action="/api/admin/accounts" method="post">
                      <input type="hidden" name="action" value="account.delete" />
                      <input type="hidden" name="accountId" value={account.id} />
                      <input type="hidden" name="back" value="/admin" />
                      <button className="button button-secondary" type="submit">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <h3 style={{ marginTop: '1.75rem' }}>Passwords and recovery</h3>
        {mail.configured ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            Recovery email is on, sending through <strong>{mail.transport}</strong> as{' '}
            {mail.from}. A link is good for {RESET_TTL_MINUTES} minutes and works once.
          </p>
        ) : (
          <div className="notice notice-warn" role="status">
            <p style={{ marginTop: 0 }}>
              <strong>Recovery email is not switched on.</strong> Somebody who forgets their
              password cannot ask for a link, so nobody can get back into an account without you.
            </p>
            <p style={{ marginBottom: 0 }} className="muted">
              {mail.reason} Until then, use <em>Make a recovery link</em> above and pass the link on
              by hand — it expires and works once, and you never see the password they choose.
            </p>
          </div>
        )}

        {resets.length > 0 ? (
          <>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: '1rem' }}>
              People who have asked for a link and have not used it yet:
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Asked</th>
                  <th>Expires</th>
                  <th>Reached them by</th>
                </tr>
              </thead>
              <tbody>
                {resets.map((reset) => (
                  <tr key={reset.id}>
                    <td>{reset.email}</td>
                    <td className="muted">{formatDate(reset.createdAt)}</td>
                    <td className="muted">{formatDate(reset.expiresAt)}</td>
                    <td className="muted">
                      {reset.deliveredBy === 'email'
                        ? 'email'
                        : reset.deliveredBy === 'hand'
                          ? 'passed on by hand'
                          : 'not delivered — waiting'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            Nobody is waiting on a recovery link.
          </p>
        )}
      </section>

      <section className="section">
        <h2>Everything in the record</h2>
        <p className="muted" style={{ fontSize: '0.95rem' }}>
          Find any entry — a word, a name, a clan, a proverb — and act on it from here. Editing
          opens the entry&rsquo;s own page, which is where its correction form is; your edits apply
          the moment you submit them.
        </p>

        <form
          action="/api/admin/accounts"
          method="post"
          style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}
        >
          <input type="hidden" name="action" value="content.search" />
          <input type="hidden" name="back" value="/admin" />
          <input
            name="query"
            defaultValue={searchTerm}
            placeholder="A word, a name, a clan, a proverb…"
            className="search-input"
            style={{ minWidth: '16rem', flex: '1 1 16rem' }}
          />
          <button className="button" type="submit">
            Find it
          </button>
        </form>

        {searchTerm.length >= 2 ? (
          content.length > 0 ? (
            <table className="table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Kind</th>
                  <th>State</th>
                  <th>Edit</th>
                  <th>Hide or delete</th>
                </tr>
              </thead>
              <tbody>
                {content.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td>
                      <strong>{row.title}</strong>
                      {row.subtitle ? (
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {row.subtitle}
                        </div>
                      ) : null}
                    </td>
                    <td>{row.kind}</td>
                    <td className="muted">{row.status}</td>
                    <td>
                      <Link className="button button-secondary" href={row.url}>
                        Open
                      </Link>
                    </td>
                    <td>
                      <form
                        action="/api/admin/accounts"
                        method="post"
                        style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}
                      >
                        <input type="hidden" name="action" value="content.remove" />
                        <input type="hidden" name="back" value={`/admin?q=${encodeURIComponent(searchTerm)}`} />
                        <input type="hidden" name="kind" value={row.kind} />
                        <input type="hidden" name="id" value={row.id} />
                        <button className="button button-secondary" type="submit" name="mode" value="hide">
                          Hide
                        </button>
                        <button className="button button-secondary" type="submit" name="mode" value="delete">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ marginTop: '1rem' }}>
              Nothing in the record matches &ldquo;{searchTerm}&rdquo;.
            </p>
          )
        ) : null}
      </section>

      <section className="section">
        <h2>Donations</h2>
        <ul className="hero-stats">
          <li>
            <strong>{money(donations.totalMinor, donations.currency)}</strong>
            <span>received in total</span>
          </li>
          <li>
            <strong>{money(donations.last30Minor, donations.currency)}</strong>
            <span>in the last 30 days</span>
          </li>
          <li>
            <strong>{n(donations.succeeded)}</strong>
            <span>{donations.succeeded === 1 ? 'donation' : 'donations'}</span>
          </li>
          <li>
            <strong>{n(donations.count - donations.succeeded)}</strong>
            <span>started and not completed</span>
          </li>
        </ul>
        {donations.recent.length > 0 ? (
          <table className="table" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Amount</th>
                <th>From</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {donations.recent.map((entry) => (
                <tr key={entry.reference}>
                  <td className="mono">{entry.reference}</td>
                  <td>{money(entry.amountMinor, donations.currency)}</td>
                  <td className="muted">{entry.email}</td>
                  <td>
                    <span className={entry.status === 'success' ? 'chip chip-common' : 'chip'}>
                      {entry.status}
                    </span>
                  </td>
                  <td className="muted">{formatDate(entry.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No donations recorded yet.</p>
        )}
      </section>

      <section className="section">
        <h2>Languages</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Language</th>
              <th>Words</th>
              <th>Published</th>
              <th>Names</th>
              <th>Proverbs</th>
              <th>Recordings</th>
            </tr>
          </thead>
          <tbody>
            {data.languages.map((language) => (
              <tr key={language.code}>
                <td>{language.name}</td>
                <td>{n(language.words)}</td>
                <td>{n(language.published)}</td>
                <td>{n(language.names)}</td>
                <td>{n(language.proverbs)}</td>
                <td>{n(language.recordings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
