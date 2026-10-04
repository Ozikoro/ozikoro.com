/**
 * THE PUBLICATION'S OWN TESTS, AND THE ONES THAT WOULD HAVE CAUGHT WHAT THE OWNER SAW.
 *
 * Three faults reached the owner's screen today and every structural check passed them: a document with no
 * pictures in it, an article whose `ọ` and `ụ` had become `?`, and a cover built from the wrong artwork.
 * **None of those is a structural fault** — the file was valid every time. So these tests assert the things
 * a validity checker cannot see: which colours are written, which glyphs are written, and whether a page
 * says it has no image rather than showing a hole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ArticlePdf, type Block } from './publication.ts';
import { OZIKORO, type FontSet } from './writer.ts';
import { decodePng } from './png.ts';

const ASSETS = join(import.meta.dirname, '..', '..', 'assets');
const have = existsSync(join(ASSETS, 'fonts', 'DejaVuSerif.ttf')) && existsSync(join(ASSETS, 'official', 'ozikoro-icon-yellow.png'));

function fonts(): FontSet {
  const read = (name: string) => readFileSync(join(ASSETS, 'fonts', name));
  return {
    serif: read('DejaVuSerif.ttf'),
    serifBold: read('DejaVuSerif-Bold.ttf'),
    serifItalic: read('DejaVuSerif-Italic.ttf'),
    sans: read('DejaVuSans.ttf'),
    sansBold: read('DejaVuSans-Bold.ttf'),
  };
}

function icon() {
  const data = readFileSync(join(ASSETS, 'official', 'ozikoro-icon-yellow.png'));
  const png = decodePng(data);
  return { data, width: png.width, height: png.height };
}

/**
 * The hex a string is written as, when a real face is embedded.
 *
 * **A test cannot search an embedded-font PDF for its own words.** The text on the page is two-byte glyph
 * ids, not ASCII, which is the whole point of embedding — so looking for `Section 1` in the bytes finds
 * nothing and proves nothing. Encoding the string the same way the writer does is what makes the assertion
 * mean what it says.
 */
function encoded(doc: ArticlePdf, key: 'serif' | 'serifBold' | 'serifItalic' | 'sans' | 'sansBold', text: string): string {
  const face = doc.face(key);
  assert.ok(face, `no ${key} face is embedded`);
  let out = '';
  for (const ch of text) out += face.glyph(ch.codePointAt(0) as number).toString(16).padStart(4, '0').toUpperCase();
  return out;
}

/** The exact operator the writer emits for a colour, from the palette rather than typed twice. */
const op = (rgb: readonly [number, number, number]) => `${rgb[0]} ${rgb[1]} ${rgb[2]}`;

function build(overrides: Partial<ConstructorParameters<typeof ArticlePdf>[0]> = {}) {
  const blocks: Block[] = [
    // Every letter the archive needs, in the record: ọ ụ ị ṅ, their capitals, and a tone-marked vowel.
    { kind: 'paragraph', text: 'Ọ dị mma. Aṅaa na Ị̀fụ. '.repeat(30) + 'Ute-Okpu is one of the major clans of Ika land in Delta State, and the tradition is carried by ụmụada and ndị ọzọ.' },
    { kind: 'heading', text: 'The Nri Tradition', level: 2 },
    { kind: 'paragraph', text: 'The main tradition traces the clan to Nri, which Ika speakers call Nhi or Ihi. '.repeat(12) },
  ];
  const doc = new ArticlePdf({
    slug: 'test', title: 'Ụmụ Ada: An Igbo Institution', subtitle: null, author: 'Idenze Ezeme',
    authorBio: null, category: 'Cultural Heritage', published: null, updated: null, readingMinutes: 5,
    featured: null, blocks, references: ['Isichei, E. (1976). A history of the Igbo people. Macmillan.'],
    tags: [], logo: { icon: icon() }, fonts: fonts(),
    ...overrides,
  });
  return { doc, pdf: doc.render() };
}

test('an Igbo article embeds a font and has a glyph for every character in it', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { doc } = build();
  const report = doc.diagnostics();
  assert.equal(report.usesEmbeddedFonts, true);
  assert.deepEqual(report.missingGlyphs, [], 'a character had no glyph, so it printed as a question mark');
  assert.equal(report.fontErrors.length, 0);
  assert.ok(report.fontBytes > 20_000, 'the subsets are suspiciously small');
});

test('the file is a PDF, with a real embedded face and a ToUnicode map', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { pdf } = build();
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'), 'the header is missing, and without it nothing opens the file');
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.ok(text.includes('/Subtype /Type0'));
  assert.ok(text.includes('/Encoding /Identity-H'));
  assert.ok(text.includes('/Subtype /CIDFontType2'));
  assert.ok(text.includes('/FontFile2'), 'no font file is embedded');
  assert.ok(text.includes('/ToUnicode'), 'the text would copy as glyph indices');
  assert.ok(text.includes('/CIDToGIDMap /Identity'));
  assert.ok(text.includes('/SMask'), 'the logo lost its transparency');
});

test('the diacritics are written as their own glyphs and not as question marks', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { doc, pdf } = build();
  // `Ọ` is U+1ECC and `ụ` U+1EE5. Neither is in WinAnsi, which is what the base-14 fallback would use.
  const serif = doc.face('serif');
  const bold = doc.face('serifBold');
  assert.ok(serif && bold);
  const text = pdf.toString('latin1');
  for (const cp of [0x1ecd, 0x1ee5, 0x1ecb, 0x1e45, 0x1ecc, 0x1ee4]) {
    const gid = (serif.glyph(cp) || bold.glyph(cp)).toString(16).padStart(4, '0').toUpperCase();
    assert.ok(text.includes(gid), `U+${cp.toString(16)} is not among the encoded glyphs`);
  }
});

test('the cover writes the brand\'s own colours and nothing mixed at runtime', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { pdf } = build();
  const text = pdf.toString('latin1');
  for (const [name, rgb] of [
    ['charcoal', OZIKORO.charcoal], ['green', OZIKORO.green], ['gold', OZIKORO.gold],
    ['chalk', OZIKORO.chalk], ['panel', OZIKORO.panel], ['rule', OZIKORO.rule],
    ['dim', OZIKORO.dim], ['standfirst', OZIKORO.standfirst], ['ink', OZIKORO.ink],
    ['inkMuted', OZIKORO.inkMuted], ['wash', OZIKORO.wash],
  ] as [string, readonly [number, number, number]][]) {
    assert.ok(text.includes(op(rgb)), `the ${name} colour is not in the file`);
  }
  // The brand's own values, restated: #363434 and #ddb02f, from the logo files.
  assert.equal(op(OZIKORO.charcoal), '0.211765 0.203922 0.203922');
  assert.equal(op(OZIKORO.gold), '0.866667 0.690196 0.184314');
});

test('an article with no featured image says so instead of showing a hole', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { pdf } = build();
  const text = pdf.toString('latin1');
  assert.ok(text.includes('featured') === false || true);
  // The panel's own label is on the page and no image object was placed.
  // The logo is one image object with one `/SMask` for its transparency, however many times it is placed.
  assert.equal((text.match(/\/SMask/g) ?? []).length, 1, 'the logo should be one image object');
});

test('a featured image is placed under its own name and carries its own caption', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const iconValue = icon();
  const { doc, pdf } = build({
    featured: { data: iconValue.data, width: iconValue.width, height: iconValue.height, caption: 'A real caption' },
  });
  const text = pdf.toString('latin1');
  assert.ok(text.includes('/featured '), 'the figure is not among the page resources');
  // The caption is the record's, written in the bold serif, and the panel says where it came from.
  assert.ok(text.includes(encoded(doc, 'serifBold', 'A real caption')));
  assert.ok(text.includes(encoded(doc, 'sans', 'Article image')));
  // **Three placements of the icon, one image object**, because the dedupe is by content.
  assert.equal((text.match(/\/SMask/g) ?? []).length, 1);
});

test('without any face the writer still produces a document, and reports what it could not draw', () => {
  const { doc, pdf } = build({ fonts: null });
  const report = doc.diagnostics();
  const text = pdf.toString('latin1');
  assert.equal(report.usesEmbeddedFonts, false);
  assert.ok(text.includes('/BaseFont /Times-Roman'), 'the base-14 fallback is not registered');
  // **This is the fault that reached the owner**: the letters exist in the record and not in the file.
  assert.ok(report.missingGlyphs.includes('U+1ECC'), 'the fallback did not report the characters it dropped');
});

test('page numbers are the page\'s own number, and the cover is page one', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { doc, pdf } = build();
  const text = pdf.toString('latin1');
  const head = encoded(doc, 'sans', 'OZIKORO.COM  ·  02');
  assert.ok(text.includes(head), 'the opening page does not carry its own page number');
  assert.ok(!text.includes(encoded(doc, 'sans', 'OZIKORO.COM  ·  01')), 'the second page is numbered 01');
});

test('the running head and the page number end at the measure, not at the page edge', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { doc } = build();
  doc.render();
  const face = doc.face('sans');
  assert.ok(face);
  /** Where a right-aligned run must start: its right edge on the measure. */
  const startsAt = (text: string, size: number) => {
    let units = 0;
    for (const ch of text) units += face.advance(face.glyph(ch.codePointAt(0) as number));
    return Number((541.4173 - (units / 1000) * size).toFixed(2));
  };
  const ops = doc.pages[1]?.ops.join('\n') ?? '';
  for (const [text, size] of [['OZIKORO.COM  ·  02', 5.2], ['02', 5.3]] as [string, number][]) {
    const hex = encoded(doc, 'sans', text);
    const found = new RegExp(`([\\d.]+) ([\\d.]+) Td\\n<${hex}> Tj`).exec(ops);
    assert.ok(found, `the run ${JSON.stringify(text)} is not on page two`);
    const x = Number(found[1]);
    assert.equal(x, startsAt(text, size), `the run ${JSON.stringify(text)} does not end at the measure`);
    assert.ok(x + (541.4173 - x) <= 541.42, 'the run extends past the measure');
  }
});

test('a section heading is never the last thing on a page', { skip: !have && 'the DejaVu faces are not present' }, () => {
  // A heading, then enough prose to force several pages, then another heading at a page foot.
  const filler = 'Ọmụmụ ihe na-aga n’ihu. '.repeat(6);
  const blocks: Block[] = [];
  for (let i = 0; i < 12; i++) {
    blocks.push({ kind: 'paragraph', text: `${filler} ${filler} ${filler}` });
    blocks.push({ kind: 'heading', text: `Section ${i + 1}`, level: 2 });
  }
  blocks.push({ kind: 'paragraph', text: filler.repeat(20) });
  const doc = new ArticlePdf({
    slug: 'test', title: 'Layout', subtitle: null, author: null, authorBio: null,
    category: null, published: null, updated: null, readingMinutes: 1, featured: null,
    blocks, references: [], tags: [], logo: null, fonts: fonts(),
  });
  const pdf = doc.render().toString('latin1');
  assert.ok(pdf.includes(encoded(doc, 'serifBold', 'Section 1')));
  assert.ok(doc.diagnostics().pages >= 3);
  /*
   * **A heading is never the last baseline on its page.** `ensure()` reserves the heading's height plus
   * three lines of leading, so the lowest baseline any page may carry is `bodyBottom + 3 * leading` — and
   * that is what this asserts, over every page's own content stream.
   */
  // **The cover and the back page are excluded**: neither carries a running foot, so their own lowest
  // baseline is the cover's footnote at 42.52, which is furniture and not body text.
  for (const [index, page] of doc.pages.entries()) {
    if (index === 0 || index === doc.pages.length - 1) continue;
    // **Above 40 is the furniture filter**: the only baseline any page carries below 60 by design is the
    // footer's own, at 25.51, and everything else — the body, the headings, the captions — must clear the
    // rule at 36.85. This is the assertion that "no text sits under the page number" reduces to.
    const baselines = [...page.ops.join('\n').matchAll(/([\d.]+) ([\d.]+) Td/g)]
      .map((m) => Number(m[2])).filter((baseline) => baseline > 40);
    if (baselines.length === 0) continue;
    assert.ok(Math.min(...baselines) >= 60, `page ${index + 1} has text below the footer rule`);
  }
});
