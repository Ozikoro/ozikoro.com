/**
 * How long an MP3 actually is, measured from the file rather than predicted from its text.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 *
 * **The archive told the owner an episode was 10m 36s long and the audio was 8m 22s.** The figure came from
 * `estimateNarrationSeconds`, which divides the word count by 145 — a *prediction* — and it was written into
 * `duration_seconds`, a column that reads as a measurement, and shown to a reader under the player as though
 * it were one. **A number that describes the thing rather than the thing itself, presented as the reading.**
 *
 * That is the same fault as the twelve pages that returned 200 and were unusable: every part of the record was
 * correct except that nobody had looked. So the duration is now taken from the rendered file.
 *
 * **And it is worth knowing what the wrong figure was hiding.** At the default narration speed the render was
 * 183.9 words per minute and the estimate assumed 145, so the prediction understated the length by a quarter
 * while the reader heard a narration a third too fast. The two faults described each other, and neither was
 * visible while the number was invented.
 *
 * ── HOW IT MEASURES ──────────────────────────────────────────────────────────────────────────────
 *
 * An MP3 is a sequence of self-describing frames. Each frame header states its own bitrate, sample rate and
 * layer, so **the duration is the sum of the frames' own lengths and needs no bitrate assumption at all** —
 * which matters, because a constant-bitrate assumption would be a second prediction of the same kind this
 * function exists to remove, and it is simply wrong for a VBR file.
 *
 * `afinfo` was the reference while this was written and the two agree exactly on all five files to hand: the
 * owner's recording is 25,494 frames here and 25,494 audio packets in `afinfo`, both 665.966 s. The frame count
 * matches because a leading `Xing`/`Info` frame is counted as a frame — the same convention `afinfo` uses.
 *
 * Returns `null` rather than a guess when the bytes cannot be read as MP3 at all. **A caller that cannot
 * measure must be able to say it could not measure**, rather than fall back to a number indistinguishable
 * from a real one.
 */

/*
 * THE TABLES ARE KEYED BY LAYER NUMBER (I, II, III) AND NOT BY THE HEADER'S RAW BITS.
 *
 * The two are inverses: the header stores `11` for Layer I and `01` for Layer III, so raw bits `1` means Layer
 * III. **This was got wrong on the first attempt here** — the table was keyed as though `1` were Layer I, so a
 * 128 kbps Layer III file was read as 288 kbps, each frame was advanced ~940 bytes instead of 418, and the
 * measurement came back at 187 s for a 502 s file. Every layer is converted to its number once, below, so the
 * tables and the sample-rate rule cannot disagree about which layer they are describing.
 */

/** Bitrates in kbps by layer number, indexed by the header's 4-bit bitrate index. 0 is "free", 15 is invalid. */
const BITRATES_MPEG1: Record<1 | 2 | 3, readonly number[]> = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
};

/** MPEG 2 and 2.5 share one bitrate table for Layers II and III. */
const BITRATES_MPEG2: Record<1 | 2 | 3, readonly number[]> = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/** Version bits: 0 is MPEG 2.5, 2 is MPEG 2, 3 is MPEG 1. 1 is reserved and refuses the frame. */
const SAMPLE_RATES: Record<0 | 2 | 3, readonly number[]> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};

/**
 * The duration of `bytes` in seconds, or `null` when they are not an MP3 this can read.
 *
 * Walks the frames rather than searching for a sync word, so a byte pair inside audio data that happens to
 * look like a frame header cannot be mistaken for one: the walk only ever lands on offsets a previous frame
 * said to land on.
 *
 * ── TWO THINGS AN `Info` FRAME AND A SECOND TAG MADE NECESSARY, BOTH MEASURED ────────────────────
 *
 * **A leading `Xing`/`Info` frame is not audio.** It is the encoder's summary of the stream — frame count,
 * byte count, seek table — and it occupies one frame's worth of bytes. Counting it makes every file 26 ms too
 * long, and skipping it is what makes this agree with `afinfo` to the millisecond on the files measured:
 * `afinfo` called the Ute-Okpu episode 501.812 s and the `Info` frame declares 19,210 frames, which is
 * 501.812 s exactly. `afinfo` reads the declaration; this reads the frames; they agree because both exclude it.
 *
 * **An `ID3v2` tag can appear in the MIDDLE of a file, and in this archive one does.** `speak()` joins its
 * chunks with `Buffer.concat`, and each chunk comes back as a whole MP3 with its own tag and its own `Info`
 * frame — so a two-chunk render has a tag at byte 0 and another in the middle. The folklore collection is
 * exactly that: tags at 0 and 6,524,804, declaring 15,610 frames (407.771 s) and 4,825 (126.041 s). **The real
 * playable length is the sum, 533.812 s — and `afinfo` reports only 407.771 s, because it stops at the second
 * tag.** So here the frame walk is right and `afinfo` is wrong, which is only knowable because both numbers
 * were read rather than one of them trusted.
 *
 * A tag is skipped wherever it appears rather than only at offset 0, and that is also what keeps the walk
 * linear instead of degrading into a byte-at-a-time search over eight megabytes.
 */
/**
 * One byte, or zero.
 *
 * `noUncheckedIndexedAccess` is on in this repository, and it is right to be: every read below is bounds-checked
 * by the loop before it is used, but the compiler cannot see that, and the alternative — `!` on fifteen reads —
 * is how a real out-of-range read eventually hides. A missing byte is a byte that failed the sync test, which
 * is the same answer either way.
 */
function at(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

export function mp3DurationSeconds(bytes: Uint8Array): number | null {
  const tagLengthAt = (where: number): number => {
    if (where + 10 > bytes.length) return 0;
    if (at(bytes, where) !== 0x49 || at(bytes, where + 1) !== 0x44 || at(bytes, where + 2) !== 0x33) return 0;
    // Four 7-bit "synchsafe" bytes, so the top bit of each is dropped. Read as a normal big-endian integer
    // this overstates the tag and eats audio.
    const size = ((at(bytes, where + 6) & 0x7f) << 21) | ((at(bytes, where + 7) & 0x7f) << 14)
      | ((at(bytes, where + 8) & 0x7f) << 7) | (at(bytes, where + 9) & 0x7f);
    const footer = (at(bytes, where + 5) & 0x10) !== 0 ? 10 : 0;
    return 10 + size + footer;
  };

  let offset = tagLengthAt(0);
  let seconds = 0;
  let frames = 0;
  /*
   * True at the start of the stream and again immediately after any tag, which is exactly where each
   * concatenated segment begins. That is the only place a `Xing`/`Info` summary frame can stand.
   */
  let atSegmentStart = true;

  while (offset + 4 <= bytes.length) {
    const tag = tagLengthAt(offset);
    if (tag > 0) {
      offset += tag;
      atSegmentStart = true;
      continue;
    }

    // Sync word: eleven set bits.
    if (at(bytes, offset) !== 0xff || (at(bytes, offset + 1) & 0xe0) !== 0xe0) {
      // Not a frame boundary. Step one byte and look again rather than giving up on the rest of the file.
      offset += 1;
      continue;
    }

    const versionBits = (at(bytes, offset + 1) >> 3) & 0x03;
    const rawLayer = (at(bytes, offset + 1) >> 1) & 0x03;
    if (versionBits === 1 || rawLayer === 0) {
      offset += 1;
      continue;
    }
    // The header's raw bits are the inverse of the layer's number: `01` is Layer III.
    const layer = (4 - rawLayer) as 1 | 2 | 3;

    const bitrateIndex = (at(bytes, offset + 2) >> 4) & 0x0f;
    const sampleRateIndex = (at(bytes, offset + 2) >> 2) & 0x03;
    const padding = (at(bytes, offset + 2) >> 1) & 0x01;
    if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset += 1;
      continue;
    }

    const table = versionBits === 3 ? BITRATES_MPEG1 : BITRATES_MPEG2;
    const bitrate = (table[layer]?.[bitrateIndex] ?? 0) * 1000;
    const sampleRate = SAMPLE_RATES[versionBits as 0 | 2 | 3]?.[sampleRateIndex] ?? 0;
    if (bitrate === 0 || sampleRate === 0) {
      offset += 1;
      continue;
    }

    // Layer I holds 384 samples per frame; Layer III halves its frame under MPEG 2 and 2.5.
    const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : versionBits === 3 ? 1152 : 576;

    const frameLength = layer === 1
      ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
      : Math.floor((samplesPerFrame / 8) * (bitrate / sampleRate)) + padding;

    if (frameLength <= 4) {
      offset += 1;
      continue;
    }

    /*
     * The header frame of each segment is the encoder's summary, not audio. It is skipped only at a segment's
     * start, where a `Xing`/`Info` marker stands where the side information would be: MPEG 1 mono puts it at
     * byte 21 of the frame, MPEG 1 stereo at 36, and the MPEG 2 forms at 13 and 21. A frame that merely
     * happens to contain those four bytes later in the stream is left alone.
     */
    if (atSegmentStart) {
      const mono = (at(bytes, offset + 3) >> 6) === 3;
      const sideInfo = versionBits === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
      const marker = String.fromCharCode(
        at(bytes, offset + 4 + sideInfo), at(bytes, offset + 5 + sideInfo),
        at(bytes, offset + 6 + sideInfo), at(bytes, offset + 7 + sideInfo),
      );
      if (marker === 'Xing' || marker === 'Info') {
        offset += frameLength;
        atSegmentStart = false;
        continue;
      }
    }
    atSegmentStart = false;

    seconds += samplesPerFrame / sampleRate;
    frames += 1;
    offset += frameLength;
  }

  // One frame is not a recording; it is a false sync or a fragment.
  return frames > 1 ? seconds : null;
}
