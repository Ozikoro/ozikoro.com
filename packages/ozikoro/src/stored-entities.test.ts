/**
 * The stored-entity decode, and the two halves that must both hold.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT
 *
 * A repair that decodes stored entities is wrong in two opposite directions and neither one is loud:
 *
 *   * **too little** — the entity is still printed at the reader, which is the fault the owner reported;
 *   * **too much** — a literal `&`, or a name that is not an entity at all, is rewritten, which is
 *     fabricating a character into a title a person wrote.
 *
 * The second is the one that survives review, because the page it breaks is not the page that was
 * reported. So both are asserted, and the assertion is made on **the markup a reader is served**
 * (`esc` is the archive's own escaper, the same one `design-fill.ts` writes every design screen with)
 * rather than on the decode alone.
 *
 * Run with: node --test src/stored-entities.test.ts   (or: npm -w @ozikoro/platform run test)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStoredEntities, hasStoredEntities, storedEntityTokens } from './stored-entities.ts';
import { esc } from './design-fill.ts';

/** The title the owner reported, exactly as the WordPress import stored it. */
const OJEH_STORED = 'Ojeh &#038; Arishi Festival of Aboh Kingdom: A Celebration of Igbo Culture';
/** The same title as a person would type it. */
const OJEH_PLAIN = 'Ojeh & Arishi Festival of Aboh Kingdom: A Celebration of Igbo Culture';

test('a stored &#038; decodes to an ampersand', () => {
  assert.equal(decodeStoredEntities(OJEH_STORED), OJEH_PLAIN);
});

test('a stored &#038; renders as & in the markup a reader is served', () => {
  // `&amp;` in the source is one ampersand on the page. `&amp;#038;` is what the reader saw printed.
  assert.equal(esc(decodeStoredEntities(OJEH_STORED)), 'Ojeh &amp; Arishi Festival of Aboh Kingdom: A Celebration of Igbo Culture');
  assert.ok(!esc(decodeStoredEntities(OJEH_STORED)).includes('#038;'));
});

test('a literal & is untouched by the decode and still escaped on the way out', () => {
  // THE HALF THAT CATCHES A REPAIR WHICH DECODES TOO MUCH. `R&D` holds no entity reference, so the
  // decode must return it byte-identical; the escaper then writes `&amp;`, which is one `&` on the page.
  assert.equal(decodeStoredEntities(OJEH_PLAIN), OJEH_PLAIN);
  assert.equal(decodeStoredEntities('R&D'), 'R&D');
  assert.equal(decodeStoredEntities('Uche & Sons, 1903'), 'Uche & Sons, 1903');
  assert.equal(esc(decodeStoredEntities(OJEH_PLAIN)), 'Ojeh &amp; Arishi Festival of Aboh Kingdom: A Celebration of Igbo Culture');
  assert.equal(esc(decodeStoredEntities('R&D')), 'R&amp;D');
});

test('an entity escaped twice decodes all the way, not halfway', () => {
  // The second fault class named in the brief. One pass would leave `&#038;`, which is still printed.
  assert.equal(
    decodeStoredEntities('Ojeh &amp;#038; Arishi Festival of Aboh Kingdom: A Celebration of Igbo Culture'),
    OJEH_PLAIN
  );
  assert.equal(esc(decodeStoredEntities('Ojeh &amp;#038; Arishi')), 'Ojeh &amp; Arishi');
  assert.equal(decodeStoredEntities('A &amp;amp; B'), 'A & B');
});

test('the numeric and hexadecimal references the archive actually stores decode', () => {
  // Measured in the cluster on 2026-10-06: 128 rows hold &#215; and 10 hold &#8230;.
  assert.equal(decodeStoredEntities('image-768&#215;576'), 'image-768\u00d7576');
  assert.equal(decodeStoredEntities('Twins [&#8230;]'), 'Twins [\u2026]');
  assert.equal(decodeStoredEntities('&#x1f64f; Yes, I am'), '\u{1f64f} Yes, I am');
  assert.equal(decodeStoredEntities('&#X26;'), '&');
  assert.equal(decodeStoredEntities('&#38;'), '&');
  assert.equal(decodeStoredEntities('&nbsp;'), '\u00a0');
  assert.equal(decodeStoredEntities('&times; &hellip; &rsquo;'), '\u00d7 \u2026 \u2019');
});

test('a name that is not an entity is left exactly as written', () => {
  // `AT&T;` holds `&T;`. A pattern-driven decode would throw or invent a character; both are fabrication.
  for (const value of ['AT&T;', 'M&A;', 'Fish &Chips;', 'R&D', '&#;', '&#x;', '&;', '& a b c;']) {
    assert.equal(decodeStoredEntities(value), value, value);
  }
});

test('a reference that names no character is left exactly as written', () => {
  // Above U+10FFFF, and inside the surrogate range, `String.fromCodePoint` throws — so these must not
  // reach it. Leaving the token is the only outcome that neither throws nor invents.
  for (const value of ['&#1114112;', '&#x110000;', '&#xD800;', '&#55296;', '&#9999999;']) {
    assert.equal(decodeStoredEntities(value), value, value);
  }
});

test('a value with no entity reference comes back byte-identical', () => {
  // The property that makes this safe to run over a whole column: a title a person wrote is not touched.
  const clean = [
    'Awka to London: David Nwume and John Uzoka The Awka Blacksmiths',
    'Umueri: The Ancestral Homeland Of Eri and The Children of Eri',
    'Ọ̀nịchạ: the town the British called Onitsha',
    'A stop & gossip on the road from Owerrinta to Owerri',
    '100% of nothing; 3 < 4 > 2 "quoted" \'apostrophe\'',
    '',
  ];
  for (const value of clean) {
    assert.equal(decodeStoredEntities(value), value, value);
    assert.equal(hasStoredEntities(value), false, value);
  }
});

test('decoding is idempotent — running the repair twice changes nothing the second time', () => {
  for (const value of [OJEH_STORED, OJEH_PLAIN, '&amp;#038;', '&#215;', 'AT&T;', '&#xD800;']) {
    const once = decodeStoredEntities(value);
    assert.equal(decodeStoredEntities(once), once, value);
  }
});

test('a prose body is markup, and this is why the repair refuses body_html', () => {
  // `&lt;div&gt;` in a published body is a WRITTEN tag, shown as text on the page. Decoding it would
  // turn it into a real element, which is why `scripts/repair-stored-entities.ts` excludes body_html
  // and why this assertion is here rather than in the script's comments.
  assert.equal(decodeStoredEntities('<p>a &amp; b</p>'), '<p>a & b</p>');
  assert.equal(decodeStoredEntities('&lt;div&gt;not a tag&lt;/div&gt;'), '<div>not a tag</div>');
});

test('the token list is for reporting, and reports only what would be decoded', () => {
  assert.deepEqual(storedEntityTokens('Ojeh &#038; Arishi &amp; Co'), ['&#038;', '&amp;']);
  assert.deepEqual(storedEntityTokens('AT&T; &#xD800;'), []);
  assert.deepEqual(storedEntityTokens('plain title'), []);
});
