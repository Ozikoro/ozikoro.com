import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { accountDashboard } from '@ozituma/db/dashboard';
import { accountApiAccess } from '@ozituma/db/account-keys';
import { listPasswordChanges } from '@ozituma/db/passwords';
import { MIN_PASSWORD_LENGTH } from '@ozituma/db/accounts';
import { getCurrentAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your profile',
  description: 'Your contributions to Ozituma, and what became of them.',
  robots: { index: false },
};

/** How a contribution's state is shown. Same words the contribute page uses. */
const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Awaiting review', className: 'chip' },
  approved: { label: 'Published', className: 'chip chip-common' },
  merged: { label: 'Merged into an entry', className: 'chip chip-common' },
  rejected: { label: 'Not accepted', className: 'chip' },
  published: { label: 'Published', className: 'chip chip-common' },
  pending_review: { label: 'Awaiting review', className: 'chip' },
};

/** How the audit trail reads on the page. */
const PASSWORD_ROUTE: Record<string, string> = {
  self: 'Changed here, with the current password',
  recovery: 'Reset through an emailed link',
  admin: 'Set by an administrator',
};

const ROLE_LABEL: Record<string, string> = {
  contributor: 'Contributor',
  editor: 'Editor',
  admin: 'Administrator',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function describe(entry: { kind: string; payload: Record<string, unknown> }): string {
  const headword = typeof entry.payload.headword === 'string' ? entry.payload.headword : null;
  const word = headword ? `“${headword}”` : 'a correction';
  switch (entry.kind) {
    case 'new_word':
      return `New word ${word}`;
    case 'new_definition':
      return `A meaning for ${word}`;
    case 'new_example':
      return `An example sentence for ${word}`;
    case 'audio':
      return `A pronunciation of ${word}`;
    case 'dialect':
      return `A dialect form of ${word}`;
    case 'correction':
      return `A correction to ${word}`;
    default:
      return `A ${entry.kind.replace(/_/g, ' ')}`;
  }
}

/** How many live keys one account may hold. A key nobody can revoke is a liability. */
const MAX_KEYS = 10;

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    issued?: string;
    prefix?: string;
    keys?: string;
    changed?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const current = await getCurrentAccount();
  if (!current) redirect('/signin?error=Sign+in+to+see+your+profile.');

  const db = await getDb();
  const [data, api, changes] = await Promise.all([
    accountDashboard(db, current.account.id),
    accountApiAccess(db, current.account),
    listPasswordChanges(db, current.account.id),
  ]);
  const password = {
    changes,
    dates: changes.map((change) => formatDate(change.changedAt)),
  };
  const name = current.account.displayName ?? current.account.email;
  const { account } = current;
  const role = ROLE_LABEL[account.role] ?? account.role;
  const decided = data.contributions.approved + data.contributions.merged;

  return (
    <div className="wrap wrap-narrow">
      <div className="name-page-head">
        <p className="name-eyebrow">Your profile</p>
        <h1 className="name-title">{name}</h1>
        <p className="name-lede">
          {account.email} · <span className="chip chip-pos">{role}</span>
        </p>
      </div>

      <ul className="hero-stats">
        <li>
          <strong>{data.contributions.total}</strong>
          <span>{data.contributions.total === 1 ? 'contribution' : 'contributions'}</span>
        </li>
        <li>
          <strong>{decided}</strong>
          <span>in the dictionary</span>
        </li>
        <li>
          <strong>{data.contributions.pending}</strong>
          <span>awaiting review</span>
        </li>
        <li>
          <strong>{data.recordings.total}</strong>
          <span>{data.recordings.total === 1 ? 'recording' : 'recordings'}</span>
        </li>
        {current.canReview ? (
          <li>
            <strong>{data.reviewed}</strong>
            <span>you have reviewed</span>
          </li>
        ) : null}
      </ul>

      <section className="section">
        <h2>Your contributions</h2>
        {data.contributions.recent.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>What you sent</th>
                <th>When</th>
                <th>Where it stands</th>
              </tr>
            </thead>
            <tbody>
              {data.contributions.recent.map((entry) => {
                const status = STATUS[entry.status] ?? { label: entry.status, className: 'chip' };
                return (
                  <tr key={entry.id}>
                    <td>{describe(entry)}</td>
                    <td className="muted">{formatDate(entry.submittedAt)}</td>
                    <td>
                      <span className={status.className}>{status.label}</span>
                      {entry.reviewNote ? (
                        <p className="card-meta" style={{ margin: '0.35rem 0 0' }}>
                          {entry.reviewNote}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted">
            Nothing yet. <Link href="/contribute">Contribute a word</Link> — every submission is read
            by an editor before it appears in the dictionary.
          </p>
        )}
        {data.contributions.total > data.contributions.recent.length ? (
          <p className="card-meta" style={{ marginTop: '0.75rem' }}>
            Showing the {data.contributions.recent.length} most recent of{' '}
            {data.contributions.total}. <Link href="/contribute">See them all on Contribute</Link>.
          </p>
        ) : null}
      </section>

      <section className="section">
        <h2>Your recordings</h2>
        {data.recordings.total > 0 ? (
          <>
            <p className="muted">
              {data.recordings.published} published · {data.recordings.pending} awaiting review
              {data.recordings.rejected > 0 ? ` · ${data.recordings.rejected} not accepted` : ''}
              {data.recordings.approvals > 0
                ? ` · ${data.recordings.approvals} approval${data.recordings.approvals === 1 ? '' : 's'} from other people`
                : ''}
              {data.recordings.denials > 0 ? ` · ${data.recordings.denials} denial(s)` : ''}
            </p>
            <table className="table">
              <tbody>
                {data.recordings.recent.map((clip) => {
                  const status = STATUS[clip.status] ?? { label: clip.status, className: 'chip' };
                  return (
                    <tr key={clip.id}>
                      <td>{clip.wordHeadword ? <em>{clip.wordHeadword}</em> : 'an entry'}</td>
                      <td className="muted">{formatDate(clip.createdAt)}</td>
                      <td>
                        <span className={status.className}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className="muted">
            No recordings yet. Any entry page has a recorder on it, and a recording is credited to
            whoever made it.
          </p>
        )}
      </section>


      <section className="section">
        <h2>API access</h2>
        <p className="muted">
          Keys are issued here and nowhere else. A key is shown once, when it is created — the
          database keeps only its hash and a short prefix, so nobody, including us, can show it
          again. Revoke a key the moment it leaks; making another takes a second.
        </p>

        {params.issued ? (
          <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
            <strong>Copy this key now. It will not be shown again.</strong>
            <p className="mono" style={{ margin: '0.5rem 0', wordBreak: 'break-all' }}>
              {params.issued}
            </p>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              Send it as <span className="mono">x-api-key</span> on every request. Start at{' '}
              <Link href="/docs">the API documentation</Link>.
            </p>
          </div>
        ) : null}
        {params.keys === 'revoked' ? (
          <p className="notice" style={{ marginTop: '1rem' }}>
            Key revoked. Anything using it stops working immediately.
          </p>
        ) : null}
        {params.keys === 'limit' ? (
          <p className="notice notice-warn" style={{ marginTop: '1rem' }}>
            You already hold {MAX_KEYS} live keys. Revoke one before making another — a key nobody
            can account for is a key nobody can revoke.
          </p>
        ) : null}
        {params.keys === 'invalid' || params.keys === 'notfound' ? (
          <p className="notice notice-warn" style={{ marginTop: '1rem' }}>
            That request could not be applied. Nothing changed.
          </p>
        ) : null}

        <p className="card-meta" style={{ marginTop: '1rem' }}>
          Plan <strong>{api.developer.plan}</strong>
          {api.dailyLimit !== null
            ? ` · ${api.dailyLimit.toLocaleString('en-GB')} requests a day, per endpoint`
            : ' · no daily limit recorded for this plan'}
        </p>

        {api.keys.length > 0 ? (
          <table className="table" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th>Key</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Today</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {api.keys.map((key) => {
                const revoked = key.revokedAt !== null;
                const expired = key.expiresAt !== null && new Date(key.expiresAt) < new Date();
                return (
                  <tr key={key.id}>
                    <td>
                      <span className="mono">{key.keyPrefix}…</span>
                      <div className="card-meta">{key.name}</div>
                    </td>
                    <td className="muted">{key.scopes.join(', ')}</td>
                    <td className="muted">{key.lastUsedAt ? formatDate(key.lastUsedAt) : 'never'}</td>
                    <td className="muted">{key.usedToday.toLocaleString('en-GB')}</td>
                    <td>
                      <span className={revoked || expired ? 'chip' : 'chip chip-common'}>
                        {revoked ? 'revoked' : expired ? 'expired' : 'live'}
                      </span>
                    </td>
                    <td>
                      {revoked ? null : (
                        <form action="/api/account/keys" method="post">
                          <input type="hidden" name="action" value="revoke" />
                          <input type="hidden" name="keyId" value={key.id} />
                          <button className="button button-secondary" type="submit">
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ marginTop: '1rem' }}>
            No keys yet.
          </p>
        )}

        {api.usage.length > 0 ? (
          <p className="card-meta" style={{ marginTop: '0.75rem' }}>
            Today:{' '}
            {api.usage
              .map(
                (u) =>
                  `${u.endpoint} ${u.used.toLocaleString('en-GB')}${
                    u.limit === null ? '' : `/${u.limit.toLocaleString('en-GB')}`
                  }`
              )
              .join(' · ')}
          </p>
        ) : null}

        <form
          action="/api/account/keys"
          method="post"
          style={{ marginTop: '1.25rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}
        >
          <input type="hidden" name="action" value="create" />
          <label className="sr-only" htmlFor="key-name">
            What the key is for
          </label>
          <input
            id="key-name"
            className="search-input"
            name="name"
            placeholder="What is it for? e.g. my website"
            maxLength={60}
            style={{ flex: '1 1 18rem' }}
          />
          <label className="sr-only" htmlFor="key-expires">
            Expiry
          </label>
          <select id="key-expires" className="search-input" name="expires" defaultValue="">
            <option value="">No expiry</option>
            <option value="30">Expires in 30 days</option>
            <option value="90">Expires in 90 days</option>
            <option value="365">Expires in a year</option>
          </select>
          <button className="button" type="submit">
            Create a key
          </button>
        </form>

        <p className="card-meta" style={{ marginTop: '0.75rem' }}>
          Every key is read-only and reaches the public endpoints described in{' '}
          <Link href="/docs">the API documentation</Link>. Usage is counted per endpoint per day.
        </p>
      </section>

      <section className="section">
        <h2>Your account</h2>
        <ul className="definition-list">
          <li>
            <strong>Signed in as</strong> <span className="muted">{account.email}</span>
          </li>
          <li>
            <strong>Role</strong> <span className="muted">{role}</span>
          </li>
          <li>
            <strong>Member since</strong>{' '}
            <span className="muted">{formatDate(String(account.createdAt))}</span>
          </li>
          <li>
            <strong>Active sessions</strong>{' '}
            <span className="muted">
              {data.sessions} {data.sessions === 1 ? 'device' : 'devices'}
            </span>
          </li>
          <li>
            <strong>Password</strong>{' '}
            <span className="muted">
              {password.dates.length > 0
                ? `changed ${formatDate(password.dates[0]!)}`
                : 'set when you joined'}
            </span>
          </li>
        </ul>

        <h3 style={{ marginTop: '1.75rem' }}>Change your password</h3>

        {params.changed ? (
          <div className="notice" role="status" style={{ marginBottom: '1rem' }}>
            Your password is changed. Every other device that was signed in has been signed out.
          </div>
        ) : null}

        {params.error ? (
          <div className="notice notice-warn" role="alert" style={{ marginBottom: '1rem' }}>
            {params.error}
          </div>
        ) : null}

        {/*
          The current password is required even though the person is already signed
          in. A session left open on a shared machine must not be enough to lock the
          owner out of their own account.
        */}
        <form
          method="post"
          action="/api/auth/change-password"
          style={{ display: 'grid', gap: '0.85rem', maxWidth: '32rem' }}
        >
          <div>
            <label htmlFor="currentPassword">Current password</label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className="search-input"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label htmlFor="newPassword">New password</label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="search-input"
              style={{ width: '100%' }}
            />
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
              At least {MIN_PASSWORD_LENGTH} characters. Length is the only rule — no symbols to
              remember, and a phrase is fine.
            </p>
          </div>
          <div>
            <label htmlFor="confirmPassword">The same new password again</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              className="search-input"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <button className="button" type="submit">
              Change the password
            </button>
          </div>
        </form>

        {password.changes.length > 0 ? (
          <details style={{ marginTop: '1.5rem' }}>
            <summary className="muted">When this password has been changed before</summary>
            <ul className="definition-list" style={{ marginTop: '0.75rem' }}>
              {password.changes.map((change, index) => (
                <li key={`${change.changedAt}-${index}`}>
                  <strong>{formatDate(change.changedAt)}</strong>{' '}
                  <span className="muted">{PASSWORD_ROUTE[change.changedBy] ?? change.changedBy}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <p className="card-meta" style={{ marginTop: '0.75rem' }}>
          Forgotten it instead? <Link href="/forgot">Ask for a link by email</Link> — you are not
          locked out of your own account.
        </p>

        <p style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <Link className="button button-secondary" href="/contribute">
            Contribute
          </Link>
          {current.canReview ? (
            <Link className="button button-secondary" href="/review">
              Review queue
            </Link>
          ) : null}
          {account.role === 'admin' || account.role === 'owner' ? (
            <Link className="button button-secondary" href="/admin">
              Admin dashboard
            </Link>
          ) : null}
          <form action="/api/auth/signout" method="post">
            <button className="button" type="submit">
              Sign out
            </button>
          </form>
        </p>
      </section>
    </div>
  );
}
