/**
 * Migration runner and CLI.
 *
 * Deliberately simple and dependency-free: plain .sql files applied in
 * filename order, tracked in a `schema_migration` table. We use SQL files
 * rather than an ORM's generated migrations because Ozituma leans hard on
 * Postgres-specific features — generated tsvector columns, GIN indexes,
 * partial and expression indexes, enum types — and those are clearer as SQL a
 * reviewer can read than as ORM metadata.
 *
 * Usage:
 *   node src/migrate.ts status
 *   node src/migrate.ts up
 *   node src/migrate.ts reset     # drop everything and re-apply (destructive)
 *   node src/migrate.ts seed      # reference data: languages, grammar, plans
 *   node src/migrate.ts fresh     # reset + up + seed
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, type Db } from './client.ts';
import { seedReferenceData } from './seed.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, '..', 'migrations');

interface MigrationFile {
  id: string;
  path: string;
  sql: string;
  checksum: string;
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

/** Single-quote escaping for the handful of values we inline (never user data). */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function listMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();

  return Promise.all(
    sqlFiles.map(async (file) => {
      const path = join(MIGRATIONS_DIR, file);
      const sql = await readFile(path, 'utf8');
      return { id: file.replace(/\.sql$/, ''), path, sql, checksum: checksumOf(sql) };
    })
  );
}

async function ensureMigrationTable(db: Db): Promise<void> {
  await db.exec(`
    create table if not exists schema_migration (
      id         text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    );
  `);
}

async function appliedMigrations(db: Db): Promise<Map<string, { checksum: string; applied_at: string }>> {
  const rows = await db.rows<{ id: string; checksum: string; applied_at: string }>(
    `select id, checksum, applied_at from schema_migration order by id`
  );
  return new Map(rows.map((r) => [r.id, { checksum: r.checksum, applied_at: r.applied_at }]));
}

export async function status(db: Db): Promise<void> {
  await ensureMigrationTable(db);
  const applied = await appliedMigrations(db);
  const migrations = await listMigrations();

  console.log(`\n  Driver: ${db.driver}\n`);
  console.log('  Migration                 State      Checksum');
  console.log('  ' + '-'.repeat(58));
  for (const m of migrations) {
    const done = applied.get(m.id);
    let state = 'pending';
    if (done) {
      state = done.checksum === m.checksum ? 'applied' : 'CHANGED';
    }
    console.log(`  ${m.id.padEnd(24)}  ${state.padEnd(9)}  ${m.checksum}`);
  }
  console.log('');
}

export async function up(db: Db): Promise<number> {
  await ensureMigrationTable(db);
  const applied = await appliedMigrations(db);
  const migrations = await listMigrations();
  let count = 0;

  for (const migration of migrations) {
    const done = applied.get(migration.id);

    if (done) {
      // A changed checksum means someone edited an applied migration. That is
      // almost always a mistake, because other environments already ran the
      // old version. Warn loudly rather than silently diverging.
      if (done.checksum !== migration.checksum) {
        console.warn(
          `  ! ${migration.id} changed since it was applied ` +
            `(${done.checksum} -> ${migration.checksum}). ` +
            `Add a new migration instead of editing an applied one.`
        );
      }
      continue;
    }

    process.stdout.write(`  applying ${migration.id} ... `);
    const started = Date.now();
    // Postgres has transactional DDL, so a failed migration rolls back whole.
    await db.exec(
      `begin;\n${migration.sql}\n` +
        `insert into schema_migration (id, checksum) values (${lit(migration.id)}, ${lit(migration.checksum)});\n` +
        `commit;`
    );
    console.log(`ok (${Date.now() - started}ms)`);
    count += 1;
  }

  if (count === 0) console.log('  Already up to date.');
  return count;
}

/** Destructive: drops and recreates the public schema. */
export async function reset(db: Db): Promise<void> {
  console.log('  Dropping schema public ...');
  await db.exec(`drop schema if exists public cascade; create schema public;`);
  await db.exec(`grant all on schema public to public;`);
}

export async function seed(db: Db): Promise<void> {
  await seedReferenceData(db);
}

export async function fresh(db: Db): Promise<void> {
  await reset(db);
  await up(db);
  await seed(db);
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'status').toLowerCase();
  const db = await getDb();

  try {
    switch (command) {
      case 'up':
      case 'migrate':
        console.log('Applying migrations:');
        await up(db);
        break;
      case 'reset':
        await reset(db);
        console.log('Schema dropped. Run `up` to re-apply.');
        break;
      case 'seed':
        await seed(db);
        break;
      case 'fresh':
        await fresh(db);
        break;
      case 'status':
        await status(db);
        break;
      default:
        console.error(`Unknown command "${command}". Use: status | up | reset | seed | fresh`);
        process.exitCode = 1;
    }
  } finally {
    await closeDb();
  }
}

// Only run the CLI when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('\nMigration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
