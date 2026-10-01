import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listSuggestions } from '@ozituma/db/contributions';
import { getCurrentAccount } from '@/lib/session';
import { Head } from '../ui';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Awaiting review', className: 'chip' },
  approved: { label: 'Published', className: 'chip chip-common' },
  merged: { label: 'Merged into an entry', className: 'chip chip-common' },
  rejected: { label: 'Not accepted', className: 'chip' },
};

export default async function Page() {
  const current = await getCurrentAccount();
  const db = await getDb();
  const mine = await listSuggestions(db, { submittedBy: current!.account.id, limit: 100 });

  return (
    <>
      <Head
        title="Your submissions"
        lede={`${mine.total} sent. Every one is read by an editor before anything changes.`}
      />
      {mine.data.length === 0 ? (
        <div className="cd-empty">
          Nothing yet. <Link href="/contribute/word">Add a word</Link> to start.
        </div>
      ) : (
        <div className="cd-panel">
          <table className="cd-table">
            <thead>
              <tr><th>Submission</th><th>Kind</th><th>Status</th><th>Sent</th><th>Reviewer note</th></tr>
            </thead>
            <tbody>
              {mine.data.map((s) => {
                const status = STATUS[s.status] ?? { label: s.status, className: 'chip' };
                const subject =
                  (typeof s.payload.headword === 'string' && s.payload.headword) ||
                  (typeof s.payload.name === 'string' && s.payload.name) ||
                  (typeof s.payload.text === 'string' && s.payload.text) ||
                  `#${s.id}`;
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{String(subject).slice(0, 80)}</strong>
                      {s.target ? (
                        <>
                          <br />
                          <Link className="muted" href={s.target.url} style={{ fontSize: '0.82rem' }}>
                            Open the {s.target.what}: {s.target.label}
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td className="muted">{s.kind.replace(/_/g, ' ')}</td>
                    <td><span className={status.className}>{status.label}</span></td>
                    <td className="muted">{new Date(s.submittedAt).toLocaleDateString()}</td>
                    <td className="muted">{s.reviewNote ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
