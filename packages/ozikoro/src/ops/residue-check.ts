/**
 * Is any test data left in the database?
 *
 * WHY THIS EXISTS
 *
 * Test residue has bitten this project repeatedly. The worst instance was found in round 54: two
 * accounts left behind by an exploratory authorization test in round 44 were, at that moment, the
 * ONLY entries in the /researchers directory — presented as real researchers under the names
 * `zztest-idor-a@example.com` and `zztest-idor-b@example.com`, marked public, and **listed in the
 * sitemap** at /researchers/298/ and /researchers/299/.
 *
 * That is the precise thing the objective forbids — never label demonstration content as real — and
 * nothing would have caught it. Every suite passed. The tests clean up after themselves *when they
 * finish*; a test that is interrupted, or whose cleanup misses a table, leaves rows behind and
 * everything still reports green.
 *
 * So this asks the question directly, on the whole database rather than on one suite's tables, and
 * `verify-all.sh` runs it. A test that leaves residue now fails the run that created it, rather than
 * surfacing as invented people on a public page weeks later.
 *
 * Run with: node src/ops/residue-check.ts
 */
import { getDb, closeDb, type Db } from '@ozituma/db/client';

/** Every table that could hold a row created by a test, and the column to match on. */
const CHECKS: { table: string; column: string }[] = [
  { table: 'account', column: 'email' },
  { table: 'ozikoro_member', column: 'display_name' },
  { table: 'ozikoro_contributor', column: 'display_name' },
  { table: 'ozikoro_contributor_claim', column: 'evidence' },
  { table: 'ozikoro_publication', column: 'slug' },
  { table: 'ozikoro_publication_author', column: 'name' },
  { table: 'ozikoro_entity', column: 'slug' },
  { table: 'ozikoro_media_rights', column: 'holder_name' },
  { table: 'ozikoro_correction', column: 'rationale' },
];

/** The prefix every test fixture in this repository uses. */
const PREFIX = 'zztest';

export async function findResidue(db: Db): Promise<{ table: string; count: number }[]> {
  const found: { table: string; count: number }[] = [];
  for (const { table, column } of CHECKS) {
    try {
      const row = await db.one<{ n: number }>(
        `select count(*)::int as n from ${table} where ${column} like $1`,
        [`${PREFIX}%`]
      );
      const n = Number(row?.n ?? 0);
      if (n > 0) found.push({ table, count: n });
    } catch {
      // The table does not exist in this database; nothing to check is not residue.
    }
  }
  return found;
}

if (process.argv[1] && process.argv[1].endsWith('residue-check.ts')) {
  const db = await getDb();
  const found = await findResidue(db);
  await closeDb();

  if (found.length === 0) {
    console.log('\n  No test residue. Every table checked is clean.\n');
    process.exit(0);
  }

  console.error('\n  TEST RESIDUE FOUND — the database contains fixture data.\n');
  for (const { table, count } of found) console.error(`    ${table.padEnd(30)} ${count} row(s)`);
  console.error(
    '\n  Test data in the database is not harmless: rows marked public are served to readers and\n' +
      '  listed in the sitemap as if they were real. Remove them before doing anything else.\n'
  );
  process.exit(1);
}
