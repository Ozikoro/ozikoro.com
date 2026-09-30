/**
 * /api/learn/plan — the day's review queue, and the endpoint that grades a review.
 *
 *   GET                       -> { items, dueCount, newCount, estimatedMinutes, ... }
 *   POST { itemId, rating }   -> { state, log } and the updated counts
 *
 * WHY THIS IS SEPARATE FROM /api/learn/practice
 *
 * Practice asks "do you know this word". The plan asks "should you be asked this word today", which
 * is a question only the schedule can answer. They share the exercise engine and the dictionary, and
 * they are different surfaces on purpose: practice is something a learner chooses, the plan is
 * something the schedule decides.
 *
 * THE RATING IS THE LEARNER'S OWN JUDGEMENT HERE
 *
 * Unlike practice — where the rating is inferred from whether the answer was right, because that is
 * the only signal an exercise produces — this endpoint takes the rating the learner gave. That is
 * what SM-2 is designed around: the person is telling you how hard recall felt, and that judgement is
 * the input. It is validated against the four legal values and nothing else is accepted.
 *
 * AUTHENTICATION
 *
 * Both verbs require a signed-in learner. The queue is per-account and so is the schedule, so there
 * is nothing honest to return to an anonymous caller — 401 rather than an empty plan, because an
 * empty plan reads as "you are all caught up", which would be a lie.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { getDailyPlan, getReviewSummary, recordReview } from '@ozituma/db/learn-srs';
import { awardXp, recordActivity } from '@ozituma/db/learn-gamification';
import { getCurrentAccount } from '@/lib/session';
import { learnerTimeZone } from '@/lib/timezone';
import { localDay } from '@ozituma/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 240;

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

function clientIp(request: Request): string {
  return (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'unauthenticated',
        message: 'Your review schedule belongs to your account. Sign in to see it.',
      },
    },
    { status: 401 }
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!allowed(clientIp(request))) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const account = await getCurrentAccount();
  if (!account) return unauthorized();

  const url = new URL(request.url);
  const rawMinutes = Number.parseInt(url.searchParams.get('minutes') ?? '', 10);
  // §F6: the plan adapts to the time the learner says they have. Clamped, because the value comes
  // from a query string and a hand-made `minutes=100000` should not read the whole deck.
  const minutesAvailable = Number.isFinite(rawMinutes)
    ? Math.min(Math.max(rawMinutes, 1), 60)
    : 10;

  const db = await getDb();
  const plan = await getDailyPlan(db, account.account.id, { minutesAvailable });

  return NextResponse.json({
    // Words, with their gloss and recording, so the page can render a review without a second call.
    items: plan.items.map((item) => ({
      itemId: item.itemId,
      headword: item.headword,
      slug: item.slug,
      english: item.english,
      audioUrl: item.audioUrl,
      isNew: item.isNew,
      state: item.state,
    })),
    dueCount: plan.dueCount,
    newCount: plan.newCount,
    estimatedMinutes: plan.estimatedMinutes,
    truncated: plan.truncated,
    trackedTotal: plan.trackedTotal,
    minutesAvailable,
  });
}

/** The four ratings SM-2 defines, and nothing else. */
const RATINGS = new Set(['again', 'hard', 'good', 'easy']);

export async function POST(request: Request): Promise<NextResponse> {
  if (!allowed(clientIp(request))) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const account = await getCurrentAccount();
  if (!account) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'The request body must be JSON.' } },
      { status: 400 }
    );
  }

  const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
  const rating = typeof body.rating === 'string' ? body.rating : '';
  const elapsedMs =
    typeof body.elapsedMs === 'number' && Number.isFinite(body.elapsedMs)
      ? Math.max(0, Math.min(Math.round(body.elapsedMs), 600_000))
      : null;

  if (!itemId || !RATINGS.has(rating)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'itemId and a rating of again, hard, good or easy are required.',
        },
      },
      { status: 400 }
    );
  }

  const db = await getDb();

  // The item must be a real published word. Without this check a caller could create a schedule for
  // an arbitrary id — harmless in itself, but it would put rows in a learner's deck that can never
  // resolve to a word, and they would sit in the due count forever.
  const word = await db.one<{ id: string }>(
    `select id from word where id = $1 and language_code = 'ibo' and status = 'published'`,
    [itemId]
  );
  if (!word) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'That word is not available to review.' } },
      { status: 404 }
    );
  }

  const result = await recordReview(db, {
    accountId: account.account.id,
    itemId,
    itemKind: 'lexeme',
    rating: rating as 'again' | 'hard' | 'good' | 'easy',
    elapsedMs,
  });

  const summary = await getReviewSummary(db, account.account.id);

  // ---------------------------------------------------------------------------
  // XP and the streak.
  //
  // `review_session_completed` is keyed by the LOCAL DAY, not by the word, so a learner who reviews
  // twenty words in one evening is rewarded once for the session — which is what §F7 says the award
  // is for: returning, not grinding. Keying it by word would make the daily plan a way to farm XP by
  // reviewing the same eight items in a loop.
  //
  // The award is attempted on every review; the unique constraint turns all but the first that day
  // into no-ops, so no "have I already counted today" check is needed here. That check is exactly the
  // kind of state that goes wrong when two requests arrive together.
  // ---------------------------------------------------------------------------
  const timeZone = learnerTimeZone(request.headers, body);
  await awardXp(db, {
    accountId: account.account.id,
    source: 'review_session_completed',
    reference: `review:${localDay(Date.now(), timeZone)}`,
  });
  const activity = await recordActivity(db, account.account.id, timeZone);

  return NextResponse.json({
    // What the scheduler decided, so the page can say when the word comes back rather than leaving
    // the learner to guess whether their answer mattered.
    state: result.state.state,
    dueAt: result.state.dueAt,
    intervalDays: result.state.intervalDays,
    lapse: result.log.lapse,
    dueNow: summary.dueNow,
    tracked: summary.tracked,
    learned: summary.learned,
    // Only true on the call that actually moved it, so the UI can celebrate the streak once rather
    // than on every answer.
    streakChanged: activity.changed,
    streakCurrent: activity.state.current,
  });
}
