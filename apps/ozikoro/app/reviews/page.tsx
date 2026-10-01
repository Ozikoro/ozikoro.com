/**
 * A reviewer's own queue.
 *
 * Only the reviews assigned to this person, and only the open ones: a reviewer needs to know what
 * they owe, not what they once did. Completing a review is the act that makes a work eligible to be
 * called peer-reviewed, so the capability is checked on the server and the review can only be
 * completed by the person it was assigned to.
 *
 * The private field is labelled as private, because a review that says one thing to the editor and
 * another to the author is normal and must not be conflated by an ambiguous form.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { listMyReviews } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your reviews',
  robots: { index: false, follow: false },
};

export default async function MyReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;
  // Pages render or redirect; they never return a Response. See `requireCapabilityOrRedirect`.
  const guard = await requireCapabilityOrRedirect('expert_review', '/reviews/');

  const db = await getDb();
  const open = await listMyReviews(db, guard.account.account.id);

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">The research network</p>
        <h1>Your reviews</h1>
        <p className="lede">
          Work assigned to you. Completing one is what allows a work to be described as
          peer-reviewed, so the record of your recommendation is what the archive rests on.
        </p>
      </header>

      {notices.saved ? <div className="notice notice--success" role="status"><div><p className="notice__body">{notices.saved}</p></div></div> : null}
      {notices.error ? <div className="notice notice--error" role="alert"><div><p className="notice__body">{notices.error}</p></div></div> : null}

      {open.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">Nothing waiting</p>
          <p>No review is currently assigned to you. An editor assigns them from the review queue.</p>
        </div>
      ) : (
        <div className="stack-lg section">
          {open.map((review) => (
            <section className="panel" key={review.id}>
              <div className="panel__head">
                <h2 className="panel__title">{review.title}</h2>
              </div>
              <div className="panel__body">
                <p className="small muted">
                  {review.kind.replace(/_/g, ' ')} review · version {review.version} ·{' '}
                  <Link href={`/publications/${review.slug}/`}>read the work</Link>
                </p>

                <form method="post" action="/api/research" style={{ marginTop: 'var(--s-4)' }}>
                  <input type="hidden" name="action" value="complete-review" />
                  <input type="hidden" name="reviewId" value={review.id} />

                  <div className="wpfield">
                    <label htmlFor={`rec-${review.id}`}>Your recommendation</label>
                    <select id={`rec-${review.id}`} name="recommendation" required defaultValue="">
                      <option value="" disabled>— choose one —</option>
                      <option value="accept">Accept</option>
                      <option value="minor_revision">Minor revision</option>
                      <option value="major_revision">Major revision</option>
                      <option value="reject">Reject</option>
                      <option value="abstain">Abstain</option>
                    </select>
                    <p className="wphelp">A recommendation is required: a completed review with no verdict is not a review.</p>
                  </div>

                  <div className="wpfield">
                    <label htmlFor={`c-${review.id}`}>Comments for the author</label>
                    <textarea id={`c-${review.id}`} name="comments" rows={6} maxLength={5000} />
                  </div>

                  <div className="wpfield">
                    <label htmlFor={`p-${review.id}`}>Private comments for the editor</label>
                    <textarea id={`p-${review.id}`} name="privateComments" rows={4} maxLength={5000} />
                    <p className="wphelp">The author never sees this field.</p>
                  </div>

                  <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
                    <button className="btn btn--primary" type="submit">Submit review</button>
                  </p>
                </form>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
