/**
 * Import a dictionary from extracted plain text.
 *
 * Six of the candidate languages have at least one source with a usable text
 * layer, and they are all "headword, part of speech, English gloss" — the
 * shape every bilingual dictionary has had for two centuries. So the parsing
 * is configurable rather than duplicated per language: this module reads a
 * `TextDictionaryConfig` and a text file, and writes words and definitions.
 *
 * WHY A CONFIG AND NOT SIX IMPORTERS
 *
 * The per-language differences are real but small: the part-of-speech
 * abbreviations, whether an entry fits on one line, how homographs are marked.
 * Those are data. Writing six near-identical importers would mean six places
 * for the orthography handling, the slug allocation and the attribution to
 * drift apart.
 *
 * EVERYTHING LANDS UNVERIFIED
 *
 * Extracted text is a transcription, not a dictionary. Even where the text
 * layer is clean, the source may have OCR'd before it was published, and the
 * part-of-speech mapping is a guess. So every imported entry is created with
 * `is_verified = false` and its provenance recorded, and entries whose headword
 * contains an unrecoverable character are skipped entirely — a word we cannot
 * spell is worse than a missing word.
 *
 * Usage:
 *   node src/import/text-dictionary.ts urhobo
 *   node src/import/text-dictionary.ts --list
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { SlugAllocator, formatMs, insertMany, loadPosIndex, loadSourceId, progress } from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = resolve(HERE, '..', '..', '..', '..', 'data', 'sources');

/**
 * Part-of-speech abbreviations as they appear across these dictionaries, mapped
 * to the universal codes seeded in `part_of_speech`. Shared because a
 * dictionary that says "v." means a verb whichever language it documents.
 */
const COMMON_POS: Record<string, string> = {
  n: 'NNC',
  'n.': 'NNC',
  nn: 'NNC',
  v: 'VRB',
  'v.': 'VRB',
  vb: 'VRB',
  adj: 'ADJ',
  'adj.': 'ADJ',
  adv: 'ADV',
  'adv.': 'ADV',
  pron: 'PRN',
  'pron.': 'PRN',
  prep: 'PRE',
  'prep.': 'PRE',
  conj: 'CJN',
  'conj.': 'CJN',
  num: 'NUM',
  'num.': 'NUM',
  int: 'INT',
  'int.': 'INT',
  interj: 'INT',
  'interj.': 'INT',
  part: 'PRT',
  'part.': 'PRT',
  id: 'IDM',
  'id.': 'IDM',
  ph: 'PHR',
  'ph.': 'PHR',
};

export interface TextDictionaryConfig {
  /** Language the headwords are in (the gloss language is always English). */
  language: string;
  /** Slug of the `source` row, for attribution. */
  sourceSlug: string;
  /** Path to the extracted text, relative to data/sources/. */
  textFile: string;
  /**
   * Matches one entry line. Must expose named groups `headword`, `pos` and
   * `gloss`.
   */
  entryPattern: RegExp;
  /** Extra POS abbreviations beyond COMMON_POS. */
  posMap?: Record<string, string>;
  /**
   * Join a letter-spaced headword at the start of each line.
   *
   * In the Wolof and Mandinka dictionaries the headword is typeset with a space
   * between every letter — "c u u c u n penis..." — while the gloss and example
   * are normally spaced. A whole-line collapse welds the gloss together
   * ("Cookpeanutporridge"), so the join has to stop at the headword boundary.
   *
   * The boundary is found by treating the last single letter of the leading run
   * as the part-of-speech marker, which is what it is: "c u u c u n" is the
   * headword "cuucu" plus "n". Applied only when that letter really is a known
   * abbreviation, so a genuine one-letter word is not eaten.
   */
  joinLeadingLetterSpacing?: boolean;
  /** Headwords shorter than this are rejected as extraction noise. */
  minHeadwordLength?: number;
  /** Longest plausible headword, in characters. */
  maxHeadwordLength?: number;
  /** Longest plausible gloss. */
  maxGlossLength?: number;
  /** Lines matching this are structural (page markers, headings) and skipped. */
  ignorePattern?: RegExp;
  /**
   * Rewrite the extracted lines before matching.
   *
   * Needed for dictionaries that are laid out as a TABLE rather than as one
   * entry per line — Blench's Ekpeye dictionary prints headword, part of
   * speech, English and Comment in four stacked lines, one field per line, so
   * a line-oriented pattern matches nothing until the blocks are joined.
   *
   * Kept as a hook rather than a flag because the grouping rule depends on the
   * source: what separates one entry from the next is a property of that
   * dictionary, not of the format in general.
   */
  preprocess?: (lines: string[]) => string[];
  /**
   * Entry status for imported words. Defaults to 'published'.
   *
   * Set it to 'draft' whenever a source's licence is unresolved or its text is
   * unreviewed, so the entries exist for preparation and review without being
   * served by the API or the site. Offering them publicly before clearance
   * would be redistributing somebody else's dictionary.
   */
  importStatus?: 'published' | 'draft' | 'pending_review';
  /**
   * When set, each imported headword also gets a `word_dialect` row recording
   * its spelling as belonging to this dialect code.
   *
   * This is how a dialect dictionary is folded INTO its parent language rather
   * than placed beside it: the entries keep the parent's `language_code`, and
   * the dialect row is what labels them. A reader searching the parent language
   * finds them, and the entry page shows which variety they belong to.
   */
  dialectCode?: string;
  /**
   * Clean up a headword before it is used.
   *
   * Needed where the source carries notation rather than letters — Blench's
   * Ekpeye dictionary marks downstep with "!" mid-word and its OCR splits words
   * around diacritics, so headwords arrive as "ada ! ka" and "ad a".
   */
  normaliseHeadword?: (raw: string) => string;
}

export interface TextDictionaryReport {
  language: string;
  /** Dialect these entries were labelled as, when the config sets one. */
  dialectCode: string | null;
  dialectRows: number;
  linesRead: number;
  entriesMatched: number;
  entriesRejected: number;
  wordsInserted: number;
  definitionsInserted: number;
  duplicateHeadwords: number;
  unmappedPos: Record<string, number>;
  rejectReasons: Record<string, number>;
  durationMs: number;
}

/**
 * Headwords containing a digit or the '?' used for unrecoverable characters are
 * extraction damage, not words.
 */
const DAMAGED_HEADWORD = /[\d?=]/;

export async function importTextDictionary(
  db: Db,
  config: TextDictionaryConfig,
  options: { dryRun?: boolean; limit?: number; log?: (m: string) => void; replace?: boolean } = {}
): Promise<TextDictionaryReport> {
  const started = Date.now();
  const log = options.log ?? ((m: string) => console.log(m));
  const language = requireLanguage(config.language);
  const sourceId = await loadSourceId(db, config.sourceSlug);
  const posIndex = await loadPosIndex(db, config.language);
  const posMap = { ...COMMON_POS, ...(config.posMap ?? {}) };

  const importStatus = config.importStatus ?? 'published';
  const minHead = config.minHeadwordLength ?? 2;
  const maxHead = config.maxHeadwordLength ?? 40;
  const maxGloss = config.maxGlossLength ?? 300;

  const textPath = join(DATA_ROOT, config.textFile);
  log(`  reading ${textPath}`);
  const raw = await readFile(textPath, 'utf8');
  const lines = raw.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  log(`  ${lines.length} lines`);

  const unmappedPos: Record<string, number> = {};
  const rejectReasons: Record<string, number> = {};
  const reject = (reason: string) => {
    rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1;
  };

  interface Parsed {
    headword: string;
    exactForm: string;
    searchForm: string;
    posCode: string;
    gloss: string;
  }
  const parsed: Parsed[] = [];
  let matched = 0;

  /**
   * Rejoin a letter-spaced headword at the start of a line.
   * See `joinLeadingLetterSpacing` in TextDictionaryConfig.
   */
  function rejoinLeadingHeadword(line: string): string {
    const tokens = line.split(' ');
    let consumed = 0;
    for (const token of tokens) {
      // Single letters only, and only while they keep being single letters.
      if (token.length !== 1 || !/^\p{L}$/u.test(token)) break;
      consumed += 1;
    }
    if (consumed < 3) return line;

    const joined = tokens.slice(0, consumed).join('');
    const rest = tokens.slice(consumed).join(' ');

    // The final single letter is the POS marker when it names one.
    for (const size of [2, 1]) {
      const candidatePos = joined.slice(-size).toLowerCase();
      const candidateHead = joined.slice(0, -size);
      if (candidateHead.length >= 2 && posMap[candidatePos]) {
        return `${candidateHead} ${candidatePos} ${rest}`.trim();
      }
    }
    // No POS found, so the whole run is the headword.
    return `${joined} ${rest}`.trim();
  }

  const prepared = config.preprocess ? config.preprocess(lines) : lines;

  for (const line of prepared.slice(0, options.limit && options.limit > 0 ? options.limit * 40 : undefined)) {
    if (line.length === 0) continue;
    if (config.ignorePattern?.test(line)) continue;

    const candidate = config.joinLeadingLetterSpacing ? rejoinLeadingHeadword(line) : line;
    const m = candidate.match(config.entryPattern);
    if (!m?.groups) continue;
    matched += 1;

    const headwordRaw = (config.normaliseHeadword ?? ((raw: string) => raw.trim()))(
      (m.groups.headword ?? '').trim()
    );
    const posRaw = (m.groups.pos ?? '').trim().toLowerCase().replace(/^\(|\)$/g, '');
    const gloss = (m.groups.gloss ?? '').trim();

    if (DAMAGED_HEADWORD.test(headwordRaw)) {
      reject('unknowable characters in the headword');
      continue;
    }
    if (headwordRaw.length < minHead || headwordRaw.length > maxHead) {
      reject('headword length out of range');
      continue;
    }
    if (!/^\p{L}/u.test(headwordRaw)) {
      reject('headword does not start with a letter');
      continue;
    }
    if (gloss.length === 0 || gloss.length > maxGloss) {
      reject('gloss missing or too long');
      continue;
    }
    if (DAMAGED_HEADWORD.test(gloss)) {
      // The gloss is English, so a digit or '?' means the extraction failed
      // here too — common in inline example sentences with numerals.
      reject('unknowable characters in the gloss');
      continue;
    }

    const posCode = posMap[posRaw];
    if (!posCode) {
      unmappedPos[posRaw || '(empty)'] = (unmappedPos[posRaw || '(empty)'] ?? 0) + 1;
    }

    const fields = deriveForms(headwordRaw, language);
    parsed.push({
      headword: fields.headword,
      exactForm: fields.exactForm,
      searchForm: fields.searchForm,
      posCode: posCode ?? 'UNK',
      gloss,
    });
  }

  // One headword may appear several times with different senses; merge them
  // rather than letting the unique constraint drop all but the first.
  const byHeadword = new Map<string, Parsed & { glosses: { text: string; posCode: string }[] }>();
  let duplicates = 0;
  for (const entry of parsed) {
    const existing = byHeadword.get(entry.headword);
    if (existing) {
      duplicates += 1;
      if (!existing.glosses.some((g) => g.text === entry.gloss)) {
        existing.glosses.push({ text: entry.gloss, posCode: entry.posCode });
      }
      continue;
    }
    byHeadword.set(entry.headword, {
      ...entry,
      glosses: [{ text: entry.gloss, posCode: entry.posCode }],
    });
  }

  const records = [...byHeadword.values()];
  const rejected = Object.values(rejectReasons).reduce((a, b) => a + b, 0);
  log(
    `  matched ${matched} entries -> ${records.length} distinct headwords ` +
      `(${rejected} rejected, ${duplicates} merged as extra senses)`
  );

  if (options.dryRun) {
    return {
      language: config.language,
      dialectCode: config.dialectCode ?? null,
      dialectRows: 0,
      // The preprocessed count, not the raw line count: for a tabular source
      // these differ by the number of field lines per entry.
      linesRead: prepared.length,
      entriesMatched: matched,
      entriesRejected: rejected,
      wordsInserted: 0,
      definitionsInserted: 0,
      duplicateHeadwords: duplicates,
      unmappedPos,
      rejectReasons,
      durationMs: Date.now() - started,
    };
  }

  // --- Insert --------------------------------------------------------------

  /*
   * A re-scan. When a source has been read again and read better, the rows the
   * earlier pass wrote have to go, or the dictionary ends up holding both
   * readings — "da" beside "ịda", each with a sense of "father", one of them
   * wrong and neither marked as such.
   *
   * What goes, and what deliberately does not:
   *
   *   - every dialect row for this dialect, because a spelling is either in the
   *     new reading or it is not;
   *   - this source's definitions;
   *   - the DRAFT words this source created, and only those. A published word is
   *     never deleted by an import, and neither is a word another source has
   *     given a sense to: the published Igbo headword an Ekpeye spelling was
   *     attached to keeps its own entry and simply loses the stale spelling.
   */
  if (options.replace && !options.dryRun) {
    const removedDialect = config.dialectCode
      ? await db.query(
          `delete from word_dialect wd
            using dialect d
            where wd.dialect_id = d.id and d.language_code = $1 and d.code = $2`,
          [config.language, config.dialectCode]
        )
      : { rowCount: 0 };
    const removedSenses = await db.query(`delete from definition where source_id = $1`, [sourceId]);
    const removedWords = await db.query(
      `delete from word w
        where w.source_id = $1
          and w.status = 'draft'
          and not exists (
            select 1 from definition d where d.word_id = w.id and d.source_id is distinct from $1
          )`,
      [sourceId]
    );
    log(
      `  replaced: ${removedWords.rowCount} words, ${removedSenses.rowCount} senses, ` +
        `${removedDialect.rowCount ?? 0} dialect spellings`
    );
  }

  const allocator = new SlugAllocator();
  for (const row of await db.rows<{ slug: string }>(
    `select slug from word where language_code = $1`,
    [config.language]
  )) {
    allocator.reserve(config.language, row.slug);
  }

  const existing = await db.rows<{ headword: string }>(
    `select headword from word where language_code = $1`,
    [config.language]
  );
  const alreadyThere = new Set(existing.map((r) => r.headword));
  const toInsert = records.filter((r) => !alreadyThere.has(r.headword));

  log(`  inserting ${toInsert.length} ${language.name} headwords ...`);
  const wordRows = toInsert.map((r) => [
    config.language,
    r.headword,
    r.exactForm,
    r.searchForm,
    allocator.allocate(config.language, r.headword, language),
    sourceId,
    importStatus,
  ]);

  let wordsInserted = 0;
  const CHUNK = 400;
  for (let start = 0; start < wordRows.length; start += CHUNK) {
    const chunk = wordRows.slice(start, start + CHUNK);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of chunk) {
      tuples.push(`(${row.map((_, i) => `$${values.length + i + 1}`).join(', ')})`);
      values.push(...row);
    }
    const result = await db.query(
      `insert into word (language_code, headword, exact_form, search_form, slug, source_id, status)
       values ${tuples.join(', ')}
       on conflict (language_code, headword) do nothing`,
      values
    );
    wordsInserted += result.rowCount;
    progress('words', Math.min(start + CHUNK, wordRows.length), wordRows.length);
  }

  const idRows = await db.rows<{ id: string; headword: string }>(
    `select id, headword from word where language_code = $1`,
    [config.language]
  );
  const idByHeadword = new Map(idRows.map((r) => [r.headword, Number(r.id)]));

  // Resolve the dialect once. Its id labels the spellings and its name labels
  // the senses, and both must exist before either is written — a dialect import
  // whose code is not registered would otherwise silently produce unlabelled
  // entries that look like ordinary words of the parent language.
  let dialectId: number | null = null;
  let dialectLabel: string | null = null;
  if (config.dialectCode) {
    const dialect = await db.one<{ id: string; name: string }>(
      `select id, name from dialect where language_code = $1 and code = $2`,
      [config.language, config.dialectCode]
    );
    if (!dialect) {
      throw new Error(
        `Dialect ${config.dialectCode} is not registered for ${config.language}. ` +
          'Seed the dialect before importing its words, so the label cannot go missing.'
      );
    }
    dialectId = Number(dialect.id);
    dialectLabel = dialect.name;
  }

  const definitionRows: unknown[][] = [];
  for (const record of records) {
    const wordId = idByHeadword.get(record.headword);
    if (wordId === undefined) continue;
    for (const [index, gloss] of record.glosses.entries()) {
      definitionRows.push([
        wordId,
        'eng',
        posIndex.byCode.get(gloss.posCode) ?? posIndex.unclassified,
        gloss.text,
        index,
        index === 0,
        // For a dialect import the sense is labelled with the dialect name, so
        // an entry carrying senses from several varieties shows which is which.
        // Igbo "gba" collects 32 senses from three corpora; without the label
        // its nine Ekpeye senses are indistinguishable from the Igbo ones.
        dialectLabel,
        sourceId,
      ]);
    }
  }

  log(`  inserting ${definitionRows.length} glosses ...`);
  const definitionsInserted = await insertMany(
    db,
    'definition',
    [
      'word_id',
      'language_code',
      'part_of_speech_id',
      'text',
      'position',
      'is_primary',
      'label',
      'source_id',
    ],
    definitionRows,
    { onConflict: 'on conflict (word_id, language_code, text) do nothing' }
  );

  // Mark each headword as a form of the configured dialect.
  //
  // This is what folds a dialect dictionary INTO its parent language instead of
  // placing it beside: the entries keep the parent's language_code, and this row
  // is what labels them as a variety of it. A reader searching Igbo finds the
  // Ekpeye entries, and the entry page names the dialect.
  let dialectRows = 0;
  if (dialectId !== null) {
    const rows: unknown[][] = [];
    for (const record of records) {
      const wordId = idByHeadword.get(record.headword);
      if (wordId === undefined) continue;
      rows.push([wordId, dialectId, record.headword, record.searchForm]);
    }
    if (rows.length > 0) {
      log(`  labelling ${rows.length} headwords as ${config.dialectCode} dialect forms ...`);
      dialectRows = await insertMany(
        db,
        'word_dialect',
        ['word_id', 'dialect_id', 'spelling', 'search_form'],
        rows,
        { onConflict: 'on conflict (word_id, dialect_id, spelling) do nothing' }
      );
    }
  }

  return {
    language: config.language,
    dialectCode: config.dialectCode ?? null,
    dialectRows,
    linesRead: prepared.length,
    entriesMatched: matched,
    entriesRejected: rejected,
    wordsInserted,
    definitionsInserted,
    duplicateHeadwords: duplicates,
    unmappedPos,
    rejectReasons,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Per-language configurations
// ---------------------------------------------------------------------------

/**
 * Urhobo — Ukere, *Urhobo Dictionary* (1986), web edition by Roger Blench
 * (2005). Entries are one per line: headword, abbreviation, English gloss.
 */
export const URHOBO: TextDictionaryConfig = {
  language: 'urh',
  sourceSlug: 'ukere-urhobo',
  // The font mapping loses some diacritics, so require letters and common
  // orthographic marks only, and let the headword-length and damage checks
  // handle the rest.
  textFile: 'urhobo/urhobo-net/urhobo-dictionary.txt',
  entryPattern:
    /^(?<headword>[\p{L}][\p{L}\p{M}'\u2019\- ]{1,39}?)\s+(?<pos>n\.|v\.|adj\.|adv\.|pron\.|prep\.|conj\.|num\.|int\.|interj\.|part\.|id\.|ph\.)\s+(?<gloss>.{2,300})$/u,
  ignorePattern: /^(Urhobo Dictionary|Urhobo PoS|\[\[page|-{1,}\s*\d+\s*-{1,})/,
  minHeadwordLength: 2,
  // Licence unresolved — see the source row in seed.ts. Draft keeps these
  // entries out of the API and the site until they are cleared and reviewed.
  importStatus: 'draft',
};

/**
 * Shared shape for the two Gambia dictionaries.
 *
 * Both print `headword POS gloss. Example sentence. English translation.` on a
 * wrapped line, with the headword letter-spaced and the rest of the entry not.
 * The example and its translation cannot be separated from the gloss reliably
 * — there is no delimiter, and both contain capitals — so the gloss keeps them.
 * That is a real limitation, and it is why these stay draft: an editor has to
 * split the gloss from the example before they are publishable.
 */
const GAMBIA_PATTERN =
  /^(?<headword>[\p{L}][\p{L}\p{M}'\u2019\-]{1,29}(?:\s*\/\s*[\p{L}][\p{L}\p{M}'\u2019\-]{1,29})?)\s+(?<pos>n|v|va|vn|nv|adj|adv|pron|prep|conj|num|int|ex)\s+(?<gloss>.{2,300})$/u;

export const WOLOF: TextDictionaryConfig = {
  language: 'wol',
  sourceSlug: 'gambia-wolof',
  textFile: 'wol/gambia-wollof/wollof-decoded.txt',
  entryPattern: GAMBIA_PATTERN,
  joinLeadingLetterSpacing: true,
  importStatus: 'draft',
  minHeadwordLength: 2,
};

export const MANDINKA: TextDictionaryConfig = {
  language: 'mnk',
  sourceSlug: 'gambia-mandinka',
  textFile: 'mnk/gambia-mandinka/mandinka-decoded.txt',
  entryPattern: GAMBIA_PATTERN,
  joinLeadingLetterSpacing: true,
  importStatus: 'draft',
  minHeadwordLength: 2,
};

/**
 * Ekpeye — Blench, *A Dictionary of Ekpeye: An Igboid Language of Southern
 * Nigeria* (2013), after Clark and Williamson.
 *
 * Deliberately imported as a DIALECT OF IGBO, not as a language of its own:
 *
 *   - `language: 'ibo'`, so its entries live in the Igbo dictionary and are
 *     found by Igbo search.
 *   - `dialectCode: 'EKP'`, so each entry is labelled Ẹkpẹyẹ. That code already
 *     came from the Igbo API's own dialect list, so Ekpeye was always one of
 *     Igbo's dialects as far as this platform is concerned.
 *
 * The source supports that reading — Blench titles it "an Igboid language of
 * Southern Nigeria" — but it is a deliberate editorial choice rather than a
 * neutral one, so it is recorded in the source row as well as here.
 */
export const EKPEYE: TextDictionaryConfig = {
  language: 'ibo',
  dialectCode: 'EKP',
  sourceSlug: 'blench-ekpeye',
  /*
   * The PDF, not the archive.org scan of it.
   *
   * Both text layers of this document are wrong, in opposite directions, and the
   * first import used the worse one. The archive.org layer keeps the letters and
   * mangles the special characters — ị is dropped outright, ɗ becomes j, ŋ
   * becomes q — so "ịda" (father) arrived as "da" and was merged into the Igbo
   * verb "da", producing an entry that reads "fall / father". Its text puts each
   * table cell on its own line, which is why this config used to reassemble the
   * four columns before matching anything.
   *
   * The PDF's own layer keeps the diacritics and loses a whole word whenever a
   * headword changes font mid-word, because the fragments land on different
   * baselines: "àkwa" arrives as "a", "egwù" as "ù". `scripts/extract-pdf-rows.mjs`
   * fixes that by assembling visual rows instead of trusting pdf.js's line
   * order, after which the file below is one entry per line with complete
   * headwords: "ịda n. father", "ịdaƙanị n. grandfather", "àkwa n. bridge".
   *
   * So this config needs no preprocess step, and the whole source is re-read
   * rather than patched: the archive.org rows are replaced, not amended, because
   * there is no way to tell a mangled headword from a correct short one.
   */
  textFile: 'ekpeye/pdf/ekpeye-dictionary.txt',
  entryPattern:
    /^(?<headword>[\p{L}][\p{L}\p{M}'\u2019\-! ]{1,39})\s+(?<pos>n\.n\.|n\.|v\.|num\.|adv\.|pron\.|prep\.|conj\.|int\.|adj\.)\s+(?<gloss>.{2,300})$/iu,
  /**
   * Put the word back together, then strip what is punctuation rather than
   * letters.
   *
   * "!" is the source's downstep mark, written between syllables: "ag!ị" is the
   * word "agị", so it is removed rather than kept. A combining mark that landed
   * after a space ("àcî ̣" — the dot below, split off by the font change) is
   * closed up. Some entries give two spellings of one word in the headword cell
   * ("anyib!o or anyîbo n. banana"), and only the first can be the headword here,
   * so a trailing " or …" is dropped rather than imported as part of the word.
   * Internal spaces are kept, because "àhubẹle ìɓèkê" is a genuine two-word
   * headword and cannot be told from a layout gap without a speaker.
   */
  normaliseHeadword: (raw) =>
    raw
      .replace(/\s*!\s*/g, '')
      .replace(/ +(?=[\u0300-\u036f])/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+(?:or|and)(?:\s+\S.*)?$/i, '')
      .replace(/[,;.]+$/, '')
      .trim(),
  // Licence unresolved — no rights statement on the source.
  importStatus: 'draft',
  minHeadwordLength: 2,
};

export const TEXT_DICTIONARIES: Record<string, TextDictionaryConfig> = {
  urhobo: URHOBO,
  wolof: WOLOF,
  mandinka: MANDINKA,
  ekpeye: EKPEYE,
};

function report(r: TextDictionaryReport, log = console.log): void {
  log('\n  Import complete');
  log('  ' + '-'.repeat(48));
  log(`  language                 ${r.language}`);
  log(`  lines read               ${r.linesRead}`);
  log(`  entries matched          ${r.entriesMatched}`);
  log(`  entries rejected         ${r.entriesRejected}`);
  log(`  distinct headwords       ${r.wordsInserted}`);
  log(`  extra senses merged      ${r.duplicateHeadwords}`);
  log(`  glosses inserted         ${r.definitionsInserted}`);
  if (r.dialectCode) {
    log(`  labelled as dialect      ${r.dialectCode} — ${r.dialectRows} rows`);
  }
  log(`  duration                 ${formatMs(r.durationMs)}`);
  const unmapped = Object.entries(r.unmappedPos);
  if (unmapped.length > 0) {
    log(`  unmapped POS             ${unmapped.map(([k, v]) => `${k}(${v})`).join(', ')}`);
  }
  const reasons = Object.entries(r.rejectReasons);
  if (reasons.length > 0) {
    log(`  rejection reasons        ${reasons.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  }
  log('');
}

async function main(): Promise<void> {
  const arg = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);

  if (!arg || process.argv.includes('--list')) {
    console.log('\n  Available text dictionaries:');
    for (const [name, config] of Object.entries(TEXT_DICTIONARIES)) {
      console.log(`    ${name.padEnd(12)} ${config.language}  ${config.textFile}`);
    }
    console.log('\n  --replace   drop this source\'s draft words and senses first, then re-import');
    console.log('              (OZITUMA_IMPORT_DRY_RUN=1 reports without writing)\n');
    return;
  }

  const config = TEXT_DICTIONARIES[arg];
  if (!config) {
    console.error(`Unknown dictionary "${arg}". Use --list.`);
    process.exitCode = 1;
    return;
  }

  const db = await getDb();
  try {
    console.log(`\nImporting the ${config.language} text dictionary\n`);
    const result = await importTextDictionary(db, config, {
      dryRun: process.env.OZITUMA_IMPORT_DRY_RUN === '1',
      replace: process.argv.includes('--replace'),
    });
    report(result);
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error('\nImport failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
