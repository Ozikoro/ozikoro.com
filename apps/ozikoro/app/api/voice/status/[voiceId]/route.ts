/**
 * Whether a voice is ready to speak.
 *
 * THE THING A POLLING LOOP GETS WRONG
 *
 * The specification says to watch `fine_tuning.status` move from `processing` to `is_allowed_to_use`.
 * **On an instant clone there is no training run at all** — the voice's `fine_tuning.state` is an empty object,
 * and a loop waiting for `is_allowed_to_use` waits forever on a voice that has been ready since the moment it
 * was created.
 *
 * So the answer distinguishes the three real cases:
 *
 *   ready        an instant clone, or a finished PVC run — narration can begin now
 *   processing   a PVC run in progress
 *   unavailable  this account cannot train a professional model
 */
import { NextResponse } from 'next/server';
import { apiKey, getVoice, subscription } from '@/lib/elevenlabs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ voiceId: string }> }) {
  const { voiceId } = await params;
  if (!apiKey()) return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not set.' }, { status: 503 });

  const voice = await getVoice(voiceId);
  if (!voice) return NextResponse.json({ error: 'No such voice.' }, { status: 404 });

  const sub = await subscription();

  let state: 'ready' | 'processing' | 'unavailable';
  if (voice.category === 'cloned' || voice.category === 'premade') {
    // An instant clone or a stock voice: usable the moment it exists, whatever `fine_tuning` says.
    state = 'ready';
  } else if (voice.fineTuningState === 'processing' || voice.fineTuningState === 'fine_tuning') {
    state = 'processing';
  } else if (voice.fineTuningAllowed) {
    state = 'ready';
  } else {
    state = 'unavailable';
  }

  return NextResponse.json({
    voiceId: voice.voiceId,
    name: voice.name,
    category: voice.category,
    state,
    fineTuning: { allowed: voice.fineTuningAllowed, state: voice.fineTuningState },
    tier: sub?.tier ?? 'unknown',
    charactersRemaining: sub ? sub.limit - sub.used : null,
  });
}
