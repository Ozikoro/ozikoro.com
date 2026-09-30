'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

/**
 * The daily review queue.
 *
 * A flashcard, not a quiz. The learner sees the Igbo, decides for themselves whether they could
 * recall the meaning, reveals it, and then tells the schedule how hard that was. That self-assessment
 * is the input SM-2 is designed around, which is why this component asks the question rather than
 * grading one — see the note in the plan route.
 *
 * The four ratings are labelled with what they do, not just their names. "Again / Hard / Good / Easy"
 * means nothing to someone who has not met a spaced-repetition system before, and a learner who
 * guesses at the buttons is a learner whose schedule is being built from noise.
 */

interface PlanItem {
  itemId: string;
  headword: string;
  slug: string;
  english: string;
  audioUrl: string | null;
  isNew: boolean;
  state: string;
}

interface PlanResponse {
  items: PlanItem[];
  dueCount: number;
  newCount: number;
  estimatedMinutes: number;
  truncated: boolean;
  trackedTotal: number;
  minutesAvailable: number;
}

interface ReviewResponse {
  state: string;
  dueAt: number;
  intervalDays: number;
  lapse: boolean;
  dueNow: number;
}

type Phase = 'loading' | 'signin' | 'empty' | 'running' | 'done' | 'error';

const RATINGS = [
  { value: 'again', label: 'Again', hint: 'I could not recall it' },
  { value: 'hard', label: 'Hard', hint: 'I got there, slowly' },
  { value: 'good', label: 'Good', hint: 'I remembered it' },
  { value: 'easy', label: 'Easy', hint: 'It was immediate' },
] as const;

/** "in 3 days" reads better than a date, and is what the learner actually wants to know. */
function describeInterval(days: number): string {
  if (days < 1 / 24) return 'in a few minutes';
  if (days < 1) return `in ${Math.round(days * 24 * 60)} minutes`;
  if (days < 2) return 'tomorrow';
  if (days < 30) return `in ${Math.round(days)} days`;
  return `in ${Math.round(days / 30)} months`;
}

export function PlanRunner({ signedIn }: { signedIn: boolean }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ReviewResponse | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [minutes, setMinutes] = useState(10);
  const [startedAt, setStartedAt] = useState(() => Date.now());

  const load = useCallback(
    async (minutesAvailable: number) => {
      if (!signedIn) {
        setPhase('signin');
        return;
      }
      setPhase('loading');
      setError(null);
      try {
        const response = await fetch(`/api/learn/plan?minutes=${minutesAvailable}`, {
          cache: 'no-store',
        });
        const body = await response.json();
        if (response.status === 401) {
          setPhase('signin');
          return;
        }
        if (!response.ok) {
          setError(body?.error?.message ?? 'Could not load your plan.');
          setPhase('error');
          return;
        }
        const data = body as PlanResponse;
        setPlan(data);
        setIndex(0);
        setRevealed(false);
        setReviewed(0);
        setLastResult(null);
        setPhase(data.items.length === 0 ? 'empty' : 'running');
      } catch {
        setError('Network error. Check your connection and try again.');
        setPhase('error');
      }
    },
    [signedIn]
  );

  useEffect(() => {
    // `minutes` is a dependency on purpose: changing the time budget rebuilds the plan, because the
    // budget is part of what the plan IS, not a display filter over a fixed list.
    void load(minutes);
  }, [load, minutes]);

  const current = plan?.items[index] ?? null;

  async function rate(rating: string) {
    if (!current || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/learn/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: current.itemId,
          rating,
          elapsedMs: Date.now() - startedAt,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not record that review.');
        setBusy(false);
        return;
      }
      setLastResult(body as ReviewResponse);
      setReviewed((n) => n + 1);

      if (index < (plan?.items.length ?? 0) - 1) {
        setIndex(index + 1);
        setRevealed(false);
        setStartedAt(Date.now());
      } else {
        setPhase('done');
      }
    } catch {
      setError('Network error while recording the review.');
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // States
  // -------------------------------------------------------------------------

  if (!signedIn || phase === 'signin') {
    return (
      <div className="notice">
        <strong>Your review schedule lives in your account.</strong>
        <p style={{ margin: '0.4rem 0 0.8rem' }}>
          Signing in is what lets the platform remember which words you are about to forget. Without
          an account you can still practise — nothing is locked — but nothing is scheduled either.
        </p>
        <Link className="button" href="/signin?next=/plan">
          Sign in
        </Link>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="notice notice-warn">
        <strong>Your plan could not load.</strong>
        <p style={{ margin: '0.4rem 0 0.8rem' }}>{error}</p>
        <button className="button button-secondary" type="button" onClick={() => void load(minutes)}>
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'loading') {
    return <p className="muted">Working out what is due…</p>;
  }

  if (phase === 'empty') {
    return (
      <div className="notice">
        <strong>Nothing is due right now.</strong>
        <p style={{ margin: '0.4rem 0 0.8rem' }}>
          {plan && plan.trackedTotal > 0
            ? `You have ${plan.trackedTotal.toLocaleString()} word${plan.trackedTotal === 1 ? '' : 's'} in your schedule and none of them are due yet. That is the system working — reviewing early is what makes it stop working.`
            : 'You have not reviewed anything yet. Practise some vocabulary and it will be scheduled here automatically.'}
        </p>
        <Link className="button" href="/practice">
          Practise vocabulary
        </Link>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="learn-results">
        <div className="learn-result-headline is-pass">
          <span className="learn-result-score">{reviewed}</span>
          <span className="learn-result-detail">
            review{reviewed === 1 ? '' : 's'} done
          </span>
        </div>

        <p className="learn-prose">
          {lastResult && lastResult.dueNow > 0
            ? `${lastResult.dueNow} more ${lastResult.dueNow === 1 ? 'word is' : 'words are'} still due today.`
            : 'That is everything due today. The rest will come back when you are about to forget them.'}
        </p>

        {lastResult ? (
          <p className="muted" style={{ fontSize: '0.88rem' }}>
            The last word comes back {describeInterval(lastResult.intervalDays)}.
          </p>
        ) : null}

        <div className="learn-actions">
          <button className="button" type="button" onClick={() => void load(minutes)}>
            Check for more
          </button>
          <Link className="button button-secondary" href="/practice">
            Practise new words
          </Link>
        </div>
      </div>
    );
  }

  if (!current || !plan) {
    return <p className="muted">Working out what is due…</p>;
  }

  const progressPercent = Math.round((index / plan.items.length) * 100);

  return (
    <div className="learn-runner">
      <div className="learn-runner-head">
        <span className="muted" style={{ fontSize: '0.88rem' }}>
          {index + 1} of {plan.items.length}
          {current.isNew ? ' · new' : ''}
        </span>
        <div className="learn-progress-track" aria-hidden="true">
          <div className="learn-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <label className="muted" style={{ fontSize: '0.86rem', display: 'block', marginBottom: '0.6rem' }}>
        Time today:{' '}
        <select
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
          style={{ marginLeft: '0.3rem' }}
        >
          {[5, 10, 15, 20, 30].map((value) => (
            <option key={value} value={value}>
              {value} minutes
            </option>
          ))}
        </select>
      </label>

      <div className="card learn-prompt">
        {current.audioUrl ? (
          <audio
            controls
            src={current.audioUrl}
            preload="none"
            style={{ width: '100%', maxWidth: '24rem', marginBottom: '0.6rem' }}
          >
            Your browser does not support audio playback.
          </audio>
        ) : null}

        <p className="learn-prompt-text">{current.headword}</p>
        {current.state !== 'new' ? (
          <p className="learn-prompt-subtitle">
            {current.state === 'relearning' ? 'You forgot this one recently' : 'You have met this before'}
          </p>
        ) : null}
      </div>

      {!revealed ? (
        <div className="learn-actions">
          <button className="button" type="button" onClick={() => setRevealed(true)}>
            Show the meaning
          </button>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <p style={{ margin: 0 }}>
              <strong>{current.english}</strong>
            </p>
            <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.86rem' }}>
              <Link href={`/word/igbo/${current.slug}`}>Open the full entry</Link>
            </p>
          </div>

          <p className="muted" style={{ fontSize: '0.88rem', marginBottom: '0.5rem' }}>
            How hard was that to recall?
          </p>

          <div className="learn-options">
            {RATINGS.map((rating) => (
              <button
                key={rating.value}
                type="button"
                className="learn-option"
                onClick={() => void rate(rating.value)}
                disabled={busy}
              >
                <strong>{rating.label}</strong>
                <span className="muted" style={{ display: 'block', fontSize: '0.82rem' }}>
                  {rating.hint}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {lastResult && revealed ? (
        <p className="muted" style={{ fontSize: '0.84rem', marginTop: '0.8rem' }}>
          Last one comes back {describeInterval(lastResult.intervalDays)}.
        </p>
      ) : null}

      {error ? (
        <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      ) : null}

      <p className="muted" style={{ fontSize: '0.82rem', marginTop: '1rem' }}>
        {plan.dueCount} due now · {plan.newCount} new · about {plan.estimatedMinutes} minutes for this
        set
        {plan.truncated ? ' (there is more than fits in the time you chose)' : ''}
      </p>
    </div>
  );
}
