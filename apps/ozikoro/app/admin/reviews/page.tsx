/**
 * The review queue — records waiting on a decision, and works in the publication workflow.
 *
 * WHY THIS SCREEN WAS REBUILT (round 292)
 *
 * This page read ONE table, `ozikoro_publication`, through `listReviewQueue`. That table was empty, so the
 * screen said **"Waiting (0)"** and looked healthy. Meanwhile the archive's own records sit in `review` in
 * `ozikoro_article` — the status `updateArticleFacets` writes and the archive uses for *"the work exists and
 * the verdict has not been given"*. **A review queue showing zero while records await review is not an empty
 * state; it is a page that is not reading them.** Both queues are now on this screen, each named for the
 * table it reads, so a zero is legible as a fact about one table rather than about the archive.
 *
 * WHY THE ARTICLE QUEUE AND THE PUBLICATION QUEUE ARE NOT THE SAME LIST
 *
 *   `ozikoro_article`      the migrated histories and the rewrites written here. `status` is the archive's
 *                          own workflow: draft, review, published, archived.
 *   `ozikoro_publication`  research works submitted for publication, with a review state machine, assigned
 *                          reviewers and transitions. It is empty today.
 *
 * They are different subjects with different state machines, so they are two panels. Collapsing them would
 * make "0 waiting" mean nothing in particular, which is what went wrong the first time.
 *
 * WHERE A RECORD IS ACTED ON, AND WHY NOT HERE
 *
 * A record's status is changed on the record's own page — `/admin/archive/<id>`, whose form posts
 * `save-facets` to `/api/admin/archive` and records the actor in `ozikoro_audit`. **This screen links there
 * rather than growing a second set of buttons**, because a second write path is a second place for the
 * permission check and the audit to drift from the first. The publication queue does have its own inline
 * transitions, and they are kept: they are the state machine those rows belong to, and they were here
 * already.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  PUBLICATION_TRANSITIONS,
  STATE_LABEL,
  STATE_MEANING,
  getArticleStatusCounts,
  listArticlesInReview,
  listReviewQueue,
  type PublicationState,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head } from '../ui';

export const dynamic = 'force-dynamic';

/** Twenty-five records a page, the same size the editorial queue uses. */
const PAGE_SIZE = 25;

const ACTION_LABEL: Partial<Record<PublicationState, string>> = {
  editorial_screening: 'Start screening',
  under_review: 'Put under review',
  expert_review: 'Send for expert review',
  revision_required: 'Ask for revision',
  approved: 'Accept',
  published: 'Publish',
  archived: 'Withdraw',
};

/** `3 Oct 2026, 14:05 UTC`, or the plain truth when the date is not recorded. */
function when(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return `${date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  })} UTC`;
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; page?: string; q?: string }>;
}) {
  const notices = await searchParams;
  const page = Math.max(1, Number.parseInt(notices.page ?? '1', 10) || 1);
  const search = notices.q?.trim() || null;

  // The page's own guard, FIRST and before any query, because a redirect status does not make the body
  // empty: React renders a layout and its children concurrently. See `requireCapabilityOrRedirect`.
  await requireCapabilityOrRedirect('edit_entity', '/admin/reviews');

  const db = await getDb();
  const [counts, articleQueue, publications] = await Promise.all([
    getArticleStatusCounts(db),
    listArticlesInReview(db, { search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listReviewQueue(db),
  ]);

  const query = (extra: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: search ?? undefined, ...extra })) {
      if (value) usp.set(key, value);
    }
    const text = usp.toString();
    return `/admin/reviews${text ? `?${text}` : ''}`;
  };

  const lastPage = Math.max(1, Math.ceil(articleQueue.total / PAGE_SIZE));

  return (
    <>
      <Head title="Review queue">
        <Link className="btn btn--sm" href="/admin/archive/">
          Editorial queue
        </Link>
      </Head>

      {notices.saved ? <div className="notice notice--success" role="status"><div><p className="notice__body">{notices.saved}</p></div></div> : null}
      {notices.error ? <div className="notice notice--error" role="alert"><div><p className="notice__body">{notices.error}</p></div></div> : null}

      <Card title={`Records waiting for review (${articleQueue.total.toLocaleString('en-GB')})`}>
        {articleQueue.total === 0 ? (
          /*
           * THE EMPTY STATE SAYS WHY IT IS EMPTY, AND SAYS WHAT WOULD FILL IT.
           *
           * "Nothing to review" is indistinguishable from "this page cannot read the records", which is
           * exactly the fault that was here. So the numbers that make the absence checkable are printed
           * beside it, and the two ways a record reaches `review` are named.
           */
          <>
            <p className="help">
              No record in the archive is in <span className="mono">review</span>, so there is nothing to
              decide here. That is a statement about the records and not about this page: it reads
              <span className="mono"> ozikoro_article</span> directly, and every figure below is a
              <span className="mono"> count(*)</span> over that table.
            </p>
            <AtAGlance
              rows={[
                ['Records in the archive', counts.total.toLocaleString('en-GB')],
                ['Published', counts.published.toLocaleString('en-GB')],
                ['In review', counts.review.toLocaleString('en-GB')],
                ['Draft', counts.draft.toLocaleString('en-GB')],
                ['Archived', counts.archived.toLocaleString('en-GB')],
                ['Pages (not records)', counts.pages.toLocaleString('en-GB')],
              ]}
            />
            <p className="help">
              A record reaches <strong>review</strong> one of two ways: an editor sets it there on the
              record&rsquo;s own page, or an import writes it in that state. Both write an
              <span className="mono"> ozikoro_audit</span> row, which is where the moment it entered review
              is read from — so a row above that says the time is not recorded means no such row exists, not
              that a date was lost.
            </p>
          </>
        ) : (
          <>
            <form method="get" action="/admin/reviews" className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
              <label className="visually-hidden" htmlFor="q">Search</label>
              <input id="q" name="q" type="search" defaultValue={search ?? ''} placeholder="Search by title" />
              <button className="btn btn--sm btn--primary" type="submit">Apply</button>
            </form>

            <table className="record" style={{ marginTop: '1rem' }}>
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col">Contributor</th>
                  <th scope="col">In review since</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {articleQueue.articles.map((article) => (
                  <tr key={article.id}>
                    <td>
                      <strong>{article.title}</strong>
                      <div className="history__when">
                        {article.topicName ?? 'no series'}
                        {article.wordCount ? ` · ${article.wordCount.toLocaleString('en-GB')} words` : ''}
                      </div>
                    </td>
                    <td className="small">{article.authorName ?? 'no contributor credited'}</td>
                    <td className="small">
                      {article.inReviewSince ? (
                        when(article.inReviewSince, 'not recorded')
                      ) : (
                        <>
                          not recorded
                          <div className="history__when">
                            last changed {when(article.lastChangedAt, 'unknown')}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <Link className="btn btn--sm" href={`/admin/archive/${article.id}`}>
                        Open the record
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <nav className="row" style={{ marginTop: '1rem' }} aria-label="Pagination">
              {page > 1 ? (
                <Link className="btn btn--sm" href={query({ page: String(page - 1) })}>← Previous</Link>
              ) : <span />}
              <span className="small muted">
                page {page} of {lastPage} · {articleQueue.total.toLocaleString('en-GB')} waiting
              </span>
              {page < lastPage ? (
                <Link className="btn btn--sm" href={query({ page: String(page + 1) })}>Next →</Link>
              ) : <span />}
            </nav>
          </>
        )}

        <p className="help">
          A record is published, sent back or archived on its own page, which records who did it in
          <span className="mono"> ozikoro_audit</span>. This screen deliberately has no decision buttons of
          its own: a second write path would be a second place for the permission check to drift.
        </p>
      </Card>

      <Card title={`Research works in the publication workflow (${publications.length})`}>
        {publications.length === 0 ? (
          <p className="help">
            No work is in the publication workflow. This reads
            <span className="mono"> ozikoro_publication</span>, which is a different table from the records
            above and is empty — nothing has been submitted for publication yet. A work is created as a draft
            and appears here once it leaves <span className="mono">draft</span>.
          </p>
        ) : (
          <ul className="history">
            {publications.map((work) => {
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

      <Card title="How a record moves" quiet>
        <p className="help">
          A migrated or written record is <strong>draft</strong>, then <strong>review</strong>, then
          <strong> published</strong>; anything published can be withdrawn to <strong>archived</strong>. The
          moves are made on the record&rsquo;s own page, and each one is recorded against the account that
          made it.
        </p>
        <p className="help">
          A research work moves Draft → submitted → editorial screening → under review → expert review →
          approved → published, and can be sent back for revision at any review stage. Only the moves the
          workflow permits are offered above, and the state machine refuses the rest on the server. A work
          accepted <strong>without</strong> completing expert review is published and is not peer-reviewed,
          and its page says so.
        </p>
      </Card>
    </>
  );
}
