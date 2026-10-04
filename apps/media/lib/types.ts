/**
 * The contract both engines answer to.
 *
 * THE POINT OF THIS FILE
 *
 * There are two engines and they are **first-class equals**: the local model for drafts and bulk work,
 * ElevenLabs for the public narration. The owner's decision was "having both is good", and the way that
 * decision survives contact with the code is that neither one is the fallback for the other.
 *
 * So everything here is written so that the difference between them is a *parameter*. A request says
 * `engine: 'local' | 'elevenlabs'`, and both return the same shape:
 *
 *   - success → audio bytes, plus a record of exactly who spoke (engine, model, voice, settings)
 *   - failure → a `MediaError` naming the engine that refused, the model, the input size and the reason
 *
 * **There is no `default engine` and no fallback chain.** `NarrationResult.engine` is the engine that
 * actually ran, and it is written to `ozikoro_episode.generator` — a silent substitution would make
 * `generator = 'elevenlabs'` a lie, and the archive's whole position is that the record is the thing.
 */

import type { EngineName, MediaError } from './errors.ts';

/** Who spoke, recorded so a listener — or the owner in a year — can tell what they are hearing. */
export type NarrationProvenance = {
  engine: EngineName;
  /** The model identifier. `eleven_multilingual_v2`, or the F5-TTS checkpoint name. */
  model: string;
  /** The voice, as named in this service. */
  voice: string;
  /** Human-readable voice label, for the review screen. */
  voiceLabel: string | null;
  /** Whatever the engine was tuned with, stored as JSON on the episode. */
  settings: Record<string, unknown>;
  /** `narrator_kind` for `ozikoro_episode`: which of the two synthetic kinds this is. */
  narratorKind: 'synthetic_own_voice' | 'synthetic_generic';
  /** The disclosure text that ships with the audio. */
  disclosure: string;
};

export type NarrationResult = {
  ok: true;
  provenance: NarrationProvenance;
  /** The finished audio, container-joined and playable. */
  audio: Buffer;
  /** What the bytes are. MP3 for ElevenLabs, WAV for the local model — stated, not inferred. */
  contentType: string;
  fileExtension: 'mp3' | 'wav';
  bytes: number;
  durationSeconds: number | null;
  characters: number;
  /** How many pieces the render was split into, and whether any seam fell mid-sentence. */
  chunks: { total: number; midSentenceSeams: number };
  /** True when the local model returned digital silence. A render that says so is not a good render. */
  silent: boolean;
  /** Characters the model could not represent, named. Empty for engines that need no such handling. */
  outOfVocab: string[];
  /**
   * What ElevenLabs charged, when it ran. Null for the local engine and when the allowance could not be
   * read — **null means "not measured", never "free"**, which is why it is not defaulted to 0.
   */
  measuredCredits: number | null;
};

export type EngineCapabilities = {
  engine: EngineName;
  available: boolean;
  /** Why not, when `available` is false. Always a sentence that names the missing thing. */
  reason: string | null;
  model: string;
  /** The ceiling this engine enforces per request, in characters. */
  maxCharacters: number;
  /** Whether this engine can clone a voice from reference audio. */
  voiceCloning: boolean;
  /** Whether this engine is the one that may be published without further review. Never automatic. */
  costsCredits: boolean;
  licence: EngineLicence;
};

export type EngineLicence = {
  /** SPDX-ish identifier of the licence the *weights* are under, which is what governs use. */
  weights: string;
  /** The licence of the code, when it differs — it usually does. */
  code: string;
  /** True when the licence forbids commercial use. **The owner must know this before publishing.** */
  nonCommercial: boolean;
  url: string;
  note: string;
};

export type SpeakRequest = {
  text: string;
  voice: string;
  engine: EngineName;
  format?: 'mp3' | 'wav';
  /** Local-engine only: quality/speed trade-off. Ignored by ElevenLabs, and stated as ignored. */
  nfeStep?: number;
  speed?: number;
};

/** Both engines implement this. `speak` either returns a finished render or throws a `MediaError`. */
export interface NarrationEngine {
  readonly name: EngineName;
  capabilities(): EngineCapabilities;
  speak(request: SpeakRequest, options?: { signal?: AbortSignal }): Promise<NarrationResult>;
}

export type { EngineName, MediaError };
