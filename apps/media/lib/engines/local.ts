/**
 * The local engine: F5-TTS on this machine, for drafts and bulk work.
 *
 * WHERE THIS SITS IN THE OWNER'S DECISION
 *
 * *"keep ElevenLabs for public narration, self-host for drafts and bulk"* — and he accepted it with
 * *"having both is good."* So this is not a fallback for ElevenLabs and ElevenLabs is not a fallback for
 * this. `engine: 'local'` means the model on this disk spoke, and `NarrationResult.provenance.engine`
 * says so, because that value is written to `ozikoro_episode.generator` and a record that names the wrong
 * engine is a lie the archive cannot detect later.
 *
 * WHY IT IS SLOW, SAID OUT LOUD
 *
 * There is no GPU on this machine. F5-TTS is a 335 M-parameter flow-matching transformer, and on eight
 * x86 cores it renders at roughly real time: a fourteen-minute article is about fourteen minutes of
 * waiting. **That is the trade the owner chose** — free and slow and lower quality, or paid and good — and
 * it is why `LOCAL_MAX_CHARS` chunks the text small: a failure loses one chunk, not the article.
 *
 * WHAT IT REFUSES TO DO
 *
 *  - It does not substitute a voice. A voice named that is not registered is `unknown_voice`, not the
 *    first voice on disk.
 *  - It does not accept text past its ceiling. `text_too_long` names the count and the ceiling.
 *  - It does not turn digital silence into success. The worker measures RMS and a silent render is
 *    returned with `silent: true` so a caller can refuse to publish it.
 *  - It does not pretend the tone marks survived. `prepare_text` in the worker reports every mark it had
 *    to strip, and those come back here in `outOfVocab`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_MAX_CHARS, planScript } from '@ozikoro/platform/chunking';
import { concatWavs } from '../audio.ts';
import { MediaError } from '../errors.ts';
import type { EngineCapabilities, NarrationEngine, NarrationResult, SpeakRequest } from '../types.ts';
import { getSpeakableVoice, voiceReferencePaths } from '../voice-profiles.ts';
import { TtsWorker, assertRuntimePresent, pythonPaths } from '../worker-client.ts';

/**
 * What the local weights are, and what that means for the owner.
 *
 * **The weights are CC-BY-NC-4.0: non-commercial.** The code is MIT and the *code* licence is the one
 * people quote, but the checkpoint is what does the speaking and it is the checkpoint's licence that
 * governs publishing. This is set here as data rather than as a comment so `/health` can return it and the
 * review screen can refuse to publish a render made with it. See `README.md` for the commercially-usable
 * alternative.
 */
export const LOCAL_LICENCE = {
  weights: 'CC-BY-NC-4.0',
  code: 'MIT',
  nonCommercial: true,
  url: 'https://huggingface.co/SWivid/F5-TTS',
  note:
    'The F5-TTS *code* is MIT; the *weights* are CC-BY-NC-4.0, which forbids commercial use. ' +
    'A public archive is a public use, and the owner must decide whether it is a commercial one before ' +
    'publishing a render made with this engine. Chatterbox (Resemble AI) is MIT for both code and ' +
    'weights and clones from a reference clip, so it is the drop-in alternative if the answer is no.',
} as const;

export const LOCAL_MODEL = process.env.OZIKORO_MEDIA_LOCAL_MODEL ?? 'F5TTS_Base';

/** The ceiling this engine takes in one request. A patience limit, not a provider limit. */
export const LOCAL_MAX_CHARACTERS = Number(process.env.OZIKORO_MEDIA_LOCAL_MAX_CHARS ?? 20_000);

export type LocalEngineOptions = {
  /** One worker per process. Tests pass their own; the service passes a singleton. */
  worker?: TtsWorker;
  /** Load the model on construction rather than on first use. */
  preload?: boolean;
};

export class LocalEngine implements NarrationEngine {
  readonly name = 'local' as const;
  readonly worker: TtsWorker;
  #ready = false;
  #loadError: string | null = null;
  #preload: boolean;
  #lastError: string | null = null;

  constructor(options: LocalEngineOptions = {}) {
    this.worker = options.worker ?? new TtsWorker();
    this.#preload = options.preload ?? false;
  }

  /**
   * Load the model now and wait for it.
   *
   * `/health` calls this so it can answer truthfully rather than optimistically. A health check that says
   * "ready" because a process exists — before the 1.35 GB checkpoint has been read — is a health check
   * that lies during exactly the window where someone is waiting to find out why nothing works.
   */
  async load(): Promise<void> {
    if (this.#ready) return;
    try {
      assertRuntimePresent();
      await this.worker.start(true);
      await this.worker.load();
      this.#ready = true;
      this.#loadError = null;
    } catch (error) {
      this.#ready = false;
      this.#loadError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  capabilities(): EngineCapabilities {
    let installed = true;
    let reason: string | null = null;
    try {
      assertRuntimePresent();
    } catch (error) {
      installed = false;
      reason = error instanceof Error ? error.message : String(error);
    }
    if (installed && this.#loadError) {
      reason = this.#loadError;
    }
    const status = installed ? this.worker.status() : null;
    return {
      engine: 'local',
      available: installed && this.#loadError === null,
      reason,
      model: status?.model ?? LOCAL_MODEL,
      maxCharacters: LOCAL_MAX_CHARACTERS,
      voiceCloning: true,
      costsCredits: false,
      licence: { ...LOCAL_LICENCE },
    };
  }

  /** Everything `/health` needs about the local side, in one object. */
  health(): {
    installed: boolean;
    ready: boolean;
    model: string | null;
    device: string | null;
    accelerators: { cuda: boolean; mps: boolean; deviceCount: number; torch: string } | null;
    pid: number | null;
    busy: boolean;
    pendingRequests: number;
    loadError: string | null;
    lastError: string | null;
    python: string;
    worker: string;
    stderrTail: string[];
  } {
    const paths = pythonPaths();
    const status = this.worker.status();
    return {
      installed: (() => {
        try {
          assertRuntimePresent();
          return true;
        } catch {
          return false;
        }
      })(),
      ready: this.#ready && status.ready,
      model: status.model,
      device: status.device,
      accelerators: status.accelerators,
      pid: status.pid,
      busy: status.busy,
      pendingRequests: status.pendingRequests,
      loadError: this.#loadError,
      lastError: this.#lastError,
      python: paths.python,
      worker: paths.worker,
      stderrTail: this.worker.stderrTail(10),
    };
  }

  async speak(request: SpeakRequest, options: { signal?: AbortSignal } = {}): Promise<NarrationResult> {
    const text = request.text ?? '';
    const characters = text.length;

    if (!text.trim()) {
      throw new MediaError({
        code: 'bad_request',
        engine: 'local',
        model: LOCAL_MODEL,
        characters,
        status: 400,
        message: 'no text to speak: the request carried an empty string',
      });
    }
    if (characters > LOCAL_MAX_CHARACTERS) {
      throw new MediaError({
        code: 'text_too_long',
        engine: 'local',
        model: LOCAL_MODEL,
        characters,
        status: 413,
        message:
          `the local engine takes at most ${LOCAL_MAX_CHARACTERS} characters per request and this text is ` +
          `${characters}. Split it, or raise OZIKORO_MEDIA_LOCAL_MAX_CHARS and accept the longer wait — ` +
          `a render that long that fails loses all of it, which is why the ceiling is here.`,
        details: { limit: LOCAL_MAX_CHARACTERS, characters },
      });
    }
    if (this.worker.status().busy) {
      throw new MediaError({
        code: 'busy',
        engine: 'local',
        model: LOCAL_MODEL,
        characters,
        status: 503,
        message:
          'the local engine is already rendering. It is refused rather than queued because a CPU-bound ' +
          'flow-matching model finishes two requests in the time of two, not in the time of one — ' +
          'queueing would only make the second caller wait longer for the same answer.',
        details: { pendingRequests: this.worker.status().pendingRequests },
      });
    }

    // The reference clip and, crucially, its transcript. A voice with no transcript cannot condition the
    // model, and guessing the words would tune the voice on something nobody said.
    const profile = getSpeakableVoice(request.voice);
    const [referenceAudio] = voiceReferencePaths(profile);
    if (!referenceAudio) {
      throw new MediaError({
        code: 'unknown_voice',
        engine: 'local',
        model: LOCAL_MODEL,
        characters,
        status: 409,
        message: `voice ${JSON.stringify(profile.name)} has no reference clip on disk`,
        details: { voice: profile.name },
      });
    }

    await this.load();

    const plan = planScript(text, LOCAL_MAX_CHARS);
    const scratch = mkdtempSync(join(tmpdir(), 'ozikoro-media-local-'));
    const outOfVocab = new Set<string>();
    const strippedMarks = new Set<string>();
    const silentChunks: number[] = [];
    const paths: string[] = [];
    let charactersSpoken = 0;

    try {
      for (const piece of plan) {
        const out = join(scratch, `chunk-${String(piece.index).padStart(4, '0')}.wav`);
        const result = await this.worker.synthesize({
          text: piece.text,
          referenceAudio,
          referenceText: profile.referenceText as string,
          out,
          nfeStep: request.nfeStep,
          speed: request.speed,
        });
        if (result.silent) silentChunks.push(piece.index);
        for (const mark of result.strippedMarks ?? []) strippedMarks.add(mark);
        for (const ch of result.outOfVocab ?? []) outOfVocab.add(ch);
        charactersSpoken += piece.characters;
        paths.push(result.out);
      }

      const audio = concatWavs(paths);
      const status = this.worker.status();
      const anySilent = silentChunks.length > 0;
      if (anySilent) {
        this.#lastError =
          `chunk(s) ${silentChunks.join(', ')} came back as digital silence. The file is playable and ` +
          `says nothing, which is the failure mode that ships — check the reference clip and its transcript.`;
      }

      return {
        ok: true,
        provenance: {
          engine: 'local',
          model: status.model ?? LOCAL_MODEL,
          voice: profile.name,
          voiceLabel: profile.label,
          settings: {
            nfeStep: request.nfeStep ?? 16,
            speed: request.speed ?? 1.0,
            device: status.device,
            chunkChars: LOCAL_MAX_CHARS,
          },
          narratorKind: 'synthetic_own_voice',
          disclosure:
            'This recording is synthesised. The voice is a model conditioned on the owner\'s own ' +
            'reference recordings of Igbo speech; no person spoke these words.',
        },
        audio,
        contentType: 'audio/wav',
        fileExtension: 'wav',
        bytes: audio.length,
        durationSeconds: audio.length > 44 ? (audio.length - 44) / (24_000 * 2) : null,
        characters: charactersSpoken,
        chunks: { total: plan.length, midSentenceSeams: plan.filter((p) => p.midSentenceSeam).length },
        silent: anySilent,
        outOfVocab: [...outOfVocab].sort(),
        measuredCredits: 0,
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  async stop(): Promise<void> {
    await this.worker.stop();
    this.#ready = false;
  }
}
