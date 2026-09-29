/**
 * Re-derive `exact_form` and `search_form` for any headword that has drifted from them.
 *
 *   node packages/db/src/import/repair-forms.ts                    # report only
 *   node packages/db/src/import/repair-forms.ts --apply --confirm
 *
 * WHY THIS EXISTS
 *
 * Both columns are derived from `headword`, and the gate checks that they still derive —
 * "exact_form re-derives identically for every headword", "search_form re-derives
 * identically", "search_form retains no combining marks". When a headword is corrected
 * outside the importer — which is what happens when a stray comma is taken off a spelling
 * that came out of a printed sentence — those two columns are left holding values derived
 * from the OLD spelling, and the gate fails on rows nobody touched.
 *
 * That is exactly what happened while cleaning five headwords that carried their source's
 * punctuation: the headwords were right, the two derived columns were not, and the gate
 * named them. A repair that leaves derived columns stale is not finished, and re-running
 * the whole importer to fix four rows is a large action for a small fact.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not touch `headword` — the corrected spelling is the input, not the output — and
 * it does not touch the script layer. `import:script` owns `word_script`, and a headword
 * whose Ndebe value no longer derives from it is that script's job; run it afterwards.
 */
import { closeDb, getDb, type Db } from '../client.ts';
import { deriveForms, getLanguage, requireLanguage } from '@ozituma/core';

export interface RepairFormsReport {
  checked: number;
  wrong: number;
  repaired: number;
  examples: string[];
}

export async function repairForms(
  options: { languageCode?: string; apply?: boolean; log?: (m: string) => void } = {}
): Promise<RepairFormsReport> {
  const languageCode = options.languageCode ?? 'ibo';
  const log = options.log ?? ((message: string) => console.log(message));
  const apply = options.apply ?? false;
  const db = await getDb();

  const language = requireLanguage(languageCode);
  const rows = await db.rows<{ id: string; headword: string; exact_form: string; search_form: string }>(
    `select id, headword, exact_form, search_form
       from word where language_code = $1 order by id`,
    [languageCode]
  );

  const wrong: Array<{ id: number; headword: string; exact: string; search: string }> = [];
  for (const row of rows) {
    const derived = deriveForms(row.headword, language ?? getLanguage(languageCode));
    if (derived.exactForm === row.exact_form && derived.searchForm === row.search_form) continue;
    wrong.push({
      id: Number(row.id),
      headword: row.headword,
      exact: derived.exactForm,
      search: derived.searchForm,
    });
  }

  log(`  headwords checked    ${rows.length}`);
  log(`  drifted from them    ${wrong.length}`);
  for (const row of wrong.slice(0, 20)) {
    log(`    ${row.headword}  ->  exact "${row.exact}"  search "${row.search}"`);
  }

  let repaired = 0;
  if (apply) {
    for (const row of wrong) {
      const result = await db.query(
        `update word set exact_form = $2, search_form = $3 where id = $1`,
        [row.id, row.exact, row.search]
      );
      repaired += result.rowCount ?? 0;
    }
    log(`  rows repaired        ${repaired}`);
  }

  return {
    checked: rows.length,
    wrong: wrong.length,
    repaired,
    examples: wrong.slice(0, 5).map((row) => row.headword),
  };
}

async function main(): Promise<void> {
  const db: Db = await getDb();
  try {
    console.log('\nRe-deriving the columns the headword is supposed to produce\n');
    const report = await repairForms({
      apply: process.argv.includes('--apply') && process.argv.includes('--confirm'),
    });
    if (!process.argv.includes('--apply')) {
      console.log('\n  DRY RUN — nothing was written. Re-run with --apply --confirm.');
    }
    console.log('\n  Run `import:script` if a headword itself changed, then `npm run verify`.');
    void report;
  } finally {
    await closeDb();
  }
}

// Only when run directly: comparing whole basenames, because `test-<file>` also ends with
// `<file>` and that has already caused a module to run its CLI under its own test.
const invokedDirectly =
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('repair-forms.ts') &&
  !process.argv[1].endsWith('test-repair-forms.ts');
if (invokedDirectly) {
  main().catch(async (error) => {
    console.error('\nFailed:', error instanceof Error ? error.message : error);
    await closeDb();
    process.exitCode = 1;
  });
}
