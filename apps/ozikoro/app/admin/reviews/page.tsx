/**
 * The editor's review queue.
 *
 * Every work that is not a draft, not published and not archived, in the order it was submitted —
 * oldest first, because the person who has waited longest is the one to look at.
 *
 * The buttons offered are only the transitions the state machine actually permits from where each
 * work stands, so the screen cannot invite an editor to do something the workflow would refuse. The
 * refusal is still enforced server-side; showing only legal moves is courtesy, not authorisation.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { PUBLICATION_TRANSITIONS, STATE_LABEL, STATE_MEANING, listReviewQueue, type PublicationState } from '@ozikoro/platform';
import { Card, Head } from '../ui';

export const dynamic = 'force-dynamic';

const ACTION_LABEL: Partial<Record<PublicationState, string>> = {
  editorial_screening: 'Start screening',
  under_review: 'Put under review',
  expert_review: 'Send for expert review',
  revision_required: 'Ask for revision',
  approved: 'Accept',
  published: 'Publish',
  archived: 'Withdraw',
};

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;
  const db = await getDb();
  const queue = await listReviewQueue(db);

  return (
    <>
      <Head title="Review queue">
        <Link className="btn btn--sm" href="/admin/archive/">Editorial queue</Link>
      </Head>

      {notices.saved ? <div className="notice notice--success" role="status"><div><p className="notice__body">{notices.saved}</p></div></div> : null}
      {notices.error ? <div className="notice notice--error" role="alert"><div><p className="notice__body">{notices.error}</p></div></div> : null}

      <Card title={`Waiting (${queue.length})`}>
        {queue.length === 0 ? (
          <p className="help">No work is waiting. Everything submitted has been dealt with.</p>
        ) : (
          <ul className="history">
            {queue.map((work) => {
              const moves = PUBLICATION_TRANSITIONS[work.status] ?? [];
              return (
                <li key={work.id}>
                  <div className="history__when">
                    {STATE_LABEL[work.status]} · {work.kind.replace(/_/g, ' ')} · version {work.currentVersion}
                  </div>
                  <p className="history__what">
                    <strong>{work.title}</strong>
                  </p>
                  <p className="history__detail">
                    {work.authors.map((a) => a.name).join(', ') || 'no authors recorded'}
                  </p>
                  <p className="history__detail">{STATE_MEANING[work.status]}</p>
                  {work.abstract ? <p className="history__detail">{work.abstract.slice(0, 240)}…</p> : null}

                  <div className="row" style={{ marginTop: '0.6rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {moves.map((to) => (
                      <form method="post" action="/api/research" key={to}>
                        <input type="hidden" name="action" value="transition" />
                        <input type="hidden" name="publicationId" value={work.id} />
                        <input type="hidden" name="to" value={to} />
                        <input type="hidden" name="returnTo" value="/admin/reviews/" />
                        <button className={to === 'archived' ? 'btn btn--sm btn--danger' : 'btn btn--sm'} type="submit">
                          {ACTION_LABEL[to] ?? STATE_LABEL[to]}
                        </button>
                      </form>
                    ))}
                  </div>

                  {/*
                    Assignment is available from the states where a review is meaningful. The reviewer
                    is chosen by account id here because there is no member picker yet; the endpoint
                    validates that the account exists and that the state allows a review at all.
                  */}
                  {['editorial_screening','under_review','expert_review'].includes(work.status) ? (
                    <form method="post" action="/api/research" className="row" style={{ marginTop: '0.5rem', gap: '0.4rem' }}>
                      <input type="hidden" name="action" value="assign-review" />
                      <input type="hidden" name="publicationId" value={work.id} />
                      <input type="hidden" name="returnTo" value="/admin/reviews/" />
                      <label className="visually-hidden" htmlFor={`rev-${work.id}`}>Reviewer account id</label>
                      <input id={`rev-${work.id}`} name="reviewerId" type="number" min={1} placeholder="reviewer account id" style={{ maxWidth: '13rem' }} />
                      <select name="kind" defaultValue="expert" aria-label="Review kind">
                        <option value="editorial">Editorial</option>
                        <option value="expert">Expert</option>
                        <option value="statistical">Statistical</option>
                        <option value="community">Community</option>
                      </select>
                      <button className="btn btn--sm" type="submit">Assign reviewer</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="How a work moves" quiet>
        <p className="help">
          Draft → submitted → editorial screening → under review → expert review → approved →
          published. A work can be sent back for revision at any review stage, and anything live can
          be withdrawn to archived. Only the moves the workflow permits are offered above, and the
          state machine refuses the rest on the server.
        </p>
        <p className="help">
          A work accepted <strong>without</strong> completing expert review is published and is not
          peer-reviewed, and its page says so.
        </p>
      </Card>
    </>
  );
}
