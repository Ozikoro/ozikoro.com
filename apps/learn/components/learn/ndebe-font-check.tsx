'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { NDEBE_TONES, syllableCodepoint } from '@ozituma/core';

/**
 * The font check — §9.3.
 *
 * WHY THIS IS THE FIRST THING IN THE COURSE
 *
 * §1 names the failure this prevents: learners finish setup "without giving up, which is where most
 * learners of a new script drop out." §16 repeats it as a risk. A learner who arrives, sees empty
 * boxes instead of characters, and is not told why has no way to distinguish "my device cannot draw
 * this" from "this site is broken" — and the reasonable response to the second is to leave.
 *
 * TWO CHECKS, AND ONLY ONE OF THEM DECIDES
 *
 * §9.3 asks for both: show a test string and ask, AND back it up with an automatic check "and use it
 * only to suggest, not to block."
 *
 * So the SELF-REPORT decides. A person looking at their own screen is the authority on what is on
 * it; no measurement can beat that. The automatic check is advisory, and it is deliberately weak: it
 * compares the rendered width of Ndebe text against the width of a character no font has, which
 * detects the specific case of "this fell back to a font with no Ndebe glyphs". It cannot detect a
 * font that has the glyphs but draws them badly, and it produces false alarms on a device whose
 * fallback font happens to be metrically similar.
 *
 * That asymmetry is why the automatic result never blocks. A learner told "your device is wrong"
 * when it is not, with no way to proceed, is worse off than one who was never measured.
 */

/**
 * The test string: all three tone forms of one syllable, computed rather than typed.
 *
 * Computed because a hardcoded string of Ndebe is invisible in every editor, diff and review that
 * lacks the font — including this repository. A literal here would be unverifiable by reading it,
 * and the first person to "fix" a mojibake would silently break the check. Deriving it from the
 * same constants the keyboard uses means it cannot drift from the script.
 *
 * All three tones rather than three arbitrary characters, because a device that has the font may
 * still draw the tone markers wrongly (§16: "stacked marks and missing glyphs"), and three forms of
 * one syllable is the smallest string that shows that.
 */
const TEST_STRING = NDEBE_TONES.map((_, tone) =>
  String.fromCodePoint(syllableCodepoint(0, 0, tone))
).join('');

/** A codepoint outside every font's coverage. If the fallback is drawing boxes, we match its width. */
const NO_SUCH_GLYPH = '\u{10FFFD}';

export function NdebeFontCheck() {
  const [answered, setAnswered] = useState<'yes' | 'no' | null>(null);
  const [autoDetected, setAutoDetected] = useState<boolean | null>(null);

  /*
   * The automatic check.
   *
   * Measure the test string in the Ndebe stack, and measure a codepoint nothing covers in the
   * SAME stack. If the two widths are identical, the browser is using one fallback font for both —
   * which means it found no Ndebe glyphs and drew boxes. If they differ, something in the stack
   * had real glyphs for the test string.
   *
   * Run in an effect rather than during render because it needs layout, and re-run once fonts have
   * loaded: `font-display: swap` means the first measurement can happen before the Ndebe font
   * arrives, which would report a false failure.
   */
  const measure = useCallback(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      // No canvas: skip the automatic check entirely rather than guessing. The self-report stands.
      setAutoDetected(null);
      return;
    }

    const stack = "'Ndebe Rounded', serif";
    context.font = `40px ${stack}`;
    const realWidth = context.measureText(TEST_STRING).width;
    const missingWidth = context.measureText(NO_SUCH_GLYPH).width;

    // Within half a pixel is the same drawing as far as a browser is concerned.
    setAutoDetected(Math.abs(realWidth - missingWidth) > 0.5);
  }, []);

  useEffect(() => {
    measure();
    if (typeof document !== 'undefined' && 'fonts' in document) {
      // Swap changes what is being measured, so measure again when the font settles.
      document.fonts.ready.then(measure).catch(() => undefined);
    }
  }, [measure]);

  return (
    <div className="ndebe-fontcheck">
      <p style={{ margin: 0 }}>
        <strong>First, a check.</strong> Not every device can draw Ndebe. Below are three real
        characters from the script — one syllable in its high, mid and low tone forms.
      </p>

      <div className="ndebe-fontcheck-test" lang="ig" aria-hidden="true">
        {TEST_STRING}
      </div>
      {/* A screen reader cannot pronounce the script, so it is told what these are. §12. */}
      <span className="sr-only">
        Three Ndebe characters used as a display test. If they do not appear, the device needs the
        font installed.
      </span>

      <p style={{ margin: 0 }}>
        <strong>Do you see three characters above, or empty boxes?</strong>
      </p>

      <div className="ndebe-fontcheck-actions">
        <button
          type="button"
          className={answered === 'yes' ? 'button' : 'button button-secondary'}
          onClick={() => setAnswered('yes')}
          aria-pressed={answered === 'yes'}
        >
          I see characters
        </button>
        <button
          type="button"
          className={answered === 'no' ? 'button' : 'button button-secondary'}
          onClick={() => setAnswered('no')}
          aria-pressed={answered === 'no'}
        >
          I see empty boxes
        </button>
      </div>

      {answered === 'yes' ? (
        <div className="notice" style={{ marginTop: 0 }}>
          <strong>Good — your device can draw the script.</strong>
          <p style={{ margin: '0.35rem 0 0' }}>
            It is worth knowing that this only means the Ndebe font loaded here. Pasting the
            characters somewhere else needs a Ndebe font on that device too.
          </p>
        </div>
      ) : null}

      {answered === 'no' ? (
        <div className="notice notice-warn" style={{ marginTop: 0 }}>
          <strong>That is a font problem, not a broken site — and you can still do the whole course.</strong>
          <p style={{ margin: '0.35rem 0 0.8rem' }}>
            Your device has no font that covers the script, so it draws an empty box for each
            character. The on-screen keyboard still works and still copies real Ndebe text; you just
            will not see it on this device until a Ndebe font is installed.
          </p>
          <div className="learn-actions">
            <Link className="button" href="/ndebe/keyboard">
              Use the keyboard anyway
            </Link>
          </div>
        </div>
      ) : null}

      {/*
        The automatic result, shown as a suggestion. §9.3 is explicit that it must not block, so it
        is rendered as a note and never as a gate on proceeding.
      */}
      {answered !== null && autoDetected !== null ? (
        <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>
          {autoDetected
            ? 'Our measurement agreed: the characters were drawn with real glyphs.'
            : 'Our measurement could not find Ndebe glyphs on this device, which matches what you reported. This is only a suggestion — you can go on either way.'}
        </p>
      ) : null}
    </div>
  );
}
