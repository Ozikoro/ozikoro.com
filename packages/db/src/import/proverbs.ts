/**
 * Igbo proverbs — ìlù — as dictionary examples.
 *
 *   node packages/db/src/import/proverbs.ts
 *
 * WHY PROVERBS ARE `example` ROWS
 *
 * `example.style` has always documented 'proverb' as one of its values, and a
 * proverb is exactly what the table describes: a piece of Igbo with a
 * translation, attached to the words it contains. A separate table would
 * duplicate the translation, search indexing and linking this one already has.
 *
 * WHY EVERY PROVERB IS LINKED TO A WORD
 *
 * The integrity gate refuses to let unlinked examples exceed 10% of the total —
 * a check that exists because a real bug once produced 652 silent orphans. So
 * the importer matches each proverb's words against the dictionary and links
 * them, and reports what it could not place. Measured on the collected corpus:
 * **1,813 of 1,821 proverbs (99.6%) match at least one headword**, so the
 * unlinked residue is 0.4%.
 *
 * THE DATA IS SCRAPED AND GITIGNORED
 *
 * `data/sources/proverbs/proverbs.json` holds 1,821 proverbs collected from 25
 * sources, most of which state no licence. They are imported on the same footing
 * as the name lists: at the owner's direction, with the licence recorded as
 * `unknown` rather than upgraded to something nobody granted, and with the
 * source recorded on every row. Each source becomes a `source` row, which is
 * what keeps the provenance travel with the text.
 *
 * TRANSLATIONS
 *
 * 632 proverbs carry the translation their source gave. The other 1,189 carry
 * `english: null` and land with a null translation rather than an invented one:
 * a machine-drafted rendering of an Igbo proverb presented as dictionary content
 * would be worse than an empty field, because a reader has no way to tell the
 * difference. Those are waiting on a decision about how, or whether, to
 * translate them.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveForms, requireLanguage } from '@ozituma/core';
import { closeDb, getDb, type Db } from '../client.ts';
import { formatMs, insertMany } from './corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Scraped third-party text; gitignored, like every other corpus. */
export const DEFAULT_PROVERBS_DIR = resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'data',
  'sources',
  'proverbs'
);

interface RawProverb {
  igbo: string;
  english: string | null;
  literal?: string | null;
  meaning?: string | null;
  usage?: string | null;
  dialect?: string | null;
  theme?: string | null;
  confidence?: string | null;
  source: string;
  url: string;
  needsTranslation?: boolean;
  alsoSeenAt?: { source: string; url: string; spelling?: string }[];
}

/**
 * The curated proverbs file, tracked in git.
 *
 * Unlike `data/sources/proverbs/`, which is a scraped corpus, this one holds
 * proverbs that were READ and CORRECTED by hand: Thomas (1914) as it came out of
 * a damaged scan, restored to standard Igbo against the English he printed under
 * each one. It is tracked for the same reason the name knowledge and the proverb
 * renderings are — a correction that lives only in a database is a correction
 * nobody can review.
 *
 * These entries carry more than the corpus does (a usage note, the town the
 * proverb was collected in, a theme, and how settled the reading is), so they are
 * written through the longer insert further down.
 */
export const DEFAULT_CURATED_PROVERBS = resolve(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'data',
  'proverbs',
  'thomas-part6.json'
);

export interface ProverbImportReport {
  read: number;
  inserted: number;
  alreadyPresent: number;
  withTranslation: number;
  withoutTranslation: number;
  linked: number;
  unlinked: number;
  links: number;
  sources: number;
  durationMs: number;
}

/** The same folding the matcher and the dictionary agree on. */
function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A stable id per proverb, so a re-run updates rather than duplicates. */
function externalIdFor(slugOfSource: string, igbo: string): string {
  return createHash('sha256').update(`${slugOfSource}\u0000${normalise(igbo)}`).digest('hex').slice(0, 24);
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * How many words one proverb may attach to.
 *
 * A proverb contains half a dozen common words, and linking all of them is
 * correct but pointless: the entry page shows two examples, and 14,000 links
 * spread across 3,000 words serves nobody. The cap keeps the fan-out bounded
 * while still guaranteeing the link the gate requires.
 */
const MAX_LINKS_PER_PROVERB = 8;

export async function importProverbs(
  options: { dir?: string; curated?: string; languageCode?: string; log?: (m: string) => void } = {}
): Promise<ProverbImportReport> {
  const started = Date.now();
  const languageCode = options.languageCode ?? 'ibo';
  const dir = options.dir ?? process.env.OZITUMA_PROVERBS_SOURCE ?? DEFAULT_PROVERBS_DIR;
  const log = options.log ?? ((m: string) => console.log(m));
  const db = await getDb();
  const language = requireLanguage(languageCode);

  const raw = JSON.parse(await readFile(join(dir, 'proverbs.json'), 'utf8')) as {
    proverbs: RawProverb[];
  };
  const proverbs = raw.proverbs ?? [];
  log(`  proverbs in the file               ${proverbs.length}`);

  /*
   * The curated file is added to the corpus rather than replacing it. Its
   * proverbs go through the same pipeline — same de-duplication by external id,
   * same word linking — and differ only in that they carry a usage note, a home
   * town, a theme and a confidence.
   */
  const curatedPath = options.curated ?? process.env.OZITUMA_CURATED_PROVERBS ?? DEFAULT_CURATED_PROVERBS;
  const curated: RawProverb[] = [];
  try {
    const doc = JSON.parse(await readFile(curatedPath, 'utf8')) as { proverbs?: RawProverb[] };
    curated.push(...(doc.proverbs ?? []));
    log(`  curated proverbs                   ${curated.length} (${curatedPath.split('/').pop()})`);
  } catch {
    log('  curated proverbs                   none (file not present)');
  }
  const all = curated.length > 0 ? [...proverbs, ...curated] : proverbs;

  // --- One source row per named source -----------------------------------
  const sourceNames = [...new Set(all.map((p) => p.source).filter(Boolean))];
  const sourceIds = new Map<string, number>();
  for (const name of sourceNames) {
    const url = all.find((p) => p.source === name)?.url ?? null;
    const id = Number(
      (
        await db.one<{ id: string }>(
          `insert into source (slug, name, url, license_code, license_url,
                               attribution_text, citation, notes, retrieved_at)
           values ($1,$2,$3,'unknown',null,$4,null,$5, current_date)
           on conflict (slug) do update set name = excluded.name, url = excluded.url
           returning id`,
          [
            slugify(name),
            name,
            url,
            `Igbo proverbs collected from ${name}.`,
            'No licence is stated on the source page. Imported at the owner\u2019s direction; ' +
              'the licence is recorded as unknown rather than asserted.',
          ]
        )
      )?.id
    );
    sourceIds.set(name, id);
  }
  log(`  sources                            ${sourceIds.size}`);

  // --- The word lookup the linker uses -----------------------------------
  const wordRows = await db.rows<{ id: string; headword: string }>(
    `select id, headword from word where language_code = $1 and status = 'published'`,
    [languageCode]
  );
  const singleWord = new Map<string, number>();
  const multiWord: { id: number; n: string }[] = [];
  for (const row of wordRows) {
    const n = normalise(row.headword);
    if (n.length === 0) continue;
    if (n.includes(' ')) multiWord.push({ id: Number(row.id), n });
    else if (n.length >= 2 && !singleWord.has(n)) singleWord.set(n, Number(row.id));
  }
  log(`  dictionary words to match against   ${wordRows.length}`);

  /*
   * One row per proverb, not one per source.
   *
   * The corpus overlaps the proverbs already in the table — the same saying
   * collected twice from two websites — and the external_id below only guards
   * against the SAME source being imported twice. Without this, a re-run added
   * 1,189 rows that said exactly what 1,189 existing rows said: to a reader a
   * proverb with no English beside one that has it, which is the shape of bug
   * nobody reports because both halves look plausible.
   */
  const existingTexts = new Set(
    (
      await db.rows<{ text: string }>(
        `select text from example where style = 'proverb' and language_code = $1`,
        [languageCode]
      )
    ).map((row) => normalise(row.text))
  );
  log(`  proverbs already in the table       ${existingTexts.size}`);

  // --- Examples ----------------------------------------------------------
  let withTranslation = 0;
  let withoutTranslation = 0;
  let inserted = 0;
  let alreadyHeld = 0;

  interface Pending {
    id: number;
    igbo: string;
  }
  const pending: Pending[] = [];

  for (const proverb of all) {
    const text = proverb.igbo.trim();
    if (text.length === 0) continue;
    const folded = normalise(text);
    if (existingTexts.has(folded)) {
      alreadyHeld += 1;
      continue;
    }
    existingTexts.add(folded);
    const sourceId = sourceIds.get(proverb.source) ?? null;

    // `literal` and the source's own note are folded into the translation slot
    // only when there is a translation to attach them to; a literal gloss with
    // no translation is not a translation.
    const english = proverb.english?.trim() || null;
    if (english) withTranslation += 1;
    else withoutTranslation += 1;

    const externalId = externalIdFor(slugify(proverb.source), text);

    /*
     * A reading that is not settled does not go on the site.
     *
     * The Thomas proverbs were restored from a scan that mangles the Igbo, and
     * the restoration pass marked 214 of them low confidence — where a word had
     * to be inferred, or the line is fragmentary. An English rendering marked
     * uncertain is a judgement a reader can weigh; an IGBO TEXT that may not be
     * the proverb is a different thing, because it is presented as the entry
     * itself. So those are imported as drafts: held, searchable by an editor,
     * and visible to nobody else until someone confirms them.
     */
    /*
     * `confidence` in the scraped corpus means something else entirely — it is
     * 'published', 'not-found' or 'corpus', a note on where the ENGLISH came
     * from — and writing it into translation_confidence failed the column's
     * check constraint on the first run. Only the three values this column
     * means are carried over; anything else is no confidence at all.
     */
    const confidence =
      proverb.confidence === 'high' || proverb.confidence === 'medium' || proverb.confidence === 'low'
        ? proverb.confidence
        : null;
    const status = confidence === 'low' ? 'draft' : 'published';
    const row = await db.one<{ id: string }>(
      `insert into example (language_code, text, search_form, translation,
                            translation_language_code, style, is_verified,
                            status, source_id, external_id,
                            usage_note, theme, translation_confidence)
       values ($1,$2,$3,$4,$5,'proverb',false,$11,$6,$7,$8,$9,$10)
       -- The unique index is partial: it has a WHERE external_id IS NOT NULL
       -- predicate. A conflict target must carry the same predicate or Postgres
       -- cannot match it to an index, so this cannot be shortened.
       on conflict (language_code, source_id, external_id) where external_id is not null
       do update set
         text = excluded.text, search_form = excluded.search_form,
         translation = excluded.translation,
         usage_note = coalesce(excluded.usage_note, example.usage_note),
         theme = coalesce(excluded.theme, example.theme),
         translation_confidence = coalesce(excluded.translation_confidence, example.translation_confidence)
       returning id`,
      [
        languageCode,
        text,
        deriveForms(text, language).searchForm,
        english,
        english ? 'eng' : null,
        sourceId,
        externalId,
        // The town a proverb was recorded in is part of when it is said, so it
        // belongs with the usage note rather than in a column of its own.
        [proverb.usage?.trim(), proverb.dialect?.trim() ? `Recorded at ${proverb.dialect.trim()}.` : null]
          .filter(Boolean)
          .join(' ') || null,
        proverb.theme?.trim() || null,
        confidence,
        status,
      ]
    );
    if (row?.id) {
      pending.push({ id: Number(row.id), igbo: text });
      inserted += 1;
    }
  }
  log(`  proverbs written                   ${inserted}`);
  log(`  already held, left alone           ${alreadyHeld}`);

  // --- Link each proverb to the words it contains ------------------------
  const linkRows: unknown[][] = [];
  let unlinked = 0;

  for (const item of pending) {
    const n = normalise(item.igbo);
    const tokens = new Set(n.split(' ').filter((t) => t.length >= 2));
    const hits = new Set<number>();

    for (const token of tokens) {
      const id = singleWord.get(token);
      if (id !== undefined) hits.add(id);
    }
    for (const m of multiWord) {
      if (n.includes(m.n)) hits.add(m.id);
    }

    if (hits.size === 0) {
      unlinked += 1;
      continue;
    }
    for (const wordId of [...hits].slice(0, MAX_LINKS_PER_PROVERB)) {
      linkRows.push([item.id, wordId]);
    }
  }

  const links = await insertMany(db, 'example_word', ['example_id', 'word_id'], linkRows, {
    onConflict: 'on conflict do nothing',
  });
  log(`  linked to words                    ${links} links, ${unlinked} proverbs unplaced`);

  return {
    read: all.length,
    inserted,
    alreadyPresent: all.length - inserted,
    withTranslation,
    withoutTranslation,
    linked: pending.length - unlinked,
    unlinked,
    links,
    sources: sourceIds.size,
    durationMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const db: Db = await getDb();
  try {
    console.log('\nImporting Igbo proverbs\n');
    const report = await importProverbs();
    console.log(`\n  done in ${formatMs(report.durationMs)}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && process.argv[1].endsWith('proverbs.ts')) {
  main().catch((error) => {
    console.error('\nImport failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
