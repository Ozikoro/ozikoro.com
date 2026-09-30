'use client';

import { useState } from 'react';

/**
 * The text tutor.
 *
 * EVERY REPLY CARRIES ITS LABEL, AND THE LABEL IS NOT DECORATION
 *
 * §8.1 and §5.3 require that AI output be visibly distinguished from approved content, and §3's
 * principle 7 puts it as "every AI response shows a label". So the label is rendered beside every
 * assistant message rather than in a footnote, and a reply that fell back to the safe text says so
 * — a learner reading "I could not answer that from the approved material" is being told something
 * true, and hiding it behind a plain bubble would not be.
 *
 * THE SOURCES ARE SHOWN, NOT SUMMARISED
 *
 * Each reply carries the approved entries it was allowed to use. Showing them is what makes the
 * grounding checkable by the person best placed to check it: a learner who knows Igbo.
 *
 * WHEN THE TUTOR IS NOT CONFIGURED, THIS SAYS SO PLAINLY
 *
 * No AI credential exists in this deployment (§18 #10 leaves the account and the spend cap with the
 * owner). The alternative to saying so would be a chat box that accepts a question and never
 * answers, which is indistinguishable from a broken product.
 */

type TutorMode = 'explain' | 'correct' | 'translate' | 'explain_pasted';

const MODES: { value: TutorMode; label: string; hint: string }[] = [
  { value: 'explain', label: 'Explain', hint: 'What does this word or phrase mean?' },
  { value: 'correct', label: 'Check my Igbo', hint: 'Is what I wrote right?' },
  { value: 'translate', label: 'Translate', hint: 'English to Igbo, or Igbo to English' },
  { value: 'explain_pasted', label: 'Explain this Igbo', hint: 'Paste Igbo you met elsewhere' },
];

interface Source {
  headword: string;
  gloss: string;
  text: string;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  trustLabel?: string | null;
  fellBack?: boolean;
  sources?: Source[];
}

/** The label as a learner should read it. §5.3's wording, not the enum's. */
function labelText(label: string | null | undefined): { text: string; className: string } | null {
  switch (label) {
    case 'verified':
      return { text: 'From reviewed Ozituma content', className: 'chip chip-common' };
    case 'ai_assisted':
      return { text: 'AI-assisted, not reviewed', className: 'chip' };
    case 'regional_variant':
      return { text: 'A regional form, not standard Igbo', className: 'chip chip-dialect' };
    case 'needs_review':
      return { text: 'Not verified — treat with care', className: 'chip' };
    case 'community_submission':
      return { text: 'Community submission', className: 'chip' };
    default:
      return null;
  }
}

export function TutorRunner({ configured }: { configured: boolean }) {
  const [mode, setMode] = useState<TutorMode>('explain');
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  async function send() {
    const text = message.trim();
    if (text === '' || busy) return;

    setTurns((previous) => [...previous, { role: 'user', content: text }]);
    setMessage('');
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/learn/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, mode, conversationId }),
      });
      const body = await response.json();

      if (!response.ok) {
        // The daily limit is a state, not an error. Saying "you have used today's messages" is
        // different from "something went wrong", and a learner who has hit the cap should not be
        // told to try again.
        if (response.status === 429) {
          setLimitReached(true);
          setError(body?.error?.message ?? 'You have used today’s tutor messages.');
          return;
        }
        if (response.status === 401) {
          setError('Sign in to use the tutor — it keeps a history and a daily limit.');
          return;
        }
        setError(body?.error?.message ?? 'The tutor could not answer just now.');
        return;
      }

      if (typeof body.conversationId === 'number') setConversationId(body.conversationId);

      setTurns((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: body.reply ?? '',
          trustLabel: body.trustLabel ?? null,
          fellBack: Boolean(body.fellBack),
          sources: body.sources ?? [],
        },
      ]);
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!configured ? (
        <div className="notice" style={{ marginBottom: '1rem' }}>
          <strong>The tutor is not switched on yet.</strong>
          <p style={{ margin: '0.4rem 0 0' }}>
            It needs a model provider, and that account belongs to the site owner. Until then, the
            approved Ozituma entries for whatever you ask are shown below — they are the same
            material a tutor answer would be built from, and they are readable and checkable as they
            stand.
          </p>
        </div>
      ) : null}

      <div className="learn-options" style={{ marginBottom: '1rem' }}>
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`learn-option ${mode === option.value ? 'is-active' : ''}`}
            onClick={() => setMode(option.value)}
            disabled={busy}
          >
            <strong>{option.label}</strong>
            <span className="muted" style={{ display: 'block', fontSize: '0.82rem' }}>
              {option.hint}
            </span>
          </button>
        ))}
      </div>

      {turns.length > 0 ? (
        <ul className="learn-review-list" style={{ marginBottom: '1rem' }}>
          {turns.map((turn, index) => (
            <li key={index} className="learn-review-item">
              {turn.role === 'user' ? (
                <>
                  <span className="learn-review-prompt">You asked</span>
                  <span className="learn-review-answer">{turn.content}</span>
                </>
              ) : (
                <>
                  <span className="learn-review-prompt">
                    {(() => {
                      const label = labelText(turn.trustLabel);
                      return label ? <span className={label.className}>{label.text}</span> : null;
                    })()}
                  </span>
                  <span className="learn-review-answer" style={{ whiteSpace: 'pre-wrap' }}>
                    {turn.content}
                  </span>

                  {turn.sources && turn.sources.length > 0 ? (
                    <details style={{ marginTop: '0.5rem' }}>
                      <summary className="muted" style={{ fontSize: '0.84rem', cursor: 'pointer' }}>
                        Show the {turn.sources.length} approved{' '}
                        {turn.sources.length === 1 ? 'entry' : 'entries'} this used
                      </summary>
                      <ul className="learn-review-list" style={{ marginTop: '0.5rem' }}>
                        {turn.sources.map((source, sourceIndex) => (
                          <li key={sourceIndex} className="learn-review-item">
                            <span className="learn-review-prompt">{source.headword}</span>
                            <span className="learn-review-answer">{source.gloss}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {busy ? <p className="muted">Thinking…</p> : null}

      {error ? (
        <div className="notice notice-warn" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      <form
        className="learn-recall"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="learn-recall-label" htmlFor="tutor-input">
          Your question
        </label>
        <input
          id="tutor-input"
          className="learn-recall-input"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="e.g. What does ị mean here?"
          autoComplete="off"
          disabled={busy || limitReached}
          lang="ig"
        />
        <button className="button" type="submit" disabled={busy || limitReached || message.trim() === ''}>
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </form>

      <p className="muted" style={{ fontSize: '0.84rem', marginTop: '0.8rem' }}>
        The tutor answers from reviewed Ozituma content only. It will not invent Igbo, and when it
        cannot ground an answer it says so rather than guessing.
      </p>
    </div>
  );
}
