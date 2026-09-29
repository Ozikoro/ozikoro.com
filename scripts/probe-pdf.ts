/**
 * Probe a PDF dictionary source before committing to an import pipeline.
 *
 *   node scripts/probe-pdf.ts <file.pdf> [more.pdf ...]
 *
 * WHY THIS EXISTS
 *
 * The single most important question about any dictionary source is whether it
 * has a text layer. A born-digital PDF can be parsed into structured entries in
 * minutes; a scan needs OCR plus a correction pass by a native speaker, which is
 * an order of magnitude more work and a different kind of work.
 *
 * That is not a question worth guessing at, and it is not answerable from a
 * filename or a file size. This answers it in a few seconds, and reports what
 * the extracted text actually looks like — because "has a text layer" and
 * "has a *usable* text layer" are also different, and a PDF produced by an OCR
 * pass in 2003 may extract as plausible-looking garbage.
 *
 * Run this on every source in a language's candidate list BEFORE scoping the
 * work. It is much cheaper than discovering halfway through that a dictionary
 * is 60 pages of images.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Pages to sample, as a fraction of the document, so long books stay cheap. */
const SAMPLE_FRACTIONS = [0, 0.08, 0.25, 0.5, 0.75, 0.95];
/** Characters of extracted text to show per sampled page. */
const SNIPPET = 220;
/**
 * Below this many characters per sampled page, the document is treated as a
 * scan. A real page of dictionary text runs to hundreds of characters; a scan
 * yields zero or a few stray artefacts.
 */
const SCAN_THRESHOLD = 120;

interface PageSample {
  page: number;
  text: string;
  /** Share of non-whitespace characters that are actual letters. */
  letterRatio: number;
  /** Share of characters that came out as '?' — an undecodable glyph. */
  questionRatio: number;
}

/**
 * Text quality, not just quantity.
 *
 * A PDF can carry a text layer and still be useless: if the embedded fonts have
 * no ToUnicode mapping, every glyph extracts as '?' and a page of a dictionary
 * reads as "? ? ? ? ? ?". That scores thousands of characters, so counting them
 * reports a healthy born-digital file and sends you off to write a parser
 * against noise.
 *
 * This is not hypothetical — it is what the Peace Corps Mandinka dictionary
 * does on all 162 pages.
 */
function assessQuality(text: string): { letterRatio: number; questionRatio: number } {
  const dense = text.replace(/\s+/g, '');
  if (dense.length === 0) return { letterRatio: 0, questionRatio: 0 };
  const letters = (dense.match(/\p{L}/gu) ?? []).length;
  const questions = (dense.match(/\?/g) ?? []).length;
  return { letterRatio: letters / dense.length, questionRatio: questions / dense.length };
}

export interface PdfProbe {
  file: string;
  pages: number;
  producer: string | null;
  creator: string | null;
  hasTextLayer: boolean;
  charsPerPage: number;
  letterRatio: number;
  questionRatio: number;
  samples: PageSample[];
  verdict: 'born-digital' | 'scanned' | 'partial' | 'unreadable-encoding';
}

export async function probePdf(path: string): Promise<PdfProbe> {
  // pdfjs ships an ESM build under legacy/ that runs without a browser.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;

  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, unknown>;

  const pageNumbers = [
    ...new Set(
      SAMPLE_FRACTIONS.map((f) => Math.min(doc.numPages - 1, Math.max(0, Math.floor(f * doc.numPages))))
    ),
  ].sort((a, b) => a - b);

  const samples: PageSample[] = [];
  let totalChars = 0;

  for (const index of pageNumbers) {
    const page = await doc.getPage(index + 1);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    totalChars += text.length;
    const quality = assessQuality(text);
    samples.push({
      page: index + 1,
      text: text.slice(0, SNIPPET),
      ...quality,
    });
  }

  const charsPerPage = samples.length === 0 ? 0 : totalChars / samples.length;
  const hasTextLayer = charsPerPage >= SCAN_THRESHOLD;

  const letterRatio =
    samples.length === 0 ? 0 : samples.reduce((a, s) => a + s.letterRatio, 0) / samples.length;
  const questionRatio =
    samples.length === 0 ? 0 : samples.reduce((a, s) => a + s.questionRatio, 0) / samples.length;

  // A page of prose is overwhelmingly letters. A broken font encoding produces
  // punctuation or '?' instead, which is why quality is measured separately
  // from quantity.
  const hasUsableText = letterRatio >= 0.6 && questionRatio < 0.1;

  const pagesWithText = samples.filter((s) => s.text.length >= SCAN_THRESHOLD).length;
  const verdict: PdfProbe['verdict'] = !hasTextLayer
    ? 'scanned'
    : !hasUsableText
      ? 'unreadable-encoding'
      : pagesWithText === samples.length
        ? 'born-digital'
        : 'partial';

  return {
    file: basename(path),
    pages: doc.numPages,
    producer: (info.Producer as string | undefined) ?? null,
    creator: (info.Creator as string | undefined) ?? null,
    hasTextLayer,
    charsPerPage: Math.round(charsPerPage),
    letterRatio,
    questionRatio,
    samples,
    verdict,
  };
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/probe-pdf.ts <file.pdf> [...]');
    process.exitCode = 1;
    return;
  }

  for (const file of files) {
    console.log(`\n=== ${basename(file)} ===`);
    let probe: PdfProbe;
    try {
      probe = await probePdf(file);
    } catch (error) {
      console.error(`  ! could not read: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
      continue;
    }

    console.log(`  pages:        ${probe.pages}`);
    console.log(`  producer:     ${probe.producer ?? '(none)'}`);
    console.log(`  creator:      ${probe.creator ?? '(none)'}`);
    console.log(`  chars/page:   ${probe.charsPerPage} across sampled pages`);
    console.log(
      `  quality:      ${(probe.letterRatio * 100).toFixed(0)}% letters, ` +
        `${(probe.questionRatio * 100).toFixed(0)}% undecodable`
    );
    console.log(
      `  verdict:      ${
        probe.verdict === 'born-digital'
          ? 'BORN-DIGITAL — text extraction will work'
          : probe.verdict === 'partial'
            ? 'PARTIAL — some sampled pages have no text; check before relying on extraction'
            : probe.verdict === 'unreadable-encoding'
              ? 'TEXT LAYER UNUSABLE — glyphs do not decode (no ToUnicode map). Extraction would produce noise; needs OCR or the original source.'
              : 'SCANNED — needs OCR, then a correction pass by a speaker'
      }`
    );

    console.log('  --- extracted text ---');
    for (const sample of probe.samples) {
      console.log(`  p${String(sample.page).padStart(4)}: ${sample.text || '(nothing)'}`);
    }
  }
  console.log('');
}

if (process.argv[1] && process.argv[1].endsWith('probe-pdf.ts')) {
  main().catch((error) => {
    console.error('\nProbe failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
