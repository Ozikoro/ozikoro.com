/**
 * POST /api/podcast/sweep — propose narration for records that went live a few minutes ago.
 *
 * WHY A ROUTE AND A SCRIPT RATHER THAN A TIMER
 *
 * The ways an article reaches `published` were traced before this was written: `updateArticleFacets` sets the
 * status from the editorial form, and the importers set it during migration. **There is no worker, no queue,
 * no cron entry and no `setInterval` anywhere in this repository** — the only recurring thing in the tree is
 * the browser's own spaced-repetition queue, which is client-side and not a job runner.
 *
 * So the work is an idempotent function, exposed twice. **A `setTimeout` in an application process would be
 * worse than useless**: it would exist only while one Node process happened to stay alive, and a proposal that
 * silently stops appearing after a restart is harder to notice than one that was never automatic. A real cron
 * entry is the honest answer until a scheduler exists, and `node scripts/narration-review.ts sweep` is that
 * cron entry.
 *
 * WHAT THIS ROUTE IS FOR: a reviewer who presses "catch up now" — after a deploy, after a cron gap, or to see
 * the queue move without waiting.
 *
 * IDEMPOTENT. Running it twice proposes nothing the second time: the anti-join selects records with no episode
 * row, and a proposal IS that row. A declined record keeps its row, so a question a person has answered is
 * never asked again. **It cannot double-spend, because it cannot spend at all** — it only creates proposals.
 *
 * Gated on `review_audio`: proposing is review work and costs nothing. Note the deliberate asymmetry — the
 * capability that spends credits (`manage_ai_corpus`) is checked by `approve-proposal`, never here.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { isNarrationVoice, sweepNarrationProposals } from '@ozikoro/platform';
import { sameOrigin } from '@/lib/access';
import { answerAction, guardNarration, readAction } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A field that is absent leaves the default in place; a field that is present and nonsense is refused. */
function optionalInt(raw: string | undefined, min: number, max: number): number | undefined | null {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export async function POST(request: Request): Promise<Response> {
  const input = await readAction(request);
  if (!sameOrigin(request)) {
    return answerAction(input, {
      ok: false, status: 403, payload: { error: 'cross_origin' }, notice: 'That request did not come from this site.',
    });
  }

  const guard = await guardNarration(input, 'review_audio');
  if (!guard.ok) return guard.response;

  const limit = optionalInt(input.data.limit, 1, 200);
  const delayMinutes = optionalInt(input.data.delayMinutes, 0, 10_080);
  const maxAgeHours = optionalInt(input.data.maxAgeHours, 1, 24 * 365);
  if (limit === null || delayMinutes === null || maxAgeHours === null) {
    return answerAction(input, {
      ok: false, status: 400,
      payload: { error: 'limit 1–200, delayMinutes 0–10080, maxAgeHours 1–8760.' },
      notice: 'One of those numbers is out of range.',
    });
  }

  const voiceRaw = (input.data.voice ?? '').trim();
  if (voiceRaw && !isNarrationVoice(voiceRaw)) {
    return answerAction(input, {
      ok: false, status: 400, payload: { error: 'voice must be “own” or “generic”.' },
      notice: 'The voice must be “own” or “generic”.',
    });
  }

  // An explicit `since` is a deliberate backfill and overrides the max-age window — the window exists to stop
  // the AUTOMATIC sweep proposing for the whole archive, and an operator asking for it by hand is a different act.
  const sinceRaw = (input.data.since ?? '').trim();
  let since: string | null = null;
  if (sinceRaw) {
    const parsed = new Date(sinceRaw);
    if (Number.isNaN(parsed.getTime())) {
      return answerAction(input, {
        ok: false, status: 400, payload: { error: 'since must be an ISO date.' }, notice: 'That is not a date.',
      });
    }
    since = parsed.toISOString();
  }

  const db = await getDb();
  const outcome = await sweepNarrationProposals(db, {
    actorId: guard.actorId,
    ...(limit !== undefined ? { limit } : {}),
    ...(delayMinutes !== undefined ? { delayMinutes } : {}),
    ...(maxAgeHours !== undefined ? { maxAgeHours } : {}),
    ...(voiceRaw && isNarrationVoice(voiceRaw) ? { voice: voiceRaw } : {}),
    ...(since ? { since } : {}),
  });

  const credits = outcome.proposed.reduce((sum, p) => sum + p.estimatedCredits, 0);
  return answerAction(input, {
    ok: true,
    notice:
      outcome.proposed.length === 0
        ? `Nothing to propose: ${outcome.considered} record(s) were in the window and all of them already have an episode.`
        : `Proposed ${outcome.proposed.length} narration(s), about ${credits.toLocaleString('en-GB')} credits at the ` +
          'estimate. NOTHING WAS RENDERED AND NO CREDITS WERE SPENT.',
    payload: {
      ok: true,
      ...outcome,
      estimatedCredits: credits,
      rendered: false,
      spentCredits: 0,
      schedule:
        'No scheduler exists in this repository. Run `node scripts/narration-review.ts sweep` from cron until one does.',
    },
  });
}

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: 'Use POST.',
      body: { limit: 5, voice: 'own', since: 'optional ISO date, overrides the max-age window' },
      schedule: 'No scheduler exists in this repository. Run `node scripts/narration-review.ts sweep` from cron.',
    },
    { status: 405, headers: { 'cache-control': 'no-store' } }
  );
}
