/**
 * Converting audio into the one format the local model can read without an external binary.
 *
 * WHY CONVERSION IS NOT OPTIONAL HERE
 *
 * F5-TTS preprocesses the reference clip with `pydub`, which shells out to **ffmpeg**. This machine has
 * no ffmpeg — `which ffmpeg` is empty, there is no Homebrew, and the install would need a compiler
 * toolchain and a writable `/usr/local`. pydub says so itself on import:
 *
 *     RuntimeWarning: Couldn't find ffmpeg or avconv - defaulting to ffmpeg, but may not work
 *
 * **A reference clip in an uncompressed WAV needs no decoder**, so conversion at registration time
 * removes the dependency from the synthesis path entirely. Registration is once per voice; synthesis is
 * every request. Paying the conversion cost once is the difference between "works on this machine" and
 * "works if you install Homebrew".
 *
 * WHAT DOES THE CONVERTING
 *
 * macOS ships `/usr/bin/afconvert`, which is the system's own audio converter and needs nothing
 * installed. It reads M4A/AAC, MP3 and WAV, and writes the 24 kHz mono little-endian 16-bit WAV that
 * F5-TTS wants. On a Linux host, `ffmpeg` is used instead if present — the same command shape, so the
 * service is not macOS-only.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { MediaError } from './errors.ts';

const run = promisify(execFile);

/** The rate F5-TTS was trained at. Resampling to anything else is a resynthesis it cannot undo. */
export const TARGET_SAMPLE_RATE = 24_000;

const AFCONVERT = '/usr/bin/afconvert';

function which(binary: string): string | null {
  for (const dir of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/bin']) {
    const candidate = join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export type ConvertResult = {
  /** Absolute path to the converted 24 kHz mono WAV. */
  path: string;
  /** True when the source was already in the target format and nothing was rewritten. */
  passthrough: boolean;
  converter: 'afconvert' | 'ffmpeg' | 'none';
  /** The `afinfo`-reported duration in seconds, or null when it could not be read. */
  durationSeconds: number | null;
};

/**
 * Read a WAV's duration from its own header.
 *
 * Deliberately arithmetic on the file rather than a call to `afinfo`: this has to work on a Linux host
 * too, and the header of an uncompressed PCM WAV states the sample rate and the data length exactly.
 * Only the `fmt ` and `data` chunks are used; anything else is skipped, so a `LIST` chunk from an editor
 * does not shift the numbers.
 */
export function wavDurationSeconds(path: string): number | null {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let byteRate: number | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      byteRate = buf.readUInt32LE(body + 8);
    } else if (id === 'data') {
      if (byteRate === null || byteRate === 0) return null;
      const available = Math.min(size, buf.length - body);
      return available / byteRate;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  return null;
}

/** Read a WAV's sample rate and channel count, so a mismatched reference is caught before synthesis. */
export function wavFormat(path: string): { sampleRate: number; channels: number; bits: number } | null {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buf.length) {
      return {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/**
 * Convert any readable audio file to 24 kHz mono PCM-16 WAV, or refuse with the reason.
 *
 * The refusal matters more than the conversion: `afconvert` failing on an unrecognised container
 * produces an empty or truncated output file, and **a zero-length reference clip would otherwise reach
 * the model and produce a voice conditioned on nothing.** So the output is checked for a real WAV header
 * and a non-zero duration before it is returned.
 */
export async function toModelWav(sourcePath: string, outDir: string): Promise<ConvertResult> {
  if (!existsSync(sourcePath)) {
    throw new MediaError({
      code: 'bad_request',
      message: `reference audio not found: ${sourcePath}`,
      status: 400,
    });
  }

  mkdirSync(outDir, { recursive: true });
  const sourceExt = extname(sourcePath).toLowerCase();
  const outPath = join(outDir, `${basename(sourcePath, sourceExt).replace(/[^\w.-]+/g, '_')}.24k.wav`);

  // An existing 24 kHz mono PCM file is already what the model wants. Rewriting it would be a needless
  // second generation of lossy resampling.
  if (sourceExt === '.wav') {
    const format = wavFormat(sourcePath);
    if (format && format.sampleRate === TARGET_SAMPLE_RATE && format.channels === 1 && format.bits === 16) {
      return {
        path: sourcePath,
        passthrough: true,
        converter: 'none',
        durationSeconds: wavDurationSeconds(sourcePath),
      };
    }
  }

  const hasAfconvert = existsSync(AFCONVERT);
  const ffmpeg = which('ffmpeg');

  if (!hasAfconvert && !ffmpeg) {
    throw new MediaError({
      code: 'bad_request',
      message:
        `cannot read ${sourceExt} audio on this host: no converter available. ` +
        `Install ffmpeg, or supply the reference clip as 24 kHz mono PCM WAV.`,
      status: 400,
      details: { source: sourcePath, lookedFor: [AFCONVERT, 'ffmpeg'] },
    });
  }

  try {
    if (hasAfconvert) {
      // -f WAVE, -d LEI16@24000 (little-endian int16 at 24 kHz), -c 1 (mono).
      await run(AFCONVERT, ['-f', 'WAVE', '-d', `LEI16@${TARGET_SAMPLE_RATE}`, '-c', '1', sourcePath, outPath]);
    } else {
      await run(ffmpeg as string, [
        '-y', '-loglevel', 'error',
        '-i', sourcePath,
        '-ar', String(TARGET_SAMPLE_RATE),
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        outPath,
      ]);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MediaError({
      code: 'render_failed',
      message: `audio conversion failed for ${basename(sourcePath)}: ${message}`,
      status: 400,
      details: { source: sourcePath, converter: hasAfconvert ? 'afconvert' : 'ffmpeg' },
    });
  }

  const duration = wavDurationSeconds(outPath);
  const format = wavFormat(outPath);
  if (!format || duration === null || duration <= 0) {
    rmSync(outPath, { force: true });
    throw new MediaError({
      code: 'render_failed',
      message:
        `audio conversion produced no usable audio from ${basename(sourcePath)}. ` +
        `A reference clip of zero length would condition the voice on nothing, so it was rejected rather than stored.`,
      status: 400,
      details: { source: sourcePath, output: outPath, wavFormat: format, durationSeconds: duration },
    });
  }

  return {
    path: outPath,
    passthrough: false,
    converter: hasAfconvert ? 'afconvert' : 'ffmpeg',
    durationSeconds: duration,
  };
}

/**
 * Join PCM WAV files into one, sample-rate and channel checked.
 *
 * The local engine renders chunk by chunk, because a flow-matching model on this CPU cannot hold a
 * whole article in one pass. **The join is arithmetic on PCM data and not a container remux:** the
 * outputs are uncompressed little-endian 16-bit WAV from the same model at the same rate, so the
 * samples simply follow one another. A remux through ffmpeg would be the usual choice and is
 * unavailable here anyway — and concatenating *compressed* frames, which is what MP3 would require, is
 * a different and more delicate operation that this deliberately does not attempt.
 *
 * A rate or channel mismatch is an error, not something to paper over: it would mean two chunks came
 * from different models or settings, and the seam would be audible.
 */
export function concatWavs(paths: string[]): Buffer {
  if (paths.length === 0) throw new Error('concatWavs: no inputs');
  if (paths.length === 1) return readFileSync(paths[0]!);

  const buffers = paths.map((p) => readFileSync(p));
  const formats = paths.map((p) => wavFormat(p));

  const first = formats[0];
  if (!first) throw new Error(`concatWavs: ${basename(paths[0]!)} is not a readable WAV`);
  for (let i = 1; i < formats.length; i++) {
    const f = formats[i];
    if (!f) throw new Error(`concatWavs: ${basename(paths[i]!)} is not a readable WAV`);
    if (f.sampleRate !== first.sampleRate || f.channels !== first.channels || f.bits !== first.bits) {
      throw new Error(
        `concatWavs: chunk ${i + 1} is ${f.sampleRate}Hz/${f.channels}ch/${f.bits}bit but chunk 1 is ` +
          `${first.sampleRate}Hz/${first.channels}ch/${first.bits}bit — the pieces did not come from one render`,
      );
    }
  }

  const dataParts: Buffer[] = [];
  for (const buf of buffers) {
    // Walk the chunks rather than assuming a 44-byte header: a WAV written by a different tool may
    // carry a LIST/INFO chunk before `data`, and reading from offset 44 would splice that metadata into
    // the audio as a burst of noise.
    let offset = 12;
    let found = false;
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      const body = offset + 8;
      if (id === 'data') {
        dataParts.push(buf.subarray(body, body + Math.min(size, buf.length - body)));
        found = true;
        break;
      }
      offset = body + size + (size % 2);
    }
    if (!found) throw new Error('concatWavs: a WAV had no data chunk');
  }

  const payload = Buffer.concat(dataParts);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + payload.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(first.channels, 22);
  header.writeUInt32LE(first.sampleRate, 24);
  const byteRate = first.sampleRate * first.channels * (first.bits / 8);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(first.channels * (first.bits / 8), 32); // block align
  header.writeUInt16LE(first.bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(payload.length, 40);

  return Buffer.concat([header, payload]);
}

/** A scratch directory for one render. Kept under the OS temp dir, which is writable here. */
export function scratchDir(prefix = 'ozikoro-media'): string {
  const dir = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write bytes somewhere and return the path — used to hand an uploaded clip to the converter. */
export function writeTemp(dir: string, name: string, data: Buffer): string {
  const safe = basename(name).replace(/[^\w.-]+/g, '_');
  const path = join(dir, safe);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}
