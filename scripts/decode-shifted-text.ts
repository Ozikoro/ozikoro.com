/**
 * Recover text from PDFs whose fonts have no usable Unicode mapping.
 *
 *   node scripts/decode-shifted-text.mjs <input.txt> <output.txt> [shift]
 *
 * THE PROBLEM
 *
 * Some PDFs carry a text layer in which every glyph is encoded at the wrong
 * code point, by a constant offset. Extraction then yields perfectly ordinary
 * letters that are simply the wrong ones — the Gambia-published Wolof and
 * Mandinka dictionaries do this, shifting every character by +29:
 *
 *   extracted:  D Q G D   Q   FHQVHU /LL VD DQGD OD
 *   intended:   a n d a   n   censer Lii sa anda la
 *
 * This is why a probe that counts characters is not enough, and why the probe
 * in this repository also measures what fraction of them are actual letters. A
 * shifted file passes any quantity check while being completely unreadable.
 *
 * WHY RECOVER RATHER THAN OCR
 *
 * OCR on a clean scan of a 1970s typescript is a guess. Reversing a constant
 * offset is arithmetic, so for these two dictionaries the decoded text is
 * closer to the original than OCR would be — and it costs seconds instead of
 * minutes per page.
 *
 * WHAT IT DOES NOT FIX
 *
 * Characters whose shifted value falls outside printable ASCII cannot be
 * recovered: accented vowels come back as digits or punctuation ("le6u j7g.."
 * where the original was "lëu ñëw"). So a decoded headword containing a digit
 * is marked, and those entries should be treated as needing review rather than
 * trusted. The space glyph also decodes to "=", which is normalised back.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Default offset observed in the Gambia Wolof and Mandinka dictionaries. */
const DEFAULT_SHIFT = 29;
/**
 * Some builds put a real 0x20 in the text layer, which shifts to '='. With the
 * full-range shift most spaces decode from a control code straight to 0x20, but
 * both cases occur, so the artefact is normalised too.
 */
const SPACE_ARTEFACT = '=';

export interface DecodeResult {
  text: string;
  /** Lines containing a character that could not be recovered. */
  damagedLines: number;
  totalLines: number;
}

/**
 * Undo letter-spacing.
 *
 * These dictionaries were typeset with every letter separated by a space and
 * words separated by two, which survives into the text layer:
 *
 *   "D Q G D  Q  F H Q V H U"   ->  anda n censer
 *
 * So a single space between letters is not a word boundary and must be removed,
 * while a run of two or more is. Without this the decode "works" and produces
 * one long unreadable token per line, which is easy to mistake for a decoding
 * failure rather than a layout artefact.
 */
function collapseLetterSpacing(line: string): string {
  // Runs of two or more spaces are real word boundaries; protect them first.
  const MARK = '\u0001';
  return line
    .replace(/[ \t]{2,}/g, MARK)
    // Drop single spaces that sit between two letters (or a letter and a mark).
    .replace(/(?<=[\p{L}\p{M}]) (?=[\p{L}\p{M}])/gu, '')
    .replaceAll(MARK, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function decodeShifted(
  text: string,
  shift = DEFAULT_SHIFT,
  options: { collapseSpacing?: boolean } = {}
): DecodeResult {
  const collapseSpacing = options.collapseSpacing ?? true;
  let damagedLines = 0;
  let totalLines = 0;

  const decoded = text
    .split('\n')
    .map((line) => {
      if (line.trim().length === 0) return line;
      totalLines += 1;

      let damaged = false;
      const out: string[] = [];
      for (const ch of line) {
        const code = ch.codePointAt(0)!;
        const shifted = code + shift;

        // Every glyph shifts, INCLUDING control codes.
        //
        // This is the part that is easy to get wrong, and was: restricting the
        // shift to printable ASCII leaves the source's control-coded glyphs
        // untouched, and that is where the most common characters live. In
        // these two dictionaries the space is 0x03, the comma 0x0F, the hyphen
        // 0x10 and the full stop 0x11 — so a "fixed" decode comes out as one
        // unbroken token per line, which reads as a decoding failure rather
        // than as an off-by-one in the range check.
        if (shifted < 32) {
          out.push('?');
          damaged = true;
          continue;
        }
        // Beyond Latin Extended-B the mapping is not recoverable, so mark it
        // rather than emit a plausible-looking wrong character.
        if (shifted > 0x2ff) {
          out.push('?');
          damaged = true;
          continue;
        }
        out.push(String.fromCodePoint(shifted));
      }
      if (damaged) damagedLines += 1;
      const joined = out.join('').replaceAll(SPACE_ARTEFACT, ' ');
      return collapseSpacing ? collapseLetterSpacing(joined) : joined.replace(/[ \t]{2,}/g, ' ');
    })
    .join('\n');

  return { text: decoded, damagedLines, totalLines };
}

function main(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const [input, output] = positional;
  if (!input || !output) {
    console.error(
      'Usage: node scripts/decode-shifted-text.ts <input.txt> <output.txt> [shift] [--no-collapse]'
    );
    process.exitCode = 1;
    return;
  }
  // Find the shift among positional args after the two paths, so a flag cannot
  // be mistaken for it (Number('--no-collapse') is NaN, which silently shifts
  // by NaN and marks every character damaged).
  const shiftArg = positional[2];
  const shift = shiftArg ? Number(shiftArg) : DEFAULT_SHIFT;
  if (!Number.isFinite(shift) || shift === 0) {
    console.error(`Shift must be a non-zero number, got "${shiftArg}".`);
    process.exitCode = 1;
    return;
  }
  // Letter-spacing collapse is per-file: some of these PDFs typeset every
  // letter separately and some do not, and applying it to an already-spaced
  // file welds legitimate words together ("Cookpeanutporridge").
  const collapse = !process.argv.includes('--no-collapse');
  const result = decodeShifted(readFileSync(input, 'utf8'), shift, { collapseSpacing: collapse });
  writeFileSync(output, result.text);
  const pct = result.totalLines === 0 ? 0 : (result.damagedLines / result.totalLines) * 100;
  console.log(
    `  decoded ${result.totalLines} lines with shift +${shift}; ` +
      `${result.damagedLines} (${pct.toFixed(1)}%) contain an unrecoverable character`
  );
}

if (process.argv[1] && process.argv[1].endsWith('decode-shifted-text.ts')) {
  main();
}
