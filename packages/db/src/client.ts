/**
 * One database interface, two drivers.
 *
 * WHY: the platform must be portable — the Ozikoro technical scope calls for a
 * Dockerised Next.js + Postgres application on AWS, not a vendor-specific
 * stack. But a developer on this project also needs to run the whole thing
 * without installing Postgres, and CI should not need a service container for
 * unit-level work.
 *
 * So:
 *   DATABASE_URL set  -> node-postgres Pool  (Docker, RDS, Aurora, CI service)
 *   DATABASE_URL unset -> PGlite             (real Postgres compiled to WASM,
 *                                             persisted under .data/pg)
 *
 * PGlite is genuinely Postgres 16, not an emulation, which is why this works:
 * the same migrations, the same generated tsvector columns, the same GIN
 * indexes and the same SQL all run against either driver. There is no
 * dialect-shimming layer and no ORM hiding the SQL from us.
 */
import type { PGlite } from '@electric-sql/pglite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  /** Parameterised query. Returns rows and the affected row count. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Multi-statement script with no parameters (used by migrations). */
  exec(sql: string): Promise<void>;
  /** Convenience for `query` returning only rows. */
  rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Single row or null. */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  /** True when pg_trgm is installed, so callers can pick a fuzzy strategy. */
  hasTrigram(): Promise<boolean>;
  close(): Promise<void>;
  readonly driver: 'pglite' | 'postgres';
}

export interface DbOptions {
  /** Postgres connection string. Falls back to process.env.DATABASE_URL. */
  url?: string;
  /** PGlite on-disk directory when no URL is configured. */
  dataDir?: string;
  /** Emit SQL and timings. Or set OZITUMA_DB_DEBUG=1. */
  debug?: boolean;
}

/**
 * Default PGlite directory, resolved from THIS file's location rather than the
 * process working directory. npm workspaces run each package's scripts with
 * cwd set to that package, so a relative path would put the database in
 * packages/db/.data when run from a script and apps/web/.data when run by the
 * web app — two different, silently empty databases. Anchoring to the module
 * means there is exactly one local database regardless of who starts what.
 */
const DEFAULT_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.data', 'pg');

function isDebug(opts: DbOptions): boolean {
  return opts.debug ?? process.env.OZITUMA_DB_DEBUG === '1';
}

function describe(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 120);
}

class PGliteDb implements Db {
  readonly driver = 'pglite' as const;
  private trigram: boolean | null = null;
  private readonly client: PGlite;
  private readonly debug: boolean;

  // Note: explicit field declarations rather than TypeScript parameter
  // properties. Node runs these files directly via type stripping, which is
  // strip-only and rejects parameter properties. Keeping the source erasable
  // means the import scripts and CLI need no build step.
  constructor(client: PGlite, debug: boolean) {
    this.client = client;
    this.debug = debug;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const started = Date.now();
    const result = await this.client.query<T>(sql, params as never[]);
    if (this.debug) {
      console.log(`[db:pglite ${Date.now() - started}ms] ${describe(sql)}`);
    }
    return {
      rows: (result.rows ?? []) as T[],
      rowCount: result.affectedRows ?? (result.rows?.length ?? 0),
    };
  }

  async exec(sql: string): Promise<void> {
    const started = Date.now();
    await this.client.exec(sql);
    if (this.debug) {
      console.log(`[db:pglite exec ${Date.now() - started}ms] ${describe(sql)}`);
    }
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.query<T>(sql, params)).rows;
  }

  async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const { rows } = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async hasTrigram(): Promise<boolean> {
    if (this.trigram === null) {
      const row = await this.one<{ present: boolean }>(
        `select exists (select 1 from pg_extension where extname = 'pg_trgm') as present`
      );
      this.trigram = Boolean(row?.present);
    }
    return this.trigram;
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /** Escape hatch for tests that need the raw PGlite instance. */
  get raw(): PGlite {
    return this.client;
  }
}

class PostgresDb implements Db {
  readonly driver = 'postgres' as const;
  private trigram: boolean | null = null;
  private readonly pool: import('pg').Pool;
  private readonly debug: boolean;

  constructor(pool: import('pg').Pool, debug: boolean) {
    this.pool = pool;
    this.debug = debug;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const started = Date.now();
    const result = await this.pool.query(sql, params as never[]);
    if (this.debug) {
      console.log(`[db:pg ${Date.now() - started}ms] ${describe(sql)}`);
    }
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    const started = Date.now();
    // node-postgres runs multi-statement scripts only through the simple query
    // protocol, which is what calling query() without params does.
    await this.pool.query(sql);
    if (this.debug) {
      console.log(`[db:pg exec ${Date.now() - started}ms] ${describe(sql)}`);
    }
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.query<T>(sql, params)).rows;
  }

  async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const { rows } = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async hasTrigram(): Promise<boolean> {
    if (this.trigram === null) {
      const row = await this.one<{ present: boolean }>(
        `select exists (select 1 from pg_extension where extname = 'pg_trgm') as present`
      );
      this.trigram = Boolean(row?.present);
    }
    return this.trigram;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  get raw(): import('pg').Pool {
    return this.pool;
  }
}

let singleton: Promise<Db> | null = null;

/** Create a fresh connection. Prefer {@link getDb} unless you need isolation. */
export async function createDb(opts: DbOptions = {}): Promise<Db> {
  const debug = isDebug(opts);
  const url = opts.url ?? process.env.DATABASE_URL;

/**
 * Decide whether a Postgres connection should use TLS.
 *
 * TLS is the right default — a managed database in another subnet should be
 * reached over it — so this returns `undefined` (meaning "no TLS") only when the
 * target is local by construction.
 *
 * The case that matters is the host in a container network: Docker Compose and
 * Kubernetes address a database by a single label such as `postgres` or `db`.
 * Such a name has no dot and cannot resolve outside the private network it lives
 * in, so it is never a managed endpoint and never has a certificate. An earlier
 * version of this only recognised `localhost` and `127.0.0.1`, which meant every
 * containerised deployment failed on migration with "The server does not support
 * SSL connections". A real RDS or Aurora endpoint is always dotted
 * (`…us-east-1.rds.amazonaws.com`) or a public address, and still gets TLS.
 */
function postgresSslFor(url: string): { rejectUnauthorized: boolean } | undefined {
  if (/sslmode=disable/.test(url)) return undefined;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // Unparseable: keep TLS on rather than silently sending credentials in clear.
    return { rejectUnauthorized: false };
  }

  const local =
    host === '' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    // A single label, i.e. a container-network service name.
    !host.includes('.');

  return local ? undefined : { rejectUnauthorized: false };
}

  if (url && url.trim().length > 0) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl: postgresSslFor(url),
    });
    return new PostgresDb(pool, debug);
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdir } = await import('node:fs/promises');
  const dataDir = opts.dataDir ?? process.env.OZITUMA_DB_PATH ?? DEFAULT_DATA_DIR;
  // PGlite expects the parent directory to exist; it will not create it.
  await mkdir(dataDir, { recursive: true });
  const client = await PGlite.create({ dataDir });
  return new PGliteDb(client, debug);
}

/** Process-wide shared connection. */
export function getDb(opts: DbOptions = {}): Promise<Db> {
  singleton ??= createDb(opts);
  return singleton;
}

/** Drop the shared connection — used by tests and CLI scripts on exit. */
export async function closeDb(): Promise<void> {
  if (singleton) {
    const db = await singleton;
    await db.close();
    singleton = null;
  }
}
