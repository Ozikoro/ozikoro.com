/**
 * Recordings attached to a word with no variety, where the word has more than one.
 *
 *   node packages/db/src/import/audio-unlabelled.ts                    # report only
 *   node packages/db/src/import/audio-unlabelled.ts --apply --confirm
 *
 * THE OWNER'S REPORT
 *
 * "There's some parts of the page with audio recordings that has no dialect or word
 * attached to them, so if such occurs, do remove them entirely", with
 * /word/igbo/ojoko as the example. That page ends with two play buttons whose only
 * label is "dialect not specified": the entry's own recording sits beside the
 * headword, and the page then lists any remaining clips as chips, and a clip with
 * no variety has no label to give the chip.
 *
 * WHAT IS ACTUALLY WRONG
 *
 * Not an orphan: no recording in this database is attached to nothing — 4,446
 * carry a word, 16,952 a dialect spelling, 24,986 an example, and none floats
 * free. What the page showed was a word holding several clips with no variety to
 * tell them apart, which is the same thing to a reader: two buttons, identical
 * labels, nothing to choose between them.
 *
 * So the rule is narrow and deliberately so. Among a word's clips that have no
 * variety, no dialect spelling and no example, the lowest id stays — the one the
 * entry page already shows beside the headword — and the rest go. A word with one
 * unlabelled recording keeps it, because that recording IS the word's
 * pronunciation. Only the extras go, and there are 188 of them.
 *
 * IT DOES NOT TOUCH A WORD'S OWN RECORDING, AND THAT IS NOT NEGOTIABLE
 *
 * This script briefly had a `--all` mode, on the reasoning that a clip naming no
 * variety is a clip that cannot say what it is, so a word should lose it and keep
 * its meanings. Run against the live data, that took `audio.word_id` to ZERO:
 * every headword pronunciation in the dictionary — 4,446 recordings, the entire
 * nkowaokwu corpus's word layer — was deleted, while the dialect recordings beside
 * them were left alone. The owner found it on /word/igbo/ike, where the entry's
 * own recording had gone and the page had promoted Ọnịcha's recording of "ume"
 * into the headword's place, so the page said "ike" and played "ume".
 *
 * A word's own pronunciation has no variety because it is not OF a variety. "No
 * label" is what a headword recording is supposed to look like; it was never
 * evidence that the recording was junk. So there is no longer any mode of this
 * script that removes a word's last unlabelled clip, and the first clip per word is
 * kept unconditionally.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not touch a clip with a variety, a dialect spelling or an example, and
 * it does not delete anything from object storage: the rows go and the file stays,
 * so a removal can be undone from the source corpus, exactly as the ASR review
 * does it. `restore-headword-audio.ts` is the script that puts back what the
 * `--all` run removed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { closeDb, getDb, type Db } from '../client.ts';

interface Candidate {
  id: number;
  wordId: number;
  headword: string;
  keepId: number;
  storageKey: string | null;
  externalUrl: string | null;
}

async function findCandidates(db: Db, keepOne: boolean): Promise<Candidate[]> {
  const rows = await db.rows<Record<string, unknown>>(
    /*
     * The keep id is the lowest among the SAME kind of clip — unlabelled — rather
     * than the lowest overall: a word whose first clip is a dialect recording must
     * not have that one kept in place of its own pronunciation.
     */
    `with plain as (
       select a.id, a.word_id, a.storage_key, a.external_url,
              min(a.id) over (partition by a.word_id) as keep_id
         from audio a
        where a.word_id is not null
          and a.dialect_id is null
          and a.word_dialect_id is null
          and a.example_id is null
     )
     select p.id, p.word_id, w.headword, p.keep_id, p.storage_key, p.external_url
       from plain p
       join word w on w.id = p.word_id
      where $1 = false or p.id <> p.keep_id
      order by w.headword, p.id`,
    [keepOne]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    wordId: Number(row.word_id),
    headword: String(row.headword),
    keepId: Number(row.keep_id),
    storageKey: (row.storage_key as string | null) ?? null,
    externalUrl: (row.external_url as string | null) ?? null,
  }));
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const db = await getDb();
const apply = process.argv.includes('--apply');
const confirm = process.argv.includes('--confirm');
const out =
  arg('--out') ?? `data/sources/audit/unlabelled-recordings-${new Date().toISOString().slice(0, 10)}.json`;

/*
 * One rule, and no option to widen it.
 *
 * `findCandidates(db, true)` keeps the lowest-id unlabelled clip on every word and
 * removes only the extras. The second mode that used to exist here — remove them
 * all, on the theory that a word is better off with no recording than with one
 * that names no variety — deleted every headword pronunciation in the dictionary.
 * See the note at the top: a headword recording has no variety because it is not
 * of one. The flag is gone rather than defaulted, so it cannot be reached again.
 */
const candidates = await findCandidates(db, true);
const words = new Set(candidates.map((c) => c.wordId));

console.log('Recordings with no variety, on a word that has more than one');
console.log();
console.log(`  ${candidates.length} clip(s) to remove, across ${words.size} word(s).`);
console.log('  One unlabelled recording per word is kept: the entry page shows it beside the headword.');
console.log();
console.log('  headword                          clip id   kept id   storage key');
for (const row of candidates.slice(0, 40)) {
  console.log(
    `  ${row.headword.slice(0, 30).padEnd(30)} ${String(row.id).padStart(8)} ${String(row.keepId).padStart(9)}   ` +
      `${(row.storageKey ?? row.externalUrl ?? '—').slice(-38)}`
  );
}
if (candidates.length > 40) console.log(`  … and ${candidates.length - 40} more, all in the audit file.`);

if (!apply || !confirm) {
  console.log();
  console.log('  DRY RUN — nothing was deleted. Re-run with --apply --confirm to remove these.');
  await closeDb();
  process.exit(0);
}

// The tombstone goes first, so a failure part-way through still leaves a record.
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      reason:
        'Recordings attached to a word with no variety, where the word already had one. ' +
        'Removed on the owner’s instruction; the object in storage is left in place so a ' +
        'removal can be undone from the source corpus.',
      kept: 'the lowest-id unlabelled clip per word, which the entry page shows beside the headword',
      removed: candidates,
    },
    null,
    2
  )}\n`
);
console.log(`  audit written to ${out}`);

/*
 * The last line of defence, checked against the database rather than trusted from
 * the query above: how many words would this leave with no recording at all?
 *
 * It must be zero, and it is zero by construction — the window function keeps the
 * first clip per word — but the check is here because the failure it guards against
 * is silent and total. The `--all` run left 13,366 entries with no recording of
 * their own and every gate still passed.
 */
const orphaned = await db.one<{ n: number }>(
  `select count(*)::int as n
     from word w
    where exists (select 1 from audio a where a.word_id = w.id)
      and not exists (
        select 1 from audio a
         where a.word_id = w.id and not (a.id = any($1::bigint[]))
      )`,
  [candidates.map((c) => c.id)]
);
if (Number(orphaned?.n ?? 0) > 0) {
  console.log();
  console.log(`  REFUSING: ${Number(orphaned?.n)} word(s) would be left with no recording at all.`);
  console.log('  A word\'s own pronunciation has no variety because it is not OF one.');
  await closeDb();
  process.exit(1);
}

let removed = 0;
for (const row of candidates) {
  const result = await db.query(`delete from audio where id = $1`, [row.id]);
  removed += result.rowCount ?? 0;
}

const left = await db.one<{ n: number }>(
  `select count(*)::int as n from audio a
    where a.word_id is not null and a.dialect_id is null
      and a.word_dialect_id is null and a.example_id is null
      and a.id <> (select min(b.id) from audio b
                    where b.word_id = a.word_id and b.dialect_id is null
                      and b.word_dialect_id is null and b.example_id is null)`
);
const total = await db.one<{ n: number }>(`select count(*)::int as n from audio`);
const wordOwned = await db.one<{ n: number }>(
  `select count(*)::int as n from audio where word_id is not null`
);

console.log();
console.log(`  clips removed            ${removed}`);
console.log(`  redundant left           ${Number(left?.n ?? 0)}`);
console.log(`  recordings in the table  ${Number(total?.n ?? 0)}`);
console.log(`  headword recordings      ${Number(wordOwned?.n ?? 0)}  (must not drop)`);
console.log();
console.log('  Run `npm run verify` — the gate checks the audio invariants.');

await closeDb();
