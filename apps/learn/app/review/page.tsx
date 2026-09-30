import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import {
  availableFor,
  listReviewTasks,
  UNSUPPORTED_KINDS,
  type ReviewTask,
} from '@ozituma/db/learn-review';
import { getCurrentAccount } from '@/lib/session';
import { ReviewAction } from '@/components/learn/review-action';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Content review · Ozituma Learn',
  description: 'The Section 5.3 review queue for Ozituma Learn content.',
  // Internal working surface. Not something a search engine should surface, and not something a
  // learner following a stray link should land on.
  robots: { index: false, follow: false },
};

/** The status, as a reviewer reads it rather than as the enum spells it. */
function statusLabel(status: string | null): string {
  if (!status) return 'unknown';
  return status.replace(/_/g, ' ');
}

/** The chip class for a trust label, matching how the tutor renders one. */
function statusChip(status: string | null): string {
  if (status === 'published') return 'chip chip-common';
  if (status === 'archived' || status === 'changes_requested') return 'chip';
  return 'chip';
}

/**
 * The §5.3 review queue.
 *
 * WHAT THIS IS FOR
 *
 * Every piece of content on the platform is a `draft`, and a draft is invisible to a learner. This
 * is the surface where a linguist, a native reviewer or a content editor moves something out of it —
 * so until this page existed, the lifecycle `packages/core/src/review-workflow.ts` implements was
 * enforced but unreachable, and no course could ever have been published.
 *
 * THE BUTTONS COME FROM THE SERVER
 *
 * `availableFor` is asked what THIS account may do to THIS item, and those are the buttons drawn.
 * The same function is consulted by the API route, so a button the domain would refuse is never
 * shown — which matters because a queue that offers steps that fail is a queue a reviewer stops
 * believing.
 *
 * TASKS IT CANNOT ACT ON ARE SHOWN ANYWAY
 *
 * A lexeme lives in the dictionary and follows its own workflow; exercises have no table yet. Both
 * can appear in the queue, and both are rendered with a plain statement that this page cannot move
 * them, rather than being hidden. A task that vanishes from the list it was filed in is worse than
 * one that says it needs a different tool.
 */
export default async function ReviewPage() {
  const current = await getCurrentAccount();

  if (!current) {
    return (
      <div className="wrap wrap-narrow">
        <h1>Content review</h1>
        <div className="notice notice-warn">
          <strong>Sign in to review content.</strong>
          <p style={{ margin: '0.4rem 0 0.8rem' }}>
            The queue is staff-only, and it is the same Ozituma account you already have.
          </p>
          <Link className="button" href="/signin?next=/review">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (!current.canReviewLearn) {
    return (
      <div className="wrap wrap-narrow">
        <h1>Content review</h1>
        <div className="notice notice-warn">
          <strong>You do not have access to the content queue.</strong>
          <p style={{ margin: '0.4rem 0 0' }}>
            Reviewing §5.3 content needs a staff role — a linguist approves the language, a native
            reviewer approves the audio, and a content editor publishes. If you have spotted a mistake,
            the report button on any word still puts it in front of them.
          </p>
        </div>
      </div>
    );
  }

  const db = await getDb();
  const tasks = await listReviewTasks(db, { state: 'open' });

  // Only the transitions this account may perform on each item. Computed on the server so the page
  // renders complete rather than filling in buttons after hydration.
  const withActions = await Promise.all(
    tasks.map(async (task: ReviewTask) => {
      if (!task.actionable) return { task, transitions: [] as string[] };
      try {
        const transitions = await availableFor(db, task.contentKind as never, task.contentId, {
          id: current.account.id,
          role: current.account.role as never,
        });
        return { task, transitions: transitions as string[] };
      } catch {
        // A task whose content row has been deleted is not a crash; it is a task with nothing
        // behind it, and it is shown as unactionable.
        return { task, transitions: [] as string[] };
      }
    })
  );

  const actionable = withActions.filter((entry) => entry.transitions.length > 0);

  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Staff</p>
        <h1 className="learn-hero-title">Content review</h1>
        <p className="hero-lede">
          Nothing here is visible to a learner until it has been through this queue. A linguist
          approves the language, a native reviewer approves the audio and naturalness, and a content
          editor publishes — three different people, deliberately.
        </p>
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">
          Open tasks{tasks.length > 0 ? ` (${tasks.length})` : ''}
        </h2>

        {tasks.length === 0 ? (
          <div className="notice">
            <strong>Nothing is waiting.</strong>
            <p style={{ margin: '0.4rem 0 0' }}>
              The queue is empty. Content arrives here when an author submits it, or when a learner
              reports a mistake.
            </p>
          </div>
        ) : (
          <ul className="learn-review-list">
            {withActions.map(({ task, transitions }) => (
              <li key={task.id} className="learn-review-item">
                <span className="learn-review-prompt">
                  <span className={statusChip(task.contentStatus)}>
                    {statusLabel(task.contentStatus)}
                  </span>{' '}
                  {task.contentKind.replace(/_/g, ' ')} #{task.contentId}
                  {task.origin === 'learner_report' ? (
                    <span className="chip">reported by a learner</span>
                  ) : null}
                  {task.origin === 'ai_draft' ? <span className="chip">AI draft</span> : null}
                </span>

                <span className="learn-review-answer">
                  {task.reason ? <span>{task.reason}</span> : <span className="muted">no note</span>}
                  <span className="muted" style={{ display: 'block', fontSize: '0.82rem' }}>
                    Needs {task.requiredRole.replace(/_/g, ' ')} · opened{' '}
                    {new Date(task.createdAt).toLocaleDateString()}
                  </span>
                </span>

                {/*
                  A report from a learner is a claim, not a change. Saying so avoids the reviewer
                  treating an unverified complaint as if it were the platform's own finding.
                */}
                {task.origin === 'learner_report' ? (
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    A learner&rsquo;s report is unverified. Check it against the dictionary before
                    acting.
                  </span>
                ) : null}

                {task.actionable ? (
                  <ReviewAction kind={task.contentKind} id={task.contentId} transitions={transitions} />
                ) : (
                  <p className="muted" style={{ fontSize: '0.84rem' }}>
                    {UNSUPPORTED_KINDS.includes(task.contentKind)
                      ? task.contentKind === 'lexeme'
                        ? 'A lexeme lives in the dictionary and follows its own workflow — review it at ozituma.com.'
                        : 'Exercises have no reviewable table yet, so this task cannot be acted on here.'
                      : 'This task has no content behind it.'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">What you can do</h2>
        <p className="muted" style={{ fontSize: '0.88rem' }}>
          {actionable.length > 0
            ? `${actionable.length} of these ${actionable.length === 1 ? 'is' : 'are'} waiting on a step you are allowed to take.`
            : 'None of the open tasks currently need a step your role allows.'}{' '}
          The buttons offered on each item are the steps the lifecycle would accept from your role —
          nothing else is shown, so nothing here fails for a reason you could not have seen.
        </p>
      </section>
    </div>
  );
}
