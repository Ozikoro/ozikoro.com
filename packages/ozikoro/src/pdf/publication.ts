/**
 * THE OZIKORO PUBLICATION LAYOUT.
 *
 * Built from the owner's approved reference, **read out of the file rather than described.** Every number
 * below is a coordinate from that PDF's own content streams: the cover's charcoal ground is
 * `.211765 .203922 .203922`, its green stripe is 14.17323 points wide, its title sits at y=586.7717 and its
 * feature panel begins at y=136.063. Two earlier versions of this file were written from a *description* of
 * the reference and both were wrong in the same way — **they looked like a different magazine that happened
 * to be A4**, which is exactly what the owner said when he saw one.
 *
 * WHAT THE REFERENCE IS, AND THE ONE THING ABOUT IT THAT IS NOT COPIED
 *
 * It is a dark magazine cover, cream-banded interior pages, numbered sections, a drop cap, an editorial
 * note, a wash box per reference, a green author panel and a dark back page. **It also stretches its own
 * logo**: the 1000×529 icon is drawn into a 51×51 square on the cover and a 62×62 square on the back,
 * which squashes the artwork by 1.89 vertically. That one thing is deliberately not reproduced — the box
 * here is the room available and the scale is the smaller of the two ratios — because a distorted logo is
 * not what the brand's own file contains, and "what the brand contains" is the thing being matched.
 *
 * THE RULES THAT SHAPED IT
 *
 * 1. **NOTHING IS INVENTED AND NOTHING IS REWRITTEN.** The system is a renderer. A heading is the article's
 *    heading, a caption is the article's caption, and where the archive holds no standfirst, no biography
 *    or no featured image, **that part of the page is designed away rather than filled with something
 *    else.** The only sentences this file writes are the ones the approved template itself carries —
 *    the strapline, the editorial note, the feature-panel provenance line and the back page's slogan —
 *    and each is quoted from the reference.
 *
 * 2. **A SECTION NUMBER IS THE ARTICLE'S OWN ORDER, NOT AN INVENTED STRUCTURE.** The reference numbers its
 *    sections `01`, `02`, `03`… and that article carries its headings as `<h3>`, not `<h2>`. **So the
 *    headings that get numbers are the shallowest heading level the article actually uses** — where a
 *    record has `<h2>`s those are the sections, and where it has only `<h3>`s those are. An article with no
 *    headings gets no numbered sections, which is the correct outcome rather than a gap to fill.
 *
 * 3. **AN IMAGE AND ITS CAPTION DO NOT SEPARATE.** Both are placed together or both move to the next page.
 *
 * 4. **A HEADING IS NEVER STRANDED AT THE FOOT.** A heading with no room for three lines of text under it
 *    moves to the next page, which is what `ensure()` exists for.
 *
 * 5. **NO TEXT SITS UNDER THE PAGE NUMBER.** The last baseline on any page is above the footer rule.
 */
import {
  A4, FRAME, MEASURE, OZIKORO, PdfDoc, PdfPage, type FontKey, type FontSet, type Rgb,
} from './writer.ts';

export type Block =
  | { kind: 'heading'; text: string; level: 2 | 3 }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'image'; data: Buffer; width: number; height: number; caption: string | null; credit: string | null }
  | { kind: 'list'; items: string[] }
  /**
   * A key/value box built from a list the article already contains — **never from prose, and never with
   * a heading this renderer wrote.** See the rule in `lib/publication.ts`.
   */
  | { kind: 'infobox'; rows: { label: string; value: string }[] };

/**
 * A raster the writer can embed: **a JPEG as it is, or a PNG with its own transparency.**
 *
 * `width` and `height` are the pixel dimensions, and the layout needs them before it places anything —
 * a figure whose height is unknown cannot be measured against the space left on the page, and the first
 * fault that causes is an image and its caption on two different pages.
 */
export type Raster = { data: Buffer; width: number; height: number };

/**
 * THE OFFICIAL LOGO, AS THE ARTWORK RATHER THAN AS TYPE.
 *
 * The cover used to set `Ozi Ikòrò` in Times-Bold and the running head drew an `OI` monogram tile, and
 * before that it embedded two JPEGs cut out of an unrelated reference PDF — **the wrong artwork, composited
 * onto a guessed background, which is why the owner said the publication did not look like his magazine at
 * all.** The icon below is the brand's own file: `assets/official/ozikoro-icon-yellow.svg`, whose only fill
 * is `#ddb02f`, rendered once to PNG so that its transparency survives into the PDF through an `/SMask`
 * instead of being flattened onto a colour.
 *
 * **Null is a real state and not an error**: with no icon the cover sets the wordmark in type and the
 * running head carries the words alone, exactly as it did before. A missing logo is a smaller fault than a
 * drawn one, which is the same rule the figures follow.
 *
 * The reference carries the icon *and* sets `Ozi Ikòrò` in DejaVu Serif Bold beside it — its own cover
 * proves it, because the wordmark's glyphs come from `/F2+0` and not from the image. **That is what is done
 * here too**, and it is why only the icon is needed as artwork.
 */
export type ArticleLogo = { icon: Raster | null };

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
  logo?: ArticleLogo | null;
  /** TrueType faces by role. **Without them the writer falls back to the base-14 fonts.** */
  fonts?: FontSet | null;
};

/** The left offset of the measure, and its width, as named constants rather than repeated arithmetic. */
const LEFT = FRAME.marginLeft;

const BODY = 10.6;
const LEADING = 16.2;
/** The drop cap, at the reference's own ratio of initial to body — 31 points over 10.6. */
const CAP_SIZE = BODY * 2.9;
const HEADING = 17;
const SUBHEADING = 12.5;
const CAPTION = 8.5;

/**
 * THE TEMPLATE'S OWN WORDS, QUOTED FROM THE APPROVED REFERENCE AND FROM NOWHERE ELSE.
 *
 * Each of these is furniture rather than article content: they describe the publication and never the
 * subject. **Anything not in this list is the article's own text or is not on the page.**
 */
/**
 * The strapline exactly as the reference writes it — **including the two spaces around each separator,
 * which is the reference's own letter-spacing** — and with no character spacing of its own. At 5.8 points
 * this measures 195.0 against the reference's rendered 193.0; the 2-point difference is the antialiasing
 * threshold at both ends of the line, not a different setting.
 */
const STRAPLINE = 'AFRICAN HISTORY  ·  CULTURE  ·  INDIGENOUS KNOWLEDGE';
const TOPIC_FALLBACK = 'African history';
const FEATURE_LABEL = 'FEATURE IMAGE';
const FEATURE_PROVENANCE = 'Article image · caption retained from the published Ozikoro article';
const FEATURE_EMPTY = 'No featured image in the record';
const FEATURE_EMPTY_NOTE = 'The article carries no featured image, so this panel is left as an honest empty space rather than filled with one.';
const COVER_FOOTNOTE = 'AUTOMATIC PUBLICATION TEMPLATE · ARTICLE IMAGES ARE INSERTED FROM THE CMS';
const EDITORIAL_LABEL = 'EDITORIAL NOTE';
const EDITORIAL_BODY = 'This publication preserves the article’s structure while adapting it for comfortable long-form reading. Images, captions, credits, metadata and references are intended to be imported automatically from the website.';
const REFERENCES_LABEL = 'SOURCES';
const REFERENCES_NOTE = 'The references below are reproduced from the published article. In the production system, this section should be generated directly from the article’s reference data.';
const ABOUT_LABEL = 'ABOUT THE AUTHOR';
const FOOTER_TEXT = 'Ozi Ikòrò  ·  African History, Culture & Indigenous Knowledge';
const BACK_SLOGAN = 'History worth reading.';
const BACK_STRAPLINE = 'African history · culture · indigenous knowledge';
const BACK_SITE = 'OZIKORO.COM';

/** Pages the furniture treats differently, decided when the page is created rather than when it is filled. */
type PageKind = 'cover' | 'opening' | 'body' | 'references' | 'back';

export class ArticlePdf {
  private doc: PdfDoc;
  private page: PdfPage;
  private y = FRAME.bodyTop;
  private pageIndex = 0;
  private readonly kinds: PageKind[] = [];
  /** True once the article's opening prose has been drawn, so the drop cap is used exactly once. */
  private opened = false;

  /** Declared and assigned rather than a parameter property — see the note in `writer.ts`. */
  private input: ArticlePdfInput;
  constructor(input: ArticlePdfInput) {
    this.input = input;
    this.doc = new PdfDoc(input.fonts ?? null);
    this.page = this.doc.addPage();
    this.kinds.push('cover');
  }

  /** The pages, in order, after `render()`. **For checking the page furniture rather than trusting it.** */
  get pages(): readonly PdfPage[] { return this.doc.pages; }

  /** One embedded face, or null when the fallback is in force. For callers that check rather than hope. */
  face(key: FontKey) { return this.doc.face(key); }

  /** What was actually embedded, for a caller that wants to check rather than hope. */
  diagnostics() {
    const face = (key: FontKey) => this.doc.face(key);
    return {
      pages: this.doc.pages.length,
      embeddedFonts: [...this.doc.faces.keys()].map((key) => ({
        key, family: face(key)?.family ?? '', embedded: true,
      })),
      fontErrors: [...this.doc.fontErrors].map(([key, reason]) => ({ key, reason })),
      /** Code points no supplied face could draw. **An empty list is the proof the Igbo letters render.** */
      missingGlyphs: [...this.doc.missingGlyphs].map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`),
      /** How many bytes of the file are the typefaces, so "embedded" is a measurement and not a claim. */
      fontBytes: [...this.doc.faces.keys()]
        .filter((key) => this.doc.usedIn(key).size > 0)
        .reduce((total, key) => total + (face(key)?.subset(this.doc.usedIn(key)).length ?? 0), 0),
      usesEmbeddedFonts: this.doc.usesEmbeddedFonts,
    };
  }

  private get bodyWidth() { return MEASURE; }

  /**
   * A new page, with its running head.
   *
   * **The head is written when the page is created rather than when it is finished**, so a page can never
   * be left without one — which is what happens when the head is drawn by a separate pass that misses the
   * last page. The footers are the exception, because the page count is not known until the end.
   */
  private newPage(kind: PageKind = 'body'): void {
    this.page = this.doc.addPage();
    this.pageIndex += 1;
    this.kinds.push(kind);
    this.y = FRAME.bodyTop;
    this.runningHead(this.page, this.pageIndex, kind);
  }

  /**
   * The running head, at the reference's own coordinates: the small gold icon, the topic, the site and the
   * page number, on a cream band with a hairline under it.
   *
   * The words are the reference's own rule, read from its pages rather than guessed: **the opening page
   * carries the topic, every page after it carries the article's short title, and the references page says
   * `REFERENCES`.** The brief calls this an alternating head; what alternates is the topic and the title.
   */
  private runningHead(page: PdfPage, index: number, kind: PageKind): void {
    if (index === 0 || kind === 'back') return;
    page.fill(OZIKORO.chalk).fillRect(0, A4.height - FRAME.headerBandHeight, A4.width, FRAME.headerBandHeight);

    const icon = this.input.logo?.icon ?? null;
    if (icon) {
      this.doc.addImage('ozikoro-icon-head', icon.data);
      // The box is the reference's, and the icon inside it keeps its own aspect ratio: 24.085 × 12.745.
      page.image('ozikoro-icon-head', FRAME.headerIconX, FRAME.headerIconY, FRAME.headerIconWidth,
        FRAME.headerIconWidth * 0.529, icon);
    }

    const label = kind === 'references' ? 'REFERENCES' : index <= 1 ? (this.input.category ?? TOPIC_FALLBACK).toUpperCase() : this.shortTitle();
    const available = FRAME.marginRight - FRAME.headerTextX - this.doc.widthOf('OZIKORO.COM  ·  00', 'sans', 5.2) - 24;
    page.text(fit(this.doc, label, 'sansBold', 5.7, available), FRAME.headerTextX, FRAME.headerBaseline, {
      font: 'sansBold', size: 5.7, rgb: OZIKORO.inkMuted,
    });
    this.number(page, index, 5.2, FRAME.headerBaseline);
    page.rule(LEFT, FRAME.headerRuleY, FRAME.marginRight, OZIKORO.rule, 0.55);
  }

  /**
   * `OZIKORO.COM · NN`, right-aligned on the measure. Gold on the references page, as the reference has it.
   *
   * **The number is the page's own page number, and the cover is page one.** The reference's opening page
   * is `02` because its cover is `01`, and an off-by-one here prints a publication whose front matter and
   * whose footer disagree about which page a reader is on.
   */
  private number(page: PdfPage, index: number, size: number, baseline: number, gold = false): void {
    page.text(`OZIKORO.COM  ·  ${String(index + 1).padStart(2, '0')}`, FRAME.marginRight, baseline, {
      font: 'sans', size, rgb: gold ? OZIKORO.gold : OZIKORO.inkMuted, align: 'right', maxWidth: 0,
    });
  }

  private footer(page: PdfPage, index: number, kind: PageKind): void {
    if (index === 0 || kind === 'back') return;
    page.rule(LEFT, FRAME.footerRuleY, FRAME.marginRight, OZIKORO.rule, 0.5);
    page.text(FOOTER_TEXT, LEFT, FRAME.footerBaseline, { font: 'sans', size: 5.3, rgb: OZIKORO.inkMuted });
    page.text(String(index + 1).padStart(2, '0'), FRAME.marginRight, FRAME.footerBaseline, {
      font: 'sans', size: 5.3, rgb: OZIKORO.inkMuted, align: 'right', maxWidth: 0,
    });
  }

  /**
   * The article's short title: what the title says before its colon.
   *
   * The reference's head reads `UTE-OKPU` for a title of `Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots`,
   * and its cover splits the same title at the same colon. **Longer titles are cut at a word boundary that
   * fits rather than hyphenated or abbreviated**, and a title that cannot be shortened and still fit falls
   * back to the topic, which is furniture and therefore never wrong.
   */
  private shortTitle(): string {
    const beforeColon = this.input.title.split(':')[0] ?? this.input.title;
    const upper = (beforeColon || this.input.title).toUpperCase().trim();
    const room = FRAME.marginRight - FRAME.headerTextX - this.doc.widthOf('OZIKORO.COM  ·  00', 'sans', 5.2) - 24;
    if (this.doc.widthOf(upper, 'sansBold', 5.7) <= room) return upper;
    const words = upper.split(/\s+/);
    while (words.length > 1) {
      words.pop();
      const candidate = words.join(' ');
      if (this.doc.widthOf(candidate, 'sansBold', 5.7) <= room) return candidate;
    }
    return (this.input.category ?? TOPIC_FALLBACK).toUpperCase();
  }

  /** Move to a new page if `needed` points will not fit. **This is what keeps headings off page feet.** */
  private ensure(needed: number): void {
    if (this.y - needed < FRAME.bodyBottom) this.newPage('body');
  }

  // ── COVER ──────────────────────────────────────────────────────────────────

  /**
   * The cover, at the reference's own coordinates.
   *
   * The title is split at its colon the way the reference splits its own: the part before it in the heavy
   * white display size, the part after it in the cream italic. **A title with no colon is one display
   * block and no italic line** — nothing is cut off mid-phrase to make a second line exist.
   */
  private cover(): void {
    const p = this.page;
    const title = this.input.title;
    const colon = title.indexOf(':');
    const display = colon > 0 ? title.slice(0, colon + 1) : title;
    const continuation = colon > 0 ? title.slice(colon + 1).trim() : '';

    // The ground, edge to edge, and the green stripe down the left, at the reference's 14.17323 points.
    p.fill(OZIKORO.charcoal).fillRect(0, 0, A4.width, A4.height);
    p.fill(OZIKORO.green).fillRect(0, 0, 14.17323, A4.height);

    /*
     * THE LOCKUP: THE OFFICIAL ICON AND THE NAME BESIDE IT.
     *
     * The reference draws a 1000×529 icon into a 51.02-point square, which stretches it; here the icon is
     * 51.02362 points **wide** and its own height tall, with its top edge where the reference's top edge is,
     * so the lockup's optical centre still lands on the wordmark's.
     */
    const iconW = 51.02362;
    const iconTop = 753.41;
    const wordmarkX = 116.2205;
    const icon = this.input.logo?.icon ?? null;
    if (icon) {
      const h = (icon.height / icon.width) * iconW;
      this.doc.addImage('ozikoro-icon-cover', icon.data);
      p.image('ozikoro-icon-cover', LEFT, iconTop - h, iconW, h, icon);
    }
    p.text('Ozi Ikòrò', wordmarkX, 731.3386, { font: 'serifBold', size: 22, rgb: OZIKORO.gold });
    p.text(STRAPLINE, wordmarkX, 714.3307, { font: 'sansBold', size: 5.8, rgb: OZIKORO.dim });

    // The full-measure gold rule under the lockup, one point, as the reference draws it.
    p.rule(LEFT, 688.8189, FRAME.marginRight, OZIKORO.gold, 1);

    // The topic, small and tracked, and then the title.
    p.text((this.input.category ?? TOPIC_FALLBACK).toUpperCase(), LEFT, 646.2992, {
      font: 'sansBold', size: 6.2, rgb: OZIKORO.gold,
    });

    let y = 586.7717;
    /*
     * The title's size falls until it fits, exactly as the brief asks, but **it falls within the reference's
     * own band** — the space between the topic line and the short gold rule — so a long title cannot push
     * the byline into the feature panel. The reference's own title is 31 points.
     */
    const band = y - 520;
    let size = 31;
    let lines: string[] = [];
    for (; size >= 15; size -= 1) {
      lines = this.doc.wrap(display, 'serifBold', size, this.bodyWidth);
      if (lines.length * size * 1.2 <= band) break;
    }
    /*
     * **A long title grows upward rather than pushing the byline down.** The block is bottom-aligned to the
     * band's floor and its top is capped just under the topic line, so a four-line title spends the empty
     * charcoal above it and leaves the byline, the meta line and the short gold rule exactly where the
     * reference puts them. Without this, the archive's longest titles walk the rule into the feature panel.
     */
    const blockHeight = lines.length * size * 1.2;
    y = Math.min(630, 520 + blockHeight);
    for (const line of lines) {
      p.text(line, LEFT, y, { font: 'serifBold', size, rgb: OZIKORO.chalk });
      y -= size * 1.2;
    }
    if (continuation) {
      y -= 6;
      const italics = this.doc.wrap(continuation, 'serifItalic', 22, this.bodyWidth);
      for (const line of italics) {
        p.text(line, LEFT, y, { font: 'serifItalic', size: 22, rgb: OZIKORO.standfirst });
        y -= 26.4;
      }
    }

    y -= 12;
    if (this.input.author) {
      p.text(`By ${this.input.author}`, LEFT, y, { font: 'serif', size: 9.5, rgb: OZIKORO.dim });
      y -= 19.85;
    }
    const meta = [
      'Ozikoro.com',
      this.input.category,
      this.input.readingMinutes ? `${this.input.readingMinutes} min read` : null,
    ].filter(Boolean).join('  ·  ');
    p.text(meta, LEFT, y, { font: 'sans', size: 6, rgb: OZIKORO.dim });
    y -= 22.67;
    p.fill(OZIKORO.gold).fillRect(LEFT, y, 85.03937, 2.834646);

    this.featurePanel();
    p.text(COVER_FOOTNOTE, LEFT, 42.51969, { font: 'sans', size: 5.5, rgb: OZIKORO.dim });
  }

  /**
   * The feature panel: a green column carrying the label, and a cream panel carrying the caption.
   *
   * **It degrades honestly.** With a caption the panel carries the caption and the reference's own
   * provenance line; with a figure the figure is drawn inside it as well; with neither, the panel says so in
   * the same position and at the same size. **It never borrows a stock image and never writes a caption** —
   * the reference's caption is a real one from a real article, and an article without one gets an empty
   * panel with a label, which is a smaller fault than a fabricated sentence.
   */
  private featurePanel(): void {
    const p = this.page;
    const bottom = 136.063;
    const greenWidth = 96.37795;
    const captionX = LEFT + 116.2205;
    /*
     * THE CAPTION'S OWN COLUMN, AND WHY IT IS NARROWER THAN THE PICTURE'S.
     *
     * The reference wraps its caption `The picture of the Obi of Ute Okpu,` / `Obi Solomon Chukwuk`, which
     * at 12-point DejaVu Serif Bold means a column between 238.32 and 265.90 points — the first line
     * measures 238.32 and the same line with the next word on it measures 265.90. **250 is inside that
     * window and is therefore the reference's own wrap, reproduced rather than approximated.** A picture,
     * though, may use the whole cream panel, so the two widths are not the same number.
     */
    const captionWidth = 250;
    const pictureWidth = FRAME.marginRight - captionX - 16;
    const featured = this.input.featured;
    const caption = featured?.caption ?? null;

    const captionLines = caption ? this.doc.wrap(caption, 'serifBold', 12, captionWidth).slice(0, 3) : [];
    const captionBlock = captionLines.length * 19.8425 + (caption ? 20 : 0);

    // The figure at its natural aspect across the picture column, then reduced to whatever the panel allows.
    let pictureHeight = featured ? (featured.height / featured.width) * pictureWidth : 0;
    // The panel may climb, but not into the short gold rule above it: **36 points of charcoal stay clear**,
    // which is what keeps the cover's own breathing space rather than filling every point with content.
    const maxPanel = 462.0472 - 36 - bottom;
    let panelHeight = 45.36 + captionBlock + pictureHeight + 16;
    panelHeight = Math.min(Math.max(panelHeight, 204.0945), maxPanel);
    if (featured) pictureHeight = Math.max(0, Math.min(pictureHeight, panelHeight - 45.36 - captionBlock - 16));

    const top = bottom + panelHeight;
    p.fill(OZIKORO.panel).fillRect(LEFT, bottom, MEASURE, panelHeight);
    p.fill(OZIKORO.green).fillRect(LEFT, bottom, greenWidth, panelHeight);
    let labelY = top - 33.9;
    for (const word of FEATURE_LABEL.split(' ')) {
      p.text(word, LEFT + 17.00787, labelY, { font: 'sansBold', size: 6, rgb: OZIKORO.chalk });
      labelY -= 19.8425;
    }

    let captionY = top - 45.36;
    for (const line of captionLines) {
      p.text(line, captionX, captionY, { font: 'serifBold', size: 12, rgb: OZIKORO.ink });
      captionY -= 19.8425;
    }
    if (caption) {
      p.text(FEATURE_PROVENANCE, captionX, captionY - 9.5, { font: 'sans', size: 5.6, rgb: OZIKORO.inkMuted });
    }

    if (featured && pictureHeight > 40) {
      const name = 'featured';
      this.doc.addImage(name, featured.data);
      p.image(name, captionX, bottom + 16, pictureWidth, pictureHeight, featured);
    } else if (!featured) {
      /*
       * **The honest empty panel.** No figure in the record means no figure on the cover — the space says
       * so in the article's own absence rather than borrowing a stock photograph or a grey rectangle that
       * reads as a broken image. The reference's own cover is this exact case: it carries the caption and
       * leaves the picture to the CMS.
       */
      p.text(FEATURE_EMPTY.toUpperCase(), captionX, top - 45.36, { font: 'sansBold', size: 6, rgb: OZIKORO.ink });
      let emptyY = top - 65.2;
      for (const line of this.doc.wrap(FEATURE_EMPTY_NOTE, 'sans', 8, captionWidth)) {
        p.text(line, captionX, emptyY, { font: 'sans', size: 8, rgb: OZIKORO.inkMuted });
        emptyY -= 11;
      }
    }
  }

  // ── BODY ───────────────────────────────────────────────────────────────────

  /**
   * A numbered section: the number in green, a short gold rule under it, and the heading.
   *
   * **The number is the article's own order and nothing else is added to it** — no invented heading, no
   * "Introduction" over a paragraph the article never titled.
   */
  private drawSection(number: number, text: string): void {
    // The reference's own spacing: the numeral on the first baseline, the gold rule 8.5 points below it,
    // and the heading 39.685 points below the numeral. **Nothing here resets to the top of the page** —
    // a section that starts halfway down one must not be dragged to the top of it.
    this.ensure(39.685 + HEADING * 1.25 + LEADING * 3);
    const top = this.y;
    this.page.text(String(number).padStart(2, '0'), LEFT, top, { font: 'sansBold', size: 6, rgb: OZIKORO.green });
    this.page.fill(OZIKORO.gold).fillRect(LEFT, top - 8.5039, 42.51969, 2.267717);
    this.y = top - 39.685;
    this.drawHeading(2, text);
  }

  private drawHeading(level: 2 | 3, text: string): void {
    const size = level === 2 ? HEADING : SUBHEADING;
    const font: FontKey = level === 2 ? 'serifBold' : 'serifBold';
    const rgb: Rgb = level === 2 ? OZIKORO.ink : OZIKORO.ink;
    const lines = this.doc.wrap(text, font, size, this.bodyWidth);
    // **A heading needs its own height plus three lines of text beneath it**, or it is stranded.
    this.ensure(lines.length * size * 1.2 + LEADING * 3);
    const y0 = this.y;
    for (const line of lines) {
      this.page.text(line, LEFT, this.y, { font, size, rgb });
      this.y -= size * 1.2;
    }
    void y0;
    this.y -= level === 2 ? 8 : 5;
  }

  /**
   * The article's standfirst, set under the title on the opening page.
   *
   * The reference's own standfirst is not on its pages — but its `standfirst` field is prose the article
   * carries, and **a record's own words are never dropped to match a template.** It is set here, once,
   * in the article's own sentence order.
   */
  private drawStandfirst(text: string): void {
    const lines = this.doc.wrap(text, 'serifItalic', 11.5, this.bodyWidth);
    this.ensure(lines.length * 16 + 18);
    this.y -= 4;
    for (const line of lines) {
      this.ensure(16);
      this.page.text(line, LEFT, this.y, { font: 'serifItalic', size: 11.5, rgb: OZIKORO.inkMuted });
      this.y -= 16;
    }
    this.y -= 10;
  }

  private drawParagraph(text: string, opts: { lead?: boolean } = {}): void {
    const size = BODY;
    const leading = LEADING;
    if (opts.lead) {
      this.drawLeadParagraph(text, size, leading);
      return;
    }
    const lines = this.doc.wrap(text, 'serif', size, this.bodyWidth);
    for (const line of lines) {
      this.ensure(leading);
      this.page.text(line, LEFT, this.y, { font: 'serif', size, rgb: OZIKORO.ink });
      this.y -= leading;
    }
    this.y -= size * 0.55; // paragraph spacing
  }

  /**
   * THE DROP CAP, AND THE MEASURE IT HAS TO RESPECT.
   *
   * **The initial spans two lines, and exactly those two lines are shortened.** An earlier version put the
   * cap on the first line's own baseline and left a hole beneath it — the two halves read as two separate
   * lines with the first letter floating between them, which is what the reference avoids by dropping its
   * cap's baseline half a line below the first one. That is what this does: the cap sits `leading / 2`
   * under the first baseline, so its foot lands just above the second line and no hole is left.
   *
   * The reference goes further and indents the whole paragraph, which makes page 2 a different measure from
   * every page after it. **That is a fault in the reference and it is not reproduced.**
   */
  private drawLeadParagraph(text: string, size: number, leading: number): void {
    const cap = text.slice(0, 1);
    const words = text.slice(1).split(/\s+/).filter(Boolean);
    const capWidth = this.doc.widthOf(cap, 'serifBold', CAP_SIZE) + 3;
    const beside = this.bodyWidth - capWidth;

    // Two lines beside the cap, wrapped to the narrowed measure.
    const head: string[] = [];
    let i = 0;
    for (let line = 0; line < 2 && i < words.length; line++) {
      let current = '';
      while (i < words.length) {
        const candidate = current ? `${current} ${words[i]}` : (words[i] as string);
        if (this.doc.widthOf(candidate, 'serif', size) > beside && current) break;
        current = candidate;
        i += 1;
      }
      head.push(current);
    }
    const tail = words.slice(i).join(' ');
    const rest = tail ? this.doc.wrap(tail, 'serif', size, this.bodyWidth) : [];

    this.ensure(CAP_SIZE + (head.length + rest.length) * leading);
    const first = this.y;
    this.page.text(cap, LEFT, first - leading / 2, { font: 'serifBold', size: CAP_SIZE, rgb: OZIKORO.green });
    let y = first;
    for (const line of head) {
      this.page.text(line, LEFT + capWidth, y, { font: 'serif', size, rgb: OZIKORO.ink });
      y -= leading;
    }
    for (const line of rest) {
      this.page.text(line, LEFT, y, { font: 'serif', size, rgb: OZIKORO.ink });
      y -= leading;
    }
    this.y = y - size * 0.55;
  }

  /**
   * A pull quote, and the conservative rule that decides whether one exists at all.
   *
   * The owner's brief allows a pull quote only where the article already carries a quotation. **So a quote
   * block is created only from a `<blockquote>` in the record's own body and its text goes in verbatim** —
   * see `toBlocks` in `apps/ozikoro/lib/publication.ts`, which is the only thing that produces one. There
   * is no path here that writes a quotation, shortens one to fit, or lifts a sentence out of a paragraph.
   */
  private drawQuote(text: string): void {
    const width = this.bodyWidth - 30;
    const lines = this.doc.wrap(text, 'serifItalic', 12.5, width);
    this.ensure(lines.length * 16 + 24);
    this.page.fill(OZIKORO.gold).fillRect(LEFT, this.y - lines.length * 16 - 2, 2.4, lines.length * 16 + 12);
    let cy = this.y;
    for (const line of lines) {
      this.page.text(line, LEFT + 14, cy, { font: 'serifItalic', size: 12.5, rgb: OZIKORO.green });
      cy -= 16;
    }
    this.y = cy - 12;
  }

  /**
   * The information box, drawn from a key/value list the article itself contains.
   *
   * **Nothing here is composed.** The labels and the values are the list items split at their own colon, and
   * the box carries no title, because a title would be a heading this renderer had to invent. It is the
   * reference's own box shape: a rounded wash panel with the labels in the green.
   */
  private drawInfobox(rows: { label: string; value: string }[]): void {
    const padX = 14;
    const padY = 11;
    const labelSize = 7.5;
    const valueSize = 9.5;
    const rowGap = 6;
    const labelW = Math.max(...rows.map((r) => this.doc.widthOf(r.label.toUpperCase(), 'sansBold', labelSize))) + 12;
    const valueW = this.bodyWidth - padX * 2 - labelW;
    const wrapped = rows.map((r) => this.doc.wrap(r.value, 'serif', valueSize, valueW));
    const contentH = wrapped.reduce((total, lines) => total + lines.length * (valueSize * 1.4) + rowGap, 0) - rowGap;
    const boxH = contentH + padY * 2;

    this.ensure(boxH + 18);

    const top = this.y;
    this.page.fill(OZIKORO.wash).roundedRect(LEFT, top - boxH, this.bodyWidth, boxH, 6).fillPath();
    this.page.fill(OZIKORO.green).fillRect(LEFT, top - boxH, 3, boxH);

    let cy = top - padY;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as { label: string; value: string };
      const lines = wrapped[i] as string[];
      this.page.text(row.label.toUpperCase(), LEFT + padX, cy, {
        font: 'sansBold', size: labelSize, rgb: OZIKORO.green,
      });
      for (const line of lines) {
        this.page.text(line, LEFT + padX + labelW, cy, { font: 'serif', size: valueSize, rgb: OZIKORO.ink });
        cy -= valueSize * 1.4;
      }
      cy -= rowGap;
    }
    this.y = top - boxH - 16;
  }

  /**
   * A figure, fitted to the measure and never wider than it.
   *
   * **The image and its caption move together or not at all.** Placing the image and then discovering the
   * caption does not fit puts them on different pages, which is the fault the brief names first. So the
   * whole block is measured before any of it is drawn.
   */
  private drawImage(block: Extract<Block, { kind: 'image' }>): void {
    const maxH = 330;
    const scale = Math.min(this.bodyWidth / block.width, maxH / block.height);
    const h = block.height * scale;
    const captionLines = block.caption ? this.doc.wrap(block.caption, 'sans', CAPTION, this.bodyWidth) : [];
    const creditLine = block.credit ? 1 : 0;
    const needed = h + 10 + captionLines.length * (CAPTION * 1.35) + creditLine * (CAPTION * 1.35) + 14;

    this.ensure(needed);

    const name = `img${this.pageIndex}-${Math.round(this.y)}`;
    this.doc.addImage(name, block.data);
    this.page.image(name, LEFT, this.y - h, this.bodyWidth, h, block);
    this.y -= h + 8;

    if (captionLines.length) {
      for (const line of captionLines) {
        this.page.text(line, LEFT, this.y, { font: 'sans', size: CAPTION, rgb: OZIKORO.inkMuted });
        this.y -= CAPTION * 1.35;
      }
    }
    if (block.credit) {
      this.page.text(block.credit, LEFT, this.y, { font: 'sans', size: CAPTION - 0.5, rgb: OZIKORO.green });
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
        if (i === 0) this.page.text('·', LEFT, this.y, { font: 'serif', size: BODY, rgb: OZIKORO.green });
        this.page.text(line, LEFT + 14, this.y, { font: 'serif', size: BODY, rgb: OZIKORO.ink });
        this.y -= LEADING;
      }
    }
    this.y -= BODY * 0.5;
  }

  /**
   * The editorial note, in the reference's own rounded wash panel, once and near the opening.
   *
   * The words are the template's, quoted from the approved reference. **It is placed after the article's
   * first paragraph** rather than floated to a corner, because a note about the publication belongs where a
   * reader starts rather than where one stops.
   */
  private drawEditorialNote(): void {
    const padX = 17.00787;
    const inner = this.bodyWidth - padX * 2;
    const lines = this.doc.wrap(EDITORIAL_BODY, 'sans', 8, inner);
    const boxH = 30 + lines.length * 11 + 16;
    this.ensure(boxH + 20);
    const top = this.y;
    this.page.fill(OZIKORO.wash).roundedRect(LEFT, top - boxH, this.bodyWidth, boxH, 6).fillPath();
    // The reference's note is set with a little air above the label and none below it, and the note itself
    // hangs from the label rather than being centred in the box.
    this.page.text(EDITORIAL_LABEL, LEFT + padX, top - 22.68, { font: 'sansBold', size: 6, rgb: OZIKORO.green });
    let cy = top - 42;
    for (const line of lines) {
      this.page.text(line, LEFT + padX, cy, { font: 'sans', size: 8, rgb: OZIKORO.inkMuted });
      cy -= 11;
    }
    this.y = top - boxH - 18;
  }

  /**
   * The references, in the reference's own treatment: a wash panel each, the number in gold, the entry in
   * the serif, and the page's own number in gold to mark the section.
   *
   * **No references means no page**, which is why this is called only when the record carries some.
   */
  private references(): void {
    if (this.input.references.length === 0) return;
    this.newPage('references');
    const p = this.page;
    p.text(REFERENCES_LABEL, LEFT, 754, { font: 'sansBold', size: 6, rgb: OZIKORO.ink });
    p.text('References', LEFT, 709.2992, { font: 'serifBold', size: 22, rgb: OZIKORO.gold });
    let y = 681.1811;
    for (const line of this.doc.wrap(REFERENCES_NOTE, 'sans', 10, this.bodyWidth)) {
      p.text(line, LEFT, y, { font: 'sans', size: 10, rgb: OZIKORO.ink });
      y -= 15;
    }
    this.y = y - 16;

    const padX = 14;
    const numberW = 28;
    for (let i = 0; i < this.input.references.length; i++) {
      const text = this.input.references[i] as string;
      const lines = this.doc.wrap(text, 'serif', 8.5, this.bodyWidth - padX * 2 - numberW);
      const boxH = lines.length * 11.5 + 24;
      this.ensure(boxH + 13);
      const top = this.y + 12;
      this.page.fill(OZIKORO.wash).roundedRect(LEFT, top - boxH, this.bodyWidth, boxH, 6).fillPath();
      let cy = top - 19;
      this.page.text(String(i + 1).padStart(2, '0'), LEFT + padX, cy - 1, {
        font: 'sansBold', size: 7, rgb: OZIKORO.gold,
      });
      for (const line of lines) {
        this.page.text(line, LEFT + padX + numberW, cy, { font: 'serif', size: 8.5, rgb: OZIKORO.ink });
        cy -= 11.5;
      }
      this.y = top - boxH - 13;
    }
  }

  /**
   * The author, in the reference's own dark green panel, and only when a biography exists.
   *
   * **A heading over nothing is not a section**, so an author with no biography gets no panel; and the
   * biography is the record's own words, wrapped, rather than a line this renderer made up about them.
   */
  private aboutAuthor(): void {
    if (!this.input.author || !this.input.authorBio) return;
    const padX = 20;
    const lines = this.doc.wrap(this.input.authorBio, 'serif', 8, this.bodyWidth - padX * 2);
    const boxH = 26 + lines.length * 11 + 22;
    /*
     * THE PANEL IS ANCHORED TO THE FOOT OF THE REFERENCES PAGE.
     *
     * The reference sets it near the bottom of the page its references are on, as an end-plate rather than
     * as a section that follows the last entry — **and it is placed there only when it fits clear of the
     * references above it.** Where it does not fit, or where the record has no references at all, it flows
     * after the body instead, because a panel written over the last reference is a worse fault than a panel
     * that is not pinned to the page's foot.
     */
    const anchorBottom = 104;
    const anchored = this.kinds[this.pageIndex] === 'references' && anchorBottom + boxH < this.y - 24;
    let top: number;
    if (anchored) {
      top = anchorBottom + boxH;
    } else {
      if (this.y - boxH - 20 < FRAME.bodyBottom) this.newPage('body');
      else this.y -= 16;
      top = this.y;
    }
    this.page.fill(OZIKORO.green).roundedRect(LEFT, top - boxH, this.bodyWidth, boxH, 6).fillPath();
    this.page.text(ABOUT_LABEL, LEFT + padX, top - 20, { font: 'sansBold', size: 6, rgb: OZIKORO.gold });
    this.page.text(this.input.author, LEFT + padX, top - 40, { font: 'serifBold', size: 12, rgb: OZIKORO.chalk });
    let cy = top - 58;
    for (const line of lines) {
      this.page.text(line, LEFT + padX, cy, { font: 'serif', size: 8, rgb: OZIKORO.dim });
      cy -= 11;
    }
    this.y = top - boxH - 18;
  }

  /** The back page: the ground, the stripe, the icon, the name, the slogan and the site. */
  private backPage(): void {
    this.newPage('back');
    const p = this.page;
    p.fill(OZIKORO.charcoal).fillRect(0, 0, A4.width, A4.height);
    p.fill(OZIKORO.green).fillRect(0, 0, 14.17323, A4.height);
    const icon = this.input.logo?.icon ?? null;
    /*
     * The reference draws this icon into a 62.36-point square, which stretches it by 1.89 vertically.
     * **Centred on that square's own centre and sized by width instead**, so the artwork is the shape the
     * brand's file says it is and the mark still carries the top of the page.
     */
    const iconW = 96;
    const iconCentre = 694.4882 + 62.3622 / 2;
    if (icon) {
      this.doc.addImage('ozikoro-icon-back', icon.data);
      const h = (icon.height / icon.width) * iconW;
      p.image('ozikoro-icon-back', LEFT, iconCentre - h / 2, iconW, h, icon);
    }
    p.text('Ozi Ikòrò', LEFT, 646.2992, { font: 'serifBold', size: 24, rgb: OZIKORO.gold });
    p.text(BACK_SLOGAN, LEFT, 583.937, { font: 'serifItalic', size: 18, rgb: OZIKORO.chalk });
    p.text(BACK_STRAPLINE, LEFT, 535.748, { font: 'sans', size: 6.5, rgb: OZIKORO.dim });
    p.rule(LEFT, 507.4016, 153.0709, OZIKORO.gold, 1);
    p.text(BACK_SITE, LEFT, 42.51969, { font: 'sans', size: 5.7, rgb: OZIKORO.dim });
  }

  render(): Buffer {
    this.cover();
    this.openingPage();

    /*
     * THE ARTICLE, FLOWING.
     *
     * **The sections are the shallowest heading level the record actually uses.** The reference numbers
     * `01`, `02`, `03` over an article whose headings are `<h3>`, so numbering only `<h2>` would leave the
     * owner's own article with no sections at all — and numbering *every* heading regardless of level would
     * give an `<h2>`/`<h3>` article two competing series. Neither is a guess: the level is read from the
     * record. **An article with no headings gets no sections**, which is the honest outcome.
     */
    const sectionLevel: 2 | 3 = this.input.blocks.some((b) => b.kind === 'heading' && b.level === 2) ? 2 : 3;
    let sections = 0;
    let seenProse = false;
    let notePlaced = false;
    const firstProse = this.input.blocks.find((b) => b.kind === 'paragraph');
    const opensWithProse = firstProse?.kind === 'paragraph' && firstProse.text.trim().length > 220;

    for (const block of this.input.blocks) {
      if (block.kind === 'heading') {
        if (block.level === sectionLevel) {
          sections += 1;
          this.drawSection(sections, block.text);
        } else {
          this.drawHeading(block.level, block.text);
        }
        continue;
      }
      if (block.kind === 'paragraph') {
        this.drawParagraph(block.text, { lead: opensWithProse && !seenProse });
        seenProse = true;
        // The editorial note follows the article's first paragraph, once, exactly as the reference has it.
        if (!notePlaced) { this.drawEditorialNote(); notePlaced = true; }
        continue;
      }
      /*
       * THE FEATURED IMAGE IS NOT PRINTED TWICE.
       *
       * An article's body very often opens with a `<figure>` holding the same photograph that is its
       * featured image, and the cover has already printed it. **The comparison is the bytes themselves**,
       * so an article that legitimately carries a *different* picture inline keeps every one of them; only
       * the cover's own picture is skipped, and only where the body repeats it. The rule lives here rather
       * than in the caller because the layout is the thing that knows what the cover carries.
       */
      if (block.kind === 'image' && this.input.featured && block.data.equals(this.input.featured.data)) continue;
      this.drawBodyBlock(block);
    }
    if (!notePlaced) this.drawEditorialNote();

    this.references();
    this.aboutAuthor();
    this.backPage();

    // The footers are written last because the page count is not known until the document is finished.
    for (let i = 1; i < this.doc.pages.length; i++) {
      const page = this.doc.pages[i];
      const kind = this.kinds[i] ?? 'body';
      if (!page) continue;
      // The references page carries its number in the gold, as the reference does, in both places.
      if (kind === 'references') this.number(page, i, 5.2, FRAME.headerBaseline, true);
      this.footer(page, i, kind);
    }
    return this.doc.build();
  }

  /**
   * The opening page: the reference's title block, then the article.
   *
   * **The standfirst is set only when it says something the body does not.** This archive's `standfirst` is
   * usually the article's opening sentences with an ellipsis, so printing it above the body would print the
   * same paragraph twice — which is why the reference's own standfirst is absent from its pages. Where a
   * record's standfirst is a genuinely separate summary it is set here in the italic, and **nothing is ever
   * truncated to make it fit the template.**
   */
  private openingPage(): void {
    this.newPage('opening');
    const p = this.page;
    p.text(this.shortTitle(), LEFT, 759.685, { font: 'sansBold', size: 6, rgb: OZIKORO.green });
    p.fill(OZIKORO.gold).fillRect(LEFT, 751.1811, 42.51969, 2.267717);

    /*
     * THE TITLE BLOCK, FLOWING DOWNWARD FROM THE REFERENCE'S OWN FIRST BASELINE.
     *
     * The reference's title block is written at an origin of 682.7279 with the first line raised 31.28
     * points above it, so its two baselines are **714.0 and 686.86**, its byline is 15.47 below the last of
     * them, its gold hairline 25.51 below that, and the article itself 36.85 below the hairline. **Those
     * gaps are the reference's, and they are chained rather than fixed** — a three-line title pushes the
     * byline down instead of being written over by it, which is what a fixed byline baseline does.
     */
    let y = 714;
    let lastTitle = y;
    for (const line of this.doc.wrap(this.input.title, 'serifBold', 23, this.bodyWidth)) {
      p.text(line, LEFT, y, { font: 'serifBold', size: 23, rgb: OZIKORO.ink });
      lastTitle = y;
      y -= 27.14;
    }
    const byline = [
      this.input.author ? `By ${this.input.author}` : null,
      this.input.category,
      'Ozikoro.com',
    ].filter(Boolean).join('  ·  ');
    const bylineY = lastTitle - 15.47;
    p.text(byline, LEFT, bylineY, { font: 'serifItalic', size: 9.2, rgb: OZIKORO.inkMuted });
    const ruleY = bylineY - 25.51;
    p.rule(LEFT, ruleY, FRAME.marginRight, OZIKORO.gold, 1);

    this.y = ruleY - 36.85;
    const standfirst = this.input.subtitle?.trim();
    if (standfirst && this.standfirstIsItsOwn(standfirst)) this.drawStandfirst(standfirst);
  }

  /**
   * Is this standfirst separate prose, or the article's first paragraph with the end cut off?
   *
   * The comparison strips a trailing ellipsis and compares the first eighty characters of each, because the
   * archive's standfirsts are teasers of the body rather than summaries of it. **This only ever suppresses
   * a duplicate; it never edits one.**
   */
  private standfirstIsItsOwn(subtitle: string): boolean {
    const first = this.input.blocks.find((b) => b.kind === 'paragraph');
    if (!first || first.kind !== 'paragraph') return true;
    const opening = first.text.trim().slice(0, 80);
    const teaser = subtitle.replace(/[\u2026.]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return !(teaser.length > 40 && opening.startsWith(teaser));
  }

  /** One content block that is not a heading or a paragraph. */
  private drawBodyBlock(block: Block): void {
    switch (block.kind) {
      case 'quote': this.drawQuote(block.text); break;
      case 'image': this.drawImage(block); break;
      case 'list': this.drawList(block.items); break;
      case 'infobox': this.drawInfobox(block.rows); break;
      default: break;
    }
  }
}

/** Cut a string to the longest word boundary that fits, for a head that must not run into the page number. */
function fit(doc: PdfDoc, text: string, font: FontKey, size: number, maxWidth: number, tracking = 0): string {
  if (doc.widthOf(text, font, size, tracking) <= maxWidth) return text;
  const words = text.split(/\s+/);
  while (words.length > 1) {
    words.pop();
    const candidate = words.join(' ');
    if (doc.widthOf(candidate, font, size, tracking) <= maxWidth) return candidate;
  }
  return words[0] ?? '';
}
