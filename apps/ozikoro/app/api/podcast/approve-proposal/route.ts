/**
 * POST /api/podcast/approve-proposal — render an approved proposal. THIS IS WHERE A CREDIT IS SPENT.
 *
 * THE GATE, AND WHY IT IS `manage_ai_corpus` RATHER THAN `publish`
 *
 * The owner's rule is "it must ask ME for approval ... so as not to waste credits". The capability vocabulary
 * was checked before choosing one:
 *
 *   `manage_ai_corpus`  already gates the AI narration spend — it is what `/api/voice/pvc-initiate` requires to
 *                       train a voice. **It is held by admin and owner and by nobody else**, which is exactly
 *                       "ask me before spending on the AI".
 *   `publish`           is held by editors as well, and it answers "may this record go out", not "may this
 *                       money be spent". An editor already has it, so gating the render on `publish` would let
 *                       every editor authorise a charge the owner asked to approve personally.
 *   `review_audio`      is the NEW capability this work adds for the editor the owner described. It opens the
 *                       review queue and the raw download, and it deliberately does NOT authorise a spend —
 *                       "special access to the audio files, and nothing wider".
 *
 * So the sequence the owner asked for is: the sweep (or an editor) PROPOSES at no cost with `review_audio`; the
 * owner or an admin APPROVES the charge with `manage_ai_corpus`; the render happens; the episode lands in
 * `pending_review`; and an editor with `review_audio` approves the listen, which is what puts it on the article.
 *
 * A REJECTED PROPOSAL COSTS NOTHING BECAUSE NOTHING RAN. `decline-proposal` never reaches this file.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { isNarrationVoice } from '@ozikoro/platform';
import { sameOrigin } from '@/lib/access';
import { renderProposedNarration } from '@/lib/render-episode';
import { answerAction, guardNarration, readAction } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A ten-minute render does not fit a default timeout. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const input = await readAction(request);
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false, status: 403, payload: { error: 'cross_origin' }, notice: 'That request did not come from this site.',
    });
  }

  const guard = await guardNarration(input, 'manage_ai_corpus');
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
  const result = await renderProposedNarration(db, {
    slug,
    actorId: guard.actorId,
    ...(voiceRaw && isNarrationVoice(voiceRaw) ? { voice: voiceRaw } : {}),
    note: (input.data.note ?? '').trim() || null,
  });

  if (!result.ok) {
    return answerAction(input, {
      ok: false,
      status: result.status,
      payload: { error: result.message, code: result.code, ...(result.details ?? {}) },
      notice: result.message,
    });
  }

  const charge =
    result.measuredCredits === null
      ? `Estimated ${result.estimatedCredits.toLocaleString('en-GB')} credits; the allowance could not be re-read.`
      : `Charged ${result.measuredCredits.toLocaleString('en-GB')} credits (estimate ${result.estimatedCredits.toLocaleString('en-GB')}).`;

  return answerAction(input, {
    ok: true,
    notice:
      `Rendered “${result.slug}” — ${charge} It is now AWAITING REVIEW and is not on the article or in the feed ` +
      'until somebody approves the listen.',
    payload: {
      ok: true,
      episodeId: result.episodeId,
      slug: result.slug,
      status: result.status,
      audio: result.audioUrl,
      download: `/api/podcast/download/${result.slug}`,
      bytes: result.bytes,
      characters: result.characters,
      estimatedCredits: result.estimatedCredits,
      measuredCredits: result.measuredCredits,
      revision: result.revision,
      voice: result.voice,
      durationSeconds: result.durationSeconds,
      allowance: result.allowance,
      published: false,
      note: 'Nothing is in the feed, and nothing is on the article, until this is approved.',
      next: 'POST /api/podcast/review { "action": "publish", "slug": "..." } to put it live.',
    },
  });
}

/** Without a body there is nothing to approve, and the two steps are named so a caller can find them. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: 'Use POST.',
      body: { slug: '<article-slug>', voice: 'own' },
      note: 'Requires the manage_ai_corpus capability: this is the step that spends credits.',
      before: 'POST /api/podcast/propose first — it spends nothing and shows the script and the cost.',
    },
    { status: 405, headers: { 'cache-control': 'no-store' } }
  );
}
