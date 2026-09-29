/**
 * Ndebe script importer — the alternative-script layer.
 *
 *   node packages/db/src/import/script.ts
 *
 * WHAT NDEDE IS
 *
 * Ndebe is a constructed syllabary for Igbo, written left to right, by Lotanna
 * Igwe-Odunze and the Ndebe Project. It is not a transliteration alphabet: one
 * character is a whole syllable, and tone is a different character rather than
 * an accent on one, so a syllable is a body x vowel x tone cell of a 42 x 9 x 3
 * grid. `@ozituma/core` holds the grid and the arithmetic.
 *
 * WHY THIS IS A SEPARATE IMPORTER
 *
 * The Igbo corpus changes often and is expensive to re-import; this writes only
 * `word_script`, so it can be re-run on its own. It is idempotent: it clears its
 * own rows for the script and rewrites them.
 *
 * WHAT IS STORED, AND WHY IT IS STORED RATHER THAN COMPUTED
 *
 * Transliteration is deterministic, so the value could be derived on every page
 * render. It is stored for one reason that matters: a correction needs somewhere
 * to live. The mechanical result is the starting point, not the last word — the
 * script's own author has open questions about it (see below) — and a table is
 * where a human ruling can be recorded without editing code.
 *
 * The `notes` column records how each value was produced. A row whose note says
 * MECHANICAL is one the transliterator can reproduce, and the integrity gate
 * checks exactly that, so an edit that does not update the note fails the build
 * rather than silently drifting. Anything else is a human correction and is left
 * alone by both the importer and the gate.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * A word that cannot be written is skipped, not approximated. 163 of 8,822 Igbo
 * headwords are in that position, and the reasons are worth knowing:
 *
 *   - `ŋ` (68 headwords) has NO Ndebe body. `ng` and `ngw` have none either —
 *     the script's own reference material says a body for them would have to be
 *     added or the mapping ruled on by the author, and the existing tooling
 *     writes `ng` through the N body and marks it ASSUMED. This importer does
 *     not assume: those words get no Ndebe form and the count is reported.
 *   - 24 headwords are a bare letter or abbreviation ("C.", "CH", "B") — they
 *     are not Igbo words in the first place.
 *   - the rest carry English words that leaked into a headword, e.g.
 *     "-fabà (or -fàbà)" and "-gabìga (compare - gafèga)". `or` and `compare`
 *     have no Ndebe spelling because they are not Igbo.
 *
 * Skipping is the honest outcome in every one of those cases. Writing something
 * plausible would put a wrong word, rendered confidently, in front of a reader.
 */
import { transliterate } from '@ozituma/core';
import { closeDb, getDb } from '../client.ts';
import { formatMs } from './corpus.ts';

/** The script code stored in `word_script`. */
export const NDEBE_SCRIPT_CODE = 'Ndebe';

/**
 * The note that marks a row as reproducible by the transliterator.
 *
 * The gate re-derives every row carrying this note and fails if the stored value
 * differs. A human correction therefore has to change the note as well, which is
 * the point: it makes the correction deliberate and visible instead of an
 * unexplained difference the next import would silently overwrite.
 */
export const MECHANICAL_NOTE = 'mechanical transliteration of the headword';

export interface ScriptImportReport {
  words: number;
  written: number;
  skipped: number;
  /** Headwords that could not be written, with the letters that stopped them. */
  unwritable: { headword: string; unhandled: string }[];
  durationMs: number;
}

export async function importScript(
  options: { languageCode?: string; log?: (m: string) => void } = {}
): Promise<ScriptImportReport> {
  const started = Date.now();
  const languageCode = options.languageCode ?? 'ibo';
  const log = options.log ?? ((m: string) => console.log(m));
  const db = await getDb();

  const rows = await db.rows<{ id: string; headword: string }>(
    `select id, headword from word
      where language_code = $1 and status = 'published'
      order by id`,
    [languageCode]
  );

  log(`  published ${languageCode} headwords   ${rows.length}`);

  /*
   * Clear only rows this importer owns — the ones it can reproduce. A human
   * correction carries a different note, survives the delete, and is not
   * reinserted because nothing collides with it.
   */
  const cleared = await db.query(
    `delete from word_script ws
      using word w
      where ws.word_id = w.id
        and w.language_code = $1
        and ws.script_code = $2
        and ws.notes = $3`,
    [languageCode, NDEBE_SCRIPT_CODE, MECHANICAL_NOTE]
  );
  if ((cleared.rowCount ?? 0) > 0) {
    log(`  cleared previous mechanical rows   ${cleared.rowCount}`);
  }

  let written = 0;
  const unwritable: { headword: string; unhandled: string }[] = [];

  /*
   * The sibling spellings a word already has: its dialect spellings and its own
   * variants. This is the evidence that settles which body an `h` takes.
   */
  const siblingRows = await db.rows<{ word_id: string; spelling: string }>(
    `select word_id, spelling from word_dialect wd
       join word w on w.id = wd.word_id
      where w.language_code = $1
     union all
     select word_id, value from word_form wf
       join word w on w.id = wf.word_id
      where w.language_code = $1`,
    [languageCode]
  );
  const siblingsByWord = new Map<number, string[]>();
  for (const row of siblingRows) {
    const id = Number(row.word_id);
    siblingsByWord.set(id, [...(siblingsByWord.get(id) ?? []), row.spelling]);
  }

  for (const row of rows) {
    const reading = hReading(row.headword, siblingsByWord.get(Number(row.id)) ?? []);
    const result = transliterate(row.headword, reading.h ? { h: reading.h } : {});

    if (result.unhandled.length > 0 || result.syllables.length === 0) {
      unwritable.push({ headword: row.headword, unhandled: result.unhandled });
      continue;
    }

    const note = scriptNote(row.headword, reading);
    await db.query(
      `insert into word_script (word_id, script_code, value, notes)
       values ($1, $2, $3, $4)
       on conflict (word_id, script_code, value) do update set notes = excluded.notes`,
      [Number(row.id), NDEBE_SCRIPT_CODE, result.text, note]
    );
    written += 1;
  }

  log(`  written                            ${written}`);
  log(`  could not be written               ${unwritable.length}`);

  /*
   * The reasons, grouped, because "163 words have no Ndebe form" is not a fact
   * anyone can act on and "68 of them are the letter ŋ" is.
   */
  const causes = new Map<string, number>();
  for (const item of unwritable) {
    const key = item.unhandled.length > 0 ? `letters: ${[...new Set(item.unhandled)].join('')}` : 'no letters';
    causes.set(key, (causes.get(key) ?? 0) + 1);
  }
  for (const [cause, count] of [...causes].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    log(`    ${cause.padEnd(28)} ${count}`);
  }

  return {
    words: rows.length,
    written,
    skipped: unwritable.length,
    unwritable,
    durationMs: Date.now() - started,
  };
}


/**
 * Which alternation an `h` belongs to, from the spellings we already hold.
 *
 * The script's author raised this as the one thing to watch for: dialects shift f
 * to h (`afia` beside `ahia`) and r to h (`iru` beside `ihu`), and both shifts land
 * on the same letter, so `h` sits in two Ndebe alternation sets at once and the
 * letter alone does not say which body the writer meant. She is explicit that the
 * writer has to know, and that instinct is not enough.
 *
 * The dictionary can know. If a word or a name is ALSO written with f or sh where
 * it has h, the h is a shifted f; if it is also written with r, it is a shifted r.
 * The test is exact rather than fuzzy: replacing every h in the headword with f,
 * sh or r must give one of the sibling spellings we hold, which is the same
 * evidence a speaker would use.
 */
function hReading(
  headword: string,
  siblings: string[]
): { h: 'from-f-or-sh' | 'from-r' | undefined; from: string | null } {
  if (!headword.toLowerCase().includes('h')) return { h: undefined, from: null };
  const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const target = fold(headword);
  for (const sibling of siblings) {
    const s = fold(sibling);
    if (s.length === 0 || s === target) continue;
    if (s === target.replace(/h/g, 'f') || s === target.replace(/h/g, 'sh')) {
      return { h: 'from-f-or-sh', from: sibling };
    }
    if (s === target.replace(/h/g, 'r')) return { h: 'from-r', from: sibling };
  }
  return { h: undefined, from: null };
}


/**
 * What the row's note says about how the value was produced.
 *
 * A word or name containing `h` that no sibling spelling settles is written with
 * the r/h body — and the note SAYS SO, because that is a coin toss rather than an
 * answer: `h` can be a shifted f or a shifted r, and 1,046 names contain one with
 * no evidence either way. A reader or the script's author can then find every such
 * row with a single query and correct the ones that matter, which is not possible
 * if the default is written as though it were a transliteration like any other.
 */
function scriptNote(
  word: string,
  reading: { h: 'from-f-or-sh' | 'from-r' | undefined; from: string | null }
): string {
  if (reading.from) {
    const shifted = reading.h === 'from-f-or-sh' ? 'f or sh' : 'r';
    return `${MECHANICAL_NOTE}; h read as a shifted ${shifted} on the evidence of "${reading.from}"`;
  }
  if (word.toLowerCase().includes('h')) {
    return `${MECHANICAL_NOTE}; h on the default r/h body — no sibling spelling settles it`;
  }
  return MECHANICAL_NOTE;
}

export interface NameScriptReport {
  names: number;
  written: number;
  unwritable: { name: string; unhandled: string }[];
  hFromEvidence: number;
  hDefaulted: number;
}

/**
 * Ndebe for the name dictionary.
 *
 * The owner asked for it: a name is Igbo, so it can be written in the syllabary,
 * and the name pages had no such line. Stored rather than computed, in
 * `person_name_script`, exactly as the word dictionary stores `word_script`: a
 * correction needs somewhere to live, and the mechanical note is what lets the
 * gate tell a correction from a drift.
 */
export async function importNameScript(
  options: { languageCode?: string; log?: (m: string) => void } = {}
): Promise<NameScriptReport> {
  const languageCode = options.languageCode ?? 'ibo';
  const log = options.log ?? ((m: string) => console.log(m));
  const db = await getDb();

  const rows = await db.rows<{ id: string; name: string; variants: string[]; variety_forms: unknown }>(
    `select id, name, variants, variety_forms from person_name
      where language_code = $1 and status = 'published' order by id`,
    [languageCode]
  );
  log(`  published ${languageCode} names     ${rows.length}`);

  await db.query(
    `delete from person_name_script ps
      using person_name p
      where ps.person_name_id = p.id and p.language_code = $1
        and ps.script_code = $2 and ps.notes = $3`,
    [languageCode, NDEBE_SCRIPT_CODE, MECHANICAL_NOTE]
  );

  let written = 0;
  let hFromEvidence = 0;
  let hDefaulted = 0;
  const unwritable: { name: string; unhandled: string }[] = [];

  for (const row of rows) {
    const siblings = [
      ...(row.variants ?? []),
      ...(Array.isArray(row.variety_forms)
        ? (row.variety_forms as { form?: string }[]).map((f) => f?.form ?? '').filter(Boolean)
        : []),
    ];
    const reading = hReading(row.name, siblings);
    if (row.name.toLowerCase().includes('h')) {
      if (reading.h) hFromEvidence += 1;
      else hDefaulted += 1;
    }

    const result = transliterate(row.name, reading.h ? { h: reading.h } : {});
    if (result.unhandled.length > 0 || result.syllables.length === 0) {
      unwritable.push({ name: row.name, unhandled: result.unhandled });
      continue;
    }
    const note = scriptNote(row.name, reading);
    await db.query(
      `insert into person_name_script (person_name_id, script_code, value, notes)
       values ($1, $2, $3, $4)
       on conflict (person_name_id, script_code, value) do update set notes = excluded.notes`,
      [Number(row.id), NDEBE_SCRIPT_CODE, result.text, note]
    );
    written += 1;
  }

  log(`  written                            ${written}`);
  log(`  could not be written               ${unwritable.length}`);
  log(`  h settled by a sibling spelling    ${hFromEvidence}`);
  log(`  h left on the default body         ${hDefaulted}`);

  return { names: rows.length, written, unwritable, hFromEvidence, hDefaulted };
}

async function main(): Promise<void> {
  const db = await getDb();
  try {
    console.log('\nImporting alternative scripts\n');
    console.log('  words');
    const report = await importScript();
    console.log('\n  names');
    await importNameScript();
    console.log(`\n  done in ${formatMs(report.durationMs)}\n`);
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && process.argv[1].endsWith('script.ts')) {
  main().catch((error) => {
    console.error('\nImport failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
