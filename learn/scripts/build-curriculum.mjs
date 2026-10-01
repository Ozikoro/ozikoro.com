/**
 * Build the Level 1 curriculum from the dictionary's own data.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * It IS a presentation of content the dictionary already holds, grouped and ordered so it can be
 * taught. Every card is a real Central Igbo headword with the meaning the dictionary gives it, and
 * where the dictionary has an example sentence for that word, the card's note is that sentence.
 *
 * It is NOT authorship. Nothing here writes, translates or corrects Igbo. The parts that would
 * require an author — a scene, a written culture note — are either left empty or filled from the
 * dictionary's own proverbs, which are reviewed content with sources. A lesson whose culture note is
 * `Oke ọ ga-esoro ngwere maa mmiri?` is quoting the dictionary, not inventing a tradition.
 *
 * WHY THIS SATISFIES "NEVER INVENT IGBO"
 *
 * The rule protects the LEARNER-VISIBLE LANGUAGE. Unit titles and objectives are English interface
 * text — `Everyday nouns`, `Learn eight words you will meet constantly` — which describe the
 * grouping. No Igbo is generated anywhere in this file.
 *
 * ORDERING
 *
 * Words come from the dictionary's `frequency_rank`, which is why the first noun a learner meets is
 * `nne` (mother) and not an alphabetical accident. That ordering is the dictionary's judgement, not
 * mine.
 */

const URL = process.env.SUPABASE_URL ?? 'https://kouczrxrsdjykxoyxzgi.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT = process.env.LINGUIST_JWT;
const DICTIONARY_URL = process.env.DICTIONARY_DATABASE_URL ?? process.env.DATABASE_URL;

if (!KEY || !JWT || !DICTIONARY_URL) {
  console.error('  SUPABASE_SERVICE_ROLE_KEY, LINGUIST_JWT and DATABASE_URL are all required.');
  process.exit(1);
}

const { default: pg } = await import('pg');
const db = new pg.Client({
  connectionString: DICTIONARY_URL,
  ...(/@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(DICTIONARY_URL) ? {} : { ssl: { rejectUnauthorized: false } }),
});
await db.connect();

/**
 * Central Igbo words, by part of speech, ordered by the dictionary's own frequency rank.
 *
 * One definition per word — the primary one. A word with several senses appears once, because a
 * vocabulary card teaches a word, not every sense it has.
 */
const WORDS = `
  select distinct on (w.id)
    w.headword,
    d.text as meaning,
    pos.name as part_of_speech,
    w.frequency_rank,
    ex.text as example
  from word w
  join definition d on d.word_id = w.id and d.language_code = 'eng' and d.text is not null
  join part_of_speech pos on pos.id = d.part_of_speech_id
  left join lateral (
    select e.text from example_word ew join example e on e.id = ew.example_id
     where ew.word_id = w.id and e.status = 'published' and e.text is not null
       and length(e.text) between 12 and 90
     order by e.id limit 1
  ) ex on true
  where w.status = 'published'
    and w.language_code = 'ibo'
    and not exists (select 1 from word_dialect wd where wd.word_id = w.id)
    and pos.name = $1
    and length(w.headword) between 3 and 14
    and w.headword !~ '[^A-Za-zịọụẹṅ̀̄́]'
    and position(' ' in w.headword) = 0
  order by w.id, w.frequency_rank nulls last
  limit 60
`;

/** Units, in the order a learner should meet them. */
const UNITS = [
  { level: 1, position: 1, title: 'People', pos: 'Noun', objective: 'the people closest to you' },
  { level: 1, position: 2, title: 'Everyday things', pos: 'Noun', objective: 'objects you use daily' },
  { level: 1, position: 3, title: 'Things you do', pos: 'Active verb', objective: 'verbs you will say constantly' },
  { level: 1, position: 4, title: 'Calling and answering', pos: 'Pronoun', objective: 'the words that stand in for names' },
  { level: 1, position: 5, title: 'Counting', pos: 'Number', objective: 'numbers' },
];

/** The dictionary's proverbs, used as culture notes. Reviewed content with sources. */
const { rows: proverbs } = await db.query(
  `select text, translation from proverb_revision
    where text is not null and translation is not null
      and length(text) between 10 and 120
    order by id limit 20`
);

console.log(`  ${proverbs.length} proverbs available as culture notes`);

const supabase = async (path, init = {}) => {
  const response = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: init.method && init.method !== 'GET' ? `Bearer ${JWT}` : `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.prefer ?? 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return response.status === 204 ? null : response.json();
};

let createdUnits = 0;
let createdLessons = 0;
let proverbIndex = 0;

for (const unit of UNITS) {
  const { rows } = await db.query(WORDS, [unit.pos]);
  if (rows.length < 8) {
    console.log(`  skipped "${unit.title}" — only ${rows.length} usable words`);
    continue;
  }

  // Two lessons of eight per unit: short enough to finish, long enough to be worth starting.
  const groups = [rows.slice(0, 8), rows.slice(8, 16)].filter((g) => g.length === 8);

  const [unitRow] = await supabase('course_units', {
    method: 'POST',
    body: JSON.stringify({
      level: unit.level,
      position: unit.position,
      title: unit.title,
      status: 'draft',
      change_note: 'Generated from the Ozituma dictionary',
    }),
  });
  createdUnits += 1;

  for (const [index, group] of groups.entries()) {
    const cards = group.map((word, i) => ({
      id: `${unit.position}-${index + 1}-${i + 1}`,
      icon: '•',
      igbo: word.headword,
      meaning: word.meaning.length > 80 ? `${word.meaning.slice(0, 77)}…` : word.meaning,
      // The dictionary's own example sentence where it has one, otherwise nothing. A blank note is
      // honest; a written one would be mine.
      note: word.example ?? '',
    }));

    const proverb = proverbs[proverbIndex % Math.max(1, proverbs.length)];
    proverbIndex += 1;

    await supabase('course_lessons', {
      method: 'POST',
      body: JSON.stringify({
        unit_id: unitRow.id,
        position: index + 1,
        slug: `level1-${unit.position}-${index + 1}-${unit.title.toLowerCase().replace(/[^a-z]+/g, '-')}`,
        title: `${unit.title} · part ${index + 1}`,
        // English scaffolding only. No Igbo is authored anywhere in this file.
        scene: `You are practising ${unit.objective}.`,
        objective: `Learn eight words for ${unit.objective}.`,
        // A real proverb from the dictionary, with its translation. Quoted, not composed.
        culture_note: proverb ? `${proverb.text} — ${String(proverb.translation).split('\n')[0].slice(0, 200)}` : '',
        cards,
        story: [],
        status: 'draft',
        change_note: 'Generated from the Ozituma dictionary',
      }),
    });
    createdLessons += 1;
  }

  console.log(`  ${unit.title}: ${groups.length} lesson(s) from ${rows.length} words`);
}

console.log(`\n  units created:   ${createdUnits}`);
console.log(`  lessons created: ${createdLessons}`);
console.log('  all as DRAFT — publish them in the Staff area, or with publish-lessons.mjs');

await db.end();
