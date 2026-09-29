/**
 * Searching the clan registry.
 *
 *   npm -w @ozituma/db run test:clan-search
 *
 * WHY THIS EXISTS
 *
 * Widening this search took the whole section down in production. The filter
 * gained a match on the parent entry's name, the ROWS query gained the join it
 * needed, and the COUNT query did not — so every search on ozituma.com/clans
 * returned a 500 with `missing FROM-clause entry for table "p"`, and nothing in
 * the repository noticed, because there was no test that searched anything.
 *
 * So this asserts the two things that can silently go wrong here:
 *
 *   1. the count and the rows carry the same joins and the same filter, so a
 *      filter that mentions a table is a filter the count can also run;
 *   2. a reader finds an entry by ANYTHING they might know — a town, a word from
 *      the description, the group it belongs to, the group above it — and the card
 *      says which of those it was.
 *
 * It runs against the local database and does not write to it: everything here is
 * a read, so it is safe to run at any time and cannot damage the registry.
 */
import { closeDb, getDb, type Db } from './client.ts';
import { editDistance, listClans, suggestClanNames } from './clans.ts';

const db: Db = await getDb();
let failures = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/** Every filter the page can build, so the count is exercised the same way. */
const FILTERS = [
  { label: 'a town', params: { query: 'Nkpor' } },
  { label: 'a clan name', params: { query: 'Idemili' } },
  { label: 'a description word', params: { query: 'blacksmith' } },
  { label: 'a division name', params: { query: 'Northern Igbo' } },
  { label: 'a parent name', params: { query: 'Umu-Eri' } },
  { label: 'a state', params: { query: 'Anambra' } },
  { label: 'a name and a division together', params: { query: 'Nkpor', tribe: 'northern-igbo-wawaa' } },
  { label: 'a kind and a query', params: { query: 'Onitsha', kind: 'clan' } },
  { label: 'nothing at all', params: {} },
];

console.log('\n--- the count runs wherever the rows run ---');

for (const filter of FILTERS) {
  try {
    const result = await listClans(db, filter.params);
    assert(
      `${filter.label} is answered, and the total matches what came back`,
      Number.isFinite(result.total) && result.total >= result.data.length,
      `${result.data.length} rows, total ${result.total}`
    );
  } catch (error) {
    assert(`${filter.label} is answered`, false, String(error).slice(0, 120));
  }
}

console.log('\n--- a town finds the entry it belongs to ---');

const nkpor = await listClans(db, { query: 'Nkpor' });
assert('searching a town by name finds entries', nkpor.data.length > 0, `${nkpor.data.length} found`);
assert(
  'and the entry says which town matched, so the card is not a mystery',
  nkpor.data.some((clan) => (clan.matchedTown ?? '').toLowerCase().includes('nkpor')),
  nkpor.data.map((c) => c.matchedTown ?? '—').join(', ')
);

const idemili = nkpor.data.find((clan) => clan.name === 'Idemili');
assert('Nkpor leads to Idemili', idemili !== undefined);

console.log('\n--- and by everything else a reader might bring ---');

const byName = await listClans(db, { query: 'Idemili' });
assert('the clan name finds it', byName.data.some((c) => c.name === 'Idemili'));

const byDescription = await listClans(db, { query: 'blacksmith' });
assert(
  'a word from the description finds the entries that mention it',
  byDescription.data.length > 0,
  `${byDescription.data.length} entries mention blacksmiths`
);

const byParent = await listClans(db, { query: 'Umu-Eri' });
assert(
  'the parent group finds the entries filed under it',
  byParent.data.some((clan) => clan.parent?.name === 'Umu-Eri'),
  byParent.data.map((c) => c.name).slice(0, 4).join(', ')
);

const byDivision = await listClans(db, { query: 'Northern Igbo' });
assert('the division finds its clans', byDivision.data.length > 0, `${byDivision.data.length}`);

const byState = await listClans(db, { query: 'Anambra' });
assert('the state finds the clans in it', byState.data.length > 0, `${byState.data.length}`);

console.log('\n--- nothing found is not a dead end ---');

const nonsense = await listClans(db, { query: 'zzzznotaclan' });
assert('a name that is not there returns nothing', nonsense.total === 0);

/*
 * What this exists for now.
 *
 * It was written around the survey's printed spellings — Umuleru, Ogburike, Nnando
 * — and asserted that a reader typing the modern name was offered them. Those
 * spellings have since been corrected in the data, so the premise is gone and the
 * assertions with it: the pairs are no longer two names for one place. What
 * remains is the case the feature is actually for, a reader who mistypes or who
 * half-remembers, and that is what is asserted here.
 *
 * The correction is recorded rather than quietly deleted from the test, because a
 * test that stops asserting something should say why.
 */
for (const [typed, expected, why] of [
  ['Omuleri', 'Umuleri', 'a mistyped town'],
  ['Idemmili', 'Idemili', 'the common double-m spelling of a clan'],
  ['Ogbunike', 'Ogbunike', 'the name as the towns write it'],
] as const) {
  const hits = await suggestClanNames(db, typed);
  assert(
    `${typed} (${why}) is offered ${expected}`,
    hits.some((hit) => hit.name === expected),
    hits.map((h) => h.name).join(', ') || 'nothing offered'
  );
}

assert('a search for the name the towns use finds the entry directly', (await listClans(db, { query: 'Umuleri' })).total > 0);
assert('a search for the older spelling finds it too, through the entry aliases', (await listClans(db, { query: 'Umuigwedo' })).total > 0);

console.log('\n--- the distance function itself ---');

assert('identical names are zero apart', editDistance('umuleri', 'umuleri') === 0);
assert('one letter apart is one', editDistance('ogbunike', 'ogburike') === 1);
/*
 * Plain Levenshtein counts a swap as two, not one: it has no notion of a
 * transposition. Asserted as it is rather than as one might wish, because the
 * suggestion threshold is calibrated against this function's real behaviour.
 */
assert('a swapped pair costs two, not one', editDistance('nri', 'nir') === 2);
assert('nothing against something is its length', editDistance('', 'nri') === 3);
assert('unrelated names are far apart', editDistance('nkpor', 'obowo') > 2);

console.log(`\n${failures === 0 ? 'ALL CLAN SEARCH CHECKS PASSED' : `${failures} CLAN SEARCH CHECKS FAILED`}\n`);
await closeDb();
process.exitCode = failures === 0 ? 0 : 1;
