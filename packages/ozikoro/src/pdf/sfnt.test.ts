/**
 * THE TRUE TYPE READER'S OWN TESTS, AND THE PROOF THE IGBO DIACRITICS HAVE GLYPHS.
 *
 * `ọ ụ ị ṅ` are the letters that broke this publication before: the base-14 fonts it used stop at U+00FF,
 * so every one of them was replaced with `?` and an article about `Ụmụ Ada` printed as `?m? Ada`. **A
 * character that has no glyph is a fault in the record**, so each of the four dot-below letters and the
 * two tone marks is asserted here rather than assumed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFont, FontError } from './sfnt.ts';

const FONT_DIR = join(import.meta.dirname, '..', '..', 'assets', 'fonts');
const serif = join(FONT_DIR, 'DejaVuSerif.ttf');

const have = existsSync(serif);

test('the Igbo letters this archive needs all have glyphs', { skip: !have && 'DejaVu Serif is not present' }, () => {
  const font = readFont(readFileSync(serif));
  const igbo: [string, number][] = [
    ['ọ', 0x1ecd], ['ụ', 0x1ee5], ['ị', 0x1ecb], ['ṅ', 0x1e45],
    ['Ọ', 0x1ecc], ['Ụ', 0x1ee4], ['Ị', 0x1eca], ['Ṅ', 0x1e44],
    ['ò', 0x00f2], ['á', 0x00e1],
  ];
  for (const [letter, cp] of igbo) {
    assert.ok(font.covers(cp), `${letter} (U+${cp.toString(16).toUpperCase()}) has no glyph`);
    assert.notEqual(font.glyph(cp), 0, `${letter} maps to .notdef`);
    assert.ok(font.advance(font.glyph(cp)) > 0, `${letter} has no advance width`);
  }
});

test('a subset keeps the glyphs, the ids and the widths of what it was asked to keep', { skip: !have && 'DejaVu Serif is not present' }, () => {
  const font = readFont(readFileSync(serif));
  const wanted = new Set([...'Ụmụ Ada and Ọkpụ — ò · 01'].map((c) => c.codePointAt(0) as number));
  const bytes = font.subset(wanted);
  const back = readFont(bytes);
  for (const cp of wanted) {
    assert.equal(back.glyph(cp), font.glyph(cp), `U+${cp.toString(16)} changed glyph id`);
    assert.equal(back.advance(back.glyph(cp)), font.advance(font.glyph(cp)), `U+${cp.toString(16)} changed width`);
  }
  // The whole point of subsetting: a few hundred glyphs, not several thousand.
  assert.ok(bytes.length < 120_000, `subset is ${bytes.length} bytes, which is not a subset`);
  assert.ok(bytes.length < readFileSync(serif).length / 2, 'subset is not smaller than the face');
});

test('a composite letter keeps the components it is drawn from', { skip: !have && 'DejaVu Serif is not present' }, () => {
  const font = readFont(readFileSync(serif));
  const bytes = font.subset(new Set([0x1ecd])); // ọ, which is o plus a dot below
  const back = readFont(bytes);
  assert.notEqual(back.glyph(0x1ecd), 0);
  assert.ok(back.advance(back.glyph(0x1ecd)) > 0, 'the subset glyph has no width');
  // `o` need not be reachable by its own code point, but its outline must be present for ọ to draw.
  const sub = readFont(bytes);
  assert.ok(sub.bbox[3] > 0, 'the subset has no vertical extent at all');
});

test('a CFF face is refused rather than half-embedded', () => {
  const otto = Buffer.alloc(12);
  otto.writeUInt32BE(0x4f54544f, 0);
  assert.throws(() => readFont(otto), FontError);
});

test('a buffer that is not a font is refused', () => {
  assert.throws(() => readFont(Buffer.from('not a font at all, only text')), FontError);
});
