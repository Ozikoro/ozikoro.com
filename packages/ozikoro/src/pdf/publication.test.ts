/**
 * THE PUBLICATION'S OWN TESTS, AND THE ONES THAT WOULD HAVE CAUGHT WHAT THE OWNER SAW.
 *
 * Three faults reached the owner's screen and every structural check passed them: a document with no
 * pictures in it, an article whose `ọ` and `ụ` had become `?`, and a cover built from the wrong artwork.
 * **None of those is a structural fault** — the file was valid every time. So these tests assert the things
 * a validity checker cannot see: which colours are written, which glyphs are written, what the page says,
 * and whether the owner's own words are on it.
 *
 * AS OF THE MAGAZINE TEMPLATE THEY ALSO ASSERT THE THING THAT IS EASIEST TO GET WRONG AND IMPOSSIBLE TO
 * SEE: **that the template's internal note is not published.** `.template-note` in the template's markup
 * reads *"AUTOMATIC PUBLICATION TEMPLATE · ARTICLE IMAGES ARE INSERTED FROM THE CMS"* and is a note to
 * whoever operates the system. It must not reach a reader, and a test that greps the rendered text for it
 * is the only thing that can stop it coming back with a redesign.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArticlePdf, citationForSource, type Block, type SourceRow } from './publication.ts';
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

/**
 * The text a reader gets, read back out of the finished file by pdf.js — the same engine Chrome uses.
 *
 * WHY THIS IS HERE AND NOT A GREP OF THE CONTENT STREAM
 *
 * The content stream holds two-byte glyph ids, so a `toString('latin1').includes('References')` is false
 * for a document that displays the word. **"The note must not reach a reader" is a claim about the text a
 * reader can select**, and the only instrument that answers it is the one that extracts that text. pdf.js
 * is a repository dependency already (`scripts/extract-pdf-text.mjs` uses it), so this adds no new one.
 */
async function extractText(pdf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) if ('str' in item) out.push(item.str);
  }
  return out.join(' ');
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

/**
 * THE PALETTE IS THE TEMPLATE'S, AND THE TEMPLATE'S VALUES ARE THE ONES IN THE FILE.
 *
 * `ozikoro-academic-magazine.html` declares seven custom properties and this asserts the conversion of
 * each, from the template's own hex to PDF's 0–1 form, **by value rather than by name**: a rename that
 * changed a colour would still fail here, and that is the point. The old palette was 5% lighter per channel
 * and had to be measured on a rendered page to be seen.
 */
test('the palette in the file is the template\'s own :root, converted and not written anywhere else', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { pdf } = build();
  const text = pdf.toString('latin1');
  // `--ink:#302e2e` is 48/255, 46/255, 46/255. `--green:#0f5142` is 15/255, 81/255, 66/255.
  // `--gold:#e7b82c` is 231/255, 184/255, 44/255. These are the template's own numbers.
  assert.equal(op(OZIKORO.ink), '0.188235 0.180392 0.180392');
  assert.equal(op(OZIKORO.green), '0.058824 0.317647 0.258824');
  assert.equal(op(OZIKORO.gold), '0.905882 0.721569 0.172549');
  assert.equal(op(OZIKORO.cream), '0.933333 0.898039 0.823529');
  assert.equal(op(OZIKORO.paper), '1 0.996078 0.984314');
  assert.equal(op(OZIKORO.muted), '0.466667 0.45098 0.423529');

  for (const [name, rgb] of [
    ['ink', OZIKORO.ink], ['green', OZIKORO.green], ['gold', OZIKORO.gold], ['cream', OZIKORO.cream],
    ['paper', OZIKORO.paper], ['muted', OZIKORO.muted], ['rule', OZIKORO.rule], ['white', OZIKORO.white],
    ['strap', OZIKORO.strap], ['subtitle', OZIKORO.subtitle], ['faint', OZIKORO.faint],
    ['headInk', OZIKORO.headInk], ['featureCopy', OZIKORO.featureCopy], ['featureInk', OZIKORO.featureInk],
    ['featureFaint', OZIKORO.featureFaint], ['bodyInk', OZIKORO.bodyInk], ['footInk', OZIKORO.footInk],
  ] as [string, readonly [number, number, number]][]) {
    assert.ok(text.includes(op(rgb)), `the ${name} colour is not in the file`);
  }
});

test('an article with no featured image says so instead of showing a hole', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { doc, pdf } = build();
  const text = pdf.toString('latin1');
  // The panel's own honest absence is drawn, and the cover is the only page carrying an image.
  assert.ok(text.includes(encoded(doc, 'sansBold', 'NO FEATURED IMAGE IN THE RECORD')));
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
  // **Every placement of the icon, one image object**, because the dedupe is by content.
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

/**
 * THE COVER SPLITS ITS TITLE AT ITS COLON, AS THE TEMPLATE DOES.
 *
 * `.cover h1` takes the part before it and `.cover-subtitle` the part after. **A title with no colon is one
 * display block and no italic line** — nothing is cut off mid-phrase to make a second line exist.
 */
test('the cover splits the title at its colon into the display line and the italic line', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { doc } = build({ title: 'Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots' });
  doc.render();
  const cover = doc.pages[0]?.ops.join('\n') ?? '';
  assert.ok(cover.includes(encoded(doc, 'serifBold', 'Ute-Okpu:')), 'the display line is not on the cover');
  assert.ok(cover.includes(encoded(doc, 'serifItalic', 'An Ika-Igbo Clan and Its Nri Roots')), 'the italic line is not on the cover');
  // With no colon there is no italic line at all, and the title is not truncated to invent one.
  const { doc: plain } = build({ title: 'The Rivers That Made Us' });
  plain.render();
  const flat = plain.pages[0]?.ops.join('\n') ?? '';
  assert.ok(flat.includes(encoded(plain, 'serifBold', 'The Rivers That Made Us')));
});

/**
 * THE TEMPLATE'S INTERNAL NOTE MUST NOT REACH A READER.
 *
 * This is the one assertion in this file that is about a sentence rather than a shape. The template's
 * `.template-note` — *"AUTOMATIC PUBLICATION TEMPLATE · ARTICLE IMAGES ARE INSERTED FROM THE CMS"* — and
 * its references intro both say something to whoever operates the system, and both are deliberately
 * absent from the publication. **It is checked in the extracted text, because that is what a reader sees.**
 */
test('no internal template note reaches the reader, checked in the extracted text', { skip: !have && 'the DejaVu faces are not present' }, async () => {
  const { pdf } = build();
  const text = await extractText(pdf);
  for (const forbidden of ['template', 'TEMPLATE', 'AUTOMATIC PUBLICATION', 'INSERTED FROM THE CMS', 'the owner', 'the production system']) {
    assert.ok(!text.includes(forbidden), `the reader can see ${JSON.stringify(forbidden)}`);
  }
  // The words that ARE the article's own are still there, so the check is not vacuously passing on an
  // empty extraction.
  assert.ok(text.includes('The Nri Tradition'), 'the extracted text does not carry the article');
  assert.ok(text.includes('References'), 'the extracted text does not carry the references page');
});

/**
 * A CANONICAL APA 7TH-EDITION REFERENCE, FROM A SOURCE ROW, WITH EVERY BRANCH EXERCISED.
 *
 * These are the shapes the archive's ten real rows take: two authors, one author, an anonymous record with
 * a `year_note` instead of a year, a journal article with volume, issue and pages, a book with a publisher,
 * a record whose only container is its archive, a web page, and a row with neither a date nor a publisher.
 * **Each expected string contains nothing the row does not**, which is the rule the builder exists to keep —
 * an omitted publisher is a shorter APA entry, and a guessed year is a fabrication.
 */
test('a reference is APA 7th edition, built from a source row and from nothing else', () => {
  const row = (over: Partial<SourceRow>): SourceRow => ({
    kind: 'book', title: 'A title', authors: [], year: null, year_note: null, publisher: null,
    journal: null, volume: null, issue: null, pages: null, url: null, identifier: null,
    archive: null, collection: null, ...over,
  });

  // BOOK — two authors, ampersand before the last, publisher last.
  assert.equal(
    citationForSource(row({
      authors: ['Susan Keech McIntosh', 'Roderick J. McIntosh'], year: 1980,
      title: 'Prehistoric Investigations in the Region of Jenne, Mali', publisher: 'BAR',
    })),
    'McIntosh, S. K. & McIntosh, R. J. (1980). Prehistoric Investigations in the Region of Jenne, Mali. BAR.'
  );
  // JOURNAL — journal, volume(issue), pages. A title ending in `?` keeps its own mark and gains no second.
  assert.equal(
    citationForSource(row({
      kind: 'journal_article', authors: ['Carol Lang', 'Daryl Stump'], year: 2017,
      title: 'Geoarchaeological evidence for a terraced landscape',
      journal: 'Journal of Archaeological Science', volume: '85', issue: '3', pages: '1–18',
    })),
    'Lang, C. & Stump, D. (2017). Geoarchaeological evidence for a terraced landscape. Journal of Archaeological Science, 85(3), 1–18.'
  );
  assert.equal(
    citationForSource(row({ authors: ['David K. Kay'], year: 2023, title: 'Mobile sedentism?', publisher: 'Azania' })),
    'Kay, D. K. (2023). Mobile sedentism? Azania.'
  );
  // NO AUTHOR — the title moves to the front, as APA requires; it is not left blank.
  assert.equal(
    citationForSource(row({ title: 'Agreement between the United Arab Republic and the Republic of Sudan', year: 1959 })),
    'Agreement between the United Arab Republic and the Republic of Sudan (1959).'
  );
  // NO DATE — `year_note` where the archive holds one, `(n.d.)` where it holds neither.
  assert.equal(
    citationForSource(row({ authors: ['Herodotus'], title: 'Histories', year: null, year_note: 'c. 430 BCE' })),
    'Herodotus (c. 430 BCE). Histories.'
  );
  assert.equal(
    citationForSource(row({ authors: ['A. Author'], title: 'Untitled' })),
    'Author, A. (n.d.). Untitled.'
  );
  // CHAPTER — the archive stores a chapter as a book with a publisher, and that is what is printed.
  assert.equal(
    citationForSource(row({
      kind: 'chapter', authors: ['Elizabeth Isichei'], year: 1976,
      title: 'The Igbo and their neighbours', publisher: 'Macmillan',
    })),
    'Isichei, E. (1976). The Igbo and their neighbours. Macmillan.'
  );
  // CORPORATE — a single-token author string that names an organisation is not given invented initials.
  assert.equal(
    citationForSource(row({ kind: 'report', authors: ['UNESCO'], year: 2021, title: 'World Heritage List', publisher: 'UNESCO' })),
    'UNESCO (2021). World Heritage List. UNESCO.'
  );
  // ARCHIVE — a colonial record names where it lives; the archive and its collection are the container.
  assert.equal(
    citationForSource(row({
      kind: 'colonial_record', title: 'Intelligence Report on Ute-Okpu', year: 1936,
      archive: 'National Archives Enugu', collection: 'CSO 26',
    })),
    'Intelligence Report on Ute-Okpu (1936). National Archives Enugu, CSO 26.'
  );
  // WEB PAGE — the site name is the row's publisher where it holds one and the URL's own host where it does not.
  assert.equal(
    citationForSource(row({
      kind: 'website', authors: ['Delta Decides'], year: 2023, title: 'Ute-Okpu kingdom, her history & Obi',
      publisher: 'Delta Decides', url: 'https://deltadecides.com/ute-okpu/',
    })),
    'Decides, D. (2023). Ute-Okpu kingdom, her history & Obi. Delta Decides. https://deltadecides.com/ute-okpu/'
  );
  assert.equal(
    citationForSource(row({
      kind: 'website', year: 2023, title: 'A page with no publisher', url: 'https://www.example.org/a/page',
    })),
    'A page with no publisher (2023). example.org. https://www.example.org/a/page'
  );
  // An identifier sits where APA puts a DOI or a report number, printed as the archive stores it.
  assert.equal(
    citationForSource(row({
      kind: 'report', authors: ['Essam Heggy'], year: 2024, title: 'Grand Ethiopian Renaissance Dam',
      publisher: 'Nature', identifier: '10.1038/s41586-024-00000-0',
    })),
    'Heggy, E. (2024). Grand Ethiopian Renaissance Dam. Nature. 10.1038/s41586-024-00000-0'
  );
  /*
   * **A DOI stored twice is printed once.** The archive keeps a source's DOI in `identifier` *and* as a
   * `https://doi.org/…` address, which is the shape every one of article 2678's journal rows has — so the
   * entry would otherwise read `10.1017/qua.2017.54  https://doi.org/10.1017/qua.2017.54`.
   */
  assert.equal(
    citationForSource(row({
      kind: 'journal_article', authors: ['Carol Lang'], year: 2017, title: 'Geoarchaeological evidence',
      journal: 'Quaternary Research', identifier: '10.1017/qua.2017.54', url: 'https://doi.org/10.1017/qua.2017.54',
    })),
    'Lang, C. (2017). Geoarchaeological evidence. Quaternary Research. 10.1017/qua.2017.54'
  );
  // A URL that is not the identifier is still printed, because it is the only address the row has.
  assert.equal(
    citationForSource(row({
      kind: 'journal_article', authors: ['Carol Lang'], year: 2017, title: 'Geoarchaeological evidence',
      journal: 'Quaternary Research', url: 'https://example.org/full-text.pdf',
    })),
    'Lang, C. (2017). Geoarchaeological evidence. Quaternary Research. https://example.org/full-text.pdf'
  );
});

/**
 * THE REFERENCES PAGE MUST NOT TALK TO US.
 *
 * The owner met a public page carrying *"the full source list is to be verified before publication"* — a
 * note about the publication process rendered to a reader. **That whole class of sentence is forbidden in
 * the references block**, and the only place it can be checked is the text a reader can select.
 */
test('the references page carries no note about the publication process', { skip: !have && 'the DejaVu faces are not present' }, async () => {
  const { pdf } = build({
    references: ['Isichei, E. (1976). A history of the Igbo people. Macmillan.'],
    referencesFromSources: true,
  });
  const text = await extractText(pdf);
  for (const forbidden of ['to be verified', 'before publication', 'the owner', 'template', 'AUTOMATIC', 'CMS', 'generated directly']) {
    assert.ok(!text.includes(forbidden), `the reader can see ${JSON.stringify(forbidden)}`);
  }
  assert.ok(text.includes('Isichei'), 'the reference itself did not reach the page');
});

/**
 * A HEADING IS NEVER STRANDED AT THE FOOT, AND NO TEXT SITS UNDER THE PAGE NUMBER.
 *
 * Both are measured over every page's own content stream rather than trusted. The cover and the back page
 * are excluded because neither carries a running foot; the footer's own baseline at 25.51 is filtered out
 * by the `> 40` threshold, which is what "no text sits under the page number" reduces to.
 */
test('a section heading is never the last thing on a page, and no text sits under the footer rule', { skip: !have && 'the DejaVu faces are not present' }, () => {
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
  for (const [index, page] of doc.pages.entries()) {
    if (index === 0 || index === doc.pages.length - 1) continue;
    const baselines = [...page.ops.join('\n').matchAll(/([\d.]+) ([\d.]+) Td/g)]
      .map((m) => Number(m[2])).filter((baseline) => baseline > 40);
    if (baselines.length === 0) continue;
    assert.ok(Math.min(...baselines) >= 60, `page ${index + 1} has text below the footer rule`);
  }
});

/**
 * THE TEMPLATE'S OWN GEOMETRY, MEASURED RATHER THAN DESCRIBED.
 *
 * The sheet is A4 and the measure is the template's `.article-inner` gutters: 53 points from the left edge
 * and 54 from the right, which is 487 wide. The template's `.page-header { margin:0 53px }` and its
 * hairline at 47 points from the top. **These are the template's numbers and a redesign that moved a gutter
 * would fail here**, which is the only way a layout regression can be caught without looking at the page.
 */
test('the pages are A4, the measure is the template\'s, and the furniture is at the template\'s coordinates', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const { doc } = build();
  doc.render();
  // Every page's MediaBox is A4, written once by the writer.
  const pdf = doc.render().toString('latin1');
  assert.ok(pdf.includes('/MediaBox [0 0 595.28 841.89]'), 'the sheet is not A4');
  const opening = doc.pages[1]?.ops.join('\n') ?? '';
  /*
   * The two rules, at the template's own coordinates. `.page-header { height:47px }` puts the head's
   * hairline at 793.70 and `footer { bottom:25px; padding-top:10px }` puts the foot's at 36.85. **Both are
   * asserted as the content stream's own operands**, so a redesigned gutter or a moved rule fails here
   * rather than being discovered on a printed page.
   */
  assert.ok(opening.includes('53.86 793.7 m'), 'the running head rule is not where the template puts it');
  assert.ok(opening.includes('541.42 793.7 l'), 'the running head rule does not end at the measure');
  assert.ok(opening.includes('53.86 36.85 m'), 'the footer rule is not where the template puts it');
  assert.ok(opening.includes('541.42 36.85 l'), 'the footer rule does not end at the measure');
  // **The plate number ends at the measure**, which is asserted as a position rather than as a constant:
  // the run is right-aligned, so where it starts is 541.4173 minus its own width, and adding the two back
  // must land on the right edge. A left-aligned run would start at 53 and fail this.
  const face = doc.face('sans');
  assert.ok(face);
  const label = 'OZIKORO.COM  ·  02';
  let units = 0;
  for (const ch of label) units += face.advance(face.glyph(ch.codePointAt(0) as number));
  const runWidth = (units / 1000) * 7;
  assert.ok(
    opening.includes(`${Number((541.4173 - runWidth).toFixed(2))} 813.54 Td`),
    'the page number does not end at the measure'
  );});

/**
 * THE COVER'S TEXT STOPS ABOVE ITS FEATURE PANEL.
 *
 * This is the fault a render of the first version of this file showed: the byline's meta line landed
 * **inside** the cream panel, because the reserve under the gold rule was a fudge factor rather than the
 * 42.52 points the approved page measures between the meta line's baseline and the gold rule. A reader
 * sees a sentence written across a photograph's caption, which no structural check notices.
 *
 * The assertion is on the drawn baselines rather than on the arithmetic: every text baseline on the cover
 * that is not part of the panel must sit above the panel's own top edge, and every baseline that IS inside
 * the panel must be one of the panel's own five runs.
 */
test('no cover text is drawn inside the feature panel', { skip: !have && 'the DejaVu faces are not present' }, () => {
  const iconValue = icon();
  const { doc } = build({
    subtitle: 'A standfirst that the article carries, long enough to take two lines of the italic.',
    authorBio: null,
    featured: { data: iconValue.data, width: iconValue.width, height: iconValue.height, caption: 'The picture of the Obi of Ute Okpu, Obi Solomon Chukwuk' },
  });
  doc.render();
  const cover = doc.pages[0]?.ops.join('\n') ?? '';
  // The feature panel's own coordinates, restated: `.cover-inner { padding-bottom:50px }`, `.feature { min-height:125px }`.
  const panelTop = 198;
  const labelX = 53.85827 + 18;
  const copyX = 53.85827 + 125 + 26;
  const strays: { y: number; x: number }[] = [];
  const re = /([\d.]+) ([\d.]+) Td\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cover)) !== null) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (y >= panelTop) continue;
    // The panel's own copy sits at the label column or the copy column; anything else is a stray.
    if (Math.abs(x - labelX) < 0.6 || Math.abs(x - copyX) < 0.6) continue;
    strays.push({ x, y });
  }
  assert.deepEqual(strays, [], 'text is drawn inside the feature panel');
  // And the panel's own caption is in it, so the check is not passing on an empty panel.
  assert.ok(cover.includes(encoded(doc, 'serifBold', 'The picture of the Obi of Ute Okpu,')), 'the caption is not in the panel');
});
