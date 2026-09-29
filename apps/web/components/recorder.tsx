'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pronunciation recorder, with a live waveform.
 *
 * THE BUG THIS FIXES
 *
 * The owner, twice: "on the voice recording you already added, it seems not to function properly"
 * and then precisely — "when i record, it does not grab the voice, so when i play it, it does not
 * play anything, which means it did not record my voice."
 *
 * He was right, and the cause was one line. `MediaRecorder.stop()` is asynchronous: it finishes
 * the current blob, fires a final `dataavailable`, and only then fires `stop`. The old code called
 * `stopTracks()` — which ends the microphone's audio tracks — on the very next line:
 *
 *     recorderRef.current?.stop();
 *     stopTracks();                    // <- the stream dies before the flush
 *
 * Ending the track while the recorder is still finishing means the last chunk never arrives, so
 * `chunksRef` was empty, the Blob was zero bytes, and the preview played silence. Nothing checked
 * the size, so the component then said "recorded" and offered Submit. The same order appeared in
 * the 120-second auto-stop, so a long recording failed the same way.
 *
 * The fix is to stop the tracks where the recorder says it has finished, in `onstop`, and never
 * before. A zero-byte result is now reported as what it is rather than presented as a recording.
 *
 * WHY A TIMESLICE
 *
 * `start()` with no argument buffers everything until stop. `start(250)` hands over a chunk four
 * times a second, which is what makes the waveform and the level meter possible, and it means a
 * recording that is interrupted still has audio in hand rather than losing all of it.
 *
 * THE WAVEFORM
 *
 * An `AnalyserNode` on the same stream, drawn to a canvas on every animation frame. It is not
 * decoration: the point of it is that a person can SEE that the microphone is hearing them before
 * they submit, which is exactly the doubt that produced this report. The level meter underneath
 * says so in words when the trace stays flat — the microphone is open but nothing is reaching it,
 * which is a different problem from a broken recorder and has a different fix.
 *
 * Progressive enhancement is unchanged: the submit path is a plain multipart POST, and the file
 * input still works when the microphone is refused or unsupported.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SECONDS = 120;

/** How often the recorder hands over audio. Also the waveform's refresh granularity. */
const TIMESLICE_MS = 250;

type RecorderState = 'idle' | 'requesting' | 'recording' | 'recorded' | 'blocked' | 'unsupported';

export function PronunciationRecorder({
  wordId,
  language,
  dialects,
}: {
  wordId: number;
  language: string;
  dialects: { code: string; name: string }[];
}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [heard, setHeard] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const heardRef = useRef(false);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const durationRef = useRef(0);

  const stopVisualiser = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    analyserRef.current = null;
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Release everything on unmount, so a page left behind does not keep the
  // recording indicator on or hold the microphone open.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopVisualiser();
      stopTracks();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl, stopTracks, stopVisualiser]);

  function clearTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  /**
   * Draw the microphone's own signal.
   *
   * The analyser is connected to nothing downstream on purpose: routing it to the destination
   * would play the speaker's voice back into their own ears.
   */
  function startVisualiser(stream: MediaStream) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const context = new Ctor();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.fftSize);

    const draw = () => {
      const canvas = canvasRef.current;
      const node = analyserRef.current;
      if (!canvas || !node) return;

      node.getByteTimeDomainData(data);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        // A centre line, so a silent recording looks like a flat line rather than an empty box.
        ctx.strokeStyle = 'rgba(120, 113, 108, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const step = width / data.length;
        for (let i = 0; i < data.length; i += 1) {
          const value = (data[i] as number) - 128;
          const x = i * step;
          const y = height / 2 + (value / 128) * (height / 2) * 0.92;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Anything above a low floor counts as sound: a quiet speaker still moves the trace.
      let peak = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = Math.abs((data[i] as number) - 128);
        if (value > peak) peak = value;
      }
      if (peak > 3 && !heardRef.current) {
        heardRef.current = true;
        setHeard(true);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    draw();
  }

  async function startRecording() {
    setError(null);
    setHeard(false);
    heardRef.current = false;

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }

    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      startVisualiser(stream);

      // Let the browser pick its container rather than forcing one: Chromium records
      // WebM/Opus, Safari records MP4/AAC, and forcing a type the browser cannot produce fails.
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      durationRef.current = 0;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      /*
       * The tracks are stopped HERE, not at the call site.
       *
       * This is the whole fix. `stop()` is asynchronous and the final chunk arrives in this
       * handler; ending the microphone first threw that chunk away and produced an empty file.
       */
      recorder.onstop = () => {
        clearTimer();
        stopVisualiser();
        stopTracks();

        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });

        if (blob.size === 0) {
          setError(
            'The recorder finished but no audio was captured. Check which microphone the browser is using, then try again — or upload a file instead.'
          );
          setState('idle');
          return;
        }
        if (blob.size > MAX_BYTES) {
          setError(
            `That recording is ${Math.round(blob.size / 1024)} KB. The limit is ${Math.round(MAX_BYTES / 1024)} KB — try a shorter clip.`
          );
          setState('idle');
          return;
        }

        fileRef.current = new File([blob], `recording.${type.includes('mp4') ? 'm4a' : 'webm'}`, {
          type,
        });
        setPreviewUrl(URL.createObjectURL(blob));
        setState('recorded');
      };

      recorder.onerror = () => {
        clearTimer();
        stopVisualiser();
        stopTracks();
        setError('The recorder stopped with an error. Try again, or upload a file instead.');
        setState('idle');
      };

      // A timeslice, so audio arrives while recording rather than only at the end.
      recorder.start(TIMESLICE_MS);
      setState('recording');
      setSeconds(0);
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setSeconds(durationRef.current);
        if (durationRef.current >= MAX_SECONDS) {
          // Stop the recorder only. The tracks follow in `onstop`, once the audio is in hand.
          recorderRef.current?.stop();
          clearTimer();
        }
      }, 1000);
    } catch {
      setState('blocked');
      setError(
        'Microphone access was refused. You can still upload an audio file if you have one.'
      );
    }
  }

  function stopRecording() {
    clearTimer();
    // No stopTracks() here — `onstop` runs it after the last chunk has arrived.
    recorderRef.current?.stop();
  }

  function reset() {
    fileRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSeconds(0);
    durationRef.current = 0;
    setHeard(false);
    heardRef.current = false;
    setState('idle');
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError(null);
    if (!file) {
      reset();
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `That file is ${Math.round(file.size / 1024)} KB. The limit is ${Math.round(MAX_BYTES / 1024)} KB.`
      );
      event.target.value = '';
      return;
    }
    fileRef.current = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setState('recorded');
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // The form posts anyway; this only guards the case where no file was chosen.
    if (!fileRef.current) {
      event.preventDefault();
      setError('Record or choose a file first.');
      return;
    }
    setSubmitting(true);
  }

  return (
    <form
      method="post"
      action="/api/audio"
      encType="multipart/form-data"
      onSubmit={onSubmit}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <input type="hidden" name="wordId" value={wordId} />
      <input type="hidden" name="language" value={language} />
      {durationRef.current > 0 ? (
        <input type="hidden" name="durationMs" value={seconds * 1000} />
      ) : null}

      {dialects.length > 0 ? (
        <div>
          <label htmlFor="dialectCode">Dialect (optional)</label>
          <select
            id="dialectCode"
            name="dialectCode"
            className="search-input"
            style={{ width: '100%', maxWidth: '22rem' }}
            defaultValue=""
          >
            <option value="">Not dialect-specific</option>
            {dialects.map((dialect) => (
              <option key={dialect.code} value={dialect.code}>
                {dialect.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {state === 'idle' || state === 'blocked' || state === 'unsupported' ? (
          <button type="button" className="button" onClick={startRecording}>
            {state === 'idle' ? 'Record pronunciation' : 'Try the microphone again'}
          </button>
        ) : null}

        {state === 'requesting' ? (
          <span className="muted">Waiting for microphone permission…</span>
        ) : null}

        {state === 'recording' ? (
          <>
            <button type="button" className="button" onClick={stopRecording}>
              Stop ({MAX_SECONDS - seconds}s left)
            </button>
            <span className="chip chip-common">
              <span aria-hidden="true">●</span> recording {seconds}s
            </span>
          </>
        ) : null}

        {state === 'recorded' ? (
          <>
            <button type="button" className="button button-secondary" onClick={reset}>
              Discard and re-record
            </button>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? 'Uploading…' : 'Submit for review'}
            </button>
          </>
        ) : null}
      </div>

      {/*
        The waveform, and the sentence that makes it useful.
        `aria-hidden` because a moving canvas says nothing to a screen reader; the text below
        carries the same information.
      */}
      {state === 'recording' ? (
        <div>
          <canvas
            ref={canvasRef}
            width={640}
            height={96}
            aria-hidden="true"
            style={{
              width: '100%',
              maxWidth: '22rem',
              height: '3.5rem',
              border: '1px solid var(--line)',
              borderRadius: '2px',
              background: 'var(--paper)',
            }}
          />
          <p
            className="muted"
            style={{ fontSize: '0.85rem', margin: '0.35rem 0 0' }}
            role="status"
          >
            {heard
              ? 'The microphone is hearing you. Speak the word, then stop.'
              : 'Listening… say the word now. If this line does not change, check which microphone the browser is using.'}
          </p>
        </div>
      ) : null}

      {previewUrl ? (
        <audio controls src={previewUrl} style={{ width: '100%', maxWidth: '22rem' }}>
          Your browser does not support audio playback.
        </audio>
      ) : null}

      {/* The fallback path, and the source of truth for what gets uploaded. */}
      <div>
        <label htmlFor="file">
          {state === 'unsupported' || state === 'blocked'
            ? 'Choose an audio file'
            : 'Or upload a file instead'}
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept="audio/*"
          ref={inputRef}
          onChange={onFilePicked}
          className="search-input"
          style={{ width: '100%' }}
        />
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
          WebM, Ogg, MP3, WAV or M4A, up to {Math.round(MAX_BYTES / 1024 / 1024)} MB.
        </p>
      </div>

      <div>
        <label htmlFor="provenanceNote">Note for the reviewer (optional)</label>
        <input
          id="provenanceNote"
          name="provenanceNote"
          maxLength={1000}
          className="search-input"
          style={{ width: '100%' }}
          placeholder="Which dialect or town is this from?"
        />
      </div>

      {error ? (
        <div className="notice notice-warn" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}
