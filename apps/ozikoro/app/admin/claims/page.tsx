/**
 * Deciding authorship claims — and the two different things the archive calls a "claim".
 *
 * Approving a claim hands somebody the authorship of published records, so the decision is manual and
 * the evidence is shown beside the decision rather than hidden behind it. The page does not suggest a
 * default: there is no "likely match" score, because the archive holds no email for any migrated
 * contributor and a score computed from a name would be an invented basis for a real decision.
 *
 * TWO TABLES, ONE WORD, AND THE ZERO THAT LOOKED LIKE A FAULT
 *
 *   `ozikoro_contributor_claim`  a person asking to be recognised as the author of a byline. The queue
 *                                this screen was built for.
 *   `ozikoro_claim`              a statement a RECORD makes — the sentence, the anchor it sits under, and
 *                                whether an editor has accepted it. Nothing on this site ever surfaced it.
 *
 * **A screen titled "Claims" that reads one table and not the other reports half the answer as the whole of
 * it**, and an operator who cannot see `ozikoro_claim` cannot tell an empty register from an unimplemented
 * one. Both are shown, each named for the table it reads.
 */
import { getDb } from '@ozituma/db/client';
import { listArticleClaims, listContributorClaims } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ClaimsQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;

  // The page's own guard, FIRST. `manage_contributors` is what `/api/claims` requires to decide a claim, and
  // the layout's guard does not stop this page rendering — see `requireCapabilityOrRedirect`.
  await requireCapabilityOrRedirect('manage_contributors', '/admin/claims');

  const db = await getDb();
  const pending = await listContributorClaims(db, { status: 'pending', limit: 100 });
  const decided = await listContributorClaims(db, { status: null, limit: 20 });
  /*
   * The record-claim register, read with no status filter so the count is of everything it holds rather
   * than of the subset an unstated default happens to allow.
   */
  const recordClaims = await listArticleClaims(db, { limit: 50 });

  return (
    <>
      <Head title="Claims">
        <a className="btn btn--sm" href="/admin">Overview</a>
      </Head>

      <Notices saved={notices.saved} error={notices.error} />

      <Card title={`Authorship claims waiting (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="help">
            No claim is waiting. Nobody has asked to be recognised as the author of a byline. This reads
            <span className="mono"> ozikoro_contributor_claim</span>, which currently holds no row at all —
            so there is also nothing in the decided list below.
          </p>
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

      <Card title="Authorship claims decided" quiet>
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

      <Card title={`Claims made by records (${recordClaims.total.toLocaleString('en-GB')})`}>
        {recordClaims.total === 0 ? (
          /*
           * AN EMPTY REGISTER SAYS IT IS EMPTY AND SAYS WHAT WOULD FILL IT.
           *
           * The table exists, is read here, and holds nothing. "Nothing has been claimed yet" alone would
           * read exactly like the page failing to reach the table — which is the fault this screen was
           * rebuilt to stop repeating — so the table is named and the write path is stated.
           */
          <p className="help">
            No record has a claim recorded against it. This reads
            <span className="mono"> ozikoro_claim</span> directly and it holds no rows, which is a fact about
            the archive rather than about this page. A claim is a sentence a history asserts — the assertion,
            the passage it sits under, and an editor&rsquo;s decision on it — and one reaches this register when
            an editor records it against a record; nothing imports them, so an archive that has never been
            through that pass has none.
          </p>
        ) : (
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Record</th>
                <th scope="col">Status</th>
                <th scope="col">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {recordClaims.claims.map((claim) => (
                <tr key={claim.id}>
                  <td>
                    {claim.statement ?? '(no statement recorded)'}
                    {claim.anchor ? <div className="history__when">under: {claim.anchor}</div> : null}
                    {claim.entityName ? <div className="history__when">about: {claim.entityName}</div> : null}
                  </td>
                  <td className="small">
                    {claim.articleSlug ? (
                      <a href={`/admin/archive/${claim.articleId}`}>{claim.articleTitle ?? claim.articleSlug}</a>
                    ) : (
                      `record ${claim.articleId}`
                    )}
                  </td>
                  <td className="small">{claim.status}</td>
                  <td className="small">{claim.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
