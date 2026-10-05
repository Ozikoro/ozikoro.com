/*
 * pdf-to-png.mjs — rasterise pages of a PDF so a human can LOOK at the layout.
 *
 * The layout is the one part of this repository that no assertion can check. A page count, a colour
 * operator and a glyph list all pass on a document whose margins have collapsed, whose panel sits on
 * top of its own caption, or whose type is 300 points wide. **The only instrument for that is an
 * image**, so this exists to produce them.
 *
 * pdf.js does the parsing and drawing; `@napi-rs/canvas` is the target, because it is already in this
 * repository's tree and needs no browser.
 *
 * Usage:
 *   node scripts/pdf-to-png.mjs <file.pdf> <out-dir> [--pages 1,7] [--scale 1.6]
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const file = args[0];
const outDir = args[1];
if (!file || !outDir) {
  console.error('usage: node scripts/pdf-to-png.mjs <file.pdf> <out-dir> [--pages 1,7] [--scale 1.6]');
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const { createCanvas } = await import('@napi-rs/canvas');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: false }).promise;
const scale = Number(flag('--scale', '1.6'));
const wanted = flag('--pages', null);

mkdirSync(outDir, { recursive: true });
const pages = wanted
  ? wanted.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
  : Array.from({ length: doc.numPages }, (_, i) => i + 1);

for (const p of pages) {
  if (p < 1 || p > doc.numPages) continue;
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const out = join(outDir, `page-${String(p).padStart(2, '0')}.png`);
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`${out}  ${canvas.width}×${canvas.height}`);
}
