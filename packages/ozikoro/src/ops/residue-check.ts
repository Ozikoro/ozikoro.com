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

/*
 * THE TABLES ARE DISCOVERED, NOT LISTED.
 *
 * The first version of this check named nine tables. That is the same weakness as a sitemap assembled
 * from whichever lists its author remembered — the thing this project fixed in round 16, where the
 * remembered list omitted 92% of the archive. A table added later would simply not be checked, and
 * nothing would say so.
 *
 * So the scan asks the database what it has: every table with a text column, checked for the fixture
 * prefix. Measured at 102 tables on this database, and it found what the fixed list found — which is
 * the point: the answer is now known rather than assumed.
 */

/** The prefix every test fixture in this repository uses. */
const PREFIX = 'zztest';

/*
 * How much of the database the last scan actually reached.
 *
 * WHY THIS EXISTS (round 103)
 *
 * Everywhere else in this project, "nothing matched" means the extractor is broken and the check refuses
 * to pass. HERE IT IS THE DESIRED RESULT — so a scan that reached nothing reports "Every table checked is
 * clean" on every input, a permanent silent pass on a data-integrity check.
 *
 * Two ways that could happen, both real:
 *
 *   1. `information_schema` returns no text columns, so the loop runs zero times and `found` is empty.
 *   2. Every query throws — a permissions problem, a renamed role, a broken connection — and the `catch`
 *      below swallows all of them. **Total failure would look exactly like a clean database.**
 *
 * Measured at 102 tables with text columns on this database. The runner now refuses to report clean
 * unless it actually scanned something, and reports anything it skipped instead of burying it.
 */
let lastScan = { scanned: 0, skipped: 0 };
export function lastScanStats(): { scanned: number; skipped: number } {
  return lastScan;
}

export async function findResidue(db: Db): Promise<{ table: string; count: number }[]> {
  const columns = await db.rows<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type in ('text', 'character varying')
      order by table_name, column_name`
  );

  const byTable = new Map<string, string[]>();
  for (const c of columns) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
    byTable.get(c.table_name)!.push(c.column_name);
  }

  const found: { table: string; count: number }[] = [];
  let scanned = 0;
  let skipped = 0;
  for (const [table, cols] of byTable) {
    // Identifiers come from information_schema, not from input, and are quoted anyway.
    const where = cols.map((c) => `"${c}"::text like $1`).join(' or ');
    try {
      const row = await db.one<{ n: number }>(
        `select count(*)::int as n from "${table}" where ${where}`,
        [`${PREFIX}%`]
      );
      const n = Number(row?.n ?? 0);
      scanned++;
      if (n > 0) found.push({ table, count: n });
    } catch {
      // A view or table this role cannot read. Not residue, and not a reason to stop — but it IS counted,
      // because a scan where every table was skipped is not a scan that found nothing.
      skipped++;
    }
  }
  lastScan = { scanned, skipped };
  return found;
}

if (process.argv[1] && process.argv[1].endsWith('residue-check.ts')) {
  const db = await getDb();
  const found = await findResidue(db);
  await closeDb();

  const stats = lastScanStats();
  if (stats.scanned === 0) {
    // The round-57 rule, applied where it matters most: a check that examined nothing is not a pass.
    console.error(
      `\n  SCANNED NO TABLES — ${stats.skipped} skipped, 0 read. Not a pass: a scan that reached` +
        ` nothing reports a clean database on every input.\n`
    );
    process.exit(2);
  }

  if (stats.skipped > 0) {
    // Visible rather than swallowed. A partial scan is still useful, but silently skipping is not.
    console.log(`\n  NOTE: ${stats.skipped} table(s) could not be read and were skipped.`);
  }

  if (found.length === 0) {
    console.log(`\n  No test residue. ${stats.scanned} table(s) checked, every one clean.\n`);
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
