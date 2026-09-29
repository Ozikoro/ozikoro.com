/**
 * Ndebe transliteration tests.
 *
 * The important test here is the CROSS-CHECK against the reference syllable
 * table, not the round-trip. The project this was derived from had 930 of its
 * 1,134 syllables numbered one codepoint too low, and its own round-trip test
 * could not detect it, because writing and reading shared the same wrong
 * arithmetic and agreed with each other perfectly.
 *
 *   "A self-consistent table round-trips perfectly; a round-trip test proves
 *    consistency, never correctness."
 *
 * So the formula in ndebe.ts is checked against an independent artefact — the
 * vendor-derived table of all 1,134 syllables — and the check is skipped with a
 * clear notice when that table is not present, rather than silently passing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  allSyllables,
  canTransliterate,
  NDEBE_BODIES,
  NDEBE_HOLE,
  NDEBE_TONES,
  NDEBE_VOWELS,
  syllableCodepoint,
  transliterate,
} from './ndebe.ts';

/** Reference table, from the Ndebe research in the IDE project. */
const REFERENCE =
  process.env.NDEBE_SYLLABLE_TABLE ??
  '/Users/nzeora/Projects/IDE/language/orthography/ndebe/ndebe-syllables.csv';

test('the syllabary is 42 bodies x 9 vowels x 3 tones', () => {
  assert.equal(NDEBE_BODIES.length, 42, '6 stems x 7 radicals');
  assert.equal(NDEBE_VOWELS.length, 9);
  assert.equal(NDEBE_TONES.length, 3);

  const all = allSyllables();
  assert.equal(all.length, 1134, '42 x 27');
});

test('every syllable gets a distinct codepoint', () => {
  const all = allSyllables();
  const codepoints = new Set(all.map((s) => s.codepoint));
  assert.equal(codepoints.size, 1134, 'no two syllables may share a codepoint');
});

test('the glyphless codepoint is never produced', () => {
  // U+E5CC carries no glyph, so a syllable assigned to it would render as
  // nothing. This is the exact failure the +1 correction exists to prevent.
  const all = allSyllables();
  assert.ok(
    !all.some((s) => s.codepoint === NDEBE_HOLE),
    'U+E5CC must never be assigned to a syllable'
  );
});

test('the syllable run spans U+E500 to U+E96E inclusive of the hole', () => {
  const all = allSyllables();
  const min = Math.min(...all.map((s) => s.codepoint));
  const max = Math.max(...all.map((s) => s.codepoint));

  assert.equal(min, 0xe500, 'first syllable');
  assert.equal(max, 0xe96e, 'last syllable');

  // 1,134 syllables occupy 1,135 codepoints because of the hole.
  assert.equal(max - min + 1, 1135);
});

test('the hole displaces every syllable from index 204 onward', () => {
  // Last syllable before the hole: body 7, vowel ụ (index 4), tone low (2).
  assert.equal(syllableCodepoint(7, 4, 2), 0xe500 + 203, 'U+E5CB, undisplaced');
  // First after it: body 7, vowel e (index 5), tone high (0).
  assert.equal(syllableCodepoint(7, 5, 0), 0xe500 + 204 + 1, 'U+E5CD, displaced');
  // The naive formula lands on the glyphless codepoint instead.
  assert.equal(0xe500 + 204, NDEBE_HOLE);
  assert.notEqual(syllableCodepoint(7, 5, 0), NDEBE_HOLE);
});

test('the formula reproduces the reference table exactly', (t) => {
  if (!existsSync(REFERENCE)) {
    t.diagnostic(
      `reference table not found at ${REFERENCE} — the strongest check is being SKIPPED. ` +
        'Set NDEBE_SYLLABLE_TABLE to run it.'
    );
    return;
  }

  const lines = readFileSync(REFERENCE, 'utf8').trim().split('\n');
  const header = lines[0]!.split(',');
  const cpAt = header.indexOf('codepoint');
  const bodyAt = header.indexOf('body');
  const vowelAt = header.indexOf('vowel');
  const toneAt = header.indexOf('tone');

  // Map the reference's body names back to body indices through NDEBE_BODIES,
  // so this compares an independent artefact rather than re-reading my own data.
  const bodyIndexByName = new Map<string, number>();
  NDEBE_BODIES.forEach((alternatives, index) => {
    bodyIndexByName.set(alternatives.join('/').toUpperCase(), index);
  });

  let checked = 0;
  const mismatches: string[] = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(',');
    const expected = parseInt(cells[cpAt]!.slice(2), 16);
    const body = bodyIndexByName.get(cells[bodyAt]!.toUpperCase());
    const vowel = NDEBE_VOWELS.indexOf(cells[vowelAt] as never);
    const tone = NDEBE_TONES.indexOf(cells[toneAt] as never);

    if (body === undefined || vowel < 0 || tone < 0) continue;

    const actual = syllableCodepoint(body, vowel, tone);
    checked += 1;
    if (actual !== expected && mismatches.length < 5) {
      mismatches.push(
        `${cells[bodyAt]} ${cells[vowelAt]}/${cells[toneAt]}: expected U+${expected.toString(16).toUpperCase()}, got U+${actual.toString(16).toUpperCase()}`
      );
    }
  }

  assert.ok(checked > 1100, `expected to check the whole table, checked ${checked}`);
  assert.deepEqual(mismatches, [], 'formula disagrees with the reference table');
  t.diagnostic(`cross-checked ${checked} syllables against ${REFERENCE}`);
});

test('transliterates real Igbo words into Ndebe', () => {
  for (const word of ['nwa', 'mmiri', 'akwa', 'ụlọ', 'ọdịnala', 'gba', 'kpọ']) {
    const result = transliterate(word);
    assert.ok(result.syllables.length > 0, `${word} produced no syllables`);
    assert.equal(result.unhandled, '', `${word} left "${result.unhandled}" unwritten`);
    assert.equal(result.text.length, result.syllables.length, 'one glyph code unit per syllable');
  }
});

test('a syllable’s three tones are three different codepoints', () => {
  // Tone is not an accent on the syllable, it is a different glyph, so the
  // romanisation being identical is expected and the codepoints must differ.
  const mid = transliterate('nwa');
  const high = transliterate('nwá');
  const low = transliterate('nwà');

  assert.equal(mid.syllables[0]!.roman, high.syllables[0]!.roman);
  assert.equal(mid.syllables[0]!.roman, low.syllables[0]!.roman);

  const set = new Set([mid.syllables[0]!.codepoint, high.syllables[0]!.codepoint, low.syllables[0]!.codepoint]);
  assert.equal(set.size, 3, 'high, mid and low must be three distinct glyphs');
});

test('letters with no Ndebe body are reported, not guessed at', () => {
  // "x" is not an Igbo letter and has no body, so it must surface rather than
  // being dropped silently or mapped to the nearest thing.
  const result = transliterate('nwax');
  assert.ok(result.unhandled.includes('x'), 'unwritable letters must be reported');
  assert.equal(canTransliterate('nwax'), false);
  assert.equal(canTransliterate('nwa'), true);
});

test('every body alternative is recognised', () => {
  // Several bodies serve more than one consonant — G/V, N/L/Y, NY/Ṇ — which is
  // the script covering dialect variation with one written form.
  for (const alternatives of NDEBE_BODIES) {
    for (const letters of alternatives) {
      const result = transliterate(`${letters}a`);
      assert.equal(result.unhandled, '', `${letters}a was not written`);
      assert.equal(result.syllables.length, 1, `${letters}a is one syllable`);
    }
  }
});

/**
 * Tone on a DOTTED vowel.
 *
 * This is the test that was missing, and its absence is why a real defect lived
 * in this module: the tone test above uses `nwa`, whose vowel is a plain `a`
 * whose acute form is a single precomposed codepoint. Dotted vowels have no
 * precomposed form — `ọ̀` is `o` + U+0323 + U+0300 — so the tone reader was
 * being handed one character and never seeing the accent. Every `ị`, `ọ`, `ụ`
 * and `ẹ` in the language silently came out mid, which in a language where tone
 * distinguishes àkwà (bed) from ákwá (cry) is not a cosmetic bug.
 */
test('tone survives on dotted vowels, which have no precomposed form', () => {
  const cases: [string, string][] = [
    ['ọ̀', 'low'],
    ['ọ́', 'high'],
    ['ọ', 'mid'],
    ['ị̀', 'low'],
    ['ị́', 'high'],
    ['ụ̀', 'low'],
    ['ẹ́', 'high'],
  ];
  for (const [word, tone] of cases) {
    const result = transliterate(word);
    assert.equal(result.syllables.length, 1, `${word} is one syllable`);
    assert.equal(result.syllables[0]!.tone, tone, `${word} should be ${tone}`);
  }
});

test('the three tones of a dotted vowel are three different glyphs', () => {
  const mid = transliterate('ọ');
  const high = transliterate('ọ́');
  const low = transliterate('ọ̀');
  const set = new Set([
    mid.syllables[0]!.codepoint,
    high.syllables[0]!.codepoint,
    low.syllables[0]!.codepoint,
  ]);
  assert.equal(set.size, 3, 'ọ mid, high and low must be three distinct glyphs');
});

test('a whole word keeps every tone it was written with', () => {
  const result = transliterate('ụ̀lọ̀');
  assert.equal(result.unhandled, '');
  assert.deepEqual(
    result.syllables.map((s) => s.tone),
    ['low', 'low'],
    'ụ̀lọ̀ is low-low'
  );
});

/**
 * The syllabic nasal is tone-bearing and is not a vowel.
 *
 * `ḿ` (high) and `ǹ` (low) are precomposed codepoints, so they also test the
 * decision to decompose the input at the door: a precomposed `ǹ` matches
 * neither the body `n` nor a combining grave, and used to be reported as a
 * letter with no Ndebe form.
 */
test('the syllabic nasal carries its own tone', () => {
  const cases: [string, string][] = [
    ['ḿ', 'high'],
    ['ń', 'high'],
    ['ǹ', 'low'],
    ['m̀', 'low'],
    ['m', 'mid'],
    ['n', 'mid'],
  ];
  for (const [word, tone] of cases) {
    const result = transliterate(word);
    assert.equal(result.unhandled, '', `${word} must be writable`);
    assert.equal(result.syllables.length, 1, `${word} is one syllable`);
    assert.equal(result.syllables[0]!.tone, tone, `${word} should be ${tone}`);
    assert.equal(result.syllables[0]!.body, -2, `${word} is the syllabic nasal`);
  }
});

test('a tone-marked nasal in a word keeps its tone and the word stays writable', () => {
  const result = transliterate('ǹdè');
  assert.equal(result.unhandled, '');
  assert.deepEqual(result.syllables.map((s) => s.tone), ['low', 'low']);
  assert.equal(canTransliterate('ǹdèbè'), true);
});

/**
 * A space separates words; it is not a letter without a Ndebe form.
 *
 * Counting it as unhandled made every phrase unreadable — `canTransliterate`
 * returned false for "ákwá ọ́ma" purely because it contains a space.
 */
test('spaces separate words without counting as unwritable letters', () => {
  const result = transliterate('ákwá ọ́ma');
  assert.equal(result.unhandled, '', 'a space is not an unreadable letter');
  assert.equal(canTransliterate('ákwá ọ́ma'), true);
  assert.ok(result.text.includes(' '), 'the word break is kept in the output');
  assert.deepEqual(
    result.syllables.map((s) => s.tone),
    ['high', 'high', 'high', 'mid']
  );
});

test('a dotted vowel with tone round-trips to a distinct codepoint per tone', () => {
  // The same vowel, the same body, three tones: nothing else may change.
  const runs = ['ọ́má', 'ọma', 'ọ̀mà'].map((w) => transliterate(w));
  for (const run of runs) assert.equal(run.unhandled, '');
  assert.equal(new Set(runs.map((r) => r.syllables[0]!.codepoint)).size, 3);
  // ...and the following syllable differs too, so the fix is per-syllable and
  // not a single lucky codepoint.
  assert.equal(new Set(runs.map((r) => r.syllables[1]!.codepoint)).size, 3);
});

/**
 * Punctuation is carried over, not counted as unreadable.
 *
 * The corpus contains affix entries written "-fu" and glosses that leaked into
 * headwords, "(agwa) -ma" and "-gabiga (compare - gafega)". Treating a hyphen,
 * bracket, apostrophe or digit as a letter with no Ndebe form rejected 4,278 of
 * 8,822 words, of which 4,131 were rejected by a hyphen alone. What Ndebe writes
 * is the letters; the punctuation is what the entry is written with.
 */
test('punctuation passes through without counting as unwritable', () => {
  for (const word of ['-fu', '(agwa) -ma', "n'ọkụ", 'nwa-', 'ọkụ?', '1']) {
    const result = transliterate(word);
    assert.equal(result.unhandled, '', `${word} has no unreadable letter`);
  }
  // ...and it is still present in the output, so the entry reads as the entry.
  const affix = transliterate('-fu');
  assert.ok(affix.text.startsWith('-'), 'the affix hyphen is kept');
  assert.equal(affix.syllables.length, 1, 'the hyphen is not a syllable');
});

test('a word that is only punctuation has no syllables, and says so', () => {
  // The corpus really does contain a bare apostrophe as a headword. It has no
  // Ndebe form because it has no letters, which is different from a letter that
  // could not be written — `unhandled` stays empty and the caller can see the
  // syllable count.
  const result = transliterate("'");
  assert.equal(result.unhandled, '');
  assert.equal(result.syllables.length, 0);
  assert.equal(canTransliterate("'"), false);
});

test('a letter with no Ndebe body is still reported, punctuation or not', () => {
  // The pass-through must not become a way of silently dropping real letters.
  const result = transliterate('-ŋa');
  assert.equal(result.unhandled, 'ŋ', 'ŋ has no body and must be reported');
  assert.equal(canTransliterate('-ŋa'), false);
});

/**
 * A syllabary cannot write a consonant without its vowel, and says so.
 *
 * "kp'u" elides the vowel the syllable needs. This is not punctuation being
 * mishandled: the apostrophe is carried over correctly, and what cannot be
 * written is the bare `kp` in front of it. Only three headwords in the Igbo
 * corpus are built this way, so it is a limitation worth stating rather than a
 * rule to invent — guessing a vowel here would be writing a word the author did
 * not write.
 */
test('a consonant whose vowel was elided is reported, not guessed at', () => {
  const result = transliterate("kp'u");
  assert.equal(result.unhandled, 'kp', 'the vowel-less consonant must surface');
  assert.equal(canTransliterate("kp'u"), false);
  // The apostrophe itself is still fine when it follows a vowel.
  assert.equal(canTransliterate("n'ọkụ"), true);
});

/**
 * An orphaned combining mark is a broken spelling, not punctuation.
 *
 * Seven headwords in the Igbo corpus begin with a mark whose letter was
 * separated from it during an import — "̣òkwelagha" starts with a bare underdot.
 * Carrying that through put a combining character at the start of a stored
 * value, where it renders as a stray dot glued to nothing.
 *
 * The near-miss here is the reason this test exists at all: every healthy
 * cluster with an underdot or a tone ALSO contains a mark, so "does this
 * cluster contain a combining mark" is the wrong question and would reject
 * ụ̀lọ̀. The question is "is there a letter in it".
 */
test('a combining mark with no letter under it is reported, not passed through', () => {
  const orphanUnderdot = `\u0323òkwelagha`;
  const orphanGrave = `\u0300mmụ̀ta`;
  for (const word of [orphanUnderdot, orphanGrave]) {
    const result = transliterate(word);
    assert.notEqual(result.unhandled, '', `${JSON.stringify(word)} must report its orphan mark`);
    assert.equal(canTransliterate(word), false);
    // What WAS writable is still written: the fault is one character, not the word.
    assert.ok(result.syllables.length > 0, 'the letters after the orphan still transliterate');
  }
  // ...and the healthy forms of the same marks are untouched.
  assert.equal(transliterate('ụ̀lọ̀').unhandled, '');
  assert.equal(transliterate('m̀mụ̀ta').unhandled, '');
});
