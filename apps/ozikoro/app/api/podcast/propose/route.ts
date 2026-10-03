/**
 * POST /api/podcast/propose — put a script and its cost in front of a person. SPENDS NOTHING.
 *
 * THE WHOLE POINT OF THIS ENDPOINT IS WHAT IT DOES NOT DO.
 *
 * A render sends the article's every word to ElevenLabs and is billed by the character. **The owner's rule is
 * that the approval has to come before that charge, not after it** — a take that is reviewed and then declined
 * has already spent the credits the review was meant to protect. So this route prepares the spoken script,
 * counts it, costs it, records it as an episode in `proposed` with no audio at all, and stops.
 *
 * It cannot render. The proposal itself is built by `proposeNarration` in `@ozikoro/platform`, which imports no
 * API client — **the no-credits rule is structural rather than a promise**, because the code that creates a
 * proposal has no way to reach `speak`.
 *
 * THE ONE CALL IT DOES MAKE IS A READ.
 *
 * `subscription()` is `GET /v1/user/subscription`: it reports the tier and the running character count so the
 * approver can see the estimate against what is actually left. **A GET spends nothing, and the difference
 * matters** — this is the same endpoint the empirical no-credits check reads before and after a proposal, and
 * it must return the same count both times.
 *
 * Gated on `review_audio`: preparing a proposal is audio review work and costs nothing. The capability that
 * authorises the SPEND is `manage_ai_corpus`, and it is checked by `approve-proposal`, not here.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { allowanceFrom, proposeNarration, isNarrationVoice } from '@ozikoro/platform';
import { subscription } from '@/lib/elevenlabs';
import { sameOrigin } from '@/lib/access';
import { answerAction, guardNarration, memberErrorOutcome, readAction } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const input = await readAction(request);
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false, status: 403, payload: { error: 'cross_origin' }, notice: 'That request did not come from this site.',
    });
  }

  const guard = await guardNarration(input, 'review_audio');
  if (!guard.ok) return guard.response;

  const slug = (input.data.slug ?? '').trim();
  if (!slug) {
    return answerAction(input, {
      ok: false, status: 400, payload: { error: 'A record slug is required.' }, notice: 'A record slug is required.',
    });
  }
  const voiceRaw = (input.data.voice ?? '').trim();
  if (voiceRaw && !isNarrationVoice(voiceRaw)) {
    return answerAction(input, {
      ok: false, status: 400, payload: { error: 'voice must be “own” or “generic”.' },
      notice: 'The voice must be “own” or “generic”.',
    });
  }

  const db = await getDb();
  try {
    const proposal = await proposeNarration(db, {
      slug,
      actorId: guard.actorId,
      ...(voiceRaw && isNarrationVoice(voiceRaw) ? { voice: voiceRaw } : {}),
      note: (input.data.note ?? '').trim() || null,
    });

    // Read-only: the allowance this estimate would be spent against. Null when the API cannot be asked, and
    // the response says so rather than filling the gap with a number.
    let allowance = null;
    try {
      allowance = allowanceFrom(await subscription());
    } catch {
      allowance = null;
    }

    const spend = allowance === null ? 'unknown' : allowance.sufficient(proposal.characters);

    return answerAction(input, {
      ok: true,
      notice:
        `Proposed ${proposal.characters.toLocaleString('en-GB')} characters for “${proposal.title}” — about ` +
        `${proposal.estimatedCredits.toLocaleString('en-GB')} credits at the estimate. NOTHING WAS RENDERED AND ` +
        'NO CREDITS WERE SPENT.',
      payload: {
        ok: true,
        episodeId: proposal.episodeId,
        slug: proposal.slug,
        title: proposal.title,
        status: proposal.status,
        voice: proposal.voice,
        characters: proposal.characters,
        estimatedCredits: proposal.estimatedCredits,
        estimatedSeconds: proposal.estimatedSeconds,
        words: proposal.words,
        // THE ACTUAL SPOKEN SCRIPT, so the approver reads the words that would be sent and not a summary.
        script: proposal.script,
        scriptPreview: proposal.script.slice(0, 600),
        allowance,
        withinAllowance: spend,
        rendered: false,
        spentCredits: 0,
        next: `POST /api/podcast/approve-proposal { "slug": "${proposal.slug}" } to render it, ` +
          'or /api/podcast/decline-proposal to refuse it. Declining costs nothing either.',
      },
    });
  } catch (error) {
    return answerAction(input, memberErrorOutcome(error));
  }
}

/** A JSON body for a caller that sends none — a form with an empty body is still a POST. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: 'Use POST.',
      body: { slug: '<article-slug>', voice: 'own' },
      note: 'Proposing prepares the script and the cost. It renders nothing and spends nothing.',
    },
    { status: 405, headers: { 'cache-control': 'no-store' } }
  );
}
