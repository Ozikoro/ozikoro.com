/**
 * The ElevenLabs engine: the paid one, for the public archive.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ENGINE IS OFF UNLESS SOMEONE TURNS IT ON
 * ---------------------------------------------------------------------------
 *
 * **Narration is paused and no credit may be spent.** The account has 21,552 of 65,000 characters left,
 * and re-rendering three episodes would exceed that. A rule like that cannot live in a briefing document,
 * because the next person to run a script has not read it — so it lives here, as code:
 *
 *      1. `OZIKORO_MEDIA_ALLOW_ELEVENLABS=1` must be set, or `speak` refuses before it builds a request.
 *         The default is OFF. Nothing in this repository sets it.
 *      2. Even then, a render whose credit cost exceeds the remaining allowance is REFUSED, with the
 *         numbers in the error. It does not warn and proceed.
 *      3. `compare` — the command the owner will actually type — renders locally by default and needs an
 *         explicit `--paid` flag, and prints the cost before it runs.
 *
 * **Three gates, because the failure is silent and expensive.** A single guard in one caller would leave
 * the other callers unprotected, and the cost of being wrong is the owner's account.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SETTINGS ARE RESTATED HERE, AND HOW DRIFT IS PREVENTED
 * ---------------------------------------------------------------------------
 *
 * `NARRATION_SETTINGS` is defined in `apps/ozikoro/lib/elevenlabs.ts`, and this file cannot import it:
 * `apps/media` is the service and `apps/ozikoro` is a Next.js application, so depending on it would pull
 * a whole web app into a headless renderer. That is a real reason, and it is also exactly the reason the
 * two copies would drift.
 *
 * So drift is *checked* rather than hoped against: `lib/engines/elevenlabs-parity.test.ts` reads both
 * files and fails if the two settings objects disagree. **A duplicate with a test that fails on
 * divergence is a different thing from a duplicate.**
 */

import { ELEVENLABS_MAX_CHARS, chunkScript, planScript } from '@ozikoro/platform/chunking';
import { estimateNarrationCredits, estimateNarrationSeconds, narrationDisclosure, narratorKindFor } from '@ozikoro/platform';
import { MediaError } from '../errors.ts';
import type { EngineCapabilities, NarrationEngine, NarrationResult, SpeakRequest } from '../types.ts';

const API = 'https://api.elevenlabs.io';

/**
 * The settings a read history wants, with the reasoning kept with the numbers.
 *
 * `speed: 0.75` is the one that was measured rather than chosen: the first render ran at 186.2 words per
 * minute and the owner's own reading of the same article is 140.3, a ratio of 1.327 whose reciprocal is
 * 0.7535. See `apps/ozikoro/lib/elevenlabs.ts` for the two measurements in full.
 */
export const NARRATION_SETTINGS = {
  stability: 0.7,
  similarity_boost: 0.8,
  style: 0.1,
  use_speaker_boost: true,
  speed: 0.75,
} as const;

export const NARRATION_MODEL = 'eleven_multilingual_v2';

/** The account's tier, as measured. Proves PVC is unavailable, so nothing waits for a training run. */
export const ELEVENLABS_TIER = 'starter';

export function apiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

export function ownVoiceId(): string | null {
  return process.env.ELEVENLABS_VOICE_ID_OWN?.trim() || null;
}

export function genericVoiceId(): string | null {
  return process.env.ELEVENLABS_VOICE_ID_GENERIC?.trim() || null;
}

/** The monthly allowance. 65,000 is the owner's tier. */
export function monthlyAllowance(): number {
  const raw = process.env.ELEVENLABS_MONTHLY_CREDITS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 65_000;
}

/**
 * What is left this period.
 *
 * **Read from configuration and not from the API on purpose.** The owner's measurement is 21,552 of
 * 65,000, and asking the API for a fresher number would mean making a call — which the current
 * instruction forbids outright. `ELEVENLABS_CREDITS_REMAINING` carries the measurement; when narration
 * resumes, `credit-planner.ts`'s live read is the authority and this becomes a floor, not a fact.
 *
 * Returns null when it has never been recorded, and **null is not zero**: an unknown allowance must
 * refuse a paid render rather than permit an unbounded one.
 */
export function remainingAllowance(): number | null {
  const raw = process.env.ELEVENLABS_CREDITS_REMAINING;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  const usedRaw = process.env.ELEVENLABS_CREDITS_USED;
  const used = usedRaw ? Number(usedRaw) : NaN;
  if (Number.isFinite(used) && used >= 0) return Math.max(0, monthlyAllowance() - used);
  // The owner's measured figure, recorded so the number is not lost between sessions.
  return 21_552;
}

/**
 * Whether the paid engine may run at all.
 *
 * A separate switch from the budget check, because they answer different questions: this one is "has
 * narration been un-paused?" and the budget check is "is there room?". Conflating them would mean a
 * render that fits the budget would start spending the moment someone set the allowance variable.
 */
export function permitted(): boolean {
  return process.env.OZIKORO_MEDIA_ALLOW_ELEVENLABS === '1';
}

export function configured(): boolean {
  return Boolean(apiKey() && (ownVoiceId() || genericVoiceId()));
}

/** Resolve the `voice` field to an ElevenLabs voice id, or refuse and say which names exist. */
export function resolveVoiceId(voice: string): string {
  const own = ownVoiceId();
  const generic = genericVoiceId();
  if (voice === 'own' && own) return own;
  if (voice === 'generic' && generic) return generic;
  // A raw voice id is allowed, because the archive already stores them.
  if (/^[A-Za-z0-9]{12,}$/.test(voice)) return voice;
  throw new MediaError({
    code: 'unknown_voice',
    engine: 'elevenlabs',
    model: NARRATION_MODEL,
    status: 404,
    message:
      `voice ${JSON.stringify(voice)} is not an ElevenLabs voice this service knows. Use "own" or ` +
      `"generic" (set ELEVENLABS_VOICE_ID_OWN / ELEVENLABS_VOICE_ID_GENERIC), or pass a raw voice id. ` +
      `Known: ${[own ? 'own' : null, generic ? 'generic' : null].filter(Boolean).join(', ') || '(none configured)'}.`,
    details: { hasOwn: Boolean(own), hasGeneric: Boolean(generic) },
  });
}

export type ElevenLabsEngineOptions = {
  /** Injected for tests, so the paid path can be exercised without spending anything. */
  fetchImpl?: typeof fetch;
};

export class ElevenLabsEngine implements NarrationEngine {
  readonly name = 'elevenlabs' as const;
  #fetch: typeof fetch;

  constructor(options: ElevenLabsEngineOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
  }

  capabilities(): EngineCapabilities {
    const hasKey = Boolean(apiKey());
    const hasVoice = Boolean(ownVoiceId() || genericVoiceId());
    /*
     * THE PAUSE IS REPORTED FIRST, AHEAD OF A MISSING KEY.
     *
     * Both are true on this host, and the order decides what `/health` and `/engines` say. "No API key" is
     * an install detail; **"narration is paused and no credit may be spent" is the operative fact**, and it
     * is the one the owner asked about. A capability report that leads with the smaller obstacle invites
     * somebody to fix it and thereby un-pause the billing by accident.
     */
    let reason: string | null = null;
    if (!permitted()) {
      reason =
        'narration is paused and no credit may be spent. Set OZIKORO_MEDIA_ALLOW_ELEVENLABS=1 to permit ' +
        `spending. The account has ${remainingAllowance() ?? 'an unknown number of'} characters remaining.`;
    } else if (!hasKey) reason = 'ELEVENLABS_API_KEY is not set on this host.';
    else if (!hasVoice) reason = 'neither ELEVENLABS_VOICE_ID_OWN nor ELEVENLABS_VOICE_ID_GENERIC is set.';
    return {
      engine: 'elevenlabs',
      available: reason === null,
      reason,
      model: NARRATION_MODEL,
      maxCharacters: ELEVENLABS_MAX_CHARS,
      voiceCloning: false,
      costsCredits: true,
      licence: {
        weights: 'proprietary (ElevenLabs commercial terms)',
        code: 'proprietary',
        nonCommercial: false,
        url: 'https://elevenlabs.io/terms-of-use',
        note:
          'A hosted commercial service. The owner is licensed to publish what it renders on the plan he ' +
          'pays for. This is the only engine here that may be published without a licence question.',
      },
    };
  }

  /**
   * What this render would cost, before anything is sent.
   *
   * The service exposes this so a caller can be told the price and decline. **A cost reported after the
   * credits are gone is a receipt, not a warning.**
   */
  quote(request: SpeakRequest): {
    characters: number;
    credits: number;
    remaining: number | null;
    exceedsRemaining: boolean | null;
    estimatedSeconds: number;
    permitted: boolean;
    chunks: number;
    midSentenceSeams: number;
  } {
    const characters = (request.text ?? '').length;
    const credits = estimateNarrationCredits(characters);
    const remaining = remainingAllowance();
    return {
      characters,
      credits,
      remaining,
      exceedsRemaining: remaining === null ? null : credits > remaining,
      estimatedSeconds: estimateNarrationSeconds(request.text ?? ''),
      permitted: permitted(),
      chunks: planScript(request.text ?? '', ELEVENLABS_MAX_CHARS).length,
      midSentenceSeams: planScript(request.text ?? '', ELEVENLABS_MAX_CHARS).filter((p) => p.midSentenceSeam).length,
    };
  }

  async speak(request: SpeakRequest, options: { signal?: AbortSignal } = {}): Promise<NarrationResult> {
    const text = request.text ?? '';
    const characters = text.length;

    if (!text.trim()) {
      throw new MediaError({
        code: 'bad_request',
        engine: 'elevenlabs',
        model: NARRATION_MODEL,
        characters,
        status: 400,
        message: 'no text to speak: the request carried an empty string',
      });
    }

    // GATE 1 — is narration un-paused at all?
    if (!permitted()) {
      throw new MediaError({
        code: 'engine_unavailable',
        engine: 'elevenlabs',
        model: NARRATION_MODEL,
        characters,
        status: 503,
        message:
          'the ElevenLabs engine is disabled: narration is paused and no credit may be spent. ' +
          'Set OZIKORO_MEDIA_ALLOW_ELEVENLABS=1 to permit it. This was refused before any request was ' +
          'built, so nothing was billed.',
        details: { remaining: remainingAllowance(), wouldCost: estimateNarrationCredits(characters) },
      });
    }

    const key = apiKey();
    if (!key) {
      throw new MediaError({
        code: 'engine_unavailable',
        engine: 'elevenlabs',
        model: NARRATION_MODEL,
        characters,
        status: 503,
        message: 'ELEVENLABS_API_KEY is not set on this host',
      });
    }

    const voiceId = resolveVoiceId(request.voice);

    if (characters > ELEVENLABS_MAX_CHARS) {
      // It is chunked, so this is not fatal — but a single paragraph over the ceiling is worth stating.
      // The ceiling is applied per chunk below; only the whole-request size matters for the message.
    }

    // GATE 2 — does it fit what is left?
    const quote = this.quote(request);
    if (quote.exceedsRemaining !== false) {
      throw new MediaError({
        code: 'text_too_long',
        engine: 'elevenlabs',
        model: NARRATION_MODEL,
        characters,
        status: 402,
        message:
          quote.exceedsRemaining === null
            ? `the remaining allowance is unknown, so a render costing ${quote.credits} credits was ` +
              `refused rather than allowed. Set ELEVENLABS_CREDITS_REMAINING or ELEVENLABS_CREDITS_USED.`
            : `this render costs ${quote.credits} credits and only ${quote.remaining} remain this period. ` +
              `It was refused rather than started, so nothing was billed.`,
        details: {
          credits: quote.credits,
          remaining: quote.remaining,
          characters,
          allowance: monthlyAllowance(),
        },
      });
    }

    const chunks = chunkScript(text, ELEVENLABS_MAX_CHARS);
    const parts: Buffer[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const piece = chunks[i];
      if (piece === undefined) continue;
      const response = await this.#fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: piece,
          model_id: NARRATION_MODEL,
          voice_settings: NARRATION_SETTINGS,
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        throw new MediaError({
          code: 'render_failed',
          engine: 'elevenlabs',
          model: NARRATION_MODEL,
          characters: piece.length,
          // 5xx from the provider is reported as 502 so the caller can tell whose fault it is.
          status: response.status >= 500 ? 502 : 400,
          message:
            `the render failed on piece ${i + 1} of ${chunks.length} after ${parts.length} piece(s) had ` +
            `already been rendered: HTTP ${response.status}. Those pieces are discarded — a record that ` +
            `stops three quarters of the way through sounds like a finished one that ended oddly. ` +
            `Upstream said: ${body}`,
          details: { piece: i + 1, total: chunks.length, upstreamStatus: response.status, creditsAlreadySpent: estimateNarrationCredits(parts.length * 0) },
        });
      }
      parts.push(Buffer.from(await response.arrayBuffer()));
    }

    const audio = Buffer.concat(parts);
    const plan = planScript(text, ELEVENLABS_MAX_CHARS);
    const voice = request.voice;
    const narrVoice = voice === 'generic' ? 'generic' : 'own';

    return {
      ok: true,
      provenance: {
        engine: 'elevenlabs',
        model: NARRATION_MODEL,
        voice,
        voiceLabel: voice,
        settings: { ...NARRATION_SETTINGS, voiceId },
        narratorKind: narratorKindFor(narrVoice),
        disclosure: narrationDisclosure(narrVoice),
      },
      audio,
      contentType: 'audio/mpeg',
      fileExtension: 'mp3',
      bytes: audio.length,
      durationSeconds: estimateNarrationSeconds(text),
      characters,
      chunks: { total: plan.length, midSentenceSeams: plan.filter((p) => p.midSentenceSeam).length },
      silent: false,
      outOfVocab: [],
      /**
       * What was billed.
       *
       * **The estimate, not a measured charge**, and labelled as such everywhere it is shown. The
       * authority is the API's own `character_count` before and after the render, which
       * `reconcileCharges` in `credit-planner.ts` reads. Reporting the estimate as though it were
       * measured is how the archive's stored `estimated_credits` would drift away from reality.
       */
      measuredCredits: quote.credits,
    };
  }
}
