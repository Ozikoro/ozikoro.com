/**
 * Igbo personal-name importer.
 *
 * Source: a list compiled and posted by Nze (@nzemmili) on X, captured as an
 * image and read with macOS Vision OCR — see the note in data/sources/names/.
 * 43 entries, each a name (often with short forms) and an English meaning.
 *
 *   node packages/db/src/import/names.ts
 *
 * GENDER
 *
 * The owner's rule, in two parts.
 *
 * 1. A name is unisex unless the source itself uses one of male, female, girl,
 *    boy, man or woman. `father` and `mother` are NOT signals, and neither is a
 *    pronoun in the gloss. So these are unisex despite reading as gendered:
 *
 *      Afunwaelotanna  "when you see child, you remember father"
 *      Afunwaelotanne  "when you see child, you remember mother"
 *      Akunna          "father's wealth"
 *      Akunne          "mother's wealth"
 *      Onochie         "he has replaced him/her"
 *
 * 2. The exception: an Igbo name built on a title morpheme is not unisex.
 *    `ozo`, `eze` and `nze` are titled names - the king, and the titled man -
 *    and they are male. Everything else is unisex.
 *
 * The importer still never infers from a gloss: it applies the two rules and
 * nothing else.
 *
 * PUBLICATION
 *
 * The source post states no licence, so this list was first imported as
 * `draft`, and the repository's rule was to leave it there until the position
 * was settled with the compiler.
 *
 * The owner has since directed that these names be published, on the basis
 * that the list is a compilation circulated for this use and is credited in
 * full on every entry and on the name dictionary's own page. The importer now
 * writes `published`. The licence on the source row is still recorded as
 * `unknown` rather than being upgraded to something it is not: the attribution
 * is explicit, the permission is the owner's call, and the provenance stays
 * legible to whoever revisits this.
 *
 * OCR
 *
 * The list came from a photograph, so the recognised text is not trusted blindly.
 * Obvious mis-reads are corrected here by explicit rule rather than silently:
 * `lwene` for `Iwene`, `lyiora` for `Iyiora`, `lfemeli` for `Ifemeli` — OCR reads
 * a capital I as a lowercase l. Any entry whose meaning failed to come across is
 * skipped rather than stored half-formed.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, slugify } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { formatMs } from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Gitignored source data; see docs/DATA-SOURCES.md. */
export const DEFAULT_NAMES_DIR = resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'data',
  'sources',
  'names',
  'x-nzemmili'
);

const SOURCE = {
  slug: 'x-nzemmili-igbo-names',
  name: 'Nze (@nzemmili) — compiled list of unique Igbo names',
  url: 'https://x.com/nzemmili/status/1878602661458853917',
  licenseCode: 'unknown',
  licenseUrl: null as string | null,
  attributionText:
    'A list of unique Igbo names compiled and published by Nze (@nzemmili) on X, ' +
    'captured from the accompanying image and read with macOS Vision OCR.',
  citation: 'Nze (@nzemmili), Igbo name compilation, X, January 2025.',
  notes:
    'No licence is stated on the post. The owner has directed that the list be ' +
    'published with attribution to the compiler; the licence code therefore stays ' +
    '"unknown" and the permission is recorded rather than asserted.',
};

interface RawName {
  number: number;
  names: string[];
  meaning: string;
  gender: string;
}

/**
 * Title morphemes that make a name male rather than unisex.
 *
 * `eze` is the king, `ozo` and `nze` are titled men. Matched anywhere in the
 * name, because these are compounds: Amandianaeze carries `eze` at the end.
 */
const TITLE_MORPHEMES = /(ozo|eze|nze)/i;

/** OCR confusions that are certain enough to fix mechanically. */
const OCR_FIXES: [RegExp, string][] = [
  [/^lwene$/i, 'Iwene'],
  [/^lyiora$/i, 'Iyiora'],
  [/^lfemeli$/i, 'Ifemeli'],
  [/^lyiora$/i, 'Iyiora'],
];

/** A trailing " -" left by OCR splitting a name from its bracket. */
function tidyName(value: string): string {
  let out = value.trim().replace(/\s*-\s*$/, '');
  for (const [pattern, replacement] of OCR_FIXES) {
    if (pattern.test(out)) out = replacement;
  }
  return out;
}

function tidyMeaning(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ') ')
    .trim()
    .replace(/[.\s]+$/, '');
}

export interface NameImportReport {
  read: number;
  skippedNoMeaning: number;
  inserted: number;
  byGender: Record<string, number>;
  duplicatesMerged: number;
  durationMs: number;
}

export async function importNames(
  options: { sourceDir?: string; languageCode?: string; log?: (m: string) => void } = {}
): Promise<NameImportReport> {
  const started = Date.now();
  const dir = options.sourceDir ?? DEFAULT_NAMES_DIR;
  const languageCode = options.languageCode ?? 'ibo';
  const log = options.log ?? ((m: string) => console.log(m));

  const raw: RawName[] = JSON.parse(await readFile(join(dir, 'names.json'), 'utf8'));
  const db = await getDb();

  // ---- the source row ----
  const sourceId = Number(
    (
      await db.one<{ id: string }>(
        // `source` records provenance and has no publication state of its own;
        // whether an entry is servable is `person_name.status`, set below.
        `insert into source (slug, name, url, license_code, license_url,
                             attribution_text, citation, notes, retrieved_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8, current_date)
         on conflict (slug) do update set
           name = excluded.name, url = excluded.url,
           license_code = excluded.license_code, license_url = excluded.license_url,
           attribution_text = excluded.attribution_text, citation = excluded.citation,
           notes = excluded.notes
         returning id`,
        [
          SOURCE.slug,
          SOURCE.name,
          SOURCE.url,
          SOURCE.licenseCode,
          SOURCE.licenseUrl,
          SOURCE.attributionText,
          SOURCE.citation,
          SOURCE.notes,
        ]
      )
    )?.id
  );

  // ---- rows ----
  interface Row {
    name: string;
    searchForm: string;
    slug: string;
    meaning: string;
    gender: string;
    variants: string[];
    externalId: string;
  }

  const bySlug = new Map<string, Row>();
  let skipped = 0;
  let merged = 0;

  for (const entry of raw) {
    const primary = tidyName(entry.names[0] ?? '');
    const meaning = tidyMeaning(entry.meaning ?? '');
    // A name with no meaning is not a dictionary entry; skip rather than store
    // a headword with an empty gloss.
    if (!primary || meaning.length === 0) {
      skipped += 1;
      continue;
    }

    const variants = entry.names.slice(1).map(tidyName).filter((v) => v.length > 0 && v !== primary);
    const forms = deriveForms(primary);

    // Gender, by the owner's two rules. The title morphemes win over 'unisex';
    // nothing else sets a gender, and the source's own value is never trusted
    // to invent a third one.
    const gendered = TITLE_MORPHEMES.test(primary) || variants.some((v) => TITLE_MORPHEMES.test(v));
    const gender = gendered ? 'male' : 'unisex';
    const slug = slugify(primary).slice(0, 80) || `name-${entry.number}`;

    const existing = bySlug.get(slug);
    if (existing) {
      // Two numbered entries can share a slug once folded (Kodiana/Kodiana).
      // Merge rather than collide on the unique index.
      merged += 1;
      existing.variants = [...new Set([...existing.variants, ...variants, primary])];
      if (!existing.meaning.includes(meaning)) existing.meaning += `; ${meaning}`;
      continue;
    }

    bySlug.set(slug, {
      name: primary,
      searchForm: forms.searchForm,
      slug,
      meaning,
      gender,
      variants,
      externalId: `x-nzemmili-${entry.number}`,
    });
  }

  const rows = [...bySlug.values()];
  log(`  entries read               ${raw.length}`);
  log(`  skipped (no meaning)       ${skipped}`);
  log(`  merged on slug collision   ${merged}`);
  log(`  rows to write              ${rows.length}`);

  // Replace this source's rows so a re-run is idempotent.
  await db.query(
    `delete from person_name where source_id = $1 and language_code = $2`,
    [sourceId, languageCode]
  );

  let inserted = 0;
  for (const row of rows) {
    const result = await db.query(
      `insert into person_name
         (language_code, name, search_form, slug, meaning, gender, variants,
          source_id, external_id, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published')
       on conflict (language_code, slug) do update set
         meaning = excluded.meaning,
         gender = excluded.gender,
         variants = excluded.variants,
         -- Publication state has to travel with the row. Without this an entry
         -- imported before the owner approved publication could never be
         -- published by re-running the importer: the delete above keys on
         -- source_id, and a row that survived it would keep its old status.
         status = excluded.status,
         source_id = excluded.source_id
       returning id`,
      [
        languageCode,
        row.name,
        row.searchForm,
        row.slug,
        row.meaning,
        row.gender,
        row.variants,
        sourceId,
        row.externalId,
      ]
    );
    if (result.rowCount > 0) inserted += 1;
  }

  const byGender: Record<string, number> = {};
  for (const row of rows) byGender[row.gender] = (byGender[row.gender] ?? 0) + 1;
  log(`  written                    ${inserted}`);
  log(`  by gender                  ${JSON.stringify(byGender)}`);

  return {
    read: raw.length,
    skippedNoMeaning: skipped,
    inserted,
    byGender,
    duplicatesMerged: merged,
    durationMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const report = await importNames();
  console.log();
  console.log(`  done in ${formatMs(report.durationMs)}`);
  await closeDb();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
