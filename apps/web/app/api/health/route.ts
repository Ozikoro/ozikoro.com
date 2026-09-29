/**
 * GET /api/health — readiness probe for the container platform.
 *
 * Reports dependency health rather than just "the process is up", because a
 * container that cannot reach Postgres is not serving traffic and should be
 * pulled out of the load balancer.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const started = Date.now();
  try {
    const db = await getDb();
    const row = await db.one<{ words: number }>(
      `select (select count(*)::int from word where status = 'published') as words`
    );
    return NextResponse.json({
      status: 'ok',
      driver: db.driver,
      trigram: await db.hasTrigram(),
      publishedWords: Number(row?.words ?? 0),
      latencyMs: Date.now() - started,
      version: process.env.OZITUMA_VERSION ?? 'dev',
    });
  } catch (error) {
    console.error('[health]', error);
    return NextResponse.json(
      { status: 'degraded', error: 'database unreachable', latencyMs: Date.now() - started },
      { status: 503 }
    );
  }
}
