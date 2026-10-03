/**
 * THE OZIKORO PUBLICATION LAYOUT.
 *
 * Built to `data/pdf-template/reference.pdf`, read from the file rather than described: **A4, fifteen pages,
 * DejaVu Serif for the body and DejaVu Sans for the labels.** Where this differs it is because the reference's
 * own font files are not shipped — see `writer.ts`, which uses the base-14 fonts instead and says so.
 *
 * THE RULES THAT SHAPED IT
 *
 * 1. **NOTHING IS INVENTED AND NOTHING IS REWRITTEN.** The system is a renderer. A heading is the article's
 *    heading, a caption is the article's caption, and where the archive holds no subtitle, no author biography
 *    or no featured image, **that part of the page is redesigned rather than filled with something else.**
 *
 * 2. **AN IMAGE AND ITS CAPTION DO NOT SEPARATE.** Both are placed together or both move to the next page.
 *    A caption on a different page from its figure is the commonest fault in a generated publication.
 *
 * 3. **A HEADING IS NEVER STRANDED AT THE FOOT.** A heading with no room for the text under it moves to the
 *    next page, which is what `ensure()` exists for.
 *
 * 4. **THE FULL WORDMARK IS ON THE COVER ONLY.** Interior pages carry the small mark in the running head,
 *    which is what the brief asks for and what the reference does.
 */
import { A4, FRAME, OZIKORO, PdfDoc, PdfPage, type Rgb } from './writer.ts';

export type Block =
  | { kind: 'heading'; text: string; level: 2 | 3 }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'image'; data: Buffer; width: number; height: number; caption: string | null; credit: string | null }
  | { kind: 'list'; items: string[] };

export type ArticlePdfInput = {
  slug: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  authorBio: string | null;
  category: string | null;
  published: string | null;
  updated: string | null;
  readingMinutes: number | null;
  featured: { data: Buffer; width: number; height: number; caption: string | null } | null;
  blocks: Block[];
  references: string[];
  tags: string[];
};

const COL = A4.width - FRAME.marginLeft - FRAME.marginRight;
const CONTENT_TOP = A4.height - FRAME.marginTop;
const CONTENT_BOTTOM = FRAME.marginBottom;

const BODY = 11;
const LEADING = BODY * 1.5;
const H2 = 17;
const H3 = 12.5;
const CAPTION = 8.5;

/** Roman numerals, for the front matter. **A cover is not page 1 of the article.** */
function roman(n: number): string {
  const map: [number, string][] = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export class ArticlePdf {
  private doc = new PdfDoc();
  private page: PdfPage;
  private y = CONTENT_TOP;
  /** Where the text column starts on this page — reset when a new page begins. */
  private pageIndex = 0;

  /** Declared and assigned rather than a parameter property — see the note in `writer.ts`. */
  private input: ArticlePdfInput;
  constructor(input: ArticlePdfInput) {
    this.input = input;
    this.page = this.doc.addPage();
  }

  private get bodyWidth() { return COL; }

  /**
   * A new page, with its running head and footer.
   *
   * **The head and foot are written when the page is created rather than when it is finished**, so a page can
   * never be left without them — which is what happens when they are drawn by a separate pass that misses the
   * last page.
   */
  private newPage(): void {
    this.page = this.doc.addPage();
    this.pageIndex += 1;
    this.y = CONTENT_TOP;
    this.runningHead(this.page, this.pageIndex);
  }

  /**
   * The running head: the small mark, the section, and the site.
   *
   * The brief is explicit that the full wordmark does not belong here — **only the mark, small, in proportion**
   * — so this draws a square monogram tile rather than setting the name in type.
   */
  private runningHead(page: PdfPage, index: number): void {
    if (index === 0) return;
    const markSize = 11;
    page.fill(OZIKORO.emeraldDeep).fillRect(FRAME.marginLeft, FRAME.headerY - 2, markSize, markSize);
    page.text('OI', FRAME.marginLeft + 1.9, FRAME.headerY + 1.4, {
      font: 'sansBold', size: 6.5, rgb: OZIKORO.goldBright,
    });
    const label = (this.input.category ?? 'Ozikoro').toUpperCase();
    page.text(label, FRAME.marginLeft + markSize + 7, FRAME.headerY + 1.4, {
      font: 'sans', size: 7, rgb: OZIKORO.inkMuted,
    });
    page.text(`OZIKORO.COM · ${String(index).padStart(2, '0')}`, A4.width - FRAME.marginRight, FRAME.headerY + 1.4, {
      font: 'sans', size: 7, rgb: OZIKORO.inkMuted, align: 'right', maxWidth: 0,
    });
    page.rule(FRAME.marginLeft, FRAME.ruleY, A4.width - FRAME.marginRight, OZIKORO.rule, 0.6);
  }

  private footer(page: PdfPage, index: number, total: number): void {
    if (index === 0) return;
    page.rule(FRAME.marginLeft, FRAME.footerY + 12, A4.width - FRAME.marginRight, OZIKORO.rule, 0.5);
    page.text('Ozi Ikòrò · African History, Culture & Indigenous Knowledge', FRAME.marginLeft, FRAME.footerY, {
      font: 'sans', size: 6.8, rgb: OZIKORO.inkMuted,
    });
    page.text(String(index).padStart(2, '0'), A4.width - FRAME.marginRight, FRAME.footerY, {
      font: 'sans', size: 7.5, rgb: OZIKORO.ink, align: 'right', maxWidth: 0,
    });
  }

  /** Move to a new page if `needed` points will not fit. **This is what keeps headings off page feet.** */
  private ensure(needed: number): void {
    if (this.y - needed < CONTENT_BOTTOM) this.newPage();
  }

  // ── COVER ──────────────────────────────────────────────────────────────────

  private cover(): void {
    const p = this.page;
    // The ivory ground, edge to edge.
    p.fill(OZIKORO.paper).fillRect(0, 0, A4.width, A4.height);
    // A green band across the foot, which is where the imprint sits.
    p.fill(OZIKORO.emeraldDeep).fillRect(0, 0, A4.width, 96);

    let y = A4.height - 74;
    const cx = FRAME.marginLeft;
    const cw = COL;

    // The publication label, in gold, small and letterspaced by its own capitals.
    p.text((this.input.category ?? 'African history').toUpperCase(), cx, y, {
      font: 'sans', size: 8, rgb: OZIKORO.ochre,
    });
    y -= 14;
    p.rule(cx, y, cx + 54, OZIKORO.gold, 1.2);
    y -= 40;

    /*
     * THE WORDMARK, SET FOR THE COVER ONLY.
     *
     * **Drawn as type rather than placed as an image, because the logo files are not in this repository and a
     * stretched or squashed logo is worse than none.** The reference's own wordmark should be dropped in here as
     * a JPEG or PNG at its own aspect ratio — the writer scales an image to fit a box and never distorts it, so
     * that swap is one line and cannot go wrong.
     */
    p.text('Ozi Ikòrò', cx, y, { font: 'serifBold', size: 30, rgb: OZIKORO.emeraldDeep });
    y -= 15;
    p.text('African History, Culture & Indigenous Knowledge', cx, y, {
      font: 'sans', size: 8.5, rgb: OZIKORO.inkMuted,
    });
    y -= 46;

    /*
     * THE TITLE, SIZED TO ITS OWN LENGTH.
     *
     * The brief asks for 24–32pt depending on title length, and this archive has titles of six words and
     * twenty-six. **A fixed size means the long ones run off the page and the short ones look timid**, so the
     * size falls until the title fits in four lines or the floor is reached.
     */
    let titleSize = 31;
    let titleLines: string[] = [];
    while (titleSize >= 21) {
      titleLines = this.doc.wrap(this.input.title, 'serifBold', titleSize, cw);
      if (titleLines.length <= 4 && this.doc.widthOf(titleLines.reduce((a, b) => (a.length > b.length ? a : b), ''), 'serifBold', titleSize) <= cw) break;
      titleSize -= 1.5;
    }
    for (const line of titleLines) {
      p.text(line, cx, y, { font: 'serifBold', size: titleSize, rgb: OZIKORO.ink });
      y -= titleSize * 1.16;
    }
    y -= 8;

    // The subtitle, if there is one. **Absent means this space is simply not used.**
    if (this.input.subtitle) {
      const subLines = this.doc.wrap(this.input.subtitle, 'serifItalic', 13, cw);
      for (const line of subLines.slice(0, 3)) {
        p.text(line, cx, y, { font: 'serifItalic', size: 13, rgb: OZIKORO.inkMuted });
        y -= 18;
      }
      y -= 6;
    }

    p.rule(cx, y, cx + cw, OZIKORO.rule, 0.8);
    y -= 24;

    // The byline and the facts, as label/value pairs. **Each is written only if it exists.**
    const facts: [string, string][] = [];
    if (this.input.author) facts.push(['Author', this.input.author]);
    if (this.input.published) facts.push(['Published', this.input.published]);
    if (this.input.updated) facts.push(['Updated', this.input.updated]);
    if (this.input.readingMinutes) facts.push(['Reading time', `about ${this.input.readingMinutes} minutes`]);
    if (this.input.category) facts.push(['Category', this.input.category]);
    for (const [label, value] of facts) {
      p.text(label.toUpperCase(), cx, y, { font: 'sans', size: 7, rgb: OZIKORO.ochre });
      p.text(value, cx + 96, y, { font: 'serif', size: 10.5, rgb: OZIKORO.ink });
      y -= 16;
    }

    /*
     * THE FEATURED IMAGE, AND THE COVER WHEN THERE IS NONE.
     *
     * **A giant empty image box is the fault the brief names**, so when a record has no featured image the
     * cover keeps its typography and ends cleanly — the facts above, the imprint below, and the space left as
     * space rather than as a hole.
     */
    const bandTop = 96 + 26;
    if (this.input.featured) {
      const boxW = A4.width - FRAME.marginLeft * 2;
      const boxH = Math.min(300, Math.max(160, y - bandTop - 34));
      this.doc.addJpeg('featured', this.input.featured.data, this.input.featured.width, this.input.featured.height);
      p.image('featured', FRAME.marginLeft, bandTop + (this.input.featured.caption ? 22 : 0), boxW, boxH, this.input.featured);
      if (this.input.featured.caption) {
        p.text(this.input.featured.caption.slice(0, 150), FRAME.marginLeft, bandTop + 10, {
          font: 'sans', size: 7.5, rgb: OZIKORO.ochre,
        });
      }
    }

    // The imprint band.
    p.text('OZIKORO.COM', FRAME.marginLeft, 44, { font: 'sansBold', size: 9, rgb: OZIKORO.goldBright });
    p.text('A publication of Ozi Ikòrò Limited', FRAME.marginLeft, 30, {
      font: 'sans', size: 7, rgb: [0.72, 0.78, 0.74] as Rgb,
    });
  }

  // ── BODY ───────────────────────────────────────────────────────────────────

  private drawHeading(level: 2 | 3, text: string): void {
    const size = level === 2 ? H2 : H3;
    const font = level === 2 ? 'serifBold' : 'sansBold';
    const lines = this.doc.wrap(text, font, size, this.bodyWidth);
    // **A heading needs its own height plus three lines of text beneath it**, or it is stranded.
    this.ensure(lines.length * size * 1.2 + LEADING * 3);
    const y0 = this.y;
    for (const line of lines) {
      this.page.text(line, FRAME.marginLeft, this.y, { font, size, rgb: level === 2 ? OZIKORO.emerald : OZIKORO.ink });
      this.y -= size * 1.22;
    }
    if (level === 2) {
      this.page.rule(FRAME.marginLeft, y0 + 4, FRAME.marginLeft + 42, OZIKORO.gold, 1);
      this.y -= 8;
    } else {
      this.y -= 4;
    }
  }

  private drawParagraph(text: string, opts: { lead?: boolean } = {}): void {
    const lines = this.doc.wrap(text, 'serif', BODY, this.bodyWidth);
    for (let i = 0; i < lines.length; i++) {
      this.ensure(LEADING);
      const line = lines[i] as string;
      /*
       * THE DROP CAP, USED SPARINGLY AS THE BRIEF ASKS.
       *
       * **Only on the first paragraph of the article, only when it is long enough to justify one, and only
       * when the article does not open with an image or a quotation** — those cases are excluded by the
       * caller, which knows what the first block is.
       */
      if (opts.lead && i === 0 && line.length > 2) {
        const first = line.slice(0, 1);
        const rest = line.slice(1);
        // The initial sits on the same baseline as the rest of its line, **not raised**, or the two
        // halves read as two separate lines with the first letter floating between them.
        this.page.text(first, FRAME.marginLeft, this.y, { font: 'serifBold', size: BODY * 2.6, rgb: OZIKORO.emeraldDeep });
        const indent = this.doc.widthOf(first, 'serifBold', BODY * 2.6) + 3;
        this.page.text(rest, FRAME.marginLeft + indent, this.y, { font: 'serif', size: BODY, rgb: OZIKORO.ink });
      } else {
        this.page.text(line, FRAME.marginLeft, this.y, { font: 'serif', size: BODY, rgb: OZIKORO.ink });
      }
      this.y -= LEADING;
    }
    this.y -= BODY * 0.55; // paragraph spacing
  }

  private drawQuote(text: string): void {
    const width = this.bodyWidth - 30;
    const lines = this.doc.wrap(text, 'serifItalic', 12.5, width);
    this.ensure(lines.length * 18 + 24);
    // A pull quote: the brief allows one, **taken from the article and never written for it.**
    this.page.fill(OZIKORO.gold).fillRect(FRAME.marginLeft, this.y - lines.length * 18 - 2, 2.4, lines.length * 18 + 12);
    let cy = this.y;
    for (const line of lines) {
      this.page.text(line, FRAME.marginLeft + 14, cy, { font: 'serifItalic', size: 12.5, rgb: OZIKORO.emeraldDeep });
      cy -= 18;
    }
    this.y = cy - 14;
  }

  private drawImage(block: Extract<Block, { kind: 'image' }>): void {
    const maxH = 330;
    const scale = Math.min(this.bodyWidth / block.width, maxH / block.height);
    const h = block.height * scale;
    const captionLines = block.caption ? this.doc.wrap(block.caption, 'sans', CAPTION, this.bodyWidth) : [];
    const creditLine = block.credit ? 1 : 0;
    const needed = h + 10 + captionLines.length * (CAPTION * 1.35) + creditLine * (CAPTION * 1.35) + 14;

    /*
     * **THE IMAGE AND ITS CAPTION MOVE TOGETHER OR NOT AT ALL.**
     *
     * Placing the image and then discovering the caption does not fit puts them on different pages, which is
     * the fault the brief names first. So the whole block is measured before any of it is drawn.
     */
    this.ensure(needed);

    const name = `img${this.pageIndex}-${Math.round(this.y)}`;
    this.doc.addJpeg(name, block.data, block.width, block.height);
    this.page.image(name, FRAME.marginLeft, this.y - h, this.bodyWidth, h, block);
    this.y -= h + 8;

    if (captionLines.length) {
      for (const line of captionLines) {
        this.page.text(line, FRAME.marginLeft, this.y, { font: 'sans', size: CAPTION, rgb: OZIKORO.inkMuted });
        this.y -= CAPTION * 1.35;
      }
    }
    if (block.credit) {
      this.page.text(block.credit, FRAME.marginLeft, this.y, { font: 'sans', size: CAPTION - 0.5, rgb: OZIKORO.ochre });
      this.y -= CAPTION * 1.35;
    }
    this.y -= 14;
  }

  private drawList(items: string[]): void {
    for (const item of items) {
      const lines = this.doc.wrap(item, 'serif', BODY, this.bodyWidth - 16);
      for (let i = 0; i < lines.length; i++) {
        this.ensure(LEADING);
        const line = lines[i] as string;
        if (i === 0) this.page.text('·', FRAME.marginLeft, this.y, { font: 'serif', size: BODY, rgb: OZIKORO.ochre });
        this.page.text(line, FRAME.marginLeft + 14, this.y, { font: 'serif', size: BODY, rgb: OZIKORO.ink });
        this.y -= LEADING;
      }
    }
    this.y -= BODY * 0.5;
  }

  private references(): void {
    if (this.input.references.length === 0) return; // **No references means no section, not a fake one.**
    this.newPage();
    this.drawHeading(2, 'References');
    const numberWidth = 22;
    for (let i = 0; i < this.input.references.length; i++) {
      const text = this.input.references[i] as string;
      const lines = this.doc.wrap(text, 'serif', 9.5, this.bodyWidth - numberWidth);
      this.ensure(lines.length * 13 + 10);
      for (let j = 0; j < lines.length; j++) {
        const line = lines[j] as string;
        if (j === 0) {
          this.page.text(String(i + 1).padStart(2, '0'), FRAME.marginLeft, this.y, {
            font: 'sansBold', size: 8, rgb: OZIKORO.gold,
          });
        }
        this.page.text(line, FRAME.marginLeft + numberWidth, this.y, { font: 'serif', size: 9.5, rgb: OZIKORO.ink });
        this.y -= 13;
      }
      this.y -= 8;
    }
  }

  /** The author, only if a biography exists. **A heading over nothing is not a section.** */
  private aboutAuthor(): void {
    if (!this.input.author || !this.input.authorBio) return;
    this.ensure(120);
    this.y -= 14;
    this.page.rule(FRAME.marginLeft, this.y + 8, A4.width - FRAME.marginRight, OZIKORO.rule, 0.6);
    this.y -= 6;
    this.drawHeading(3, 'About the author');
    this.page.text(this.input.author, FRAME.marginLeft, this.y, {
      font: 'serifBold', size: 11, rgb: OZIKORO.emeraldDeep,
    });
    this.y -= 16;
    const lines = this.doc.wrap(this.input.authorBio, 'serif', 10, this.bodyWidth);
    for (const line of lines) {
      this.ensure(14);
      this.page.text(line, FRAME.marginLeft, this.y, { font: 'serif', size: 10, rgb: OZIKORO.inkMuted });
      this.y -= 14;
    }
  }

  /** The closing page: the mark, the name, and the three things this archive is for. */
  private backPage(): void {
    this.newPage();
    const p = this.page;
    p.fill(OZIKORO.paper).fillRect(0, 0, A4.width, A4.height);
    const mid = A4.height / 2;
    p.fill(OZIKORO.emeraldDeep).fillRect(FRAME.marginLeft, mid + 54, 34, 34);
    p.text('OI', FRAME.marginLeft + 6, mid + 66, { font: 'sansBold', size: 18, rgb: OZIKORO.goldBright });
    p.text('Ozi Ikòrò', FRAME.marginLeft, mid + 18, { font: 'serifBold', size: 20, rgb: OZIKORO.emeraldDeep });
    let y = mid - 10;
    for (const line of ['African History', 'Culture', 'Indigenous Knowledge']) {
      p.text(line, FRAME.marginLeft, y, { font: 'sans', size: 9.5, rgb: OZIKORO.inkMuted });
      y -= 14;
    }
    p.rule(FRAME.marginLeft, y - 6, FRAME.marginLeft + 60, OZIKORO.gold, 1);
    p.text('ozikoro.com', FRAME.marginLeft, y - 26, { font: 'sansBold', size: 9, rgb: OZIKORO.ochre });
  }

  render(): Buffer {
    this.cover();
    this.newPage();

    /*
     * THE BODY.
     *
     * **A drop cap is used only when the article opens with prose** — the brief excludes an opening image, an
     * opening quotation and a very short opening paragraph, and each of those is checked here rather than
     * assumed.
     */
    const firstContent = this.input.blocks.find((b) => b.kind !== 'heading');
    const openWithProse =
      firstContent?.kind === 'paragraph' && firstContent.text.trim().length > 220;

    let seenProse = false;
    for (const block of this.input.blocks) {
      switch (block.kind) {
        case 'heading':
          this.drawHeading(block.level, block.text);
          break;
        case 'paragraph':
          this.drawParagraph(block.text, { lead: openWithProse && !seenProse });
          seenProse = true;
          break;
        case 'quote':
          this.drawQuote(block.text);
          break;
        case 'image':
          this.drawImage(block);
          break;
        case 'list':
          this.drawList(block.items);
          break;
      }
    }

    this.aboutAuthor();
    this.references();
    this.backPage();

    // The footers are written last because the page count is not known until the document is finished.
    const total = this.doc.pages.length;
    for (let i = 1; i < this.doc.pages.length; i++) {
      const page = this.doc.pages[i];
      if (page) this.footer(page, i, total);
    }
    return this.doc.build();
  }
}
