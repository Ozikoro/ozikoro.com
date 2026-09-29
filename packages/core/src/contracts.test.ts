/**
 * Tests for the frozen API contract machinery.
 *
 * The contract arrays themselves are asserted against real query results in
 * `packages/db/src/smoke.ts` (which needs a database). What is tested here is
 * the guard's own behaviour — specifically that it is not a no-op. A contract
 * check that cannot fail is worse than none, because it reads as coverage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertContract,
  contractViolations,
  IGBOAPI_V1_FIELD_MAP,
  MATCH_TYPES_V1,
  WORD_DETAIL_KEYS_V1,
  WORD_SUMMARY_KEYS_V1,
} from './contracts.ts';

test('a removed field is reported as a violation', () => {
  // Start from a fully compliant row, then remove exactly one field, so this
  // tests detection of removal rather than of general incompleteness.
  const complete: Record<string, unknown> = Object.fromEntries(
    WORD_SUMMARY_KEYS_V1.map((key) => [key, null])
  );
  delete complete.headword;

  const violations = contractViolations(complete, WORD_SUMMARY_KEYS_V1, 'WordSummary');
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /missing required key "headword"/);
});

test('an added field is allowed, because additive change is non-breaking', () => {
  const complete = Object.fromEntries(WORD_SUMMARY_KEYS_V1.map((k) => [k, null]));
  const withExtra = { ...complete, brandNewField: 'anything' };
  assert.deepEqual(contractViolations(withExtra, WORD_SUMMARY_KEYS_V1, 'WordSummary'), []);
});

test('assertContract throws with every violation listed at once', () => {
  assert.throws(
    () => assertContract({ id: 1 }, ['id', 'headword', 'slug'], 'WordSummary'),
    (error: Error) => {
      assert.match(error.message, /missing required key "headword"/);
      assert.match(error.message, /missing required key "slug"/);
      return true;
    }
  );
});

test('assertContract accepts a compliant object', () => {
  assert.doesNotThrow(() =>
    assertContract({ id: 1, headword: 'akwa' }, ['id', 'headword'], 'WordSummary')
  );
});

test('contract key lists contain no duplicates and no empty names', () => {
  for (const [name, contract] of Object.entries({
    WORD_SUMMARY_KEYS_V1,
    WORD_DETAIL_KEYS_V1,
    MATCH_TYPES_V1,
  })) {
    assert.equal(new Set(contract).size, contract.length, `${name} has duplicate keys`);
    for (const key of contract) assert.ok(key.length > 0, `${name} has an empty key`);
  }
});

test('word detail extends word summary rather than restating it', () => {
  // If detail ever stopped being a superset, every consumer would need to
  // special-case the two shapes.
  for (const key of WORD_SUMMARY_KEYS_V1) {
    assert.ok(
      (WORD_DETAIL_KEYS_V1 as readonly string[]).includes(key),
      `WordDetail is missing summary key "${key}"`
    );
  }
  assert.ok(WORD_DETAIL_KEYS_V1.length > WORD_SUMMARY_KEYS_V1.length);
});

test('the igboapi field map stays usable as migration guidance', () => {
  // These are the fields an existing igboapi.com integrator will look for first.
  for (const legacyField of ['word', 'wordClass', 'definitions', 'variations', 'stems', 'nsibidi']) {
    assert.ok(legacyField in IGBOAPI_V1_FIELD_MAP, `no mapping for "${legacyField}"`);
    assert.ok(
      IGBOAPI_V1_FIELD_MAP[legacyField]!.ozituma.length > 0,
      `mapping for "${legacyField}" has no target`
    );
  }
  // Deliberate divergences should say why, not just what.
  assert.match(IGBOAPI_V1_FIELD_MAP.word!.note ?? '', /Renamed/);
});
