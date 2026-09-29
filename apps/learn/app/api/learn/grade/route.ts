/**
 * POST /api/learn/grade
 *
 *   { course, lesson, responses: { "<exerciseId>": "<answer>" }, record?: boolean }
 *
 * Grades a lesson's exercises on the server and, when `record` is true, writes
 * the result to the learner's progress.
 *
 * WHY THE ANSWER IS NEVER SENT TO THE BROWSER
 *
 * The dictionary practice quiz sends its answer to the client and documents why
 * that is acceptable there: no score, no leaderboard, nothing to win. Lessons
 * removed that condition by attaching a persistent `best_score` to a real
 * account. A stored score a learner can forge is worse than no score at all, so
 * grading lives here, and the GET route that serves the questions has no access
 * to the answers.
 *
 * The server rebuilds the exercise set from the lesson's content to grade a
 * submission it did not keep in memory. That works because composition is
 * deterministic and only the OPTION ORDER varies — see the header of
 * packages/db/src/learn.ts.
 *
 * The response intentionally returns `expected` for every item. Once grading is
 * over there is nothing left to protect, and telling a learner which answer was
 * right is the entire point of practising.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { getCurrentAccount } from '@/lib/session';
import { findLessonId, getProgress, getLessonPhrases, getLessonVocab, recordAttempt } from '@ozituma/db/learn';
import { buildExercises, gradeExerciseSet } from '@ozituma/db/learn-exercises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

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

interface Body {
  course?: unknown;
  lesson?: unknown;
  responses?: unknown;
  record?: unknown;
}

function asResponses(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    // A non-string response is a client bug or a probe. Dropping it means the
    // exercise counts as unanswered, which is the honest outcome, rather than
    // coercing something like an object into "[object Object]" and grading that.
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

export async function POST(request: Request): Promise<NextResponse> {
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();
  if (!allowed(ip)) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'The request body must be JSON.' } },
      { status: 400 }
    );
  }

  const course = typeof body.course === 'string' ? body.course.trim() : '';
  const lesson = typeof body.lesson === 'string' ? body.lesson.trim() : '';
  const responses = asResponses(body.responses);

  if (!course || !lesson || !responses) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'course, lesson and an object of responses are all required.',
        },
      },
      { status: 400 }
    );
  }

  const db = await getDb();
  const lessonId = await findLessonId(db, course, lesson);
  if (lessonId === null) {
    return NextResponse.json(
      { error: { code: 'not_found', message: `No lesson "${lesson}" in course "${course}".` } },
      { status: 404 }
    );
  }

  const [vocab, phrases] = await Promise.all([
    getLessonVocab(db, lessonId),
    getLessonPhrases(db, lessonId),
  ]);

  // The seed is irrelevant to grading — it moves option order, not the identity
  // of the correct option — so a fixed seed reproduces the same key every time.
  const set = buildExercises(lessonId, vocab, phrases, 1);
  const result = gradeExerciseSet(set, responses);

  if (result.total === 0) {
    return NextResponse.json(
      { error: { code: 'not_enough_content', message: 'This lesson has no exercises.' } },
      { status: 409 }
    );
  }

  // `record` is what separates "check my answer" from "I have finished". The
  // learner-facing runner calls this once per answer with record omitted, so
  // feedback is immediate, and once at the end with record set, so the score
  // that gets stored is the one the server computed over the whole set.
  const shouldRecord = body.record === true;
  const account = shouldRecord ? await getCurrentAccount() : null;

  let progress = null;
  if (shouldRecord) {
    const recorded = await recordAttempt(db, {
      accountId: account?.account.id ?? null,
      lessonId,
      correct: result.correct,
      total: result.total,
    });

    // For a signed-in learner, re-read so the response carries the same
    // best-score semantics the course page will show on the next visit.
    progress = account
      ? await getProgress(db, account.account.id, lessonId)
      : { ...recorded, state: recorded.state, bestScore: recorded.bestScore };
  }

  return NextResponse.json({
    items: result.items,
    correct: result.correct,
    total: result.total,
    score: result.score,
    // Told plainly so the UI can say it, rather than implying a score was saved
    // when there was no account to save it to.
    recorded: shouldRecord && account !== null,
    signedIn: account !== null,
    progress,
  });
}
