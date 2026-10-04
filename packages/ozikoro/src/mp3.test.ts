/**
 * Measuring an MP3's length, and the two things that make the obvious answer wrong.
 *
 * WHY THIS FILE EXISTS
 *
 * The archive stored a duration it had never measured. `duration_seconds` was written from
 * `estimateNarrationSeconds` — the word count divided by 145 — and shown to the owner as the length of the
 * audio. **It read 10m 36s for a file that is 8m 22s**, and the number was believed for as long as nobody
 * checked, which is the same fault as the twelve pages that returned 200 and were unusable.
 *
 * A frame walk replaces the estimate, and a frame walk has exactly two traps in it. **Both were fallen into
 * while writing it**, and both are asserted below rather than described:
 *
 *   1. THE BITRATE TABLE IS KEYED BY LAYER NUMBER, NOT BY THE HEADER'S RAW BITS. The header stores `01` for
 *      Layer III, so raw bits `1` is the THIRD layer. The first attempt keyed the tables as though `1` were
 *      Layer I, read a 128 kbps file as 288 kbps, advanced ~940 bytes per frame instead of 417, and measured
 *      a 502 s file as 187 s. It looked like a plausible number.
 *   2. A LEADING `Info` FRAME IS NOT AUDIO, AND A SECOND SEGMENT CAN START MID-FILE. `speak()` joins its
 *      chunks with `Buffer.concat` and each chunk arrives as a whole MP3 with its own tag, so a two-chunk
 *      render has an `ID3v2` tag at byte 0 and ANOTHER in the middle. The folklore episode is exactly that:
 *      407.771 s + 126.041 s = 533.812 s, where `afinfo` reports only the first segment.
 *
 * The fixtures are built by hand so the expected duration is arithmetic rather than a recording — a test that
 * needed a real 8 MB file could not say what the right answer was either.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mp3DurationSeconds } from './mp3.ts';

/** MPEG 1 Layer III, 128 kbps, 44.1 kHz, mono — the header ElevenLabs returns, read from a real file. */
const FRAME_BYTES = 417;
/** 1152 samples per frame at 44.1 kHz. */
const FRAME_SECONDS = 1152 / 44100;

function frame(marker?: 'Xing' | 'Info'): Uint8Array {
  const bytes = new Uint8Array(FRAME_BYTES);
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  bytes[2] = 0x90;
  bytes[3] = 0xc0;
  if (marker) {
    // MPEG 1 mono puts the side information at 17 bytes, so the marker sits at byte 21 of the frame.
    for (let i = 0; i < marker.length; i++) bytes[21 + i] = marker.charCodeAt(i);
  }
  return bytes;
}

function id3(size: number): Uint8Array {
  const bytes = new Uint8Array(10 + size);
  bytes[0] = 0x49; bytes[1] = 0x44; bytes[2] = 0x33; // "ID3"
  bytes[3] = 4; bytes[4] = 0; bytes[5] = 0;
  // Four 7-bit synchsafe bytes.
  bytes[6] = (size >> 21) & 0x7f;
  bytes[7] = (size >> 14) & 0x7f;
  bytes[8] = (size >> 7) & 0x7f;
  bytes[9] = size & 0x7f;
  return bytes;
}

function join(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function audio(count: number): Uint8Array {
  return join(...Array.from({ length: count }, () => frame()));
}

test('a stream of frames measures by the frame, not by the byte count', () => {
  const got = mp3DurationSeconds(audio(100));
  assert.notEqual(got, null);
  assert.ok(Math.abs((got as number) - 100 * FRAME_SECONDS) < 1e-6, `expected ${100 * FRAME_SECONDS}, got ${got}`);
});

test('a leading ID3v2 tag is metadata and is not counted as audio', () => {
  const withTag = mp3DurationSeconds(join(id3(35), audio(100)));
  const without = mp3DurationSeconds(audio(100));
  assert.equal(withTag, without, 'the tag changed the measured length');
});

test('a leading Info frame is skipped, because it summarises the stream rather than being part of it', () => {
  const withInfo = mp3DurationSeconds(join(frame('Info'), audio(100)));
  assert.ok(withInfo !== null);
  assert.ok(
    Math.abs((withInfo as number) - 100 * FRAME_SECONDS) < 1e-6,
    `the Info frame was counted as audio: got ${withInfo}, expected ${100 * FRAME_SECONDS}`,
  );
});

test('a second segment in the middle of the file is measured too, not stopped at', () => {
  /*
   * This is the folklore episode's shape: `Buffer.concat` of two chunks, each a complete MP3. The length is the
   * SUM, and a reader that stops at the embedded tag reports only the first half — which is what `afinfo`
   * does, and what made the two tools disagree by 126 seconds on a real file.
   */
  const twoSegments = join(id3(35), frame('Info'), audio(100), id3(35), frame('Info'), audio(200));
  const got = mp3DurationSeconds(twoSegments);
  assert.ok(got !== null);
  assert.ok(
    Math.abs((got as number) - 300 * FRAME_SECONDS) < 1e-6,
    `expected both segments to count: got ${got}, expected ${300 * FRAME_SECONDS}`,
  );
  // Stated separately, because "the second segment was included" is the whole assertion.
  assert.ok((got as number) > 200 * FRAME_SECONDS);
});

test('bytes that are not an MP3 measure as nothing rather than as zero', () => {
  assert.equal(mp3DurationSeconds(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
  assert.equal(mp3DurationSeconds(new Uint8Array(0)), null);
});

test('a single frame is not a recording', () => {
  assert.equal(mp3DurationSeconds(frame('Info')), null);
  assert.equal(mp3DurationSeconds(frame()), null);
});
