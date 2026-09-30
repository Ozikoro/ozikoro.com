/**
 * /api/learn/review — act on the §5.3 content queue.
 *
 *   POST { kind, id, transition, reason? }  -> the new status, or a refusal with a reason
 *
 * WHO MAY DO WHAT IS NOT DECIDED HERE
 *
 * The route checks only that the caller is staff at all — `isLearnStaff` — and then passes the
 * account's own role through to `applyContentTransition`, which asks `canTransition`. That is
 * deliberate: the per-transition rules are §5.3's, they live in `review-workflow.ts`, and they are
 * already tested. A role table copied here would be a second place to keep in step, and the copy
 * that drifts is always the one nobody looks at.
 *
 * So a linguist reaching this endpoint with `transition: 'publish'` is refused by the domain, not by
 * this file — and the refusal arrives with the domain's own reason, which is what the reviewer is
 * shown.
 *
 * A REFUSAL IS A 200, NOT A 4xx
 *
 * The request was well-formed and the caller was entitled to make it; the content simply was not in
 * a state that allows the step. That is an outcome, not a client error, and answering 4xx would make
 * a legitimate reviewer's action look like a bug in their browser. Only "not staff", "unknown
 * transition" and a malformed body are errors.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import {
  ReviewError,
  applyContentTransition,
  availableFor,
  listAuditLog,
  listReviewTasks,
} from '@ozituma/db/learn-review';
import { getCurrentAccount } from '@/lib/session';
import { TUTOR_MODES } from '@ozituma/db/learn-tutor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The transitions §5.3 defines. Mirrors `Transition` in core; validated so a typo is a 400. */
const TRANSITIONS = [
  'submit',
  'start_review',
  'approve_linguist',
  'approve_native',
  'publish',
  'unpublish',
  'request_changes',
  'resubmit',
  'archive',
  'restore',
] as const;

type TransitionName = (typeof TRANSITIONS)[number];

const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

function allowed(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_WINDOW;
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
  if (!allowed(ip)) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const current = await getCurrentAccount();
  if (!current) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in to review content.' } },
      { status: 401 }
    );
  }

  // The door, not the rules. See the note at the top.
  if (!current.canReviewLearn) {
    return NextResponse.json(
      {
        error: {
          code: 'not_staff',
          message:
            'Reviewing content needs a staff role. You can still suggest changes — a learner report ' +
            'goes into the same queue with your name on it.',
        },
      },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'The request body must be JSON.' } },
      { status: 400 }
    );
  }

  const kind = typeof body.kind === 'string' ? body.kind : '';
  const rawId = typeof body.id === 'number' ? body.id : Number.parseInt(String(body.id ?? ''), 10);
  const transition = typeof body.transition === 'string' ? body.transition : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : undefined;

  if (!kind || !Number.isFinite(rawId) || rawId <= 0) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'A content kind and id are required.' } },
      { status: 400 }
    );
  }

  if (!TRANSITIONS.includes(transition as TransitionName)) {
    return NextResponse.json(
      { error: { code: 'unknown_transition', message: `"${transition}" is not a lifecycle step.` } },
      { status: 400 }
    );
  }

  const db = await getDb();

  try {
    const outcome = await applyContentTransition(db, {
      kind: kind as never,
      id: rawId,
      transition: transition as TransitionName,
      // The role comes from the session, never from the request body. A client that could name its
      // own role could approve its own content.
      actor: {
        id: current.account.id,
        role: current.account.role as never,
      },
      reason,
    });

    // Read back the transitions that are now available, so the page does not have to reload to
    // learn what the reviewer can do next.
    const next = outcome.ok
      ? await availableFor(db, kind as never, rawId, {
          id: current.account.id,
          role: current.account.role as never,
        })
      : [];

    return NextResponse.json({
      ok: outcome.ok,
      from: outcome.from,
      to: outcome.to,
      code: outcome.code ?? null,
      // The domain's own words. A reviewer told only "refused" has to guess what to do differently.
      reason: outcome.reason ?? null,
      learnerVisible: outcome.learnerVisible,
      trustLabel: outcome.trustLabel,
      nextTransitions: next,
    });
  } catch (error) {
    if (error instanceof ReviewError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.code === 'not_found' ? 404 : 400 }
      );
    }
    console.error('[review]', error);
    return NextResponse.json(
      { error: { code: 'failed', message: 'That action could not be completed.' } },
      { status: 500 }
    );
  }
}

/** The queue and the audit trail, for a client that wants them without a full page load. */
export async function GET(request: Request): Promise<NextResponse> {
  const current = await getCurrentAccount();
  if (!current) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }
  if (!current.canReviewLearn) {
    return NextResponse.json({ error: { code: 'not_staff' } }, { status: 403 });
  }

  const url = new URL(request.url);
  const db = await getDb();

  const auditKind = url.searchParams.get('auditKind');
  const auditId = Number.parseInt(url.searchParams.get('auditId') ?? '', 10);
  if (auditKind && Number.isFinite(auditId)) {
    return NextResponse.json({
      audit: await listAuditLog(db, { contentKind: auditKind, contentId: auditId }),
    });
  }

  // `state` is passed through rather than fixed to 'open', so a reviewer can look at what they
  // claimed and what has been resolved. The default is open, which is what the page shows first.
  const state = url.searchParams.get('state') ?? 'open';
  return NextResponse.json({
    tasks: await listReviewTasks(db, { state }),
    // Declared so the page can name the modes it might show for AI-drafted content.
    tutorModes: TUTOR_MODES,
  });
}
