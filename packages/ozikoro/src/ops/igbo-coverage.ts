/**
 * THE WHOLE ARCHIVE, COSTED AND SCANNED — the numbers the owner actually asked for.
 *
 * WHAT THIS ANSWERS, AND WHY IT IS A SCRIPT RATHER THAN A TEST
 *
 * `test-pronunciation.ts` asserts the RULES on three records read by eye. This scans every published record
 * and reports the SIZES: how many distinct Igbo words the archive contains, how many the dictionary can
 * already account for, how many dissection rescues, and how many are genuinely unsayable and will queue.
 *
 * **It is not a test, because there is no number here that is right or wrong** — it is a measurement, and a
 * measurement embedded in an assertion is a measurement that gets deleted the first time it drifts. What it
 * must never do is invent a figure: every count below is summed from a plan over a real record, and the
 * figure for records it could not read is printed rather than absorbed.
 *
 * IT IS SLOW ON PURPOSE. One `planArticlePronunciation` per record, each doing a handful of dictionary
 * queries, over 1,051 records. It prints progress so a run that is going to take minutes looks like work
 * rather than a hang.
 *
 * Read-only: it writes no queue row and no audit row. `recordArticleQueue` is the writing path and is not
 * called here.
 *
 *   OZITUMA_DB_PATH=.data/scratch/pg node packages/ozikoro/src/ops/igbo-coverage.ts
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { buildDictionaryIndex, planArticlePronunciation } from '../pronunciation.ts';
import { buildDigest } from '../missing-words.ts';

const db = await getDb();
const index = await buildDictionaryIndex(db);

console.log('\nThe dictionary, as this run read it');
console.log(`  clean single-token headwords   ${index.counts.forms.toLocaleString('en-GB')}`);
console.log(`  multi-word headwords           ${index.counts.phrases.toLocaleString('en-GB')}`);
console.log(`  headwords that are ALSO English ${index.counts.collisions.toLocaleString('en-GB')} (reported, not counted as Igbo)`);

const articles = await db.rows<{ slug: string }>(
  `select slug from ozikoro_article where status = 'published' and is_page = false order by id`
);
console.log(`\nScanning ${articles.length.toLocaleString('en-GB')} published records…\n`);

/** Every distinct Igbo word and the records that need it — an in-memory stand-in for the occurrence table. */
const words = new Map<string, { surface: string; grade: number; composed: boolean; records: Set<string>; times: number }>();
/** Distinct tokens the finder could not place, with how often. Reported so the recall cost is a number. */
const unknown = new Map<string, number>();
const byGrade: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
let scanned = 0;
let unreadable = 0;
let tokens = 0;
let igboTokens = 0;
let ambiguousTokens = 0;
let unknownTokens = 0;

for (const [i, article] of articles.entries()) {
  try {
    const plan = await planArticlePronunciation(db, { slug: article.slug, index });
    scanned += 1;
    tokens += plan.summary.tokens;
    igboTokens += plan.found.igbo.reduce((sum, w) => sum + w.count, 0);
    ambiguousTokens += plan.found.ambiguous.reduce((sum, w) => sum + w.count, 0);
    unknownTokens += plan.found.unknown.reduce((sum, w) => sum + w.count, 0);

    for (const w of [...plan.words, ...plan.missing]) {
      byGrade[w.grade] = (byGrade[w.grade] ?? 0) + 1;
      const seen = words.get(w.folded);
      if (seen) {
        seen.records.add(article.slug);
        seen.times += w.occurrences;
        // The WORST grade wins when a word is resolved differently in two records: a word that is composed
        // in one record and missing in another is missing, because one of the two narrations would be
        // blocked. **Recording the best would quietly un-block a record that cannot be said.**
        if (w.grade > seen.grade) {
          seen.grade = w.grade;
          seen.composed = w.found ? w.composed : false;
        }
      } else {
        words.set(w.folded, {
          surface: w.word,
          grade: w.grade,
          composed: w.found ? w.composed : false,
          records: new Set([article.slug]),
          times: w.occurrences,
        });
      }
    }
    for (const u of plan.found.unknown) unknown.set(u.folded, (unknown.get(u.folded) ?? 0) + u.count);
  } catch (error) {
    // A record that could not be planned is COUNTED and NAMED, never silently dropped — a scan that
    // reported totals over a subset it did not mention is the fault this project keeps recording.
    unreadable += 1;
    if (unreadable <= 5) console.log(`  ! ${article.slug}: ${String(error).slice(0, 120)}`);
  }

  if ((i + 1) % 100 === 0) console.log(`  … ${i + 1} of ${articles.length}`);
}

const list = [...words.values()];

console.log('\nWHAT THE ARCHIVE CONTAINS\n');
console.log(`  records scanned                ${scanned.toLocaleString('en-GB')} of ${articles.length.toLocaleString('en-GB')}`);
if (unreadable > 0) console.log(`  records that could not be read   ${unreadable.toLocaleString('en-GB')}   ← counted, not absorbed`);
console.log(`  words in total (all tokens)    ${tokens.toLocaleString('en-GB')}`);
console.log(`  tokens the finder called Igbo  ${igboTokens.toLocaleString('en-GB')}   (${((igboTokens / Math.max(1, tokens)) * 100).toFixed(1)}% of all words)`);
console.log(`  tokens reported AMBIGUOUS      ${ambiguousTokens.toLocaleString('en-GB')}   (Igbo headwords that are also English; not counted)`);
console.log(`  tokens it could not place      ${unknownTokens.toLocaleString('en-GB')}   (distinct ${unknown.size.toLocaleString('en-GB')})`);

/*
 * Grade 6 is "not found" and grade 5 is "composed". **A blocking word is exactly a grade-6 one**, and the
 * first version of this line also tested `!w.composed && w.grade === 5` — a condition that cannot be true,
 * because a grade-5 hit IS the composed case. Dead logic in a measurement reads as a second rule and invites
 * somebody to believe there are two kinds of blocking word. There is one.
 */
const missing = list.filter((w) => w.grade === 6);
const composed = list.filter((w) => w.grade === 5);
/** Grade 4 alone, plus the grades 1–3 that a recorded sound would produce. **NOT including the composed.** */
const named = list.filter((w) => w.grade <= 4);
const blocking = missing;

/*
 * ============================================================================================
 * THIS BLOCK IS WHY THE ARCHIVE PUBLISHED TWO DISAGREEING COVERAGE FIGURES, AND IT IS FIXED HERE.
 * ============================================================================================
 *
 * The earlier version of these three lines printed a bucket and its own contents as though they were
 * siblings:
 *
 *   already accounted for   (list.length - blocking.length)      ← named AND composed
 *   composed from parts     composed.length                      ← a SUBSET of the row above
 *   UNSAYABLE               missing.length
 *
 * **`already accounted for` already contains `composed from parts`.** A later reader took the three numbers
 * at face value and added them — the shape of the table invites exactly that — producing
 * **1,289 + 617 + 462 = 2,368**, which was then recorded as a measured figure and published as
 * *"2,368 DISTINCT Igbo words"* beside this script's real distinct total of 1,751. The two "disagreed" for a
 * round because of a table that did not add up, not because of anything about the archive.
 *
 * So the rows are now a PARTITION of the distinct total, the total is printed first, and the partition is
 * checked before it is printed. **A measurement table whose rows overlap is a table that will be summed**,
 * and the arithmetic is now the script's job rather than the reader's.
 */
const partition = named.length + composed.length + missing.length;
console.log('\nDISTINCT IGBO WORDS, BY HOW THE ARCHIVE CAN SAY THEM\n');
console.log(`  DISTINCT IGBO WORDS IN TOTAL   ${list.length.toLocaleString('en-GB')}   ← the archive's whole Igbo vocabulary, each word counted ONCE`);
console.log(`    named by the dictionary      ${named.length.toLocaleString('en-GB')}   ← it has an entry of its own`);
console.log(`    composed from parts          ${composed.length.toLocaleString('en-GB')}   ← dissection's whole yield`);
console.log(`    UNSAYABLE — these queue      ${missing.length.toLocaleString('en-GB')}`);
console.log(`\n  the three rows above are a partition: ${named.length} + ${composed.length} + ${missing.length} = ${partition} ` +
  `${partition === list.length ? '= the total ✔' : `≠ ${list.length} — THE ROWS DO NOT ADD UP, DO NOT PUBLISH THEM`}`);
console.log(`  "named by the dictionary" is grade 4 alone. An earlier version printed "already accounted for"\n  instead, which INCLUDED the composed words, and summing the three rows then counted 617 words twice.`);
console.log(`\n  resolutions by grade: ${[1, 2, 3, 4, 5, 6].map((g) => `${g}=${byGrade[g] ?? 0}`).join('  ')}`);
console.log('\n  THE LINE ABOVE IS PER-RECORD, NOT PER-WORD, AND IT IS NOT A DISTINCT COUNT. It adds one for every\n  (word, record) pair, so a word used in forty records adds forty — which is why it reads in the thousands\n  while the distinct vocabulary is 1,751. Grade 5 is "composed", 6 is "not found". Grades 1–3 would mean\n  the dictionary held a sound, and every one of them is zero today — so a non-zero 1, 2 or 3 here means\n  somebody has recorded something and the lookup grades should be re-read.');

console.log('\nTHE MOST VALUABLE MISSING WORDS (the digest’s real content)\n');
const top = missing
  .map((w) => ({ ...w, articles: w.records.size }))
  .sort((a, b) => b.articles - a.articles || b.times - a.times)
  .slice(0, 25);
for (const w of top) {
  console.log(`  ${String(w.articles).padStart(5)} record${w.articles === 1 ? ' ' : 's'}  ${String(w.times).padStart(5)}×  ${w.surface}`);
}

console.log('\nTHE COMPOSED WORDS, WITH THEIR PIECES\n');
const composedTop = composed
  .map((w) => ({ ...w, articles: w.records.size }))
  .sort((a, b) => b.articles - a.articles)
  .slice(0, 20);
for (const w of composedTop) console.log(`  ${String(w.articles).padStart(5)} record${w.articles === 1 ? ' ' : 's'}  ${w.surface}`);

// WHAT THE DIGEST WOULD SAY, over the live data, with nothing written and nothing sent.
const digest = await buildDigest(db, { limit: 5 });
console.log(`\nTHE DIGEST WOULD BE: “${digest.subject}”`);
console.log(`  (built from ${
  (await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_pronunciation`))?.n ?? 0
} rows actually in the queue table — this scan writes nothing, so the digest reflects what is STORED, not what was found)`);

await closeDb();
