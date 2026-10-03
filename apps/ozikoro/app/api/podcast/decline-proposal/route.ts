/**
 * POST /api/podcast/decline-proposal — refuse a proposal, and record that a person did.
 *
 * A DECLINED PROPOSAL HAS COST NOTHING, WHICH IS THE ENTIRE POINT OF THE PROPOSAL STEP.
 *
 * Nothing was rendered, so there is no audio to discard and no charge to regret. What this route does is turn a
 * decision into a row: the status becomes `declined`, the note is kept, and — because the article now has an
 * episode row — **the sweep's anti-join will never offer it again.** A pipeline that re-asks a question
 * somebody has answered is a pipeline whose notifications get ignored, and the deliberate second attempt is
 * still available by proposing the slug directly.
 *
 * Gated on `review_audio` rather than on the spending capability: deciding NOT to spend is not spending, and
 * the editor the owner gave audio access to is exactly the person who should be able to say "not this one".
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { declineNarration } from '@ozikoro/platform';
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
  const episodeId = Number.parseInt(input.data.episodeId ?? '', 10);
  if (!slug && !Number.isFinite(episodeId)) {
    return answerAction(input, {
      ok: false, status: 400, payload: { error: 'A slug or an episodeId is required.' },
      notice: 'Name the proposal to decline.',
    });
  }

  const db = await getDb();
  try {
    const declined = await declineNarration(db, {
      ...(slug ? { slug } : { episodeId }),
      actorId: guard.actorId,
      note: (input.data.note ?? '').trim() || null,
    });
    return answerAction(input, {
      ok: true,
      notice: `Declined “${declined.title}”. Nothing was rendered and no credits were spent.`,
      payload: {
        ok: true,
        episodeId: declined.episodeId,
        slug: declined.slug,
        status: 'declined',
        spentCredits: 0,
        note: 'The sweep will not propose this record again. Propose it directly to try again.',
      },
    });
  } catch (error) {
    return answerAction(input, memberErrorOutcome(error));
  }
}

export async function GET(): Promise<Response> {
  return NextResponse.json(
    { error: 'Use POST.', body: { slug: '<article-slug>', note: 'Why, for the record' } },
    { status: 405, headers: { 'cache-control': 'no-store' } }
  );
}
