/**
 * The comment queue — readers' replies waiting on a check, and the decisions already taken.
 *
 * WHY THIS SCREEN EXISTS AND WHY IT IS NOT `/admin/reviews`
 *
 * The owner: *"comments are checked before they appear"*, and *"Below the box: two example comments, one
 * already showing and one 'Pending review'."* A state that is written but not shown is only half a feature;
 * this is the other half. Whether an existing screen was the right home was **measured rather than assumed**,
 * and both candidates were wrong:
 *
 *   `/admin/moderation`   **DOES NOT EXIST.** The design deliverable draws a `dashboard-moderation` screen
 *                         and `design-fill.ts` points the design's *Moderation* link at `/admin/claims`, but
 *                         there is no route and no screen by that name in this administration.
 *   `/admin/reviews`      **EXISTS AND IS THE WRONG HOME.** Its guard is
 *                         `requireCapabilityOrRedirect('edit_entity', …)` and a `moderator` holds `moderate`,
 *                         `read` and `review_reports` — **not `edit_entity`** — so the one role the archive
 *                         defines as *"Reports, moderation of users and content, and escalation"* cannot open
 *                         it. **A comment queue that the moderator cannot reach is a queue nobody works.**
 *                         And the screen's own header forbids it in words: *"They are different subjects with
 *                         different state machines, so they are two panels"* — a comment awaiting a check is a
 *                         third subject with a third state machine.
 *
 * So the queue is its own screen, gated on `moderate`. It is the same probe the archive already applies to a
 * moderator: `mayEnterBackOffice` admits them through `capabilities.has('moderate')`.
 *
 * WHY THE FLAGGED COMMENTS COME FIRST AND THE PAGE IS SHOWN WITH EVERY COMMENT
 *
 * The tick box on the box is *"This includes a source or correction"*, so a flagged comment is somebody
 * offering the archive a fact rather than an opinion — `listPending` orders them first for that reason. And
 * each row names the page it was written on as a link, because **a decision about a comment is a decision
 * about a page**, and a moderator who cannot see the page cannot tell whether the comment is fair to it.
 *
 * ⚠️ WHAT THIS SCREEN DOES NOT DO. It does not delete a comment. A rejected comment is kept: it is the record
 * of a decision the archive made about somebody's words, and the audit rule requires it to remain answerable.
 * Every decision is reversible, in both directions, from the same two buttons.
 */
import { getDb } from '@ozituma/db/client';
import { commentCounts, listDecided, listPending } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

/** `7 October 2026, 14:05 UTC`, or nothing at all when the date is not recorded. */
function when(value: string | null): string {
  if (!value) return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  return `${at.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
}

/** The same 30 words every time, so a queue can be scanned rather than read. */
function preview(body: string): string {
  const single = body.replace(/\s+/g, ' ').trim();
  return single.length > 240 ? `${single.slice(0, 240)}…` : single;
}

export default async function CommentQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;

  /*
   * The page's own guard, FIRST, and before any query. React renders a layout and its children
   * concurrently, so the admin layout's redirect does not keep this page's rows out of the streamed body —
   * `requireCapabilityOrRedirect` records the measurement that proved it.
   */
  await requireCapabilityOrRedirect('moderate', '/admin/comments');

  const db = await getDb();
  const [pending, decided, counts] = await Promise.all([
    listPending(db, 100),
    listDecided(db, 50),
    commentCounts(db),
  ]);

  const flagged = pending.filter((comment) => comment.isSourceOrCorrection);

  return (
    <>
      <Head title="Comments">
        <a className="btn btn--sm" href="/admin">Overview</a>
      </Head>

      <Notices saved={notices.saved} error={notices.error} />

      <AtAGlance
        rows={[
          ['Waiting on a check', counts.pending],
          ['Of those, a source or correction', flagged.length],
          ['Shown on their page', counts.approved],
          ['Not shown', counts.rejected],
        ]}
      />

      <Card title={`Waiting on a check (${counts.pending})`}>
        {pending.length === 0 ? (
          <p className="help">
            Nothing is waiting. A comment written on a page lands here and is invisible to readers until it
            is approved — this reads <span className="mono">ozikoro_comment</span> where the state is
            <span className="mono"> pending</span>. An empty queue here means no member has written a comment
            since the last one was decided, and not that the box is missing: the box is on every record page,
            on the three section pages and on a publication page, and the count above reads the table.
          </p>
        ) : (
          <ul className="history">
            {pending.map((comment) => (
              <li key={comment.id}>
                <div className="history__when">Comment #{comment.id}</div>
                <p className="history__what">
                  <strong>{comment.author}</strong>
                  {comment.isSourceOrCorrection ? ' · Source or correction' : ''}
                  {comment.createdAt ? ` · ${when(comment.createdAt)}` : ''}
                </p>
                <p className="history__detail">
                  On <a href={comment.path}>{comment.path}</a>
                  {comment.articleId === null ? ' (a section page)' : ''}
                </p>
                <p className="history__detail">{preview(comment.body)}</p>

                {/*
                  A real form, one per comment. The decision travels as the submit button's own name and
                  value, so the endpoint never has to infer which button was pressed from an absent field —
                  the same reasoning `/api/library` records about a save and an unsave.
                */}
                <form
                  method="post"
                  action="/api/admin/comments"
                  className="row"
                  style={{ marginTop: '0.6rem', gap: '0.4rem', flexWrap: 'wrap' }}
                >
                  <input type="hidden" name="id" value={comment.id} />
                  <button className="btn btn--sm btn--primary" type="submit" name="decision" value="approve">
                    Approve — show it on the page
                  </button>
                  <button className="btn btn--sm" type="submit" name="decision" value="reject">
                    Reject — do not show it
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Comments decided" quiet>
        {decided.length === 0 ? (
          <p className="help">
            Nothing has been decided yet. An approved comment is shown on its page from that moment; a
            rejected one is not shown to anybody, and is kept so that the decision stays answerable.
          </p>
        ) : (
          <ul className="history">
            {decided.map((comment) => (
              <li key={comment.id}>
                <div className="history__when">
                  Comment #{comment.id} · {comment.state === 'approved' ? 'Shown' : 'Not shown'}
                </div>
                <p className="history__what">
                  <strong>{comment.author}</strong>
                  {comment.moderatedAt ? ` · decided ${when(comment.moderatedAt)}` : ''}
                </p>
                <p className="history__detail">
                  On <a href={comment.path}>{comment.path}</a>
                </p>
                <p className="history__detail">{preview(comment.body)}</p>

                {/*
                  THE OTHER DIRECTION IS OFFERED, because a decision about somebody's words is easy to get
                  wrong and the archive's rule is that everything here is reversible — which is exactly what
                  the one withheld act in this archive (`purge_trash`) is defined against.
                */}
                <form
                  method="post"
                  action="/api/admin/comments"
                  className="row"
                  style={{ marginTop: '0.6rem', gap: '0.4rem', flexWrap: 'wrap' }}
                >
                  <input type="hidden" name="id" value={comment.id} />
                  {comment.state === 'approved' ? (
                    <button className="btn btn--sm" type="submit" name="decision" value="reject">
                      Take it off the page
                    </button>
                  ) : (
                    <button className="btn btn--sm" type="submit" name="decision" value="approve">
                      Approve it after all
                    </button>
                  )}
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="What a reader sees" quiet>
        <p className="help">
          A signed-out reader sees a &ldquo;Sign in to join the discussion&rdquo; message with a Sign in and a
          Create an account button. A signed-in member sees a comment box with the tick box
          &ldquo;This includes a source or correction&rdquo; and a Post comment button. Below the box, a
          reader sees the comments that have been approved here — and, for their own words only, the one they
          have just written, labelled <strong>Pending review</strong>.
        </p>
        {/*
          THE TWO DESIGN SHAPES, WHERE THE OWNER CAN SEE THEM AND NOWHERE ELSE.

          *"Design examples — do not put them on live pages."* The flag below is honoured on a discussion page
          ONLY for an account holding `moderate`, which is the same gate this screen is behind — so the owner
          reviews both shapes on a real page, and no reader ever meets an invented comment.
        */}
        <p className="help">
          To review the two shapes the owner described — one approved comment and one awaiting review — open
          any page with the box and add <span className="mono">?ozcommentstates=1</span> to its address. It
          works for this account and no other, and every line of it says it is an example.
        </p>
      </Card>
    </>
  );
}
