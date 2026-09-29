'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The practice quiz.
 *
 * Client-side because a quiz is a sequence of stateful interactions, and unlike
 * the contribution forms there is no value in making it work without
 * JavaScript — nobody practises a language by submitting a form.
 *
 * Design decisions worth naming:
 *
 *   - The glossary is shown only AFTER answering. Revealing it while the options
 *     are on screen would turn every question into a reading exercise.
 *   - A wrong answer keeps the options visible so the learner can see which one
 *     was right, rather than just being told they were wrong.
 *   - An in-progress run is not persisted. A score you can lose by closing the
 *     tab is a score that pressures a learner; this is a study tool.
 *   - Every question is fetched fresh, so the same word cannot be memorised by
 *     position.
 */

interface Option {
  id: string;
  label: string;
  audioUrl?: string | null;
}

interface Question {
  mode: string;
  prompt: string;
  promptSubtitle: string | null;
  promptAudioUrl: string | null;
  options: Option[];
  answerId: string;
  explanation: string | null;
}

type Phase = 'loading' | 'answering' | 'answered' | 'error';

export function Quiz({ mode, language }: { mode: string; language: string }) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState({ correct: 0, asked: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    setChosen(null);
    setError(null);
    try {
      const response = await fetch(`/api/practice?mode=${mode}&language=${language}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? 'Could not load a question.');
        setPhase('error');
        return;
      }
      setQuestion(body as Question);
      setPhase('answering');
    } catch {
      setError('Network error. Please try again.');
      setPhase('error');
    }
  }, [mode, language]);

  useEffect(() => {
    void load();
  }, [load]);

  // Listening mode is unusable without hearing the clip, so play it as soon as
  // the question arrives rather than making the learner hunt for a button.
  useEffect(() => {
    if (question?.promptAudioUrl && mode === 'listening' && audioRef.current) {
      void audioRef.current.play().catch(() => undefined);
    }
  }, [question, mode]);

  function choose(id: string) {
    if (phase !== 'answering' || !question) return;
    setChosen(id);
    setPhase('answered');
    setScore((previous) => ({
      correct: previous.correct + (id === question.answerId ? 1 : 0),
      asked: previous.asked + 1,
    }));
  }

  if (phase === 'error') {
    return (
      <div className="notice notice-warn">
        <strong>Could not start practice.</strong>
        <p style={{ margin: '0.4rem 0 0.8rem' }}>{error}</p>
        <button className="button button-secondary" type="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'loading' || !question) {
    return <p className="muted">Loading a question…</p>;
  }

  const correct = chosen === question.answerId;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '1rem',
          marginBottom: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <span className="muted" style={{ fontSize: '0.88rem' }}>
          {score.asked === 0
            ? 'First question'
            : `${score.correct} of ${score.asked} correct`}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <button className="button button-secondary" type="button" onClick={() => void load()}>
            Skip
          </button>
        </span>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        {mode === 'listening' ? (
          <>
            <p style={{ margin: '0 0 0.6rem', fontSize: '1.05rem', fontWeight: 600 }}>
              {question.promptSubtitle}
            </p>
            {question.promptAudioUrl ? (
              <audio
                ref={audioRef}
                controls
                src={question.promptAudioUrl}
                preload="auto"
                style={{ width: '100%', maxWidth: '24rem' }}
              >
                Your browser does not support audio playback.
              </audio>
            ) : null}
          </>
        ) : (
          <>
            <p
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 'clamp(1.6rem, 1.2rem + 1.6vw, 2.2rem)',
                margin: '0 0 0.25rem',
                fontWeight: 600,
              }}
            >
              {question.prompt}
            </p>
            {question.promptSubtitle ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.92rem' }}>
                {question.promptSubtitle}
              </p>
            ) : null}
            {question.promptAudioUrl ? (
              <audio
                controls
                src={question.promptAudioUrl}
                preload="none"
                style={{ width: '100%', maxWidth: '22rem', marginTop: '0.7rem' }}
              >
                Your browser does not support audio playback.
              </audio>
            ) : null}
          </>
        )}
      </div>

      <div style={{ display: 'grid', gap: '0.55rem' }}>
        {question.options.map((option) => {
          const isAnswer = option.id === question.answerId;
          const isChosen = option.id === chosen;
          const reveal = phase === 'answered';

          // After answering: the right answer is always marked, and a wrong
          // choice is marked separately, so the learner can see both.
          const background = !reveal
            ? 'var(--paper-raised)'
            : isAnswer
              ? '#eaf4ee'
              : isChosen
                ? '#fdeceb'
                : 'var(--paper-raised)';
          const border = !reveal
            ? 'var(--line)'
            : isAnswer
              ? 'var(--green)'
              : isChosen
                ? 'var(--red)'
                : 'var(--line)';

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => choose(option.id)}
              disabled={reveal}
              style={{
                textAlign: 'left',
                padding: '0.8rem 1rem',
                fontSize: '1rem',
                fontFamily: 'inherit',
                background,
                border: `1px solid ${border}`,
                borderRadius: 'var(--radius)',
                cursor: reveal ? 'default' : 'pointer',
                color: 'var(--ink)',
              }}
            >
              {option.label}
              {reveal && isAnswer ? (
                <span className="chip chip-common" style={{ marginLeft: '0.6rem' }}>
                  correct
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {phase === 'answered' ? (
        <div style={{ marginTop: '1.25rem' }}>
          <div className="notice" style={{ background: correct ? '#eaf4ee' : '#fdeceb', borderColor: correct ? 'var(--green)' : 'var(--red)' }}>
            <strong>{correct ? 'Correct.' : 'Not quite.'}</strong>
            {question.explanation ? (
              <p style={{ margin: '0.4rem 0 0' }}>{question.explanation}</p>
            ) : null}
          </div>
          <div style={{ marginTop: '0.9rem' }}>
            <button className="button" type="button" onClick={() => void load()}>
              Next question
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
