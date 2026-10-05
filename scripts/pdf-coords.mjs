/*
 * pdf-coords.mjs — where each run of text actually sits on a page, in PDF points.
 *
 * The ruler the layout is built with. A template draws its page in CSS and a description of that
 * page is not the page: the only numbers that can be matched are the ones in the file, taken from
 * the same text-extraction path a reader's viewer uses. Baselines are the text matrix's own `f`, and
 * sizes are recovered from the transform's scale, so a run reports where it IS rather than where it
 * was drawn relative to something else.
 *
 * Usage:
 *   node scripts/pdf-coords.mjs <file.pdf> [--pages 1,2] [--min 40] [--box] [--json]
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error('usage: node scripts/pdf-coords.mjs <file.pdf> [--pages 1,2]');
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: false }).promise;
const wanted = flag('--pages', null);
const pages = wanted
  ? wanted.split(',').map((v) => Number(v.trim())).filter(Number.isFinite)
  : Array.from({ length: doc.numPages }, (_, i) => i + 1);
const asJson = args.includes('--json');

const out = [];
for (const p of pages) {
  if (p < 1 || p > doc.numPages) continue;
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  console.log(`\n──────── page ${p}  (mediabox ${viewport.width}×${viewport.height}) ────────`);
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const [a, , , d, x, y] = item.transform;
    const size = Math.hypot(a, d);
    const run = {
      page: p, x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), size: Number(size.toFixed(2)),
      width: Number(item.width.toFixed(2)), text: item.str,
    };
    out.push(run);
    if (!asJson) {
      console.log(`  y=${String(run.y).padStart(7)}  x=${String(run.x).padStart(7)}  ${String(run.size).padStart(5)}pt  w=${String(run.width).padStart(6)}  ${JSON.stringify(item.str)}`);
    }
  }
}
if (asJson) console.log(JSON.stringify(out, null, 1));
