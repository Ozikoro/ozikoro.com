/*
 * pdf-inspect.mjs — read a PDF's page count and its selectable text.
 *
 * A PDF that has not been opened is not a PDF that has been made. `curl` proves the bytes arrived
 * and an xref parse proves the file is well-formed, but neither answers the two questions that
 * matter: HOW MANY pages are there, and WHAT WORDS does a reader get. Both come from pdf.js, which
 * is the same engine Chrome uses, so "the text is selectable" is measured by the code path a reader
 * would actually take rather than by grepping the content stream for something that looks like text.
 *
 * Usage:
 *   node scripts/pdf-inspect.mjs <file.pdf>              # page count, then every line of every page
 *   node scripts/pdf-inspect.mjs <file.pdf> --pages 1,7  # only those pages
 *   node scripts/pdf-inspect.mjs <file.pdf> --grep x,y   # exit 1 unless every term is in the text
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error('usage: node scripts/pdf-inspect.mjs <file.pdf> [--pages 1,2] [--grep a,b]');
  process.exit(2);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: false }).promise;

const wanted = flag('--pages');
const pages = wanted
  ? wanted.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
  : Array.from({ length: doc.numPages }, (_, i) => i + 1);

console.log(`file      ${file}`);
console.log(`pages     ${doc.numPages}`);

const everything = [];
for (const p of pages) {
  if (p < 1 || p > doc.numPages) continue;
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  console.log(`\n──────── page ${p} ────────`);
  // Lines are rebuilt from positioned runs, because the content stream's order is the drawing order
  // and two columns interleave in it.
  let current = '';
  let lastY = null;
  const flush = () => { if (current.trim()) { console.log(current.trim()); everything.push(current.trim()); } current = ''; };
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) flush();
    current += item.str;
    lastY = y;
  }
  flush();
}

const terms = flag('--grep');
if (terms) {
  const all = everything.join('\n');
  let bad = 0;
  for (const term of terms.split(',')) {
    const present = all.includes(term);
    console.log(`${present ? '  found    ' : '  ABSENT   '} ${JSON.stringify(term)}`);
    if (!present) bad += 1;
  }
  process.exit(bad === 0 ? 0 : 1);
}
