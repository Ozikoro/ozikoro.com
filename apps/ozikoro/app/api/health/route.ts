/**
 * GET /api/health — is this instance actually working?
 *
 * WHAT IT IS FOR
 *
 * A deployment needs one address that answers "is this instance serving?" without a human reading a
 * page. The plan lists monitoring under the final phase and this is its primitive: the thing a load
 * balancer, an uptime check or a deploy script asks.
 *
 * WHY IT CHECKS THE DATABASE RATHER THAN RETURNING 200
 *
 * A process that is listening but cannot reach its database is the failure this exists to catch, and
 * it is the one a naive health check misses: the web server answers happily while every page 500s.
 * So the check runs an actual query. A health endpoint that does not touch its dependencies reports
 * the health of the socket, not of the application.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY
 *
 * No table counts, no record numbers, no version strings, no error text. A health endpoint is
 * typically unauthenticated and world-readable, so anything it returns is public. Archive sizes are
 * not secret but they are not the public's business either, and an error message is a gift to anyone
 * probing. The detail is available to whoever holds the health token; everyone else gets a status.
 *
 * The response is `no-store`, because a cached health check is not a health check.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@ozituma/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const started = Date.now();
  const headers = { 'Cache-Control': 'no-store, max-age=0' };

  try {
    const db = await getDb();
    // A real query. `select 1` alone would not prove the tables are readable.
    const row = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_article`);
    const latencyMs = Date.now() - started;

    /*
     * Detail only to a caller who presents the token, and the token is compared as a whole string —
     * a prefix match would let anyone who knows the first character walk the value.
     */
    const token = process.env.HEALTH_TOKEN?.trim();
    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    const authorised = Boolean(token) && supplied === token;

    return NextResponse.json(
      {
        status: 'ok',
        database: 'reachable',
        latencyMs,
        ...(authorised ? { articles: Number(row?.n ?? 0) } : {}),
      },
      { headers }
    );
  } catch (error) {
    /*
     * The reason is logged for the operator and NOT returned, because an unauthenticated endpoint
     * that echoes a database error tells an attacker the driver, the host and often the schema.
     */
    console.error('[health] database check failed:', String(error).slice(0, 300));
    return NextResponse.json(
      { status: 'degraded', database: 'unreachable', latencyMs: Date.now() - started },
      { status: 503, headers }
    );
  }
}
