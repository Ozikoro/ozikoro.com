/**
 * Runs the Drizzle SQL migrations against the Supabase Postgres database.
 *
 * Usage:
 *   DATABASE_URL='postgresql://postgres:<password>@db.kouczrxrsdjykxoyxzgi.supabase.co:5432/postgres' \
 *     node scripts/migrate.mjs
 *
 * WHY THIS EXISTS RATHER THAN `drizzle-kit push`
 *
 * The two files in `drizzle/migrations` are plain SQL and were written to be read: every policy
 * names what it protects and why. `drizzle-kit push` would diff the schema and emit its own DDL,
 * which would work but would silently diverge from these files — and these files are what the
 * Handoff says are "the rules".
 *
 * WHY IT IS IDEMPOTENT
 *
 * Every statement is either `CREATE TABLE IF NOT EXISTS` or wrapped so that re-running is safe where
 * it can be. A migration that fails halfway leaves a real database in a real partial state, so the
 * runner records what it has applied in a table of its own and skips those on the next run.
 *
 * WHY POSTGRES OVER THE SUPABASE REST API
 *
 * The REST API cannot run DDL. Creating tables and policies needs a real connection, which means the
 * database password — not the service role key.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'drizzle', 'migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

if (connectionString.includes('[YOUR-PASSWORD]')) {
  // The most likely mistake, and worth naming exactly: Supabase's dashboard shows the connection
  // string with the password as a placeholder, and it is easy to copy before substituting it.
  console.error('DATABASE_URL still contains the [YOUR-PASSWORD] placeholder.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  // Supabase requires TLS, and its certificate is not in Node's default trust store.
  ssl: { rejectUnauthorized: false },
});

await client.connect();

await client.query(`
  create table if not exists public.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`);

const applied = new Set(
  (await client.query('select name from public.schema_migrations')).rows.map((r) => r.name)
);

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`  skip   ${file} (already applied)`);
    continue;
  }

  const sql = await readFile(join(migrationsDir, file), 'utf8');

  /*
   * One transaction per file, not one for the whole run.
   *
   * A file is a coherent unit — 0000 creates the tables, 0001 the teacher marketplace. Running both
   * in one transaction would mean a failure in 0001 rolls back 0000, which is fine in principle but
   * unhelpful in practice: the operator wants to see how far it got.
   */
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public.schema_migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log(`  applied ${file}`);
    ran += 1;
  } catch (error) {
    await client.query('rollback');
    console.error(`  FAILED  ${file}`);
    console.error(`          ${error instanceof Error ? error.message : String(error)}`);
    await client.end();
    process.exit(1);
  }
}

// What the handoff's "Order of work" step 1 actually produced.
const tables = await client.query(`
  select table_name from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'
   order by table_name
`);
console.log(`\n  ${ran} migration(s) applied.`);
console.log(`  public tables now: ${tables.rows.map((r) => r.table_name).join(', ')}`);

const policies = await client.query(`
  select count(*)::int as n from pg_policies where schemaname = 'public'
`);
console.log(`  RLS policies: ${policies.rows[0].n}`);

await client.end();
