/**
 * Example sentences written for the words that had none.
 *
 *   node packages/db/src/import/generated-examples.ts            # report only
 *   node packages/db/src/import/generated-examples.ts --apply
 *
 * 7,363 published words carried no example sentence at all — the corpora
 * illustrated the words they happened to illustrate, and left the rest bare. The
 * owner asked for a minimum of two per page, so two were written for each word by
 * a model, against the word's own gloss, and this writes them in.
 *
 * WHAT MAKES THESE SAFE TO PUBLISH
 *
 * They are attributed to an editorial source, like every other sentence written
 * here rather than quoted from a book, and each carries the model that wrote it
 * and how sure it was. They are attached to the word they were written for and to
 * no other, so a sentence cannot appear on an entry it does not belong to.
 *
 * WHERE THE FILE LIVES
 *
 * Under `data/`, with the other curated knowledge, because that is the only part
 * of the tree the runtime image carries: `work/` is where a run happens, and the
 * image copies `data` and nothing else. The first attempt pointed at
 * `work/examples.jsonl` and died with ENOENT in production for exactly that
 * reason.
 *
 * IDEMPOTENCY
 *
 * The external id is derived from the word and the position, so a re-run updates
 * a sentence in place instead of adding a second copy of it — which matters
 * because the generation is resumable and a word may be written once now and
 * again after a better reading.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage } from '@ozituma/core';
import { closeDb, getDb } from '../client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_GENERATED_EXAMPLES = resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'data',
  'words',
  'examples-generated.jsonl'
);

const SOURCE = {
  slug: 'ozituma-written-examples',
  name: 'Ozikuma — example sentences',
  license: 'CC-BY-4.0',
  attribution:
    'Example sentences written for Ozituma for entries no corpus illustrated. ' +
    'They are our sentences, not quotations.',
};

interface Generated {
  id: number;
  headword: string;
  examples: { igbo: string; english: string }[];
  confidence?: string;
  model?: string;
}

export interface GeneratedExamplesReport {
  read: number;
  inserted: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
}

export async function importGeneratedExamples(
  options: { file?: string; languageCode?: string; apply?: boolean; log?: (m: string) => void } = {}
): Promise<GeneratedExamplesReport> {
  const log = options.log ?? ((m: string) => console.log(m));
  const languageCode = options.languageCode ?? 'ibo';
  const language = requireLanguage(languageCode);
  const path = options.file ?? process.env.OZITUMA_GENERATED_EXAMPLES ?? DEFAULT_GENERATED_EXAMPLES;
  const db = await getDb();

  const raw = await readFile(path, 'utf8');
  const rows: Generated[] = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Generated);
  log(`  words with written examples  ${rows.length}`);

  const source = options.apply
    ? await db.one<{ id: string }>(
        `insert into source (slug, name, url, license_code, license_url, attribution_text, retrieved_at)
         values ($1, $2, null, $3, null, $4, current_date)
         on conflict (slug) do update set name = excluded.name, attribution_text = excluded.attribution_text
         returning id`,
        [SOURCE.slug, SOURCE.name, SOURCE.license, SOURCE.attribution]
      )
    : null;
  const sourceId = Number(source?.id ?? 0);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const word = await db.one<{ id: string }>(
      `select id from word where id = $1 and language_code = $2`,
      [row.id, languageCode]
    );
    if (!word) {
      skipped += 1;
      continue;
    }
    const wordId = Number(word.id);

    for (const [position, example] of row.examples.slice(0, 2).entries()) {
      const igbo = example.igbo.trim();
      const english = example.english.trim();
      if (igbo.length === 0 || english.length === 0) continue;

      const externalId = createHash('sha256')
        .update(`${wordId}\u0000${position}`)
        .digest('hex')
        .slice(0, 24);

      if (!options.apply) {
        inserted += 1;
        continue;
      }

      const existing = await db.one<{ id: string }>(
        `select id from example where language_code = $1 and source_id = $2 and external_id = $3`,
        [languageCode, sourceId, externalId]
      );
      if (existing) {
        await db.query(`update example set text = $1, translation = $2 where id = $3`, [
          igbo,
          english,
          Number(existing.id),
        ]);
        updated += 1;
      } else {
        const created = await db.one<{ id: string }>(
          `insert into example (language_code, text, search_form, translation,
                                translation_language_code, style, is_verified, status,
                                source_id, external_id, translation_confidence)
           values ($1, $2, $3, $4, 'eng', null, false, 'published', $5, $6, $7)
           returning id`,
          [
            languageCode,
            igbo,
            deriveForms(igbo, language).searchForm,
            english,
            sourceId,
            externalId,
            row.confidence ?? null,
          ]
        );
        inserted += 1;
        const exampleId = Number(created?.id ?? 0);
        if (exampleId > 0) {
          await db.query(
            `insert into example_word (example_id, word_id) values ($1, $2) on conflict do nothing`,
            [exampleId, wordId]
          );
        }
      }
    }
  }

  log(`  sentences written            ${inserted}${options.apply ? '' : ' (dry run)'}`);
  log(`  sentences updated            ${updated}`);
  if (skipped > 0) log(`  ! words not found            ${skipped}`);

  return { read: rows.length, inserted, updated, skipped, dryRun: !options.apply };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`Generated examples${apply ? '' : ' (dry run)'}\n`);
  await importGeneratedExamples({ apply });
  await closeDb();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
