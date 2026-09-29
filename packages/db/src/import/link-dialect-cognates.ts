/**
 * Attach a dialect's words to the standard-language entries they translate.
 *
 *   node packages/db/src/import/link-dialect-cognates.ts            # report only
 *   node packages/db/src/import/link-dialect-cognates.ts --apply
 *
 * THE PROBLEM THIS SOLVES
 *
 * Importing a dialect dictionary — the Ekpeye one, so far — creates a row for
 * every headword and labels each one as belonging to that variety. What it does
 * NOT do is connect the dialect word to the Igbo word it means. So the database
 * held Ekpeye `da` ("father") and `ino` ("mother") while `/word/igbo/nna` and
 * `/word/igbo/nne` showed no Ekpeye form at all, and the owner, looking at those
 * pages, concluded the Ekpeye dictionary had never been imported. It had: 872
 * headwords and 1,230 senses, as drafts, joined to nothing.
 *
 * HOW A LINK IS DECIDED
 *
 * By MEANING, one sense at a time, and only when the sense is unambiguous:
 *
 *   - the dialect entry's senses are compared against the published English
 *     definitions of the standard language, after folding case and punctuation
 *     and dropping parentheticals;
 *   - a sense counts only if it is at least four characters long, so `be`, `go`
 *     and `do` cannot attach a dialect word to forty entries;
 *   - and it must match EXACTLY ONE published word. `da` means both "fall" and
 *     "father": "fall" matches several Igbo entries and is dropped, while
 *     "father" matches `nnà` alone and is kept. Comparing whole words instead of
 *     senses lost that case, which is why this works per sense.
 *
 * Anything ambiguous is reported rather than guessed. 167 of 872 Ekpeye headwords
 * can be linked this way; the other 705 mean something no published Igbo entry in
 * this dictionary covers, or cover it ambiguously, and inventing a link for them
 * would be inventing a claim about the language.
 *
 * The dialect spellings are attached to the PUBLISHED standard entry, so they
 * appear in a reader's Dialect section. The dialect words themselves stay drafts:
 * their source states no licence, and that is a separate decision from whether
 * the forms belong on the pages they translate.
 */
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage } from '@ozituma/core';
import { closeDb, getDb } from '../client.ts';
import { DEFAULT_LANGUAGE } from '../repository.ts';

/** Senses shorter than this are too generic to identify a word. */
const MIN_SENSE = 4;

function foldSense(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sensesOf(joined: string): string[] {
  return joined
    .split(/[|;]/)
    .map(foldSense)
    .filter((sense) => sense.length >= MIN_SENSE);
}

export interface LinkReport {
  dialectWords: number;
  linked: number;
  links: number;
  ambiguousOnly: number;
  unmatched: number;
  dryRun: boolean;
  examples: string[];
}

export async function linkDialectCognates(
  options: {
    languageCode?: string;
    sourceSlug?: string;
    dialectCode?: string;
    apply?: boolean;
    log?: (m: string) => void;
  } = {}
): Promise<LinkReport> {
  const log = options.log ?? ((m: string) => console.log(m));
  const languageCode = options.languageCode ?? DEFAULT_LANGUAGE;
  const sourceSlug = options.sourceSlug ?? 'blench-ekpeye';
  const dialectCode = options.dialectCode ?? 'EKP';
  const db = await getDb();

  const dialect = await db.rows<{ id: string; headword: string; defs: string }>(
    `select w.id, w.headword,
            coalesce((select string_agg(d.text, ' | ' order by d.position)
                        from definition d where d.word_id = w.id), '') as defs
       from word w
       join source s on s.id = w.source_id
      where s.slug = $1 and w.language_code = $2
      order by w.headword`,
    [sourceSlug, languageCode]
  );

  const standard = await db.rows<{
    id: string;
    headword: string;
    search_form: string;
    defs: string;
  }>(
    `select w.id, w.headword, w.search_form,
            coalesce((select string_agg(d.text, ' || ' order by d.position)
                        from definition d where d.word_id = w.id), '') as defs
       from word w
      where w.language_code = $1 and w.status = 'published'
        and not exists (select 1 from source s where s.id = w.source_id and s.slug = $2)`,
    [languageCode, sourceSlug]
  );

  // sense -> the published entries that carry exactly that sense
  const bySense = new Map<string, Map<number, { headword: string; key: string }>>();
  for (const row of standard) {
    for (const part of row.defs.split('||')) {
      for (const sense of sensesOf(part)) {
        const bucket = bySense.get(sense) ?? new Map();
        bucket.set(Number(row.id), { headword: row.headword, key: row.search_form });
        bySense.set(sense, bucket);
      }
    }
  }

  const dialectRow = await db.one<{ id: string }>(`select id from dialect where code = $1`, [
    dialectCode,
  ]);
  if (!dialectRow) throw new Error(`No dialect with code ${dialectCode}`);

  let linked = 0;
  let links = 0;
  let ambiguousOnly = 0;
  let unmatched = 0;
  const examples: string[] = [];

  for (const word of dialect) {
    const found = new Map<number, string>();
    let ambiguous = 0;
    for (const sense of sensesOf(word.defs)) {
      const bucket = bySense.get(sense);
      if (!bucket || bucket.size === 0) continue;
      /*
       * SEVERAL ENTRIES FOR ONE SENSE ARE OFTEN ONE WORD, NOT SEVERAL.
       *
       * `mother` is defined by both `nne` and `nnē` — the same word with a tone
       * mark added — so treating the sense as ambiguous lost the Ekpeye word for
       * mother entirely, which is one of the two cases the owner named. When
       * every candidate folds to the same key they ARE one word, and the dialect
       * spelling belongs on each of its entries. When they fold differently the
       * sense genuinely names more than one word, and it is dropped.
       */
      const keys = new Set([...bucket.values()].map((candidate) => candidate.key));
      if (keys.size === 1) {
        for (const id of bucket.keys()) found.set(id, sense);
      } else {
        ambiguous += 1;
      }
    }

    if (found.size === 0) {
      if (ambiguous > 0) ambiguousOnly += 1;
      else unmatched += 1;
      continue;
    }

    linked += 1;
    for (const [wordId, sense] of found) {
      if (examples.length < 12) {
        examples.push(`${word.headword} (${word.defs.slice(0, 30)}) → ${sense}`);
      }
      if (!options.apply) {
        links += 1;
        continue;
      }
      // `search_form` is not null: it is the folded key the dictionary search
      // matches a dialect spelling on, so a reader who types `da` without its
      // marks still reaches the entry that carries it.
      const result = await db.query(
        `insert into word_dialect (word_id, dialect_id, spelling, search_form)
         values ($1, $2, $3, $4)
         on conflict (word_id, dialect_id, spelling) do nothing`,
        [
          wordId,
          Number(dialectRow.id),
          word.headword,
          deriveForms(word.headword, requireLanguage(languageCode)).searchForm,
        ]
      );
      links += result.rowCount ?? 0;
    }
  }

  log(`  dialect headwords        ${dialect.length}`);
  log(`  linked to a standard entry ${linked}`);
  log(`  links written            ${links}${options.apply ? '' : ' (dry run)'}`);
  log(`  ambiguous only, skipped  ${ambiguousOnly}`);
  log(`  no matching sense        ${unmatched}`);
  for (const example of examples) log(`    ${example}`);

  return {
    dialectWords: dialect.length,
    linked,
    links,
    ambiguousOnly,
    unmatched,
    dryRun: !options.apply,
    examples,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`Link dialect words to the entries they translate${apply ? '' : ' (dry run)'}\n`);
  await linkDialectCognates({ apply });
  await closeDb();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
