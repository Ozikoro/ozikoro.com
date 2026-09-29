'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
// Type-only import: erased at compile time, so none of the database package ends
// up in the browser bundle. See the note in learn-exercises.ts on why grading is
// a server concern.
import type { Exercise } from '@ozituma/db/learn-exercises';

/**
 * The lesson exercise runner.
 *
 * WHAT IT DOES DIFFERENTLY FROM THE DICTIONARY QUIZ
 *
 * The dictionary quiz fetches a fresh random question forever and keeps score
 * only in the tab. A lesson has a beginning and an end, so this does too: a
 * fixed set of exercises, a progress bar, immediate feedback on each answer, and
 * a summary at the end that says what you got and what the answer was.
 *
 * Immediate feedback costs a round trip per answer, because grading is on the
 * server (see the grade route for why). That is worth it: a learner who finds
 * out they were wrong three questions later has already rehearsed the mistake.
 *
 * The end-of-set call re-grades everything server-side and writes progress. The
 * score that gets stored is therefore never the one this component computed —
 * the client's running tally is for the UI only.
 */

interface GradedItem {
  id: string;
  correct: boolean;
  response: string;
  expected: string;
  explanation: string | null;
}

interface GradeResponse {
  items: GradedItem[];
  correct: number;
  total: number;
  score: number;
  recorded: boolean;
  signedIn: boolean;
}

type Phase = 'loading' | 'error' | 'running' | 'finished';

export function ExerciseRunner({
  course,
  lesson,
  exerciseCount,
  signedIn,
  base,
  nextLesson,
}: {
  course: string;
  lesson: string;
  /** Shown before the set loads, so the learner knows what they are starting. */
  exerciseCount: number;
  signedIn: boolean;
  /** '/learn' on the main domain, '' on the learn subdomain. */
  base: string;
  nextLesson: { slug: string; title: string } | null;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<GradedItem | null>(null);
  const [checking, setChecking] = useState(false);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<GradeResponse | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = exercises[index] ?? null;

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const response = await fetch(
        `/api/learn/exercise?course=${encodeURIComponent(course)}&lesson=${encodeURIComponent(lesson)}`,
        { cache: 'no-store' }
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not load the exercises.');
        setPhase('error');
        return;
      }
      setExercises(body.exercises ?? []);
      setPhase('running');
    } catch {
      setError('Network error. Please try again.');
      setPhase('error');
    }
  }, [course, lesson]);

  useEffect(() => {
    void load();
  }, [load]);

  // Focus the input for a typing question, so a learner can just start writing.
  useEffect(() => {
    if (current?.kind === 'recall' && !feedback) inputRef.current?.focus();
  }, [current, feedback]);

  /** Grade one answer immediately, without recording anything. */
  async function submitAnswer(exercise: Exercise, response: string) {
    setChecking(true);
    try {
      const apiResponse = await fetch('/api/learn/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course, lesson, responses: { [exercise.id]: response } }),
      });
      const body = await apiResponse.json();
      if (!apiResponse.ok) {
        setError(body?.error?.message ?? 'Could not check that answer.');
        return;
      }
      setResponses((previous) => ({ ...previous, [exercise.id]: response }));
      // Look the item up by id rather than taking the first one. The grading
      // route rebuilds the set with its own fixed seed, so the order it returns
      // is NOT the order this component is presenting — reading items[0] here
      // would show feedback for whichever exercise happened to sort first.
      const graded = (body.items as GradedItem[]).find((item) => item.id === exercise.id) ?? null;
      if (!graded) {
        setError('That answer could not be matched to a question. Try reloading.');
        return;
      }
      setFeedback(graded);
    } catch {
      setError('Network error while checking the answer.');
    } finally {
      setChecking(false);
    }
  }

  function choose(optionId: string) {
    if (!current || feedback || checking) return;
    void submitAnswer(current, optionId);
  }

  function checkTyped() {
    if (!current || feedback || checking || typed.trim() === '') return;
    void submitAnswer(current, typed.trim());
  }

  /** Move on. On the last exercise, finish and record. */
  async function advance() {
    if (index < exercises.length - 1) {
      setIndex(index + 1);
      setFeedback(null);
      setTyped('');
      return;
    }

    setChecking(true);
    try {
      const response = await fetch('/api/learn/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course, lesson, responses, record: true }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not save your result.');
        setPhase('error');
        return;
      }
      setResult(body as GradeResponse);
      setPhase('finished');
    } catch {
      setError('Network error while saving your result.');
      setPhase('error');
    } finally {
      setChecking(false);
    }
  }

  if (phase === 'error') {
    return (
      <div className="notice notice-warn">
        <strong>Practice could not run.</strong>
        <p style={{ margin: '0.4rem 0 0.8rem' }}>{error}</p>
        <button className="button button-secondary" type="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'loading' || !current) {
    return <p className="muted">Building {exerciseCount} exercises from this lesson…</p>;
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  if (phase === 'finished' && result) {
    const wrong = result.items.filter((item) => !item.correct);
    const passed = result.score >= 80;

    return (
      <div className="learn-results">
        <div className={`learn-result-headline ${passed ? 'is-pass' : 'is-retry'}`}>
          <span className="learn-result-score">{result.score}%</span>
          <span className="learn-result-detail">
            {result.correct} of {result.total} correct
          </span>
        </div>

        <p className="learn-prose">
          {passed
            ? 'That is the lesson. Move on when you are ready — you can always come back.'
            : 'Close, but not there yet. Read the ones you missed below, then run the set again.'}
        </p>

        <p className="learn-progress-note">
          {result.recorded
            ? 'Your progress on this lesson is saved.'
            : signedIn
              ? 'Your progress could not be saved this time.'
              : 'You are not signed in, so this score was not saved. Everything still works — only the record of it needs an account.'}
        </p>

        {wrong.length > 0 ? (
          <section className="learn-section">
            <h2 className="learn-section-title">What to look at again</h2>
            <ul className="learn-review-list">
              {wrong.map((item) => {
                const exercise = exercises.find((e) => e.id === item.id);
                return (
                  <li key={item.id} className="learn-review-item">
                    <span className="learn-review-prompt">{exercise?.prompt}</span>
                    <span className="learn-review-answer">
                      <span className="learn-review-label">You said</span>
                      <span className="learn-review-wrong">{item.response || '— nothing —'}</span>
                      <span className="learn-review-label">Correct</span>
                      <span className="learn-review-right">{item.expected}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="learn-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setResult(null);
              setResponses({});
              setIndex(0);
              setFeedback(null);
              setTyped('');
              void load();
            }}
          >
            Run it again
          </button>
          <Link className="button" href={`${base}/${course}/${lesson}`}>
            Back to the lesson
          </Link>
          {nextLesson ? (
            <Link className="button button-secondary" href={`${base}/${course}/${nextLesson.slug}`}>
              Next: {nextLesson.title}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------
  const progressPercent = Math.round((index / exercises.length) * 100);

  return (
    <div className="learn-runner">
      <div className="learn-runner-head">
        <span className="muted" style={{ fontSize: '0.88rem' }}>
          Question {index + 1} of {exercises.length}
        </span>
        <div className="learn-progress-track" aria-hidden="true">
          <div className="learn-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="card learn-prompt">
        <p className="learn-prompt-subtitle">{current.promptSubtitle}</p>

        {current.kind === 'listen' ? (
          current.promptAudioUrl ? (
            <audio
              controls
              autoPlay
              src={current.promptAudioUrl}
              preload="auto"
              style={{ width: '100%', maxWidth: '24rem' }}
            >
              Your browser does not support audio playback.
            </audio>
          ) : (
            // Cannot happen: the builder falls back to a reading question when a
            // word has no recording. Shown rather than left blank in case a
            // recording is withdrawn after the set was built.
            <p className="muted">That recording is unavailable. Skip to the next question.</p>
          )
        ) : (
          <p className="learn-prompt-text">{current.prompt}</p>
        )}
      </div>

      {current.options ? (
        <div className="learn-options">
          {current.options.map((option) => {
            const isAnswer = feedback?.expected === option.label;
            const isChosen = feedback && responses[current.id] === option.id;
            const reveal = feedback !== null;

            const state = !reveal ? '' : isAnswer ? 'is-right' : isChosen ? 'is-wrong' : '';
            return (
              <button
                key={option.id}
                type="button"
                className={`learn-option ${state}`}
                onClick={() => choose(option.id)}
                disabled={reveal || checking}
              >
                {option.label}
                {reveal && isAnswer ? <span className="chip chip-common">correct</span> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <form
          className="learn-recall"
          onSubmit={(event) => {
            event.preventDefault();
            checkTyped();
          }}
        >
          <label className="learn-recall-label" htmlFor="learn-recall-input">
            Type the Igbo
          </label>
          <input
            id="learn-recall-input"
            ref={inputRef}
            className="learn-recall-input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            disabled={feedback !== null}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Igbo, with or without tone marks"
          />
          {!feedback ? (
            <button className="button" type="submit" disabled={checking || typed.trim() === ''}>
              {checking ? 'Checking…' : 'Check'}
            </button>
          ) : null}
        </form>
      )}

      {feedback ? (
        <div className={`notice ${feedback.correct ? 'learn-feedback-right' : 'learn-feedback-wrong'}`}>
          <strong>{feedback.correct ? 'Correct.' : `Not quite — ${feedback.expected}`}</strong>
          {feedback.explanation ? (
            <p style={{ margin: '0.4rem 0 0' }}>{feedback.explanation}</p>
          ) : null}
          {!feedback.correct && current.kind === 'recall' ? (
            <p style={{ margin: '0.4rem 0 0' }} className="muted">
              Tone marks and the dots under ị, ọ, ụ and ṅ are not marked wrong here — they are on
              every card in the lesson, and your keyboard is not the thing being tested.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      ) : null}

      {feedback ? (
        <div className="learn-actions">
          <button className="button" type="button" onClick={() => void advance()} disabled={checking}>
            {checking
              ? 'Saving…'
              : index < exercises.length - 1
                ? 'Next question'
                : 'Finish'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
