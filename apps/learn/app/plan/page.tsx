import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getReviewSummary } from '@ozituma/db/learn-srs';
import { getCurrentAccount } from '@/lib/session';
import { PlanRunner } from '@/components/learn/plan-runner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Today’s review · Ozituma Learn',
  description: 'The words you are about to forget, and when to look at them again.',
};

/**
 * The daily plan.
 *
 * This is the page that makes the platform more than a set of exercises. Practice asks a question;
 * this decides when to ask it again, which is the only part of the whole thing that makes words
 * stick. §4 puts "daily plan with spaced-repetition review" in the v1.0 scope and §F6 asks it to
 * adapt to the time the learner has, which is why the time selector is on the runner rather than
 * buried in settings.
 *
 * Signed-out visitors are shown an explanation rather than a redirect to sign-in. The schedule is
 * genuinely per-account — there is no anonymous version to degrade to — and saying so is more honest
 * than a login wall that appears without a reason.
 */
export default async function PlanPage() {
  const session = await getCurrentAccount();
  const db = await getDb();

  // Read on the server so the counts are correct in the first paint. The runner re-fetches the plan
  // itself, because the plan depends on the time budget the learner chooses after the page loads.
  const summary = session ? await getReviewSummary(db, session.account.id) : null;

  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Today</p>
        <h1 className="learn-hero-title">What is about to slip</h1>
        <p className="hero-lede">
          Reviewing a word just before you would have forgotten it is the difference between meeting
          it and knowing it. This is the queue that timing produces — due words first, then a few new
          ones, sized to the time you say you have.
        </p>
      </section>

      {summary ? (
        <section className="learn-section" style={{ marginBottom: '1.5rem' }}>
          <ul className="learn-review-list">
            <li className="learn-review-item">
              <span className="learn-review-prompt">Due now</span>
              <span className="learn-review-answer">
                <strong>{summary.dueNow.toLocaleString()}</strong>{' '}
                {summary.dueNow === 1 ? 'word' : 'words'}
              </span>
            </li>
            <li className="learn-review-item">
              <span className="learn-review-prompt">In your schedule</span>
              <span className="learn-review-answer">
                <strong>{summary.tracked.toLocaleString()}</strong> words
              </span>
            </li>
            <li className="learn-review-item">
              <span className="learn-review-prompt">Learned</span>
              <span className="learn-review-answer">
                <strong>{summary.learned.toLocaleString()}</strong> past the learning steps
              </span>
            </li>
          </ul>
        </section>
      ) : null}

      <section className="learn-section">
        <h2 className="learn-section-title">Your queue</h2>
        {
          /* Passed from the server: the dictionary is a different origin, and a client component
              cannot read a non-NEXT_PUBLIC variable. */
        }
        <PlanRunner
          signedIn={session !== null}
          dictionaryUrl={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}
        />
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">How the timing works</h2>
        <div className="learn-about-grid">
          <div>
            <h3 className="learn-about-heading">A word you get right waits longer</h3>
            <p>
              Each answer moves one number: how long until you see the word again. Recall it easily
              and the gap grows — a day, then several, then weeks. Fail it and the gap collapses back
              to minutes, because the honest reading of a forgotten word is that it was not learned
              yet.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">New words come last</h3>
            <p>
              Due words are always shown before new ones. It is tempting to lead with novelty, but on
              a busy day that means the reviews never happen — and the reviews are the part that
              keeps what you already met from disappearing.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">Anything you practise counts</h3>
            <p>
              Every answer in <Link href="/practice">vocabulary practice</Link> is scheduled
              automatically. You do not have to decide what to review; answering a question is enough
              to put the word into the queue.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">Nothing here was written by a machine</h3>
            <p>
              The words, the meanings and the recordings are the dictionary&rsquo;s own reviewed
              records. The schedule decides when to ask; it never invents what to ask.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
