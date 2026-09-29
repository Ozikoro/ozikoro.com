/**
 * GET /api/practice?mode=meaning|listening|dialect&language=ibo
 *
 * Returns one generated question. Deliberately NOT behind the API key: this is
 * a first-party feature of the website, and demanding a developer key to
 * practise would be absurd. It is rate-limited per IP instead, because question
 * generation runs a randomised query and is not free.
 *
 * The answer id is included in the response — see the note in practice.ts on
 * why that is acceptable for a self-study tool with no score or leaderboard,
 * and what has to change before one is added.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';
import { generateQuestion, PRACTICE_MODES, type PracticeMode } from '@ozituma/db/practice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Per-IP throttle. In-process, so it protects one instance only — the same
 * caveat as the developer signup route, and the same note in DEPLOYMENT.md
 * about WAF rules being the real answer once there are several tasks.
 */
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

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const ip = (request.headers.get('x-forwarded-for') ?? 'local').split(',')[0]!.trim();

  if (!allowed(ip)) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many practice questions. Slow down a little.' } },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const mode = (url.searchParams.get('mode') ?? 'meaning') as PracticeMode;
  if (!PRACTICE_MODES.includes(mode)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_mode',
          message: `Unknown mode "${mode}". Use one of: ${PRACTICE_MODES.join(', ')}.`,
        },
      },
      { status: 400 }
    );
  }

  const language = url.searchParams.get('language') ?? 'ibo';
  const db = await getDb();

  try {
    const question = await generateQuestion(db, { mode, language });
    if (!question) {
      // A real possibility for the 16 registered languages with no corpus, and
      // for a mode with too little content. Say so plainly rather than render a
      // broken question.
      return NextResponse.json(
        {
          error: {
            code: 'not_enough_content',
            message: `There is not enough ${language} content for ${mode} practice yet.`,
          },
        },
        { status: 404 }
      );
    }
    // Never cached: every request should be a fresh question.
    return NextResponse.json(question, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'internal_error';
    const status = code === 'invalid_language' ? 400 : 500;
    return NextResponse.json(
      {
        error: {
          code,
          message: error instanceof Error ? error.message : 'Could not build a question.',
        },
      },
      { status }
    );
  }
}
