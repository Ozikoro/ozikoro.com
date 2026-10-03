/**
 * POST /api/podcast/generate — kept, and now a THIN ALIAS for rendering an approved proposal.
 *
 * WHAT CHANGED, AND WHY IT HAD TO
 *
 * This route used to prepare a record's words, render them, and record a `pending_review` episode in one call.
 * **That made it a path to a charge with no approval in front of it** — and the owner's rule is that *every*
 * audio embarked on must be approved first, because the whole reason for the approval step is that the render
 * is what costs the credits. A review gate on publication cannot fix that: by the time an episode is
 * `pending_review` the money is already gone.
 *
 * So the URL and the request body are unchanged, and the behaviour is not: it now REFUSES a record that has no
 * proposal, and otherwise delegates to the same renderer `approve-proposal` uses. **One render path, not two**
 * — a second path is exactly how the gate gets bypassed by the next caller who finds the shorter route.
 *
 * The capability moved with it: `publish` (which editors hold) is the gate for putting a record out, and the
 * gate for spending money on the AI is `manage_ai_corpus`, which only an administrator or the owner holds.
 *
 * THE SEQUENCE
 *
 *   POST /api/podcast/propose            spends nothing, shows the script and the cost
 *   POST /api/podcast/approve-proposal   renders it — this is where a credit is spent
 *   POST /api/podcast/review             { "action": "publish" } — this is what makes the player appear
 *
 * THIS ROUTE DOES NOT PUBLISH, AND THAT WAS ALREADY TRUE.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { can, isNarrationVoice } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';
import { renderProposedNarration } from '@/lib/render-episode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A ten-minute render does not fit a default timeout. */
export const maxDuration = 300;

export async function POST(request: Request) {
  const current = await getCurrentAccount();
  if (!current) return NextResponse.json({ error: 'Not signed in.' }, { status: 403 });

  const db = await getDb();
  if (!(await can(db, current.account.id, 'manage_ai_corpus'))) {
    return NextResponse.json(
      {
        error: 'Rendering spends credits, and that needs the “manage ai corpus” permission.',
        instead: 'POST /api/podcast/propose records the script and the cost without spending anything.',
      },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { slug?: string; voice?: string; note?: string };
  const slug = body.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'A slug is required.' }, { status: 400 });

  const voice = body.voice?.trim();
  if (voice && !isNarrationVoice(voice)) {
    return NextResponse.json({ error: 'voice must be “own” or “generic”.' }, { status: 400 });
  }

  const result = await renderProposedNarration(db, {
    slug,
    actorId: current.account.id,
    ...(voice && isNarrationVoice(voice) ? { voice } : {}),
    note: body.note?.trim() || null,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        ...(result.code === 'no_episode'
          ? { propose: `POST /api/podcast/propose { "slug": "${slug}" } — it spends nothing.` }
          : {}),
        ...(result.details ?? {}),
      },
      { status: result.status }
    );
  }

  return NextResponse.json({
    status: result.status,
    episodeId: result.episodeId,
    audio: result.audioUrl,
    download: `/api/podcast/download/${result.slug}`,
    seconds: result.durationSeconds,
    bytes: result.bytes,
    characters: result.characters,
    estimatedCredits: result.estimatedCredits,
    measuredCredits: result.measuredCredits,
    revision: result.revision,
    narrator: result.voice,
    published: false,
    note: 'Nothing is in the feed, and nothing is on the article, until this is approved.',
  });
}

/** A caller that sends no body is told the sequence rather than left guessing at a 400. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: 'Use POST.',
      body: { slug: '<article-slug>', voice: 'own' },
      before: 'POST /api/podcast/propose — it spends nothing and shows the script and the cost.',
      after: 'POST /api/podcast/review { "action": "publish", "slug": "…" } — the player appears.',
    },
    { status: 405, headers: { 'cache-control': 'no-store' } }
  );
}
