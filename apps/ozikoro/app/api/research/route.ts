/**
 * POST /api/research — the research network's own actions.
 *
 * One endpoint, for the reason the archive's is one: every action is a person filling in a form, and
 * separate files would be separate places for the capability check to drift. The check is first and
 * nothing runs without it.
 *
 * Three capabilities gate three different acts, and they are deliberately not the same one:
 *   * `submit_work` lets a person create and submit their own work — student, teacher, researcher
 *     and independent researcher all hold it.
 *   * `review_queue` lets an editor screen a work, send it out and move it along.
 *   * `expert_review` lets a reviewer complete the review they were assigned.
 *
 * The state machine enforces the order; this route only asks which capability the destination state
 * requires, so the two cannot disagree about who may do what.
 */
import { getDb } from '@ozituma/db/client';
import {
  MemberError,
  assignReview,
  capabilityForTransition,
  completeReview,
  createPublication,
  revisePublication,
  transitionPublication,
  type PublicationState,
} from '@ozikoro/platform';
import { redirectTo, requireCapability, sameOrigin, jsonError } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();

  /*
   * Cross-site form submissions are refused.
   *
   * The session cookie is `SameSite=Lax`, which already stops a browser sending it on a cross-site
   * POST — so this is defence in depth rather than the only protection. It is added because the four
   * Spotify and auth endpoints already do exactly this, and a state-changing route that omits it
   * relies entirely on a cookie attribute continuing to be set correctly in every environment.
   */
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const text = (name: string, max = 400) => String(form.get(name) ?? '').trim().slice(0, max);
  const num = (name: string): number | null => {
    const raw = form.get(name);
    if (raw === null || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const list = (name: string) =>
    text(name, 1000).split(',').map((v) => v.trim()).filter(Boolean).slice(0, 30);

  const action = text('action', 40);
  const backTo = text('returnTo', 200) || '/submit/';

  // Which capability this action needs, decided before anything is read, so a refusal costs nothing
  // and cannot half-apply.
  const capability =
    action === 'create' || action === 'revise' ? 'submit_work'
    : action === 'complete-review' ? 'expert_review'
    : action === 'transition' ? capabilityForTransition((text('to', 40) || 'submitted') as PublicationState)
    : action === 'assign-review' ? 'review_queue'
    : 'submit_work';

  const guard = await requireCapability(capability, { returnTo: backTo });
  if (!guard.ok) return guard.response;
  const actorId = guard.account.account.id;

  const db = await getDb();

  try {
    if (action === 'create') {
      const authorNames = list('authors');
      if (authorNames.length === 0) return redirectTo('/submit/', { error: 'A work needs at least one author.' });

      const publicationId = await createPublication(db, {
        author: { accountId: actorId, name: guard.account.account.displayName ?? guard.account.account.email },
        publication: {
          title: text('title', 400),
          abstract: text('abstract', 5000) || null,
          kind: text('kind', 40) || 'journal_article',
          disciplines: list('disciplines'),
          keywords: list('keywords'),
          authors: authorNames.map((name, i) => ({
            name,
            // The submitting account owns the first author row, so the work appears on their profile
            // without the form having to ask them who they are.
            ...(i === 0 ? { accountId: actorId, isCorresponding: true } : {}),
          })),
          doi: text('doi', 120) || null,
          journal: text('journal', 200) || null,
          volume: text('volume', 20) || null,
          issue: text('issue', 20) || null,
          pages: text('pages', 40) || null,
          publisher: text('publisher', 200) || null,
          licence: text('licence', 200) || null,
        },
      });

      // Creating and submitting are two steps on purpose: a draft is private and a submission is not,
      // and collapsing them would mean every abandoned form had been "submitted".
      const wantsSubmit = text('submit', 4) === '1';
      if (wantsSubmit) {
        await transitionPublication(db, { publicationId, to: 'submitted', actorId, capabilities: guard.capabilities });
      }
      return redirectTo('/submit/', {
        saved: wantsSubmit ? 'Submitted. An editor will screen it.' : 'Saved as a draft. Nobody else can see it.',
      });
    }

    if (action === 'transition') {
      await transitionPublication(db, {
        publicationId: Number(form.get('publicationId')),
        to: text('to', 40) as PublicationState,
        actorId,
        capabilities: guard.capabilities,
        note: text('note', 500) || null,
      });
      return redirectTo(backTo, { saved: 'Moved on.' });
    }

    if (action === 'assign-review') {
      const reviewerId = num('reviewerId');
      if (reviewerId === null) return redirectTo(backTo, { error: 'Choose a reviewer.' });
      await assignReview(db, {
        publicationId: Number(form.get('publicationId')),
        reviewerId,
        kind: (text('kind', 20) || 'expert') as 'editorial' | 'expert' | 'statistical' | 'community',
        actorId,
      });
      return redirectTo(backTo, { saved: 'Reviewer assigned.' });
    }

    if (action === 'complete-review') {
      await completeReview(db, {
        reviewId: Number(form.get('reviewId')),
        reviewerId: actorId,
        capabilities: guard.capabilities,
        recommendation: text('recommendation', 30) as 'accept' | 'minor_revision' | 'major_revision' | 'reject' | 'abstain',
        comments: text('comments', 5000) || null,
        privateComments: text('privateComments', 5000) || null,
      });
      return redirectTo('/reviews/', { saved: 'Review submitted. The editor can see it.' });
    }

    if (action === 'revise') {
      const version = await revisePublication(db, {
        publicationId: Number(form.get('publicationId')),
        title: text('title', 400),
        abstract: text('abstract', 5000) || null,
        changeNote: text('changeNote', 500) || 'Revision',
        actorId,
      });
      return redirectTo(backTo, { saved: `Saved as version ${version}. The earlier version is kept.` });
    }

    return redirectTo(backTo, { error: 'That action is not one this form offers.' });
  } catch (error) {
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[research]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That could not be saved. Nothing was changed.' });
  }
}
