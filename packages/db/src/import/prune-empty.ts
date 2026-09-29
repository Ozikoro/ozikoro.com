/**
 * Remove entries that have no meaning, and the ones that are not words at all.
 *
 * WHY THIS EXISTS
 *
 * The Igbo corpus was imported from several sources, and one of them was a
 * corpus of example SENTENCES. Importing sentences creates a word row for every
 * distinct token in them, which is right for the vocabulary and wrong for
 * everything else: alphabet letters, section headings, bound affixes, sentence
 * fragments with a stray bracket, and tone-marked spellings of a word that
 * already exists properly elsewhere. Those rows have no definition and cannot be
 * given one, and an entry with a headword and no meaning is worse than no entry —
 * it is a dead end for a reader and it makes the dictionary look careless.
 *
 *     npm -w @ozituma/db run prune:empty                     # report only
 *     npm -w @ozituma/db run prune:empty -- --apply --confirm
 *
 * Inside a container the working directory is read-only to the app user, so pass
 * an explicit `--out` there and copy the file out afterwards:
 *
 *     docker compose exec -T web node packages/db/src/import/prune-empty.ts \
 *       --apply --confirm --out /tmp/pruned-empty.json
 *     docker cp ozituma-web-1:/tmp/pruned-empty.json /opt/ozituma/audit/
 *
 * WHAT IT WILL NOT DO
 *
 * Deletion is the only irreversible step in the pipeline, so this is deliberately
 * narrow and deliberately loud:
 *
 *   - an entry is only a candidate if it has NO definition at all. A published
 *     entry with a thin or wrong definition is a review problem, not this
 *     script's business.
 *   - before deleting, examples linked to a doomed spelling are re-linked to the
 *     surviving spelling of the same word, so a published example sentence is not
 *     lost along with the duplicate. Which spelling survives is decided by
 *     closeness of the headword, not by the folded form alone: `aka` is the
 *     right twin for `akā`, and `àkà` ("dwarf", "year") is not.
 *   - everything removed is written to an audit file first, with the headword,
 *     the links that went with it, and the twin that inherited them.
 *
 * A SMALL NUMBER ARE KEPT, BY GIVING THEM THE MEANING THE CORPUS ALREADY STATES
 *
 * Four entries have no twin and no definition, but the corpus's own published
 * example translations state what they mean — "She is running to her mother",
 * "even if it is cold", "wrapped it in a broad leaf", "He always goes about
 * borrowing money". Those are given a definition from that evidence rather than
 * deleted, because the meaning is not being guessed: it is being recorded from the
 * source that was collected. They are listed separately in the report so the
 * decision is visible rather than buried.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { closeDb, getDb, type Db } from '../client.ts';

/**
 * Definitions taken from the corpus's own published example translations.
 *
 * Keyed on the headword rather than on a row id, deliberately: an id is a
 * database fact that a restore or a re-import can change, and a stale id here
 * would not just fail to keep the entry — it would delete it. A headword is what
 * the claim is actually about, and the report prints the id it resolved to so the
 * two can be checked against each other.
 *
 * Each one names its evidence, so a future reader can check the claim instead of
 * trusting it. `pos` is the code from `part_of_speech`.
 */
const EDITORIAL: Array<{
  headword: string;
  text: string;
  label: string;
  pos: string | null;
  evidence: string;
}> = [
  {
    headword: 'niīne',
    text: 'all; every; the whole of',
    label: 'from the entry’s own example sentences',
    pos: 'QTF',
    evidence:
      '“Ogè niīne kà ọ nà-àgba mbìbì egō” = “He always goes about borrowing money”; the corpus also lists fa niīne, mgbè niīne, ùwà niīne and ụnù niīne as built on it.',
  },
  {
    headword: 'ò bụnādụ',
    text: 'even if; even (a) — conceding a minimum',
    label: 'from the entry’s own example sentences',
    pos: 'CJN',
    evidence:
      '“Bikō nye m#nni ò bụnāda ǹkè oyī” = “Please give me some food, even if it is cold” and “Bikō nye m nwantịntị egō ò bụnāda (ò bụnādụ) kọbò” = “Please give me some money, even a kobo”.',
  },
  {
    headword: 'ōbodòlòbo',
    text: 'broad leaf; the large leaf used for wrapping food',
    label: 'from the entry’s own example sentences',
    pos: 'NNC',
    evidence:
      '“Di ntā gbàgbùlù òsa wèlụ akwụkwọ ōbodòlòbo kechie yā” = “The hunter killed a squirrel and wrapped it in a broad leaf”, and the proverb the corpus gives with it.',
  },
  {
    headword: 'gbakurịta',
    text: 'to run to; to rush towards (someone)',
    label: 'from the entry’s own example sentences',
    pos: 'VRB',
    evidence:
      '“Ọ nà-àgbakwu nne ya” = “She is running to her mother”, the same verb in its applicative form.',
  },
];

interface Candidate {
  id: number;
  headword: string;
  language: string;
  searchForm: string;
  examples: number[];
  sharedExamples: number;
  relations: number;
}

interface Twin {
  id: number;
  headword: string;
  definitions: number;
  examples: number;
}

/** Levenshtein distance, for choosing between spellings that fold the same. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.normalize('NFC');
  const n = b.normalize('NFC');
  let previous = Array.from({ length: n.length + 1 }, (_, i) => i);
  for (let i = 1; i <= m.length; i += 1) {
    const current = [i, ...Array<number>(n.length).fill(0)];
    for (let j = 1; j <= n.length; j += 1) {
      const cost = m[i - 1] === n[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
    }
    previous = current;
  }
  return previous[n.length] ?? 0;
}

async function findCandidates(db: Db): Promise<Candidate[]> {
  const rows = await db.rows<Record<string, unknown>>(
    `select w.id, w.headword, w.language_code, w.search_form
       from word w
      where not exists (select 1 from definition d where d.word_id = w.id)
      order by w.headword`
  );

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const id = Number(row.id);
    const examples = await db.rows<{ example_id: string; shared: boolean }>(
      `select ew.example_id,
              exists (select 1 from example_word o
                       where o.example_id = ew.example_id and o.word_id <> $1) as shared
         from example_word ew where ew.word_id = $1`,
      [id]
    );
    const relations = await db.one<{ n: number }>(
      `select count(*)::int as n from word_relation
        where from_word_id = $1 or to_word_id = $1`,
      [id]
    );
    candidates.push({
      id,
      headword: String(row.headword),
      language: String(row.language_code),
      searchForm: String(row.search_form),
      examples: examples.map((e) => Number(e.example_id)),
      sharedExamples: examples.filter((e) => e.shared).length,
      relations: Number(relations?.n ?? 0),
    });
  }
  return candidates;
}

/**
 * The surviving spelling that should inherit a doomed one's examples.
 *
 * Same language and same folded form, must already have a definition, and the
 * closest headword wins — `akā` folds to `aka` exactly as `àkà` ("dwarf", "year")
 * does, so the folded form alone would pick the wrong word. Ties go to the entry
 * with more definitions, then more examples, then the lower id.
 */
async function findTwin(db: Db, candidate: Candidate): Promise<Twin | null> {
  const rows = await db.rows<Record<string, unknown>>(
    `select w.id, w.headword,
            (select count(*)::int from definition d where d.word_id = w.id) as definitions,
            (select count(*)::int from example_word ew where ew.word_id = w.id) as examples
       from word w
      where w.language_code = $1 and w.search_form = $2 and w.id <> $3
        and exists (select 1 from definition d where d.word_id = w.id)`,
    [candidate.language, candidate.searchForm, candidate.id]
  );

  const twins = rows.map((row) => ({
    id: Number(row.id),
    headword: String(row.headword),
    definitions: Number(row.definitions),
    examples: Number(row.examples),
  }));
  if (twins.length === 0) return null;

  twins.sort((a, b) => {
    const d = distance(candidate.headword, a.headword) - distance(candidate.headword, b.headword);
    if (d !== 0) return d;
    if (a.definitions !== b.definitions) return b.definitions - a.definitions;
    if (a.examples !== b.examples) return b.examples - a.examples;
    return a.id - b.id;
  });
  return twins[0] ?? null;
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const db = await getDb();
const apply = process.argv.includes('--apply');
const confirm = process.argv.includes('--confirm');
const out =
  arg('--out') ?? `data/sources/audit/pruned-empty-${new Date().toISOString().slice(0, 10)}.json`;

function log(message = ''): void {
  console.log(message);
}

log('Entries with no meaning');
log();

const candidates = await findCandidates(db);
const wanted = new Map(EDITORIAL.map((entry) => [entry.headword, entry]));
const keepers = candidates
  .filter((candidate) => wanted.has(candidate.headword))
  .map((candidate) => ({ candidate, entry: wanted.get(candidate.headword)! }));
const unmatched = EDITORIAL.filter(
  (entry) => !candidates.some((candidate) => candidate.headword === entry.headword)
);

// What the corpus already says about a handful of them.
let editorialApplied = 0;
for (const { candidate, entry } of keepers) {
  if (!apply || !confirm) {
    log(`  KEEP  ${candidate.headword} (id ${candidate.id}) — ${entry.text}`);
    log(`        evidence: ${entry.evidence}`);
    continue;
  }

  /*
   * Attribution, and the gate insists on it: `verify` fails if any definition has
   * no source. The honest source for these is the one that published the example
   * translation the meaning was read off — both are openly licensed (Apache-2.0
   * and CC-BY-4.0) and both permit this with attribution. Falling back to the
   * headword's own source keeps the invariant even if an entry turns out to have
   * no translated example after all; the audit file records the evidence either
   * way, so the reasoning survives even where a single column cannot carry it.
   */
  const fromExample = await db.one<{ source_id: string | null }>(
    `select e.source_id
       from example e join example_word ew on ew.example_id = e.id
      where ew.word_id = $1 and e.translation is not null and e.source_id is not null
      order by e.id limit 1`,
    [candidate.id]
  );
  const fromWord = await db.one<{ source_id: string | null }>(
    `select source_id from word where id = $1`,
    [candidate.id]
  );
  const sourceId = Number(fromExample?.source_id ?? fromWord?.source_id ?? 0) || null;

  const pos = entry.pos
    ? await db.one<{ id: string }>(`select id from part_of_speech where code = $1 limit 1`, [
        entry.pos,
      ])
    : null;
  await db.query(
    `insert into definition (word_id, language_code, part_of_speech_id, text, label, position, is_primary, source_id)
     values ($1, 'eng', $2, $3, $4, 0, true, $5)
     on conflict (word_id, language_code, text) do nothing`,
    [candidate.id, pos ? Number(pos.id) : null, entry.text, entry.label, sourceId]
  );
  editorialApplied += 1;
  log(`  KEEP  ${candidate.headword} (id ${candidate.id}, source ${sourceId}) — ${entry.text}`);
  log(`        evidence: ${entry.evidence}`);
}
if (unmatched.length > 0) {
  log(
    `  NOT FOUND: ${unmatched.map((e) => e.headword).join(', ')} — no entry without a meaning has that ` +
      'headword any more, so nothing was done for them.'
  );
}

const keptIds = new Set(keepers.map((k) => k.candidate.id));
const doomed = candidates.filter((c) => !keptIds.has(c.id));

interface Relation {
  fromWordId: number;
  toWordId: number;
  relationType: string;
  sourceId: number | null;
}

interface Removed {
  id: number;
  headword: string;
  language: string;
  examples: number[];
  examplesShared: number;
  /** What moves to the twin, and what has nowhere to go. */
  relations: Relation[];
  relationsInherited: number;
  relationsLost: number;
  twin: Twin | null;
}

/**
 * Rows that are not words but happen to CARRY words.
 *
 * `Proverb` is a section heading the source corpus emitted, and two real proverbs
 * hang off it — "Ugwu kà a gà-àlị" / "The hill, we shall climb" and "Mbà kà
 * a gà-adà" / "Faintness, we shall feel" — as ordinary examples with no style.
 * Deleting the heading is right; deleting the proverbs along with it is not, so
 * they are classified as proverbs first. They belong to the proverbs-and-idioms
 * section this site is going to grow, and that section finds them by style.
 */
const HEADING_ROWS = new Set(['Proverb']);

const removed: Removed[] = [];
for (const candidate of doomed) {
  const twin = await findTwin(db, candidate);
  const relations = (
    await db.rows<{
      from_word_id: string;
      to_word_id: string;
      relation_type: string;
      source_id: string | null;
    }>(
      `select from_word_id, to_word_id, relation_type, source_id
         from word_relation where from_word_id = $1 or to_word_id = $1`,
      [candidate.id]
    )
  ).map((relation) => ({
    fromWordId: Number(relation.from_word_id),
    toWordId: Number(relation.to_word_id),
    relationType: relation.relation_type,
    sourceId: relation.source_id === null ? null : Number(relation.source_id),
  }));

  // A relation that would point from a word at itself after the swap cannot move.
  const inheritable = twin
    ? relations.filter((relation) => {
        const from = relation.fromWordId === candidate.id ? twin.id : relation.fromWordId;
        const to = relation.toWordId === candidate.id ? twin.id : relation.toWordId;
        return from !== to;
      }).length
    : 0;

  removed.push({
    id: candidate.id,
    headword: candidate.headword,
    language: candidate.language,
    examples: candidate.examples,
    examplesShared: candidate.sharedExamples,
    relations,
    relationsInherited: inheritable,
    relationsLost: relations.length - inheritable,
    twin,
  });
}

const withTwin = removed.filter((r) => r.twin !== null);
const relinked = withTwin.reduce((n, r) => n + r.examples.length, 0);
const inherited = removed.reduce((n, r) => n + r.relationsInherited, 0);
const relationsLost = removed.reduce((n, r) => n + r.relationsLost, 0);

log();
log(
  `${candidates.length} ${
    candidates.length === 1 ? 'entry has' : 'entries have'
  } no definition, in ${new Set(candidates.map((c) => c.language)).size} language(s).`
);
log(`  ${keepers.length} are kept: given the meaning the corpus already states (above).`);
log(`  ${removed.length} are removed:`);
log(`    ${withTwin.length} are spellings of a word that already has a meaning — their examples move to it`);
log(`    ${removed.length - withTwin.length} have no surviving twin and go entirely`);
log(`  ${relinked} example link(s) are re-pointed.`);
log(
  `  ${inherited} relation row(s) move to the spelling that survives, ${relationsLost} go entirely.`
);
log();
log('  headword                          id      examples  shared   rel→twin  rel-lost  twin');
for (const row of removed.slice(0, 200)) {
  log(
    `  ${row.headword.slice(0, 32).padEnd(32)} ${String(row.id).padStart(6)}  ` +
      `${String(row.examples.length).padStart(8)}  ${String(row.examplesShared).padStart(6)}  ` +
      `${String(row.relationsInherited).padStart(9)}  ${String(row.relationsLost).padStart(8)}  ` +
      `${row.twin ? `${row.twin.headword} (${row.twin.id})` : '—'}`
  );
}
if (removed.length > 200) log(`  … and ${removed.length - 200} more, all in the audit file.`);

if (!apply || !confirm) {
  log();
  log('  DRY RUN — nothing was written. Re-run with --apply --confirm to remove these.');
  await closeDb();
  process.exit(0);
}

// The audit file is written BEFORE anything is deleted, so a failure part-way
// through still leaves a record of what was intended.
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      reason:
        'Word entries with no definition, removed on the owner’s instruction. Examples were re-linked to the surviving spelling of the same word where one existed.',
      editorialDefinitions: keepers.map(({ candidate, entry }) => ({
        id: candidate.id,
        headword: candidate.headword,
        text: entry.text,
        pos: entry.pos,
        evidence: entry.evidence,
      })),
      removed,
    },
    null,
    2
  )}\n`
);
log(`  audit written to ${out}`);

let relinkedRows = 0;
let inheritedRelations = 0;
let rescuedProverbs = 0;

for (const row of removed) {
  /*
   * Proverb sentences hanging off a heading are classified before the heading
   * goes, so the proverbs-and-idioms section can still find them.
   */
  if (HEADING_ROWS.has(row.headword)) {
    const rescued = await db.query(
      `update example set style = 'proverb'
        where id = any($1::bigint[]) and (style is null or style = '')`,
      [row.examples]
    );
    rescuedProverbs += rescued.rowCount ?? 0;
  }

  if (row.twin) {
    for (const exampleId of row.examples) {
      const result = await db.query(
        `insert into example_word (example_id, word_id) values ($1, $2)
         on conflict do nothing`,
        [exampleId, row.twin.id]
      );
      relinkedRows += result.rowCount ?? 0;
    }

    /*
     * Relations move to the surviving spelling too, for the same reason the
     * examples do. `-jù` has twenty words recorded as built on it, and its own
     * tone-marked twin `-jụ` is the entry that stays; letting the twenty go with
     * the spelling would throw away a fact the corpus bothered to record. A
     * relation that would become self-referential after the swap is skipped —
     * the table forbids a word relating to itself.
     */
    for (const relation of row.relations) {
      const from = relation.fromWordId === row.id ? row.twin.id : relation.fromWordId;
      const to = relation.toWordId === row.id ? row.twin.id : relation.toWordId;
      if (from === to) continue;
      const result = await db.query(
        `insert into word_relation (from_word_id, to_word_id, relation_type, source_id)
         values ($1, $2, $3::relation_kind, $4)
         on conflict do nothing`,
        [from, to, relation.relationType, relation.sourceId]
      );
      inheritedRelations += result.rowCount ?? 0;
    }
  }
}

let deleted = 0;
for (const row of removed) {
  const result = await db.query(`delete from word where id = $1`, [row.id]);
  deleted += result.rowCount ?? 0;
}

const remaining = await db.one<{ n: number }>(
  `select count(*)::int as n from word w
    where not exists (select 1 from definition d where d.word_id = w.id)`
);

log();
log(`  editorial definitions added: ${editorialApplied}`);
log(`  examples re-linked:          ${relinkedRows}`);
log(`  relations moved to the twin: ${inheritedRelations}`);
log(`  proverbs reclassified:       ${rescuedProverbs}`);
log(`  entries deleted:             ${deleted}`);
log(`  entries still without a meaning: ${Number(remaining?.n ?? 0)}`);
log();
log('  Run `npm run verify` — the gate checks the corpus invariants.');
await closeDb();
