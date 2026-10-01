/**
 * Dictionary → Supabase. The one-way feed that makes learn.ozituma.com stop showing demo data.
 *
 * RUNS ON THE EC2 HOST, INSIDE THE LEARN CONTAINER, where the dictionary database is reachable.
 * It reads the Ozikoro dictionary and writes `lexemes` in Supabase over HTTPS, so no file ever
 * leaves either machine.
 *
 * WHY ONE-WAY, ALWAYS
 *
 * The dictionary is the source of truth — the owner's rule, and the reason there is no reverse
 * sync here. A learner-facing CMS that could write back would eventually overwrite a reviewed
 * dictionary entry with a draft, and the dictionary is the thing everything else is checked against.
 * So `learn` may read it and may never write to it.
 *
 * WHY IT IS IDEMPOTENT
 *
 * Re-running it must not duplicate 16,000 rows. The dictionary's `word.uuid` is carried across as
 * the lexeme `id`, so the same word always lands on the same row and an upsert replaces rather than
 * appends. That also means a correction in the dictionary fixes the course the next time this runs —
 * which is exactly what the owner asked for.
 *
 * WHY UNVERIFIED WORDS ARE EXCLUDED
 *
 * `status = 'published'` is required, and that IS the dictionary's review state (12,229 published,
 * 1,134 draft). `is_verified` is deliberately NOT used: all 13,363 rows carry `false`, because the
 * column was created and never populated. Requiring it imports nothing, which is exactly what an
 * earlier version of this file did.
 */

import pg from 'pg';

const {
  DATABASE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  LANGUAGE = 'ibo',
  LIMIT = '0',
  BATCH = '200',
} = process.env;

for (const [name, value] of Object.entries({ DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!value) {
    console.error(`  ${name} is not set`);
    process.exit(1);
  }
}

/*
 * SSL only where the server expects it.
 *
 * The dictionary runs in a container on the same host and does not offer TLS; Supabase requires it.
 * Requesting SSL against a server that does not support it fails with "The server does not support
 * SSL connections" before any query runs, so this has to be decided from the host, not hard-coded.
 */
const needsSsl = !/@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(DATABASE_URL);
const db = new pg.Client({
  connectionString: DATABASE_URL,
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
await db.connect();

/**
 * The dictionary, flattened into what a lexeme needs.
 *
 * `LATERAL` rather than correlated subqueries for the definition and example: a word can have many
 * of each, and a lateral join with `limit 1` is the readable way to say "take the primary one".
 * Without the ordering clause this would pick an arbitrary definition, which for a word with
 * several senses would sometimes show the wrong meaning.
 */
const query = `
  select
    w.uuid                      as id,
    w.headword                  as headword,
    w.headword                  as tone_marked,
    coalesce(w.search_form, '') as search_key,
    pos.name                    as part_of_speech,
    d.text                      as meaning,
    ex.text                     as example_ig,
    ex.translation              as example_en,
    a.url                       as audio_url,
    dia.name                    as dialect,
    src.name                    as source
  from word w
  left join part_of_speech pos on pos.id = (
    select part_of_speech_id from definition
     where word_id = w.id and part_of_speech_id is not null
     order by is_primary desc nulls last, position limit 1
  )
  -- The MEANING is the English definition. definition.language_code is 'eng' on all 39,101 rows
  -- even though the words are Igbo — the column describes the LANGUAGE OF THE TEXT, not the entry.
  -- Filtering it on 'ibo' is the mistake that made an earlier version of this file import nothing.
  left join lateral (
    select text from definition
     where word_id = w.id and language_code = 'eng'
       and text is not null and length(trim(text)) > 0
     order by is_primary desc nulls last, position limit 1
  ) d on true
  left join lateral (
    select e.text, e.translation
      from example_word ew join example e on e.id = ew.example_id
     where ew.word_id = w.id and e.status = 'published'
     order by e.id limit 1
  ) ex on true
  left join lateral (
    select coalesce(nullif(external_url, ''), nullif(storage_key, '')) as url
      from audio
     where word_id = w.id and word_dialect_id is null
     order by id limit 1
  ) a on true
  left join word_dialect wd on wd.word_id = w.id
  left join dialect dia on dia.id = wd.dialect_id
  left join source src on src.id = w.source_id
  where w.language_code = $1
    and w.status = 'published'
    /*
     * NOT 'is_verified'. All 13,363 dictionary rows carry 'is_verified = false' — the column was
     * created and never populated, so requiring it imports nothing. The dictionary's own 'status'
     * IS its review state: 12,229 published, 1,134 draft. A published dictionary entry has been
     * through the dictionary's review, and that review is what 'status = 'published'' means here.
     */
    and d.text is not null
  ${Number(LIMIT) > 0 ? 'limit ${Number(LIMIT)}' : ''}
`;

console.log('  reading the dictionary…');
const { rows } = await db.query(query, [LANGUAGE]);
console.log(`  ${rows.length} verified words with a meaning`);

/**
 * The audio URL.
 *
 * The dictionary stores a storage key or an external URL. Media is served from media.ozituma.com,
 * so a bare key has to be turned into a full URL or the player gets a relative path and 404s.
 */
const MEDIA_BASE = process.env.MEDIA_PUBLIC_BASE_URL || 'https://media.ozituma.com';

/** De-duplicate by id. A word with several dialects appears once per dialect in the join above. */
const byId = new Map();
for (const row of rows) {
  const existing = byId.get(row.id);
  if (!existing) {
    byId.set(row.id, {
      id: row.id,
      headword: row.headword,
      tone_marked: row.tone_marked,
      search_key: row.search_key,
      part_of_speech: row.part_of_speech ?? null,
      meaning: row.meaning,
      example_ig: row.example_ig ?? null,
      example_en: row.example_en ?? null,
      audio_url: row.audio_url
        ? (row.audio_url.startsWith('http') ? row.audio_url : `${MEDIA_BASE}/${row.audio_url.replace(/^\/+/, '')}`)
        : null,
      dialect: row.dialect ?? null,
      source: row.source ?? 'Ozituma dictionary',
      /*
       * DRAFT, deliberately — and the database enforced it.
       *
       * The first run of this importer sent `status: 'published'` and every batch was refused:
       *
       *     "Only linguists or admins can publish or reject content"
       *
       * That is a guard on `lexemes`, and it is correct. The service key bypasses ROW LEVEL SECURITY
       * but not a TRIGGER, and the trigger asks `has_role(auth.uid(), 'linguist')` — which is null
       * for a server-to-server call. So there is no way for this script to publish, and there should
       * not be: a bulk import is not a review.
       *
       * The owner's instruction is the same one: "Import everything as draft, and have linguists
       * publish it in the Staff tab." A human publishes. This only delivers.
       */
      status: 'draft',
      ai_generated: false,
      change_note: 'Imported from the Ozituma dictionary',
    });
  } else if (!existing.dialect && row.dialect) {
    existing.dialect = row.dialect;
  }
}

const lexemes = [...byId.values()];
console.log(`  ${lexemes.length} unique lexemes to upsert`);

const size = Math.max(1, Number(BATCH));
let written = 0;
let failed = 0;

for (let i = 0; i < lexemes.length; i += size) {
  const batch = lexemes.slice(i, i + size);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/lexemes`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      // Upsert on the primary key: the same word replaces its row rather than duplicating.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(batch),
  });

  if (!response.ok) {
    failed += batch.length;
    const text = await response.text().catch(() => '');
    console.error(`  batch ${i / size + 1} FAILED ${response.status}: ${text.slice(0, 200)}`);
    // Keep going: one bad batch should not abandon the remaining 16,000 words.
    continue;
  }

  written += batch.length;
  if ((i / size) % 10 === 0) console.log(`  … ${written}/${lexemes.length}`);
}

console.log(`\n  written: ${written}`);
console.log(`  failed:  ${failed}`);

await db.end();
