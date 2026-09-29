/**
 * Smoke test for the read layer and the API-key system.
 *
 * Proves the things a user would actually notice: tone-blind search finds the
 * right word, English search works in reverse, word detail assembles, and API
 * keys authenticate, meter and get rejected past quota.
 */
import { closeDb, getDb } from './client.ts';
import { searchWords, getWord, wordOfTheDay, getDictionaryStats, listLanguages } from './repository.ts';
import { registerDeveloper, authenticateApiKey, consumeQuota, listApiKeys } from './apikeys.ts';
import {
  assertContract,
  ATTRIBUTION_KEYS_V1,
  DEFINITION_KEYS_V1,
  IGBOAPI_V1_FIELD_MAP,
  LANGUAGE_KEYS_V1,
  MATCH_TYPES_V1,
  SEARCH_DIAGNOSTICS_KEYS_V1,
  SEARCH_RESPONSE_KEYS_V1,
  STATS_KEYS_V1,
  WORD_DETAIL_KEYS_V1,
  WORD_SUMMARY_KEYS_V1,
} from '@ozituma/core';

const db = await getDb();
let failures = 0;
function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

console.log('\n--- Dictionary stats ---');
const stats = await getDictionaryStats(db);
console.log(' ', JSON.stringify(stats));
assert('stats show real content', stats.words > 8000 && stats.definitions > 10000);

console.log('\n--- Tone-blind search: "akwa" (àkwà bed / ákwá cry) ---');
const akwa = await searchWords(db, { query: 'akwa', perPage: 8 });
for (const r of akwa.data) {
  console.log(`   ${r.headword.padEnd(14)} [${r.matchType}] ${r.glosses.join('; ')}`);
}
assert('finds multiple akwa headwords', akwa.total >= 2, `total=${akwa.total}`);

console.log('\n--- Diacritic-typed search: "ụlọ" (house) ---');
const ulo = await searchWords(db, { query: 'ụlọ', perPage: 5 });
for (const r of ulo.data) console.log(`   ${r.headword.padEnd(14)} ${r.glosses.join('; ')}`);
assert('finds ụlọ when typed with diacritics', ulo.total >= 1, `total=${ulo.total}`);

console.log('\n--- Same word typed WITHOUT diacritics: "ulo" ---');
const uloFlat = await searchWords(db, { query: 'ulo', perPage: 5 });
for (const r of uloFlat.data) console.log(`   ${r.headword.padEnd(14)} ${r.glosses.join('; ')}`);
assert('tone-blind typing reaches the same word', uloFlat.total >= 1, `total=${uloFlat.total}`);
assert(
  'the accented headword is the top hit for the unaccented query',
  (uloFlat.data[0]?.headword ?? '').includes('ụlọ'),
  `top=${uloFlat.data[0]?.headword}`
);
assert(
  'accented and unaccented queries return the same top result',
  ulo.data[0]?.id === uloFlat.data[0]?.id
);

console.log('\n--- Prefix search: "mmi" ---');
const prefix = await searchWords(db, { query: 'mmi', perPage: 5 });
for (const r of prefix.data) console.log(`   ${r.headword.padEnd(14)} ${r.glosses.join('; ')}`);
assert('prefix search returns results', prefix.total >= 1, `total=${prefix.total}`);

console.log('\n--- English -> Igbo: "water" ---');
const english = await searchWords(db, { query: 'water', perPage: 8 });
for (const r of english.data) console.log(`   ${r.headword.padEnd(14)} [${r.matchType}] ${r.glosses.join('; ')}`);
assert('English query returns Igbo words', english.total >= 1, `total=${english.total}`);

console.log('\n--- Strict mode: exact headword only ---');
const strict = await searchWords(db, { query: 'akwa', strict: true, perPage: 5 });
console.log(`   strict total=${strict.total}`);
assert('strict narrows results', strict.total <= akwa.total);

console.log('\n--- Browse (empty query defaults to common words) ---');
const browse = await searchWords(db, { query: '', perPage: 5 });
for (const r of browse.data) console.log(`   ${r.headword.padEnd(14)} ${r.glosses.join('; ')}`);
assert('browse returns common words', browse.total > 500, `total=${browse.total}`);

console.log('\n--- Word detail ---');
const detail = await getWord(db, akwa.data[0]!.id);
assert('word detail loads', detail !== null);
if (detail) {
  console.log(`   ${detail.headword} — ${detail.glosses.join('; ')}`);
  console.log(`   pos: ${detail.partOfSpeech} | definitions: ${detail.definitions.length}`);
  console.log(`   forms: ${detail.forms.length} | examples: ${detail.examples.length} | related: ${detail.related.length} | audio: ${detail.audio.length}`);
  console.log(`   attribution: ${detail.attribution?.sourceName} (${detail.attribution?.license})`);
  assert('detail carries attribution', detail.attribution !== null, detail.attribution?.license ?? '');
  assert('detail has definitions', detail.definitions.length > 0);
}

console.log('\n--- Word of the day is deterministic ---');
const wotd1 = await wordOfTheDay(db);
const wotd2 = await wordOfTheDay(db);
assert('same word twice today', wotd1?.id === wotd2?.id, wotd1?.headword ?? 'none');

console.log('\n--- Languages ---');
const languages = await listLanguages(db);
console.log('  ', languages.slice(0, 5).map((l) => `${l.name}(${l.code}):${l.wordCount}`).join(', '));
assert('language list has content counts', languages.length >= 10 && (languages[0]?.wordCount ?? 0) > 8000);

console.log('\n--- API keys: registration, auth, quota ---');
const email = `smoke-${Date.now()}@ozituma.test`;
const reg = await registerDeveloper(db, { name: 'Smoke Test', email, useCase: 'testing' });
console.log(`   issued key: ${reg.apiKey.slice(0, 20)}…  (plan: ${reg.developer.plan})`);
assert('key has expected prefix', reg.apiKey.startsWith('ozt_live_'));
assert('plaintext key is not stored', await (async () => {
  const row = await db.one<{ n: number }>(
    `select count(*)::int as n from api_key where key_hash = $1 or key_prefix = $1`,
    [reg.apiKey]
  );
  return Number(row?.n ?? 0) === 0;
})());

const authed = await authenticateApiKey(db, reg.apiKey);
assert('valid key authenticates', authed !== null, authed?.developer.plan ?? '');
assert('wrong key is rejected', (await authenticateApiKey(db, 'ozt_live_deadbeef')) === null);

const keys = await listApiKeys(db, reg.developer.id);
assert('key list shows prefix not secret', keys.length === 1 && !keys[0]!.keyPrefix.includes('ozt_live_dead'));

const first = await consumeQuota(db, {
  developerId: reg.developer.id,
  apiKeyId: keys[0]!.id,
  plan: reg.developer.plan,
  endpoint: 'words',
});
console.log(`   quota: used=${first.used} limit=${first.limit} remaining=${first.remaining}`);
assert('free plan resolves a limit', first.limit === 1000, `limit=${first.limit}`);
assert('first request allowed', first.allowed);

// Drive a tiny endpoint past its limit to prove enforcement is real.
const te = await registerDeveloper(db, { name: 'Quota Test', email: `quota-${Date.now()}@ozituma.test` });
const teKeys = await listApiKeys(db, te.developer.id);
let lastDecision = await consumeQuota(db, {
  developerId: te.developer.id,
  apiKeyId: teKeys[0]!.id,
  plan: te.developer.plan,
  endpoint: 'speech_to_text',
});
for (let i = 0; i < 25; i += 1) {
  lastDecision = await consumeQuota(db, {
    developerId: te.developer.id,
    apiKeyId: teKeys[0]!.id,
    plan: te.developer.plan,
    endpoint: 'speech_to_text',
  });
}
console.log(`   speech_to_text after 26 calls: used=${lastDecision.used} limit=${lastDecision.limit}`);
assert('per-endpoint limit is enforced', lastDecision.allowed === false, `allowed=${lastDecision.allowed}`);
assert('speech_to_text limit is not the wildcard', lastDecision.limit === 20, `limit=${lastDecision.limit}`);

// A plan with no configured limit must fail closed.
const noLimit = await consumeQuota(db, {
  developerId: te.developer.id,
  apiKeyId: teKeys[0]!.id,
  plan: 'nonexistent-plan',
  endpoint: 'words',
});
assert('unknown plan fails closed', noLimit.allowed === false);

// ---------------------------------------------------------------------------
// Frozen API contracts.
//
// The most valuable thing to carry over from the reference implementation is
// not its schema but its habit of freezing the exact JSON key set of every API
// response, per version (its WORD_KEYS_V1/V2 arrays) — it is the one part of
// that codebase which did not drift. This asserts Ozituma's own contracts
// against real query results, so a field cannot silently vanish from the
// public API.
// ---------------------------------------------------------------------------
console.log('\n--- Frozen v1 API contracts ---');
{
  const summary = akwa.data[0];
  assert('a result row is available to check', Boolean(summary));
  if (summary) {
    assertContract(summary as unknown as Record<string, unknown>, WORD_SUMMARY_KEYS_V1, 'WordSummary');
    assert('word summary matches the v1 contract', true, `${WORD_SUMMARY_KEYS_V1.length} keys`);
    assert(
      'matchType comes from the closed v1 set',
      (MATCH_TYPES_V1 as readonly string[]).includes(summary.matchType),
      summary.matchType
    );
  }

  const contractDetail = await getWord(db, akwa.data[0]!.id);
  if (contractDetail) {
    assertContract(
      contractDetail as unknown as Record<string, unknown>,
      WORD_DETAIL_KEYS_V1,
      'WordDetail'
    );
    assert('word detail matches the v1 contract', true, `${WORD_DETAIL_KEYS_V1.length} keys`);
    if (contractDetail.definitions[0]) {
      assertContract(
        contractDetail.definitions[0] as unknown as Record<string, unknown>,
        DEFINITION_KEYS_V1,
        'Definition'
      );
    }
    if (contractDetail.attribution) {
      assertContract(
        contractDetail.attribution as unknown as Record<string, unknown>,
        ATTRIBUTION_KEYS_V1,
        'Attribution'
      );
      assert('attribution object matches the v1 contract', true);
    }
  }

  // Assert against the REAL search result rather than a hand-written literal,
  // so this checks what the API actually returns.
  assertContract(akwa as unknown as Record<string, unknown>, SEARCH_RESPONSE_KEYS_V1, 'SearchResponse');
  assert('search envelope matches the v1 contract', true);
  assertContract(
    akwa.diagnostics as unknown as Record<string, unknown>,
    SEARCH_DIAGNOSTICS_KEYS_V1,
    'SearchDiagnostics'
  );
  assert('search diagnostics match the v1 contract', true);

  const contractLanguages = await listLanguages(db);
  if (contractLanguages[0]) {
    assertContract(
      contractLanguages[0] as unknown as Record<string, unknown>,
      LANGUAGE_KEYS_V1,
      'LanguageInfo'
    );
    assert('language info matches the v1 contract', true);
  }

  assertContract(stats as unknown as Record<string, unknown>, STATS_KEYS_V1, 'DictionaryStats');
  assert('stats match the v1 contract', true);

  // The igboapi.com field mapping, kept in code so a rename cannot silently
  // invalidate the migration guidance.
  assert(
    'igboapi field map still covers the fields integrators depend on',
    ['word', 'wordClass', 'definitions', 'stems'].every((k) => k in IGBOAPI_V1_FIELD_MAP),
    `${Object.keys(IGBOAPI_V1_FIELD_MAP).length} fields mapped`
  );
}

// ---------------------------------------------------------------------------
// Cleanup.
//
// This script creates real developer accounts and keys to test authentication
// and quota enforcement. Leaving them behind accumulates junk in the dashboard
// and, worse, hides the fact that the run happened. Removing them also keeps
// `npm run verify` and the account list meaningful.
// ---------------------------------------------------------------------------
console.log('\n--- Cleanup ---');
{
  const removed = await db.query(
    `delete from developer where email like 'smoke-%@ozituma.test' or email like 'quota-%@ozituma.test'`
  );
  console.log(`  removed ${removed.rowCount} test developer account(s) and their keys`);

  const leftover = await db.one<{ count: string }>(
    `select count(*)::text as count from developer
      where email like 'smoke-%@ozituma.test' or email like 'quota-%@ozituma.test'`
  );
  assert('no test developers left behind', Number(leftover?.count ?? 0) === 0);
}

console.log(`\n${failures === 0 ? 'ALL SMOKE CHECKS PASSED' : `${failures} SMOKE CHECKS FAILED`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
await closeDb();
