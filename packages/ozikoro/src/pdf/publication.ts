/**
 * THE OZIKORO PUBLICATION LAYOUT.
 *
 * THIS FILE DRAWS THE OWNER'S ACADEMIC-MAGAZINE TEMPLATE.
 *
 * The design is `ozikoro-academic-magazine.html` — the template the owner supplied and said was perfected —
 * and **every number below is a coordinate from that template or from the page it produces**, not a value
 * chosen here and not a value inherited from the earlier, lighter reference PDF this file used to match.
 * The two differ by exactly 5% per channel: the template's ground is `#302e2e` where the old one was
 * `#363434`, its green `#0f5142` where the old was `#174c3d`, its gold `#e7b82c` where the old was
 * `#ddb02f`. See the palette in `writer.ts`. The template is the design; the older PDF was a rendering of it.
 *
 * WHAT THE TEMPLATE IS
 *
 * A4 pages, a print document: a dark charcoal cover with a green spine, a cream sheet for the article, a
 * numbered section per heading, a green side card where the article's own list belongs, cream reference
 * cards, a green author panel and a dark back page. `page-break-after:always` in its own stylesheet, and
 * `@media print { width:210mm; height:297mm }`, which is A4 at 72 dpi to four decimals.
 *
 * THE RULES THAT SHAPED IT
 *
 * 1. **NOTHING IS INVENTED AND NOTHING IS REWRITTEN.** The renderer renders. A heading is the article's
 *    heading, a caption is the article's caption, a reference is a row the archive holds — and where the
 *    archive holds no standfirst, no biography or no featured image, **that part of the page is designed
 *    away rather than filled.** The only sentences this file writes are the template's own furniture —
 *    the strapline, the byline's separator words, the caption's provenance line, the back page's slogan —
 *    and each is quoted from the template's own markup.
 *
 * 2. **THE TEMPLATE'S INTERNAL NOTE IS NOT PUBLISHED.** The template carries a placeholder,
 *    `.template-note`: *"AUTOMATIC PUBLICATION TEMPLATE · ARTICLE IMAGES ARE INSERTED FROM THE CMS"*.
 *    That is a note to whoever operates the system, not to a reader, so **it is deliberately absent here**
 *    — as is the template's references intro, which says the same thing in a sentence and is likewise for
 *    the operator rather than the reader. The `references` page says instead where its entries came from,
 *    in words that are true of this renderer: they are the article's own source records.
 *
 * 3. **THE REFERENCES COME FROM THE DATABASE.** The template says so in its own HTML — *"In the production
 *    system, this section should be generated directly from the article's reference data"* — so
 *    `apps/ozikoro/lib/publication.ts` reads `ozikoro_article_source` joined to `ozikoro_source` and passes
 *    one string per row. `references` remains the fallback for a record whose bibliography exists only as
 *    prose, and **a citation is never invented to fill a page**.
 *
 * 4. **A SECTION NUMBER IS THE ARTICLE'S OWN ORDER.** The template numbers its sections `01`, `02`, `03`
 *    from the shallowest heading level the record actually uses. An article with no headings gets no
 *    numbered sections, which is the correct outcome rather than a gap to fill.
 *
 * 5. **AN IMAGE AND ITS CAPTION DO NOT SEPARATE**, and **a heading is never stranded at the foot of a page.**
 *
 * 6. **NO TEXT SITS UNDER THE PAGE NUMBER.** The last baseline on any page is above the footer rule.
 */
import {
  A4, OZIKORO, PdfDoc, PdfPage, type FontKey, type FontSet, type Rgb,
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

/** The official logo, as the artwork rather than as type. **Null is a real state and not an error.** */
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
  /**
   * True when `references` came from the archive's own `ozikoro_article_source` rows rather than from the
   * article's prose. **It changes one sentence on the references page and nothing else**, and it is here so
   * that sentence can be true rather than assumed: the two cases are not the same claim.
   */
  referencesFromSources?: boolean;
  tags: string[];
  logo?: ArticleLogo | null;
  /** TrueType faces by role. **Without them the writer falls back to the base-14 fonts.** */
  fonts?: FontSet | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// THE TEMPLATE'S OWN GEOMETRY
//
// The template lays its page out in CSS pixels at 72 dpi — `.page { width:min(595px, …) }` against the
// `@media print` rule that makes it 210mm — so **one template pixel is one point**, and a CSS value can be
// written here as the point it already is. The only conversion in this file is the one the template's own
// `min()` expresses: the sheet is A4's 595.2756 points rather than the round 595 its `min()` falls back to
// on a narrow screen, and the measure is `.article-inner`'s 54-pixel gutters measured from the real edges.
// ─────────────────────────────────────────────────────────────────────────────

/** The template's own page: `.page` is A4, and this is the sheet every coordinate below is measured on. */
const SHEET = { width: A4.width, height: A4.height };

/**
 * THE MEASURE, AND WHERE THE FURNITURE SITS ON IT.
 *
 * `.article-inner { padding:8px 54px 72px }` and `.page-header { margin:0 53px }` put the column's edges 53
 * points from the left of the sheet and 54 from the right; `.page-header { height:47px }` puts the head's
 * hairline 47 points below the top, and `footer { bottom:25px; padding-top:10px }` puts the foot's 36.85
 * above the bottom. **The template writes those in pixels and the sheet is 210 mm — 595.2756 points, not the
 * round 595 its `min()` falls back to on a narrow screen — so the pixel values are the design and the
 * approved page's own rendered coordinates are what a pixel becomes on the real sheet.** They are within
 * 0.2 of a point of each other, and the rendered ones are used here because they are measurements of the
 * template's own printed page rather than a conversion of it.
 */
const FRAME = {
  /** 19 mm — `.article-inner`'s left gutter, and the left edge of every column on every page. */
  left: 53.85827,
  /** 191 mm — the right edge of the measure. **A margin on the right, an edge here.** */
  right: 541.4173,
  /** `.mini-logo` at the header's own left edge, and the topic 58.86 points in — 53 + 35.86. */
  headerMiniLogoX: 59,
  headerTextX: 87.87402,
  /** The hairline under `.page-header`, and the baselines of the head and of the foot. */
  headerRuleY: 793.7008,
  headerBaseline: 813.5433,
  footerRuleY: 36.85039,
  footerBaseline: 25.51181,
  /** The first baseline an interior page may carry, and the last one: `.article-inner`'s own padding. */
  bodyTop: 759.685,
  bodyBottom: 60,
};

/** The width of the measure: `right - left`, and not a percentage of anything. */
const COLUMN = FRAME.right - FRAME.left;

/**
 * THE TYPE SCALE, AS THE TEMPLATE'S STYLESHEET SETS IT.
 *
 * Each comment names the rule it comes from. **None of these is a round number chosen to fit**, because the
 * template's are not: `.body p { font-size:13.5px; line-height:1.39 }` is 13.5 points and an 18.765-point
 * leading, and softening it to `14` and `19` is a different page that happens to use the same colours.
 */
const TYPE = {
  /** `.body p { font-size:13.5px; line-height:1.39; color:#393735 }`. */
  body: 13.5,
  bodyLeading: 13.5 * 1.39,
  /** `.body p { margin:0 0 18px }`. */
  bodyGap: 18,
  /** `.body h2 { font-size:26px; line-height:1.06; letter-spacing:-.35px }`, and `h3` needs its own step. */
  heading: 26,
  subheading: 17,
  /** `.section-no { font:700 8px Arial; letter-spacing:.6px; border-bottom:3px solid var(--gold) }`. */
  sectionNo: 8,
  sectionRule: 3,
  sectionRuleWidth: 22,
  /** `.references-page .body h2 { font-size:31px }` and `.reference { font-size:10px; line-height:1.35 }`. */
  referencesTitle: 31,
  reference: 10,
  referenceLeading: 13.5,
  /** `.reference b { font:700 9px Arial }`. */
  referenceNumber: 9,
  /** `.page-header { font:7px Arial }` — and the template's own 8px for the eyebrow. */
  head: 7,
  eyebrow: 8,
  /** `.cover h1 { font-size:40px; line-height:1.02; letter-spacing:-.8px }`. */
  coverTitle: 40,
  coverTitleLeading: 40 * 1.02,
  /** `.cover-subtitle { font-size:25px; line-height:1.12 }`. */
  coverSubtitle: 25,
  coverSubtitleLeading: 25 * 1.12,
  /** `.brand { font-size:27px }`. */
  brand: 27,
  /** `.strap { font:700 7px/1.5 Arial; letter-spacing:.75px }`. */
  strap: 7,
  strapLeading: 10.5,
  /** `.byline { font-size:12px }`, `.meta { font:8px/1.4 Arial }`. */
  byline: 12,
  meta: 8,
  /** `.side-card p { font:10px/1.42 Arial }`, `.side-card b { font:700 9px/1.3 Arial }`. */
  sideBody: 10,
  sideBodyLeading: 14.2,
  sideLabel: 9,
  /** `.reference`, `.author-card strong { font-size:17px }`, `.author-card span { font:9px Arial }`. */
  authorName: 17,
  authorBody: 9,
  /** `.end .brand { font-size:27px }`, `.end-tagline { font-size:25px }`, `.end .strap { font-size:7px }`. */
  endBrand: 27,
  endTagline: 25,
};

/**
 * THE TEMPLATE'S OWN WORDS, QUOTED FROM ITS MARKUP AND FROM NOWHERE ELSE.
 *
 * Each of these is furniture rather than article content: they describe the publication and never the
 * subject. **Anything not in this list is the article's own text or is not on the page.** The template's
 * `.template-note` and its references intro are deliberately not here — see rule 2 in the header.
 */
const STRAPLINE = 'AFRICAN HISTORY  ·  CULTURE  ·  INDIGENOUS KNOWLEDGE';
/**
 * THE COVER'S OWN BREATHING SPACE UNDER THE GOLD RULE, MEASURED FROM THE APPROVED PAGE.
 *
 * The template's `.gold-line { margin-top:26px }` sits below the meta line, and `.feature
 * { margin-top:148px }` sits below *that* — but `margin-top` applies to the gold rule's own line box,
 * not to the meta line's baseline. Measured on the approved page, its gold rule is 42.52 points below
 * the meta line's baseline, so that is what is reserved here. **Without it the meta line lands inside
 * the feature panel**, which is what a render of the first version of this file showed.
 */
const COVER_TAIL_GAP = 42.52;
const TOPIC_FALLBACK = 'African history';
const FEATURE_LABEL = 'FEATURE IMAGE';
const FEATURE_PROVENANCE = 'Article image · caption retained from the published Ozikoro article';
const FEATURE_EMPTY = 'No featured image in the record';
const FEATURE_EMPTY_NOTE = 'The article carries no featured image, so this panel is left as an honest empty space rather than filled with one.';
const REFERENCES_LABEL = 'SOURCES';
const REFERENCES_NOTE = 'Every entry below is an article source record held in the Ozikoro archive, reproduced as it is stored.';
const REFERENCES_INTRO = 'Works, records and other material the article cites, drawn from its own source list.';
const REFERENCES_FALLBACK_NOTE = 'The article’s own bibliography, set as it appears in the record.';
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
      /**
       * EVERY IMAGE THE DOCUMENT CARRIES, BY NAME — **so "the figures came through" is a count and not a
       * claim.**
       *
       * This exists because of a fault measured on the live site rather than imagined: the production
       * container had no media on its filesystem (`.dockerignore` excludes `data/media`, the image copies
       * no `.data`, and the service mounts no volume), so `imageOf` found nothing and
       * `https://ozikoro.com/animal-totems-…/pdf` served **18 pages with 2 image objects** where the same
       * record renders **33 pages with 26** from this checkout. The document was valid, the layout was right,
       * and twenty-four of its twenty-five photographs were simply absent — the one failure that looks like
       * success, and the reason the publication cache refuses to store a render that is missing figures.
       *
       * **That fault is fixed** — `apps/ozikoro/lib/publication.ts` reads the bytes through `getStorage()`
       * now, so a figure is found in the bucket — and this count is what still catches one that is not
       * (a WebP on a host with no `sips` is the measured case). The guard is unchanged: missing figures are
       * never cached.
       *
       * The names are the writer's own keys, so a caller can separate the brand mark (`ozikoro-icon-…`)
       * from the record's figures without a second rule about what a figure is.
       */
      images: [...this.doc.images.keys()],
    };
  }

  private get bodyWidth() { return COLUMN; }

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
   * The running head: `.page-header`, at the template's own coordinates.
   *
   * `.page-header { height:47px; margin:0 53px; border-bottom:1px solid #ddd9d0; display:flex;
   * justify-content:space-between }` — the mini logo and the topic on the left, the site and the page
   * number on the right, on the paper ground with a hairline under it.
   *
   * The words are the template's rule and the approved pages' own behaviour: **the opening page carries
   * the article's topic, every page after it the article's short title, and the references page says
   * `REFERENCES`.** The number is the page's own number, and the cover is page one.
   */
  private runningHead(page: PdfPage, index: number, kind: PageKind): void {
    if (index === 0 || kind === 'back') return;
    page.fill(OZIKORO.paper).fillRect(0, FRAME.headerRuleY, SHEET.width, SHEET.height - FRAME.headerRuleY);

    const icon = this.input.logo?.icon ?? null;
    if (icon) {
      this.doc.addImage('ozikoro-icon-head', icon.data);
      // `.mini-logo img { width:31px; height:17px; object-fit:contain }` — the box is the template's, and
      // the writer centres the artwork inside it at its own aspect ratio rather than squaring it off.
      page.image('ozikoro-icon-head', FRAME.headerMiniLogoX, FRAME.headerBaseline - 2.5, 31, 17, icon);
    }

    const label = kind === 'references' ? 'REFERENCES' : index <= 1 ? this.topic() : this.shortTitle();
    const available = FRAME.right - FRAME.headerTextX - this.doc.widthOf('OZIKORO.COM  ·  00', 'sans', TYPE.head) - 24;
    page.text(fit(this.doc, label, 'sansBold', TYPE.head, available), FRAME.headerTextX, FRAME.headerBaseline, {
      font: 'sansBold', size: TYPE.head, rgb: OZIKORO.headInk,
    });
    this.number(page, index, TYPE.head, FRAME.headerBaseline);
    page.rule(FRAME.left, FRAME.headerRuleY, FRAME.right, OZIKORO.rule, 0.6);
  }

  /** `OZIKORO.COM · NN`, right-aligned on the measure, in the site's own `.page-header` colour. */
  private number(page: PdfPage, index: number, size: number, baseline: number, gold = false): void {
    page.text(`OZIKORO.COM  ·  ${String(index + 1).padStart(2, '0')}`, FRAME.right, baseline, {
      font: 'sans', size, rgb: gold ? OZIKORO.gold : OZIKORO.headInk, align: 'right', maxWidth: 0,
    });
  }

  /** `footer`, at the template's own coordinates: the rule, the words left, the page number right. */
  private footer(page: PdfPage, index: number, kind: PageKind): void {
    if (index === 0 || kind === 'back') return;
    page.rule(FRAME.left, FRAME.footerRuleY, FRAME.right, OZIKORO.rule, 0.6);
    page.text(FOOTER_TEXT, FRAME.left, FRAME.footerBaseline, { font: 'sans', size: 6.5, rgb: OZIKORO.footInk });
    page.text(String(index + 1).padStart(2, '0'), FRAME.right, FRAME.footerBaseline, {
      font: 'sans', size: 6.5, rgb: OZIKORO.footInk, align: 'right', maxWidth: 0,
    });
  }

  /** The article's topic, as the running head's first word. **Null means the template's own fallback.** */
  private topic(): string {
    return (this.input.category ?? TOPIC_FALLBACK).toUpperCase();
  }

  /**
   * The article's short title: what the title says before its colon.
   *
   * The template's running head reads `UTE-OKPU` for a title of `Ute-Okpu: An Ika-Igbo Clan and Its Nri
   * Roots`, and its cover splits the same title at the same colon. **A title that cannot be shortened and
   * still fit falls back to the topic**, which is furniture and therefore never wrong.
   */
  private shortTitle(): string {
    const beforeColon = this.input.title.split(':')[0] ?? this.input.title;
    const upper = (beforeColon || this.input.title).toUpperCase().trim();
    const room = FRAME.right - FRAME.headerTextX - this.doc.widthOf('OZIKORO.COM  ·  00', 'sans', TYPE.head) - 24;
    if (this.doc.widthOf(upper, 'sansBold', TYPE.head) <= room) return upper;
    const words = upper.split(/\s+/);
    while (words.length > 1) {
      words.pop();
      const candidate = words.join(' ');
      if (this.doc.widthOf(candidate, 'sansBold', TYPE.head) <= room) return candidate;
    }
    return this.topic();
  }

  /** Move to a new page if `needed` points will not fit. **This is what keeps headings off page feet.** */
  private ensure(needed: number): void {
    if (this.y - needed < FRAME.bodyBottom) this.newPage('body');
  }

  // ── COVER ──────────────────────────────────────────────────────────────────

  /**
   * The cover: `.page.cover`, at the template's own coordinates.
   *
   * `.cover { background:var(--ink); color:#fff }`, `.cover::before { width:13px; background:var(--green) }`
   * — a 13-point green spine down the full height of a charcoal sheet. Then the lockup
   * (`.cover-logo { width:62px }`, `.brand { font-size:27px; color:var(--gold) }`, `.strap`), the gold
   * `.cover-rule`, the `.eyebrow`, the title split at its colon (`.cover h1` / `.cover-subtitle`), the
   * byline, the meta line, the `.gold-line`, and the feature panel.
   *
   * **The template's `.template-note` is not drawn.** It is a note to the operator, not to a reader.
   */
  private cover(): void {
    const p = this.page;
    const title = this.input.title;
    const colon = title.indexOf(':');
    const display = colon > 0 ? title.slice(0, colon + 1) : title;
    const continuation = colon > 0 ? title.slice(colon + 1).trim() : '';

    p.fill(OZIKORO.ink).fillRect(0, 0, SHEET.width, SHEET.height);
    p.fill(OZIKORO.green).fillRect(0, 0, 13, SHEET.height);

    // `.cover-inner { padding:76px 54px 50px }` — the content's left edge is the measure's.
    const LEFT = FRAME.left;

    // `.cover-logo { width:62px }`, top at the inner padding's 76 points from the top of the sheet.
    const icon = this.input.logo?.icon ?? null;
    const logoW = 62;
    let cursorTop = SHEET.height - 76;
    if (icon) {
      const h = (icon.height / icon.width) * logoW;
      this.doc.addImage('ozikoro-icon-cover', icon.data);
      p.image('ozikoro-icon-cover', LEFT, cursorTop - h, logoW, h, icon);
      cursorTop -= h + 18; // `.cover-logo { margin-bottom:18px }`
    }
    // `.brand { font-size:27px; color:var(--gold); line-height:normal }` — the baseline sits inside the
    // line box, so the box's own `0.8 × size` descent is what the next block measures from.
    const brandBaseline = cursorTop - TYPE.brand * 0.8;
    p.text('Ozi Ikòrò', LEFT, brandBaseline, { font: 'serifBold', size: TYPE.brand, rgb: OZIKORO.gold });
    const strapBaseline = brandBaseline - TYPE.brand * 1.0 - TYPE.strap;
    p.text(STRAPLINE, LEFT, strapBaseline, { font: 'sansBold', size: TYPE.strap, rgb: OZIKORO.strap });

    // `.cover-rule { height:1px; background:var(--gold); opacity:.8; margin:25px 0 42px }`. The template's
    // 0.8 opacity over the charcoal is the gold it renders as, and a stroked rule reproduces the weight.
    const ruleY = brandBaseline - TYPE.brand - 25;
    p.rule(LEFT, ruleY, FRAME.right, OZIKORO.gold, 1);

    const eyebrowBaseline = ruleY - 42 + TYPE.eyebrow * 0.8;
    p.text(this.topic(), LEFT, eyebrowBaseline, { font: 'sansBold', size: TYPE.eyebrow, rgb: OZIKORO.gold });

    /*
     * `.cover h1 { font-size:40px; line-height:1.02; letter-spacing:-.8px }`, with `.cover-subtitle` at 25
     * points italic under it. **The block is measured before it is drawn** so that a title of four lines
     * spends the empty charcoal above it rather than walking the byline into the feature panel: the cover's
     * content can never grow downward, because `.feature { margin-top:148px }` puts the panel at a fixed
     * foot and a long title would otherwise be written over by it.
     */
    /*
     * THE BLOCK ABOVE THE PANEL IS LAID OUT FROM ITS FOOT UPWARD, BECAUSE THE PANEL'S TOP IS FIXED.
     *
     * `.feature { margin-top:148px }` puts the panel where it is, so an article with a four-line title
     * cannot grow downward — it would be written over by the panel. The reserve is therefore measured
     * first, from the panel's top back to the title's last baseline through the template's own gaps:
     *
     *     gold-line → meta 23.30   meta → byline 19.85   byline → title 42.52   (`.byline{margin-top:34px}`
     *                                                                            and `.cover-subtitle{margin-top:12px}`)
     *
     * and whatever is left over is the title's own band. **A short title sits at the template's own
     * first baseline and does not float down to the panel**, which is the fault the earlier version had:
     * its `Math.min` clamp raised a tall block but lowered a short one, and the commonest case moved.
     */
    const panelTop = this.featurePanelTop();
    /*
     * The reserve, from the panel's top back up to the title's foot, through the template's own gaps —
     * each named where it comes from, because the earlier version of this summed a fudge factor and put the
     * meta line INSIDE the feature panel:
     *
     *     `.gold-line { margin-top:26px }`   26   `.meta { margin-top:11px }`   11
     *     one 8-point meta line              8   `.byline { margin-top:34px }`  34
     *     `.cover-subtitle { margin-top:12px }` (a title with a colon has this line and its 28-point lead)
     */
    const titleFoot = panelTop + COVER_TAIL_GAP + 26 + TYPE.meta + 11
      + (continuation ? 34 + TYPE.coverSubtitleLeading + 12 : 34);
    const titleCeiling = eyebrowBaseline + TYPE.eyebrow * 0.2 - 35;
    const band = titleFoot - titleCeiling;

    let size = TYPE.coverTitle;
    let lines: string[] = [];
    for (; size >= 20; size -= 1) {
      lines = this.doc.wrap(display, 'serifBold', size, COLUMN);
      if (lines.length * size * 1.02 <= band) break;
    }
    // Bottom-aligned inside its band, and never lower than the template's own first baseline.
    const blockHeight = lines.length * size * 1.02;
    let y = Math.min(titleFoot, titleCeiling + blockHeight);
    let lastBaseline = y;
    for (const line of lines) {
      p.text(line, LEFT, y, { font: 'serifBold', size, rgb: OZIKORO.white });
      lastBaseline = y;
      y -= size * 1.02;
    }

    /*
     * `.cover-subtitle { margin-top:12px; font-size:25px; line-height:1.12; font-style:italic }`, then
     * `.byline { margin-top:34px }`, then `.meta { margin-top:11px; font:8px/1.4 Arial }`, then
     * `.gold-line { margin-top:26px }`.
     *
     * **The gaps are the template's and they are chained**, each from the line above it, so a two-line
     * subtitle carries the byline and the meta line down with it instead of being written over by them. A
     * title with no colon has no italic line at all, and the byline's own gap is then measured from the
     * title's last baseline.
     */
    let blockBottom = lastBaseline;
    if (continuation) {
      y = lastBaseline - 12 - TYPE.coverSubtitle * 0.8;
      for (const line of this.doc.wrap(continuation, 'serifItalic', TYPE.coverSubtitle, COLUMN)) {
        p.text(line, LEFT, y, { font: 'serifItalic', size: TYPE.coverSubtitle, rgb: OZIKORO.subtitle });
        blockBottom = y;
        y -= TYPE.coverSubtitleLeading;
      }
      y = blockBottom - 34 - TYPE.byline * 0.8;
    } else {
      y = blockBottom - 34 - 12 - TYPE.byline * 0.8;
    }
    if (this.input.author) {
      p.text(`By ${this.input.author}`, LEFT, y, { font: 'serif', size: TYPE.byline, rgb: OZIKORO.white });
    }
    // `.meta { margin-top:11px; font:8px/1.4 Arial; color:#aaa69e }`
    y -= 11 + TYPE.meta * 0.8;
    p.text(this.metaLine(), LEFT, y, { font: 'sans', size: TYPE.meta, rgb: OZIKORO.faint });
    // `.gold-line { width:86px; height:4px; margin-top:26px }`
    y -= 26 + 4;
    p.fill(OZIKORO.gold).fillRect(LEFT, y, 86, 4);

    this.featurePanel(panelTop);
  }

  /** `Ozikoro.com · Topic · N min read`, with the template's `·` separator and nothing invented. */
  private metaLine(): string {
    return [
      'Ozikoro.com',
      this.input.category,
      this.input.readingMinutes ? `${this.input.readingMinutes} min read` : null,
    ].filter(Boolean).join(' · ');
  }

  /**
   * WHERE THE FEATURE PANEL SITS, WHICH IS A FIXED FOOT AND A FIXED HEIGHT, AS THE TEMPLATE HAS IT.
   *
   * `.feature { display:grid; grid-template-columns:125px 1fr; margin-top:148px; min-height:125px }`, and
   * the template's own cover renders it 148 pixels tall from the inner padding's 50-pixel foot. **Measured
   * the same way, the approved page's panel runs from y 141.1 to y 345.2** — the charcoal above it is 340
   * points deep, which is the empty space the owner's cover is built around.
   *
   * So the panel's height is the template's 148 and not its content's. **That is what keeps the title at the
   * template's own 40-point display size**: a panel that grew with its caption pushed the byline, the meta
   * line and the title up until the title had to shrink to fit, and a cover whose headline is 26 points is
   * not the cover the owner approved. A caption too long for the fixed panel is a smaller fault than a
   * shrunken title, and the picture inside the panel is placed only when it genuinely fits.
   */
  private featurePanelTop(): number {
    return 50 + 148;
  }

  /** Where the copy zone inside the panel ends and the picture's own area begins. */
  private get copyFloor(): number {
    return 50 + 16;
  }

  /**
   * THE FEATURE PANEL: `.feature { grid-template-columns:125px 1fr }`.
   *
   * `.feature-label { background:var(--green); padding:24px 18px; font:700 7px/1.6 Arial }` on the left and
   * `.feature-copy { background:#e4dac5; color:#2c2a28; padding:32px 26px }` on the right, with the
   * article's own caption in `.feature-copy strong` and the template's provenance line in
   * `.feature-copy small`.
   *
   * **It degrades honestly.** With a caption the panel carries the caption and the provenance line; with a
   * figure the figure is drawn inside it as well; with neither, the panel says so in the same position and
   * at the same size. **It never borrows a stock image and never writes a caption** — the template's
   * caption is a real one from a real article, and an article without one gets a panel whose copy half
   * carries the honest absence instead.
   */
  private featurePanel(top: number): void {
    const p = this.page;
    const bottom = 50;
    const height = top - bottom;
    const labelWidth = 125;
    const copyX = FRAME.left + labelWidth;
    const copyW = COLUMN - labelWidth;
    const padX = 26;
    const textX = copyX + padX;
    const captionWidth = copyW - padX * 2;
    const featured = this.input.featured;
    const caption = featured?.caption ?? null;

    p.fill(OZIKORO.featureCopy).fillRect(FRAME.left, bottom, COLUMN, height);
    p.fill(OZIKORO.green).fillRect(FRAME.left, bottom, labelWidth, height);

    // `.feature-label { padding:24px 18px }` — two words, each on its own line, at 7 points with a 1.6 lead.
    let labelY = top - 24 - 7 * 0.8;
    for (const word of FEATURE_LABEL.split(' ')) {
      p.text(word, FRAME.left + 18, labelY, { font: 'sansBold', size: 7, rgb: OZIKORO.white });
      labelY -= 7 * 1.6;
    }

    /*
     * `.feature-copy { padding:32px 26px }`, `.feature-copy strong { font-size:15px; line-height:1.35 }` and
     * `.feature-copy small { margin-top:22px; font:8px/1.4 Arial }`. **The caption is the article's own and
     * is not shortened to fit** — it wraps to the copy column, and the approved page's own caption takes
     * exactly two lines there, which is the case this panel is sized for.
     */
    let captionY = top - 32 - 15 * 0.8;
    if (caption) {
      for (const line of this.doc.wrap(caption, 'serifBold', 15, captionWidth)) {
        p.text(line, textX, captionY, { font: 'serifBold', size: 15, rgb: OZIKORO.featureInk });
        captionY -= 15 * 1.35;
      }
      captionY -= 22 - 15 * 1.35;
      p.text(FEATURE_PROVENANCE, textX, captionY, { font: 'sans', size: 8, rgb: OZIKORO.featureFaint });
    } else {
      p.text(FEATURE_EMPTY.toUpperCase(), textX, captionY, { font: 'sansBold', size: 8, rgb: OZIKORO.featureInk });
      captionY -= 22;
      for (const line of this.doc.wrap(FEATURE_EMPTY_NOTE, 'sans', 8, captionWidth)) {
        p.text(line, textX, captionY, { font: 'sans', size: 8, rgb: OZIKORO.featureFaint });
        captionY -= 8 * 1.4;
      }
    }

    /*
     * The picture, inside the copy half under its own words, at its own aspect ratio.
     *
     * **It takes the room the panel's own fixed height has left, and it is fitted to that box rather than
     * cropped or stretched** — `PdfPage.image` scales by the smaller of the two ratios. Where the caption
     * and the provenance line have used the panel, there is no room and **no picture is placed**; the space
     * stays the panel's own cream, which is a smaller fault than a squeezed image or a grey rectangle that
     * reads as a broken one. **Nothing is ever borrowed to fill it.**
     */
    if (featured && caption) {
      const room = captionY - 16 - (bottom + 16);
      if (room > 30) {
        this.doc.addImage('featured', featured.data);
        p.image('featured', textX, bottom + 16, captionWidth, room, featured);
      }
    }
  }

  // ── BODY ───────────────────────────────────────────────────────────────────

  /**
   * THE BRAND MARK AND THE SECTION LABEL, which the template's `.section-no` expresses as one slot.
   *
   * `.section-no { color:var(--green); font:700 8px Arial; letter-spacing:.6px; border-bottom:3px solid
   * var(--gold); width:max-content; padding-bottom:5px }` — and on the approved pages the slot above that
   * rule carries **the wordmark `Ozi Ikòrò` on the page the article opens on, and the section's own number
   * on every page after it.** That is exactly what the template draws: the opening page has no section
   * number because the article has not been divided into sections yet, and its label slot carries the brand
   * instead. Neither is a guess: the artifact and the template agree.
   */
  private drawLabel(text: string): void {
    this.ensure(TYPE.heading * 1.06 + TYPE.bodyLeading * 3 + 46);
    const top = this.y;
    this.page.text(text, FRAME.left, top, { font: 'sansBold', size: TYPE.sectionNo, rgb: OZIKORO.green, tracking: 0.6 });
    this.page.fill(OZIKORO.gold).fillRect(FRAME.left, top - 5 - TYPE.sectionRule, TYPE.sectionRuleWidth, TYPE.sectionRule);
    this.y = top - 5 - TYPE.sectionRule - 34;
  }

  private drawHeading(level: 2 | 3, text: string): void {
    const size = level === 2 ? TYPE.heading : TYPE.subheading;
    const lines = this.doc.wrap(text, 'serifBold', size, COLUMN);
    // **A heading needs its own height plus three lines of text beneath it**, or it is stranded.
    this.ensure(lines.length * size * 1.06 + TYPE.bodyLeading * 3);
    this.y -= level === 2 ? 19 : 14;
    for (const line of lines) {
      this.page.text(line, FRAME.left, this.y, { font: 'serifBold', size, rgb: OZIKORO.ink });
      this.y -= size * 1.06;
    }
    this.y -= level === 2 ? 11 : 8;
  }

  /**
   * A numbered section: the template's `.section-no` numeral, its gold rule, and the heading.
   *
   * **The number is the article's own order and nothing else is added to it** — no invented heading, no
   * "Introduction" over a paragraph the article never titled.
   */
  private drawSection(number: number, text: string): void {
    this.drawLabel(String(number).padStart(2, '0'));
    this.drawHeading(2, text);
  }

  /**
   * The article's standfirst, set under the title on the opening page.
   *
   * The template's own standfirst is its `.cover-subtitle`, which the cover already carries. A record's
   * `standfirst` is prose the article holds, and **a record's own words are never dropped to match a
   * template** — so it is set here, once, in the article's own sentence order, and only when it says
   * something the body does not already say.
   */
  private drawStandfirst(text: string): void {
    const lines = this.doc.wrap(text, 'serifItalic', 12.5, COLUMN);
    this.ensure(lines.length * 16 + 18);
    this.y -= 4;
    for (const line of lines) {
      this.ensure(16);
      this.page.text(line, FRAME.left, this.y, { font: 'serifItalic', size: 12.5, rgb: OZIKORO.muted });
      this.y -= 16;
    }
    this.y -= 10;
  }

  private drawParagraph(text: string, opts: { lead?: boolean } = {}): void {
    const size = TYPE.body;
    const leading = TYPE.bodyLeading;
    if (opts.lead) {
      this.drawLeadParagraph(text, size, leading);
      return;
    }
    const lines = this.doc.wrap(text, 'serif', size, COLUMN);
    for (const line of lines) {
      this.ensure(leading);
      this.page.text(line, FRAME.left, this.y, { font: 'serif', size, rgb: OZIKORO.bodyInk });
      this.y -= leading;
    }
    this.y -= TYPE.bodyGap - leading + leading; // `.body p { margin-bottom:18px }`
  }

  /**
   * THE DROP CAP, AND THE MEASURE IT HAS TO RESPECT.
   *
   * **The initial spans two lines, and exactly those two lines are shortened.** The cap sits
   * `leading / 2` under the first baseline, so its foot lands just above the second line and no hole is
   * left beneath it — the fault an earlier version had, where the two halves read as two separate lines
   * with the first letter floating between them.
   */
  private drawLeadParagraph(text: string, size: number, leading: number): void {
    const cap = text.slice(0, 1);
    const words = text.slice(1).split(/\s+/).filter(Boolean);
    const capSize = size * 2.9;
    const capWidth = this.doc.widthOf(cap, 'serifBold', capSize) + 3;
    const beside = COLUMN - capWidth;

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
    const rest = tail ? this.doc.wrap(tail, 'serif', size, COLUMN) : [];

    this.ensure(capSize + (head.length + rest.length) * leading);
    const first = this.y;
    this.page.text(cap, FRAME.left, first - leading / 2, { font: 'serifBold', size: capSize, rgb: OZIKORO.green });
    let y = first;
    for (const line of head) {
      this.page.text(line, FRAME.left + capWidth, y, { font: 'serif', size, rgb: OZIKORO.bodyInk });
      y -= leading;
    }
    for (const line of rest) {
      this.page.text(line, FRAME.left, y, { font: 'serif', size, rgb: OZIKORO.bodyInk });
      y -= leading;
    }
    this.y = y - TYPE.bodyGap;
  }

  /**
   * A pull quote, and the conservative rule that decides whether one exists at all.
   *
   * **A quote block is created only from a `<blockquote>` in the record's own body and its text goes in
   * verbatim** — see `toBlocks` in `apps/ozikoro/lib/publication.ts`, which is the only thing that produces
   * one. There is no path here that writes a quotation, shortens one to fit, or lifts a sentence out of a
   * paragraph. It is drawn in the template's own green and gold rather than in a panel the template does
   * not have.
   */
  private drawQuote(text: string): void {
    const width = COLUMN - 30;
    const lines = this.doc.wrap(text, 'serifItalic', 12.5, width);
    this.ensure(lines.length * 16 + 24);
    this.page.fill(OZIKORO.gold).fillRect(FRAME.left, this.y - lines.length * 16 - 2, 2.4, lines.length * 16 + 12);
    let cy = this.y;
    for (const line of lines) {
      this.page.text(line, FRAME.left + 14, cy, { font: 'serifItalic', size: 12.5, rgb: OZIKORO.green });
      cy -= 16;
    }
    this.y = cy - 12;
  }

  /**
   * THE SIDE CARD: `.body.with-side { padding-right:174px }` and `.with-side .side-card { right:-1px;
   * top:53px; width:126px }` — `.side-card { background:var(--green); color:#fff; border-radius:7px;
   * padding:19px 16px }`, its label in the gold, its facts in Arial.
   *
   * **Nothing here is composed.** The card's label and its facts are the article's own list items, and a
   * record with no such list gets no card — which is the correct outcome rather than a gap to fill.
   */
  private drawSideCard(title: string, rows: string[]): void {
    const width = 126;
    const x = FRAME.right - width + 1;
    const padX = 16;
    const padY = 19;
    const inner = width - padX * 2;
    const labelLines = this.doc.wrap(title.toUpperCase(), 'sansBold', TYPE.sideLabel, inner);
    const rowLines = rows.map((row) => this.doc.wrap(row, 'sans', TYPE.sideBody, inner));
    const content = labelLines.length * TYPE.sideLabel * 1.3 + 15
      + rowLines.reduce((total, lines) => total + lines.length * TYPE.sideBodyLeading, 0);
    const height = content + padY * 2;
    this.ensure(height + TYPE.bodyLeading * 3);

    const top = this.y;
    this.page.fill(OZIKORO.green).roundedRect(x, top - height, width, height, 7).fillPath();
    let cy = top - padY - TYPE.sideLabel * 0.8;
    for (const line of labelLines) {
      this.page.text(line, x + padX, cy, { font: 'sansBold', size: TYPE.sideLabel, rgb: OZIKORO.gold });
      cy -= TYPE.sideLabel * 1.3;
    }
    cy -= 15 - TYPE.sideLabel * 1.3;
    for (const lines of rowLines) {
      cy -= TYPE.sideBody * 0.8;
      for (const line of lines) {
        this.page.text(line, x + padX, cy, { font: 'sans', size: TYPE.sideBody, rgb: OZIKORO.white });
        cy -= TYPE.sideBodyLeading;
      }
    }
  }

  /**
   * The information box, drawn from a key/value list the article itself contains.
   *
   * **Nothing here is composed.** The labels and the values are the list items split at their own colon,
   * and the box carries no title, because a title would be a heading this renderer had to invent. It is
   * the template's cream wash with the labels in the green.
   */
  private drawInfobox(rows: { label: string; value: string }[]): void {
    const padX = 14;
    const padY = 11;
    const labelSize = 8;
    const valueSize = 10.5;
    const rowGap = 6;
    const labelW = Math.max(...rows.map((r) => this.doc.widthOf(r.label.toUpperCase(), 'sansBold', labelSize))) + 12;
    const valueW = COLUMN - padX * 2 - labelW;
    const wrapped = rows.map((r) => this.doc.wrap(r.value, 'serif', valueSize, valueW));
    const contentH = wrapped.reduce((total, lines) => total + lines.length * (valueSize * 1.4) + rowGap, 0) - rowGap;
    const boxH = contentH + padY * 2;

    this.ensure(boxH + 18);

    const top = this.y;
    this.page.fill(OZIKORO.cream).roundedRect(FRAME.left, top - boxH, COLUMN, boxH, 7).fillPath();
    this.page.fill(OZIKORO.green).fillRect(FRAME.left, top - boxH, 3, boxH);

    let cy = top - padY - valueSize * 0.8;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as { label: string; value: string };
      const lines = wrapped[i] as string[];
      this.page.text(row.label.toUpperCase(), FRAME.left + padX, cy, { font: 'sansBold', size: labelSize, rgb: OZIKORO.green });
      for (const line of lines) {
        this.page.text(line, FRAME.left + padX + labelW, cy, { font: 'serif', size: valueSize, rgb: OZIKORO.ink });
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
    const scale = Math.min(COLUMN / block.width, maxH / block.height);
    const h = block.height * scale;
    const captionLines = block.caption ? this.doc.wrap(block.caption, 'sans', 8.5, COLUMN) : [];
    const creditLine = block.credit ? 1 : 0;
    const needed = h + 10 + captionLines.length * (8.5 * 1.35) + creditLine * (8.5 * 1.35) + 14;
    this.ensure(needed);

    const name = `img${this.pageIndex}-${Math.round(this.y)}`;
    this.doc.addImage(name, block.data);
    this.page.image(name, FRAME.left, this.y - h, COLUMN, h, block);
    this.y -= h + 8;
    for (const line of captionLines) {
      this.page.text(line, FRAME.left, this.y, { font: 'sans', size: 8.5, rgb: OZIKORO.muted });
      this.y -= 8.5 * 1.35;
    }
    if (block.credit) {
      this.page.text(block.credit, FRAME.left, this.y, { font: 'sans', size: 8, rgb: OZIKORO.green });
      this.y -= 8.5 * 1.35;
    }
    this.y -= 14;
  }

  private drawList(items: string[]): void {
    for (const item of items) {
      const lines = this.doc.wrap(item, 'serif', TYPE.body, COLUMN - 16);
      for (let i = 0; i < lines.length; i++) {
        this.ensure(TYPE.bodyLeading);
        const line = lines[i] as string;
        if (i === 0) this.page.text('·', FRAME.left, this.y, { font: 'serif', size: TYPE.body, rgb: OZIKORO.green });
        this.page.text(line, FRAME.left + 14, this.y, { font: 'serif', size: TYPE.body, rgb: OZIKORO.bodyInk });
        this.y -= TYPE.bodyLeading;
      }
    }
    this.y -= 8;
  }

  /**
   * The references, in the template's own treatment: `.reference { grid-template-columns:32px 1fr;
   * background:var(--cream); border-radius:7px; padding:13px 16px }`, the numeral in the gold, the entry
   * in the body serif, and `.references { display:grid; gap:14px }` between them.
   *
   * **No references means no page**, which is why this is called only when the record carries some. The
   * entries are the article's own source records where the archive holds them and its own bibliography
   * where it does not; **nothing is written here to fill a card.**
   */
  private references(): void {
    const fromDatabase = this.input.references.length > 0;
    if (!fromDatabase) return;
    this.newPage('references');
    const p = this.page;
    p.text(REFERENCES_LABEL, FRAME.left, 754.02, { font: 'sansBold', size: TYPE.sectionNo, rgb: OZIKORO.green, tracking: 0.6 });
    p.fill(OZIKORO.gold).fillRect(FRAME.left, 754.02 - 5 - TYPE.sectionRule, TYPE.sectionRuleWidth, TYPE.sectionRule);
    p.text('References', FRAME.left, 709.34, { font: 'serifBold', size: TYPE.referencesTitle, rgb: OZIKORO.ink });
    let y = 681.21;
    for (const line of this.doc.wrap(this.referencesIntro(), 'sans', 9.5, COLUMN)) {
      p.text(line, FRAME.left, y, { font: 'sans', size: 9.5, rgb: OZIKORO.muted });
      y -= 11.5;
    }
    this.y = y - 10;

    const padX = 16;
    const numberW = 32;
    const gutter = 10;
    for (let i = 0; i < this.input.references.length; i++) {
      const text = this.input.references[i] as string;
      const lines = this.doc.wrap(text, 'serif', TYPE.reference, COLUMN - numberW - gutter - padX * 2);
      const cardH = lines.length * TYPE.referenceLeading + 26;
      this.ensure(cardH + 14);

      const top = this.y;
      this.page.fill(OZIKORO.cream).roundedRect(FRAME.left, top - cardH, COLUMN, cardH, 7).fillPath();
      let cy = top - 13 - TYPE.reference * 0.8;
      this.page.text(String(i + 1).padStart(2, '0'), FRAME.left + padX, cy + 1, {
        font: 'sansBold', size: TYPE.referenceNumber, rgb: OZIKORO.gold,
      });
      for (const line of lines) {
        this.page.text(line, FRAME.left + padX + numberW + gutter, cy, { font: 'serif', size: TYPE.reference, rgb: OZIKORO.ink });
        cy -= TYPE.referenceLeading;
      }
      this.y = top - cardH - 14;
    }
  }

  /** Which intro the page carries depends on where its entries came from, and both sentences are true. */
  private referencesIntro(): string {
    return this.input.referencesFromSources ? REFERENCES_NOTE : REFERENCES_FALLBACK_NOTE;
  }

  /**
   * The author, in the template's own green panel: `.author-card { background:var(--green); color:white;
   * border-radius:7px; padding:21px 20px }`, its label in the gold, the name at 17 points and the line
   * under it in Arial.
   *
   * **A heading over nothing is not a section**, so an author with no biography gets no panel; and the
   * biography is the record's own words, wrapped, rather than a line this renderer made up about them.
   * The template puts the panel at the foot of the page its references are on, which is where it goes
   * whenever it fits clear of the last card; otherwise it flows after the body, because a panel written
   * over the last reference is a worse fault than one that is not pinned to the page's foot.
   */
  private aboutAuthor(): void {
    if (!this.input.author || !this.input.authorBio) return;
    const padX = 20;
    const lines = this.doc.wrap(this.input.authorBio, 'serif', TYPE.authorBody, COLUMN - padX * 2);
    const boxH = 21 + TYPE.authorName + 12 + lines.length * 11 + 21;
    const anchorBottom = 104;
    const onReferences = this.kinds[this.pageIndex] === 'references';
    let top: number;
    if (onReferences && anchorBottom + boxH < this.y - 24) {
      top = anchorBottom + boxH;
    } else {
      if (this.y - boxH - 20 < FRAME.bodyBottom) this.newPage('body');
      else this.y -= 16;
      top = this.y;
    }
    this.page.fill(OZIKORO.green).roundedRect(FRAME.left, top - boxH, COLUMN, boxH, 7).fillPath();
    this.page.text(ABOUT_LABEL, FRAME.left + padX, top - 21 - 8 * 0.8, { font: 'sansBold', size: 8, rgb: OZIKORO.gold, tracking: 0.5 });
    this.page.text(this.input.author, FRAME.left + padX, top - 21 - TYPE.authorName - 12, {
      font: 'serifBold', size: TYPE.authorName, rgb: OZIKORO.white,
    });
    let cy = top - 21 - TYPE.authorName - 12 - TYPE.authorName - 6;
    for (const line of lines) {
      this.page.text(line, FRAME.left + padX, cy, { font: 'sans', size: TYPE.authorBody, rgb: OZIKORO.authorFaint });
      cy -= 11;
    }
    this.y = top - boxH - 18;
  }

  /**
   * The back page: `.page.cover.end` — the ground, the green spine, `.end-logo { width:68px }`, `.brand`,
   * `.end-tagline`, `.strap`, `.gold-line` and `.end-url`.
   */
  private backPage(): void {
    this.newPage('back');
    const p = this.page;
    p.fill(OZIKORO.ink).fillRect(0, 0, SHEET.width, SHEET.height);
    p.fill(OZIKORO.green).fillRect(0, 0, 13, SHEET.height);

    const icon = this.input.logo?.icon ?? null;
    const logoW = 68;
    const top = SHEET.height - 95; // `.end .cover-inner { padding-top:95px }`
    let brandBaseline = 646.2992;
    if (icon) {
      this.doc.addImage('ozikoro-icon-back', icon.data);
      const h = (icon.height / icon.width) * logoW;
      p.image('ozikoro-icon-back', FRAME.left, top - h, logoW, h, icon);
      // `.end-logo { display:block; margin-bottom:28px }` — the wordmark follows the artwork, chained, so a
      // narrower or square logo cannot be written over by the name under it.
      brandBaseline = Math.min(brandBaseline, top - h - 28 - TYPE.endBrand * 0.8);
    }
    p.text('Ozi Ikòrò', FRAME.left, brandBaseline, { font: 'serifBold', size: TYPE.endBrand, rgb: OZIKORO.gold });
    // `.end-tagline { margin-top:44px; font-size:25px; font-style:italic; color:#eee9df }`
    const tagline = 583.937;
    p.text(BACK_SLOGAN, FRAME.left, tagline, { font: 'serifItalic', size: TYPE.endTagline, rgb: OZIKORO.subtitle });
    // `.end .strap { margin-top:42px }` and `.end .gold-line { margin-top:31px }`
    p.text(BACK_STRAPLINE, FRAME.left, 535.748, { font: 'sans', size: 7, rgb: OZIKORO.faint });
    p.rule(FRAME.left, 507.4016, FRAME.left + 153.0709, OZIKORO.gold, 1);
    p.text(BACK_SITE, FRAME.left, 42.51969, { font: 'sans', size: 7, rgb: OZIKORO.faint });
  }

  render(): Buffer {
    this.cover();
    this.openingPage();

    /*
     * THE ARTICLE, FLOWING.
     *
     * **The sections are the shallowest heading level the record actually uses.** The template numbers
     * `01`, `02`, `03` over an article whose headings are `<h3>`, so numbering only `<h2>` would leave the
     * owner's own article with no sections at all — and numbering *every* heading regardless of level would
     * give an `<h2>`/`<h3>` article two competing series. Neither is a guess: the level is read from the
     * record. **An article with no headings gets no sections**, which is the honest outcome.
     */
    const sectionLevel: 2 | 3 = this.input.blocks.some((b) => b.kind === 'heading' && b.level === 2) ? 2 : 3;
    let sections = 0;
    let seenProse = false;
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
        continue;
      }
      /*
       * THE FEATURED IMAGE IS NOT PRINTED TWICE.
       *
       * An article's body very often opens with a `<figure>` holding the same photograph that is its
       * featured image, and the cover has already printed it. **The comparison is the bytes themselves**,
       * so an article that legitimately carries a *different* picture inline keeps every one of them.
       */
      if (block.kind === 'image' && this.input.featured && block.data.equals(this.input.featured.data)) continue;
      this.drawBodyBlock(block);
    }

    this.references();
    this.authorCardOrNothing();
    this.backPage();

    // The footers are written last because the page count is not known until the document is finished.
    for (let i = 1; i < this.doc.pages.length; i++) {
      const page = this.doc.pages[i];
      const kind = this.kinds[i] ?? 'body';
      if (!page) continue;
      if (kind === 'references') this.number(page, i, TYPE.head, FRAME.headerBaseline, true);
      this.footer(page, i, kind);
    }
    return this.doc.build();
  }

  /** The author panel, under the name the record actually carries. */
  private authorCardOrNothing(): void {
    this.aboutAuthor();
  }

  /**
   * The opening page: `.page.article` with the template's own `.section-no` slot carrying the wordmark, and
   * then the article.
   *
   * The template's `.page-header` is the running head, so the opening page's title block is the *cover's*
   * job in the template and the approved pages' own here: the wordmark and the short title in the label
   * slot, the title at 26 points, the byline in the italic, and the article under a gold hairline.
   * **The standfirst is set only when it says something the body does not** — this archive's `standfirst` is
   * usually the article's opening sentences with an ellipsis, and printing it above the body would print
   * the same paragraph twice.
   */
  private openingPage(): void {
    this.newPage('opening');
    const p = this.page;
    p.text('Ozi Ikòrò', FRAME.left, 759.68, { font: 'serifBold', size: 8.49, rgb: OZIKORO.ink });
    p.text(this.shortTitle(), FRAME.left, 750.5, { font: 'sansBold', size: TYPE.sectionNo, rgb: OZIKORO.green, tracking: 0.6 });
    p.fill(OZIKORO.gold).fillRect(FRAME.left, 754.02 - 5 - TYPE.sectionRule, TYPE.sectionRuleWidth, TYPE.sectionRule);

    /*
     * THE TITLE BLOCK, FLOWING DOWNWARD FROM THE APPROVED PAGE'S OWN FIRST BASELINE.
     *
     * The approved page's title baselines are 714.01 and 686.86 — a 27.14-point lead on a 26-point
     * headline — its byline 15.47 below the last of them, its gold hairline 25.51 below that, and the
     * article itself 36.85 below the hairline. **Those gaps are chained rather than fixed**, so a three-line
     * title pushes the byline down instead of being written over by it, which is what a fixed baseline does.
     */
    let y = 714.01;
    let lastTitle = y;
    for (const line of this.doc.wrap(this.input.title, 'serifBold', TYPE.heading, COLUMN)) {
      p.text(line, FRAME.left, y, { font: 'serifBold', size: TYPE.heading, rgb: OZIKORO.ink });
      lastTitle = y;
      y -= TYPE.heading * 1.06;
    }
    const byline = [
      this.input.author ? `By ${this.input.author}` : null,
      this.input.category,
      'Ozikoro.com',
    ].filter(Boolean).join('  ·  ');
    const bylineY = lastTitle - 15.47;
    p.text(byline, FRAME.left, bylineY, { font: 'serifItalic', size: 9.2, rgb: OZIKORO.muted });
    const ruleY = bylineY - 25.51;
    p.rule(FRAME.left, ruleY, FRAME.right, OZIKORO.gold, 1);

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

/**
 * A SOURCE ROW, AS THE ARCHIVE HOLDS IT.
 *
 * One field per column of `ozikoro_source` that a citation can be built from, and **no field this table
 * does not have**: there is no `doi`, no `edition` and no `translator` here because the schema has none,
 * and a citation naming one would be naming something the archive cannot support.
 */
export type SourceRow = {
  kind: string;
  title: string;
  authors: string[];
  year: number | null;
  year_note: string | null;
  publisher: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  url: string | null;
  identifier: string | null;
  archive: string | null;
  collection: string | null;
};

/**
 * ONE REFERENCE, BUILT FROM A SOURCE ROW AND FROM NOTHING ELSE, **IN APA 7TH EDITION**.
 *
 * THE TEMPLATE ASKS FOR THIS IN ITS OWN HTML: *"In the production system, this section should be generated
 * directly from the article's reference data."* So a reference list is the article's own `ozikoro_source`
 * rows, in the order the article cites them, and this is the whole of the formatting. The owner's rule is
 * that the style is APA 7th edition, and the shapes below are that manual's own:
 *
 *     BOOK       Author, A. A. (Year). Title of work. Publisher.
 *     JOURNAL    Author, A. A. (Year). Title of article. Journal Name, Volume(Issue), pages.
 *     WEB PAGE   Author, A. A. (Year, Month Day). Title of page. Site Name. URL
 *     CHAPTER    Author, A. A. (Year). Title of chapter. In E. E. Editor (Ed.), Title of book (pp. x–y). Publisher.
 *     NO AUTHOR  Title of work. (Year). Publisher.
 *     NO DATE    Author, A. A. (n.d.). Title of work. Publisher.
 *     REPORT     Author, A. A. (Year). Title of work (Report No. 123). Publisher. URL
 *     ARCHIVE    Author, A. A. (Year). Title of work. Name of Archive, Collection.
 *
 * THE RULES, AND THE ONE THAT MATTERS MOST
 *
 *   - **A PART THE ROW DOES NOT HAVE IS OMITTED, NEVER FILLED.** APA's own answer to a missing date is
 *     `(n.d.)` and to a missing publisher is to end the entry earlier — **not a plausible 1983.** The
 *     archive's `year_note` is used where the year is unknown and the note exists ("c. 430 BCE"),
 *     because that is the archive being more precise rather than less; where neither exists the entry
 *     says `(n.d.)`, which is exactly what APA says to say.
 *   - **A row with no authors leads with its own title**, because that is what APA does with an anonymous
 *     or corporate work and the archive has no author to name. A single-token author string that names an
 *     organisation is printed as it stands rather than having initials invented for it.
 *   - **The container is exactly one of journal / publisher / archive**, whichever the row actually holds,
 *     and the site name for a `website` is its publisher where the row has one and its own host where it
 *     does not.
 *   - **It is a pure function of the row.** No clock, no database, no fallback to prose — the caller
 *     decides whether a record's prose bibliography is used instead.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * `edition`, `translator`, `editor` and `doi` are not built, because **`ozikoro_source` has no such
 * columns** and an entry naming one would be naming something the archive cannot support. `licence` is
 * likewise not a citation element. The `identifier` column is printed as the archive stores it, at the end,
 * because that is where APA puts a DOI or a report number and because changing its form would be editing
 * the archive's own record of what a thing is.
 */
export function citationForSource(source: SourceRow): string {
  const parts: string[] = [];
  const authors = source.authors.filter((name) => name.trim().length > 0);
  const year = source.year !== null ? String(source.year) : (source.year_note?.trim() || 'n.d.');
  const title = endStop(source.title.trim(), '.');
  const isWeb = source.kind === 'website';

  /*
   * The attribution. **APA puts the date after the author and before the title**, and where there is no
   * author the title takes the author's place — with its own closing full stop removed first, because
   * `Title. (1959).` is not a title and a year, it is a sentence cut in half.
   */
  if (authors.length > 0) {
    parts.push(`${authorList(authors)} (${year}).`);
    parts.push(title);
  } else {
    parts.push(`${title.replace(/[.]$/, '')} (${year}).`);
  }

  /*
   * The container. **A journal article names its journal, volume, issue and pages; a book its publisher; a
   * record its archive and collection; a web page its site.** Where the row holds none of those, the entry
   * simply ends — which is APA's own instruction for a missing publisher and is not a gap to fill.
   */
  if (source.journal) {
    const volume = source.volume ? `, ${source.volume}` : '';
    const issue = source.issue ? `(${source.issue})` : '';
    const pages = source.pages ? `, ${source.pages}` : '';
    parts.push(endStop(`${source.journal}${volume}${issue}${pages}`, '.'));
  } else if (source.publisher) {
    parts.push(endStop(source.publisher.trim(), '.'));
  } else if (source.archive) {
    const where = [source.archive.trim(), source.collection?.trim()].filter(Boolean).join(', ');
    parts.push(endStop(where, '.'));
  } else if (isWeb && source.url) {
    // APA's site name, which the archive can supply from the URL's own host where no publisher is stored.
    const site = hostOf(source.url);
    if (site) parts.push(`${site}.`);
  }

  /*
   * The address and the identifier, **each printed once and neither printed twice**.
   *
   * The archive stores a DOI in `identifier` AND as a `https://doi.org/…` address, so a source that has
   * both would print the same identifier twice: `10.1017/qua.2017.54  https://doi.org/10.1017/qua.2017.54`.
   * **The duplicate is dropped**, and `identifier` is preferred where the two disagree because it is the
   * form APA asks for and the form the archive curated.
   */
  const identifier = source.identifier?.trim() || null;
  const url = source.url?.trim() || null;
  const tail = [identifier, url].filter((v): v is string => Boolean(v)).filter((v, i, all) => all.indexOf(v) === i);
  const repeated = identifier && url && (url.endsWith(identifier) || url.includes(identifier));
  if (tail.length) parts.push((repeated ? tail.slice(0, 1) : tail).join('  '));
  return parts.join(' ');
}

/**
 * `McIntosh, S. K. & McIntosh, R. J.` — family first, initials, an ampersand before the last.
 *
 * THE ONE PLACE A STORED NAME IS INVERTED ONLY IF INVERTING IT KEEPS ITS SHAPE.
 *
 * APA's author element is `Family, I. I.` — but only for a name that is a person's. **`Delta Decides` is an
 * organisation, and `Decides, D.` is a name the archive does not hold and the organisation does not use.**
 * The archive stores names one way and gives no flag for which is which, so the test is the one a reader
 * would apply: a name whose **last word begins with a capital** is a person's (`Keech McIntosh`,
 * `David K. Kay`); an organisation's last word is lowercase (`Delta Decides`) or the name is one token
 * (`UNESCO`, `Herodotus`), and both are printed exactly as the archive stores them.
 *
 * **Where the rule cannot tell, it prints the name unchanged**, which is never wrong in the way an invented
 * inversion is, and is what APA itself does with a group author.
 */
function authorList(authors: string[]): string {
  const names = authors.map(initialsName);
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** The site an address names, for APA's site-name element. **Null when it does not parse — never a guess.** */
function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * One terminal punctuation mark and no more.
 *
 * **`Mobile sedentism?` must not become `Mobile sedentism?.`** — the archive's title already ends its own
 * sentence, and APA's element separator is not a second one. A title with no closing mark gets one.
 */
function endStop(text: string, mark: string): string {
  return /[.!?]$/.test(text) ? text : `${text}${mark}`;
}

/**
 * `Given Family` → `Family, G.`, and a name that is not a person's left exactly as it is stored.
 *
 * **A single-token name is never touched** — `Herodotus` and `UNESCO` both come back unchanged, and giving
 * either initials would be inventing a name the archive does not hold. **A multi-word name whose last word
 * is not capitalised is treated as an organisation** (`Delta Decides`), for the reason in `authorList`.
 */
function initialsName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0] as string;
  const family = parts[parts.length - 1] as string;
  if (!/^[A-Z\u00c0-\u00de]/.test(family)) return name.trim();
  const initials = parts.slice(0, -1).map((p) => `${(p[0] ?? '').toUpperCase()}.`).join(' ');
  return `${family}, ${initials}`;
}
