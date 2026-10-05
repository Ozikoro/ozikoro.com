/**
 * The Academy's connection to the shared Ozikoro database.
 *
 * WHY THE ACADEMY HAS ITS OWN THREE HUNDRED LINES OF DATABASE CODE, RATHER THAN IMPORTING
 * `@ozituma/db`
 *
 * `packages/db` holds the canonical implementation and the Academy should ideally consume it
 * directly. It does not, deliberately, and the reason is the build rather than the code.
 *
 * The other two apps in this repository are Next.js workspaces that share one root lockfile and one
 * `npm ci`, so they can consume `packages/db` as a workspace dependency. The Academy is TanStack
 * Start on Vite with its own lockfile and its own Docker build context, precisely so that its
 * dependency graph cannot collide with theirs. Importing `packages/db` would undo that: it would put
 * the Academy back inside the shared install, and it would force the Academy's Docker context back
 * to the repository root, which is the coupling the split exists to prevent.
 *
 * So the Academy speaks to the same TABLES with its own thin layer. That is the part that actually
 * has to be shared — one `account` row per person, so a registration works on every Ozikoro site —
 * and it is shared exactly. What is *not* shared is the JavaScript, which is why the two modules
 * that carry real semantics, the password scheme and the session token, are ported line-for-line in
 * `./passwords.ts` and `./session.ts` and are cross-verified against the canonical implementation by
 * a test rather than by inspection.
 *
 * If the Academy is ever promoted to a workspace member, `./passwords.ts` and `./session.ts` should
 * be deleted in favour of `@ozituma/db/accounts`. Until then, treat them as a copy that must not
 * drift: `packages/db/src/accounts.ts` is the source of truth.
 */
import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;

/**
 * The pool, created once per process.
 *
 * A module-scope singleton rather than a pool per request: Postgres connections are expensive, and
 * the container is long-lived, which is the whole reason the platform chose a container over
 * Lambda. `max` is deliberately small — the host runs Postgres, the dictionary and the archive on
 * the same 4 GB instance, and a large pool from a fourth process would starve them of connections
 * rather than of memory.
 */
function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Failing here rather than returning a pool that will fail on first query makes the
    // misconfiguration legible in the container log at start-up instead of on the first sign-in.
    throw new Error(
      "DATABASE_URL is not set. The Academy needs it to reach the shared Ozikoro database; " +
        "see the `academy` service in docker/docker-compose.prod.yml."
    );
  }

  pool = new Pool({
    connectionString,
    max: Number(process.env.ACADEMY_DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // The dictionary and archive print their timestamps in UTC and the database stores
    // `timestamptz`. Pinning the session avoids a local-time surprise when the container's TZ is
    // not UTC.
    options: "-c timezone=UTC",
  });

  // A pool that emits errors with no listener takes the process down. An idle client dropping its
  // connection is routine on a host where Postgres restarts, and it must not kill the site.
  pool.on("error", (error) => {
    console.error("academy: idle database client error", error);
  });

  return pool;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** Parameterised query. Never interpolate a value into the SQL string. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const result = await getPool().query(sql, params);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

/** Rows only, for the common case. */
export async function rows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return (await query<T>(sql, params)).rows;
}

/** One row or null. */
export async function one<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const result = await query<T>(sql, params);
  return result.rows[0] ?? null;
}

/**
 * Run several statements in one transaction.
 *
 * Used where two writes must not be separated — an enrolment and its first progress row, or an
 * attempt and the progress it advances. The callback receives a client that must be used for every
 * statement inside, since a query on the pool would run outside the transaction.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** True when the database answers. Used by the health endpoint. */
export async function isReachable(): Promise<boolean> {
  try {
    await query("select 1");
    return true;
  } catch {
    return false;
  }
}
