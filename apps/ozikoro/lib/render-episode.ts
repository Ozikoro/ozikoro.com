/**
 * Rendering an APPROVED proposal — the one place in this workflow that spends a credit.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE PROPOSAL
 *
 * `packages/ozikoro/src/narration.ts` creates proposals and cannot call ElevenLabs: nothing in it imports the
 * API client, so no code path from a proposal to a charge exists. **This file is the only bridge between an
 * approved proposal and `speak`, and it is deliberately the only one.** A second render path that skipped the
 * approval — a route, a script, a stray `speak` call — would be the whole rule broken in one place, so the
 * render is written once and every caller goes through it.
 *
 * THE CHECKS ARE BEFORE THE CHARGE, IN THIS ORDER:
 *
 *   1. the episode exists and is an approved-or-corrected proposal (not already rendered, not already live);
 *   2. the voice is configured, and the account is not out of allowance for this script;
 *   3. only then does anything reach the API.
 *
 * The allowance check is the owner's "so as not to waste credits", expressed as a refusal rather than a
 * warning. It is skipped when the allowance cannot be read at all — **an API outage should not block a
 * deliberate render that the account is entitled to** — and that decision is recorded in the response.
 */
import type { Db } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import {
  allowanceFrom,
  estimateNarrationCredits,
  estimateNarrationSeconds,
  findNarrationEpisode,
  isNarrationVoice,
  narrationDisclosure,
  narratorKindFor,
  recordNarrationRevision,
  type NarrationVoice,
  type NarrationAllowance,
} from '@ozikoro/platform';
import {
  NARRATION_MODEL,
  NARRATION_SETTINGS,
  configured,
  genericVoiceId,
  ownVoiceId,
  speak,
  subscription,
} from './elevenlabs.ts';

/** The statuses a render may start from. A `proposed` episode has never been rendered; the others are re-takes. */
const RENDERABLE = new Set(['proposed', 'corrections', 'failed']);

export type RenderResult =
  | {
      ok: true;
      episodeId: number;
      slug: string;
      status: 'pending_review';
      storageKey: string;
      audioUrl: string;
      bytes: number;
      characters: number;
      estimatedCredits: number;
      /** What ElevenLabs actually charged, measured as the change in `character_count`. Null when unreadable. */
      measuredCredits: number | null;
      revision: number;
      voice: NarrationVoice;
      durationSeconds: number;
      allowance: NarrationAllowance | null;
    }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

async function readAllowance(): Promise<NarrationAllowance | null> {
  try {
    return allowanceFrom(await subscription());
  } catch {
    return null;
  }
}

export async function renderProposedNarration(
  db: Db,
  input: { slug: string; actorId: number; voice?: NarrationVoice; note?: string | null }
): Promise<RenderResult> {
  if (!configured()) {
    return {
      ok: false,
      status: 503,
      code: 'not_configured',
      message: 'Narration is not configured on this deployment.',
      details: { need: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID_OWN'] },
    };
  }

  const episode = await findNarrationEpisode(db, { slug: input.slug });
  if (!episode) {
    return {
      ok: false,
      status: 404,
      code: 'no_episode',
      message: 'There is no proposal for that record. Propose a narration first — a proposal spends nothing.',
    };
  }
  if (!RENDERABLE.has(episode.status)) {
    return {
      ok: false,
      status: 409,
      code: 'not_awaiting_approval',
      message: `“${episode.title}” is “${episode.status}”. Only a proposal awaiting approval can be rendered.`,
      details: { status: episode.status, episodeId: episode.id },
    };
  }

  const voice: NarrationVoice =
    input.voice ?? (episode.voiceChoice && isNarrationVoice(episode.voiceChoice) ? episode.voiceChoice : 'own');
  const voiceId = voice === 'own' ? ownVoiceId() : genericVoiceId();
  if (!voiceId) {
    return {
      ok: false,
      status: 503,
      code: 'no_voice',
      message: `No ${voice} voice is configured.`,
      details: { need: [voice === 'own' ? 'ELEVENLABS_VOICE_ID_OWN' : 'ELEVENLABS_VOICE_ID_GENERIC'] },
    };
  }

  const script = episode.script;
  const characters = script.length;
  const estimatedCredits = estimateNarrationCredits(characters);
  const before = await readAllowance();
  const allowanceChecked = before !== null;
  if (before && !before.sufficient(characters)) {
    // **Refused, not warned about.** The whole point of costing the script in advance is that this decision
    // can be made before the charge rather than discovered on the invoice.
    return {
      ok: false,
      status: 409,
      code: 'insufficient_allowance',
      message:
        `That script is ${characters.toLocaleString('en-GB')} characters and the account has ` +
        `${before.remaining.toLocaleString('en-GB')} credits left on the ${before.tier} tier. ` +
        'Render it in a shorter form, or raise the allowance — nothing was sent.',
      details: { characters, allowance: before },
    };
  }

  let audio: Buffer;
  try {
    audio = await speak(script, voiceId);
  } catch (error) {
    return { ok: false, status: 502, code: 'render_failed', message: String(error).slice(0, 300) };
  }

  /*
   * INTO STORAGE, NOT ONTO A PATH.
   *
   * `getStorage()` is where the media route actually reads. Writing to `data/media/ozikoro-wp/` was a real
   * bug on this project: **the file was on disk, correctly named, and every request for it answered 404**,
   * because the route reads object storage and with no `S3_BUCKET` that is `.data/media`. The key shape is the
   * one `/media/<key>` already allows for episodes.
   */
  const storageKey = `ozikoro/episodes/${episode.slug}.mp3`;
  await getStorage().put(storageKey, audio, 'audio/mpeg');

  const durationSeconds = estimateNarrationSeconds(script);
  const settings = NARRATION_SETTINGS;

  await db.query(
    `update ozikoro_episode
        set status = 'pending_review', storage_key = $2, mime_type = 'audio/mpeg', byte_size = $3,
            duration_seconds = $4, script = $5, transcript = $5, char_count = $6, estimated_credits = $7,
            voice_choice = $8, narrator_kind = $9, ai_disclosure = $10,
            generator = 'elevenlabs', generator_model = $11, voice_settings = $12,
            decided_by = null, decided_at = null, updated_at = now()
      where id = $1`,
    [
      episode.id, storageKey, audio.byteLength, durationSeconds, script, characters, estimatedCredits,
      voice, narratorKindFor(voice), narrationDisclosure(voice), NARRATION_MODEL, JSON.stringify(settings),
    ]
  );

  /*
   * WHAT WAS ACTUALLY CHARGED, MEASURED RATHER THAN ASSUMED.
   *
   * The API reports a running `character_count`, so the charge is the difference across the render. **The
   * estimate shown to the approver is one credit per character; this is the record of whether that was true**,
   * and it costs one extra request on a path that has just spent far more than that. Best-effort: a failure to
   * re-read leaves the estimate as the only figure, and says so.
   */
  const after = await readAllowance();
  const measuredCredits = before && after ? Math.max(0, after.used - before.used) : null;

  const revision = await recordNarrationRevision(db, episode.id, script, {
    storageKey,
    byteSize: audio.byteLength,
    durationSeconds,
    generatorModel: NARRATION_MODEL,
    voiceSettings: settings,
    createdBy: input.actorId,
  });

  const chargeNote =
    measuredCredits === null
      ? `The account allowance could not be re-read, so only the estimate (${estimatedCredits} credits) is recorded.`
      : `Estimated ${estimatedCredits} credits; the account recorded a charge of ${measuredCredits} ` +
        `(${before?.used.toLocaleString('en-GB')} → ${after?.used.toLocaleString('en-GB')} characters).`;

  await db.query(
    `insert into ozikoro_episode_transition (episode_id, from_status, to_status, actor_account_id, note)
     values ($1,$2,'pending_review',$3,$4)`,
    [
      episode.id,
      episode.status,
      input.actorId,
      input.note?.trim() ||
        `Approved and rendered with ${voice === 'own' ? 'the owner’s trained voice' : 'a stock narrator'}. ${chargeNote}`,
    ]
  );

  return {
    ok: true,
    episodeId: episode.id,
    slug: episode.slug,
    status: 'pending_review',
    storageKey,
    audioUrl: `/media/${storageKey}`,
    bytes: audio.byteLength,
    characters,
    estimatedCredits,
    measuredCredits,
    revision,
    voice,
    durationSeconds,
    allowance: after,
  };
}
