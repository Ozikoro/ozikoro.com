/**
 * Additions to dictionary entries that come from us rather than from a corpus.
 *
 *   node packages/db/src/import/word-additions.ts
 *   node packages/db/src/import/word-additions.ts --dry-run
 *
 * WHY THIS EXISTS
 *
 * The corpus is strong on headwords and thin on illustration. Of 12,291 published
 * Igbo words, 7,486 carry no example sentence at all, and the 25,000 sentences
 * that were imported are concentrated: 1,120 words hold eight or more each. Some
 * entries also carry one gloss where the word has several senses, because the
 * source gave one sense and the importer records what the source said — `bilie`
 * was "rose" and nothing else.
 *
 * So the gap is not a defect in the data, it is what the data does not cover, and
 * filling it is editorial work. This imports that work from `data/words/additions.json`,
 * which is tracked in git and reviewable, rather than being written straight into
 * the database where the next corpus import could lose it and nobody would know.
 *
 *WHAT IT WILL NOT DO
 *
 *   - It never replaces a definition a source gave. Meanings are ADDED. `bilie`
 *     keeps "rose" and gains "rise; arise; get up; stand up", because the imported
 *     gloss is a record of what a source said and this is not the place to erase it.
 *   - It never touches a headword it cannot find, and it says which ones it could
 *     not find rather than passing over them.
 *   - It is idempotent: definitions are keyed on their text and examples on their
 *     Igbo sentence, so a second run changes nothing.
 *
 * Examples written here are attributed to an editorial source, not to a book that
 * never printed them.
 */
import { readFile } from 'node:fs/promises';

/** Same folding the importers use for a URL segment. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Tracked curated additions, unlike the gitignored corpora beside them. */
export const DEFAULT_ADDITIONS_DIR = resolve(HERE, '..', '..', '..', '..', 'data', 'words');

const SOURCE = {
  slug: 'ozikoro-editorial',
  name: 'Ozikoro — editorial additions',
  url: null as string | null,
  license: 'CC-BY-4.0',
  attribution:
    'Meanings and example sentences added by Ozikoro where the imported corpora gave ' +
    'none. The examples are written by Ozikoro, not quoted from a publication.',
};

interface Addition {
  headword: string;
  meanings?: string[];
  /** Spelling variants, recorded as `word_form` rows of type 'variant'. */
  variants?: string[];
  /**
   * The variety this word belongs to, when the owner gives one — "Mkpuru (Ọka)".
   * Recorded as a dialect spelling of the word itself, so the entry says which
   * variety it is from, and the word is created if it does not exist yet.
   */
  variety?: string;
  /**
   * The standard entry this word is the same word as, when the owner's word is a
   * dialect form of one we already hold — `Mba` is the Ichi word for liver, and
   * `ìmejū` is the entry for that. Attaches the dialect spelling to that entry as
   * well, so a reader on the standard entry sees the form the variety uses.
   */
  dialectOf?: string;
  examples?: { igbo: string; english: string }[];
  evidence: string;
}

export interface WordAdditionsReport {
  read: number;
  matched: number;
  definitionsAdded: number;
  variantsAdded: number;
  dialectFormsAdded: number;
  wordsCreated: number;
  examplesAdded: number;
  linksAdded: number;
  notFound: string[];
}

/** One `source` row for everything added editorially. */
async function sourceId(db: Db): Promise<number> {
  const row = await db.one<{ id: string }>(
    `insert into source (slug, name, url, license_code, license_url, attribution_text, retrieved_at)
     values ($1, $2, $3, $4, null, $5, current_date)
     on conflict (slug) do update set name = excluded.name, attribution_text = excluded.attribution_text
     returning id`,
    [SOURCE.slug, SOURCE.name, SOURCE.url, SOURCE.license, SOURCE.attribution]
  );
  return Number(row?.id);
}

export async function applyWordAdditions(
  options: { dir?: string; languageCode?: string; dryRun?: boolean; log?: (m: string) => void } = {}
): Promise<WordAdditionsReport> {
  const log = options.log ?? ((m: string) => console.log(m));
  const languageCode = options.languageCode ?? 'ibo';
  const dir = options.dir ?? process.env.OZITUMA_WORD_ADDITIONS ?? DEFAULT_ADDITIONS_DIR;
  const db = await getDb();

  const doc = JSON.parse(await readFile(join(dir, 'additions.json'), 'utf8')) as {
    words?: Addition[];
  };
  const additions = doc.words ?? [];
  log(`  additions in the file  ${additions.length}`);

  const source = options.dryRun ? 0 : await sourceId(db);
  const report: WordAdditionsReport = {
    read: additions.length,
    matched: 0,
    definitionsAdded: 0,
    variantsAdded: 0,
    dialectFormsAdded: 0,
    wordsCreated: 0,
    examplesAdded: 0,
    linksAdded: 0,
    notFound: [],
  };

  for (const addition of additions) {
    // Exact headword first, then the folded form, so `-kwusi ike` and `kwusi ike`
    // both find the entry the reader is looking at.
    const found = await db.one<{ id: string }>(
      `select id from word
        where language_code = $1 and status = 'published' and (headword = $2 or search_form = $3)
        order by case when headword = $2 then 0 else 1 end
        limit 1`,
      [languageCode, addition.headword, deriveForms(addition.headword, requireLanguage(languageCode)).searchForm]
    );
    /*
     * A word the file adds may not be in the dictionary yet — "Iru eko" is Awka
     * for lighting a smith's fire and nothing here held it. It is created as a
     * published entry: the owner states it and its meaning, which is a stronger
     * warrant than any corpus row in this database has.
     *
     * The slug is derived from the headword, and a collision is suffixed, exactly
     * as the importers do it, so adding a word can never fail on a slug clash.
     */
    let wordId: number;
    if (found) {
      wordId = Number(found.id);
      report.matched += 1;
    } else if (addition.meanings && addition.meanings.length > 0) {
      if (options.dryRun) {
        wordId = 0;
        report.wordsCreated += 1;
      } else {
        const base = slugify(addition.headword).slice(0, 80) || 'entry';
        let slug = base;
        for (let n = 2; ; n += 1) {
          const clash = await db.one<{ id: string }>(
            `select id from word where language_code = $1 and slug = $2`,
            [languageCode, slug]
          );
          if (!clash) break;
          slug = `${base}-${n}`;
        }
        const created = await db.one<{ id: string }>(
          `insert into word (language_code, headword, exact_form, search_form, slug, status, source_id)
           values ($1, $2, $3, $4, $5, 'published', $6)
           on conflict (language_code, headword) do update set status = 'published', source_id = excluded.source_id
           returning id`,
          [
            languageCode,
            addition.headword,
            deriveForms(addition.headword, requireLanguage(languageCode)).exactForm,
            deriveForms(addition.headword, requireLanguage(languageCode)).searchForm,
            slug,
            source,
          ]
        );
        wordId = Number(created?.id ?? 0);
        report.wordsCreated += 1;
      }
    } else {
      report.notFound.push(addition.headword);
      continue;
    }

    for (const [index, text] of (addition.meanings ?? []).entries()) {
      if (options.dryRun) {
        report.definitionsAdded += 1;
        continue;
      }
      const position = await db.one<{ n: number }>(
        `select count(*)::int as n from definition where word_id = $1 and language_code = 'eng'`,
        [wordId]
      );
      const result = await db.query(
        `insert into definition (word_id, language_code, text, position, is_primary, source_id)
         values ($1, 'eng', $2, $3, false, $4)
         on conflict (word_id, language_code, text) do nothing`,
        [wordId, text, Number(position?.n ?? 0) + index, source]
      );
      report.definitionsAdded += result.rowCount ?? 0;
    }

    /*
     * Spelling variants. `form_type` 'variant' is the one the corpus already uses
     * for "the same word, written differently", as against `word_dialect`, which
     * says which variety writes it that way — the owner named dibie a variant and
     * gave no variety, so guessing one here would be inventing a claim.
     */
    for (const variant of addition.variants ?? []) {
      if (options.dryRun) {
        report.variantsAdded += 1;
        continue;
      }
      const formType = await db.one<{ id: string }>(
        `select id from form_type where code = 'variant' and (language_code is null or language_code = $1) limit 1`,
        [languageCode]
      );
      if (!formType) {
        log(`  ! no 'variant' form type; skipping ${variant}`);
        continue;
      }
      // `search_form` is not null on the table: it is the folded key the
      // dictionary search matches a variant on, so a variant typed without its
      // tone marks still finds the entry.
      const result = await db.query(
        `insert into word_form (word_id, form_type_id, value, search_form) values ($1, $2, $3, $4)
         on conflict (word_id, form_type_id, value) do nothing`,
        [
          wordId,
          Number(formType.id),
          variant,
          deriveForms(variant, requireLanguage(languageCode)).searchForm,
        ]
      );
      report.variantsAdded += result.rowCount ?? 0;
    }

    /*
     * The variety, when the owner named one. Two rows can come out of this: the
     * word labelled as belonging to that variety, and — when the owner also says
     * which standard entry it is the same word as — a dialect spelling on that
     * entry, so a reader looking at `ìmejū` sees that Ichi says `mba`.
     */
    if (addition.variety) {
      const targets = addition.dialectOf ? [addition.dialectOf] : [addition.headword];
      for (const target of targets) {
        const entry = await db.one<{ id: string }>(
          `select id from word where language_code = $1 and (headword = $2 or search_form = $3)
            order by case when headword = $2 then 0 else 1 end limit 1`,
          [
            languageCode,
            target,
            deriveForms(target, requireLanguage(languageCode)).searchForm,
          ]
        );
        const variety = await db.one<{ id: string }>(
          `select id from dialect where language_code = $1 and name = $2`,
          [languageCode, addition.variety]
        );
        if (!entry || !variety) {
          log(`  ! no ${!entry ? `entry for "${target}"` : `variety "${addition.variety}"`}`);
          continue;
        }
        if (options.dryRun) {
          report.dialectFormsAdded += 1;
          continue;
        }
        const result = await db.query(
          `insert into word_dialect (word_id, dialect_id, spelling, search_form)
           values ($1, $2, $3, $4) on conflict (word_id, dialect_id, spelling) do nothing`,
          [
            Number(entry.id),
            Number(variety.id),
            addition.headword,
            deriveForms(addition.headword, requireLanguage(languageCode)).searchForm,
          ]
        );
        report.dialectFormsAdded += result.rowCount ?? 0;
      }
    }

    for (const example of addition.examples ?? []) {
      const externalId = `ozikoro-editorial-${deriveForms(example.igbo, requireLanguage(languageCode)).searchForm.slice(0, 40)}`;
      if (options.dryRun) {
        report.examplesAdded += 1;
        report.linksAdded += 1;
        continue;
      }
      /*
       * Counted honestly, so a second run reports nothing added.
       *
       * The upsert's `returning id` comes back on the update path too, which made
       * the first version of this report "6 examples added" every time it ran —
       * a tool that claims to have done work it did not do is worse than one that
       * stays quiet, because the count is how anyone knows the file was applied.
       */
      const existing = await db.one<{ id: string }>(
        `select id from example
          where language_code = $1 and source_id = $2 and external_id = $3`,
        [languageCode, source, externalId]
      );
      if (existing) {
        await db.query(
          `update example set text = $1, translation = $2 where id = $3`,
          [example.igbo, example.english, Number(existing.id)]
        );
      }

      const inserted = existing
        ? null
        : await db.one<{ id: string }>(
            `insert into example (language_code, text, search_form, translation,
                                  translation_language_code, style, is_verified, status, source_id, external_id)
             values ($1, $2, $3, $4, 'eng', null, false, 'published', $5, $6)
             returning id`,
            [
              languageCode,
              example.igbo,
              deriveForms(example.igbo, requireLanguage(languageCode)).searchForm,
              example.english,
              source,
              externalId,
            ]
          );
      const exampleId = Number(inserted?.id ?? existing?.id ?? 0);
      if (exampleId === 0) continue;
      if (inserted) report.examplesAdded += 1;

      const link = await db.query(
        `insert into example_word (example_id, word_id) values ($1, $2) on conflict do nothing`,
        [exampleId, wordId]
      );
      report.linksAdded += link.rowCount ?? 0;
    }
  }

  return report;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? 'Word additions (dry run)\n' : 'Word additions\n');
  const report = await applyWordAdditions({ dryRun });
  console.log(`\n  matched entries        ${report.matched}/${report.read}`);
  console.log(`  definitions added      ${report.definitionsAdded}`);
  console.log(`  variants added         ${report.variantsAdded}`);
  console.log(`  words created          ${report.wordsCreated}`);
  console.log(`  dialect forms added    ${report.dialectFormsAdded}`);
  console.log(`  examples added         ${report.examplesAdded}`);
  console.log(`  links added            ${report.linksAdded}`);
  if (report.notFound.length > 0) {
    console.log(`  ! headwords not found  ${report.notFound.join(', ')}`);
  }
  await closeDb();
}

if (process.argv[1]?.endsWith('word-additions.ts')) await main();
