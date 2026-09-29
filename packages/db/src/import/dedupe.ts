/**
 * One word, one entry — the sweep that removes duplicate dictionary entries.
 *
 *   node packages/db/src/import/dedupe.ts [languageCode ...]
 *
 * WHY THIS EXISTS ALONGSIDE THE IMPORTER'S OWN COLLAPSE
 *
 * The Igbo importer already collapses duplicates as it writes, because that is
 * where they are created: the corpus arrives as a main dictionary plus a
 * frequency-ranked common-word list, and the common list spells the same words
 * without tone marks — `nna` "father" beside `nnà` "father", the second of them
 * classified and the first not. Prevention belongs there, and it also keeps the
 * slugs stable, since a collapsed set is what gets URLs.
 *
 * This is the repair for everything already written. Rows that were imported
 * before that collapse existed are still in the database, other languages were
 * imported by importers that never had it, and a corpus can always arrive
 * damaged in a new way. So the rule is applied to what is stored as well as to
 * what is being stored.
 *
 * WHAT COUNTS AS A DUPLICATE
 *
 * Two entries are the same word with the same meaning when their `exact_form`
 * matches — which folds tone but keeps the marks that change which letter it is,
 * so `nna` and `nnà` collide and `nso` and `ǹso` do not — AND their English
 * definitions are the same, ignoring order and case.
 *
 * Both halves are load-bearing. Tone alone is not enough: `nso` ("close"),
 * `nsò` ("queue") and `ǹso` ("nearness") are three different words that share a
 * spelling once tone is folded, and merging them would destroy real homographs
 * the dictionary is supposed to distinguish. Definitions alone are not enough
 * either: `akwa` genuinely means bed, cry, egg and cloth across its tones.
 *
 * WHAT IT DOES NOT TOUCH
 *
 * Rows whose definitions differ are left alone, however similar their spellings,
 * and the run reports them so the decision is visible rather than assumed. A
 * group is only collapsed when a reader would see two pages saying the same
 * thing.
 */
import { preferDuplicateSurvivor } from './corpus.ts';
import { duplicateSignature } from './corpus.ts';
import { closeDb, getDb, type Db } from '../client.ts';
import { formatMs } from './corpus.ts';
import { MECHANICAL_NOTE } from './script.ts';

export interface DedupeReport {
  language: string;
  words: number;
  groupsCollapsed: number;
  entriesRemoved: number;
  childrenMoved: number;
  slugsRestored: number;
  /** Spellings that share a form but carry different meanings — homographs. */
  homographGroups: number;
  removed: { kept: string; dropped: string; meaning: string }[];
  durationMs: number;
}

interface Row {
  id: number;
  headword: string;
  slug: string;
  exact_form: string;
  definitions: string[];
  classified: boolean;
}

/**
 * Move everything hanging off `droppedId` onto `survivorId`, then delete it.
 *
 * Deleting alone would be a cascade, and a cascade would silently take
 * recordings, dialect spellings and script values with it. Most of what hangs
 * off a word IS rewritten by an import from the corpus — definitions, examples
 * and spelling variants come back — but nothing here can know that a particular
 * row was rewritten, so the non-derivable things are moved across instead.
 *
 * The three tables with a unique key are moved with an `update ... where not
 * exists` rather than a plain update, because a plain one would abort the whole
 * sweep on the first collision. What collides is already present on the
 * survivor with the same value, so the leftover is dropped.
 */
async function moveChildren(db: Db, survivorId: number, droppedId: number): Promise<number> {
  let moved = 0;

  // Recordings attached to the word itself.
  moved += (await db.query(`update audio set word_id = $1 where word_id = $2`, [survivorId, droppedId]))
    .rowCount ?? 0;

  /*
   * Dialect spellings first, THEN the recordings attached to those. Moving the
   * spellings without their recordings would lose the recordings when the
   * dropped word goes, through the cascade on audio.word_dialect_id.
   */
  await db.query(
    `update word_dialect wd set word_id = $1
      where wd.word_id = $2
        and not exists (
          select 1 from word_dialect x
           where x.word_id = $1 and x.dialect_id = wd.dialect_id and x.spelling = wd.spelling
        )`,
    [survivorId, droppedId]
  );
  await db.query(
    `update audio a
        set word_dialect_id = (
          select x.id from word_dialect x
            join word_dialect wd on wd.id = a.word_dialect_id
           where x.word_id = $1
             and x.dialect_id = wd.dialect_id
             and x.spelling = wd.spelling
        )
      where a.word_dialect_id in (select id from word_dialect where word_id = $2)`,
    [survivorId, droppedId]
  );
  moved += (await db.query(`delete from word_dialect where word_id = $1`, [droppedId])).rowCount ?? 0;

  /*
   * Script values are DERIVED from the headword, so a mechanical one must be
   * recomputed rather than carried across. Ndebe encodes tone as a different
   * character, so a value computed from `-bo ilo` is simply wrong on `-bo ilo`
   * with tone marks — moving it would put a confidently rendered mistake on the
   * page, and the integrity gate caught exactly that on 56 rows. They are
   * dropped here and rewritten by the script import.
   *
   * A recorded CORRECTION is not derived and is carried, because it is a human
   * statement about the word rather than something recomputable.
   */
  await db.query(`delete from word_script where word_id = $1 and notes = $2`, [
    droppedId,
    MECHANICAL_NOTE,
  ]);
  await db.query(
    `update word_script ws set word_id = $1
      where ws.word_id = $2
        and not exists (
          select 1 from word_script x
           where x.word_id = $1 and x.script_code = ws.script_code and x.value = ws.value
        )`,
    [survivorId, droppedId]
  );
  moved += (await db.query(`delete from word_script where word_id = $1`, [droppedId])).rowCount ?? 0;

  await db.query(
    `update word_form wf set word_id = $1
      where wf.word_id = $2
        and not exists (
          select 1 from word_form x
           where x.word_id = $1 and x.form_type_id = wf.form_type_id and x.value = wf.value
        )`,
    [survivorId, droppedId]
  );
  moved += (await db.query(`delete from word_form where word_id = $1`, [droppedId])).rowCount ?? 0;

  /*
   * Definitions, example links and stem relations are left to the cascade
   * deliberately. They are derived from the corpus and rewritten by the next
   * import of the source, and the survivor already carries the same definitions
   * — that is what made the group a duplicate in the first place.
   */
  await db.query(`delete from word where id = $1`, [droppedId]);

  return moved;
}

/**
 * Collapse duplicate entries for one language.
 *
 * Also restores the survivor's slug when the un-suffixed URL was held by the row
 * being removed. Without that, collapsing `nna` and `nnà` would leave the
 * canonical `/word/igbo/nna` pointing at nothing while the survivor kept
 * `nna-2` — the duplicate would be gone and the good URL with it.
 */
export async function dedupeWords(
  db: Db,
  languageCode: string,
  log: (m: string) => void = () => {}
): Promise<DedupeReport> {
  const started = Date.now();

  const rows = await db.rows<{
    id: string;
    headword: string;
    slug: string;
    exact_form: string;
    definitions: string[];
    classified: boolean;
  }>(
    `select w.id, w.headword, w.slug, w.exact_form,
            coalesce(
              (select array_agg(d.text order by d.position)
                 from definition d
                where d.word_id = w.id and d.language_code = 'eng'),
              '{}'
            ) as definitions,
            exists (
              select 1 from definition d
                join part_of_speech p on p.id = d.part_of_speech_id
               where d.word_id = w.id and coalesce(p.code, 'UNK') <> 'UNK'
            ) as classified
       from word w
      where w.language_code = $1 and w.status = 'published'
      order by w.headword`,
    [languageCode]
  );

  const groups = new Map<string, Row[]>();
  for (const raw of rows) {
    const row: Row = {
      id: Number(raw.id),
      headword: raw.headword,
      slug: raw.slug,
      exact_form: raw.exact_form,
      definitions: raw.definitions ?? [],
      classified: Boolean(raw.classified),
    };
    const key = duplicateSignature(row.exact_form, row.definitions);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const report: DedupeReport = {
    language: languageCode,
    words: rows.length,
    groupsCollapsed: 0,
    entriesRemoved: 0,
    childrenMoved: 0,
    slugsRestored: 0,
    homographGroups: 0,
    removed: [],
    durationMs: 0,
  };

  /*
   * Groups that share a folded spelling but not a meaning. Counted, not
   * touched — these are homographs the dictionary should keep apart, and the
   * count is reported so that "no duplicates found" cannot be confused with
   * "nothing looked at".
   */
  const byForm = new Map<string, Set<string>>();
  for (const row of rows) {
    const meanings = duplicateSignature(row.exact_form, row.definitions);
    if (!byForm.has(row.exact_form)) byForm.set(row.exact_form, new Set());
    byForm.get(row.exact_form)!.add(meanings);
  }
  report.homographGroups = [...byForm.values()].filter((s) => s.size > 1).length;

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const ranked = [...group].sort(preferDuplicateSurvivor);
    const [survivor, ...dropped] = ranked as [Row, ...Row[]];
    const droppedIds = dropped.map((r) => r.id);

    for (const row of dropped) {
      report.childrenMoved += await moveChildren(db, survivor.id, row.id);
      report.entriesRemoved += 1;
      report.removed.push({
        kept: survivor.headword,
        dropped: row.headword,
        meaning: (row.definitions[0] ?? '').slice(0, 60),
      });
    }
    report.groupsCollapsed += 1;

    /*
     * The slug is restored AFTER the deletes, because the row that held it had
     * to be gone before the survivor could take it: the unique index would
     * otherwise reject the update.
     */
    const heldByDropped = dropped.find((r) => r.slug === survivor.exact_form);
    if (heldByDropped) {
      await db.query(`update word set slug = $1 where id = $2`, [
        survivor.exact_form,
        survivor.id,
      ]);
      report.slugsRestored += 1;
    } else {
      // Nothing held the plain slug, so leave the survivor's own alone unless it
      // is a numbered one for a collision that no longer exists.
      const numbered = survivor.slug.match(/^(.*)-(\d+)$/);
      if (numbered) {
        const base = numbered[1]!;
        const taken = await db.one<{ id: string }>(
          `select id from word where language_code = $1 and slug = $2 and id <> $3`,
          [languageCode, base, survivor.id]
        );
        if (!taken) {
          await db.query(`update word set slug = $1 where id = $2`, [base, survivor.id]);
          report.slugsRestored += 1;
        }
      }
    }

    log(
      `  ${survivor.headword}  kept over  ${dropped.map((r) => r.headword).join(', ')}` +
        `  —  ${(survivor.definitions[0] ?? '').slice(0, 50)}`
    );
  }

  report.durationMs = Date.now() - started;
  return report;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const db = await getDb();
  try {
    const languages =
      requested.length > 0
        ? requested
        : (
            await db.rows<{ code: string }>(
              `select distinct w.language_code as code
                 from word w
                where w.status = 'published'
                order by 1`
            )
          ).map((r) => r.code);

    console.log('\nRemoving duplicate entries\n');
    let totalRemoved = 0;
    for (const language of languages) {
      const report = await dedupeWords(db, language, (m) => console.log(m));
      console.log(
        `  ${language}: ${report.words} entries, ${report.groupsCollapsed} duplicate groups, ` +
          `${report.entriesRemoved} removed, ${report.slugsRestored} slugs restored, ` +
          `${report.homographGroups} homograph groups left alone`
      );
      totalRemoved += report.entriesRemoved;
    }
    console.log(`\n  ${totalRemoved} duplicate entries removed\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && process.argv[1].endsWith('dedupe.ts')) {
  main().catch((error) => {
    console.error('\nDedupe failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
