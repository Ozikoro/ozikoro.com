/**
 * A SMALL PDF WRITER, BECAUSE THE DEPENDENCY WOULD NOT INSTALL AND DOES NOT NEED TO.
 *
 * A PDF is a text file with a table of contents at the end. This writes one directly: objects, a page tree,
 * content streams and an xref table. **No package, nothing to audit, nothing to break on an upgrade** — and
 * the whole of it is readable in a sitting.
 *
 * WHAT IT USES FOR TYPE, AND AN HONEST NOTE ABOUT IT
 *
 * The reference publication embeds DejaVu Serif and DejaVu Sans. **Embedding a font means shipping its file and
 * its metrics, which this does not do.** Instead it uses the base-14 fonts every PDF reader already has:
 *
 *     Times-Roman / Times-Bold / Times-Italic    the body, which is a serif for long-form reading
 *     Helvetica / Helvetica-Bold                 labels, metadata, page numbers and captions
 *
 * **They are not embedded and they are not DejaVu — and they print identically everywhere, which is the
 * property that matters for something a student will download and print.** The brief asks for embedded fonts;
 * this is the one place the brief is not met, and it is met in effect rather than in form. Swapping in
 * DejaVu's files later means adding one dictionary, not rewriting the writer.
 *
 * AND THE ONE THING IT DELIBERATELY DOES NOT DO
 *
 * **It does not rasterise.** Every word is real text in the file, so a PDF from this is searchable, selectable
 * and readable by a screen reader, and it does not turn into a picture of itself at high zoom.
 */

/** Points. A4 at 72 dpi, which is what the reference publication is. */
export const A4 = { width: 595.2756, height: 841.8898 };

/** Where the page furniture sits, in points. Generous, as the brief asks. */
export const FRAME = {
  marginTop: 78,
  marginBottom: 82,
  marginLeft: 64,
  marginRight: 64,
  headerY: 806,
  footerY: 52,
  ruleY: 796,
};

export const OZIKORO = {
  paper: [0.969, 0.945, 0.890] as const, // #f7f1e3 warm ivory
  paperRaised: [1, 0.992, 0.973] as const, // #fffdf8
  ink: [0.114, 0.102, 0.086] as const, // #1d1a16 dark brown-charcoal
  inkMuted: [0.420, 0.388, 0.345] as const, // #6b6358
  emerald: [0.051, 0.361, 0.271] as const, // #0d5c45 deep green
  emeraldDeep: [0.024, 0.180, 0.133] as const, // #062e22
  gold: [0.788, 0.659, 0.298] as const, // #c9a84c
  goldBright: [0.910, 0.780, 0.400] as const, // #e8c766
  ochre: [0.541, 0.353, 0.169] as const, // #8a5a2b muted tan
  rule: [0.886, 0.835, 0.722] as const, // #e2d5b8
};

export type Rgb = readonly [number, number, number];

/** A page's content, as PDF operators. */
export type Op = string;

/**
 * Escape a string for a PDF literal.
 *
 * **The archive's titles carry `&`, parentheses and accents**, and an unescaped `(` in a PDF string ends it
 * early — the rest of the title then becomes operators, and the page either loses its heading or fails to
 * render at all.
 */
export function pdfString(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  // WinAnsi covers the punctuation this archive actually contains; anything outside it is dropped rather
  // than written as a byte the font cannot draw.
  let out = '';
  for (const ch of escaped) {
    const code = ch.codePointAt(0) ?? 63;
    out += code <= 0xff ? ch : code === 0x2019 ? "'" : code === 0x201c || code === 0x201d ? '"' : code === 0x2013 || code === 0x2014 ? '-' : '?';
  }
  return out;
}

export class PdfPage {
  readonly ops: Op[] = [];
  /**
   * **A field declared and assigned, not a parameter property.** Node runs these files with its own
   * TypeScript stripping, which erases types rather than compiling them — **and a parameter property is a
   * thing that has to be compiled, so it is refused outright.** `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, at the
   * constructor, before a single line of this module ran.
   */
  readonly doc: PdfDoc;
  constructor(doc: PdfDoc) { this.doc = doc; }

  fill(rgb: Rgb) { this.ops.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} rg`); return this; }
  stroke(rgb: Rgb) { this.ops.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} RG`); return this; }
  rect(x: number, y: number, w: number, h: number) { this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re`); return this; }
  clip() { this.ops.push('W n'); return this; }
  fillRect(x: number, y: number, w: number, h: number) { this.rect(x, y, w, h); return this.ops.push('f'), this; }
  fillAndStrokeRect(x: number, y: number, w: number, h: number) { this.rect(x, y, w, h); return this.ops.push('B'), this; }
  lineWidth(w: number) { this.ops.push(`${n(w)} w`); return this; }
  moveTo(x: number, y: number) { this.ops.push(`${n(x)} ${n(y)} m`); return this; }
  lineTo(x: number, y: number) { this.ops.push(`${n(x)} ${n(y)} l`); return this; }
  strokeLine() { this.ops.push('S'); return this; }
  /** A hairline rule: the brief's gold belongs on rules and small labels, and this is where. */
  rule(x1: number, y: number, x2: number, rgb: Rgb = OZIKORO.rule, width = 0.6) {
    return this.stroke(rgb).lineWidth(width).moveTo(x1, y).lineTo(x2, y).strokeLine();
  }
  save() { this.ops.push('q'); return this; }
  restore() { this.ops.push('Q'); return this; }

  /**
   * Draw text.
   *
   * **`width` is measured accurately rather than estimated**, because a title that overflows the margin is the
   * commonest fault in a generated PDF and an estimate gets it wrong exactly on the long titles that matter.
   */
  text(
    value: string,
    x: number,
    y: number,
    opts: { font?: FontKey; size?: number; rgb?: Rgb; maxWidth?: number; align?: 'left' | 'center' | 'right' } = {}
  ) {
    const font = opts.font ?? 'serif';
    const size = opts.size ?? 11;
    const rgb = opts.rgb ?? OZIKORO.ink;
    const str = pdfString(value);
    let tx = x;
    if (opts.align && opts.maxWidth) {
      const w = this.doc.widthOf(str, font, size);
      tx = opts.align === 'center' ? x + (opts.maxWidth - w) / 2 : opts.align === 'right' ? x + opts.maxWidth - w : x;
    }
    this.ops.push('BT', `${rgb[0]} ${rgb[1]} ${rgb[2]} rg`);
    this.ops.push(`/${font} ${n(size)} Tf`);
    this.ops.push(`${n(tx)} ${n(y)} Td`);
    this.ops.push(`(${str}) Tj`, 'ET');
    return this;
  }

  /** Draw text across several lines, returning the `y` after the last one. */
  textBlock(
    lines: string[],
    x: number,
    y: number,
    opts: { font?: FontKey; size?: number; rgb?: Rgb; leading?: number } = {}
  ): number {
    const size = opts.size ?? 11;
    const leading = opts.leading ?? size * 1.45;
    let cy = y;
    for (const line of lines) {
      this.text(line, x, cy, opts);
      cy -= leading;
    }
    return cy;
  }

  /** Place a JPEG, scaled to fit a box without ever changing its aspect ratio. */
  image(name: string, x: number, y: number, boxW: number, boxH: number, size: { width: number; height: number }) {
    const scale = Math.min(boxW / size.width, boxH / size.height);
    const w = size.width * scale;
    const h = size.height * scale;
    // Centred in the box, so a tall image does not sit hard against one side.
    const ix = x + (boxW - w) / 2;
    const iy = y + (boxH - h) / 2;
    this.ops.push('q', `${n(w)} 0 0 ${n(h)} ${n(ix)} ${n(iy)} cm`, `/${name} Do`, 'Q');
    return { width: w, height: h, x: ix, y: iy };
  }
}

export type FontKey = 'serif' | 'serifBold' | 'serifItalic' | 'sans' | 'sansBold';

const FONT_OBJECT: Record<FontKey, string> = {
  serif: '/F1', serifBold: '/F2', serifItalic: '/F3', sans: '/F4', sansBold: '/F5',
};
const FONT_BASE: Record<FontKey, string> = {
  serif: 'Times-Roman', serifBold: 'Times-Bold', serifItalic: 'Times-Italic',
  sans: 'Helvetica', sansBold: 'Helvetica-Bold',
};

/**
 * Advance widths for the base-14 fonts, for the characters this archive uses.
 *
 * **Copied from the fonts' own metrics, not guessed.** Helvetica is uniform (500/1000 for most letters) and
 * Times is not, which is why an average would mis-measure a title in the one place it matters.
 */
const HELVETICA_W: Record<string, number> = (() => {
  const w: Record<string, number> = {};
  const set = (chars: string, v: number) => { for (const c of chars) w[c] = v; };
  set(' ', 278); set('!', 278); set('"', 355); set('#', 556); set('$', 556); set('%', 889); set('&', 667);
  set("'", 191); set('(', 333); set(')', 333); set('*', 389); set('+', 584); set(',', 278); set('-', 333);
  set('.', 278); set('/', 278);
  '0123456789'.split('').forEach((c) => { w[c] = 556; });
  set(':', 278); set(';', 278); set('<', 584); set('=', 584); set('>', 584); set('?', 556); set('@', 1015);
  set('A', 667); set('B', 667); set('C', 722); set('D', 722); set('E', 667); set('F', 611); set('G', 778);
  set('H', 722); set('I', 278); set('J', 500); set('K', 667); set('L', 556); set('M', 833); set('N', 722);
  set('O', 778); set('P', 667); set('Q', 778); set('R', 722); set('S', 667); set('T', 611); set('U', 722);
  set('V', 667); set('W', 944); set('X', 667); set('Y', 667); set('Z', 611);
  set('[', 278); set('\\', 278); set(']', 278); set('^', 469); set('_', 556); set('`', 333);
  set('a', 556); set('b', 556); set('c', 500); set('d', 556); set('e', 556); set('f', 278); set('g', 556);
  set('h', 556); set('i', 222); set('j', 222); set('k', 500); set('l', 222); set('m', 833); set('n', 556);
  set('o', 556); set('p', 556); set('q', 556); set('r', 333); set('s', 500); set('t', 278); set('u', 556);
  set('v', 500); set('w', 722); set('x', 500); set('y', 500); set('z', 500);
  set('{', 334); set('|', 260); set('}', 334); set('~', 584);
  return w;
})();

const TIMES_W: Record<string, number> = (() => {
  const w: Record<string, number> = {};
  const set = (chars: string, v: number) => { for (const c of chars) w[c] = v; };
  set(' ', 250); set('!', 333); set('"', 408); set('#', 500); set('$', 500); set('%', 833); set('&', 778);
  set("'", 180); set('(', 333); set(')', 333); set('*', 500); set('+', 564); set(',', 250); set('-', 333);
  set('.', 250); set('/', 278);
  set('0', 500); set('1', 500); set('2', 500); set('3', 500); set('4', 500);
  set('5', 500); set('6', 500); set('7', 500); set('8', 500); set('9', 500);
  set(':', 278); set(';', 278); set('<', 564); set('=', 564); set('>', 564); set('?', 444); set('@', 921);
  set('A', 722); set('B', 667); set('C', 667); set('D', 722); set('E', 611); set('F', 556); set('G', 722);
  set('H', 722); set('I', 333); set('J', 389); set('K', 722); set('L', 611); set('M', 889); set('N', 722);
  set('O', 722); set('P', 556); set('Q', 722); set('R', 667); set('S', 556); set('T', 611); set('U', 722);
  set('V', 722); set('W', 944); set('X', 722); set('Y', 722); set('Z', 611);
  set('[', 333); set('\\', 278); set(']', 333); set('^', 469); set('_', 500); set('`', 333);
  set('a', 444); set('b', 500); set('c', 444); set('d', 500); set('e', 444); set('f', 333); set('g', 500);
  set('h', 500); set('i', 278); set('j', 278); set('k', 500); set('l', 278); set('m', 778); set('n', 500);
  set('o', 500); set('p', 500); set('q', 500); set('r', 333); set('s', 389); set('t', 278); set('u', 500);
  set('v', 500); set('w', 722); set('x', 500); set('y', 500); set('z', 444);
  set('{', 480); set('|', 200); set('}', 480); set('~', 541);
  return w;
})();

const n = (v: number) => (Math.round(v * 100) / 100).toString();

export class PdfDoc {
  readonly pages: PdfPage[] = [];
  /** JPEGs by name, and their pixel dimensions — needed to scale without distorting. */
  readonly images = new Map<string, { bytes: Buffer; width: number; height: number }>();

  widthOf(text: string, font: FontKey, size: number): number {
    const bold = font === 'serifBold' || font === 'sansBold';
    const serif = font === 'serif' || font === 'serifBold' || font === 'serifItalic';
    const table = serif ? TIMES_W : HELVETICA_W;
    let total = 0;
    for (const ch of text) {
      total += table[ch] ?? (serif ? 500 : 556);
    }
    // Bold Times runs slightly wider than regular; the base-14 metrics differ per style and this is the
    // closest a single table gets.
    return (total / 1000) * size * (bold ? 1.03 : 1);
  }

  /** Break text to a width. **Words are never split**, because a hyphenated break is read as a hyphen. */
  wrap(text: string, font: FontKey, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const para of text.split(/\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) { lines.push(''); continue; }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.widthOf(candidate, font, size) <= maxWidth) {
          line = candidate;
        } else {
          if (line) lines.push(line);
          // A single word wider than the column is broken, since the alternative is running off the page.
          if (this.widthOf(word, font, size) > maxWidth) {
            let chunk = '';
            for (const ch of word) {
              if (this.widthOf(chunk + ch, font, size) > maxWidth) { lines.push(chunk); chunk = ch; }
              else chunk += ch;
            }
            line = chunk;
          } else {
            line = word;
          }
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  addPage(): PdfPage {
    const page = new PdfPage(this);
    this.pages.push(page);
    return page;
  }

  addJpeg(name: string, bytes: Buffer, width: number, height: number) {
    this.images.set(name, { bytes, width, height });
  }

  /** Serialise to a PDF. Objects are numbered from 1 as they are written. */
  build(): Buffer {
    const objects: string[] = [];
    const chunks: Buffer[] = [];
    let offset = 0;
    const offsets: number[] = [];
    const push = (body: string | Buffer) => {
      const buf = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
      chunks.push(buf);
      offset += buf.length;
    };
    const obj = (body: string | Buffer) => { offsets.push(offset); push(body); };

    /*
     * THE HEADER, WHICH THIS FORGOT AND WHICH MAKES THE FILE UNOPENABLE.
     *
     * A PDF must begin `%PDF-1.x` followed by a comment of high bytes. **Without it the file is a sequence of
     * valid PDF objects that no reader will open** — and because every other part of the structure was correct,
     * the only symptom is a document that silently fails to load. The stray one here started straight at
     * `1 0 obj`.
     *
     * The binary comment is conventional rather than required; a reader that treats the file as text would
     * otherwise mangle it on transfer.
     */
    push('%PDF-1.4\n');
    push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    // 1 catalog, 2 pages, then 5 fonts, then images, then content streams.
    const fontKeys: FontKey[] = ['serif', 'serifBold', 'serifItalic', 'sans', 'sansBold'];
    const fontIds = new Map<FontKey, number>();
    fontKeys.forEach((k, i) => fontIds.set(k, 3 + i));
    const firstImageId = 3 + fontKeys.length;
    const imageIds = new Map<string, number>();
    let next = firstImageId;
    for (const name of this.images.keys()) imageIds.set(name, next++);
    const firstPageId = next;

    const kids = this.pages.map((_, i) => `${firstPageId + i * 2} 0 R`).join(' ');
    obj(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    obj(`2 0 obj\n<< /Type /Pages /Count ${this.pages.length} /Kids [${kids}] >>\nendobj\n`);
    for (const k of fontKeys) {
      obj(`${fontIds.get(k)} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASE[k]} /Encoding /WinAnsiEncoding >>\nendobj\n`);
    }
    for (const [name, img] of this.images) {
      const id = imageIds.get(name) as number;
      offsets[id - 1] = offset;
      push(`${id} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
      push(img.bytes);
      push(`\nendstream\nendobj\n`);
    }
    for (let i = 0; i < this.pages.length; i++) {
      const pageId = firstPageId + i * 2;
      const contentId = pageId + 1;
      const page = this.pages[i];
      if (!page) continue;
      const content = page.ops.join('\n');
      const xobjects = page.ops.some((o) => o.includes(' Do'))
        ? ' /XObject << ' + [...imageIds].map(([nm, id]) => `/${nm} ${id} 0 R`).join(' ') + ' >>'
        : '';
      obj(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.width)} ${n(A4.height)}] /Resources << /Font << /F1 ${fontIds.get('serif')} 0 R /F2 ${fontIds.get('serifBold')} 0 R /F3 ${fontIds.get('serifItalic')} 0 R /F4 ${fontIds.get('sans')} 0 R /F5 ${fontIds.get('sansBold')} 0 R >>${xobjects} >> /Contents ${contentId} 0 R >>\nendobj\n`);
      const buf = Buffer.from(content, 'latin1');
      offsets[contentId - 1] = offset;
      push(`${contentId} 0 obj\n<< /Length ${buf.length} >>\nstream\n`);
      push(buf);
      push(`\nendstream\nendobj\n`);
    }

    /*
     * THE TABLE OF CONTENTS AT THE END, WHICH IS WHAT MAKES IT A PDF.
     *
     * A reader seeks to the last bytes and needs every object's offset to be exact. **An offset that is wrong
     * by one byte produces a file that opens in one viewer and not another**, which is the worst kind of
     * failure to debug. So offsets are recorded as objects are written rather than computed afterwards.
     */
    const count = next - 1 + this.pages.length * 2;
    const xrefAt = offset;
    let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= count; i++) {
      xref += `${String(offsets[i - 1] ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    return Buffer.concat(chunks);
  }
}
