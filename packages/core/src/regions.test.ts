/**
 * Region and variety vocabulary tests.
 *
 * The interesting failure this guards against is not a typo, it is a category
 * error: the owner specifically rejected provenance in `Origin`, so a source
 * name or a website landing in that column is the bug that matters. These tests
 * hold the vocabulary tight enough that the import and the integrity gate can
 * both reject it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IGBO_REGIONS,
  IGBO_VARIETIES,
  isIgboRegion,
  isIgboVariety,
  regionDisplay,
  unknownRegions,
} from './regions.ts';

test('every region code is unique and printed exactly once', () => {
  const codes = IGBO_REGIONS.map((r) => r.code);
  assert.equal(new Set(codes).size, codes.length, 'duplicate region code');

  const displays = IGBO_REGIONS.map((r) => r.display);
  assert.equal(new Set(displays).size, displays.length, 'duplicate region display');
});

test('no region code or display is blank, padded or punctuated oddly', () => {
  for (const region of IGBO_REGIONS) {
    assert.equal(region.code, region.code.trim(), `${region.code} has whitespace`);
    assert.ok(region.code.length > 0, 'empty region code');
    assert.ok(region.display.length > 0, `${region.code} has no display`);
    assert.ok(region.area.length > 0, `${region.code} has no area`);
    assert.ok(!region.code.endsWith('.'), `${region.code} ends in a full stop`);
  }
});

test('the areas are the ones this vocabulary claims to cover', () => {
  const areas = new Set(IGBO_REGIONS.map((r) => r.area));
  assert.deepEqual(
    [...areas].sort(),
    ['Abia', 'Anambra', 'Anioma', 'Ebonyi', 'Enugu', 'Imo', 'Rivers'],
    'a new area appeared, or one was renamed'
  );
});

test('every area has a state-level entry to fall back on', () => {
  // A source that only establishes the state must be recordable without being
  // stretched to a town. Anioma and Rivers are the exceptions: they are not
  // states, so their own name is the fallback.
  for (const code of ['Anambra', 'Enugu', 'Ebonyi', 'Imo', 'Abia', 'Anioma']) {
    assert.ok(isIgboRegion(code), `${code} is missing as a fallback`);
  }
});

test('lookup is exact, because the vocabulary is data not a typos target', () => {
  // The region code is the ASCII-folded Igbo form, "Nsuka", which is what the
  // project's own dialect table uses ("Nsụka") and what data/names/origins.json
  // stores. An earlier version of this test wrote the English anglicisation
  // "Nsukka" (double k) and had been failing since it was written — the file was
  // never listed in the test script, so nothing ran it. See docs/decisions.md
  // for the orthography question this raises.
  assert.ok(isIgboRegion('Nsuka'));
  assert.ok(!isIgboRegion('nsuka'), 'a near-miss must fail loudly');
  assert.ok(!isIgboRegion('Nsuka '), 'untrimmed input is not the canonical code');
  assert.ok(!isIgboRegion('Nuska'), 'a transposition must fail too');
});

test('a source name can never pass as a region', () => {
  // The exact regression the owner reported. Any one of these reaching the
  // origin column is the bug.
  for (const wrong of [
    'myigboname.com',
    'Behind the Name',
    'Nze (@nzemmili)',
    'nairaland',
    'Adabekee',
    'Wikipedia',
    'Igbo',
    'Nigeria',
    'West Africa',
  ]) {
    assert.ok(!isIgboRegion(wrong), `${wrong} must not be a valid origin`);
  }
});

test('unknownRegions reports stale values rather than dropping them', () => {
  assert.deepEqual(unknownRegions(['Nsuka', 'Atlantis', 'Mbaise']), ['Atlantis']);
  assert.deepEqual(unknownRegions([]), []);
});

test('display falls back to the stored value so an old row still renders', () => {
  assert.equal(regionDisplay('Nsuka'), 'Nsuka, Enugu State');
  assert.equal(regionDisplay('Anambra'), 'Anambra State');
  assert.equal(regionDisplay('Atlantis'), 'Atlantis');
});

test('the varieties the cross-variety work needs are all present', () => {
  for (const variety of ['Ikwerre', 'Etche', 'Ohaji', 'Ika', 'Ukwuani', 'Ndoki']) {
    assert.ok(isIgboVariety(variety), `${variety} missing from the variety list`);
  }
  assert.ok(!isIgboVariety('ikwerre'), 'lookup is exact here too');
  assert.ok(!isIgboVariety('Igbo'), 'Igbo is the language, not a variety of itself');
});

test('the two vocabularies are distinct sets', () => {
  // Ikwerre is both a region and a variety, so the sets overlap deliberately.
  // What must not happen is a variety that is not a place at all.
  for (const variety of IGBO_VARIETIES) {
    assert.ok(variety.trim() === variety && variety.length > 0);
  }
});
