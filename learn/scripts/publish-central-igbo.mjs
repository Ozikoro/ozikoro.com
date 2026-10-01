/**
 * Publish the clean Central Igbo words.
 *
 * WHAT WENT WRONG BEFORE, AND WHY THIS IS DIFFERENT
 *
 * An earlier version published by a series of `not.like` filters against PostgREST. Each filter I
 * added revealed the next artifact — leading hyphens, then a bare `'`, then `A.` with a period —
 * because PostgREST cannot express "only Igbo letters", only "not this character". Four rounds of
 * whack-a-mole, and after each one the dictionary still contained something a learner must not see.
 *
 * This does the opposite. It treats every headword as a CANDIDATE and requires it to PROVE it is a
 * single clean Igbo word:
 *
 *   1. no whitespace   — a phrase is a real entry but not a single-word one
 *   2. no punctuation  — ' - . ( ) / , ; : " ? ! [ ] { } and digits
 *   3. every character must be an Igbo letter or a tone/diacritic mark
 *
 * An allow-list, not a deny-list. Anything ambiguous fails and stays a draft, which is the correct
 * direction to fail: a missing word is a gap, a wrong word is misinformation.
 *
 * CENTRAL IGBO ONLY
 *
 * The owner's rule: "Central Igbo remains the only language used in generating anything." The
 * dictionary marks a word with a dialect when it is NOT Standard Igbo — Ngwa, Mkpọọ, Ọnịcha,
 * Ẹkpẹyẹ and so on — so an untagged word IS Central Igbo. Only those are considered here.
 *
 * Igbo Izugbe is written with the 36 letters plus the dot-below vowels and the dotted ṅ:
 *
 *   a b ch d e f g gb gh gw h i ị j k kp kw l m n ṅ nw ny o ọ p r s sh t u ụ v w y z
 */

const URL = process.env.SUPABASE_URL ?? 'https://kouczrxrsdjykxoyxzgi.supabase.co';
const JWT = process.env.LINGUIST_JWT;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!JWT || !KEY) {
  console.error('  LINGUIST_JWT and SUPABASE_SERVICE_ROLE_KEY are both required.');
  process.exit(1);
}

/**
 * A single clean Igbo word, and nothing else.
 *
 * `NFC` first, because an accented character can be one codepoint or two, and a combining mark
 * would otherwise be invisible to this test. This is the same normalisation rule the app applies
 * to every learner-visible string.
 */
/*
 * The letters Igbo Izugbe is written with, BEFORE any tone mark is applied.
 *
 * NFD-decomposed so that every accented vowel reduces to its base letter, then stripped of the
 * combining marks. An earlier version of this file tested the precomposed characters directly and
 * listed only the PLAIN vowels — so it rejected `nkèta`, `ogwè` and `elō` as unclean. Tone marks are
 * not contamination; a word without them is the one that is ambiguous.
 *
 * `c` IS included, even though Igbo has no letter `c` on its own. `ch` is a digraph but it is
 * two CHARACTERS, and this test is per-character — leaving `c` out rejected every word
 * containing `ch`, which is a large part of the language. `q` and `x` are still excluded.
 */
const IGBO_BASE_LETTERS = /^[abcdefghijklmnoprstuvwyz]+$/;

function isCleanIgboWord(headword) {
  const value = headword.normalize('NFC').trim();

  if (value.length < 3) return false;          // `i` and `a` are real words but too little to teach from
  if (value.length > 20) return false;         // nothing in Igbo is that long; it is a sentence

  // Strip tone and diacritics, keeping the base letters, then require every one to be Igbo.
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // combining acute, grave, macron, dot below, etc.
    .toLowerCase();

  return IGBO_BASE_LETTERS.test(base);
}

/** Page through every Central Igbo draft. */
async function allCentralIgbo(serviceKey) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${URL}/rest/v1/lexemes?select=id,headword&dialect=is.null&limit=1000&offset=${offset}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!response.ok) throw new Error(`read failed: ${response.status}`);
    const rows = await response.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

console.log('  reading Central Igbo lexemes…');
const rows = await allCentralIgbo(KEY);
console.log(`  ${rows.length} Central Igbo lexemes`);

const clean = rows.filter((row) => isCleanIgboWord(row.headword));
const rejected = rows.filter((row) => !isCleanIgboWord(row.headword));

console.log(`  clean single words:  ${clean.length}`);
console.log(`  left as draft:       ${rejected.length}`);

/*
 * A sample of what is being HELD BACK, printed so the decision is visible rather than silent. If
 * something legitimate appears here, the regex is wrong and this is how it gets noticed.
 */
console.log('\n  a sample of what stays in draft:');
for (const row of rejected.slice(0, 12)) {
  console.log(`    ${JSON.stringify(row.headword).slice(0, 44)}`);
}

if (process.env.DRY_RUN === 'true') {
  console.log('\n  DRY_RUN — nothing published.');
  process.exit(0);
}

/*
 * Publish by explicit id, in batches.
 *
 * `in.(...)` rather than a filter, because the decision was already made in JavaScript and this must
 * publish EXACTLY that set. A filter re-evaluated by the database could select something the
 * allow-list rejected.
 */
let published = 0;
const BATCH = 200;

for (let i = 0; i < clean.length; i += BATCH) {
  const ids = clean.slice(i, i + BATCH).map((row) => row.id);
  const response = await fetch(`${URL}/rest/v1/lexemes?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      // The trigger reads the JWT's role. The service key is only transport.
      Authorization: `Bearer ${JWT}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ status: 'published' }),
  });

  if (!response.ok) {
    console.error(`  batch ${i / BATCH + 1} failed ${response.status}: ${(await response.text()).slice(0, 150)}`);
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

console.log(`  published total: ${await head('status=eq.published')}`);
console.log(`  still draft:     ${await head('status=eq.draft')}`);
