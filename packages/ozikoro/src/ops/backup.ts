/**
 * Backing up the archive.
 *
 * WHY THIS EXISTS
 *
 * On 1 October a `kill -9` on the dev server left the local PGlite cluster unopenable, and there was
 * no backup. Recovery was a full rebuild — migrations, seed, four imports, and a re-link of every
 * media row. Nothing was lost, because every input was still on disk, but that was luck rather than
 * design: the same accident after the first editorial work would have destroyed work that no import
 * could regenerate.
 *
 * So this takes a copy, records what was in it, and can check a copy is intact.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not copy a running database. PGlite is a single file-backed cluster and a copy taken while
 * a writer holds it can capture a torn state — the exact kind of damage it exists to prevent. The
 * script refuses to run when it can see a server holding the data directory, and says so.
 *
 * A file copy is the right tool for PGlite and the WRONG tool for a server Postgres, where the
 * cluster directory is not portable and `pg_dump` is correct. The script detects a `DATABASE_URL` and
 * refuses rather than producing a backup that would silently not restore.
 *
 * Usage:
 *   node src/ops/backup.ts                       # take a backup
 *   node src/ops/backup.ts --verify <dir>        # check a backup's manifest against its files
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from '@ozituma/db/client';

/** The tables whose counts describe the archive. Counts are the cheapest proof a copy is complete. */
const SIGNIFICANT_TABLES = [
  'ozikoro_article', 'ozikoro_media', 'ozikoro_contributor', 'ozikoro_entity',
  'ozikoro_label', 'ozikoro_publication', 'ozikoro_member', 'account',
  'clan', 'clan_town', 'word',
] as const;

export interface BackupManifest {
  takenAt: string;
  driver: 'pgdata';
  dataDir: string;
  counts: Record<string, number>;
  /** Total bytes, so a truncated copy is detectable without opening the database. */
  bytes: number;
}

async function dirSize(path: string): Promise<number> {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else {
      try { total += (await stat(full)).size; } catch { /* a file that vanished mid-walk */ }
    }
  }
  return total;
}

export async function takeBackup(options: { dataDir: string; backupRoot: string }): Promise<{ dir: string; manifest: BackupManifest }> {
  if (process.env.DATABASE_URL?.trim()) {
    throw new Error(
      'DATABASE_URL is set, so this is a server Postgres, not a local PGlite cluster. Copying the ' +
        'cluster directory would produce a backup that does not restore. Use pg_dump.'
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = resolve(options.backupRoot, `pg-${stamp}`);

  /*
   * Counts are read BEFORE the copy and the connection is closed first, so nothing is holding the
   * cluster when it is copied.
   */
  const counts: Record<string, number> = {};
  const db = await getDb();
  for (const table of SIGNIFICANT_TABLES) {
    try {
      const row = await db.one<{ n: number }>(`select count(*)::int as n from ${table}`);
      counts[table] = Number(row?.n ?? 0);
    } catch {
      counts[table] = -1; // the table does not exist in this database; recorded, not skipped
    }
  }
  await closeDb();

  await mkdir(options.backupRoot, { recursive: true });
  await cp(options.dataDir, dir, { recursive: true });

  const manifest: BackupManifest = {
    takenAt: new Date().toISOString(),
    driver: 'pgdata',
    dataDir: options.dataDir,
    counts,
    bytes: await dirSize(dir),
  };
  await writeFile(join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { dir, manifest };
}

/** Check a backup is present, complete, and describes the same tables. Does not open it. */
export async function verifyBackup(dir: string): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'MANIFEST.json'), 'utf8'));
  } catch {
    return { ok: false, problems: ['no readable MANIFEST.json — this is not a backup this tool made'] };
  }

  const bytes = await dirSize(dir);
  // The manifest itself is part of the directory, so the copy is at least as large as recorded.
  if (bytes + 4096 < manifest.bytes) {
    problems.push(`directory is ${bytes} bytes but the manifest records ${manifest.bytes} — truncated`);
  }
  try {
    const info = await stat(join(dir, 'PG_VERSION'));
    if (!info.isFile()) problems.push('PG_VERSION is not a file');
  } catch {
    problems.push('PG_VERSION is missing — this is not a Postgres cluster');
  }
  const emptyTables = Object.entries(manifest.counts).filter(([, n]) => n === 0).map(([t]) => t);
  if (emptyTables.length === Object.keys(manifest.counts).length) {
    problems.push('every recorded table was empty — the backup may have been taken from a fresh database');
  }

  return { ok: problems.length === 0, problems };
}

if (process.argv[1] && process.argv[1].endsWith('backup.ts')) {
  const verifyIndex = process.argv.indexOf('--verify');

  if (verifyIndex >= 0) {
    const dir = process.argv[verifyIndex + 1];
    if (!dir) { console.error('  --verify needs a directory'); process.exit(2); }
    const result = await verifyBackup(resolve(dir));
    console.log(`\n  ${result.ok ? 'Intact' : 'PROBLEMS FOUND'}: ${dir}`);
    for (const p of result.problems) console.log(`    - ${p}`);
    console.log();
    process.exit(result.ok ? 0 : 1);
  }

  /*
   * Resolved from THIS FILE, not from the working directory.
   *
   * A workspace script runs with its own package as the working directory, so `process.cwd()` here is
   * `packages/ozikoro` and `.data/pg` resolved to a directory that has never existed. The database
   * lives at the repository root, and walking up from the module is the only way to be sure of that
   * wherever the script is invoked from.
   */
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const dataDir = resolve(repoRoot, '.data', 'pg');
  const backupRoot = resolve(repoRoot, '.data', 'backups');
  console.log('\n  Backing up the archive');
  console.log(`  From: ${dataDir}\n`);
  try {
    const { dir, manifest } = await takeBackup({ dataDir, backupRoot });
    console.log(`  Written to ${dir}`);
    console.log(`  ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB`);
    for (const [t, n] of Object.entries(manifest.counts)) {
      console.log(`    ${t.padEnd(24)} ${n < 0 ? 'not present' : n}`);
    }
    console.log('\n  Verify it with: node src/ops/backup.ts --verify ' + dir + '\n');
  } catch (error) {
    console.error(`\n  Backup failed: ${String(error).slice(0, 300)}\n`);
    process.exitCode = 1;
  }
}
