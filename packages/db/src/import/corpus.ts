/**
 * Corpus import machinery, shared by every language importer.
 *
 * The reference implementation seeds itself by re-expanding a JSON dictionary
 * at boot and printing to stdout, with a `process.exit(0)` and a 15-second
 * sleep to let MongoDB rebuild text indexes. That is not a repeatable pipeline.
 *
 * This is: bulk, batched, idempotent, inside a transaction, and it reports
 * exactly what it did. Re-running it must not duplicate rows and must not
 * touch entries that editors or the community own.
 */
import { deriveForms, slugify, type LanguageDefinition } from '@ozituma/core';
import type { Db } from '../client.ts';

/** Insert many rows using chunked multi-VALUES, which both drivers handle. */
export async function insertMany(
  db: Db,
  table: string,
  columns: string[],
  rows: readonly unknown[][],
  opts: { onConflict?: string; chunkSize?: number } = {}
): Promise<number> {
  if (rows.length === 0) return 0;

  const chunkSize = opts.chunkSize ?? 500;
  const colList = columns.join(', ');
  const perRow = columns.length;
  let inserted = 0;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const tuples: string[] = [];

    for (const row of chunk) {
      const placeholders = Array.from({ length: perRow }, (_, i) => `$${values.length + i + 1}`);
      tuples.push(`(${placeholders.join(', ')})`);
      // Pad/truncate defensively so a malformed row fails loudly rather than
      // silently shifting every subsequent column.
      if (row.length !== perRow) {
        throw new Error(
          `insertMany(${table}): expected ${perRow} values, got ${row.length} in row ${start}`
        );
      }
      values.push(...row);
    }

    const sql =
      `insert into ${table} (${colList}) values ${tuples.join(', ')}` +
      (opts.onConflict ? ` ${opts.onConflict}` : '');
    const result = await db.query(sql, values);
    inserted += result.rowCount;
  }

  return inserted;
}

export interface PosIndex {
  /** part_of_speech id by code, for this language. */
  byCode: Map<string, number>;
  /** Fallback id for unclassified entries. */
  unclassified: number;
}

/**
 * Build a part-of-speech lookup for a language, falling back to the universal
 * rows (language_code is null) and finally to UNK. Never throws for an unknown
 * code — a corpus with one unmapped class should import, not fail.
 */
export async function loadPosIndex(db: Db, languageCode: string): Promise<PosIndex> {
  const rows = await db.rows<{ id: number; code: string; language_code: string | null }>(
    `select id, code, language_code from part_of_speech
      where language_code = $1 or language_code is null`,
    [languageCode]
  );

  const byCode = new Map<string, number>();
  // Universal rows first, so language-specific rows win on collision.
  for (const row of rows.filter((r) => r.language_code === null)) byCode.set(row.code, row.id);
  for (const row of rows.filter((r) => r.language_code !== null)) byCode.set(row.code, row.id);

  const unclassified =
    byCode.get('UNK') ?? byCode.values().next().value ?? (() => {
      throw new Error('part_of_speech is empty — run `npm run seed` first');
    })();

  return { byCode, unclassified };
}

export interface FormTypeIndex {
  byCode: Map<string, number>;
}

export async function loadFormTypeIndex(db: Db, languageCode: string): Promise<FormTypeIndex> {
  const rows = await db.rows<{ id: number; code: string; language_code: string | null }>(
    `select id, code, language_code from form_type
      where language_code = $1 or language_code is null`,
    [languageCode]
  );
  const byCode = new Map<string, number>();
  for (const row of rows.filter((r) => r.language_code === null)) byCode.set(row.code, row.id);
  for (const row of rows.filter((r) => r.language_code !== null)) byCode.set(row.code, row.id);
  return { byCode };
}

export async function loadSourceId(db: Db, slug: string): Promise<number> {
  const row = await db.one<{ id: number }>(`select id from source where slug = $1`, [slug]);
  if (!row) {
    throw new Error(`Unknown source "${slug}" — run \`npm run seed\` first.`);
  }
  return row.id;
}

/**
 * Assign a URL slug that is unique within the language.
 *
 * Slugs come from the *search form*, so `àkwà` and `ákwá` both want `akwa`.
 * That collision is real and must be resolved deterministically: processing
 * headwords in sorted order and appending `-2`, `-3`, … keeps a given word's
 * URL stable across re-imports, which matters because these URLs are public
 * and indexed.
 */
export class SlugAllocator {
  private readonly taken = new Map<string, string>();

  /**
   * Mark a slug as already used by something this import does not own — a
   * community or editorial entry, for instance. Without this, an import could
   * try to claim a slug that already exists and violate the unique index.
   */
  reserve(languageCode: string, slug: string): void {
    const key = `${languageCode}:${slug}`;
    if (!this.taken.has(key)) this.taken.set(key, '\u0000reserved');
  }

  /** Returns the slug to use for `headword`. */
  allocate(languageCode: string, headword: string, orthography?: LanguageDefinition): string {
    const base = slugify(headword, orthography);
    const key = `${languageCode}:${base}`;
    const owner = this.taken.get(key);

    if (owner === undefined) {
      this.taken.set(key, headword);
      return base;
    }
    if (owner === headword) return base;

    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      const candidateKey = `${languageCode}:${candidate}`;
      if (!this.taken.has(candidateKey)) {
        this.taken.set(candidateKey, headword);
        return candidate;
      }
    }
    throw new Error(`Could not allocate a slug for "${headword}" (${languageCode})`);
  }
}

/**
 * The key that says two entries are the same word with the same meaning.
 *
 * `exact_form` folds tone but keeps the marks that change which letter it is, so
 * `nna` and `nnà` land on the same key and `nso` and `ǹso` do not. Pairing it
 * with the definitions is what separates a duplicate from a homograph: `nnà` and
 * `nna` both mean "father" and are one entry, while `nso` ("close"), `nsò`
 * ("queue") and `ǹso` ("nearness") share a spelling and are three.
 *
 * This lives here rather than in the importer because the integrity gate has to
 * apply the same rule to the rows that were written, and two copies of a rule
 * drift. Definitions are lowercased and sorted so that the same meanings listed
 * in a different order are still the same meanings.
 */
export function duplicateSignature(
  exactForm: string,
  definitions: readonly string[]
): string {
  const meanings = [...definitions]
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0)
    .sort();
  return `${exactForm}\u0000${meanings.join('\u0001')}`;
}

/** Tone marks, which are what the tone-neutral spelling throws away. */
export function toneMarks(headword: string): number {
  return (headword.normalize('NFD').match(/[\u0300\u0301]/gu) ?? []).length;
}

/** What a duplicate group is compared on when choosing which entry survives. */
export interface DuplicateCandidate {
  headword: string;
  /** True when the entry carries a real part of speech rather than none. */
  classified: boolean;
}

/**
 * Which of two entries for the same word is the one to keep.
 *
 * Negative means `a` survives. Each step is earned rather than preferred:
 *
 *   1. A classified part of speech beats none. For Igbo this is exactly what
 *      makes the main dictionary's entry win over the frequency-ranked common
 *      word list, which classifies nothing — 0 of its 702 entries carry a word
 *      class. For any other corpus it is the same principle: the entry that
 *      knows what it is outranks the one that does not.
 *   2. More tone marks. The headword IS the entry, and the tone-neutral spelling
 *      is already printed beneath it, so keeping the marked one loses nothing
 *      and discarding it loses the pronunciation.
 *   3. Lexicographic, so re-running an import cannot reorder the dictionary.
 *
 * Shared by the importer, which prevents duplicates as it writes, and by the
 * sweep that repairs ones already in the database. Two copies of this would
 * drift, and the second copy would be the one nobody checked.
 */
export function preferDuplicateSurvivor(a: DuplicateCandidate, b: DuplicateCandidate): number {
  const classed = Number(b.classified) - Number(a.classified);
  if (classed !== 0) return classed;
  const tones = toneMarks(b.headword) - toneMarks(a.headword);
  if (tones !== 0) return tones;
  return a.headword < b.headword ? -1 : a.headword > b.headword ? 1 : 0;
}

/** Derived fields every headword row needs. */
export function wordFields(headword: string, orthography: LanguageDefinition) {
  const forms = deriveForms(headword, orthography);
  return {
    headword: forms.headword,
    exactForm: forms.exactForm,
    searchForm: forms.searchForm,
  };
}

export function progress(label: string, done: number, total: number): void {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  process.stdout.write(`\r  ${label} ${done}/${total} (${pct}%)          `);
  if (done >= total) process.stdout.write('\n');
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
