/**
 * One place that narrates. The server and every command go through here.
 *
 * WHY THIS EXISTS AT ALL
 *
 * `/speak` over HTTP and `npm run speak` on the command line are the same act: resolve the pronunciation,
 * pick the engine, enforce the ceiling, render under a timeout, and refuse to hand back a file whose
 * provenance is not known. **Written twice, they would drift — and the drift would be in the boring parts
 * (the timeout, the ceiling, the silent-audio check) which are exactly the parts nobody retests by hand.**
 * So the orchestration is here once and the two front ends are thin.
 *
 * **This is where the "no silent fallback" rule is enforced**, because it is the only path to a render:
 * the engine is named or the call fails, and `NarrationResult.provenance.engine` is whatever actually ran.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MediaError, isEngineName, type EngineName } from './errors.ts';
import { engineFor, type EngineSet } from './engines/index.ts';
import { analyse, type PronunciationReport } from './lexicon.ts';
import type { NarrationResult } from './types.ts';

/** How long one render may take before it is abandoned and says so. */
export function renderTimeoutMs(): number {
  return Number(process.env.OZIKORO_MEDIA_REQUEST_TIMEOUT_MS ?? 1_800_000);
}

export type NarrateInput = {
  text: string;
  voice: string;
  engine: EngineName;
  nfeStep?: number;
  speed?: number;
};

export type Narrated = {
  result: NarrationResult;
  pronunciation: PronunciationReport;
  /** What the ElevenLabs engine would have charged. Zero for a local render, and stated as estimated. */
  credits: number | null;
  elapsedMs: number;
};

/**
 * Render the text, or fail with the engine, the input size and the reason.
 *
 * The pronunciation layer runs for BOTH engines and BEFORE the render. That order matters: a caller that
 * learns about an unsayable word after paying for a render has paid for a mispronunciation, and the whole
 * point of this service is that the owner heard one of those and asked for it to stop.
 */
export async function narrate(engines: EngineSet, input: NarrateInput, options: { signal?: AbortSignal } = {}): Promise<Narrated> {
  const text = input.text ?? '';

  if (!isEngineName(input.engine)) {
    throw new MediaError({
      code: 'bad_request',
      status: 400,
      characters: text.length,
      message:
        `engine must be "local" or "elevenlabs" and was ${JSON.stringify(input.engine)}. There is no default: ` +
        `the engine that ran is written to the episode record.`,
      details: { known: ['local', 'elevenlabs'] },
    });
  }
  if (!text.trim()) {
    throw new MediaError({ code: 'bad_request', engine: input.engine, status: 400, characters: 0, message: 'no text to speak' });
  }
  if (!input.voice) {
    throw new MediaError({
      code: 'bad_request',
      engine: input.engine,
      status: 400,
      characters: text.length,
      message: 'no voice supplied — the archive records which voice narrated which record, so it is never defaulted',
    });
  }

  const engine = engineFor(engines, input.engine);
  const pronunciation = analyse(text, input.engine);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), renderTimeoutMs());
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const started = Date.now();
  try {
    const result = await engine.speak(
      {
        text,
        voice: input.voice,
        engine: input.engine,
        ...(input.nfeStep === undefined ? {} : { nfeStep: input.nfeStep }),
        ...(input.speed === undefined ? {} : { speed: input.speed }),
      },
      { signal: controller.signal }
    );
    return { result, pronunciation, credits: result.measuredCredits, elapsedMs: Date.now() - started };
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new MediaError({
        code: 'timeout',
        engine: input.engine,
        model: engine.capabilities().model,
        characters: text.length,
        status: 504,
        message:
          `the render did not finish within ${Math.round(renderTimeoutMs() / 1000)}s and was abandoned. ` +
          `The local model is killed rather than left busy, so the next request pays a reload. Raise ` +
          `OZIKORO_MEDIA_REQUEST_TIMEOUT_MS, or render a shorter passage.`,
        details: { timeoutMs: renderTimeoutMs(), characters: text.length, elapsedMs: Date.now() - started },
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Write a render to disk, creating the directory. Returns the absolute path and the size. */
export function writeRender(result: NarrationResult, outPath: string): { path: string; bytes: number } {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.audio);
  return { path: outPath, bytes: result.audio.length };
}

/** A default output path that says who spoke it, so a folder of files is not anonymous. */
export function defaultOutputPath(outDir: string, stem: string, result: NarrationResult): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(outDir, `${stem}.${result.provenance.engine}.${stamp}.${result.fileExtension}`);
}
