'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The buttons that move a piece of content through §5.3's lifecycle.
 *
 * THE BUTTONS OFFERED ARE THE SERVER'S ANSWER, NOT THIS COMPONENT'S
 *
 * `transitions` arrives from the page, which got them from `availableTransitions` — the same
 * function the API route consults. So the buttons a reviewer sees are exactly the steps the domain
 * would accept. That is not only a nicety: offering a button that is certain to be refused teaches a
 * reviewer that the queue is unreliable, and the first thing they do is stop trusting the refusals
 * that matter.
 *
 * A REFUSAL IS SHOWN IN THE DOMAIN'S OWN WORDS. "A linguist may not publish" tells a reviewer what
 * to do differently; "action failed" does not.
 *
 * `reason` IS COLLECTED BEFORE IT IS NEEDED, for `request_changes` only. §5.3 requires a reason, and
 * asking for one after the click means the reviewer has already lost their place in the page.
 */

interface TransitionOption {
  transition: string;
  /** What the button should say, in the reviewer's language rather than the enum's. */
  label: string;
  /** True when the step needs a reason typed first. */
  needsReason: boolean;
  /** A destructive or consequential step gets a quieter button. */
  tone: 'primary' | 'secondary' | 'danger';
}

/** The lifecycle step, as a reviewer would describe it. */
const LABELS: Record<string, { label: string; needsReason: boolean; tone: TransitionOption['tone'] }> = {
  submit: { label: 'Submit for review', needsReason: false, tone: 'primary' },
  start_review: { label: 'Start review', needsReason: false, tone: 'primary' },
  approve_linguist: { label: 'Approve the language', needsReason: false, tone: 'primary' },
  approve_native: { label: 'Approve the audio and naturalness', needsReason: false, tone: 'primary' },
  publish: { label: 'Publish', needsReason: false, tone: 'primary' },
  unpublish: { label: 'Take down', needsReason: false, tone: 'danger' },
  request_changes: { label: 'Send back with a reason', needsReason: true, tone: 'secondary' },
  resubmit: { label: 'Resubmit', needsReason: false, tone: 'primary' },
  archive: { label: 'Archive', needsReason: false, tone: 'danger' },
  restore: { label: 'Restore', needsReason: false, tone: 'secondary' },
};

export function ReviewAction({
  kind,
  id,
  transitions,
}: {
  kind: string;
  id: number;
  transitions: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const options: TransitionOption[] = transitions
    .filter((transition) => LABELS[transition] !== undefined)
    .map((transition) => ({ transition, ...LABELS[transition]! }));

  if (options.length === 0) {
    return (
      <p className="muted" style={{ fontSize: '0.84rem' }}>
        There is no step you can take on this from here.
      </p>
    );
  }

  async function act(transition: string) {
    setBusy(transition);
    setError(null);
    setDone(null);

    try {
      const response = await fetch('/api/learn/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, transition, reason: reason || undefined }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error?.message ?? 'That action could not be completed.');
        return;
      }

      if (!body.ok) {
        // A refusal from the domain. Shown verbatim.
        setError(body.reason ?? `That step is not available from ${body.from}.`);
        // The list of steps may have changed underneath, so re-render from the server.
        router.refresh();
        return;
      }

      setDone(`Now ${String(body.to).replace(/_/g, ' ')}.`);
      setReason('');
      // The queue is server-rendered, so a refresh is what removes the task from it.
      router.refresh();
    } catch {
      setError('Network error. Check your connection.');
    } finally {
      setBusy(null);
    }
  }

  const needsReason = options.some((option) => option.needsReason);

  return (
    <div style={{ marginTop: '0.6rem' }}>
      {needsReason ? (
        <input
          className="learn-recall-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="What needs changing? (required to send back)"
          maxLength={1000}
          style={{ marginBottom: '0.5rem' }}
        />
      ) : null}

      <div className="learn-actions" style={{ flexWrap: 'wrap' }}>
        {options.map((option) => (
          <button
            key={option.transition}
            type="button"
            className={
              option.tone === 'primary'
                ? 'button'
                : option.tone === 'danger'
                  ? 'button button-secondary'
                  : 'button button-secondary'
            }
            onClick={() => void act(option.transition)}
            // A step that needs a reason is disabled until there is one, so the reviewer is not
            // told off by the server for something the form could have known.
            disabled={busy !== null || (option.needsReason && reason.trim().length < 3)}
          >
            {busy === option.transition ? 'Working…' : option.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="notice notice-warn" style={{ marginTop: '0.6rem' }}>
          {error}
        </div>
      ) : null}

      {done ? (
        <div className="notice" style={{ marginTop: '0.6rem' }}>
          {done}
        </div>
      ) : null}
    </div>
  );
}
