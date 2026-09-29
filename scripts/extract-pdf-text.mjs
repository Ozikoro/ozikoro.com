// Dump the text layer of a PDF, page by page, for entry-pattern analysis.
import { readFileSync, writeFileSync } from 'node:fs';
const [file, out, fromStr, toStr] = process.argv.slice(2);
const from = Number(fromStr ?? 1), to = Number(toStr ?? 12);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: false }).promise;
const lines = [];
for (let p = from; p <= Math.min(to, doc.numPages); p += 1) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  // Rebuild lines from positioned runs rather than trusting stream order.
  let current = '';
  let lastY = null;
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      if (current.trim()) lines.push(current.trim());
      current = '';
    }
    current += item.str;
    lastY = y;
  }
  if (current.trim()) lines.push(current.trim());
  lines.push(`\f[[page ${p}]]`);
}
const text = lines.join('\n');
if (out) writeFileSync(out, text);
else process.stdout.write(text);
