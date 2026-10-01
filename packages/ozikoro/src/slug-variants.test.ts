/**
 * The spellings one address can arrive as — and the one that was missing.
 *
 * WHY THIS FILE EXISTS
 *
 * An article was unreachable for eight rounds. The cause, found only by logging what the route actually
 * receives, was that Next hands over the URL segment still percent-encoded with UPPERCASE hex
 * (`%C7%B9`) while the import had stored lowercase (`%c7%b9`). `slugVariants` already tried the slug as
 * given, its encodeURIComponent form, that lowercased, and the decoded form — **none of which is the
 * lowercased slug itself.**
 *
 * That one missing line was fixed in rounds 63 and 64 across five public lookups, and **no test was
 * written for it**, which is the same gap round 46 identified for the authorization fix: a fix without
 * a regression test is a fix that reverts quietly the next time somebody tidies the file.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugVariants } from './archive.ts';

/** The exact pair from the real archive, which is what made this findable at all. */
const RECEIVED = 'entrance-to-an-igbo-compound-%C7%B9gwulu-onitsha-1903-1918-herbert-wimberley';
const STORED = 'entrance-to-an-igbo-compound-%c7%b9gwulu-onitsha-1903-1918-herbert-wimberley';

test('the lowercased slug is among the variants — the round-63 bug', () => {
  assert.ok(
    slugVariants(RECEIVED).includes(STORED),
    `the stored form must be a candidate; got ${JSON.stringify(slugVariants(RECEIVED))}`
  );
});

test('an incoming slug is always its own variant', () => {
  assert.ok(slugVariants(STORED).includes(STORED));
  assert.ok(slugVariants('art').includes('art'));
});

test('the decoded form is a variant, so a request written with the character works', () => {
  const decorated = slugVariants('entrance-to-an-igbo-compound-%C7%B9gwulu');
  assert.ok(
    decorated.some((v) => v.includes('\u01F9')),
    'the decoded character must be offered, because a reader may type or paste it'
  );
});

/*
 * `encodeURIComponent` escapes the literal `%`, so its output can never equal a slug that already
 * contains an escape. That is precisely why it could not cover this case, and why the raw lowercased
 * form had to be added separately rather than being assumed to fall out of the encoding step.
 */
test('the encodeURIComponent form escapes the literal percent, so it cannot cover this case', () => {
  const encoded = slugVariants(RECEIVED).find((v) => v.includes('%25'));
  assert.ok(encoded, 'the escaped form should still be offered');
  assert.notEqual(encoded, STORED, 'and it is NOT the stored form — hence the bug');
});

test('a slug with no escapes still yields a usable set and no duplicates', () => {
  const variants = slugVariants('ute-okpu-an-ika-igbo-clan-and-its-nri-roots');
  assert.ok(variants.includes('ute-okpu-an-ika-igbo-clan-and-its-nri-roots'));
  assert.equal(new Set(variants).size, variants.length, 'variants are deduplicated');
});

test('a malformed escape does not throw', () => {
  // A lone percent, which decodeURIComponent rejects. The lookup must still have candidates.
  const variants = slugVariants('100%-pure');
  assert.ok(variants.includes('100%-pure'));
});
