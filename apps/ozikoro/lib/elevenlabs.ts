/**
 * ElevenLabs, with the endpoints and the limits as they actually are.
 *
 * FOUR CORRECTIONS TO THE INTERFACE THIS WAS SPECIFIED FROM
 *
 * 1. `https://elevenlabs.io` IS THE WEBSITE, NOT THE API. Every call to it returns the marketing page as
 *    HTML — so a `responseType: 'arraybuffer'` "success" would have written a web page into an MP3 file and
 *    the fault would only have shown up when somebody pressed play. **The API is `https://api.elevenlabs.io`.**
 *
 * 2. THERE IS NO `/v1/voice-isolator`. Measured against the live API: `/v1/audio-isolation` answers 422
 *    (a real endpoint, missing its file) and `/v1/voice-isolator` answers 404. **A 404 on a POST is not always
 *    obvious in a retry loop, and the code would have "run" and cleaned nothing.**
 *
 * 3. PROFESSIONAL VOICE CLONING IS NOT AVAILABLE ON THIS ACCOUNT. `GET /v1/user/subscription` reports
 *    `tier: starter`, and the voice's own record reports `is_allowed_to_fine_tune: false`. **PVC begins at
 *    `creator`.** Instant Voice Cloning works at every tier, takes minutes rather than hours, and is what the
 *    owner's voice was actually trained with — `category: "cloned"`, usable immediately. **A pipeline built for
 *    PVC on this account would have polled forever for a training run that never started.**
 *
 * 4. THE ISOLATOR IS NOT A CLEANING STEP THAT IS ALWAYS OWED. It is a separate, billed feature. **The owner's
 *    recordings were made in a quiet room and the clone came out clean** — running thirteen files through an
 *    isolator first would have cost credits and could have removed breath and room tone the voice needs.
 *    It is offered as a tool, not applied as a rule.
 */
import { readFileSync } from 'node:fs';

const API = 'https://api.elevenlabs.io';

/** The key, from the environment. **Never logged, never returned in a response.** */
export function apiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

/** The clone trained from the owner's own recordings, if one is configured. */
export function ownVoiceId(): string | null {
  return process.env.ELEVENLABS_VOICE_ID_OWN?.trim() || null;
}

/** A stock narrator, for anything the owner has not recorded. */
export function genericVoiceId(): string | null {
  return process.env.ELEVENLABS_VOICE_ID_GENERIC?.trim() || null;
}

export function configured(): boolean {
  return Boolean(apiKey() && (ownVoiceId() || genericVoiceId()));
}

/**
 * The settings a read history wants, and why each value is where it is.
 *
 * **`stability` at 0.7 rather than the 0.85 this was specified with.** High stability makes a voice consistent
 * and flat; the owner's clone is of a person reading, and a reading that never varies is the sound an audience
 * identifies as synthetic. 0.7 keeps the voice recognisable while letting a sentence end differently from how
 * it began — which is what a person does.
 *
 * **`style` stays low.** Style exaggeration pushes a reading toward a performance, and a history performed is a
 * history asserted. The archive's register is a person telling you what the record says.
 *
 * `similarity_boost` is high, because the point of cloning the owner's voice is that it is his.
 *
 * ── `speed` AT 0.75, AND THE MEASUREMENT IT COMES FROM ─────────────────────────────────────────────
 *
 * **There was no `speed` here at all, so the render ran at the API's default of 1.0 and the pace was never a
 * decision anybody made.** The owner heard it and said so: *"the audio generated for the article is too fast,
 * and not reading it normal"*. Two numbers say he was right, and both were measured rather than estimated.
 *
 *   * THE RENDER. The episode's own transcript — the words that were sent, readable at
 *     `/podcast/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/transcript.txt` — is **1,557 words**, 9,958
 *     characters. The MP3 rendered from it is **501.812 s** (measured from the file's own frames, and agreeing
 *     with its `Info` header's declared 19,210 frames). That is **186.2 words per minute.**
 *   * THE OWNER'S OWN READING of the same article — `Ute Okpu 2.mp3`, the record he supplied as the target —
 *     is **665.966 s** for the same words. That is **140.3 words per minute.**
 *
 * **The ratio between them needs no word count at all: 665.966 / 501.812 = 1.327.** The render was a third
 * faster than the person whose voice it is imitating, and a third faster than the pace he calls normal. The
 * value that answers it is its reciprocal, **0.7535**, and **0.75 is the nearest the setting comes**:
 * 186.2 × 0.75 = 139.6 wpm against his 140.3, and 501.812 / 0.75 = **669 s (11m 09s)** against his **11m 06s**.
 *
 * The value is independently confirmed by the archive's own assumption. `estimateNarrationSeconds` in
 * `@ozikoro/platform` divides by **145 wpm**, and that is the figure the owner was shown — "10m 36s" for an
 * episode whose audio is **8m 22s**. 145 / 186.2 = 0.78, so the archive's own arithmetic asks for a value
 * between 0.75 and 0.78, and the owner's recording decides which end. **The estimate was right and the render
 * was fast**; slowing it makes the audio agree with the estimate instead of contradicting it.
 *
 * 0.75 and not the floor: the REST API accepts `speed` from **0.25 to 4.0** (the 0.7–1.2 range is the agents
 * platform's restriction, not this endpoint's), and the model here is `eleven_multilingual_v2`, which supports
 * `speed` — the v4 models do not. **So 0.7 is still available if the owner wants it slower again**, and this
 * change costs no credits: `speed` is a request parameter, so the next render is the test, not a re-render.
 */
export const NARRATION_SETTINGS = {
  stability: 0.7,
  similarity_boost: 0.8,
  style: 0.1,
  use_speaker_boost: true,
  // Measured against the owner's own reading of the same article. See the note above for the two numbers.
  speed: 0.75,
} as const;

/** The model documented for long-form narration in many languages. */
export const NARRATION_MODEL = 'eleven_multilingual_v2';

export type VoiceSummary = {
  voiceId: string;
  name: string;
  category: string;
  /** Instant clones are usable at once; PVC reports a training state. */
  fineTuningAllowed: boolean;
  fineTuningState: string | null;
};

/** One voice, as the API reports it. */
export async function getVoice(voiceId: string): Promise<VoiceSummary | null> {
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(`${API}/v1/voices/${encodeURIComponent(voiceId)}`, { headers: { 'xi-api-key': key } });
  if (!res.ok) return null;
  const d = (await res.json()) as {
    voice_id?: string; name?: string; category?: string;
    fine_tuning?: { is_allowed_to_fine_tune?: boolean; state?: Record<string, unknown> };
  };
  const state = d.fine_tuning?.state;
  return {
    voiceId: d.voice_id ?? voiceId,
    name: d.name ?? '(unnamed)',
    category: d.category ?? 'unknown',
    fineTuningAllowed: Boolean(d.fine_tuning?.is_allowed_to_fine_tune),
    // A PVC run reports `processing` then `is_allowed_to_use`; an instant clone reports nothing at all, and
    // **"nothing" here means ready, not pending** — which is the opposite of what a polling loop assumes.
    fineTuningState: state && typeof state === 'object' && Object.keys(state).length > 0 ? String(state.status ?? 'unknown') : null,
  };
}

/**
 * What the account can and cannot do, so the interface can say so rather than offering a button that fails.
 */
export async function subscription(): Promise<{ tier: string; used: number; limit: number; pvc: boolean } | null> {
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': key } });
  if (!res.ok) return null;
  const d = (await res.json()) as { tier?: string; character_count?: number; character_limit?: number };
  const tier = d.tier ?? 'unknown';
  return {
    tier,
    used: d.character_count ?? 0,
    limit: d.character_limit ?? 0,
    pvc: ['creator', 'pro', 'scale', 'business', 'enterprise'].includes(tier),
  };
}

/**
 * Remove background sound from one recording.
 *
 * **The endpoint is `/v1/audio-isolation`.** It takes the file as multipart and returns audio/mpeg; a request
 * with no file gets a 422, which is how the endpoint was told apart from the one that does not exist.
 */
export async function isolateAudio(filePath: string): Promise<Buffer> {
  const key = apiKey();
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(readFileSync(filePath))]), 'recording.m4a');
  const res = await fetch(`${API}/v1/audio-isolation`, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
  });
  if (!res.ok) throw new Error(`isolation failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Speak a script.
 *
 * **`/v1/text-to-speech/{voice_id}` and not `/v1/voices/{voice_id}/stream`**, which does not exist — the same
 * class of mistake as the isolator's name. The streaming variant is the same path with `/stream` after it, and
 * is used when the text is long enough that waiting for the whole render would time out.
 */
/**
 * THE MOST TEXT ONE REQUEST WILL TAKE.
 *
 * Measured, not guessed: a 11,418-character script was refused with
 *
 *   {"code":"text_too_long","message":"Request text length (11418) exceeds the maximum text length of
 *    10000 characters. Please use Studio for long form TTS."}
 *
 * **And that is an ordinary article.** The folklore collection that produced it is fourteen minutes read
 * aloud. A pipeline that only handles ten thousand characters handles the shortest third of this archive and
 * fails on everything a listener would most want.
 *
 * The ceiling is set below the real limit on purpose: **a chunk is measured in characters and the API measures
 * something close to them, but not the same thing**, and a chunk that is a few characters over fails the whole
 * render.
 */
const MAX_CHARS = 9_000;

/**
 * Split a script into pieces the API will accept, **at paragraph boundaries and never mid-sentence**.
 *
 * Cutting at a character count would break a sentence in half, and the two halves would be spoken as one
 * sentence with a seam through it — **audible, and impossible to fix afterwards, because the audio is the only
 * record of where the cut was.** A paragraph break is where a reader would pause anyway.
 *
 * A single paragraph longer than the ceiling is split at the last sentence end before it, and only if a
 * sentence is itself too long is the cut made mid-sentence — **which is stated rather than silent.**
 */
export function chunkScript(script: string, max = MAX_CHARS): string[] {
  const paras = script.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paras) {
    if (para.length > max) {
      push();
      // A single enormous paragraph: break it at sentence ends.
      const sentences = para.match(/[^.!?]+[.!?]+["\u2019\u201d)]?\s*/g) ?? [para];
      for (const sentence of sentences) {
        if ((current + sentence).length > max) push();
        if (sentence.length > max) {
          // Even one sentence is too long. This is logged by the caller as a seam.
          for (let i = 0; i < sentence.length; i += max) {
            push();
            chunks.push(sentence.slice(i, i + max).trim());
          }
        } else {
          current += sentence;
        }
      }
      push();
      continue;
    }
    if ((current + '\n\n' + para).length > max) push();
    current += (current ? '\n\n' : '') + para;
  }
  push();
  return chunks;
}

/**
 * Speak a script of any length.
 *
 * **Rendered in pieces and joined, because one request will not take a whole article.** Each piece is a
 * paragraph-aligned chunk from `chunkScript`, and the MP3s are concatenated — which is valid for the constant
 * bitrate MP3 the API returns.
 *
 * A failed piece fails the render. **It does not return the pieces that succeeded**, because a spoken record
 * that stops three quarters of the way through sounds like a finished one that ended oddly.
 */
export async function speak(script: string, voiceId: string, opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}): Promise<Buffer> {
  const key = apiKey();
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');

  const chunks = chunkScript(script);
  const parts: Buffer[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const res = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: chunks[i], model_id: NARRATION_MODEL, voice_settings: NARRATION_SETTINGS }),
      signal: opts.signal,
    });
    if (!res.ok) {
      throw new Error(
        `narration failed on piece ${i + 1} of ${chunks.length}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`
      );
    }
    parts.push(Buffer.from(await res.arrayBuffer()));
    opts.onProgress?.(i + 1, chunks.length);
  }
  // An MP3 is a stream of frames, so the pieces play as one file. The API returns constant-bitrate MP3.
  return Buffer.concat(parts);
}
