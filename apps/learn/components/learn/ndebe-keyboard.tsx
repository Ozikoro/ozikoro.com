'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  NDEBE_BODIES,
  NDEBE_TONES,
  NDEBE_VOWELS,
  NDEBE_STANDALONE_VOWEL_BASE,
  syllableCodepoint,
  type NdebeTone,
} from '@ozituma/core';

/**
 * The on-screen keyboard.
 *
 * This is §9.1's answer to the question the plan could not settle: how does a learner produce a
 * Ndebe character? §17 lists "the Typendebe method, a syllable-picker, or both" as an open decision,
 * and §16 warns that modules 5 onward "cannot be finished" until it is made. This is the
 * syllable-picker, and it is the half that needs nothing installed — which §9.4 says to present
 * first, because setup friction is where "most learners of a new script drop out".
 *
 * It is also the half that needs no permission. §13 says to ask Typendebe's owner before embedding
 * or copying its approach, and the Ndebe Project's own licence (see the header of
 * packages/core/src/ndebe.ts) covers the script. So this is built from the script's grid, which is
 * licensed, and owes nothing to anybody else's keyboard.
 *
 * THREE STEPS, BECAUSE THE SCRIPT HAS THREE PARTS
 *
 * A character is consonant body + vowel + tone. §9.1 asks for composition in that order with the
 * tone defaulting to mid, and that is what this does: the body row, then the vowel row, then the
 * tone toggle. Doing it in one flat grid of 1,134 characters — 42 bodies × 9 vowels × 3 tones —
 * would be a wall, and worse, it would teach the learner that the characters are 1,134 unrelated
 * drawings rather than a system. Module 2's whole objective is that a character is BUILT.
 *
 * THE LAYOUT IS THE GRID
 *
 * §9.1: "Layout mirrors the chart... so using the keyboard reinforces the grid." So the bodies are
 * in the official stem-major order, not alphabetised. A learner who uses this has already begun
 * learning where things are on the chart at ozituma.com/ndebe.
 *
 * WHY THE BODIES ARE A HORIZONTAL SCROLLER
 *
 * 42 bodies will not fit across a phone. A vertical list of 42 would push the vowel row off screen,
 * and the vowel row is the other half of every choice — a learner would scroll down, pick a body,
 * scroll back up, and lose the thread. A horizontal scroller keeps all three steps on screen at
 * once, which is the only arrangement in which the three-step composition actually reads as three
 * steps.
 */

/** The seven bodies that are written as two Latin letters. §6 Module 2 teaches these as one body. */
const DIGRAPHS = new Set(['gb', 'kp', 'gw', 'kw', 'ch', 'ny', 'nw']);

export interface NdebeKeyboardProps {
  /** Called with the composed character each time a syllable is completed. */
  onSyllable?: (character: string, roman: string, tone: NdebeTone) => void;
  /** Shown above the keyboard. The drill says what it wants typed. */
  prompt?: React.ReactNode;
  /** Hides the built-in output line, for a caller that renders its own. */
  hideOutput?: boolean;
}

export function NdebeKeyboard({ onSyllable, prompt, hideOutput = false }: NdebeKeyboardProps) {
  // `null` = a standalone vowel; a number = an index into NDEBE_BODIES.
  const [body, setBody] = useState<number | null>(null);
  const [vowel, setVowel] = useState<number | null>(null);
  const [tone, setTone] = useState<NdebeTone>('mid');
  const [typed, setTyped] = useState<{ character: string; roman: string; tone: NdebeTone }[]>([]);
  const [note, setNote] = useState<string | null>(null);

  /*
   * The preview. A character only exists once a body and a vowel are both chosen, so until then
   * this shows what is still missing — which is more instructive than an empty box, because it
   * names the two parts the learner is assembling.
   */
  const preview = useMemo(() => {
    if (vowel === null) return null;
    if (body === null) {
      // A standalone vowel: the vowels have their own codepoints, base + index * 3 + tone.
      const codepoint = NDEBE_STANDALONE_VOWEL_BASE + vowel * 3 + NDEBE_TONES.indexOf(tone);
      return { character: String.fromCodePoint(codepoint), roman: NDEBE_VOWELS[vowel]! };
    }
    const codepoint = syllableCodepoint(body, vowel, NDEBE_TONES.indexOf(tone));
    return { character: String.fromCodePoint(codepoint), roman: NDEBE_BODIES[body]![0]! + NDEBE_VOWELS[vowel]! };
  }, [body, vowel, tone]);

  const commit = useCallback(() => {
    if (!preview) return;
    setTyped((current) => [...current, { ...preview, tone }]);
    onSyllable?.(preview.character, preview.roman, tone);
    // Reset the two CHOICES but keep the tone: a learner typing a word usually keeps the tone they
    // are in, and §9.1 makes mid the default precisely so it need not be re-picked every syllable.
    setBody(null);
    setVowel(null);
    setNote(null);
  }, [preview, tone, onSyllable]);

  /** Backspace removes a whole syllable. §9.1: character-level deletion is not a thing here. */
  const backspace = useCallback(() => {
    setTyped((current) => current.slice(0, -1));
  }, []);

  const undoAll = useCallback(() => {
    setTyped([]);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Backspace') {
        event.preventDefault();
        backspace();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        setBody(null);
        setVowel(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [backspace, commit]);

  return (
    <div className="ndk">
      {prompt ? <div className="ndk-prompt">{prompt}</div> : null}

      {!hideOutput ? (
        <div className="ndk-output" aria-live="polite">
          {/*
            The composed word, in real Unicode text with the Ndebe font — §10.3 requires text
            rather than images so it stays selectable, searchable and readable by assistive
            technology. The Latin is shown beneath because a screen reader cannot pronounce the
            script, which §12 requires us to provide.
          */}
          {typed.length === 0 ? (
            <span className="muted">Choose a body and a vowel to begin.</span>
          ) : (
            <>
              <span className="ndk-word" lang="ig">
                {typed.map((entry) => entry.character).join('')}
              </span>
              <span className="ndk-word-sr sr-only">
                {typed.map((entry) => `${entry.roman} ${entry.tone}`).join(', ')}
              </span>
              <span className="ndk-roman">{typed.map((entry) => entry.roman).join('-')}</span>
            </>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- step 1: body */}
      <div className="ndk-step">
        <span className="ndk-step-label">
          <b>1</b> Body
          {body !== null ? <em>{NDEBE_BODIES[body]!.join(' / ')}</em> : null}
        </span>
        <div className="ndk-bodies" role="group" aria-label="Consonant body">
          {/*
            Standalone vowels first. §9.1: "Standalone vowels have their own row." A learner typing
            `aka` needs the `a` on its own, and burying it at the end of a scroller of consonants
            would make the most common thing the hardest to reach.
          */}
          <button
            type="button"
            className={body === null ? 'ndk-key ndk-key-on' : 'ndk-key'}
            onClick={() => setBody(null)}
            aria-pressed={body === null}
          >
            vowel
          </button>
          {NDEBE_BODIES.map((alternatives, index) => (
            <button
              key={alternatives.join('-')}
              type="button"
              className={body === index ? 'ndk-key ndk-key-on' : 'ndk-key'}
              onClick={() => setBody(index)}
              aria-pressed={body === index}
            >
              {alternatives[0]}
              {/*
                A shared Latin reading is marked, because §6 Module 2 asks for exactly this: "Why
                some bodies share a Latin reading" and "Match Latin syllables to characters, with
                shared-reading cases flagged". `g` and `v` both being body 7 is not a typo in the
                chart and a learner who thinks it is will mistrust the whole grid.
              */}
              {alternatives.length > 1 ? <sup title={alternatives.join(' / ')}>+</sup> : null}
              {DIGRAPHS.has(alternatives[0]!) ? <i className="ndk-digraph" title="two letters, one body" /> : null}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------------------- step 2: vowel */}
      <div className="ndk-step">
        <span className="ndk-step-label">
          <b>2</b> Vowel
          {vowel !== null ? <em>{NDEBE_VOWELS[vowel]}</em> : null}
        </span>
        <div className="ndk-vowels" role="group" aria-label="Vowel">
          {NDEBE_VOWELS.map((entry, index) => (
            <button
              key={entry}
              type="button"
              className={vowel === index ? 'ndk-key ndk-key-on' : 'ndk-key'}
              onClick={() => setVowel(index)}
              aria-pressed={vowel === index}
            >
              {entry}
              {/* The dotted vowels are marked: §6 Module 2 names ẹ as the extra vowel and asks who uses it. */}
              {'ẹịọụ'.includes(entry) ? <i className="ndk-dotted" title="dotted vowel" /> : null}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------------------- step 3: tone */}
      <div className="ndk-step">
        <span className="ndk-step-label">
          <b>3</b> Tone
        </span>
        <div className="ndk-tones" role="group" aria-label="Tone">
          {NDEBE_TONES.map((entry) => (
            <button
              key={entry}
              type="button"
              className={tone === entry ? 'ndk-key ndk-key-on' : 'ndk-key'}
              onClick={() => setTone(entry)}
              aria-pressed={tone === entry}
            >
              {entry}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------------------- preview and commit */}
      <div className="ndk-commit">
        <div className="ndk-preview" aria-live="polite">
          {preview ? (
            <>
              <span className="ndk-glyph" lang="ig">
                {preview.character}
              </span>
              <span className="ndk-preview-roman">
                {preview.roman} <span className="muted">{tone}</span>
              </span>
            </>
          ) : (
            <span className="muted">
              {vowel === null ? 'Pick a vowel to see the character.' : 'Pick a body or “vowel”.'}
            </span>
          )}
        </div>
        <div className="ndk-commit-actions">
          <button type="button" className="button" onClick={commit} disabled={!preview}>
            Add syllable
          </button>
          <button type="button" className="button button-secondary" onClick={backspace} disabled={typed.length === 0}>
            Backspace
          </button>
          <button type="button" className="button button-secondary" onClick={undoAll} disabled={typed.length === 0}>
            Clear
          </button>
        </div>
      </div>

      {note ? (
        <p className="ndk-note" role="status">
          {note}
        </p>
      ) : null}

      {/*
        Copy, because a learner who has just written their name wants to put it somewhere. §9.2
        puts copy-and-export on the converter, and the same need applies here.
      */}
      {typed.length > 0 ? (
        <div className="ndk-copy">
          <button
            type="button"
            className="button button-secondary"
            onClick={async () => {
              const text = typed.map((entry) => entry.character).join('');
              try {
                await navigator.clipboard.writeText(text);
                setNote('Copied. It will paste as Ndebe if the font is installed.');
              } catch {
                // Clipboard access is refused in plenty of ordinary situations, so this is a
                // message rather than an error.
                setNote('This browser would not let us copy. Select the text above instead.');
              }
            }}
          >
            Copy
          </button>
          <span className="muted ndk-copy-hint">
            Pasting needs a Ndebe font installed on the device you paste into.
          </span>
        </div>
      ) : null}
    </div>
  );
}
