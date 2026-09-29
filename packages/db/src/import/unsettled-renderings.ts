/**
 * Take down the proverb renderings that are not settled readings.
 *
 *   node packages/db/src/import/unsettled-renderings.ts                  # report only
 *   node packages/db/src/import/unsettled-renderings.ts --apply --confirm
 *
 * THE OWNER'S INSTRUCTION
 *
 * "You added meanings that never aligned... and even wrote 'uncertain' on it. Please,
 * if you're not sure you're at least 90% right, remove them, instead of giving false
 * information." /proverbs/51784 was the example: a corrupt line, "A baa nshị a rịhị",
 * published under a Meaning beginning "[uncertain] Whoever walks himself into the
 * muck...", with a paragraph underneath explaining that the reading was uncertain.
 *
 * WHAT THE THREE CONFIDENCE LEVELS MEANT
 *
 * The pipeline that wrote these renderings asked the model to grade itself, and the
 * grades mean different things — this is the whole reason the cut is where it is:
 *
 *   high    the proverb's sense is well established and the reading is sure
 *   medium  the sense is clear, but the English could reasonably be phrased differently
 *   low     the Igbo is corrupt, fragmentary, or the sense was a guess
 *
 * `medium` is a note about wording, not about truth: the reading is right and a
 * different sentence would also be right. `low` is the model saying it could not
 * establish the sense — and 418 of those 668 say so in the text itself, with
 * `[uncertain]` at the front. Sampling backs the distinction up: of 25 `medium`
 * renderings read against their proverb, none misstated the proverb; of 25 `low`
 * renderings, most announce that the line is truncated, garbled or unrecoverable, and
 * the rest give a confident-sounding meaning for a line they also admit is broken.
 *
 * So `high` and `medium` stay, and every `low` reading goes.
 *
 * WHAT "GOES" MEANS
 *
 * The meaning is not replaced with a hedge and not labelled — the fields are cleared,
 * so the proverb is shown in Igbo alone, which is what the section already says for a
 * proverb with no rendering recorded ("No English rendering of this proverb has been
 * recorded yet. It is shown in Igbo alone rather than given a drafted one").
 *
 * The same six fields go together, because they were one guess: `translation`,
 * `literal_translation`, `usage_note`, `english_equivalent`, `theme` and
 * `translation_confidence`. A confident-sounding literal for a line the model called
 * garbled is the same false information in a different field, and a theme assigned
 * from a sense that could not be established is a claim about the proverb's content.
 * A proverb with no theme simply does not appear under a theme filter, which is
 * honest; it still appears in the section and in search.
 *
 * THE RENDERINGS ARE NOT DESTROYED
 *
 * The tombstone is written before anything is cleared, as `audio-unlabelled.ts` does,
 * and it holds the full text of every field removed. The renderings are also still in
 * the generator's own output under `proverbs-work/`, unattributed to a proverb only in
 * the sense that the join has to be redone. What is gone is the publication of them.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, type Db } from '../client.ts';

export interface Unsettled {
  id: number;
  text: string;
  translation: string | null;
  literalTranslation: string | null;
  usageNote: string | null;
  englishEquivalent: string | null;
  theme: string | null;
  confidence: string | null;
}

/**
 * Anything that names itself uncertain, however the pipeline recorded it.
 *
 * Both halves are needed. 418 of the 668 low readings carry the marker in their text
 * and 250 do not, and a rendering can carry the marker without the column being set —
 * the pipeline had two ways of recording the same doubt and used both.
 */
/**
 * Everything we wrote ourselves.
 *
 * The owner, having seen the low-confidence ones go: "in the proverbs section, can you delete every
 * proverb that you had to generate for the description... Every single one that you had to generate
 * yourself is majorly wrong or extremely wrong, so remove them. Leave the ones that came with an
 * English translation already."
 *
 * `translation_confidence` is set only on a rendering this pipeline produced, so a non-null value IS
 * the record of "we wrote this". A rendering that came with the proverb from a book or an article has
 * no confidence, because the pipeline never graded it — it did not write it.
 *
 * A proverb a contributor has edited is kept regardless of how it got there. Someone has read it and
 * decided, and that outranks the provenance question.
 */
export const GENERATED_WHERE = `
  e.style = 'proverb'
  and e.translation_confidence is not null
  and not exists (select 1 from proverb_revision r where r.example_id = e.id)`;

export const UNSETTLED_WHERE = `
  e.style = 'proverb'
  and (
    e.translation_confidence = 'low'
    or starts_with(e.translation, '[uncertain]')
  )`;

export async function findUnsettled(db: Db, rule: string = UNSETTLED_WHERE): Promise<Unsettled[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select e.id, e.text, e.translation, e.literal_translation, e.usage_note,
            e.english_equivalent, e.theme, e.translation_confidence
       from example e
      where ${rule}
      order by e.id`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    text: String(row.text),
    translation: (row.translation as string | null) ?? null,
    literalTranslation: (row.literal_translation as string | null) ?? null,
    usageNote: (row.usage_note as string | null) ?? null,
    englishEquivalent: (row.english_equivalent as string | null) ?? null,
    theme: (row.theme as string | null) ?? null,
    confidence: (row.translation_confidence as string | null) ?? null,
  }));
}

/**
 * Clear every field of every unsettled rendering, and say how many rows changed.
 *
 * Exported so the test can drive it against fixtures rather than against the live
 * section: the thing worth proving is that it clears the low readings and leaves the
 * high and medium ones exactly as they were, and that is only checkable with rows that
 * are known to be one or the other.
 */
export async function clearUnsettledRenderings(
  db: Db,
  rule: string = UNSETTLED_WHERE
): Promise<number> {
  const result = await db.query(
    `update example e
        set translation = null,
            literal_translation = null,
            usage_note = null,
            english_equivalent = null,
            theme = null,
            translation_confidence = null
      where ${rule}`
  );
  return result.rowCount ?? 0;
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/**
 * The tombstone, written before anything is cleared.
 *
 * `audio-unlabelled.ts` taught this the hard way: a removal with no record cannot be
 * undone, and the record has to exist before the deletion does, or a failure part-way
 * through leaves neither.
 */
export async function writeUnsettledTombstone(
  rows: Unsettled[],
  out: string
): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        reason:
          'Proverb renderings at low confidence — the Igbo corrupt, fragmentary, or the ' +
          'sense a guess. Removed on the owner\u2019s instruction: a meaning that is not at ' +
          'least 90% certain is not published at all. The proverb keeps its place in the ' +
          'section and is shown in Igbo alone.',
        cleared: [
          'translation',
          'literal_translation',
          'usage_note',
          'english_equivalent',
          'theme',
          'translation_confidence',
        ],
        removed: rows,
      },
      null,
      2
    )}\n`
  );
}

async function main(): Promise<void> {
  const db = await getDb();
  const apply = process.argv.includes('--apply');
  const confirm = process.argv.includes('--confirm');
  const out =
    arg('--out') ??
    `data/sources/audit/unsettled-renderings-${new Date().toISOString().slice(0, 10)}.json`;

  /*
   * `--generated` widens the rule from "readings we could not stand behind" to "readings we wrote".
   * The owner asked for the second after the first was not enough.
   */
  const generated = process.argv.includes('--generated');
  const rule = generated ? GENERATED_WHERE : UNSETTLED_WHERE;
  const candidates = await findUnsettled(db, rule);

  console.log(
    generated
      ? '\nProverb renderings written by this project, which are being taken down\n'
      : '\nProverb renderings that are not settled readings\n'
  );
  console.log(`  to take down                        ${candidates.length}`);
  for (const row of candidates.slice(0, 12)) {
    console.log(
      `  ${String(row.id).padStart(7)}  ${row.text.slice(0, 46).padEnd(48)} ` +
        `${(row.translation ?? '').slice(0, 60)}`
    );
  }
  if (candidates.length > 12) {
    console.log(`  \u2026 and ${candidates.length - 12} more, all in the audit file.`);
  }

  /*
   * The state after the cut, so the number kept is visible rather than assumed. Read
   * from the database rather than computed from the candidates, because the question a
   * reader asks is "how many proverbs still have a meaning", not "how many were removed".
   */
  const spread = await db.rows<{ conf: string; n: number; themed: number }>(
    `select coalesce(e.translation_confidence, '(from a source)') as conf,
            count(*)::int as n,
            count(*) filter (where e.theme is not null)::int as themed
       from example e
      where e.style = 'proverb' and e.translation is not null
        and e.translation_confidence is distinct from 'low'
        and not starts_with(e.translation, '[uncertain]')
      group by 1
      order by 2 desc`
  );
  console.log('\n  renderings that stay, by how settled they are:');
  for (const row of spread) {
    console.log(`    ${row.conf.padEnd(18)} ${String(row.n).padStart(5)}  (${row.themed} themed)`);
  }

  if (!apply || !confirm) {
    console.log();
    console.log('  DRY RUN \u2014 nothing was changed. Re-run with --apply --confirm to take them down.');
    return;
  }

  await writeUnsettledTombstone(candidates, out);
  console.log(`\n  audit written to ${out}`);

  const cleared = await clearUnsettledRenderings(db, rule);

  const left = await db.one<{ n: number }>(
    `select count(*)::int as n from example e
      where e.style = 'proverb'
        and (e.translation_confidence = 'low' or starts_with(e.translation, '[uncertain]'))`
  );
  const withMeaning = await db.one<{ n: number }>(
    `select count(*)::int as n from example
      where style = 'proverb' and translation is not null`
  );

  console.log();
  console.log(`  renderings taken down               ${cleared}`);
  console.log(`  unsettled left                      ${Number(left?.n ?? 0)}`);
  console.log(`  proverbs with a meaning             ${Number(withMeaning?.n ?? 0)}`);
  console.log();
  console.log('  Run `npm run verify` \u2014 the gate checks the proverb invariants.');
}

if (process.argv[1] && process.argv[1].endsWith(basename(fileURLToPath(import.meta.url)))) {
  main()
    .then(() => closeDb())
    .catch(async (error) => {
      console.error('\nFailed:', error instanceof Error ? error.message : error);
      await closeDb();
      process.exitCode = 1;
    });
}
