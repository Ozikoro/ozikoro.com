'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
// Type-only, so none of the database package reaches the browser bundle.
import type { Exercise } from '@ozituma/db/learn-exercises';

/**
 * Vocabulary practice drawn from the dictionary.
 *
 * HOW THIS DIFFERS FROM THE LESSON RUNNER
 *
 * A lesson is a fixed set with an end: a progress bar that fills, a score, a "finish". Practice has
 * no end by design — there are 12,229 published words and the learner may stop whenever they like.
 * So this component pages through the corpus instead of marching to a summary, and its "score"
 * counts up across pages rather than being a result.
 *
 * Grading is still on the server, for the reason set out in the grade route: practice feeds the
 * spaced-repetition queue, and a queue a learner can forge is not a queue.
 *
 * THE LIST IS ADDRESSED, NOT CARRIED
 *
 * Each request sends `offset`, `limit` and the filters, and the server re-runs the same query. It
 * never sends a list of words for the server to trust. See the practice route for why.
 */

interface GradedItem {
  id: string;
  correct: boolean;
  response: string;
  expected: string;
  explanation: string | null;
}

interface PracticeWordSummary {
  id: string;
  headword: string;
  slug: string;
  english: string;
  hasAudio: boolean;
}

interface PracticeResponse {
  exercises: Exercise[];
  words: PracticeWordSummary[];
  offset: number;
  nextOffset: number;
  hasMore: boolean;
  available: number;
  availableWithAudio: number;
}

interface GradeResponse {
  items: GradedItem[];
  correct: number;
  total: number;
  score: number;
}

type Phase = 'loading' | 'error' | 'running' | 'empty';

export function PracticeRunner({
  signedIn,
  dictionaryUrl,
}: {
  signedIn: boolean;
  /**
   * The dictionary's origin, passed down from the server page.
   *
   * Not read from `process.env` here: this is a client component, and a non-`NEXT_PUBLIC_` variable
   * is not available in the browser bundle. Reading it here would silently yield `undefined` and
   * produce a link to `undefined/word/...`, which is exactly the class of bug this prop replaces —
   * the earlier version of this file pointed at `/word/...` on the learn host, where no such route
   * exists and every vocabulary link 404d.
   */
  dictionaryUrl: string;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [words, setWords] = useState<PracticeWordSummary[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<GradedItem | null>(null);
  const [checking, setChecking] = useState(false);
  const [typed, setTyped] = useState('');
  const [nextOffset, setNextOffset] = useState(0);

  // Running totals across pages, so the learner can see how they are doing without the session
  // ending. Never sent anywhere: the server computes its own numbers from the answers.
  const [answered, setAnswered] = useState(0);
  const [right, setRight] = useState(0);

  const [requireAudio, setRequireAudio] = useState(false);
  const [available, setAvailable] = useState<{ total: number; withAudio: number } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const current = exercises[index] ?? null;
  const currentWord = current ? words.find((w) => current.id.includes(`-${w.id}-`)) ?? null : null;

  const load = useCallback(
    async (offset: number, audio: boolean) => {
      setPhase('loading');
      setError(null);
      try {
        const params = new URLSearchParams({ limit: '10', offset: String(offset) });
        if (audio) params.set('audio', '1');
        const response = await fetch(`/api/learn/practice?${params}`, { cache: 'no-store' });
        const body = await response.json();

        if (!response.ok) {
          // 409 is "nothing left here", which is a normal end to a practice session rather than a
          // failure. Told apart from a real error so the learner is not shown a warning for
          // finishing everything.
          if (response.status === 409) {
            setPhase('empty');
            setError(body?.error?.message ?? null);
            return;
          }
          setError(body?.error?.message ?? 'Could not load practice.');
          setPhase('error');
          return;
        }

        const data = body as PracticeResponse;
        setExercises(data.exercises ?? []);
        setWords(data.words ?? []);
        setNextOffset(data.nextOffset);
        setAvailable({ total: data.available, withAudio: data.availableWithAudio });
        setIndex(0);
        setTyped('');
        setFeedback(null);
        setPhase('running');
      } catch {
        setError('Network error. Check your connection and try again.');
        setPhase('error');
      }
    },
    []
  );

  useEffect(() => {
    void load(0, requireAudio);
    // Only on mount and when the audio preference changes: `load` is stable, so listing
    // `requireAudio` here restarts practice from the beginning when the learner toggles listening,
    // which is what they would expect.
  }, [load, requireAudio]);

  useEffect(() => {
    if (current?.kind === 'recall' && !feedback) inputRef.current?.focus();
  }, [current, feedback]);

  async function submitAnswer(exercise: Exercise, response: string) {
    setChecking(true);
    try {
      const apiResponse = await fetch('/api/learn/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 10,
          offset: nextOffset - exercises.length,
          audio: requireAudio,
          responses: { [exercise.id]: response },
        }),
      });
      const body = await apiResponse.json();
      if (!apiResponse.ok) {
        setError(body?.error?.message ?? 'Could not check that answer.');
        return;
      }
      // Looked up by id, never by position: the grading route rebuilds the set with its own
      // ordering, so `items[0]` is not the question on screen.
      const graded = (body.items as GradedItem[]).find((item) => item.id === exercise.id) ?? null;
      if (!graded) {
        setError('That answer could not be matched to a question. Try loading the next set.');
        return;
      }
      setFeedback(graded);
      setAnswered((n) => n + 1);
      if (graded.correct) setRight((n) => n + 1);
    } catch {
      setError('Network error while checking the answer.');
    } finally {
      setChecking(false);
    }
  }

  function advance() {
    if (index < exercises.length - 1) {
      setIndex(index + 1);
      setFeedback(null);
      setTyped('');
      return;
    }
    // End of the page: fetch the next ten from the corpus.
    void load(nextOffset, requireAudio);
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  if (phase === 'error') {
    return (
      <div className="notice notice-warn">
        <strong>Practice could not run.</strong>
        <p style={{ margin: '0.4rem 0 0.8rem' }}>{error}</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void load(0, requireAudio)}
        >
          Start again
        </button>
      </div>
    );
  }

  if (phase === 'empty') {
    return (
      <div className="notice">
        <strong>That is every word at this setting.</strong>
        <p style={{ margin: '0.4rem 0 0.8rem' }}>
          {error ??
            'You have reached the end of the list. Start again from the beginning, or turn listening off to reach more words.'}
        </p>
        <button className="button" type="button" onClick={() => void load(0, requireAudio)}>
          Start again
        </button>
      </div>
    );
  }

  if (phase === 'loading' || !current) {
    return <p className="muted">Choosing words to practise…</p>;
  }

  const progressPercent = Math.round((index / exercises.length) * 100);

  return (
    <div className="learn-runner">
      <div className="learn-runner-head">
        <span className="muted" style={{ fontSize: '0.88rem' }}>
          Question {index + 1} of {exercises.length}
          {answered > 0 ? ` · ${right} of ${answered} right so far` : ''}
        </span>
        <div className="learn-progress-track" aria-hidden="true">
          <div className="learn-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {/*
        The listening toggle. Only offered when there are enough recordings to sustain it, because
        a switch that leads to "no words left" after two questions is worse than no switch.
      */}
      {available && available.withAudio >= 10 ? (
        <label className="learn-toggle muted" style={{ fontSize: '0.86rem', display: 'block', marginBottom: '0.6rem' }}>
          <input
            type="checkbox"
            checked={requireAudio}
            onChange={(event) => setRequireAudio(event.target.checked)}
            style={{ marginRight: '0.4rem' }}
          />
          Listening only — {available.withAudio.toLocaleString()} words have recordings
        </label>
      ) : null}

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
            <p className="muted">That recording is unavailable. Move to the next question.</p>
          )
        ) : (
          <p className="learn-prompt-text">{current.prompt}</p>
        )}
      </div>

      {current.options ? (
        <div className="learn-options">
          {current.options.map((option) => {
            const isAnswer = feedback?.expected === option.label;
            const isChosen = feedback !== null && option.id === feedback.response;
            const reveal = feedback !== null;
            const state = !reveal ? '' : isAnswer ? 'is-right' : isChosen ? 'is-wrong' : '';
            return (
              <button
                key={option.id}
                type="button"
                className={`learn-option ${state}`}
                onClick={() => {
                  if (feedback || checking) return;
                  void submitAnswer(current, option.id);
                }}
                disabled={reveal || checking}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <form
          className="learn-recall"
          onSubmit={(event) => {
            event.preventDefault();
            if (!feedback && !checking && typed.trim() !== '') {
              void submitAnswer(current, typed.trim());
            }
          }}
        >
          <label className="learn-recall-label" htmlFor="practice-recall-input">
            Type the Igbo
          </label>
          <input
            id="practice-recall-input"
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
          {currentWord ? (
            <p style={{ margin: '0.4rem 0 0' }}>
              <a href={`${dictionaryUrl}/word/igbo/${currentWord.slug}`}>
                {currentWord.headword} — {currentWord.english}
              </a>
            </p>
          ) : null}
          {!feedback.correct && current.kind === 'recall' ? (
            <p className="muted" style={{ margin: '0.4rem 0 0' }}>
              Tone marks and the dots under ị, ọ, ụ and ṅ are not marked wrong here — they are on
              every card, and your keyboard is not the thing being tested.
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
          <button className="button" type="button" onClick={advance} disabled={checking}>
            {index < exercises.length - 1 ? 'Next question' : 'Next ten words'}
          </button>
        </div>
      ) : null}

      <p className="muted" style={{ fontSize: '0.82rem', marginTop: '1rem' }}>
        {available
          ? `${available.total.toLocaleString()} published words are available to practise.`
          : null}{' '}
        {signedIn
          ? null
          : 'Practising without an account works — your score just is not kept.'}
      </p>
    </div>
  );
}
