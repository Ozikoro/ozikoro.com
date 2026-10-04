/**
 * Prove the Postgres path, against a Postgres the owner can point at.
 *
 *   DATABASE_URL='postgres://…' node scripts/verify-postgres.ts
 *   DATABASE_URL='postgres://…' node scripts/verify-postgres.ts --check
 *   DATABASE_URL='postgres://…' node scripts/verify-postgres.ts --fresh
 *
 * WHY THIS EXISTS
 *
 * Every test in this project has run on PGlite — Postgres 16 compiled to WASM and opened
 * in-process from `.data/pg`. Production runs node-postgres against a real server. Those are
 * the same SQL but not the same *deployment*: a real server has a different version, a
 * different set of available extensions, a real transaction log, and a migration runner that
 * sends each file as one multi-statement simple query. **None of that had ever been exercised
 * here**, which is the failure that arrives at the worst moment.
 *
 * So this script does not inspect the code and conclude. It applies every migration to a real
 * server, in the order the runner uses, and then asks the server what it actually built.
 *
 * WHAT IT ASSERTS, AND WHY EACH ONE
 *
 *  1. The server answers, and its version/encoding/collation are reported. The `C` collation is
 *     not cosmetic: `POSTGRES_INITDB_ARGS: '--encoding=UTF8 --locale=C'` in the compose is what
 *     keeps `ORDER BY` on diacritic-bearing headwords stable, so it is checked rather than
 *     assumed.
 *  2. Every `.sql` file is applied, through the repository's own `up()` — not a reimplementation.
 *     A second `up()` must apply zero, which is the idempotence that makes a redeploy safe.
 *  3. Every row in `schema_migration` exists and its checksum matches the file's bytes. A
 *     checksum that has drifted means an applied migration was edited, and this is where that
 *     is caught.
 *  4. The enum values added by `alter type … add value` are present. This is the single most
 *     version-sensitive construct in the tree: the runner wraps every file in `begin/commit`,
 *     and a new enum value cannot be *used* in the transaction that adds it.
 *  5. The functions, enum types and generated columns the migrations declare exist on the
 *     server, and `pg_trgm` is installed — the fuzzy-search strategy the code selects on.
 *  6. The application's own driver is exercised: `createDb({ url })` must report
 *     `driver === 'postgres'`, and `hasTrigram()` must answer from that connection. Proving the
 *     SQL works is not the same as proving the code path does.
 *
 * WHAT IT NEVER DOES
 *
 * It never prints the connection string. `DATABASE_URL` carries the database password, so only
 * the host, port and database name are reported. Nothing here reads a secret's value.
 *
 * `--check` reports what would happen and writes nothing. `--fresh` drops the `public` schema
 * first, which is destructive and is only correct against a scratch database.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { closeDb, createDb } from '../packages/db/src/client.ts';
import { listMigrations, seed, status, up } from '../packages/db/src/migrate.ts';

const argv = new Set(process.argv.slice(2));
const CHECK_ONLY = argv.has('--check');
const FRESH = argv.has('--fresh');

const failures: string[] = [];
const notes: string[] = [];

function ok(message: string): void {
  console.log(`  ok    ${message}`);
}

function fail(message: string): void {
  failures.push(message);
  console.log(`  FAIL  ${message}`);
}

function note(message: string): void {
  notes.push(message);
  console.log(`  note  ${message}`);
}

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log('='.repeat(text.length));
}

/**
 * The connection string, reduced to the parts that are not secret.
 * The password and the user are deliberately absent from this function's output.
 */
function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(default)';
    return `${parsed.protocol.replace(':', '')}://<redacted>@${parsed.hostname}:${parsed.port || '5432'}/${database}`;
  } catch {
    return '(unparseable connection string)';
  }
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();

  heading('Ozikoro — the Postgres path, exercised');

  if (!url) {
    // The whole point of this script is a real server. Refusing is the honest answer: running it
    // without DATABASE_URL would silently exercise PGlite and report a green tick for the wrong
    // database, which is the failure this file exists to prevent.
    console.error(
      '\n  DATABASE_URL is not set.\n\n' +
        '  This script exists to exercise a REAL Postgres. With no DATABASE_URL the application\n' +
        '  falls back to PGlite under .data/pg, which is the path that has already been tested and\n' +
        '  is not what production runs. Nothing was verified.\n\n' +
        '  Point it at a scratch database and run it again:\n\n' +
        "    DATABASE_URL='postgres://user:…@host:5432/ozituma' node scripts/verify-postgres.ts\n"
    );
    process.exitCode = 2;
    return;
  }

  console.log(`\n  target  ${describeTarget(url)}`);
  console.log(`  mode    ${CHECK_ONLY ? 'check (writes nothing)' : FRESH ? 'fresh (DROPS the public schema)' : 'apply'}`);

  const db = await createDb({ url });

  try {
    // ── 1. The server, reported rather than assumed ──────────────────────────
    heading('1. The server');

    if (db.driver !== 'postgres') {
      fail(`createDb() reported driver "${db.driver}", expected "postgres". DATABASE_URL was ignored.`);
      return;
    }
    ok('createDb() selected the postgres driver from DATABASE_URL');

    const server = await db.one<{
      version: string;
      vnum: string;
      encoding: string;
      collate: string;
      ctype: string;
    }>(
      `select version() as version,
              current_setting('server_version_num') as vnum,
              (select pg_encoding_to_char(encoding) from pg_database where datname = current_database()) as encoding,
              (select datcollate from pg_database where datname = current_database()) as collate,
              (select datctype   from pg_database where datname = current_database()) as ctype`
    );

    if (!server) {
      fail('could not read the server version');
      return;
    }

    const [major] = server.version.split(' ')[1]?.split('.') ?? ['?'];
    console.log(`  info  ${server.version.split(' on ')[0]}`);
    console.log(`  info  encoding ${server.encoding}, collate ${server.collate}, ctype ${server.ctype}`);

    if (Number(major) < 16) {
      // Every migration here targets 16. Below that, `alter type … add value` inside the
      // runner's begin/commit is refused outright, so a green run would be impossible anyway.
      fail(`PostgreSQL ${major} is older than the 16 the migrations target.`);
    } else if (Number(major) > 16) {
      note(
        `server is PostgreSQL ${major}, the compose pins postgres:16-alpine. The migrations applied, ` +
          'but a major-version gap is a real difference and is not covered by this run.'
      );
    } else {
      ok('server major version matches the image the compose pins (16)');
    }

    if (server.collate !== 'C') {
      note(
        `collation is "${server.collate}", not "C". The compose sets POSTGRES_INITDB_ARGS to ` +
          "'--encoding=UTF8 --locale=C' so ORDER BY on diacritic-bearing headwords is stable. " +
          'A scratch database created another way will order differently.'
      );
    } else {
      ok('collation is C, as the compose pins');
    }

    // ── 2. Extensions the migrations need ────────────────────────────────────
    heading('2. Extensions');

    const extensions = await db.rows<{ name: string; default_version: string; installed_version: string | null }>(
      `select name, default_version, installed_version
         from pg_available_extensions
        where name in ('pg_trgm', 'unaccent', 'pgcrypto', 'uuid-ossp', 'citext')
        order by name`
    );
    const available = new Set(extensions.map((e) => e.name));

    if (!available.has('pg_trgm')) {
      // 0002_search.sql runs `create extension if not exists pg_trgm`, so without it that
      // migration is where the run stops.
      fail('pg_trgm is not available on this server; 0002_search.sql will fail on it.');
    } else {
      ok('pg_trgm is available (required by 0002_search.sql)');
    }
    console.log(`  info  available: ${[...available].sort().join(', ') || '(none)'}`);

    // ── 3. Apply, through the repository's own runner ────────────────────────
    heading('3. Migrations');

    const migrations = await listMigrations();
    console.log(`  info  ${migrations.length} migration files on disk`);

    if (CHECK_ONLY) {
      await status(db);
      console.log('  note  --check: nothing was applied.');
      return;
    }

    if (FRESH) {
      await db.exec('drop schema if exists public cascade; create schema public;');
      await db.exec('grant all on schema public to public;');
      console.log('  info  public schema dropped and recreated (--fresh)');
    }

    const appliedFirst = await up(db);
    console.log(`  info  up() applied ${appliedFirst}`);

    const appliedAgain = await up(db);
    if (appliedAgain !== 0) {
      fail(`a second up() applied ${appliedAgain} more migrations; the runner is not idempotent.`);
    } else {
      ok('a second up() applied 0 — the runner is idempotent, so a redeploy is safe');
    }

    await seed(db);
    ok('seed() ran against Postgres (reference data)');

    // ── 4. Every migration recorded, every checksum matching the file ────────
    heading('4. The record of what was applied');

    const recorded = await db.rows<{ id: string; checksum: string }>(
      'select id, checksum from schema_migration order by id'
    );
    const byId = new Map(recorded.map((r) => [r.id, r.checksum]));

    let missing = 0;
    let drifted = 0;
    for (const migration of migrations) {
      const stored = byId.get(migration.id);
      if (!stored) {
        fail(`${migration.id} is on disk but not in schema_migration`);
        missing += 1;
        continue;
      }
      const expected = checksumOf(migration.sql);
      if (stored !== expected) {
        fail(
          `${migration.id} checksum drifted: recorded ${stored}, file is ${expected}. ` +
            'An applied migration was edited; add a new one instead.'
        );
        drifted += 1;
      }
    }

    if (missing === 0 && drifted === 0) {
      ok(`all ${migrations.length} migrations recorded, all checksums match the files`);
    }

    // ── 5. The enum values added inside the runner's transaction ─────────────
    heading('5. Enum values added inside a transaction');

    const roles = await db.rows<{ value: string }>(
      `select e.enumlabel as value
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'account_role'
        order by e.enumsortorder`
    );
    const roleValues = roles.map((r) => r.value);
    console.log(`  info  account_role = ${roleValues.join(' > ')}`);

    // 0001 declares three, 0021 adds `owner`, 0029_learn_foundation adds four. All of them are
    // added by an `alter type … add value` sent inside `begin; … commit;`.
    for (const required of ['contributor', 'editor', 'admin', 'owner', 'learner', 'linguist', 'native_reviewer', 'content_editor']) {
      if (!roleValues.includes(required)) {
        fail(`account_role is missing "${required}" — an alter type add value did not survive its transaction`);
      }
    }
    if (roleValues.length === 8) {
      ok('all eight account_role values are present');
    }

    if (roleValues.indexOf('owner') > roleValues.indexOf('admin')) {
      fail("'owner' does not sort before 'admin', so role >= 'admin' would exclude the owner");
    } else {
      ok("'owner' is ordered before 'admin', as 0021 requires");
    }

    // ── 6. The objects the migrations declare ────────────────────────────────
    heading('6. Objects the migrations declare');

    const enumTypes = await db.rows<{ typname: string }>(
      `select typname from pg_type
        where typtype = 'e' and typnamespace = 'public'::regnamespace
        order by typname`
    );
    const enumNames = enumTypes.map((t) => t.typname);
    for (const required of ['account_role', 'entry_status', 'relation_kind', 'review_status']) {
      if (!enumNames.includes(required)) fail(`enum type public.${required} was not created`);
    }
    if (enumNames.length > 0) ok(`enum types: ${enumNames.join(', ')}`);

    const functions = await db.rows<{ proname: string }>(
      `select distinct p.proname
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname like 'ozikoro\\_%'
        order by p.proname`
    );
    const functionNames = functions.map((f) => f.proname);
    for (const required of [
      'ozikoro_capabilities',
      'ozikoro_has_capability',
      'ozikoro_pronunciation_blocks',
      'ozikoro_role_may_grant',
      'ozikoro_role_rank',
    ]) {
      if (!functionNames.includes(required)) fail(`function public.${required}() was not created`);
    }
    ok(`SQL functions: ${functionNames.join(', ') || '(none)'}`);

    const generated = await db.rows<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public' and is_generated = 'ALWAYS'
        order by table_name, column_name`
    );
    const generatedCount = generated.length;
    if (generatedCount === 0) {
      note('no generated columns found; the search_vector and folded_* columns were expected');
    } else {
      ok(`${generatedCount} GENERATED ALWAYS columns, including ${generated.slice(0, 4).map((g) => `${g.table_name}.${g.column_name}`).join(', ')}`);
    }

    const ginIndexes = await db.one<{ n: string }>(
      `select count(*)::text as n
         from pg_index i
         join pg_class c on c.oid = i.indexrelid
         join pg_am am on am.oid = c.relam
        where c.relnamespace = 'public'::regnamespace and am.amname = 'gin'`
    );
    console.log(`  info  GIN indexes: ${ginIndexes?.n ?? '?'}`);

    const tables = await db.one<{ n: string }>(
      `select count(*)::text as n from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`
    );
    ok(`${tables?.n ?? '?'} base tables in public`);

    // ── 7. The application's own strategy selection ──────────────────────────
    heading('7. The application code path, not just the SQL');

    const trigram = await db.hasTrigram();
    if (!trigram) {
      fail('hasTrigram() returned false, so the application would take the non-fuzzy search path');
    } else {
      ok('hasTrigram() answered true from the postgres driver');
    }

    // These are real calls into the migrations' own SQL, chosen because they are pure functions
    // with knowable answers. A function that was created but never invoked is not verified.
    const rankOwner = await db.one<{ rank: number }>('select ozikoro_role_rank($1) as rank', ['owner']);
    const rankContributor = await db.one<{ rank: number }>('select ozikoro_role_rank($1) as rank', ['contributor']);
    if (!rankOwner || !rankContributor || rankOwner.rank <= rankContributor.rank) {
      fail(`ozikoro_role_rank() did not order owner above contributor (${JSON.stringify({ owner: rankOwner, contributor: rankContributor })})`);
    } else {
      ok(`ozikoro_role_rank('owner') = ${rankOwner.rank} > ozikoro_role_rank('contributor') = ${rankContributor.rank}`);
    }

    const mayGrant = await db.one<{ may: boolean }>('select ozikoro_role_may_grant($1, $2) as may', ['owner', 'admin']);
    if (!mayGrant?.may) {
      fail('ozikoro_role_may_grant(owner, admin) returned false');
    } else {
      ok('ozikoro_role_may_grant(owner, admin) = true');
    }

    const blocks = await db.one<{ blocked: boolean }>(
      'select ozikoro_pronunciation_blocks($1, $2) as blocked',
      ['pending', 'recorded']
    );
    if (!blocks?.blocked) {
      fail('ozikoro_pronunciation_blocks(pending, recorded) returned false; unreviewed audio would play');
    } else {
      ok('ozikoro_pronunciation_blocks(pending, recorded) = true — unreviewed audio still does not play');
    }

    // The capability function reads real tables, so it proves a join works on this server and not
    // only that the function exists. A missing account is the safe input: no rows, no side effect.
    const capabilities = await db.rows<{ capability: string }>(
      'select * from ozikoro_capabilities($1) as capability',
      [-1]
    );
    ok(`ozikoro_capabilities(-1) returned ${capabilities.length} rows without error (the join executes)`);

    // ── 8. A migration that PGlite accepted and Postgres might not ───────────
    heading('8. Ordering of the same-numbered migrations');

    // Three prefixes are shared: 0028, 0029 and 0031. The runner sorts by filename, so what the
    // database receives is lexicographic. Printed because a pair whose order matters is exactly
    // the kind of thing that works until the day one of them is renamed.
    const order = migrations.map((m) => m.id);
    for (const prefix of ['0028', '0029', '0031']) {
      const pair = order.filter((id) => id.startsWith(prefix));
      console.log(`  info  ${prefix}: ${pair.join('  ->  ')}`);
      if (pair.length > 1) {
        const sorted = [...pair].sort();
        if (pair.join() !== sorted.join()) {
          fail(`${prefix} is not applied in lexicographic order`);
        }
      }
    }
    ok('the shared prefixes are applied in lexicographic filename order');
  } finally {
    await db.close();
    await closeDb();
  }

  // ── The verdict ────────────────────────────────────────────────────────────
  heading('Result');

  if (notes.length > 0) {
    console.log('\n  Notes (not failures, but not nothing):');
    for (const n of notes) console.log(`    - ${n}`);
  }

  if (failures.length > 0) {
    console.log(`\n  ${failures.length} check(s) FAILED:`);
    for (const f of failures) console.log(`    - ${f}`);
    console.log('\n  The Postgres path is NOT proven.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n  Every check passed against a real Postgres server.');
  console.log('  The migrations, the seed and the application driver all ran on it.\n');
  process.exitCode = 0;
}

main().catch((error) => {
  console.error('\nverify-postgres failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
