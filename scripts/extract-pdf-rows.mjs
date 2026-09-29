// Dump a PDF's text layer as visual ROWS rather than as pdf.js orders it.
//
// `extract-pdf-text.mjs` starts a new line whenever an item's baseline differs
// from the previous one by more than 2 points. On a table typeset in more than
// one font that is wrong in a way that is easy to miss: a headword drawn partly
// in the body font and partly in a phonetic one sits on one printed line but at
// two baselines, so it comes out as
//
//     àk
//     w
//     a n. bridge
//
// and a parser reading one line per entry sees a word called "a". The Ekpeye
// dictionary lost a fifth of its headwords to exactly this — "àkwa" arrived as
// "a", "egwù" as "ù", "ẹgwẹ" as "ẹ" — and the loss is invisible in the output,
// because each fragment still looks like plausible text.
//
// So items are grouped here by VERTICAL OVERLAP — two items share a row when
// their ink boxes overlap vertically, whatever their baselines — and joined in
// x order with a space only where there is a real gap between them, so a word
// split across fonts is put back together without fusing separate columns.
//
//   node scripts/extract-pdf-rows.mjs <pdf> <out.txt> [from] [to] [gap]
import { readFileSync, writeFileSync } from 'node:fs';

const [file, out, fromStr, toStr, gapStr] = process.argv.slice(2);
const from = Number(fromStr ?? 1);
const to = Number(toStr ?? 10000);
/** Points of horizontal gap that count as a space between words. */
const GAP = Number(gapStr ?? 1.2);
/**
 * Points of baseline difference that still count as the same printed line.
 *
 * This is the one number that matters, and it is set from the document rather
 * than guessed: in this table a glyph that changed font is drawn up to 5 points
 * off the baseline it belongs to, while the rows themselves are 13.9 points
 * apart. Anything between those two values puts every word back together and
 * keeps every row apart.
 */
const TOLERANCE = Number(process.env.PDF_ROW_TOLERANCE ?? 7);

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  useSystemFonts: false,
}).promise;

const lines = [];
for (let p = from; p <= Math.min(to, doc.numPages); p += 1) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();

  const items = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str === '') continue;
    items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width ?? 0 });
  }
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  // Baseline clustering: an item joins the row whose baseline it is nearest to,
  // provided that is within the tolerance.
  const rows = [];
  for (const item of items) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  rows.sort((a, b) => b.y - a.y);

  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const item of row.items) {
      if (end !== null) {
        const gap = item.x - end;
        // A space only where the layout put one: within a word the fragments
        // abut, and between columns there is a visible break. A fragment that
        // starts with a combining mark is always a continuation — "àcî" followed
        // by a bare dot-below must not become "àcî ̣".
        const combining = /^[\u0300-\u036f\u1ab0-\u1aff\u20d0-\u20f0]/.test(item.str);
        if (!combining && gap > GAP && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' ';
      }
      text += item.str;
      end = item.x + item.width;
    }
    if (text.trim()) lines.push(text.replace(/\s+/g, ' ').trim());
  }
  lines.push(`\f[[page ${p}]]`);
}

const text = lines.join('\n');
if (out) writeFileSync(out, text);
else process.stdout.write(text);
