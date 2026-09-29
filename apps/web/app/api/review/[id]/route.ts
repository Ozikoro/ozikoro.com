/**
 * POST /api/review/:id — approve or reject a submission.
 *
 * The only route in the application that can write to the published dictionary,
 * and therefore the one that matters most. It requires:
 *
 *   1. a signed-in account,
 *   2. the `editor` or `admin` role,
 *   3. a submission that is still pending,
 *   4. a reviewer who is not the submitter.
 *
 * Points 3 and 4 are also enforced in the database layer, so this route cannot
 * be the only thing standing between a stale tab and a double-applied change.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { ContributionError, reviewSuggestion } from '@ozituma/db/contributions';
import { getCurrentAccount } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A 303 redirect to a RELATIVE location — see the note in app/api/auth for why
 * relative rather than absolute (no configured-base drift, no Host-header
 * open-redirect vector).
 */
function redirectTo(path: string, params: Record<string, string> = {}): NextResponse {
  const search = new URLSearchParams(params).toString();
  const location = search.length > 0 ? `${path}?${search}` : path;
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current) {
    return redirectTo('/signin', { error: 'Sign in to review contributions.' });
  }
  if (!current.canReview) {
    // Deliberately a 403 rather than a redirect: an authenticated user probing
    // for a review endpoint should be told plainly that they may not.
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Reviewing requires an editor or admin role.' } },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const suggestionId = Number(id);
  if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
    return redirectTo('/review', { error: 'That submission id is not valid.' });
  }

  const form = await request.formData();
  const decision = String(form.get('decision') ?? '');
  if (decision !== 'approve' && decision !== 'reject') {
    return redirectTo('/review', { error: 'Decision must be approve or reject.' });
  }

  const noteRaw = form.get('note');
  const note = typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim().slice(0, 1000) : null;

  const db = await getDb();
  try {
    const result = await reviewSuggestion(db, {
      suggestionId,
      reviewerId: current.account.id,
      decision,
      note,
    });

    const detail =
      result.applied?.detail ?? (decision === 'reject' ? 'Rejected.' : 'Approved.');

    return redirectTo('/review', {
      done: decision,
      id: String(suggestionId),
      detail: detail.slice(0, 300),
    });
  } catch (error) {
    if (error instanceof ContributionError) {
      return redirectTo('/review', { error: error.message });
    }
    console.error('[review]', error);
    return redirectTo('/review', { error: 'Could not record that decision.' });
  }
}
