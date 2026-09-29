/**
 * Import the IwajuAI English-Yoruba Dictionary — the first non-Igbo corpus.
 *
 * This is the real test of the central architectural bet: that a language is a
 * corpus plus a few reference rows, not a code change. Nothing in the schema,
 * the search layer or the API is touched to add Yoruba; this file is the whole
 * difference.
 *
 * THE SOURCE RUNS THE OTHER WAY
 *
 * The dataset maps ENGLISH words to Yoruba translations:
 *
 *   { "english_word": "a",
 *     "parts_of_speech": ["art/f"],
 *     "yoruba_translations": "ìgékúrú, ìṣẹ́kù, àkékúrú" }
 *
 * A Yoruba dictionary needs the opposite, so the import INVERTS it: each Yoruba
 * term becomes a headword, and the English word becomes its gloss. One source
 * row therefore produces many headwords, and the same Yoruba term reached from
 * two different English words accumulates two glosses rather than duplicating.
 *
 * WHAT THE PARENTHESES MEAN, AND WHY THEY ARE KEPT
 *
 * Roughly 400 translations carry an English domain label in brackets:
 *
 *   "(bank)  owó àpamọ, ìṣirò, ìkàsí"
 *
 * That is not corruption — it is the source dictionary's sense disambiguation,
 * and it is the most useful thing in the file: it distinguishes "bank" the
 * financial institution from "bank" the riverside. The label is parsed out and
 * kept as the definition's `label`, and the rest splits on commas and semicolons
 * into separate Yoruba terms.
 *
 * WHAT IS REJECTED
 *
 * 391 of 3,065 entries (12.8%) have a translation field starting with
 * punctuation — ")  kan", "/m  arúfin" — which is OCR damage to the bracket
 * that should have opened a domain label. Those are dropped rather than
 * imported, because a headword of ")  kan" is not a word. Everything imported
 * stays `is_verified = false`: this source has no editorial review behind it,
 * and the honest state is "candidate entry awaiting a Yoruba speaker".
 *
 * Usage:
 *   node src/import/yoruba.ts
 *   OZITUMA_IMPORT_LIMIT=200 node src/import/yoruba.ts
 *   OZITUMA_IMPORT_DRY_RUN=1 node src/import/yoruba.ts
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { SlugAllocator, formatMs, insertMany, loadPosIndex, loadSourceId, progress } from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_DIR = resolve(HERE, '..', '..', '..', '..', 'data', 'sources', 'yoruba');

/**
 * The source's part-of-speech tags, mapped to the universal codes seeded in
 * `part_of_speech`. The tags carry sub-labels after a slash (`n/f`, `art/m`)
 * which are grammatical gender in the source's own scheme; the base tag is what
 * maps.
 */
const POS_TAGS: Record<string, string> = {
  n: 'NNC',
  nprop: 'NNP',
  v: 'VRB',
  adj: 'ADJ',
  adv: 'ADV',
  prep: 'PRE',
  pron: 'PRN',
  conj: 'CJN',
  art: 'PRT',
  num: 'NUM',
  interj: 'INT',
  intj: 'INT',
  interj_: 'INT',
  aux: 'VRB',
  part: 'PRT',
  '': 'UNK',
};

interface SourceEntry {
  english_word?: string;
  parts_of_speech?: string[];
  yoruba_translations?: string;
}

export interface YorubaImportOptions {
  sourceDir?: string;
  sourceSlug?: string;
  limit?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface YorubaImportReport {
  entriesRead: number;
  entriesRejected: number;
  termsExtracted: number;
  wordsInserted: number;
  definitionsInserted: number;
  glossesMerged: number;
  labelCount: number;
  rejectedHeadwords: string[];
  unmappedPosTags: Record<string, number>;
  durationMs: number;
}

/** Resolve a source POS tag to a universal code, or null if unmappable. */
function posCodeFor(tag: string): string | null {
  const base = tag
    .replace(/^\(+|\)+$/g, '')
    .split('/')[0]!
    .trim()
    .toLowerCase();
  return POS_TAGS[base] ?? null;
}

interface ParsedEntry {
  terms: string[];
  label: string | null;
  posCode: string;
  english: string;
}

/**
 * Parse one source entry into Yoruba terms plus their shared context.
 * Returns null when the entry is too damaged to use.
 */
function parseEntry(entry: SourceEntry): ParsedEntry | null {
  const english = String(entry.english_word ?? '').trim();
  if (english.length === 0 || english.length > 60) return null;

  let raw = String(entry.yoruba_translations ?? '').trim();
  if (raw.length === 0) return null;

  // A translation starting with punctuation that is not an opening bracket is
  // OCR damage to a bracket that should have been there. Reject rather than
  // import a headword like ") kan".
  if (!raw.startsWith('(') && /^[^A-Za-zÀ-ÿẸẹỌọṢṣǸǹŃń\s]/.test(raw)) return null;

  // Extract a leading domain label, e.g. "(bank)  owó àpamọ, ìṣirò".
  let label: string | null = null;
  const labelMatch = raw.match(/^\(([^)]{1,40})\)\s*/);
  if (labelMatch) {
    label = labelMatch[1]!.trim().toLowerCase();
    raw = raw.slice(labelMatch[0].length);
  }

  // A '/' at the start after label removal is the same bracket damage.
  if (/^[^A-Za-zÀ-ÿẸẹỌọṢṣǸǹŃń\s]/.test(raw)) return null;

  const terms = raw
    // Parenthetical asides inside a list are the source's own comments, not
    // part of the word — "àbàmì (abàmì)" is one term with a variant.
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;]/)
    .map((term) => term.replace(/\s+/g, ' ').trim())
    .filter((term) => {
      if (term.length < 2 || term.length > 50) return false;
      // Must start with a letter, and must not be pure ASCII noise.
      if (!/^[A-Za-zÀ-ÿẸẹỌọṢṣǸǹŃń]/.test(term)) return false;
      return true;
    });

  if (terms.length === 0) return null;

  const tags = entry.parts_of_speech ?? [];
  const posCode = posCodeFor(String(tags[0] ?? '')) ?? 'UNK';

  return { terms, label, posCode, english };
}

export async function importYorubaCorpus(
  db: Db,
  options: YorubaImportOptions = {}
): Promise<YorubaImportReport> {
  const started = Date.now();
  const log = options.log ?? ((message: string) => console.log(message));
  const sourceDir = options.sourceDir ?? process.env.OZITUMA_YORUBA_SOURCE ?? DEFAULT_SOURCE_DIR;
  const languageCode = 'yor';
  const sourceSlug = options.sourceSlug ?? 'iwaju-yoruba-dictionary';

  const language = requireLanguage(languageCode);
  const sourceId = await loadSourceId(db, sourceSlug);
  const posIndex = await loadPosIndex(db, languageCode);

  const filePath = join(sourceDir, 'english-yoruba-dictionary.json');
  log(`  reading ${filePath}`);
  const entries = JSON.parse(await readFile(filePath, 'utf8')) as SourceEntry[];
  log(`  corpus: ${entries.length} English entries`);

  const limited = options.limit && options.limit > 0 ? entries.slice(0, options.limit) : entries;

  // --- Parse ---------------------------------------------------------------
  const unmappedPosTags: Record<string, number> = {};
  const termsByHeadword = new Map<
    string,
    { headword: string; exactForm: string; searchForm: string; posCode: string; glosses: { text: string; label: string | null }[] }
  >();

  let rejected = 0;
  let labelCount = 0;
  let termsExtracted = 0;

  for (const entry of limited) {
    const parsed = parseEntry(entry);
    if (!parsed) {
      rejected += 1;
      continue;
    }
    if (parsed.label) labelCount += 1;

    const tag = String((entry.parts_of_speech ?? [])[0] ?? '');
    if (tag && posCodeFor(tag) === null) {
      unmappedPosTags[tag] = (unmappedPosTags[tag] ?? 0) + 1;
    }

    for (const term of parsed.terms) {
      termsExtracted += 1;
      const fields = deriveForms(term, language);
      if (fields.headword.length < 2) continue;

      const existing = termsByHeadword.get(fields.headword);
      if (existing) {
        // A second English word reaching the same Yoruba term adds a gloss
        // rather than a duplicate headword.
        if (!existing.glosses.some((g) => g.text === parsed.english)) {
          existing.glosses.push({ text: parsed.english, label: parsed.label });
        }
        continue;
      }
      termsByHeadword.set(fields.headword, {
        headword: fields.headword,
        exactForm: fields.exactForm,
        searchForm: fields.searchForm,
        posCode: parsed.posCode,
        glosses: [{ text: parsed.english, label: parsed.label }],
      });
    }
  }

  // Reject implausibly polygloss headwords.
  //
  // A Yoruba word genuinely can carry several English senses — "ère" is
  // profit, gain, benefit, advantage, award — and those are kept. But two
  // headwords in this source carry an IDENTICAL 26-gloss list ("tale, talent,
  // tarnish, talk, ..."), which is not polysemy: it is a whole alphabetical
  // run of English words attached to the wrong key. No Yoruba word means all
  // 26.
  //
  // The threshold is deliberately loose (15) so it removes only that failure
  // mode and cannot quietly discard legitimate senses.
  const MAX_GLOSSES_PER_HEADWORD = 15;
  const allRecords = [...termsByHeadword.values()];
  const records = allRecords.filter((r) => r.glosses.length <= MAX_GLOSSES_PER_HEADWORD);
  const rejectedHeadwords = allRecords
    .filter((r) => r.glosses.length > MAX_GLOSSES_PER_HEADWORD)
    .map((r) => `${r.headword} (${r.glosses.length} glosses)`);
  if (rejectedHeadwords.length > 0) {
    log(`  rejected ${rejectedHeadwords.length} headword(s) with implausible gloss counts: ${rejectedHeadwords.join(', ')}`);
  }
  const mergedGlosses = records.reduce((sum, r) => sum + Math.max(0, r.glosses.length - 1), 0);

  log(
    `  parsed: ${records.length} distinct Yoruba headwords from ${termsExtracted} terms ` +
      `(${rejected} entries rejected as damaged, ${labelCount} carried a domain label, ` +
      `${mergedGlosses} extra glosses merged)`
  );

  if (options.dryRun) {
    return {
      entriesRead: limited.length,
      entriesRejected: rejected,
      termsExtracted,
      wordsInserted: 0,
      definitionsInserted: 0,
      glossesMerged: mergedGlosses,
      labelCount,
      rejectedHeadwords,
      unmappedPosTags,
      durationMs: Date.now() - started,
    };
  }

  // --- Insert --------------------------------------------------------------
  const allocator = new SlugAllocator();
  const foreignSlugs = await db.rows<{ slug: string }>(
    `select slug from word where language_code = $1`,
    [languageCode]
  );
  for (const row of foreignSlugs) allocator.reserve(languageCode, row.slug);

  const existing = await db.rows<{ headword: string }>(
    `select headword from word where language_code = $1`,
    [languageCode]
  );
  const alreadyThere = new Set(existing.map((row) => row.headword));

  const newRecords = records.filter((record) => !alreadyThere.has(record.headword));
  log(`  inserting ${newRecords.length} Yoruba headwords ...`);

  const wordRows: unknown[][] = [];
  for (const record of newRecords) {
    wordRows.push([
      languageCode,
      record.headword,
      record.exactForm,
      record.searchForm,
      allocator.allocate(languageCode, record.headword, language),
      sourceId,
    ]);
    // `is_verified` defaults to false, which is the honest state: nothing in
    // this source has been checked by a Yoruba speaker.
  }

  const CHUNK = 400;
  let wordsInserted = 0;
  for (let start = 0; start < wordRows.length; start += CHUNK) {
    const chunk = wordRows.slice(start, start + CHUNK);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of chunk) {
      tuples.push(`(${row.map((_, i) => `$${values.length + i + 1}`).join(', ')})`);
      values.push(...row);
    }
    const result = await db.query(
      `insert into word (language_code, headword, exact_form, search_form, slug, source_id)
       values ${tuples.join(', ')}
       on conflict (language_code, headword) do nothing`,
      values
    );
    wordsInserted += result.rowCount;
    progress('words', Math.min(start + CHUNK, wordRows.length), wordRows.length);
  }

  // Read back ids so definitions can attach.
  const idRows = await db.rows<{ id: string; headword: string }>(
    `select id, headword from word where language_code = $1`,
    [languageCode]
  );
  const idByHeadword = new Map(idRows.map((row) => [row.headword, Number(row.id)]));

  const definitionRows: unknown[][] = [];
  const seenDefinitions = new Set<string>();
  for (const record of records) {
    const wordId = idByHeadword.get(record.headword);
    if (wordId === undefined) continue;
    const posId = posIndex.byCode.get(record.posCode) ?? posIndex.unclassified;
    for (const [index, gloss] of record.glosses.entries()) {
      const key = `${wordId}:${gloss.text}`;
      if (seenDefinitions.has(key)) continue;
      seenDefinitions.add(key);
      definitionRows.push([
        wordId,
        'eng',
        posId,
        gloss.text,
        index,
        index === 0,
        gloss.label,
        sourceId,
      ]);
    }
  }

  log(`\n  inserting ${definitionRows.length} glosses ...`);
  const definitionsInserted = await insertMany(
    db,
    'definition',
    ['word_id', 'language_code', 'part_of_speech_id', 'text', 'position', 'is_primary', 'label', 'source_id'],
    definitionRows,
    { onConflict: 'on conflict (word_id, language_code, text) do nothing' }
  );

  return {
    entriesRead: limited.length,
    entriesRejected: rejected,
    termsExtracted,
    wordsInserted,
    definitionsInserted,
    glossesMerged: mergedGlosses,
    labelCount,
    rejectedHeadwords,
    unmappedPosTags,
    durationMs: Date.now() - started,
  };
}

export async function runYorubaImportCli(): Promise<void> {
  const db = await getDb();
  try {
    console.log('\nImporting the Yoruba corpus (first non-Igbo language)\n');
    const report = await importYorubaCorpus(db, {
      limit: process.env.OZITUMA_IMPORT_LIMIT ? Number(process.env.OZITUMA_IMPORT_LIMIT) : undefined,
      dryRun: process.env.OZITUMA_IMPORT_DRY_RUN === '1',
    });

    console.log('\n  Import complete');
    console.log('  ' + '-'.repeat(48));
    console.log(`  entries read             ${report.entriesRead}`);
    console.log(`  entries rejected         ${report.entriesRejected}`);
    console.log(`  terms extracted          ${report.termsExtracted}`);
    console.log(`  words inserted           ${report.wordsInserted}`);
    console.log(`  glosses inserted         ${report.definitionsInserted}`);
    console.log(`  extra glosses merged     ${report.glossesMerged}`);
    console.log(`  entries with a label     ${report.labelCount}`);
    console.log(`  headwords rejected       ${report.rejectedHeadwords.length}`);
    console.log(`  duration                 ${formatMs(report.durationMs)}`);
    const unmapped = Object.entries(report.unmappedPosTags);
    if (unmapped.length > 0) {
      console.log(`  unmapped POS tags        ${unmapped.map(([k, v]) => `${k}(${v})`).join(', ')}`);
    }
    console.log('');
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runYorubaImportCli().catch((error) => {
    console.error('\nImport failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
