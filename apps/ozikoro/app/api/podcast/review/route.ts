/**
 * /api/podcast/review — the queue, and the three decisions a reviewer makes on a rendered take.
 *
 * GET  the proposals and the rendered takes waiting for a person, with the account's live allowance.
 * POST one of:
 *
 *   { "action": "publish",  "slug": "…", "note": "…" }   → published. **This is what makes the player appear.**
 *   { "action": "reject",   "slug": "…", "note": "…", "script": "…" }  → corrections, script saved as a new revision
 *   { "action": "correct",  "slug": "…", "script": "…" }               → edit the script, no render
 *
 * WHY `publish` LIVES HERE AND NOT ON A SEPARATE ROUTE
 *
 * The article page offers audio for exactly one status, `published`, so this single transition is the whole of
 * "the player only shows when approved" on the server side. It is grouped with the other listen decisions
 * because they are one job — somebody listening to a take and saying yes, no, or not like that — and because
 * the capability that guards them (`review_audio`) is the same one.
 *
 * A REJECTION IS NOT AN OVERWRITE.
 *
 * The corrected script is written as a NEW row in `ozikoro_episode_revision` and the episode's own `script`
 * column is moved to point at it. **The version that was rendered is still there**, so the rejected take can be
 * returned to, and "what exactly was said" has an answer for every version that was ever live. An episode that
 * was already published and is corrected STOPS BEING PUBLISHED: the audio no longer matches the script, and
 * leaving it on the article would put the archive's name on a recording it has just corrected.
 *
 * Gated on `review_audio` — the capability added with the editor's "special access to the audio files" in mind.
 * It opens this queue, the raw download and this publish act, and nothing else.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import {
  allowanceFrom,
  can,
  findNarrationEpisode,
  listNarrationQueue,
  narrationCounts,
  narrationDelayMinutes,
  narrationMaxAgeHours,
  publishNarrationEpisode,
  rejectNarration,
  setNarrationScript,
} from '@ozikoro/platform';
import { subscription } from '@/lib/elevenlabs';
import { getCurrentAccount } from '@/lib/session';
import { sameOrigin } from '@/lib/access';
import { answerAction, guardNarration, memberErrorOutcome, readAction } from '@/lib/narration-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const current = await getCurrentAccount();
  if (!current) return NextResponse.json({ error: 'Not signed in.' }, { status: 403 });
  const db = await getDb();
  if (!(await can(db, current.account.id, 'review_audio'))) {
    return NextResponse.json({ error: 'Needs the “review_audio” capability.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug')?.trim() || null;

  const [queue, counts] = await Promise.all([
    listNarrationQueue(db, { limit: Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50 }),
    narrationCounts(db),
  ]);

  let allowance = null;
  try {
    allowance = allowanceFrom(await subscription());
  } catch {
    allowance = null;
  }

  /*
   * A LISTING CARRIES NO SCRIPTS. An article here can be 11,000 characters and the queue can hold fifty of
   * them; **a summary route that shipped every word would be a megabyte of JSON to render a list of titles.**
   * The script is returned for one episode when `?slug=` names it, which is what the review screen reads to
   * show the approver the actual words.
   */
  const detail = slug ? await findNarrationEpisode(db, { slug }) : null;

  return NextResponse.json(
    {
      ok: true,
      counts,
      queue,
      allowance,
      delayMinutes: narrationDelayMinutes(),
      maxAgeHours: narrationMaxAgeHours(),
      detail: detail
        ? {
            episodeId: detail.id,
            slug: detail.slug,
            title: detail.title,
            status: detail.status,
            script: detail.script,
            characters: detail.charCount ?? detail.script.length,
            estimatedCredits: detail.estimatedCredits,
            hasAudio: detail.hasAudio,
            audio: detail.storageKey ? `/media/${detail.storageKey}` : detail.externalUrl,
            download: `/api/podcast/download/${detail.slug}`,
            voice: detail.voiceChoice,
          }
        : null,
      note: slug
        ? 'The full spoken script is in `detail.script` — the exact words that would be or were sent.'
        : 'Add ?slug=<article-slug> for one episode’s full script.',
    },
    { headers: { 'cache-control': 'no-store' } }
  );
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

  const action = (input.data.action ?? '').trim();
  const slug = (input.data.slug ?? '').trim();
  const episodeId = Number.parseInt(input.data.episodeId ?? '', 10);
  const key = slug ? { slug } : Number.isFinite(episodeId) ? { episodeId } : null;
  if (!key) {
    return answerAction(input, {
      ok: false, status: 400, payload: { error: 'A slug or an episodeId is required.' }, notice: 'Name the episode.',
    });
  }
  const note = (input.data.note ?? '').trim() || null;
  const script = (input.data.script ?? input.data.correctedScript ?? '').trim() || null;

  const db = await getDb();
  try {
    if (action === 'publish') {
      const published = await publishNarrationEpisode(db, { ...key, actorId: guard.actorId, note });
      return answerAction(input, {
        ok: true,
        notice:
          `“${published.title}” is PUBLISHED. The player now appears on the article and the episode is in the feed.`,
        payload: {
          ok: true,
          episodeId: published.episodeId,
          slug: published.slug,
          status: 'published',
          publishedAt: published.publishedAt,
          article: `/${published.slug}/`,
          feed: '/podcast/feed.xml',
          note: 'The article now carries the listen panel; before this it carried none.',
        },
      });
    }

    if (action === 'reject') {
      const rejected = await rejectNarration(db, { ...key, actorId: guard.actorId, note, correctedScript: script });
      return answerAction(input, {
        ok: true,
        notice:
          `“${rejected.slug}” goes back for another render` +
          (rejected.revision ? ` with the corrected script saved as revision ${rejected.revision}` : '') +
          '. Nothing was overwritten and nothing is live.',
        payload: { ok: true, ...rejected, note: 'The rendered take is kept. The player is not shown for this episode.' },
      });
    }

    if (action === 'correct') {
      if (!script) {
        return answerAction(input, {
          ok: false, status: 400, payload: { error: 'A corrected script is required.' },
          notice: 'A corrected script is required for that.',
        });
      }
      const edited = await setNarrationScript(db, { ...key, actorId: guard.actorId, script, note });
      return answerAction(input, {
        ok: true,
        notice: `The script is saved as revision ${edited.revision}. It needs a render before it can go live.`,
        payload: { ok: true, ...edited },
      });
    }

    return answerAction(input, {
      ok: false, status: 400,
      payload: { error: 'action must be “publish”, “reject” or “correct”.', actions: ['publish', 'reject', 'correct'] },
      notice: 'That action is not one of publish, reject or correct.',
    });
  } catch (error) {
    return answerAction(input, memberErrorOutcome(error));
  }
}
