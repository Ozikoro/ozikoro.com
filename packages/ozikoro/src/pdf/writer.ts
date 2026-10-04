/**
 * A SMALL PDF WRITER, BECAUSE THE DEPENDENCY WOULD NOT INSTALL AND DOES NOT NEED TO.
 *
 * A PDF is a text file with a table of contents at the end. This writes one directly: objects, a page tree,
 * content streams and an xref table. **No package, nothing to audit, nothing to break on an upgrade** — and
 * the whole of it is readable in a sitting.
 *
 * WHAT IT USES FOR TYPE, WHICH CHANGED, AND WHY IT HAD TO
 *
 * This used the base-14 fonts — Times and Helvetica through `/WinAnsiEncoding`. **That encoding stops at
 * U+00FF, so `ọ ụ ị ṅ` and every tone-marked vowel had no code**, and the old `pdfString` below replaced
 * each one with `?`. An Igbo publication that cannot spell `Ụmụ Ọkpụ` is not a publication, it is a
 * corrupted copy of one, **and the fault was invisible to every structural check because a `?` is a valid
 * glyph.**
 *
 * So the writer embeds a real face: a **Type0 font, `/Identity-H`, a CIDFontType2 descendant, a per-document
 * subset and a `/ToUnicode` CMap.** Text is written as two-byte glyph ids, which means the words on the page
 * are the words in the article, marks and all, and they are still searchable, selectable and readable aloud.
 * The subsets are built by `sfnt.ts`; a document that uses four faces of a few hundred glyphs each stays
 * well under a megabyte rather than carrying five multi-megabyte fonts.
 *
 * **When no font files are supplied it falls back to the base-14 fonts and says so** — `usesEmbeddedFonts`
 * reports which happened, because a silent fallback is how the `?` stayed in the file for as long as it did.
 *
 * IMAGES
 *
 * A JPEG goes in through `/DCTDecode` exactly as it is. **A PNG goes in as raw samples through
 * `/FlateDecode`, with an `/SMask` when it has transparency** — which is what the reference publication does
 * and the only way artwork that is gold on nothing can be placed on a dark ground without compositing it
 * onto a guessed colour. See `png.ts`.
 *
 * AND THE ONE THING IT DELIBERATELY DOES NOT DO
 *
 * **It does not rasterise.** Every word is real text in the file, so a PDF from this is searchable,
 * selectable and readable by a screen reader, and it does not turn into a picture of itself at high zoom.
 */
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { decodePng, isJpeg, isPng } from './png.ts';
import { FontError, readFont, type EmbeddableFont } from './sfnt.ts';

/** Points. A4 at 72 dpi, which is what the reference publication is, to the fourth decimal. */
export const A4 = { width: 595.2756, height: 841.8898 };

/**
 * WHERE THE PAGE FURNITURE SITS, IN POINTS, READ OFF THE REFERENCE RATHER THAN CHOSEN.
 *
 * Every number here is a coordinate from the approved publication's own content streams — the cover's
 * margins, the cream header band, the rule under it, the footer rule and the page-number baseline. **They
 * are the reference's geometry, not an approximation of it**, which is why they carry decimals: 53.85827 is
 * 19 mm and 541.4173 is 191 mm, and rounding them to 54 and 541 is a change to the measure.
 */
export const FRAME = {
  /** 19 mm — the left edge of every column on every page. */
  marginLeft: 53.85827,
  /** 191 mm — the right edge of the measure. **A margin on the right, an edge here.** */
  marginRight: 541.4173,
  /** The cream band across the head of every interior page. */
  headerBandHeight: 56.69291,
  /** The hairline under the running head. */
  headerRuleY: 793.7008,
  /** The running head's baseline. */
  headerBaseline: 813.5433,
  /** The small gold icon in the head, at the reference's own box: 1.89:1, never squared off. */
  headerIconX: 53.86308,
  headerIconY: 805.6063,
  headerIconWidth: 24.08486,
  /** Where the running head's text starts, clear of the icon. */
  headerTextX: 87.87402,
  /** The footer's hairline, and the baseline of the words under it. */
  footerRuleY: 36.85039,
  footerBaseline: 25.51181,
  /** The first baseline an interior page may carry, and the last one. */
  bodyTop: 759.685,
  bodyBottom: 60,
};

/** The width of the measure: `marginRight - marginLeft`, and not a percentage of anything. */
export const MEASURE = FRAME.marginRight - FRAME.marginLeft;

/**
 * THE ARCHIVE'S OWN COLOURS, TAKEN FROM THE ARTWORK THAT CARRIES THEM.
 *
 * **Three grounds and an accent, and not one of them is mixed here.** Each value below names the file or the
 * object it came from, and where the logo files and the reference's raster disagree the vector file wins —
 * a raster is a conversion, and a conversion is where a brand colour drifts.
 */
export const OZIKORO = {
  /**
   * **#363434**, the dark charcoal ground.
   *
   * From `assets/official/ozikoro-icon-yellow.svg`'s counterpart `Ozi Ikoro Icon - Brown.svg`, whose only
   * fill is `#363434`, and confirmed independently by the reference cover's own full-bleed rectangle,
   * written as `.211765 .203922 .203922` — 54, 52, 52, which is `#363434` exactly.
   */
  charcoal: [0.211765, 0.203922, 0.203922] as const,
  /**
   * **#174c3d**, the deep green: the cover's left stripe, the section numerals, the feature panel.
   *
   * **Not one of the 32 logo files carries a green**, so the reference's own content stream is the
   * authority: `.090196 .298039 .239216` — 23, 76, 61.
   */
  green: [0.090196, 0.298039, 0.239216] as const,
  /**
   * **#ddb02f**, the gold, from `assets/official/ozikoro-icon-yellow.svg` — `.cls-1{fill:#ddb02f;}`, the
   * only fill in that file, and the colour of every gold pixel in the icon the writer places.
   *
   * The reference's *raster* of the same icon reads `#e2b52e`. **The vector is the brand and the raster is a
   * conversion of it**, so the vector's value is the one used here.
   */
  gold: [0.866667, 0.690196, 0.184314] as const,
  /** **#fffdf9**, the cream head band and the white of the cover title. `1 .992157 .976471`. */
  chalk: [1, 0.992157, 0.976471] as const,
  /** **#d8ccb7**, the cream half of the feature panel. `.847059 .8 .717647`. */
  panel: [0.847059, 0.8, 0.717647] as const,
  /** **#d7ccb7**, the hairline rules. A tenth of a per cent away from the panel, and it reads as one. */
  rule: [0.843137, 0.8, 0.717647] as const,
  /** **#d9d1c0**, the strapline, the byline and the meta line on the dark cover. */
  dim: [0.85098, 0.819608, 0.752941] as const,
  /** **#f2e7cf**, the cover's italic standfirst. */
  standfirst: [0.94902, 0.905882, 0.811765] as const,
  /** **#262322**, the body ink. `.14902 .137255 .133333`. */
  ink: [0.14902, 0.137255, 0.133333] as const,
  /** **#6d655b**, the muted ink of the running head, the meta line and the captions. */
  inkMuted: [0.427451, 0.396078, 0.356863] as const,
  /** **#eee5d5**, the wash behind the editorial note and each reference. `.933333 .898039 .835294`. */
  wash: [0.933333, 0.898039, 0.835294] as const,
};

export type Rgb = readonly [number, number, number];

/** The five roles the layout asks a face for. */
export type FontKey = 'serif' | 'serifBold' | 'serifItalic' | 'sans' | 'sansBold';

/** TrueType files, by role. **Absent means the base-14 fallback, and the PDF says so.** */
export type FontSet = Partial<Record<FontKey, Buffer>>;

/**
 * Escape a string for a PDF literal.
 *
 * **Only the fallback path needs this.** An embedded face writes two-byte glyph ids in angle brackets, where
 * `(`, `)` and `\` are not special at all; a base-14 font writes a literal string, where a stray `(` ends it
 * early and the rest of the title becomes operators.
 */
export function pdfString(text: string): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
  let out = '';
  for (const ch of escaped) {
    const code = ch.codePointAt(0) ?? 63;
    out += code <= 0xff ? ch : code === 0x2019 ? "'" : code === 0x201c || code === 0x201d ? '"' : code === 0x2013 || code === 0x2014 ? '-' : code === 0x2026 ? '...' : '?';
  }
  return out;
}

/** A page's content, as PDF operators. */
export type Op = string;

export type TextOpts = {
  font?: FontKey;
  size?: number;
  rgb?: Rgb;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
  /** Extra space between letters, in points. The reference's small capitals are tracked, not spaced. */
  tracking?: number;
};

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
  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    this.ops.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x3)} ${n(y3)} c`); return this;
  }
  strokeLine() { this.ops.push('S'); return this; }
  closePath() { this.ops.push('h'); return this; }
  fillPath() { this.ops.push('f'); return this; }

  /**
   * A rounded rectangle, as four corners and four edges.
   *
   * **The reference rounds its panels and boxes and not its rules**, and a square-cornered copy of a rounded
   * panel is the sort of difference that reads as "not the same document" without anyone being able to say
   * why. `kappa` is the circular-arc constant: a cubic Bézier with this control-point offset is a quarter
   * circle to within a thousandth of a point.
   */
  roundedRect(x: number, y: number, w: number, h: number, r: number) {
    const k = 0.5523 * r;
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.curveTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.curveTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.curveTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    this.lineTo(x, y + r);
    this.curveTo(x, y + r - k, x + r - k, y, x + r, y);
    this.closePath();
    return this;
  }

  /** A hairline rule. The reference's rules are between a half and one point. */
  rule(x1: number, y: number, x2: number, rgb: Rgb = OZIKORO.rule, width = 0.6) {
    return this.stroke(rgb).lineWidth(width).moveTo(x1, y).lineTo(x2, y).strokeLine();
  }
  save() { this.ops.push('q'); return this; }
  restore() { this.ops.push('Q'); return this; }

  /** Draw text. Returns the drawn width, so a caller can chain a label after it. */
  text(value: string, x: number, y: number, opts: TextOpts = {}): number {
    const font = opts.font ?? 'serif';
    const size = opts.size ?? 11;
    const rgb = opts.rgb ?? OZIKORO.ink;
    const tracking = opts.tracking ?? 0;
    const width = this.doc.widthOf(value, font, size, tracking);
    let tx = x;
    /*
     * **`align` decides on its own, and `maxWidth` only says how wide the box is.** This used to test
     * `opts.align && opts.maxWidth`, and every caller passes `maxWidth: 0` for a run that needs no box —
     * which is falsy, so the branch never ran and `align: 'right'` silently behaved as `left`. The running
     * head then *began* at the right margin instead of ending there, and the page number sat off the edge
     * of the paper. **A right-aligned run with no box means "put my right edge here"**, which is what the
     * reference's head and foot both do.
     */
    if (opts.align) {
      const box = opts.maxWidth ?? 0;
      tx = opts.align === 'center' ? x + (box - width) / 2 : opts.align === 'right' ? x + box - width : x;
    }
    const face = this.doc.face(font);
    this.ops.push('BT', `${rgb[0]} ${rgb[1]} ${rgb[2]} rg`);
    // Character spacing is set before the font so that it applies to this run and is visible to any reader
    // measuring the line. Reset when unset, or it leaks into the next string on the page.
    if (tracking) this.ops.push(`${n(tracking)} Tc`);
    else this.ops.push('0 Tc');
    this.ops.push(`/${font} ${n(size)} Tf`);
    this.ops.push(`${n(tx)} ${n(y)} Td`);
    if (face) this.ops.push(`<${this.doc.encode(value, font)}> Tj`, 'ET');
    else {
      /*
       * **The fallback records what it cannot draw.** A base-14 font through `/WinAnsiEncoding` stops at
       * U+00FF, so `pdfString` turns `ọ ụ ị ṅ` into `?` — and the fault it produces is invisible in the
       * file, because a `?` is a perfectly good glyph. Noting the code points here is what turns "the PDF
       * has no glyph for this" into something a caller can report instead of something nobody notices.
       */
      for (const ch of value) {
        const cp = ch.codePointAt(0) as number;
        if (cp > 0xff) this.doc.missingGlyphs.add(cp);
      }
      this.ops.push(`(${pdfString(value)}) Tj`, 'ET');
    }
    return width;
  }

  /** Draw text across several lines, returning the `y` after the last one. */
  textBlock(
    lines: string[],
    x: number,
    y: number,
    opts: TextOpts & { leading?: number } = {}
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

  /**
   * Place an image, scaled to fit a box and **never scaled unevenly**.
   *
   * This was the one place the aspect ratio could be lost, and the reference lost it: it draws its own
   * 1000×529 icon into a 51×51 square, which stretches it by 1.89 vertically. **That is not copied here.**
   * The box is the room available, the scale is the smaller of the two ratios, and the result is centred.
   */
  image(name: string, x: number, y: number, boxW: number, boxH: number, size: { width: number; height: number }) {
    const scale = Math.min(boxW / size.width, boxH / size.height);
    const w = size.width * scale;
    const h = size.height * scale;
    const ix = x + (boxW - w) / 2;
    const iy = y + (boxH - h) / 2;
    this.ops.push('q', `${n(w)} 0 0 ${n(h)} ${n(ix)} ${n(iy)} cm`, `/${name} Do`, 'Q');
    return { width: w, height: h, x: ix, y: iy };
  }
}

const FONT_ORDER: FontKey[] = ['serif', 'serifBold', 'serifItalic', 'sans', 'sansBold'];
const FONT_BASE: Record<FontKey, string> = {
  serif: 'Times-Roman', serifBold: 'Times-Bold', serifItalic: 'Times-Italic',
  sans: 'Helvetica', sansBold: 'Helvetica-Bold',
};

/**
 * Advance widths for the base-14 fonts, for the characters this archive uses.
 *
 * **Copied from the fonts' own metrics, not guessed.** This is only consulted when no face was supplied —
 * with DejaVu embedded the widths come from the font's own `hmtx`, which is the only way to measure a line
 * containing `ọ` correctly.
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

/** An image the writer can place: a JPEG as it is, or decoded samples with optional coverage. */
type PlacedImage =
  | { kind: 'jpeg'; bytes: Buffer; width: number; height: number }
  | { kind: 'raw'; rgb: Buffer; alpha: Buffer | null; width: number; height: number };

export class PdfDoc {
  readonly pages: PdfPage[] = [];
  readonly images = new Map<string, PlacedImage>();
  /** The faces actually embedded, by role. Empty means the base-14 fallback is in force. */
  readonly faces = new Map<FontKey, EmbeddableFont>();
  /** Which code points each face was asked to draw. **Only these are copied into its subset.** */
  private readonly used = new Map<FontKey, Set<number>>();
  /** Code points that no supplied face could draw. Reported rather than hidden in the text. */
  readonly missingGlyphs = new Set<number>();
  /** Why a face was not embedded, by role. Empty when everything asked for was embedded. */
  readonly fontErrors = new Map<FontKey, string>();

  constructor(fonts?: FontSet | null) {
    if (!fonts) return;
    for (const key of FONT_ORDER) {
      const data = fonts[key];
      if (!data) continue;
      try {
        this.faces.set(key, readFont(data, {
          bold: key === 'serifBold' || key === 'sansBold',
          italic: key === 'serifItalic',
        }));
      } catch (error) {
        /*
         * **A font that will not parse is left out rather than thrown.** The alternative is a download that
         * returns 500 because one file in the repository is the wrong format, and the fallback is a real
         * document with the wrong typeface rather than no document at all. The reason is kept so a caller can
         * say why.
         */
        this.fontErrors.set(key, (error as FontError).message);
      }
    }
  }

  /** True when at least one real face is embedded, so the caller can say which type is in the file. */
  get usesEmbeddedFonts(): boolean { return this.faces.size > 0; }

  face(key: FontKey): EmbeddableFont | null { return this.faces.get(key) ?? null; }

  /** The code points one face has been asked to draw, for subsetting and for the CMaps. */
  usedIn(key: FontKey): Set<number> { return this.used.get(key) ?? new Set<number>(); }

  private note(key: FontKey, cp: number) {
    let set = this.used.get(key);
    if (!set) { set = new Set<number>(); this.used.set(key, set); }
    set.add(cp);
  }

  /**
   * Two-byte glyph ids, big-endian, as `/Identity-H` expects them.
   *
   * **A character the face cannot draw becomes `?`, and is recorded.** That is a visible, searchable
   * substitution rather than a silently dropped letter, and `missingGlyphs` lets the caller report it.
   */
  encode(text: string, key: FontKey): string {
    const face = this.face(key);
    if (!face) throw new FontError('encode() is only for an embedded face');
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0) as number;
      let gid = face.glyph(cp);
      if (!gid) {
        this.missingGlyphs.add(cp);
        gid = face.glyph(0x3f) || 0;
        this.note(key, 0x3f);
        out += hex4(gid);
        continue;
      }
      this.note(key, cp);
      out += hex4(gid);
    }
    return out;
  }

  /** The width of a string in points, from the font's own metrics when one is embedded. */
  widthOf(text: string, font: FontKey, size: number, tracking = 0): number {
    const face = this.face(font);
    let units = 0;
    if (face) {
      for (const ch of text) {
        const cp = ch.codePointAt(0) as number;
        const gid = face.glyph(cp) || face.glyph(0x3f);
        units += gid ? face.advance(gid) : 500;
      }
      const tracked = tracking ? (text.length - 1) * tracking : 0;
      return (units / 1000) * size + tracked;
    }
    const bold = font === 'serifBold' || font === 'sansBold';
    const serif = font === 'serif' || font === 'serifBold' || font === 'serifItalic';
    const table = serif ? TIMES_W : HELVETICA_W;
    for (const ch of text) units += table[ch] ?? (serif ? 500 : 556);
    return (units / 1000) * size * (bold ? 1.03 : 1) + (tracking ? (text.length - 1) * tracking : 0);
  }

  /** Break text to a width. **Words are never split**, because a hyphenated break is read as a hyphen. */
  wrap(text: string, font: FontKey, size: number, maxWidth: number, tracking = 0): string[] {
    const lines: string[] = [];
    for (const para of text.split(/\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) { lines.push(''); continue; }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.widthOf(candidate, font, size, tracking) <= maxWidth) {
          line = candidate;
        } else {
          if (line) lines.push(line);
          // A single word wider than the column is broken, since the alternative is running off the page.
          if (this.widthOf(word, font, size, tracking) > maxWidth) {
            let chunk = '';
            for (const ch of word) {
              if (this.widthOf(chunk + ch, font, size, tracking) > maxWidth) { lines.push(chunk); chunk = ch; }
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

  /** A JPEG, embedded exactly as it is through `/DCTDecode`. */
  addJpeg(name: string, bytes: Buffer, width: number, height: number) {
    this.images.set(name, { kind: 'jpeg', bytes, width, height });
  }

  /**
   * Any image a PDF can carry: a JPEG untouched, a PNG decoded to samples with its own coverage.
   *
   * Returns false when the bytes are neither, so the caller leaves the figure out **rather than writing a
   * WebP's bytes into an image object that claims to be something else** — which renders as a grey rectangle
   * or not at all, and is the fault the old comment in `publication.ts` was written about.
   */
  addImage(name: string, bytes: Buffer): { width: number; height: number } | null {
    if (isJpeg(bytes)) {
      const size = jpegSize(bytes);
      if (!size) return null;
      this.addJpeg(name, bytes, size.width, size.height);
      return size;
    }
    if (isPng(bytes)) {
      const png = decodePng(bytes);
      this.images.set(name, { kind: 'raw', rgb: png.rgb, alpha: png.alpha, width: png.width, height: png.height });
      return { width: png.width, height: png.height };
    }
    return null;
  }

  /** Serialise to a PDF. Objects are written in id order, so every offset in the xref is exact. */
  build(): Buffer {
    const chunks: Buffer[] = [];
    let offset = 0;
    const offsets: number[] = [];
    const push = (body: string | Buffer) => {
      const buf = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
      chunks.push(buf);
      offset += buf.length;
    };
    const bodies: (string | Buffer)[] = [];

    /*
     * THE HEADER, WHICH THIS ONCE FORGOT AND WHICH MAKES THE FILE UNOPENABLE.
     *
     * A PDF must begin `%PDF-1.x` followed by a comment of high bytes. **Without it the file is a sequence of
     * valid PDF objects that no reader will open** — and because every other part of the structure was
     * correct, the only symptom is a document that silently fails to load.
     */
    push('%PDF-1.4\n');
    push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    /*
     * IDS ARE ALLOCATED BEFORE ANYTHING IS WRITTEN, because a page object names the fonts and the images it
     * uses and a font object names its own descriptor and subset. Computing offsets as objects are written
     * only works if the order they are written in is the order their ids run, so it is.
     */
    let next = 1;
    const catalogId = next++;
    const pagesId = next++;
    const fontIds = new Map<FontKey, { type0: number; descendant: number; descriptor: number; file: number; toUnicode: number }>();
    const embedKeys = FONT_ORDER.filter((key) => this.faces.has(key) && this.usedIn(key).size > 0);
    if (embedKeys.length > 0) {
      for (const key of embedKeys) {
        fontIds.set(key, {
          type0: next++, descendant: next++, descriptor: next++, file: next++, toUnicode: next++,
        });
      }
    } else {
      for (const key of FONT_ORDER) fontIds.set(key, { type0: next++, descendant: 0, descriptor: 0, file: 0, toUnicode: 0 });
    }
    /*
     * **ONE IMAGE OBJECT PER PICTURE, HOWEVER MANY NAMES IT IS PLACED UNDER.** The brand icon is drawn on
     * the cover, in every running head and on the back page, so storing it per name put the same 18 KB
     * raster into the file three times over — and an article that repeats a photograph inline did the same
     * with something much larger. The key is a hash of the bytes, so two names share one object exactly
     * when they are the same picture.
     */
    const imageIds = new Map<string, { main: number; mask: number | null }>();
    const uniqueImages: { ids: { main: number; mask: number | null }; image: PlacedImage }[] = [];
    const byContent = new Map<string, { main: number; mask: number | null }>();
    for (const [name, image] of this.images) {
      const key = imageKey(image);
      let ids = byContent.get(key);
      if (!ids) {
        ids = { main: next++, mask: image.kind === 'raw' && image.alpha ? next++ : null };
        byContent.set(key, ids);
        uniqueImages.push({ ids, image });
      }
      imageIds.set(name, ids);
    }
    const firstPageId = next;
    next += this.pages.length * 2;

    bodies[catalogId - 1] = `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;
    const kids = this.pages.map((_, i) => `${firstPageId + i * 2} 0 R`).join(' ');
    bodies[pagesId - 1] = `${pagesId} 0 obj\n<< /Type /Pages /Count ${this.pages.length} /Kids [${kids}] >>\nendobj\n`;

    // ── fonts ────────────────────────────────────────────────────────────────
    const subsets = new Map<FontKey, { bytes: Buffer; face: EmbeddableFont }>();
    for (const key of embedKeys) {
      const ids = fontIds.get(key) as { type0: number; descendant: number; descriptor: number; file: number; toUnicode: number };
      const face = this.faces.get(key) as EmbeddableFont;
      const bytes = face.subset(this.usedIn(key));
      subsets.set(key, { bytes, face });
      const name = fontName(face.family, key);
      const flags = 32 | (face.italic ? 64 : 0) | (face.fixedPitch ? 1 : 0);
      const stream = (body: Buffer) => Buffer.concat([
        Buffer.from(`stream\n`, 'latin1'), body, Buffer.from(`\nendstream\nendobj\n`, 'latin1'),
      ]);
      bodies[ids.file - 1] = Buffer.concat([
        Buffer.from(`${ids.file} 0 obj\n<< /Length ${bytes.length} /Length1 ${bytes.length} /Filter /FlateDecode >>\n`, 'latin1'),
        stream(zlib.deflateSync(bytes)),
      ]);
      const toUnicode = toUnicodeCMap(this.usedIn(key), face);
      const toUnicodeBytes = Buffer.from(toUnicode, 'latin1');
      bodies[ids.toUnicode - 1] = Buffer.concat([
        Buffer.from(`${ids.toUnicode} 0 obj\n<< /Length ${toUnicodeBytes.length} >>\n`, 'latin1'),
        stream(toUnicodeBytes),
      ]);
      bodies[ids.descriptor - 1] = `${ids.descriptor} 0 obj\n<< /Type /FontDescriptor /FontName /${name} /Flags ${flags}`
        + ` /FontBBox [${face.bbox.map(n).join(' ')}] /ItalicAngle ${n(face.italicAngle)}`
        + ` /Ascent ${face.ascent} /Descent ${face.descent} /CapHeight ${face.capHeight}`
        + ` /StemV ${face.bold ? 145 : 80} /FontFile2 ${ids.file} 0 R >>\nendobj\n`;
      bodies[ids.descendant - 1] = `${ids.descendant} 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name}`
        + ` /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>`
        + ` /FontDescriptor ${ids.descriptor} 0 R /DW 1000 /W [${widthArray(this.usedIn(key), face)}]`
        + ` /CIDToGIDMap /Identity >>\nendobj\n`;
      bodies[ids.type0 - 1] = `${ids.type0} 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /${name}`
        + ` /Encoding /Identity-H /DescendantFonts [${ids.descendant} 0 R] /ToUnicode ${ids.toUnicode} 0 R >>\nendobj\n`;
    }
    /*
     * THE BASE-14 FALLBACK, UNDER THE SAME RESOURCE NAMES.
     *
     * It is reached only when no face was supplied or none of them parsed. **It cannot draw `ọ ụ ị ṅ`** —
     * that is the whole reason the embedded path exists — so `usesEmbeddedFonts` is false here and the
     * caller is expected to say so rather than let a reader wonder why an Igbo name has a `?` in it.
     */
    if (embedKeys.length === 0) {
      for (const key of FONT_ORDER) {
        const id = (fontIds.get(key) as { type0: number }).type0;
        bodies[id - 1] = `${id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_BASE[key]} /Encoding /WinAnsiEncoding >>\nendobj\n`;
      }
    }

    // ── images ───────────────────────────────────────────────────────────────
    for (const { ids, image } of uniqueImages) {
      if (image.kind === 'jpeg') {
        bodies[ids.main - 1] = Buffer.concat([
          Buffer.from(`${ids.main} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`
            + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`, 'latin1'),
          image.bytes,
          Buffer.from(`\nendstream\nendobj\n`, 'latin1'),
        ]);
        continue;
      }
      const compressed = zlib.deflateSync(image.rgb);
      const maskClause = ids.mask ? ` /SMask ${ids.mask} 0 R` : '';
      bodies[ids.main - 1] = Buffer.concat([
        Buffer.from(`${ids.main} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`
          + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${maskClause} /Length ${compressed.length} >>\nstream\n`, 'latin1'),
        compressed,
        Buffer.from(`\nendstream\nendobj\n`, 'latin1'),
      ]);
      if (ids.mask && image.alpha) {
        const alpha = zlib.deflateSync(image.alpha);
        bodies[ids.mask - 1] = Buffer.concat([
          Buffer.from(`${ids.mask} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`
            + ` /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${alpha.length} >>\nstream\n`, 'latin1'),
          alpha,
          Buffer.from(`\nendstream\nendobj\n`, 'latin1'),
        ]);
      }
    }

    // ── pages ────────────────────────────────────────────────────────────────
    const fontResources = [...fontIds].map(([key, ids]) => `/${key} ${ids.type0} 0 R`).join(' ');
    const xobjectResources = [...imageIds].map(([name, ids]) => `/${name} ${ids.main} 0 R`).join(' ');
    for (let i = 0; i < this.pages.length; i++) {
      const pageId = firstPageId + i * 2;
      const contentId = pageId + 1;
      const page = this.pages[i] as PdfPage;
      bodies[pageId - 1] = `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(A4.width)} ${n(A4.height)}]`
        + ` /Resources << /Font << ${fontResources} >>`
        + (xobjectResources ? ` /XObject << ${xobjectResources} >>` : '')
        + ` >> /Contents ${contentId} 0 R >>\nendobj\n`;
      const content = Buffer.from(page.ops.join('\n'), 'latin1');
      bodies[contentId - 1] = Buffer.concat([
        Buffer.from(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n`, 'latin1'),
        content,
        Buffer.from(`\nendstream\nendobj\n`, 'latin1'),
      ]);
    }

    const count = bodies.length;
    for (let id = 1; id <= count; id++) {
      offsets[id - 1] = offset;
      const body = bodies[id - 1];
      if (body === undefined) throw new Error(`PDF object ${id} of ${count} was never written`);
      push(body);
    }

    /*
     * THE TABLE OF CONTENTS AT THE END, WHICH IS WHAT MAKES IT A PDF.
     *
     * A reader seeks to the last bytes and needs every object's offset to be exact. **An offset that is wrong
     * by one byte produces a file that opens in one viewer and not another**, which is the worst kind of
     * failure to debug. So offsets are recorded as objects are written rather than computed afterwards.
     */
    const xrefAt = offset;
    let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= count; i++) {
      xref += `${String(offsets[i - 1] ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${count + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    return Buffer.concat(chunks);
  }
}

/**
 * A subset's name, in the form every PDF producer uses: **six capitals, a plus, and the face.**
 *
 * The prefix is derived from the document's own glyph set rather than being random, so the same article
 * generates the same bytes — a publication that changes every time it is downloaded cannot be checked into
 * anything or diffed against last week's.
 */
function fontName(family: string, key: FontKey): string {
  let hash = 0x811c9dc5;
  for (const ch of `${family}:${key}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let tag = '';
  for (let i = 0; i < 6; i++) tag += String.fromCharCode(65 + ((hash >>> (i * 5)) % 26));
  const suffix = key === 'serifBold' || key === 'sansBold' ? '-Bold' : key === 'serifItalic' ? '-Italic' : '';
  return `${tag}+${family}${suffix}`;
}

/**
 * The widths of the glyphs a document actually uses, as the `/W` array.
 *
 * **Consecutive glyph ids are written as one run**, because the array is read by every viewer that lays the
 * page out and a run per glyph would put several thousand numbers in a file for a few hundred drawings.
 */
function widthArray(codePoints: Set<number>, face: EmbeddableFont): string {
  const gids = new Set<number>();
  for (const cp of codePoints) {
    const gid = face.glyph(cp);
    if (gid) gids.add(gid);
  }
  const sorted = [...gids].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i] as number;
    const widths: number[] = [];
    let j = i;
    while (j < sorted.length && (j === i || (sorted[j] as number) === (sorted[j - 1] as number) + 1)) {
      widths.push(face.advance(sorted[j] as number));
      j++;
    }
    parts.push(`${start} [${widths.join(' ')}]`);
    i = j;
  }
  return parts.join(' ');
}

/**
 * The `/ToUnicode` CMap: **glyph id back to the character it was drawn for.**
 *
 * Without this the page looks right and copies as nonsense — every glyph id is an index into DejaVu, so
 * selecting `Ụmụ` yields whatever characters happen to live at those ids. This is the difference between a
 * PDF that is text and a PDF that is a picture of text that happens to be scalable.
 */
function toUnicodeCMap(codePoints: Set<number>, face: EmbeddableFont): string {
  const byGid = new Map<number, number>();
  for (const cp of codePoints) {
    const gid = face.glyph(cp);
    if (gid && !byGid.has(gid)) byGid.set(gid, cp);
  }
  const hex = (v: number, width: number) => v.toString(16).toUpperCase().padStart(width, '0');
  const entries = [...byGid].sort((a, b) => a[0] - b[0]);
  const utf16 = (cp: number) => (cp > 0xffff
    ? hex(0xd800 + ((cp - 0x10000) >> 10), 4) + hex(0xdc00 + ((cp - 0x10000) & 0x3ff), 4)
    : hex(cp, 4));
  const lines: string[] = [
    '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
    '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange',
  ];
  // `beginbfchar` takes at most 100 entries, and a larger block is refused by strict readers.
  for (let i = 0; i < entries.length; i += 100) {
    const block = entries.slice(i, i + 100);
    lines.push(`${block.length} beginbfchar`);
    for (const [gid, cp] of block) lines.push(`<${hex(gid, 4)}> <${utf16(cp)}>`);
    lines.push('endbfchar');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  return lines.join('\n');
}

/** A glyph id as `/Identity-H` wants it: four upper-case hexadecimal digits, big-endian. */
const hex4 = (gid: number) => gid.toString(16).padStart(4, '0').toUpperCase();

/** A content key for an image, so the same picture is one object whichever name it is placed under. */
function imageKey(image: PlacedImage): string {
  const hash = createHash('sha1');
  if (image.kind === 'jpeg') {
    hash.update('jpeg').update(image.bytes);
  } else {
    hash.update(`raw:${image.width}x${image.height}`).update(image.rgb);
    if (image.alpha) hash.update('a').update(image.alpha);
  }
  return hash.digest('hex');
}

/** Pixel dimensions from a JPEG's own start-of-frame marker. */
export function jpegSize(b: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1] as number;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
