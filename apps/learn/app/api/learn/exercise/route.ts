/**
 * GET /api/learn/exercise?course=igbo&lesson=saying-hello
 *
 * Returns a lesson's exercise set for the browser: prompts, options and audio
 * URLs, with NO answers. Grading happens in the sibling route.
 *
 * First-party feature of the site, so like /api/practice it is deliberately not
 * behind a developer key. Rate-limited per IP instead, because building a set is
 * a database round trip and a shuffle, and neither is free.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { findLessonId, getLessonPhrases, getLessonVocab } from '@ozituma/db/learn';
import { buildExercises, presentationSeed, toClientSet } from '@ozituma/db/learn-exercises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Per-IP throttle. In-process, so it protects one instance only — the same
 * caveat as the practice route and the same note in DEPLOYMENT.md about WAF
 * rules being the real answer once there are several tasks.
 */
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

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();

  if (!allowed(ip)) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const course = url.searchParams.get('course')?.trim();
  const lesson = url.searchParams.get('lesson')?.trim();
  if (!course || !lesson) {
    return NextResponse.json(
      { error: { code: 'missing_params', message: 'Both course and lesson are required.' } },
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

  // A fresh seed per request: composition is fixed by the lesson's content, so
  // the grading route can rebuild the same questions, but the ORDER of the
  // options changes so a learner cannot memorise positions.
  const set = buildExercises(lessonId, vocab, phrases, presentationSeed());

  if (set.exercises.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: 'not_enough_content',
          message:
            'This lesson does not have enough vocabulary to build exercises yet. ' +
            'It needs at least four terms.',
        },
      },
      { status: 409 }
    );
  }

  return NextResponse.json(toClientSet(set));
}
