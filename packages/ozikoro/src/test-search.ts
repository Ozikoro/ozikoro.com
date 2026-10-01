/**
 * Search, tested on the thing that makes it usable: a reader who does not type diacritics.
 *
 * Nearly a third of this archive is about places whose names carry Igbo dotted vowels and tone marks.
 * The design brief names the diaspora reader on a phone first, and that reader will not type Ọ̀nịchạ.
 * So the assertions that matter are: the query is folded the same way the index is, a folded query
 * finds a diacritic title, and a diacritic query also finds it — because the failure in either
 * direction is invisible until somebody reports that search "does not work".
 *
 * Run with: npm -w @ozikoro/platform run test:search
 */
import { getDb, closeDb } from '@ozituma/db/client';
import { MODE_KINDS, foldQuery, searchEverything } from './search.ts';

const db = await getDb();
let failures = 0;

const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------------------

console.log('\n--- the fold, from the dictionary ---');

assert('a dotted-vowel name folds to its base letters', foldQuery('Ọ̀nịchạ') === 'onicha', foldQuery('Ọ̀nịchạ'));
assert('and so does a mixed-case one', foldQuery('Ị̀kẹ̀jìànị̀') === 'ikejiani', foldQuery('Ị̀kẹ̀jìànị̀'));
assert('tone marks alone fold away', foldQuery('ákwá') === 'akwa', foldQuery('ákwá'));
assert('plain text is unchanged but lowercased', foldQuery('Ohafia') === 'ohafia', foldQuery('Ohafia'));
assert('an empty query folds to empty', foldQuery('   ') === '');

console.log('\n--- the two modes ---');

assert('Knowledge covers the archive', MODE_KINDS.knowledge.includes('article') && MODE_KINDS.knowledge.includes('entity'));
assert('Research covers the research network', MODE_KINDS.research.includes('publication') && MODE_KINDS.research.includes('researcher'));
assert('and the two do not overlap', MODE_KINDS.knowledge.every((k) => !MODE_KINDS.research.includes(k)));

console.log('\n--- an empty query returns nothing, not everything ---');

const empty = await searchEverything(db, '   ');
assert('no results for an empty query', empty.results.length === 0);
assert('and nothing is claimed to have been searched', empty.query === '');

console.log('\n--- a folded query finds a diacritic title ---');

/*
 * The archive genuinely holds records about Ọ̀nịchạ. Searching the folded form must find them, and so
 * must searching the decorated form — the two together are the whole feature.
 */
const foldedSearch = await searchEverything(db, 'Onicha', { mode: 'knowledge', limit: 20 });
const decoratedSearch = await searchEverything(db, 'Ọ̀nịchạ', { mode: 'knowledge', limit: 20 });
assert('searching the plain spelling returns results', foldedSearch.results.length > 0, `${foldedSearch.results.length} results`);
assert('searching the decorated spelling returns the same count',
  decoratedSearch.results.length === foldedSearch.results.length,
  `${decoratedSearch.results.length} vs ${foldedSearch.results.length}`);
assert('and the top result is the same record',
  decoratedSearch.results[0]?.url === foldedSearch.results[0]?.url,
  `${decoratedSearch.results[0]?.title} / ${foldedSearch.results[0]?.title}`);
assert('matched on a title, not the body', foldedSearch.results[0]?.matchedOn === 'title', foldedSearch.results[0]?.matchedOn);

console.log('\n--- results are addressable ---');

const byTitle = await searchEverything(db, 'Ute-Okpu', { mode: 'knowledge' });
assert('a known record is found', byTitle.results.some((r) => r.url.includes('ute-okpu')), `${byTitle.results.length} results`);
assert('every result has a canonical URL', byTitle.results.every((r) => r.url.startsWith('/')));
assert('and a kind that says what it is', byTitle.results.every((r) => r.kind.length > 0));
assert('and a title', byTitle.results.every((r) => r.title.length > 0));

console.log('\n--- mode narrows what is searched ---');

const knowledgeOnly = await searchEverything(db, 'Ohafia', { mode: 'knowledge' });
assert('knowledge mode never returns a publication', !knowledgeOnly.results.some((r) => r.kind === 'publication'));
assert('nor a researcher', !knowledgeOnly.results.some((r) => r.kind === 'researcher'));

const researchOnly = await searchEverything(db, 'Ohafia', { mode: 'research' });
assert('research mode returns only research kinds',
  researchOnly.results.every((r) => r.kind === 'publication' || r.kind === 'researcher'),
  researchOnly.results.map((r) => r.kind).join(', ') || 'no results');

console.log('\n--- counts are real, so a facet rail cannot lie ---');

const counted = await searchEverything(db, 'Igbo', { mode: 'knowledge', limit: 100 });
const summed = Object.values(counted.counts).reduce((a, b) => a + b, 0);
assert('the counts add up to what was matched', summed >= counted.results.length, `${summed} counted, ${counted.results.length} shown`);
assert('and name what was searched', counted.searched.length > 0, counted.searched.join(', '));
assert('a kind with no matches counts zero', Object.entries(counted.counts).some(([, n]) => n === 0));

console.log('\n--- a match that is not there returns nothing ---');

const nonsense = await searchEverything(db, 'zzzznothingmatchesthiszzzz', { mode: 'knowledge' });
assert('a query matching nothing returns nothing', nonsense.results.length === 0);
assert('and every count is zero', Object.values(nonsense.counts).every((n) => n === 0));

console.log('\n--- narrowing to one kind ---');

const justLabels = await searchEverything(db, 'Igbo', { mode: 'knowledge', kinds: ['label'], limit: 10 });
assert('a single kind can be searched', justLabels.results.every((r) => r.kind === 'label'), justLabels.results.map((r) => r.kind).join(', '));
assert('and returns that kind', justLabels.results.length > 0, `${justLabels.results.length} subjects`);

console.log('\n--- a person is findable by name ---');

const byAuthor = await searchEverything(db, 'Idenze Ezeme', { mode: 'knowledge' });
assert('searching an author returns their records', byAuthor.results.length > 0, `${byAuthor.results.length} results`);
assert('and says it matched on the author where it did',
  byAuthor.results.some((r) => r.matchedOn === 'author' || r.matchedOn === 'title'),
  byAuthor.results.map((r) => r.matchedOn).join(', '));

console.log(`\n${failures === 0 ? '  All checks passed.' : `  ${failures} check(s) failed.`}\n`);
await closeDb();
process.exit(failures === 0 ? 0 : 1);
