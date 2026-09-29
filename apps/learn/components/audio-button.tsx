'use client';

import { useRef, useState } from 'react';

/**
 * A small play/pause control, sized to the text it sits beside.
 *
 * The dialect recordings used to be a full <audio controls> widget — a
 * transport bar with a scrubber, a volume slider and a timer, rendered inline
 * in a list. For a two-second recording of a single word that is a lot of
 * chrome for one action, and it made the dialect list read as a column of
 * media players rather than a column of spellings. This is the one control
 * that is actually needed, at the size of the word it belongs to.
 *
 * It also reports failure. The previous widget showed "0:00 / 0:00" when the
 * file did not load, which is indistinguishable from a recording that has not
 * buffered yet, so a broken media URL looked like a slow one. This says so.
 */
export function AudioButton({
  src,
  label,
  className,
}: {
  src: string;
  /** Spoken description, e.g. "Play the recording of ala". */
  label: string;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'playing' | 'failed'>('idle');

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (state === 'playing') {
      el.pause();
      el.currentTime = 0;
      setState('idle');
      return;
    }
    try {
      await el.play();
      setState('playing');
    } catch {
      // play() rejects both when the source cannot be fetched and when the
      // browser blocks autoplay; only the first is worth telling the reader
      // about, and a blocked play still leaves the control usable.
      setState(el.error ? 'failed' : 'idle');
    }
  }

  if (state === 'failed') {
    return (
      <span className={`audio-button audio-button-failed ${className ?? ''}`} title="The recording could not be loaded">
        recording unavailable
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`audio-button ${className ?? ''}`}
        onClick={toggle}
        aria-label={label}
        title={label}
      >
        <span aria-hidden="true">{state === 'playing' ? '❚❚' : '▶'}</span>
      </button>
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onEnded={() => setState('idle')}
        onError={() => setState('failed')}
      />
    </>
  );
}
