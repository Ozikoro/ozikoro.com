/**
 * Sentence recordings → Supabase.
 *
 * WHAT THIS ADDS
 *
 * The dictionary holds 46,190 recordings, and the vast majority are of EXAMPLE SENTENCES rather
 * than single words — 30,850 of them attached to 1,083 Central Igbo words. Until now the courses
 * could only play the 497 word-level recordings, so a lesson could say a word but not show it used.
 *
 * Only the URL is copied. The audio itself stays on media.ozituma.com (Cloudflare R2), where egress
 * is free — 4.45 GB of recordings never touches Supabase.
 *
 * RUNS ON THE EC2 HOST, inside the learn container, where the dictionary is reachable.
 *
 * WHY IT REFUSES TO RUN IF THE TABLE IS MISSING
 *
 * `lexeme_examples` is created by a migration that needs the Supabase SQL Editor. If the table is
 * absent every insert 404s, and a script that writes nothing while reporting progress is the exact
 * failure this project has already produced twice. So it checks first and stops with instructions.
 */

const URL = process.env.SUPABASE_URL ?? 'https://kouczrxrsdjykxoyxzgi.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DICTIONARY_URL = process.env.DATABASE_URL;
const MEDIA_BASE = process.env.MEDIA_PUBLIC_BASE_URL || 'https://media.ozituma.com';
const BATCH = 200;

if (!KEY || !DICTIONARY_URL) {
  console.error('  SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL are required.');
  process.exit(1);
}

/*
 * Prove the table exists before doing anything else.
 *
 * A HEAD request with count=exact: a missing table answers 404 with `PGRST205`, whereas the same
 * request against an empty table answers 200 with a count of zero. Those are different situations
 * and only one of them is fixable by running this script.
 */
const probe = await fetch(`${URL}/rest/v1/lexeme_examples?select=id`, {
  method: 'HEAD',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
});

if (probe.status === 404) {
  console.error(`
  The table public.lexeme_examples does not exist yet.

  It is created by a migration, and migrations need the Supabase SQL Editor because the REST API
  cannot run DDL. Do this first:

    1. Open  https://supabase.com/dashboard/project/kouczrxrsdjykxoyxzgi/sql/new
    2. Open  learn/drizzle/migrations/0003_sentence_audio_and_cascade.sql
    3. Copy the whole file, paste it, press Run
    4. Run this script again

`);
  process.exit(1);
}

console.log('  lexeme_examples exists — reading the dictionary…');

const { default: pg } = await import('pg');
const db = new pg.Client({
  connectionString: DICTIONARY_URL,
  ...(/@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(DICTIONARY_URL) ? {} : { ssl: { rejectUnauthorized: false } }),
});
await db.connect();

/**
 * Every published example sentence that has a recording, for a Central Igbo word.
 *
 * A sentence is NOT necessarily Central Igbo just because its word is: the dictionary also records
 * dialect pronunciations of the same sentence, and those are on `word_dialect`. Excluding them keeps
 * the rule the owner set — Central Igbo is the only language used in generating anything.
 */
const { rows } = await db.query(`
  select
    w.uuid            as lexeme_id,
    e.text            as text_ig,
    e.translation     as text_en,
    a.storage_key     as object_key,
    a.external_url    as external_url,
    e.id              as example_id,
    row_number() over (partition by w.uuid order by e.id) - 1 as position
  from word w
  join example_word ew on ew.word_id = w.id
  join example e on e.id = ew.example_id and e.status = 'published'
  join audio a on a.example_id = e.id and a.status = 'published'
  where w.status = 'published'
    and w.language_code = 'ibo'
    and not exists (select 1 from word_dialect wd where wd.word_id = w.id)
    and e.text is not null
    and length(e.text) between 8 and 200
  order by w.uuid, e.id
`);

console.log(`  ${rows.length} recorded example sentences`);

/** De-duplicate on (lexeme, sentence) — the schema's unique constraint, applied before the write. */
const seen = new Set();
const records = [];

for (const row of rows) {
  const marker = `${row.lexeme_id}\u001f${row.text_ig}`;
  if (seen.has(marker)) continue;
  seen.add(marker);

  const url = row.object_key
    ? `${MEDIA_BASE}/${row.object_key.replace(/^\/+/, '')}`
    : row.external_url;

  if (!url) continue;

  records.push({
    lexeme_id: row.lexeme_id,
    position: Number(row.position),
    text_ig: row.text_ig,
    text_en: row.text_en ?? null,
    audio_url: url,
    // The dictionary's own review is the review; these are published entries.
    status: 'published',
    source: 'Ozituma dictionary',
  });
}

console.log(`  ${records.length} unique rows to write`);

let written = 0;
let failed = 0;

for (let i = 0; i < records.length; i += BATCH) {
  const batch = records.slice(i, i + BATCH);

  const response = await fetch(`${URL}/rest/v1/lexeme_examples`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      // Upsert on (lexeme_id, text_ig): re-running replaces rather than duplicating.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(batch),
  });

  if (!response.ok) {
    failed += batch.length;
    if (failed <= BATCH) {
      console.error(`  batch failed ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    continue;
  }

  written += batch.length;
  if (written % 5000 < BATCH) console.log(`  … ${written}/${records.length}`);
}

console.log(`\n  written: ${written}`);
console.log(`  failed:  ${failed}`);

const count = await fetch(`${URL}/rest/v1/lexeme_examples?select=id`, {
  method: 'HEAD',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
});
console.log(`  rows in lexeme_examples now: ${(count.headers.get('content-range') ?? '/0').split('/')[1]}`);

await db.end();
