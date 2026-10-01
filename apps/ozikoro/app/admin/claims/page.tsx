/**
 * Deciding authorship claims.
 *
 * Approving a claim hands somebody the authorship of published records, so the decision is manual and
 * the evidence is shown beside the decision rather than hidden behind it. The page does not suggest a
 * default: there is no "likely match" score, because the archive holds no email for any migrated
 * contributor and a score computed from a name would be an invented basis for a real decision.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listContributorClaims } from '@ozikoro/platform';
import { Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ClaimsQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;
  const db = await getDb();
  const pending = await listContributorClaims(db, { status: 'pending', limit: 100 });
  const decided = await listContributorClaims(db, { status: null, limit: 20 });

  return (
    <>
      <Head title="Authorship claims">
        <Link className="btn btn--sm" href="/admin">Overview</Link>
      </Head>

      <Notices saved={notices.saved} error={notices.error} />

      <Card title={`Waiting (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="help">No claim is waiting. Nobody has asked to be recognised as an author.</p>
        ) : (
          <ul className="history">
            {pending.map((claim) => (
              <li key={claim.id}>
                <div className="history__when">Claim #{claim.id}</div>
                <p className="history__what">
                  <strong>{claim.contributorName ?? `Contributor ${claim.contributorId}`}</strong>
                  {claim.articleCount !== undefined ? ` · ${claim.articleCount} records` : ''}
                </p>
                <p className="history__detail">
                  Claimed by {claim.accountEmail ?? `account ${claim.accountId}`}
                  {claim.createdAt ? ` · ${new Date(claim.createdAt).toISOString().slice(0, 10)}` : ''}
                </p>
                {claim.evidence ? (
                  <p className="history__detail">Evidence given: {claim.evidence}</p>
                ) : (
                  <p className="history__detail">No evidence was given with the claim.</p>
                )}

                <form method="post" action="/api/claims" className="row" style={{ marginTop: '0.6rem', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <input type="hidden" name="action" value="decide" />
                  <input type="hidden" name="claimId" value={claim.id} />
                  <input type="hidden" name="returnTo" value="/admin/claims/" />
                  <input name="note" type="text" maxLength={1000} placeholder="Why, for the record" style={{ minWidth: '18rem' }} />
                  <button className="btn btn--sm btn--primary" type="submit" name="decision" value="approve">Grant the byline</button>
                  <button className="btn btn--sm" type="submit" name="decision" value="reject">Decline</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recently decided" quiet>
        {decided.length === 0 ? (
          <p className="help">Nothing has been decided yet.</p>
        ) : (
          <table className="record">
            <thead><tr><th scope="col">Claim</th><th scope="col">Author</th><th scope="col">Decision</th></tr></thead>
            <tbody>
              {decided.map((claim) => (
                <tr key={claim.id}>
                  <td>#{claim.id}</td>
                  <td>{claim.contributorName ?? claim.contributorId}</td>
                  <td className="small">
                    {claim.status}
                    {claim.decidedAt ? ` · ${new Date(claim.decidedAt).toISOString().slice(0, 10)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="help">
          An approved claim links the contributor to the account, so their byline becomes theirs to
          correct. It does not hand them the record — an author edits their own work, an editor
          publishes it.
        </p>
      </Card>
    </>
  );
}
