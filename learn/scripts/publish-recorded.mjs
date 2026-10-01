/**
 * Publish every Central Igbo entry that has a native recording.
 *
 * WHY AUDIO CHANGES THE FILTER
 *
 * The main publish pass (`publish-central-igbo.mjs`) allows only single words, because a clean
 * single word is mechanically verifiable and a phrase is an editorial choice.
 *
 * A recording changes that. `dere ùgwù` is a phrase, but it is a phrase the dictionary has a NATIVE
 * SPEAKER SAYING — and 497 recordings for 8,415 Central Igbo words is the scarcest thing in this
 * whole project. A word a learner can hear is worth more than a word they can only read, and the
 * recording is itself the evidence that the entry is real rather than an artifact.
 *
 * WHAT IS STILL EXCLUDED
 *
 * Artifacts, unconditionally — anything with `'`, `.` `(` `)` `/` `,` `;` `:` digits or a leading
 * hyphen. The space is now permitted; punctuation is not. A recorded phrase is content. A recorded
 * `-gba` is still a corpus stem marker.
 */

const URL = process.env.SUPABASE_URL ?? 'https://kouczrxrsdjykxoyxzgi.supabase.co';
const JWT = process.env.LINGUIST_JWT;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!JWT || !KEY) {
  console.error('  LINGUIST_JWT and SUPABASE_SERVICE_ROLE_KEY are both required.');
  process.exit(1);
}

/** Igbo base letters, plus the space that makes a recorded phrase legitimate. */
const IGBO_PHRASE = /^[abcdefghijklmnoprstuvwyz ]+$/;

function isPublishableRecordedEntry(headword) {
  const value = headword.normalize('NFC').trim();
  if (value.length < 3 || value.length > 40) return false;
  if (value.startsWith('-')) return false;      // corpus stem marker
  if (value.includes("'")) return false;        // elided forms need an editorial decision
  if (/\s{2,}/.test(value)) return false;       // double space is a parsing artifact

  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return IGBO_PHRASE.test(base);
}

async function readAll(query, select) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${URL}/rest/v1/lexemes?select=${select}&${query}&limit=1000&offset=${offset}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
    );
    if (!response.ok) throw new Error(`read failed: ${response.status}`);
    const rows = await response.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

console.log('  reading Central Igbo entries that have a recording…');
const rows = await readAll('dialect=is.null&audio_url=not.is.null', 'id,headword');
console.log(`  ${rows.length} recorded Central Igbo entries`);

const publishable = rows.filter((row) => isPublishableRecordedEntry(row.headword));
const held = rows.filter((row) => !isPublishableRecordedEntry(row.headword));

console.log(`  publishable: ${publishable.length}`);
console.log(`  still draft: ${held.length}`);
if (held.length) {
  console.log('  held back (artifacts):');
  for (const row of held.slice(0, 10)) console.log(`    ${JSON.stringify(row.headword)}`);
}

if (process.env.DRY_RUN === 'true') {
  console.log('\n  DRY_RUN — nothing published.');
  process.exit(0);
}

let published = 0;
for (let i = 0; i < publishable.length; i += 200) {
  const ids = publishable.slice(i, i + 200).map((row) => row.id);
  const response = await fetch(`${URL}/rest/v1/lexemes?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${JWT}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ status: 'published' }),
  });
  if (!response.ok) {
    console.error(`  batch failed ${response.status}: ${(await response.text()).slice(0, 150)}`);
    continue;
  }
  published += ids.length;
}

console.log(`\n  published: ${published}`);

const head = async (query) => {
  const r = await fetch(`${URL}/rest/v1/lexemes?select=id&${query}`, {
    method: 'HEAD',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
  });
  return Number((r.headers.get('content-range') ?? '/0').split('/')[1]);
};

console.log(`  published total:        ${await head('status=eq.published')}`);
console.log(`  published WITH audio:   ${await head('status=eq.published&audio_url=not.is.null')}`);
console.log(`  still draft:            ${await head('status=eq.draft')}`);
