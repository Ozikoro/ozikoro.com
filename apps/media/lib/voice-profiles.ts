/**
 * Voice profiles: the owner's own recordings, made into something a model can condition on.
 *
 * WHAT A "VOICE" IS HERE
 *
 * A directory holding a finished 24 kHz mono WAV and a small JSON record describing it. Nothing is
 * trained and nothing is uploaded: F5-TTS is a **zero-shot** cloner, so a voice is a reference clip plus
 * exactly one thing the model cannot infer — **what the speaker is saying in it**.
 *
 * WHY THE TRANSCRIPT IS REQUIRED AND NOT GUESSED
 *
 * The model conditions on the reference audio *and its transcript together*; the transcript is how it
 * aligns the new text to the voice. Without it there are only two honest options: refuse, or run an ASR
 * model to transcribe. This service refuses. **Transcribing the owner's Igbo recordings with an English
 * or Mandarin ASR model would produce a wrong transcript, and a wrong transcript does not fail — it
 * quietly produces a voice conditioned on words nobody said**, which is a defect that only shows up in
 * the audio and cannot be seen in the code.
 *
 * So `POST /voices` accepts a transcript. When it is absent the profile is still stored — the audio is
 * the irreplaceable part and the conversion work is real — but it is marked `needs_transcript` and every
 * attempt to speak with it fails with that reason rather than producing a guess.
 *
 * WHY THE ORIGINAL RECORDING IS KEPT
 *
 * The conversion to WAV is lossy in the sense that it resamples, and if the target rate ever changes the
 * conversion must be redone. Keeping the original means the profile is re-derivable. It is also the
 * owner's own voice, which is not something to delete in favour of a derived copy.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { toModelWav, wavDurationSeconds } from './audio.ts';
import { MediaError } from './errors.ts';

/** A profile as stored on disk. `version` so a later change can migrate rather than guess. */
export type VoiceProfile = {
  version: 1;
  /** URL-safe identifier. The folder name and the `voice` field of `POST /speak`. */
  name: string;
  /** Human label, for a picker. */
  label: string;
  /** The reference clip the model actually reads. Always 24 kHz mono PCM. */
  referenceAudio: string;
  /** What the speaker says in `referenceAudio`. **Null means the voice cannot speak yet.** */
  referenceText: string | null;
  /** Second reference clip, when the voice was registered from more than one recording. */
  referenceAudio2: string | null;
  referenceText2: string | null;
  /** Total seconds of reference audio available. */
  durationSeconds: number;
  /** The originals, kept so the profile can be rebuilt. */
  sources: { path: string; originalName: string; bytes: number; durationSeconds: number | null }[];
  /** Model this profile was prepared for. A profile made for the local engine is not an ElevenLabs voice. */
  engine: 'local';
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  /** The state the service acts on. Never inferred at read time from other fields. */
  status: VoiceStatus;
};

/**
 * `ready` is the only state in which synthesis is attempted.
 *
 * `needs_transcript` is a real, common state and is spelled out rather than left as "incomplete",
 * because the fix is specific: supply the words that are spoken in the clip.
 */
export type VoiceStatus = 'ready' | 'needs_transcript';

export type VoiceSummary = {
  name: string;
  label: string;
  status: VoiceStatus;
  durationSeconds: number;
  /** True when a reference transcript exists, so the voice can actually be used. */
  speakable: boolean;
  engine: 'local';
  createdAt: string;
  referenceAudio: string;
};

/** Where profiles live. Inside the app so a deploy carries them; overridable for tests. */
export function profilesRoot(): string {
  return process.env.OZIKORO_MEDIA_VOICES_DIR ?? join(import.meta.dirname, '..', 'voice-profiles');
}

/** Reject anything that could escape the profiles directory. A `name` becomes a path segment. */
export function assertSafeName(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed) || trimmed.includes('..')) {
    throw new MediaError({
      code: 'bad_request',
      message:
        `invalid voice name ${JSON.stringify(name)}: use letters, digits, dot, dash or underscore, ` +
        `starting with a letter or digit. It becomes a directory name, so path separators are refused.`,
      status: 400,
    });
  }
  return trimmed;
}

function profilePath(name: string): string {
  return join(profilesRoot(), name, 'profile.json');
}

function readProfile(name: string): VoiceProfile | null {
  const path = profilePath(name);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as VoiceProfile;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    // A corrupt profile.json is reported as "not found" to the caller, which is honest — but the file is
    // left on disk so it can be inspected rather than silently destroyed.
    return null;
  }
}

/**
 * Apply the status rule in one place.
 *
 * A profile with no transcript is `needs_transcript` even if the file on disk says otherwise, because
 * the file may have been written by an older version of this code. **Deriving the usable state from the
 * facts, rather than trusting a stored field, is what stops a stale `ready` reaching the model.**
 */
function withStatus(profile: VoiceProfile): VoiceProfile {
  const speakable = Boolean(profile.referenceText && profile.referenceText.trim().length > 0);
  return { ...profile, status: speakable ? 'ready' : 'needs_transcript' };
}

export function listVoices(): VoiceSummary[] {
  const root = profilesRoot();
  if (!existsSync(root)) return [];
  const out: VoiceSummary[] = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('.')) continue;
    const dir = join(root, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const raw = readProfile(entry);
    if (!raw) continue;
    const profile = withStatus(raw);
    out.push({
      name: profile.name,
      label: profile.label,
      status: profile.status,
      durationSeconds: profile.durationSeconds,
      speakable: profile.status === 'ready',
      engine: profile.engine,
      createdAt: profile.createdAt,
      referenceAudio: profile.referenceAudio,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getVoice(name: string): VoiceProfile {
  const safe = assertSafeName(name);
  const raw = readProfile(safe);
  if (!raw) {
    throw new MediaError({
      code: 'unknown_voice',
      message:
        `voice ${JSON.stringify(safe)} is not registered. Registered voices: ` +
        `${listVoices().map((v) => v.name).join(', ') || '(none)'}.`,
      status: 404,
      details: { voicesDirectory: profilesRoot() },
    });
  }
  return withStatus(raw);
}

/** The profile a synthesis call needs, with the transcript failure raised here rather than at the model. */
export function getSpeakableVoice(name: string): VoiceProfile {
  const profile = getVoice(name);
  if (profile.status !== 'ready') {
    throw new MediaError({
      code: 'unknown_voice',
      message:
        `voice ${JSON.stringify(profile.name)} has no reference transcript, so it cannot be used to speak. ` +
        `F5-TTS conditions on the words in the reference clip; guessing them would condition the voice on ` +
        `words nobody said. Supply referenceText (or re-register with one).`,
      status: 409,
      engine: 'local',
      details: { voice: profile.name, referenceAudio: profile.referenceAudio, status: profile.status },
    });
  }
  return profile;
}

export type RegisterInput = {
  name: string;
  label?: string | null;
  /** Raw uploaded clips, in order. The first becomes the primary reference. */
  clips: { originalName: string; data: Buffer }[];
  /** What is said in the first clip. */
  referenceText?: string | null;
  referenceText2?: string | null;
  notes?: string | null;
  /** Replace an existing profile of the same name. */
  replace?: boolean;
};

/**
 * Register a voice from one or more recordings.
 *
 * The files are written and converted **before** the profile is published. The record is written to a
 * temporary path and renamed into place at the end, so a failure halfway through leaves the previous
 * profile intact rather than a half-written one that lists audio which does not exist. **A profile that
 * points at a missing file is the failure mode worth designing against**, because the error surfaces
 * later, at synthesis time, far from the registration that caused it.
 */
export async function registerVoice(input: RegisterInput): Promise<VoiceProfile> {
  const name = assertSafeName(input.name);
  if (input.clips.length === 0) {
    throw new MediaError({
      code: 'bad_request',
      message: 'no reference audio supplied: at least one clip is required to register a voice',
      status: 400,
    });
  }

  const root = profilesRoot();
  const dir = join(root, name);
  const existing = readProfile(name);
  if (existing && !input.replace) {
    throw new MediaError({
      code: 'bad_request',
      message:
        `voice ${JSON.stringify(name)} already exists. Pass replace: true to overwrite it — the service ` +
        `will not silently discard a voice the archive may already have credited.`,
      status: 409,
      details: { existing: { createdAt: existing.createdAt, durationSeconds: existing.durationSeconds } },
    });
  }

  // A staging directory, so the publish below is a rename and not a partially-applied state.
  const staging = join(root, `.staging-${name}-${Date.now()}`);
  mkdirSync(join(staging, 'source'), { recursive: true });

  try {
    const sources: VoiceProfile['sources'] = [];
    const wavPaths: string[] = [];

    for (const [index, clip] of input.clips.entries()) {
      const original = join(staging, 'source', `${index + 1}-${basename(clip.originalName)}`);
      mkdirSync(join(staging, 'source'), { recursive: true });
      writeFileSync(original, clip.data);
      const converted = await toModelWav(original, staging);
      // `toModelWav` names the output after the input, so two clips with the same base name would
      // collide. Indexing the file removes the possibility of one clip overwriting another.
      const renamed = join(staging, `reference-${index + 1}.wav`);
      if (converted.path !== renamed) {
        // A passthrough WAV is left where it is (it is already correct); a converted one is moved.
        if (converted.passthrough) {
          writeFileSync(renamed, readFileSync(converted.path));
        } else {
          renameSync(converted.path, renamed);
        }
      }
      wavPaths.push(renamed);
      sources.push({
        path: join('source', basename(original)),
        originalName: clip.originalName,
        bytes: clip.data.length,
        durationSeconds: converted.durationSeconds,
      });
    }

    const primaryDuration = wavDurationSeconds(wavPaths[0]!) ?? 0;
    const secondaryDuration = wavPaths[1] ? (wavDurationSeconds(wavPaths[1]) ?? 0) : 0;

    const now = new Date().toISOString();
    const profile: VoiceProfile = {
      version: 1,
      name,
      label: input.label?.trim() || name,
      referenceAudio: join('reference-1.wav'),
      referenceText: input.referenceText?.trim() || null,
      referenceAudio2: wavPaths[1] ? 'reference-2.wav' : null,
      referenceText2: wavPaths[1] ? input.referenceText2?.trim() || null : null,
      durationSeconds: Math.round((primaryDuration + secondaryDuration) * 1000) / 1000,
      sources,
      engine: 'local',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      notes: input.notes?.trim() || null,
      status: 'ready',
    };

    writeFileSync(join(staging, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`);

    if (existing) rmSync(dir, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    renameSync(staging, dir);

    return withStatus({
      ...profile,
      referenceAudio: join(dir, 'reference-1.wav'),
      referenceAudio2: profile.referenceAudio2 ? join(dir, 'reference-2.wav') : null,
    });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Absolute paths to the reference clips, for the worker. */
export function voiceReferencePaths(profile: VoiceProfile): string[] {
  const dir = join(profilesRoot(), profile.name);
  const paths = [join(dir, basename(profile.referenceAudio))];
  if (profile.referenceAudio2) paths.push(join(dir, basename(profile.referenceAudio2)));
  return paths;
}

export function deleteVoice(name: string): { name: string; deleted: boolean } {
  const safe = assertSafeName(name);
  const dir = join(profilesRoot(), safe);
  if (!existsSync(profilePath(safe))) {
    throw new MediaError({
      code: 'unknown_voice',
      message: `voice ${JSON.stringify(safe)} is not registered, so there is nothing to delete`,
      status: 404,
    });
  }
  rmSync(dir, { recursive: true, force: true });
  return { name: safe, deleted: true };
}
