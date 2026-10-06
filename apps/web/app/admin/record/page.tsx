import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { adminDashboard } from '@ozituma/db/dashboard';
import {
  listAccountsForAdmin,
  searchContent,
} from '@ozituma/db/admin';
import { RESET_TTL_MINUTES, listOpenResetRequests } from '@ozituma/db/passwords';
import { getCurrentAccount } from '@/lib/session';
import { Head } from '../ui';
import { isAdmin } from '@ozituma/db/accounts';
import { mailStatus } from '@ozituma/core';

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
   * The sections have their own pages now, so there is nothing to open from here: /admin/words,
   * /admin/names, /admin/clans, /admin/proverbs and the rest. The counts and the section list live
   * on the dashboard, which is where a dashboard keeps them.
   */
  const { dictionary, audio, accounts, queue, donations } = data;
  // Whether recovery email works decides what the account buttons say, so the
  // page has to know before it draws them.
  const mail = mailStatus();


  return (
    <>
      {/*
        This screen used to be the whole admin. The sections, the users and the analytics have
        their own pages now, so what is left is the search, the donations and the languages.
      */}
      <Head title="Settings">
        <span className="wpbadge">{current.account.email}</span>
      </Head>

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

      {/*
        The counts and the section list used to be here. They belong to the dashboard, which is what
        a dashboard is for, and repeating them on the accounts screen meant every admin page carried
        the same wall of numbers. They live on /admin now and only there.
      */}

      <section className="wpcard">
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
          <table className="wptable" style={{ marginTop: '1rem' }}>
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
                      <span className="wphelp">not linked</span>
                    )}
                  </td>
                  <td className="wphelp">{entry.submittedByName ?? 'unknown'}</td>
                  <td className="wphelp">{formatDate(entry.submittedAt)}</td>
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
          <p className="wphelp">No contributions have been submitted yet.</p>
        )}

        <p style={{ marginTop: '1rem' }}>
          <Link className="wpbtn" href="/review">
            Open the review queue
          </Link>
        </p>
      </section>

      {/*
        The accounts list and its forms used to be here. They have their own screens now — Users and
        Add account — because the owner asked for WordPress's split: a list you scan, and a form you
        open only when you want it, rather than a form sitting open above every list.
      */}

      <section className="wpcard">
        <h2>Everything in the record</h2>
        <p className="wphelp" style={{ fontSize: '0.95rem' }}>
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
          {/* A placeholder is not an accessible name, so the field gets a label bound to it. */}
          <label className="visually-hidden" htmlFor="record-query">Search the record</label>
          <input
            id="record-query"
            name="query"
            defaultValue={searchTerm}
            placeholder="A word, a name, a clan, a proverb…"
            className="search-input"
            style={{ minWidth: '16rem', flex: '1 1 16rem' }}
          />
          <button className="wpbtn" type="submit">
            Find it
          </button>
        </form>

        {searchTerm.length >= 2 ? (
          content.length > 0 ? (
            <table className="wptable" style={{ marginTop: '1rem' }}>
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
                        <div className="wphelp" style={{ fontSize: '0.85rem' }}>
                          {row.subtitle}
                        </div>
                      ) : null}
                    </td>
                    <td>{row.kind}</td>
                    <td className="wphelp">{row.status}</td>
                    <td>
                      <Link className="wpbtn wpbtn-quiet" href={row.url}>
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
                        <button className="wpbtn wpbtn-quiet" type="submit" name="mode" value="hide">
                          Hide
                        </button>
                        <button className="wpbtn wpbtn-quiet" type="submit" name="mode" value="delete">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="wphelp" style={{ marginTop: '1rem' }}>
              Nothing in the record matches &ldquo;{searchTerm}&rdquo;.
            </p>
          )
        ) : null}
      </section>

      <section className="wpcard">
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
          <table className="wptable" style={{ marginTop: '1rem' }}>
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
                  <td className="wphelp">{entry.email}</td>
                  <td>
                    <span className={entry.status === 'success' ? 'chip chip-common' : 'chip'}>
                      {entry.status}
                    </span>
                  </td>
                  <td className="wphelp">{formatDate(entry.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="wphelp">No donations recorded yet.</p>
        )}
      </section>

      <section className="wpcard">
        <h2>Languages</h2>
        <table className="wptable">
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
    </>
  );
}
