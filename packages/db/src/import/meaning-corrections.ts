/**
 * Corrections to the dictionary's English glosses, from the verification pass.
 *
 *   node packages/db/src/import/meaning-corrections.ts            # report only
 *   node packages/db/src/import/meaning-corrections.ts --apply
 *
 * `data/words/meaning-corrections.json` is tracked in git. It is the one place a
 * person can read what the machine changed about a meaning, and change it back.
 *
 * WHY THE GLOSS IS CORRECTED RATHER THAN THE QUIZ FILTERED
 *
 * The practice quiz reads the same definitions the entry page shows. Filtering
 * wrong senses out of the quiz would leave the entry page still wrong, and would
 * leave the wrongness invisible — the reader who never opens the quiz would never
 * see it. So a correction is applied to the definition itself, and the entry page,
 * the API and the quiz all improve together.
 *
 * WHAT IS NOT TOUCHED
 *
 * A corrected gloss is only written where the definition still says exactly what
 * the verification saw. If a source has since changed it, or the row has moved,
 * the correction is reported as unmatched rather than applied blind.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb } from '../client.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CORRECTIONS = resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'data',
  'words',
  'meaning-corrections.json'
);

interface Correction {
  headword: string;
  /** The gloss as it was, so the update can refuse to touch a changed row. */
  previous: string;
  /** The gloss as it should be. Empty entries are the ones taken out of the quiz. */
  correction?: string;
  verdict?: string;
  note?: string;
}

export interface MeaningCorrectionReport {
  read: number;
  corrected: number;
  quarantined: number;
  merged: number;
  unmatched: { headword: string; previous: string }[];
  dryRun: boolean;
}

export async function applyMeaningCorrections(
  options: { file?: string; apply?: boolean; log?: (m: string) => void } = {}
): Promise<MeaningCorrectionReport> {
  const log = options.log ?? ((m: string) => console.log(m));
  const path = options.file ?? process.env.OZITUMA_MEANING_CORRECTIONS ?? DEFAULT_CORRECTIONS;
  const doc = JSON.parse(await readFile(path, 'utf8')) as { corrections?: Correction[] };
  const corrections = doc.corrections ?? [];
  const db = await getDb();
  log(`  corrections in the file   ${corrections.length}`);

  let corrected = 0;
  let quarantined = 0;
  let merged = 0;
  const unmatched: { headword: string; previous: string }[] = [];

  for (const entry of corrections) {
    const rows = await db.rows<{ id: string }>(
      `select d.id
         from definition d
         join word w on w.id = d.word_id
        where w.language_code = 'ibo' and w.headword = $1 and d.text = $2`,
      [entry.headword, entry.previous]
    );
    if (rows.length === 0) {
      unmatched.push({ headword: entry.headword, previous: entry.previous });
      continue;
    }
    const next = (entry.correction ?? '').trim();
    for (const row of rows) {
      if (options.apply) {
        if (next.length > 0) {
          /*
           * A correction can collide with a sense the word already has — two
           * glosses that both become "limp", say. `definition` is unique on
           * (word, language, text), so the update would fail; the honest fix is
           * that the word then has ONE sense saying that, not two, so the stale
           * row is removed instead.
           */
          const clash = await db.one<{ id: string }>(
            `select id from definition
              where word_id = (select word_id from definition where id = $1)
                and language_code = 'eng' and text = $2 and id <> $1`,
            [Number(row.id), next]
          );
          if (clash) {
            await db.query(`delete from definition where id = $1`, [Number(row.id)]);
            merged += 1;
          } else {
            // The sense is right once corrected, so it stays in the quiz.
            await db.query(
              `update definition set text = $1, practice_ok = true where id = $2`,
              [next, Number(row.id)]
            );
            corrected += 1;
          }
        } else {
          await db.query(`update definition set practice_ok = false where id = $1`, [
            Number(row.id),
          ]);
          quarantined += 1;
        }
      } else if (next.length > 0) {
        corrected += 1;
      } else {
        quarantined += 1;
      }
    }
  }

  log(`  glosses corrected         ${corrected}${options.apply ? '' : ' (dry run)'}`);
  log(`  merged into a sense the word already had  ${merged}`);
  log(`  senses taken out of quiz  ${quarantined}${options.apply ? '' : ' (dry run)'}`);
  if (unmatched.length > 0) {
    log(`  ! no longer present (${unmatched.length}): ${unmatched.slice(0, 4).map((u) => u.headword).join(', ')}`);
  }

  return { read: corrections.length, corrected, quarantined, merged, unmatched, dryRun: !options.apply };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`Meaning corrections${apply ? '' : ' (dry run)'}\n`);
  await applyMeaningCorrections({ apply });
  await closeDb();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
