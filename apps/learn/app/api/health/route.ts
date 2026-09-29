/**
 * GET /api/health — the container health check.
 *
 * The dictionary app has the same endpoint, and the Dockerfile's HEALTHCHECK polls it. The learn
 * container needs its own, because a health check that returns 404 reads as unhealthy and Docker
 * would restart the container in a loop.
 *
 * It reports the database rather than just "the process is up". A server that answers but cannot
 * reach Postgres is not healthy in any sense a learner cares about, and a check that says
 * otherwise keeps a broken container in the load balancer.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const started = Date.now();
  try {
    const db = await getDb();
    const row = await db.one<{ ok: number }>('select 1 as ok');

    return NextResponse.json(
      {
        status: row?.ok === 1 ? 'ok' : 'degraded',
        service: 'ozituma-learn',
        driver: db.driver,
        latencyMs: Date.now() - started,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    // 503 rather than 500: this is "temporarily unable to serve", which is what a health checker
    // should act on.
    return NextResponse.json(
      {
        status: 'unhealthy',
        service: 'ozituma-learn',
        error: error instanceof Error ? error.message : 'unknown',
        latencyMs: Date.now() - started,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
