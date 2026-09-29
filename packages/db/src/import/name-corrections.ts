/**
 * Apply the owner's stated name corrections to the name dictionary as it stands.
 *
 *   node packages/db/src/import/name-corrections.ts                    # report only
 *   node packages/db/src/import/name-corrections.ts --apply --confirm
 *
 * WHY THIS EXISTS BESIDE THE IMPORTER
 *
 * `names-corpus.ts` already reads `owner-corrections.json` and applies gender, variants,
 * meanings and now renames — but it does so while building the whole name dictionary from
 * the corpora, which is 2,889 rows and re-derives everything. The owner's corrections are
 * a handful of statements about named entries, and when one arrives the entry has to be
 * right; re-importing the corpus to change four rows is a large action with a large blast
 * radius for a small, precisely-stated fact.
 *
 * So this applies the same file to the live rows, and nothing else. The file stays the one
 * source of truth: both paths read it, and a correction added for a future import takes
 * effect here the same way.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not touch the script layer. `import:script` re-derives `person_name_script` from
 * the names as they are, so run it afterwards when a rename has moved a spelling — a
 * renamed name whose Ndebe value still spells the old name is exactly the kind of stale
 * row the gate refuses.
 */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, type Db } from '../client.ts';
import { deriveForms, slugify } from '@ozituma/core';
import { DEFAULT_NAMES_ROOT, correctionKey } from './names-corpus.ts';

interface Corrections {
  gender: Record<string, string>;
  variants: Record<string, string[]>;
  meanings: Record<string, string>;
  renames: Record<string, string>;
}

interface NameRow {
  id: number;
  name: string;
  search_form: string;
  slug: string;
  meaning: string | null;
  gender: string;
  gender_basis: string | null;
  variants: string[];
}

/**
 * `var` as the abbreviation, and nothing else.
 *
 * The owner: "When you also write 'A dialectal var. of' in the name section, why not write
 * 'var.' in full? people cannot easily grasp it is an abbreviation of variant."
 *
 * Word boundaries do most of the work — `\bvar\b` cannot match inside `variant`, so a
 * meaning that already says "variant" is left alone, and `variety`/`varies` are untouched.
 *
 * The full stop needs care, and getting it wrong is visible: a plain `\bvar\b` replacement
 * turns "A dialectal var. of Akowundu" into "A dialectal variant. of Akowundu". In that
 * position the dot is the abbreviation's own mark rather than the end of a sentence, so it
 * goes with the abbreviation. Where the abbreviation ends the sentence the dot stays,
 * because "A var." is a sentence and "A variant" is not.
 */
function expandAbbreviations(meaning: string): string {
  return meaning
    // Mid-sentence: "var. of", "var. in" — the dot belonged to the abbreviation, so it goes.
    .replace(/\bvar\.\s+(?=[a-z(])/g, 'variant ')
    .replace(/\bVar\.\s+(?=[a-z(])/g, 'Variant ')
    // Sentence-final: "…wisdom. A var." — the dot is the sentence's, so it stays.
    .replace(/\bvar\./g, 'variant.')
    .replace(/\bVar\./g, 'Variant.')
    // And the form written with no dot at all.
    .replace(/\bvar\b/g, 'variant')
    .replace(/\bVar\b/g, 'Variant');
}

export interface NameCorrectionsReport {
  namesRead: number;
  gendersChanged: number;
  variantsAdded: number;
  renamed: number;
  referencesRewritten: number;
  meaningsReplaced: number;
  meaningsReabbreviated: number;
  /** Rows actually written — only the ones a correction changed. */
  rowsWritten?: number;
  /** Correction keys that matched no row, so a ruling is doing nothing. */
  unmatched: string[];
  collisions: string[];
  durationMs: number;
}

export async function applyNameCorrections(
  options: {
    root?: string;
    languageCode?: string;
    apply?: boolean;
    log?: (message: string) => void;
  } = {}
): Promise<NameCorrectionsReport> {
  const started = Date.now();
  const languageCode = options.languageCode ?? 'ibo';
  const root = options.root ?? process.env.OZITUMA_NAMES_ROOT ?? DEFAULT_NAMES_ROOT;
  const log = options.log ?? ((message: string) => console.log(message));
  const apply = options.apply ?? false;
  const db = await getDb();

  const raw = JSON.parse(
    await readFile(join(root, 'owner', 'owner-corrections.json'), 'utf8')
  ) as Partial<Corrections>;
  const corrections: Corrections = {
    gender: raw.gender ?? {},
    variants: raw.variants ?? {},
    meanings: raw.meanings ?? {},
    renames: raw.renames ?? {},
  };

  const rows = (
    await db.rows<Record<string, unknown>>(
      `select id, name, search_form, slug, meaning, gender, gender_basis, variants
         from person_name where language_code = $1 order by id`,
      [languageCode]
    )
  ).map(
    (row): NameRow => ({
      id: Number(row.id),
      name: String(row.name),
      search_form: String(row.search_form),
      slug: String(row.slug),
      meaning: (row.meaning as string | null) ?? null,
      gender: String(row.gender),
      gender_basis: (row.gender_basis as string | null) ?? null,
      variants: (row.variants as string[] | null) ?? [],
    })
  );
  log(`  names in ${languageCode}                   ${rows.length}`);

  /*
   * Snapshot the rows as loaded, BEFORE anything is changed.
   *
   * The first version re-queried the database here instead, and compared that against the
   * in-memory rows. It never matched: `id` comes back from Postgres as a string because the
   * column is a bigint, while the in-memory row holds it as a number, so every one of the
   * 2,889 rows was written on every run — a no-op in values, but 2,889 UPDATEs to change
   * 130 rows, and it made the "only what changed is written" claim in the docstring false.
   * Comparing like with like is the fix.
   */
  const before = new Map(rows.map((row) => [row.id, JSON.stringify(row)]));

  const byKey = new Map<string, NameRow>();
  for (const row of rows) {
    const key = correctionKey(row.search_form);
    if (!byKey.has(key)) byKey.set(key, row);
  }

  const unmatched: string[] = [];
  const collisions: string[] = [];
  const changes: string[] = [];

  const find = (name: string): NameRow | undefined => {
    const row = byKey.get(correctionKey(name));
    if (!row) unmatched.push(name);
    return row;
  };

  // --- gender -------------------------------------------------------------
  let gendersChanged = 0;
  for (const [name, gender] of Object.entries(corrections.gender)) {
    const row = find(name);
    if (!row || row.gender === gender) continue;
    changes.push(`  gender    ${row.name}: ${row.gender} -> ${gender} (owner)`);
    row.gender = gender;
    row.gender_basis = 'owner';
    gendersChanged += 1;
  }

  // --- variants -----------------------------------------------------------
  let variantsAdded = 0;
  for (const [name, variants] of Object.entries(corrections.variants)) {
    const row = find(name);
    if (!row) continue;
    for (const variant of variants) {
      if (variant === row.name || row.variants.includes(variant)) continue;
      changes.push(`  variant   ${row.name} += ${variant}`);
      row.variants.push(variant);
      variantsAdded += 1;
    }
  }

  // --- renames ------------------------------------------------------------
  /*
   * The entry's own spelling is wrong, so it is corrected in place: the name, the folded
   * key the dictionary looks it up by, and the slug every URL it has ever been linked by
   * is built from.
   *
   * A target that another entry already holds is refused rather than merged. Merging two
   * name entries is a different operation with different consequences — which meaning
   * survives, which variants are inherited — and it is not what the owner said to do.
   */
  let renamed = 0;
  const renamePairs: Array<[string, string]> = [];
  const takenSlugs = new Set(rows.map((row) => row.slug));
  for (const [from, to] of Object.entries(corrections.renames)) {
    const row = find(from);
    if (!row) continue;
    if (row.name === to) continue;
    const slug = slugify(to).slice(0, 80);
    if (slug !== row.slug && takenSlugs.has(slug)) {
      collisions.push(`${from} -> ${to}: slug "${slug}" is already used`);
      continue;
    }
    changes.push(`  rename    ${row.name} -> ${to}  (/${row.slug} -> /${slug})`);
    takenSlugs.delete(row.slug);
    takenSlugs.add(slug);
    byKey.delete(correctionKey(row.search_form));
    row.name = to;
    row.search_form = deriveForms(to).searchForm;
    row.slug = slug;
    byKey.set(correctionKey(row.search_form), row);
    renamePairs.push([from, to]);
    renamed += 1;
  }

  // --- references to a renamed spelling -----------------------------------
  let referencesRewritten = 0;
  if (renamePairs.length > 0) {
    for (const row of rows) {
      for (const [from, to] of renamePairs) {
        if (row.name === to) continue;
        const index = row.variants.indexOf(from);
        if (index === -1) continue;
        row.variants.splice(index, 1);
        if (!row.variants.includes(to)) row.variants.push(to);
        changes.push(`  link      ${row.name}: ${from} -> ${to}`);
        referencesRewritten += 1;
      }
    }
  }

  // --- meanings the owner states, and the abbreviation in every other one --
  let meaningsReplaced = 0;
  for (const [name, meaning] of Object.entries(corrections.meanings)) {
    const row = find(name);
    if (!row || row.meaning === meaning) continue;
    changes.push(`  meaning   ${row.name} replaced with the owner's wording`);
    row.meaning = meaning;
    meaningsReplaced += 1;
  }

  let meaningsReabbreviated = 0;
  for (const row of rows) {
    if (!row.meaning || !/\bvar\b/i.test(row.meaning)) continue;
    const expanded = expandAbbreviations(row.meaning);
    if (expanded === row.meaning) continue;
    changes.push(`  wording   ${row.name}: "var." written in full`);
    row.meaning = expanded;
    meaningsReabbreviated += 1;
  }

  log(`  gender corrections                 ${gendersChanged}`);
  log(`  variants added                     ${variantsAdded}`);
  log(`  entries renamed                    ${renamed}`);
  log(`  references to a renamed spelling   ${referencesRewritten}`);
  log(`  owner meanings applied             ${meaningsReplaced}`);
  log(`  meanings with "var." written out    ${meaningsReabbreviated}`);
  if (collisions.length > 0) {
    log(`  ! renames refused (${collisions.length})`);
    for (const line of collisions) log(`      ${line}`);
  }
  if (unmatched.length > 0) {
    // Reported, not ignored: a correction that matches nothing is a ruling that looks as
    // though it is in force while doing nothing at all.
    log(`  ! corrections matching no name     ${unmatched.length}`);
    log(`      ${[...new Set(unmatched)].join(', ')}`);
  }

  if (changes.length > 0) {
    log('');
    for (const line of changes) log(line);
  }

  if (!apply) {
    log('');
    log('  DRY RUN — nothing was written. Re-run with --apply --confirm.');
    return {
      namesRead: rows.length,
      gendersChanged,
      variantsAdded,
      renamed,
      referencesRewritten,
      meaningsReplaced,
      meaningsReabbreviated,
      unmatched: [...new Set(unmatched)],
      collisions,
      durationMs: Date.now() - started,
    };
  }

  /*
   * Written one row at a time, and only the rows that changed.
   *
   * A single bulk UPDATE over every name would rewrite 2,889 rows to change 130, and the
   * point of this script is that its effect is small enough to read.
   */
  let written = 0;
  for (const row of rows) {
    if (before.get(row.id) === JSON.stringify(row)) continue;
    await db.query(
      `update person_name
          set name = $2, search_form = $3, slug = $4, meaning = $5,
              gender = $6, gender_basis = $7, variants = $8
        where id = $1`,
      [
        row.id,
        row.name,
        row.search_form,
        row.slug,
        row.meaning,
        row.gender,
        row.gender_basis,
        row.variants,
      ]
    );
    written += 1;
  }
  log('');
  log(`  rows written                       ${written}`);
  log('');
  log('  Run `npm run verify` — the gate checks the name invariants, including that');
  log('  every Ndebe value re-derives from the name it is stored against.');

  return {
    namesRead: rows.length,
    rowsWritten: written,
    gendersChanged,
    variantsAdded,
    renamed,
    referencesRewritten,
    meaningsReplaced,
    meaningsReabbreviated,
    unmatched: [...new Set(unmatched)],
    collisions,
    durationMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const db: Db = await getDb();
  try {
    console.log('\nThe owner\'s corrections, applied to the name dictionary as it stands\n');
    await applyNameCorrections({
      apply: process.argv.includes('--apply') && process.argv.includes('--confirm'),
    });
  } finally {
    await closeDb();
  }
}

// Only when run directly: the test imports this module to drive the same function.
/*
 * Only when run directly.
 *
 * `endsWith('<file>')` is not enough: the test that drives this module is called
 * `test-<file>`, which also ends with it, so importing the module ran the CLI,
 * and the CLI closed the database under the test that was still using it. Compare
 * the whole basename instead.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  basename(fileURLToPath(import.meta.url)) === basename(process.argv[1]);
if (invokedDirectly) {
  main().catch(async (error) => {
    console.error('\nFailed:', error instanceof Error ? error.message : error);
    await closeDb();
    process.exitCode = 1;
  });
}
