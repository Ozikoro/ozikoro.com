/**
 * Igbo corpus importer.
 *
 * Source: the Igbo API repository (github.com/nkowaokwu/igbo_api, Apache-2.0),
 * which ships its dictionary as JSON under src/dictionaries/ig-en:
 *
 *   ig-en.json              8,223 headword keys -> 8,222 distinct headwords,
 *                           9,937 English glosses, 1,802 example sentences,
 *                           454 spelling variants, 6,402 stems
 *   ig-en_1000_common.json    702 keys, used here to set `is_common` and a
 *                           frequency rank
 *
 * Source shape (one entry per headword key):
 *
 *   "Àba": [{
 *     word: "Àba", wordClass: "NNC",
 *     definitions: ["Aba"],                                  // synonym glosses
 *     examples: [{ igbo: "Òbìàgèlì bì n'Àba", english: "..." }],
 *     variations: [], stems: null
 *   }]
 *
 * HOW THIS MAPS ONTO OZITUMA'S MULTI-LANGUAGE SCHEMA
 *
 *   wordClass "NNC"        -> part_of_speech row (language_code = 'ibo')
 *   definitions[]          -> one definition row per gloss, in English
 *   examples[]             -> example row + example_word join
 *   variations[]           -> word_form rows of type 'variant'
 *   stems[]                -> word_relation rows of type 'stem'
 *
 * Nothing above is Igbo-specific in the schema: a Yoruba or Ibibio importer
 * writes the same tables with a different language_code and its own grammar
 * category rows. That is the point of the Ozikoro scope's "language field on
 * every entry".
 *
 * TWO CORPUS QUIRKS THIS HANDLES
 *
 *  1. Headwords are case-sensitive. The corpus carries both "Àba" (the town)
 *     and "àba" (a common noun) — 30 such pairs. Lowercasing headwords would
 *     silently merge 30 distinct entries, so the stored headword preserves
 *     case while the derived search forms fold it.
 *
 *  2. One `word` value appears under two different keys, so headword keys are
 *     merged before insert. Postgres rejects a multi-row upsert that touches
 *     the same conflict target twice ("cannot affect row a second time"), and
 *     merging is the correct answer rather than dropping data.
 *
 * Deliberately NOT imported: `en-ig_normalized_expanded.json`, a 212,155-entry
 * English -> Igbo index whose quality is far below the rest of the corpus (it
 * maps "aarrgh" to "arr.. .arrarrarr"). The English -> Igbo direction is served
 * instead by ranked full-text search over the 9,937 real definitions. Revisit
 * if a cleaned version appears.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage, tidy, type LanguageDefinition } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { MECHANICAL_NOTE } from './script.ts';
import {
  SlugAllocator,
  formatMs,
  insertMany,
  loadFormTypeIndex,
  loadPosIndex,
  loadSourceId,
  progress,
  wordFields,
  duplicateSignature,
  preferDuplicateSurvivor,
} from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Where raw corpora live. Gitignored; see docs/DATA-SOURCES.md. */
export const DEFAULT_SOURCE_DIR = resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'data',
  'sources',
  'igbo-api'
);

interface CorpusExample {
  igbo: string;
  english?: string;
}

interface CorpusEntry {
  word?: string;
  wordClass?: string;
  definitions?: string[];
  examples?: CorpusExample[];
  variations?: string[];
  stems?: string[] | null;
  phrases?: string[];
}

type Corpus = Record<string, CorpusEntry[]>;

/** A headword after merging every source key that refers to it. */
interface MergedHeadword {
  headword: string;
  externalId: string;
  wordClass: string;
  definitions: string[];
  variations: string[];
  examples: CorpusExample[];
  stems: string[];
}

export interface IgboImportOptions {
  sourceDir?: string;
  languageCode?: string;
  sourceSlug?: string;
  /** Stop after N headwords — for a fast smoke test. */
  limit?: number;
  log?: (message: string) => void;
}

export interface ImportReport {
  sourceKeys: number;
  commonKeys: number;
  headwordsAddedFromCommon: number;
  distinctHeadwords: number;
  mergedKeys: number;
  wordsUpserted: number;
  definitionsInserted: number;
  examplesInserted: number;
  variantsInserted: number;
  stemRelationsInserted: number;
  stemsUnresolved: number;
  headwordsWithoutDefinitions: number;
  unmappedPosClasses: Record<string, number>;
  commonWordsMatched: number;
  durationMs: number;
}

const FORM_TYPE_VARIANT = 'variant';

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Merge one corpus file into the headword map.
 *
 * The merge key is the TIDIED headword, not the raw one — "a-  m" and "a- m"
 * are the same entry once whitespace is collapsed, and the database's unique
 * key is on the tidied form. Keying on anything else reintroduces the
 * duplicate-target upsert that Postgres rejects.
 */
function mergeInto(
  target: Map<string, MergedHeadword>,
  corpus: Corpus,
  isCommonSource: boolean,
  commonRank: Map<string, number>
): void {
  let rank = 0;
  for (const key of Object.keys(corpus)) {
    const entries = corpus[key];
    if (!Array.isArray(entries)) continue;

    // The supplementary common-word list is ordered by frequency, so its
    // position is the rank. Record it before merging so the rank lands even
    // when the headword also appears in the main dictionary.
    const keyHeadword = tidy(key);
    if (isCommonSource && keyHeadword.length > 0) {
      if (!commonRank.has(keyHeadword)) commonRank.set(keyHeadword, rank);
      rank += 1;
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const headword = tidy(entry.word ?? key);
      if (headword.length === 0) continue;

      const existing = target.get(headword);
      const record: MergedHeadword =
        existing ??
        {
          headword,
          externalId: key,
          wordClass: '',
          definitions: [],
          variations: [],
          examples: [],
          stems: [],
        };

      // Prefer the first non-empty grammar class we see.
      if (record.wordClass.length === 0 && (entry.wordClass ?? '').trim().length > 0) {
        record.wordClass = (entry.wordClass ?? '').trim();
      }
      record.definitions.push(
        ...(entry.definitions ?? []).filter(
          (d): d is string => typeof d === 'string' && d.trim().length > 0
        )
      );
      record.variations.push(
        ...(entry.variations ?? []).filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0
        )
      );
      record.stems.push(
        ...(entry.stems ?? []).filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0
        )
      );
      for (const example of entry.examples ?? []) {
        if (example && typeof example.igbo === 'string' && example.igbo.trim().length > 0) {
          record.examples.push(example);
        }
      }

      target.set(headword, record);
    }
  }
}

/** De-duplicate and normalise a merged record's arrays. */
function finalise(record: MergedHeadword): MergedHeadword {
  return {
    ...record,
    definitions: uniq(record.definitions.map((d) => d.trim())),
    variations: uniq(record.variations.map((v) => v.trim())),
    stems: uniq(record.stems.map((s) => s.trim())),
    examples: [
      ...new Map(
        record.examples.map((e) => [`${e.igbo.trim()}\u0000${(e.english ?? '').trim()}`, e])
      ).values(),
    ],
  };
}

/**
 * Collapse the entries that are the same word with the same meaning.
 *
 * The corpus arrives as two files — the main dictionary and a frequency-ranked
 * common-word list — and they describe the same words under different spellings.
 * The common list writes the tone-neutral form: it has `nna` "father" with no
 * word class at all, while the main dictionary has `nnà` "father" classified
 * NNC. The merge key is the tidy headword, so `nna` and `nnà` are two keys, and
 * the dictionary ended up with two entries: /word/igbo/nna and
 * /word/igbo/nna-2, identical to a reader. 238 of the common list's 702 keys
 * match a main entry once tone is dropped, so this is not one accident.
 *
 * The key is the exact form PLUS the definitions. Exact form alone would be
 * wrong: it folds tone, and tone distinguishes real homographs — `nso` "close",
 * `nsò` "queue" and `ǹso` "nearness" share it and are three different words.
 * Only a group that is also identical in meaning is a duplicate.
 *
 * The survivor is chosen in this order, and each step is earned rather than
 * preferred:
 *
 *   1. A classified word class beats none. The common list classifies NOTHING —
 *      0 of its 702 entries carry a wordClass — so this is what makes the main
 *      dictionary's entry win, which is what should happen: the common list is
 *      a frequency ranking, not a second opinion on the word.
 *   2. More tone marks. The headword is what the entry is, and the tone-neutral
 *      spelling is already shown on the page beside it, so keeping the marked
 *      one loses nothing and discarding it loses the pronunciation.
 *   3. Lexicographic, so a re-import cannot reorder the corpus.
 *
 * The dropped spelling is NOT recorded as a variant, because by construction the
 * two differ only in tone and the page already prints the tone-neutral form
 * underneath the headword. What IS carried over is everything the survivor did
 * not have: the other's word class when the survivor has none, its variants, its
 * examples and its stems.
 */
function collapseDuplicates(
  records: MergedHeadword[],
  language: LanguageDefinition,
  commonRank: Map<string, number>
): { kept: MergedHeadword[]; collapsed: number; dropped: { survivor: string; headword: string }[] } {
  const groups = new Map<string, MergedHeadword[]>();
  const uniques: MergedHeadword[] = [];

  for (const record of records) {
    const { exactForm } = wordFields(record.headword, language);
    // A headword with no derivable form cannot be compared to anything; keep it
    // as it is rather than risk merging it with a different word.
    if (exactForm.length === 0) {
      uniques.push(record);
      continue;
    }
    const key = duplicateSignature(exactForm, record.definitions);
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  let collapsed = 0;
  const droppedPairs: { survivor: string; headword: string }[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      uniques.push(group[0]!);
      continue;
    }

    const ranked = [...group].sort((a, b) =>
      preferDuplicateSurvivor(
        { headword: a.headword, classified: a.wordClass.trim().length > 0 },
        { headword: b.headword, classified: b.wordClass.trim().length > 0 }
      )
    );

    const [survivor, ...dropped] = ranked as [MergedHeadword, ...MergedHeadword[]];
    for (const record of dropped) {
      collapsed += 1;
      droppedPairs.push({ survivor: survivor.headword, headword: record.headword });
      if (survivor.wordClass.length === 0) survivor.wordClass = record.wordClass;
      survivor.variations.push(...record.variations);
      survivor.examples.push(...record.examples);
      survivor.stems.push(...record.stems);

      /*
       * The frequency rank travels with the word, not with the spelling.
       *
       * It is looked up later by headword, and the common list's key is the
       * tone-neutral spelling, so a survivor whose spelling differs would lose
       * the rank that made it a common word — the one thing the common list is
       * actually for.
       */
      const survivorRank = commonRank.get(survivor.headword);
      const droppedRank = commonRank.get(record.headword);
      if (droppedRank !== undefined && (survivorRank === undefined || droppedRank < survivorRank)) {
        commonRank.set(survivor.headword, droppedRank);
      }
    }
    uniques.push(finalise(survivor));
  }

  return { kept: uniques, collapsed, dropped: droppedPairs };
}

export async function importIgboCorpus(
  db: Db,
  options: IgboImportOptions = {}
): Promise<ImportReport> {
  const started = Date.now();
  const log = options.log ?? ((m: string) => console.log(m));
  const sourceDir = options.sourceDir ?? process.env.OZITUMA_IGBO_SOURCE ?? DEFAULT_SOURCE_DIR;
  const languageCode = options.languageCode ?? 'ibo';
  const sourceSlug = options.sourceSlug ?? 'igbo-api';

  const language = requireLanguage(languageCode);
  const sourceId = await loadSourceId(db, sourceSlug);
  const posIndex = await loadPosIndex(db, languageCode);
  const formIndex = await loadFormTypeIndex(db, languageCode);

  const variantFormTypeId = formIndex.byCode.get(FORM_TYPE_VARIANT) ?? null;
  if (!variantFormTypeId) {
    log(`  ! form_type "${FORM_TYPE_VARIANT}" is missing; spelling variants will be skipped.`);
  }

  // --- Load the corpus ----------------------------------------------------
  //
  // Two files, and both matter. `ig-en.json` is the main dictionary. The
  // "common" file is NOT a subset of it — only 84 of its 702 words appear in
  // the main dictionary, so the other 618 are high-frequency vocabulary that
  // exists nowhere else in the corpus. Importing only the main file would
  // silently discard the most-used words in the language.
  const dictionaryPath = join(sourceDir, 'ig-en.json');
  log(`  reading ${dictionaryPath}`);
  const corpus = JSON.parse(await readFile(dictionaryPath, 'utf8')) as Corpus;

  const headwordMap = new Map<string, MergedHeadword>();
  const commonRank = new Map<string, number>();
  const sourceKeys = Object.keys(corpus).length;
  mergeInto(headwordMap, corpus, false, commonRank);
  const mainCount = headwordMap.size;

  let commonKeys = 0;
  let headwordsAddedFromCommon = 0;
  try {
    const commonPath = join(sourceDir, 'ig-en_1000_common.json');
    const common = JSON.parse(await readFile(commonPath, 'utf8')) as Corpus;
    commonKeys = Object.keys(common).length;
    mergeInto(headwordMap, common, true, commonRank);
    headwordsAddedFromCommon = headwordMap.size - mainCount;
    log(
      `  common-word list: ${commonKeys} keys, ${commonRank.size} ranked, ` +
        `${headwordsAddedFromCommon} headwords not present in the main dictionary`
    );
  } catch {
    log('  common-word list not found; frequency ranking omitted');
  }

  let merged = [...headwordMap.values()].map(finalise);

  /*
   * One word, one entry. Runs BEFORE slugs are allocated, so the collapsed set
   * is what gets URLs and no entry is ever given a "-2" beside its own twin.
   */
  const collapsedResult = collapseDuplicates(merged, language, commonRank);
  merged = collapsedResult.kept;
  const collapsedAway = collapsedResult.dropped;
  if (collapsedResult.collapsed > 0) {
    log(
      `  collapsed as the same word with the same meaning  ${collapsedResult.collapsed}`
    );
  }

  // Sorted so slug allocation is deterministic between runs, which keeps
  // public URLs stable.
  merged.sort((a, b) => (a.headword < b.headword ? -1 : a.headword > b.headword ? 1 : 0));
  if (options.limit && options.limit > 0) merged = merged.slice(0, options.limit);

  log(`  corpus: ${sourceKeys + commonKeys} keys -> ${merged.length} distinct headwords`);
  log('');

  // --- Reserve slugs already held by rows this import does not own --------
  const allocator = new SlugAllocator();
  const foreignSlugs = await db.rows<{ slug: string }>(
    `select slug from word
      where language_code = $1 and (source_id is distinct from $2)`,
    [languageCode, sourceId]
  );
  for (const row of foreignSlugs) allocator.reserve(languageCode, row.slug);

  // --- Park this source's slugs so the upsert cannot collide --------------
  // Slugs derive from the fully-folded search form, so "àkwà" and "ákwá" both
  // want "akwa". Parking the old values first lets a re-import reallocate
  // freely without tripping the unique index mid-statement.
  await db.query(
    `update word set slug = 'parked-' || id
      where language_code = $1 and source_id = $2`,
    [languageCode, sourceId]
  );

  // --- Phase A: upsert every headword -------------------------------------
  const unmappedPosClasses: Record<string, number> = {};
  const wordColumns = [
    'language_code',
    'headword',
    'exact_form',
    'search_form',
    'slug',
    'is_common',
    'frequency_rank',
    'source_id',
    'external_id',
  ];

  const wordRows: unknown[][] = [];
  const posByHeadword = new Map<string, number>();
  let headwordsWithoutDefinitions = 0;

  for (const record of merged) {
    const fields = wordFields(record.headword, language);
    const slug = allocator.allocate(languageCode, record.headword, language);

    const posCode = record.wordClass.length > 0 ? record.wordClass : 'UNK';
    let posId = posIndex.byCode.get(posCode);
    if (posId === undefined) {
      // Shouldn't happen with the current corpus, but a future corpus may add
      // a class we have not seeded. Record it and carry on.
      unmappedPosClasses[posCode] = (unmappedPosClasses[posCode] ?? 0) + 1;
      posId = posIndex.unclassified;
    }
    posByHeadword.set(fields.headword, posId);

    if (record.definitions.length === 0) headwordsWithoutDefinitions += 1;

    const rank = commonRank.get(fields.headword);
    wordRows.push([
      languageCode,
      fields.headword,
      fields.exactForm,
      fields.searchForm,
      slug,
      rank !== undefined,
      rank ?? null,
      sourceId,
      record.externalId,
    ]);
  }

  log(`  upserting ${wordRows.length} headwords ...`);
  let wordsUpserted = 0;
  const WORD_CHUNK = 400;

  for (let start = 0; start < wordRows.length; start += WORD_CHUNK) {
    const chunk = wordRows.slice(start, start + WORD_CHUNK);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of chunk) {
      const placeholders = row.map((_, i) => `$${values.length + i + 1}`);
      tuples.push(`(${placeholders.join(', ')})`);
      values.push(...row);
    }
    const result = await db.query(
      `insert into word (${wordColumns.join(', ')})
       values ${tuples.join(', ')}
       on conflict (language_code, headword) do update set
         exact_form     = excluded.exact_form,
         search_form    = excluded.search_form,
         slug           = excluded.slug,
         is_common      = excluded.is_common,
         frequency_rank = excluded.frequency_rank,
         source_id      = coalesce(word.source_id, excluded.source_id),
         external_id    = excluded.external_id,
         updated_at     = now()`,
      values
    );
    wordsUpserted += result.rowCount;
    progress('words', Math.min(start + WORD_CHUNK, wordRows.length), wordRows.length);
  }

  // --- Read back the id map ----------------------------------------------
  const idRows = await db.rows<{ id: string; headword: string }>(
    `select id, headword from word where language_code = $1`,
    [languageCode]
  );
  const wordIdByHeadword = new Map<string, number>();
  for (const row of idRows) wordIdByHeadword.set(row.headword, Number(row.id));

  /*
   * --- Remove the headwords this import no longer produces ---------------
   *
   * Collapsing a duplicate decides in memory that `nna` and `nnà` are one word;
   * the database still holds both rows, because the upsert only ever writes
   * headwords it was given and never removes ones it was not. Left alone, the
   * dropped row would keep its parked slug and stay reachable — the duplicate
   * would survive the fix that was meant to remove it.
   *
   * Deleting it is not simply a cascade. Most of what hangs off a word IS
   * rewritten by this import from the merged record — definitions, example links
   * and spelling variants all come back on the survivor, because the collapse
   * merged them into it in memory. What does NOT come back is anything this
   * importer never writes: recordings, dialect spellings, script values, and any
   * form an editor or another importer added. Those are moved across first.
   *
   * Measured on the corpus as it stood: none of the 87 dropped rows carried a
   * recording or a dialect spelling, but this does not rely on that continuing
   * to be true.
   */
  let orphansRemoved = 0;
  let childrenMoved = 0;

  for (const pair of collapsedAway) {
    const survivorId = wordIdByHeadword.get(pair.survivor);
    const droppedId = wordIdByHeadword.get(pair.headword);
    if (survivorId === undefined || droppedId === undefined || survivorId === droppedId) continue;

    // 1. Recordings pointing at the word itself. Nothing to collide with.
    const audio = await db.query(`update audio set word_id = $1 where word_id = $2`, [
      survivorId,
      droppedId,
    ]);
    childrenMoved += audio.rowCount ?? 0;

    // 2. Dialect spellings, and then the recordings hung off THOSE. Moving the
    //    spelling rows without moving their recordings would delete the
    //    recordings when the dropped word goes, through the cascade on
    //    audio.word_dialect_id.
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
    const dialects = await db.query(`delete from word_dialect where word_id = $1`, [droppedId]);
    childrenMoved += dialects.rowCount ?? 0;

    /*
     * 3. Script values are DERIVED from the headword, so a mechanical one is
     *    dropped rather than moved: Ndebe encodes tone as a different glyph, so
     *    a value computed from the tone-neutral spelling is wrong on the
     *    tone-marked one. The script import rewrites them. A recorded correction
     *    is carried, because that is a human statement, not something
     *    recomputable.
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
    childrenMoved +=
      (await db.query(`delete from word_script where word_id = $1`, [droppedId])).rowCount ?? 0;

    // 4. Spelling variants. A variant is a spelling, not something derived from
    //    the headword, so these move as they are.

    await db.query(
      `update word_form wf set word_id = $1
        where wf.word_id = $2
          and not exists (
            select 1 from word_form x
             where x.word_id = $1 and x.form_type_id = wf.form_type_id and x.value = wf.value
          )`,
      [survivorId, droppedId]
    );
    childrenMoved +=
      (await db.query(`delete from word_form where word_id = $1`, [droppedId])).rowCount ?? 0;

    /*
     * Everything else on the row — definitions, example links and stem
     * relations — is deleted here by cascade and re-created by Phase B from the
     * survivor, because the collapse merged the dropped record's definitions,
     * examples and stems into it in memory. That is why those three are
     * deliberately NOT moved: moving them and then rewriting them would be work
     * that cancels itself out.
     */
    await db.query(`delete from word where id = $1`, [droppedId]);
    orphansRemoved += 1;
  }

  if (orphansRemoved > 0) {
    log(
      `  duplicate entries removed  ${orphansRemoved}` +
        ` (${childrenMoved} recordings, spellings and script values moved across)`
    );
  }

  // --- Clear this source's child rows so the import is idempotent ---------
  // Only rows owned by this source are touched, so editor and community
  // contributions against the same headword survive a re-import.
  await db.query(
    `delete from definition
      where word_id in (select id from word where language_code = $1)
        and (source_id = $2 or source_id is null)`,
    [languageCode, sourceId]
  );
  await db.query(
    `delete from word_form
      where word_id in (select id from word where language_code = $1 and source_id = $2)`,
    [languageCode, sourceId]
  );
  await db.query(
    `delete from example_word
      where example_id in (select id from example where language_code = $1 and source_id = $2)`,
    [languageCode, sourceId]
  );
  await db.query(`delete from example where language_code = $1 and source_id = $2`, [
    languageCode,
    sourceId,
  ]);
  await db.query(
    `delete from word_relation
      where relation_type = 'stem'
        and from_word_id in (select id from word where language_code = $1 and source_id = $2)`,
    [languageCode, sourceId]
  );

  // --- Phase B: definitions, forms, examples -----------------------------
  const definitionRows: unknown[][] = [];
  const formRows: unknown[][] = [];
  const exampleRows: unknown[][] = [];
  const exampleWordRows: unknown[][] = [];
  const stemTargets: { fromId: number; stemHeadword: string }[] = [];

  let exampleSeq = 0;

  for (const record of merged) {
    const fields = wordFields(record.headword, language);
    const wordId = wordIdByHeadword.get(fields.headword);
    if (wordId === undefined) continue;
    const posId = posByHeadword.get(fields.headword) ?? posIndex.unclassified;

    // Glosses: `definitions` is a list of synonyms for one sense, so each
    // becomes its own searchable row with an ordered position.
    for (const [index, text] of record.definitions.entries()) {
      definitionRows.push([wordId, 'eng', posId, text, index, index === 0, sourceId]);
    }

    // Spellings: free variations, not dialect-attributed ones, so they belong
    // in word_form rather than word_dialect.
    if (variantFormTypeId) {
      for (const variation of record.variations) {
        formRows.push([
          wordId,
          variantFormTypeId,
          variation,
          deriveForms(variation, language).searchForm,
        ]);
      }
    }

    for (const example of record.examples) {
      exampleSeq += 1;
      const igbo = example.igbo.trim();
      const english = example.english?.trim() ?? null;
      exampleRows.push([
        languageCode,
        igbo,
        deriveForms(igbo, language).searchForm,
        english && english.length > 0 ? english : null,
        english && english.length > 0 ? 'eng' : null,
        sourceId,
        `ig-en-${exampleSeq}`,
      ]);
      exampleWordRows.push([exampleSeq, wordId]);
    }

    for (const stem of record.stems) {
      stemTargets.push({ fromId: wordId, stemHeadword: stem });
    }
  }

  log(`\n  inserting ${definitionRows.length} definitions ...`);
  await insertMany(
    db,
    'definition',
    [
      'word_id',
      'language_code',
      'part_of_speech_id',
      'text',
      'position',
      'is_primary',
      'source_id',
    ],
    definitionRows,
    { onConflict: 'on conflict (word_id, language_code, text) do nothing' }
  );

  if (formRows.length > 0) {
    log(`  inserting ${formRows.length} spelling variants ...`);
    await insertMany(
      db,
      'word_form',
      ['word_id', 'form_type_id', 'value', 'search_form'],
      formRows,
      { onConflict: 'on conflict (word_id, form_type_id, value) do nothing' }
    );
  }

  if (exampleRows.length > 0) {
    log(`  inserting ${exampleRows.length} examples ...`);
    await insertMany(
      db,
      'example',
      [
        'language_code',
        'text',
        'search_form',
        'translation',
        'translation_language_code',
        'source_id',
        'external_id',
      ],
      exampleRows
    );

    const exampleIdRows = await db.rows<{ id: string; external_id: string }>(
      `select id, external_id from example where language_code = $1 and source_id = $2`,
      [languageCode, sourceId]
    );
    const exampleIdByExternal = new Map<string, number>();
    for (const row of exampleIdRows) exampleIdByExternal.set(row.external_id, Number(row.id));

    const joinRows: unknown[][] = [];
    for (const [externalSeq, wordId] of exampleWordRows) {
      const exampleId = exampleIdByExternal.get(`ig-en-${externalSeq}`);
      if (exampleId !== undefined) joinRows.push([exampleId, wordId]);
    }
    await insertMany(db, 'example_word', ['example_id', 'word_id'], joinRows, {
      onConflict: 'on conflict do nothing',
    });
  }

  // --- Stems: resolve to existing headwords ------------------------------
  const stemRows: unknown[][] = [];
  const unresolved = new Set<string>();
  const stemIdCache = new Map<string, number | null>();

  for (const { fromId, stemHeadword } of stemTargets) {
    let targetId = stemIdCache.get(stemHeadword);
    if (targetId === undefined) {
      const fields = deriveForms(stemHeadword, language);
      const found = await db.one<{ id: string }>(
        `select id from word
          where language_code = $1 and (headword = $2 or exact_form = $3 or search_form = $4)
          limit 1`,
        [languageCode, fields.headword, fields.exactForm, fields.searchForm]
      );
      targetId = found ? Number(found.id) : null;
      stemIdCache.set(stemHeadword, targetId);
    }
    if (targetId === null || targetId === fromId) {
      unresolved.add(stemHeadword);
      continue;
    }
    stemRows.push([fromId, targetId, 'stem', sourceId]);
  }

  let stemRelationsInserted = 0;
  if (stemRows.length > 0) {
    log(`  inserting ${stemRows.length} stem relations ...`);
    stemRelationsInserted = await insertMany(
      db,
      'word_relation',
      ['from_word_id', 'to_word_id', 'relation_type', 'source_id'],
      stemRows,
      { onConflict: 'on conflict (from_word_id, to_word_id, relation_type) do nothing' }
    );
  }

  await db.query(
    `update word set updated_at = now() where language_code = $1 and source_id = $2`,
    [languageCode, sourceId]
  );

  return {
    sourceKeys,
    commonKeys,
    headwordsAddedFromCommon,
    distinctHeadwords: merged.length,
    mergedKeys: sourceKeys + commonKeys - merged.length,
    wordsUpserted,
    definitionsInserted: definitionRows.length,
    examplesInserted: exampleRows.length,
    variantsInserted: formRows.length,
    stemRelationsInserted,
    stemsUnresolved: unresolved.size,
    headwordsWithoutDefinitions,
    unmappedPosClasses,
    commonWordsMatched: commonRank.size,
    durationMs: Date.now() - started,
  };
}

/** Convenience for `npm run import:igbo`. */
export async function runIgboImportCli(): Promise<void> {
  const db = await getDb();
  try {
    console.log('\nImporting Igbo corpus\n');
    const report = await importIgboCorpus(db, {
      limit: process.env.OZITUMA_IMPORT_LIMIT
        ? Number(process.env.OZITUMA_IMPORT_LIMIT)
        : undefined,
    });

    console.log('\n  Import complete');
    console.log('  ' + '-'.repeat(48));
    console.log(`  source keys              ${report.sourceKeys}`);
    console.log(`  common-word keys         ${report.commonKeys}`);
    console.log(`  added from common list   ${report.headwordsAddedFromCommon}`);
    console.log(`  distinct headwords       ${report.distinctHeadwords}`);
    console.log(`  keys merged              ${report.mergedKeys}`);
    console.log(`  words upserted           ${report.wordsUpserted}`);
    console.log(`  definitions inserted     ${report.definitionsInserted}`);
    console.log(`  examples inserted        ${report.examplesInserted}`);
    console.log(`  spelling variants        ${report.variantsInserted}`);
    console.log(`  stem relations           ${report.stemRelationsInserted}`);
    console.log(`  stems unresolved         ${report.stemsUnresolved}`);
    console.log(`  no definitions           ${report.headwordsWithoutDefinitions}`);
    console.log(`  duration                 ${formatMs(report.durationMs)}`);
    const unmapped = Object.entries(report.unmappedPosClasses);
    if (unmapped.length > 0) {
      console.log(
        `  unmapped grammar classes ${unmapped.map(([c, n]) => `${c}(${n})`).join(', ')}`
      );
    }
    console.log('');
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runIgboImportCli().catch((error) => {
    console.error('\nImport failed:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack.split('\n').slice(1, 4).join('\n'));
    }
    process.exitCode = 1;
  });
}
