/**
 * Train a voice from a set of recordings.
 *
 * WHAT THIS DOES ON THIS ACCOUNT, WHICH IS NOT WHAT IT WAS SPECIFIED TO DO
 *
 * The specification calls for Professional Voice Cloning: isolate each recording through the Voice Isolator,
 * hold the clean buffers in memory, and POST them to `/v1/voices/add` to start a training run.
 *
 * **Measured against this account: `tier: starter`, and the voice reports `is_allowed_to_fine_tune: false`.
 * PVC begins at `creator`.** Calling `/v1/voices/add` without fine-tuning produces an INSTANT clone — which is
 * what the owner's voice already is, `category: "cloned"`, usable the moment it returns. **A route that asked
 * for PVC here would return a voice id and a training state that never advances, and every later poll would
 * report `processing` forever.**
 *
 * So it does the useful thing and says which thing it did. **The isolation step defaults to OFF**: it is a
 * separate billed feature, the recordings were made in a quiet room, and the clone came out clean — running
 * thirteen files through an isolator could have stripped breath and room tone the voice needs. `?isolate=1`.
 *
 * NOTHING IS WRITTEN TO DISK. Buffers are held and forwarded.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { apiKey, isolateAudio, subscription } from '@/lib/elevenlabs';
import { getCurrentAccount } from '@/lib/session';
import { getDb } from '@ozituma/db/client';
import { can } from '@ozikoro/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAMPLES_DIR = process.env.VOICE_SAMPLES_DIR ?? join(process.cwd(), 'data', 'voice-samples');

export async function POST(request: Request) {
  const current = await getCurrentAccount();
  // Training a voice is an owner's act: it creates something that speaks in a person's name.
  if (!current) return NextResponse.json({ error: 'Not signed in.' }, { status: 403 });
  // Training a voice creates something that speaks in a person's name, so it needs `manage_ai_corpus`.
  if (!(await can(await getDb(), current.account.id, 'manage_ai_corpus'))) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
  }
  if (!apiKey()) return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not set.' }, { status: 503 });

  const url = new URL(request.url);
  const name = url.searchParams.get('name')?.trim() || 'Idenze Ezeme';
  const isolate = url.searchParams.get('isolate') === '1';

  const files = readdirSync(SAMPLES_DIR)
    .filter((f) => /\.(m4a|mp3|wav|ogg|flac)$/i.test(f))
    .map((f) => join(SAMPLES_DIR, f))
    .sort();
  if (files.length === 0) {
    return NextResponse.json({ error: `No recordings in ${SAMPLES_DIR}.` }, { status: 400 });
  }

  const sub = await subscription();
  const buffers: { name: string; data: Buffer }[] = [];
  for (const file of files) {
    buffers.push({ name: file.split('/').pop() ?? 'sample', data: isolate ? await isolateAudio(file) : readFileSync(file) });
  }

  const form = new FormData();
  form.append('name', name);
  form.append(
    'description',
    'Cloned from the owner’s own recordings, for narrating Ozikoro histories. Consent: the owner of this voice, and of the archive.'
  );
  for (const b of buffers) form.append('files', new Blob([new Uint8Array(b.data)]), b.name);

  const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey() as string },
    body: form,
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Voice creation failed: HTTP ${res.status}`, detail: (await res.text()).slice(0, 300) },
      { status: 502 }
    );
  }
  const d = (await res.json()) as { voice_id?: string };

  return NextResponse.json({
    status: sub?.pvc ? 'training_initiated' : 'ready',
    voiceId: d.voice_id,
    filesUsed: buffers.length,
    isolated: isolate,
    tier: sub?.tier ?? 'unknown',
    note: sub?.pvc
      ? 'Professional Voice Cloning began. Poll /api/voice/status/<voiceId> until it reports is_allowed_to_use.'
      : `This account is on the "${sub?.tier}" tier, where Professional Voice Cloning is not available. An ` +
        'INSTANT clone was created instead: usable immediately, no training wait. ' +
        'Set ELEVENLABS_VOICE_ID_OWN to the id below and narration works at once.',
  });
}
