/**
 * The override layer: how the owner edits the design without the design being edited.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP
 *
 * `apps/ozikoro/public/design/` is the approved deliverable and is byte-compared against the handover copy
 * (`scripts/check-design-parity.mjs`, 63 files). It is read as a TEMPLATE at request time and never written
 * to. The owner's edits live in `ozikoro_design_override` and are applied on top of the rendered page, which
 * is what makes them reversible, comparable and attributable — three things a mutated file cannot be.
 *
 * WHY THERE IS NO DOM LIBRARY HERE
 *
 * The pages this operates on are the deliverable's own static HTML: no framework, no build step, and the
 * markup is the artefact. A full parser would parse it and re-serialise it, and **a serialiser normalises**
 * — it re-quotes attributes, drops comments and reorders nothing but reformats everything, so a page served
 * with one override on it would differ from the design in a hundred places nobody asked for. This scans the
 * document into elements with their exact byte ranges and edits those ranges, so the served page differs
 * from the design by exactly the edit.
 *
 * WHY THE SELECTORS ARE NOT CSS
 *
 * A stored key addresses one element and must keep addressing it. So the grammar is deliberately small —
 * tags, ids, classes, attributes, `:nth-of-type`/`:nth-child` and the two combinators — and the generator
 * prefers a NAME (`#id`, `[data-…]`, `tag.class`) over a POSITION. A CSS engine would also let a stored
 * value describe a shape (`div > ul`) rather than name a thing, and this repository has already served a
 * menu that was replaced by exactly that kind of selector.
 *
 * Run with: npm -w @ozikoro/platform run test
 */

/* ================================================================================================
 * 1. THE MODEL
 * ============================================================================================== */

/** The five things the owner may change. */
export type DesignOverrideKind = 'token' | 'text' | 'image' | 'link' | 'hide';

export const DESIGN_OVERRIDE_KINDS: readonly DesignOverrideKind[] = ['token', 'text', 'image', 'link', 'hide'];

/** The screen a token override is filed under: the palette is shared by every screen. */
export const ALL_SCREENS = '*';

/**
 * The value, in whatever shape its kind needs.
 *
 * `image` carries its credit rather than only its source because this archive's rule is that provenance has
 * a designed home: a photograph swapped without its credit following it is a photograph whose reader cannot
 * tell who took it. The credit is edited in the same row so the two cannot drift apart.
 */
export interface DesignOverrideValue {
  /** `token` — the whole declaration value, e.g. `#0b5c45`. */
  value?: string;
  /** `text` — the element's new text. Escaped on the way in, so it is text and not markup. */
  text?: string;
  /** `image` — the new source. */
  src?: string;
  /** `image` — the alternative text. An image that changes without its alt text is an image a screen reader
   *  describes wrongly, so the editor offers both and the row holds both. */
  alt?: string;
  /** `image` — the credit line, and the selector of the element that holds it. */
  credit?: string;
  creditKey?: string;
  /** `link` — where it goes, and what it says. */
  href?: string;
  label?: string;
  /** `hide` — present and true means the block is omitted from the response. */
  hidden?: boolean;
}

export interface DesignOverride {
  id?: number;
  /** A design screen name, or `*`. */
  screen: string;
  kind: DesignOverrideKind;
  /** A custom-property name for `token`; a selector for everything else. */
  key: string;
  label?: string | null;
  value: DesignOverrideValue;
  note?: string | null;
  actorId?: number | null;
  actorName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/* ================================================================================================
 * 2. WHAT THE DESIGN'S TOKENS ARE, AND WHICH OF THEM CARRY MEANING
 * ============================================================================================== */

/**
 * What a token is FOR.
 *
 * A program cannot know that `--moss` means "verified" and `--gold` means "the dark chrome's accent", and
 * the design says so in one-line comments beside each declaration. Those comments are read for the label;
 * this table exists for the part a comment cannot express — **whether changing the token can make a page
 * misleading or unreadable**, which is the question the owner's request has to answer.
 *
 *   decoration  changing it changes the look
 *   meaning     changing it changes what a reader can tell, or whether they can read it at all
 *
 * The distinction is not decoration for its own sake: an editor that presents a warning colour and a page
 * background as two identical swatches is an editor that lets the owner make a verified record look
 * unverified, or a link look like body text.
 */
export interface TokenMeta {
  group: string;
  role: 'decoration' | 'meaning';
  note?: string;
}

export const TOKEN_META: Record<string, TokenMeta> = {
  /* ---- Colour: warm paper, ink, and a single earth accent ------------------- */
  'paper': { group: 'Paper and ink', role: 'decoration' },
  'paper-raised': { group: 'Paper and ink', role: 'decoration' },
  'paper-sunk': { group: 'Paper and ink', role: 'decoration' },
  'paper-edge': { group: 'Paper and ink', role: 'decoration' },
  'paper-edge-firm': { group: 'Paper and ink', role: 'decoration' },
  'ink': { group: 'Paper and ink', role: 'meaning', note: 'Body text. It must stay readable on the page ground and on a card.' },
  'ink-strong': { group: 'Paper and ink', role: 'meaning', note: 'Headings. A heading that is not darker than body text stops being a heading.' },
  'ink-muted': { group: 'Paper and ink', role: 'meaning', note: 'Metadata and captions. Faint by design, but it is still text a reader has to read.' },
  'ink-faint': { group: 'Paper and ink', role: 'meaning', note: 'Placeholder and disabled text. This is the tone the design has already had to rescue once: a control at 1.13:1 is a control nobody can see.' },
  'accent': { group: 'Accent', role: 'meaning', note: 'Links and marks. It doubles as the link colour, so it must contrast with the page ground and must be distinguishable from body text.' },
  'accent-deep': { group: 'Accent', role: 'meaning', note: 'Hover and pressed state. If it matches the accent, hovering gives no feedback.' },
  'accent-wash': { group: 'Accent', role: 'decoration' },
  'indigo': { group: 'Accent', role: 'meaning', note: 'The second voice: sources and citations. If it becomes the accent, a reader cannot tell a source from a link.' },
  'indigo-wash': { group: 'Accent', role: 'decoration' },
  'ochre': { group: 'Accent', role: 'meaning', note: 'Period and date chips. The tone is how a chip says what kind of fact it is.' },
  'ochre-wash': { group: 'Accent', role: 'decoration' },
  'moss': { group: 'Accent', role: 'meaning', note: 'The VERIFIED state. Change it and a verified record stops looking verified, which is the one thing this palette says about the record itself.' },
  'moss-wash': { group: 'Accent', role: 'decoration' },
  'focus': { group: 'Accent', role: 'meaning', note: 'The focus ring. It is deliberately never the accent, because a ring the colour of a link is a ring nobody sees; WCAG 2.4.11 wants 3:1 against what it sits on.' },
  /* ---- Semantic roles ------------------------------------------------------ */
  'bg': { group: 'Semantic roles', role: 'decoration' },
  'surface': { group: 'Semantic roles', role: 'decoration' },
  'surface-sunk': { group: 'Semantic roles', role: 'decoration' },
  'rule': { group: 'Semantic roles', role: 'decoration' },
  'rule-firm': { group: 'Semantic roles', role: 'decoration' },
  'text': { group: 'Semantic roles', role: 'meaning', note: 'The body text role. It follows `--ink` unless it is given a value of its own.' },
  'text-heading': { group: 'Semantic roles', role: 'meaning', note: 'The heading role. It follows `--ink-strong` unless it is given a value of its own.' },
  'text-muted': { group: 'Semantic roles', role: 'meaning', note: 'The muted role. It follows `--ink-muted` unless it is given a value of its own.' },
  'link': { group: 'Semantic roles', role: 'meaning', note: 'The link role. It follows `--accent` unless it is given a value of its own.' },
  'link-hover': { group: 'Semantic roles', role: 'meaning', note: 'The hovered link role.' },
  /* ---- Showcase palette ---------------------------------------------------- */
  'night': { group: 'Dark chrome', role: 'decoration' },
  'night-2': { group: 'Dark chrome', role: 'decoration' },
  'night-3': { group: 'Dark chrome', role: 'decoration' },
  'emerald': { group: 'Dark chrome', role: 'decoration' },
  'emerald-deep': { group: 'Dark chrome', role: 'decoration' },
  'gold': { group: 'Dark chrome', role: 'decoration' },
  'gold-bright': { group: 'Dark chrome', role: 'decoration' },
  'bronze': { group: 'Dark chrome', role: 'decoration' },
  'cream': { group: 'Dark chrome', role: 'meaning', note: 'The page ground. `showcase.css` paints `body` with this rather than with `--bg`, so this — not `--paper` — is the colour a reader sees behind the text. Editing `--paper` alone will not change it.' },
  'on-night': { group: 'Dark chrome', role: 'meaning', note: 'Text on the dark chrome. It must stay readable against `--night`.' },
  'on-night-muted': { group: 'Dark chrome', role: 'meaning', note: 'Secondary text on the dark chrome.' },
  'gradient-gold': { group: 'Dark chrome', role: 'decoration' },
  'gradient-night': { group: 'Dark chrome', role: 'decoration' },
  'shadow-raise': { group: 'Shape', role: 'decoration' },
  'shadow-lift': { group: 'Shape', role: 'decoration' },
  'shadow-glow': { group: 'Shape', role: 'decoration' },
  /* ---- Type, rhythm and shape --------------------------------------------- */
  'font-serif': { group: 'Type', role: 'meaning', note: 'The dotted vowels and tone marks render from this family. A substitute without them breaks the orthography rather than the look.' },
  'font-sans': { group: 'Type', role: 'meaning', note: 'Same rule as the serif: the language is carrying combining marks, not just Latin text.' },
  'font-mono': { group: 'Type', role: 'decoration' },
  'lh-body': { group: 'Type', role: 'meaning', note: 'Long-form leading. The design sets it generously so tone marks do not touch the line above.' },
  'ls-caps': { group: 'Type', role: 'decoration' },
  'measure': { group: 'Type', role: 'meaning', note: 'The reading measure, about 68 characters. Much wider and the text stops being comfortable to read.' },
  'container': { group: 'Shape', role: 'decoration' },
  'container-narrow': { group: 'Shape', role: 'decoration' },
};

/**
 * A token whose value can be edited, and what kind of value it is.
 *
 * NAMED `DesignTokenClass` AND NOT `TokenClass`, because `igbo-words.ts` already exports a `TokenClass` for
 * the dictionary's parts of speech. Both are re-exported from this package's barrel, and a second
 * `export *` of the same name makes the whole barrel ambiguous — which fails the repository-wide typecheck
 * that the pre-commit hook runs, so the clash stops every agent in the checkout rather than one import.
 */
export type DesignTokenClass = 'colour' | 'alias' | 'gradient' | 'shadow' | 'length' | 'number' | 'font' | 'text';

export interface DesignToken {
  /** Without the leading `--`, because every API addresses it that way. */
  name: string;
  value: string;
  /** The one-line comment beside the declaration, which is the design's own description of it. */
  comment: string | null;
  tokenClass: DesignTokenClass;
  /** Tokens this value reads through `var(--x)`. */
  references: string[];
  /** How many rules in the served stylesheets read this token. */
  uses: number;
  group: string;
  role: 'decoration' | 'meaning';
  note: string | null;
  /** False for the handful a value cannot honestly be typed for (a gradient is a function, not a colour). */
  editable: boolean;
}

function classify(value: string): DesignTokenClass {
  const v = value.trim();
  if (/^var\(--[a-z0-9-]+\)$/i.test(v)) return 'alias';
  if (/^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(v)) return 'colour';
  if (/gradient\(/i.test(v)) return 'gradient';
  if (/^(inset\s|0\s+\d|rgba?\(|\d+px\s)/.test(v) && /px|rgba?\(/.test(v) && !/-?\d*\.?\d+(rem|em)\b/.test(v)) return 'shadow';
  if (/^-?\d*\.?\d+(rem|px|em|%|ch|vw|vh)$/i.test(v) || v === '0') return 'length';
  if (/^-?\d*\.?\d+$/.test(v)) return 'number';
  if (/^["']?.+["']?,\s*(serif|sans-serif|monospace|system-ui)/.test(v)) return 'font';
  if (/^["']/.test(v)) return 'font';
  return 'text';
}

/**
 * Every custom property the design declares, with its value, its classification and how many rules use it.
 *
 * `stylesheets` is passed in rather than read here because this module is pure and the app is what knows
 * where the deliverable is. The count of readers is the honest answer to "what does this actually change":
 * `--accent` is read by hundreds of rules, and a token read by none is a token whose edit nobody will see.
 */
export function parseDesignTokens(tokensCss: string, stylesheets: string[] = []): DesignToken[] {
  const readership = stylesheets.join('\n');
  const tokens: DesignToken[] = [];

  /*
   * A DECLARATION AND THE COMMENT BESIDE IT.
   *
   * The design writes each token on one line with its own sentence after the semicolon —
   * `--paper: #f7f1e3;  /* page ground *​/` — so the comment that describes a declaration is the one that
   * begins immediately after it, allowing spaces and tabs but no newline. A newline before the comment
   * means the comment belongs to the next section (`/* ---- Showcase palette … *​/`), not to this token, and
   * attributing it here would put the wrong sentence beside the owner's swatch.
   *
   * A value containing `{` or `}` cannot be a custom-property value in this file (the whole point of the
   * file is that it has no selectors beyond `:root`), so excluding them from the value class rather than
   * balancing braces is safe and keeps the scan linear.
   */
  const DECL = /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g;
  let match: RegExpExecArray | null;
  while ((match = DECL.exec(tokensCss)) !== null) {
    const name = (match[1] ?? '').slice(2);
    const value = (match[2] ?? '').trim();
    if (!name || value.length === 0) continue;
    const beside = /^[ \t]*\/\*([\s\S]*?)\*\//.exec(tokensCss.slice(DECL.lastIndex));
    const comment = beside ? (beside[1] ?? '').replace(/\s+/g, ' ').trim() : null;
    const meta = TOKEN_META[name];
    const tokenClass = classify(value);
    tokens.push({
      name,
      value,
      comment: comment && comment.length > 0 && comment.length < 200 ? comment : null,
      tokenClass,
      references: [...value.matchAll(/var\(--([a-z0-9-]+)\)/gi)].map((m) => m[1] ?? ''),
      uses: (readership.match(new RegExp(`var\\(--${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g')) ?? []).length,
      group: meta?.group ?? 'Other',
      role: meta?.role ?? 'decoration',
      note: meta?.note ?? null,
      editable: tokenClass !== 'text',
    });
  }
  return tokens;
}

/* ================================================================================================
 * 3. CONTRAST, MEASURED RATHER THAN ASSERTED
 * ============================================================================================== */

/**
 * A pair of tokens that sit on one another, and the ratio the design's own standards ask of it.
 *
 * 4.5:1 is WCAG 2.2 AA for text; 3:1 is the floor for non-text (a focus ring, a large glyph) and for text
 * that is deliberately faint. The pairs are the ones the palette actually creates — a body colour is only
 * readable relative to a ground, and a token on its own has no contrast at all.
 */
export interface ContrastPair {
  fg: string;
  bg: string;
  role: string;
  /** The ratio the pair must reach to be honest. */
  min: number;
  /** True when the pair is non-text and 3:1 is the applicable standard. */
  nonText?: boolean;
}

export const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: 'ink', bg: 'cream', role: 'Body text on the page ground', min: 4.5 },
  { fg: 'ink', bg: 'paper-raised', role: 'Body text on a card', min: 4.5 },
  { fg: 'ink-strong', bg: 'cream', role: 'Headings on the page ground', min: 4.5 },
  { fg: 'ink-muted', bg: 'cream', role: 'Captions and metadata on the page ground', min: 4.5 },
  { fg: 'ink-faint', bg: 'cream', role: 'Placeholder and disabled text (deliberately faint)', min: 3 },
  { fg: 'accent', bg: 'cream', role: 'Links in body copy', min: 4.5 },
  { fg: 'accent', bg: 'paper-raised', role: 'Links and marks on a card', min: 4.5 },
  { fg: 'accent-deep', bg: 'cream', role: 'A hovered link, which must differ from the link', min: 4.5 },
  { fg: 'indigo', bg: 'cream', role: 'Citations against the page ground', min: 4.5 },
  { fg: 'ochre', bg: 'cream', role: 'Period and date chips against the page ground', min: 4.5 },
  { fg: 'moss', bg: 'cream', role: 'The verified state against the page ground', min: 4.5 },
  { fg: 'on-night', bg: 'night', role: 'Text on the dark chrome', min: 4.5 },
  { fg: 'on-night-muted', bg: 'night', role: 'Secondary text on the dark chrome', min: 4.5 },
  { fg: 'gold', bg: 'night', role: 'The gold accent on the dark chrome', min: 3 },
  { fg: 'focus', bg: 'cream', role: 'The focus ring on the page ground', min: 3, nonText: true },
  { fg: 'focus', bg: 'night', role: 'The focus ring on the dark chrome', min: 3, nonText: true },
];

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` — the forms the design actually writes. */
export function parseColour(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    const h = hex[1] ?? '';
    if (h.length === 3 || h.length === 4) {
      return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16)];
    }
    if (h.length === 6 || h.length === 8) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return null;
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The WCAG contrast ratio, to two decimals. 1 is invisible, 21 is black on white. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseColour(a);
  const cb = parseColour(b);
  if (!ca || !cb) return null;
  const la = luminance(ca);
  const lb = luminance(cb);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/**
 * Follow `var(--x)` chains to a literal value.
 *
 * `--bg: var(--paper)` means the page's `--bg` is whatever `--paper` is, and a contrast readout that gave up
 * at `var(--paper)` would have nothing to measure. A cycle returns null rather than looping, because a
 * stylesheet with a cycle in it is a fault worth reporting as "unresolved" rather than hanging a page
 * render on.
 */
export function resolveToken(name: string, values: Map<string, string>, seen: Set<string> = new Set()): string | null {
  if (seen.has(name)) return null;
  seen.add(name);
  const raw = values.get(name);
  if (raw === undefined) return null;
  const alias = /^var\(--([a-z0-9-]+)\)$/i.exec(raw.trim());
  if (alias) return resolveToken(alias[1] ?? '', values, seen);
  return raw;
}

export interface ContrastResult extends ContrastPair {
  fgValue: string;
  bgValue: string;
  ratio: number | null;
  pass: boolean;
}

/** Every pair, measured against the values in force. */
export function contrastReport(values: Map<string, string>): ContrastResult[] {
  return CONTRAST_PAIRS.map((pair) => {
    const fgValue = resolveToken(pair.fg, values) ?? '';
    const bgValue = resolveToken(pair.bg, values) ?? '';
    const ratio = fgValue && bgValue ? contrastRatio(fgValue, bgValue) : null;
    return { ...pair, fgValue, bgValue, ratio, pass: ratio !== null && ratio >= pair.min };
  });
}

/* ================================================================================================
 * 4. THE SCANNER — ELEMENTS WITH THEIR EXACT BYTE RANGES
 * ============================================================================================== */

export interface HtmlElement {
  tag: string;
  /** The raw attribute text between the tag name and the `>` or `/>`. */
  attrs: string;
  /** Index of the `<` that opens the element. */
  start: number;
  /** Index just after the opening tag's `>`. */
  openEnd: number;
  /** Index of the `</` that closes it, or -1 when it is void or unclosed. */
  closeStart: number;
  /** Index just after the closing tag — or `openEnd` for a void element. */
  end: number;
  parent: HtmlElement | null;
  children: HtmlElement[];
}

/**
 * The elements the design's own screens use, and the ones a tag may never be closed for.
 *
 * `script`, `style`, `textarea` and `title` have raw-text content, so a `<` inside them is not a tag and
 * scanning into them would invent elements out of JavaScript — which is how a rewrite ends up editing a
 * string inside a script rather than the document.
 */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

/**
 * Scan the document into elements, with the byte range of each.
 *
 * Unbalanced markup is tolerated rather than rejected: this is the deliverable, it is well formed, but a
 * fill at serve time rewrites regions of it and a scanner that threw on a fill's output would take a page
 * down. An unclosed element ends where its parent ends.
 */
export function scanElements(html: string): { elements: HtmlElement[]; root: HtmlElement } {
  const root: HtmlElement = { tag: '#root', attrs: '', start: 0, openEnd: 0, closeStart: -1, end: html.length, parent: null, children: [] };
  const elements: HtmlElement[] = [];
  const stack: HtmlElement[] = [root];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      const tag = html.slice(lt + 2, end === -1 ? html.length : end).trim().toLowerCase().split(/\s/)[0] ?? '';
      // Close the nearest matching open element, and implicitly close anything still open inside it.
      for (let s = stack.length - 1; s >= 1; s -= 1) {
        if (stack[s]!.tag === tag) {
          const closed = stack.splice(s);
          const at = end === -1 ? html.length : end + 1;
          for (const node of closed) {
            node.closeStart = lt;
            node.end = at;
          }
          break;
        }
      }
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const name = /^<([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(html.slice(lt));
    if (!name) {
      i = lt + 1;
      continue;
    }
    const tag = (name[1] ?? '').toLowerCase();
    let end = findTagEnd(html, lt + name[0].length);
    if (end === -1) end = html.length - 1;
    const attrs = html.slice(lt + name[0].length, end);
    const selfClosing = attrs.trimEnd().endsWith('/');
    const openEnd = end + 1;
    const element: HtmlElement = {
      tag, attrs, start: lt, openEnd, closeStart: -1,
      end: VOID.has(tag) || selfClosing ? openEnd : html.length,
      parent: stack[stack.length - 1] ?? null,
      children: [],
    };
    element.parent?.children.push(element);
    /*
     * EVERY ELEMENT IS ADDRESSABLE; ONLY NESTING ELEMENTS GO ON THE STACK.
     *
     * A void element (`<img>`, `<input>`, `<br>`) has no closing tag, and an earlier version of this scan
     * kept them out of the element list entirely — which meant **no image could be edited**, because the
     * only `<img>` in the document had never been recorded. A void element is a place in the page like any
     * other; it simply cannot contain one.
     */
    elements.push(element);
    if (!VOID.has(tag) && !selfClosing) stack.push(element);

    if (RAW_TEXT.has(tag) && !VOID.has(tag) && !selfClosing) {
      const close = html.toLowerCase().indexOf(`</${tag}`, openEnd);
      const closeEnd = close === -1 ? html.length : html.indexOf('>', close) + 1;
      element.closeStart = close;
      element.end = closeEnd === 0 ? html.length : closeEnd;
      stack.pop();
      i = element.end;
      continue;
    }
    i = openEnd;
  }
  // Anything left open ends with the document.
  for (const node of stack.slice(1)) {
    node.closeStart = -1;
    node.end = html.length;
  }
  return { elements, root };
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * The scan, remembered for the string it was taken from.
 *
 * The inventory asks for a selector for every element on the page, and each selector is proved unique by
 * matching it against the whole document. Re-scanning a 40 KB screen a few hundred times would make the
 * editor page slow for no reason; one slot is enough because every caller works on one document at a time,
 * and comparing the string itself means a different document can never be answered from a stale slot.
 */
let scanCache: { html: string; elements: HtmlElement[]; root: HtmlElement } | null = null;

export function scanCached(html: string): { elements: HtmlElement[]; root: HtmlElement } {
  if (scanCache && scanCache.html === html) return scanCache;
  scanCache = { html, ...scanElements(html) };
  return scanCache;
}


export function attributesOf(element: HtmlElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of element.attrs.matchAll(ATTR_RE)) {
    const name = (match[1] ?? '').toLowerCase();
    if (!name) continue;
    out.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return out;
}

/** The element's inner HTML, exactly as the design wrote it. */
export function innerHtml(html: string, element: HtmlElement): string {
  const stop = element.closeStart === -1 ? element.end : element.closeStart;
  return html.slice(element.openEnd, stop);
}

/** Whether the element's content is text alone — the test that decides if overriding it can lose markup. */
export function hasElementChildren(html: string, element: HtmlElement): boolean {
  return /<[a-zA-Z]/.test(innerHtml(html, element));
}

/* ================================================================================================
 * 5. THE SELECTOR GRAMMAR — SMALL, AND DELIBERATELY NOT CSS
 * ============================================================================================== */

interface AttrTest { name: string; value: string | null }
interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: AttrTest[];
  nthOfType: number | null;
  nthChild: number | null;
}
interface Step { compound: Compound; child: boolean }

const IDENT = '[a-zA-Z0-9_-]+';

/**
 * Parse one compound selector, or return null.
 *
 * Returning null rather than throwing is the point: a stored key is data, and data that does not parse is
 * a key that matches nothing, not a broken page.
 */
function parseCompound(text: string): Compound | null {
  const compound: Compound = { tag: null, id: null, classes: [], attrs: [], nthOfType: null, nthChild: null };
  let rest = text.trim();
  if (rest.length === 0) return null;

  const tagName = new RegExp(`^([a-zA-Z][a-zA-Z0-9-]*|\\*)`).exec(rest);
  if (tagName) {
    compound.tag = tagName[1] === '*' ? null : (tagName[1] ?? '').toLowerCase();
    rest = rest.slice(tagName[0].length);
  }
  while (rest.length > 0) {
    let match = new RegExp(`^#(${IDENT})`).exec(rest);
    if (match) {
      compound.id = match[1] ?? '';
      rest = rest.slice(match[0].length);
      continue;
    }
    match = new RegExp(`^\\.(${IDENT})`).exec(rest);
    if (match) {
      compound.classes.push(match[1] ?? '');
      rest = rest.slice(match[0].length);
      continue;
    }
    match = /^\[([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:=(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest);
    if (match) {
      compound.attrs.push({ name: (match[1] ?? '').toLowerCase(), value: match[2] ?? match[3] ?? null });
      rest = rest.slice(match[0].length);
      continue;
    }
    match = /^:nth-of-type\((\d+)\)/.exec(rest);
    if (match) {
      compound.nthOfType = Number(match[1]);
      rest = rest.slice(match[0].length);
      continue;
    }
    match = /^:nth-child\((\d+)\)/.exec(rest);
    if (match) {
      compound.nthChild = Number(match[1]);
      rest = rest.slice(match[0].length);
      continue;
    }
    return null;
  }
  return compound;
}

export function parseSelector(selector: string): Step[] | null {
  const parts = selector.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const steps: Step[] = [];
  let child = false;
  for (const part of parts) {
    if (part === '>') {
      child = true;
      continue;
    }
    if (part === '') return null;
    const compound = parseCompound(part);
    if (!compound) return null;
    steps.push({ compound, child: steps.length > 0 && child });
    child = false;
  }
  return steps.length > 0 ? steps : null;
}

function siblingIndex(element: HtmlElement, byTag: boolean): number {
  const siblings = element.parent ? element.parent.children : [];
  let n = 0;
  for (const sibling of siblings) {
    if (byTag && sibling.tag !== element.tag) continue;
    n += 1;
    if (sibling === element) return n;
  }
  return n;
}

function matchesCompound(element: HtmlElement, compound: Compound): boolean {
  if (compound.tag && element.tag !== compound.tag) return false;
  const attrs = attributesOf(element);
  if (compound.id && attrs.get('id') !== compound.id) return false;
  if (compound.classes.length > 0) {
    const classes = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
    if (!compound.classes.every((c) => classes.includes(c))) return false;
  }
  for (const test of compound.attrs) {
    if (!attrs.has(test.name)) return false;
    if (test.value !== null && attrs.get(test.name) !== test.value) return false;
  }
  if (compound.nthOfType !== null && siblingIndex(element, true) !== compound.nthOfType) return false;
  if (compound.nthChild !== null && siblingIndex(element, false) !== compound.nthChild) return false;
  return true;
}

export function matchesSelector(element: HtmlElement, steps: Step[]): boolean {
  if (!matchesCompound(element, steps[steps.length - 1]!.compound)) return false;
  let node: HtmlElement | null = element;
  for (let i = steps.length - 2; i >= 0; i -= 1) {
    const step = steps[i]!;
    const direct = steps[i + 1]!.child;
    if (direct) {
      node = node?.parent ?? null;
      if (!node || !matchesCompound(node, step.compound)) return false;
      continue;
    }
    /*
     * THE ANNOTATION IS LOAD-BEARING. `node` is reassigned inside this loop, so the initialiser of
     * `ancestor` is inferred from a variable whose own type depends on the loop it is in — TypeScript
     * refuses that circularity with `TS7022` and, because the pre-commit hook runs the repository-wide
     * typecheck, one untyped local in one module stops every other agent in this shared checkout from
     * committing. It is written out rather than left to inference.
     */
    let ancestor: HtmlElement | null = node?.parent ?? null;
    let found = false;
    while (ancestor && ancestor.tag !== '#root') {
      if (matchesCompound(ancestor, step.compound)) {
        node = ancestor;
        found = true;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (!found) return false;
  }
  return true;
}

export function querySelectorAll(html: string, selector: string): HtmlElement[] {
  const steps = parseSelector(selector);
  if (!steps) return [];
  const { elements } = scanCached(html);
  return elements.filter((element) => matchesSelector(element, steps));
}

/* ================================================================================================
 * 6. THE INVENTORY — WHAT THE OWNER IS OFFERED, AND WHY SOME THINGS ARE NOT
 * ============================================================================================== */

export type InventoryKind = 'text' | 'image' | 'link' | 'hide';

/**
 * One place in the page, and every action that is honest for it.
 *
 * ONE ROW PER ELEMENT, NOT ONE PER EDIT. The owner is looking at a page and choosing a thing on it; a list
 * that offered "text" and "hide" as two separate searches for the same heading would ask him to know which
 * of the five kinds his intention belongs to.
 */
export interface InventoryItem {
  /** The selector the override is stored under. */
  key: string;
  tag: string;
  /** What the owner calls it: the design's own words, read as a place in the page. */
  label: string;
  /** The text as the page has it now — the fill's words on a filled screen. */
  text: string;
  /** Which actions this element can honestly take. */
  can: { text: boolean; hide: boolean; image: boolean; link: boolean };
  /**
   * EVERY PLACE ON THIS ELEMENT THAT HOLDS WORDS, WHICH IS NOT ONLY ITS CONTENT.
   *
   * A reader reads a form's `placeholder` and a button's `value` exactly as they read a heading, and neither
   * is an element's text: `innerHtml` never sees them and a text override keyed to the selector alone would
   * replace the wrong thing. So each place names its own attribute, and its key carries it.
   */
  places?: TextPlace[];
  /** Why `text` is unavailable, when it is. */
  textReason?: string;
  /** `image` — the current source, alt text, and where the credit lives. */
  src?: string;
  alt?: string;
  creditKey?: string;
  credit?: string;
  /** `link` — the current destination. */
  href?: string;
}

/**
 * One place on an element that holds words: its content, or one attribute of it.
 *
 * `attr` is absent for the element's own content and names the attribute otherwise, and the place's `key` is
 * the element's selector either way — with the attribute appended for an attribute, so that one element
 * carrying both a `placeholder` and a `value` is two places rather than one row that can only hold one of
 * them.
 */
export interface TextPlace {
  /** What the override is stored under: the selector, or `selector@@attribute`. */
  key: string;
  /** The attribute this place edits, or null for the element's own content. */
  attr: string | null;
  /** What the owner calls it — the design's own words where it has any. */
  label: string;
  /** What the page has there now. */
  value: string;
}

/**
 * The separator between a selector and the attribute a text place edits.
 *
 * WHY NOT THE ATTRIBUTE IN THE VALUE'S JSON, WHICH NEEDS NO NEW GRAMMAR
 *
 * Because the row's identity is `(screen, kind, key)`, and a search field carrying both a `placeholder` and a
 * `value` would be two text edits with one identity — so the second would overwrite the first with nothing
 * said. The attribute therefore belongs in the key, and the separator is a pair no selector this grammar can
 * produce ever contains: `@@` is not a character the tag, class, id or attribute-value grammar reads.
 */
export const ATTRIBUTE_SEPARATOR = '@@';

/** Split a stored key into the selector it names and the attribute it edits, if any. */
export function splitTextKey(key: string): { selector: string; attr: string | null } {
  const at = key.indexOf(ATTRIBUTE_SEPARATOR);
  if (at === -1) return { selector: key, attr: null };
  return { selector: key.slice(0, at), attr: key.slice(at + ATTRIBUTE_SEPARATOR.length) || null };
}

/**
 * The attributes whose value a reader reads as words.
 *
 * MEASURED, AND ONE OF THE TWO CANDIDATES IS NOT HERE. `placeholder` is offered because the deliverable has
 * 81 inputs carrying one across 18 of the 52 screens, and the search field's is the most-read sentence on
 * `/archive-index/`. `value` is NOT offered, and the reason is the rule this editor exists to keep: on this
 * deliverable every `value` belongs to a control a reader does not read it as words — 31 checkbox and radio
 * facet keys (`igbo`, `pre1500`), one number, one date, one search default and four example strings — so
 * offering it would be a control for something that is not there, and editing a facet key would silently
 * break the filter it names. The design's button labels are `<button>` elements, whose content is already a
 * text place.
 */
export const TEXT_ATTRIBUTES: readonly string[] = ['placeholder'];

/** The input types whose `placeholder` a reader reads: the ones a person types into. */
const TYPED_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'password', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'week', 'time',
]);

/**
 * The words this element holds that a reader reads, content first.
 *
 * WHY AN ATTRIBUTE IS OFFERED AT ALL
 *
 * Measured on the deliverable: 81 `input` elements across 18 of the 52 screens carry a `placeholder`, and the
 * search field's — "Search by town, clan, period or author" — is the most-read sentence on `/archive-index/`.
 * The element-content-only rule offered none of them, so a form's own words were the one part of the page the
 * design editor could not reach.
 */
export function textPlacesOf(html: string, element: HtmlElement, selector: string): { places: TextPlace[]; reason?: string } {
  const attrs = attributesOf(element);
  const places: TextPlace[] = [];
  const content = textOf(html, element);
  let reason: string | undefined;
  if (TEXT_TAGS.has(element.tag)) {
    if (content.length === 0) {
      reason = 'This element is empty, so there is nothing to change.';
    } else {
      /*
       * REPLACING AN ELEMENT'S TEXT REPLACES EVERYTHING INSIDE IT, so the offer depends on what is in there.
       *
       * A nested `<a>` REFUSES it: everything on these pages is reached by a link, and an edit that deleted
       * one would leave a word that looks like a link and is not. Inline emphasis — `<strong>`, `<em>`,
       * `<small>` — is offered WITH the warning, because losing a bold phrase is a change the owner can see
       * and undo, and refusing it would make a sentence like `/donate/`'s notice (which wraps its first
       * clause in `<strong>`) uneditable as the sentence it is.
       */
      const inner = innerHtml(html, element);
      const containsLink = /<a[\s>]/i.test(inner);
      const markup = [...new Set([...inner.matchAll(/<([a-z][a-z0-9-]*)/gi)].map((m) => (m[1] ?? '').toLowerCase()))];
      if (containsLink) {
        reason = 'This contains a link. Replacing its text would remove the link, so it is not offered — edit the link itself, or the text inside it.';
      } else {
        places.push({ key: selector, attr: null, label: 'Text', value: content });
        if (markup.length > 0) {
          reason = `Replacing this text also removes the markup inside it (${markup.map((t) => `<${t}>`).join(', ')}). The emphasis goes; the words are yours.`;
        }
      }
    }
  }
  const inputType = element.tag === 'input' ? (attrs.get('type') ?? 'text').toLowerCase() : element.tag === 'textarea' ? 'text' : '';
  for (const attr of TEXT_ATTRIBUTES) {
    const value = attrs.get(attr);
    if (value === undefined) continue;
    if (!(element.tag === 'textarea' || (element.tag === 'input' && TYPED_INPUT_TYPES.has(inputType)))) continue;
    places.push({ key: `${selector}${ATTRIBUTE_SEPARATOR}${attr}`, attr, label: 'Placeholder', value });
  }
  return { places, reason };
}

/**
 * The tags a text override is offered for.
 *
 * Not every element with text in it: a text override replaces the element's WHOLE content, so offering it
 * for something like `<nav>` or `<ul>` would let one edit erase a menu. This list is the text-bearing
 * vocabulary the design's screens actually use, and it is paired with the rule that the element must have
 * no element children at all.
 */
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'figcaption', 'button', 'summary', 'li', 'dt', 'dd', 'blockquote', 'legend', 'label', 'td', 'th', 'caption', 'strong', 'b', 'small', 'span', 'em', 'i', 'option', 'textarea', 'title']);

/**
 * The one element that is text-only, and why it is listed apart from the rest.
 *
 * `<title>` is the words in the browser tab and the heading of a search result — a reader reads it on every
 * screen, and it is written by the application's `seoHead` rather than by the design file, so it is the one
 * place where an override has to beat a serve-time value rather than a file. **It may be edited and never
 * hidden**: hiding a document's title is not "hiding a block", it is leaving the tab blank.
 */
const TEXT_ONLY = new Set(['title']);

/** The container vocabulary a block may be hidden by: things a reader would call a block. */
const BLOCK_TAGS = new Set(['section', 'div', 'figure', 'aside', 'article', 'nav', 'header', 'footer', 'ul', 'ol', 'form', 'table', 'details', 'p', 'blockquote']);

/** Tags that may never be hidden: hiding the document, its head or its scripts is not "a block". */
const NEVER_HIDDEN = new Set(['html', 'head', 'body', 'script', 'style', 'main', 'link', 'meta']);

/** How many places a screen's inventory offers, so a very large page cannot produce a huge one. */
export const INVENTORY_LIMIT = 150;

function textOf(html: string, element: HtmlElement): string {
  return innerHtml(html, element)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The narrowest selector that still names exactly one element.
 *
 * THE ORDER IS THE POINT. An `id` survives a re-export because the design's own CSS and JavaScript refer to
 * it; a `data-` attribute is next for the same reason; then a class, which the design's CSS also refers to.
 * **A position is the last resort**, because a position is the one thing a re-export is guaranteed to move —
 * and when a position is all there is, the selector climbs to the nearest nameable ancestor first so that
 * the number is measured from something named rather than from `<html>`.
 */
export function selectorFor(html: string, element: HtmlElement): string | null {
  const { elements } = scanCached(html);
  const unique = (selector: string, target: HtmlElement): boolean => {
    const steps = parseSelector(selector);
    if (!steps) return false;
    const found = elements.filter((candidate) => matchesSelector(candidate, steps));
    /*
     * COMPARED BY WHERE IT IS, NOT BY WHICH OBJECT IT IS. A caller can hold an element from its own scan and
     * ask for a selector for it, and two scans of one document produce two objects for one `<h1>`. An
     * identity test would then decide that every candidate selector matched something that is not the target
     * and return null — so an element that has a perfectly good name would be reported as unnameable.
     */
    return found.length === 1 && found[0]!.start === target.start;
  };

  const attrs = attributesOf(element);
  const id = attrs.get('id');
  if (id && unique(`#${id}`, element)) return `#${id}`;

  for (const attr of attrs.keys()) {
    if (!attr.startsWith('data-') && attr !== 'name' && attr !== 'role' && attr !== 'aria-label') continue;
    const value = attrs.get(attr) ?? '';
    if (value.length === 0 || value.length > 60) continue;
    const candidate = `${element.tag}[${attr}="${value.replace(/"/g, '')}"]`;
    if (unique(candidate, element)) return candidate;
  }

  const classes = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean);
  for (let take = 1; take <= Math.min(classes.length, 3); take += 1) {
    const candidate = `${element.tag}${classes.slice(0, take).map((c) => `.${c}`).join('')}`;
    if (unique(candidate, element)) return candidate;
  }

  // Positional, but anchored to the nearest named ancestor so the number is not measured from `<html>`.
  const index = siblingIndex(element, true);
  const self = () => `${element.tag}${classes.map((c) => `.${c}`).join('')}:nth-of-type(${index})`;
  let anchor: HtmlElement | null = element.parent;
  let guard = 0;
  while (anchor && anchor.tag !== '#root' && guard < 4) {
    guard += 1;
    const anchorAttrs = attributesOf(anchor);
    const anchorId = anchorAttrs.get('id');
    const anchorClasses = (anchorAttrs.get('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
    const anchorNameable = anchorId ? `#${anchorId}` : anchorClasses.length > 0 ? `${anchor.tag}${anchorClasses.map((c) => `.${c}`).join('')}` : null;
    if (anchorNameable) {
      const candidate = `${anchorNameable} ${self()}`;
      if (unique(candidate, element)) return candidate;
      const direct = `${anchorNameable} > ${self()}`;
      if (unique(direct, element)) return direct;
    }
    anchor = anchor.parent;
  }
  // Nothing named it: a positional chain from the body, which is a key that will break on a re-export.
  const chain: string[] = [];
  let node: HtmlElement | null = element;
  while (node && node.tag !== '#root' && chain.length < 6) {
    chain.unshift(`${node.tag}:nth-of-type(${siblingIndex(node, true)})`);
    node = node.parent;
  }
  const candidate = chain.join(' > ');
  return unique(candidate, element) ? candidate : null;
}

/**
 * The element that carries a photograph's credit, found rather than asked for.
 *
 * The design's own slot: the `<figcaption>` of the figure the image sits in, or a sibling whose class says
 * `credit`. **One rule, used by the inventory that offers the field and by the serve step that applies it**,
 * so the two cannot disagree about which line belongs to which photograph — and a row that names no credit
 * element still edits the one the current page has, rather than silently dropping the credit the owner typed.
 */
export function creditSelectorFor(html: string, element: HtmlElement): { key: string; text: string } | null {
  const figure = element.parent;
  if (!figure || figure.tag === '#root') return null;
  for (const sibling of figure.children) {
    if (sibling === element) continue;
    const siblingAttrs = attributesOf(sibling);
    if (sibling.tag !== 'figcaption' && !/credit/.test(siblingAttrs.get('class') ?? '')) continue;
    const candidate = selectorFor(html, sibling);
    if (candidate) return { key: candidate, text: textOf(html, sibling) };
  }
  return null;
}

/**
 * A human name for a place in the page, built from the design's own markup.
 *
 * The owner is choosing "the heading in the About sub-hero", not `section.sx-subhero h1`. Where the design
 * supplies words, the words are the best label there is; otherwise the classes are.
 */
function labelFor(html: string, element: HtmlElement): string {
  const text = textOf(html, element);
  const attrs = attributesOf(element);
  const classes = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  const where = `${element.tag}${classes ? `.${classes}` : ''}${attrs.get('id') ? `#${attrs.get('id')}` : ''}`;
  if (text.length === 0) return where;
  const shown = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  return `${shown} — ${where}`;
}

/**
 * How many of the deliverable's screens carry each of these places.
 *
 * THE ANSWER TO "IS THIS ONE EDIT OR FORTY?". The header and the footer are the same markup in every screen
 * file, so the wording in them is on fifty-two screens and no page-by-page editor can change it once. This
 * counts, from the FILES, the screens where each key names exactly one element — which is the same test the
 * serve step applies (`applyDesignOverrides` edits nothing when a key matches zero or two elements), so the
 * number is the reach of the edit rather than an estimate of it.
 *
 * It is measured on the deliverable and not on the served pages, and that is deliberate: the files are
 * byte-frozen so the count is stable and costs one pass, where 52 served pages are 52 database round trips on
 * the single process that also serves readers. A fill may add or remove an element on a screen, so the count
 * is what the design carries; the save path measures the screens the edit actually reached.
 */
export function selectorReach(screens: { name: string; html: string }[], keys: string[]): Map<string, { screen: string; text: string }[]> {
  const reached = new Map<string, { screen: string; text: string }[]>();
  for (const key of keys) reached.set(key, []);
  /* One parse per key, and a null parse is a key that names nothing anywhere — counted as zero, not skipped. */
  const steps = new Map(keys.map((key) => [key, parseSelector(splitTextKey(key).selector)]));
  for (const screen of screens) {
    const { elements } = scanCached(screen.html);
    for (const key of keys) {
      const parsed = steps.get(key);
      if (parsed === null || parsed === undefined) continue;
      let match: HtmlElement | null = null;
      let matches = 0;
      for (const element of elements) {
        if (matchesSelector(element, parsed)) {
          matches += 1;
          match = element;
          if (matches > 1) break;
        }
      }
      if (matches !== 1 || !match) continue;
      /*
       * THE WORDS THERE NOW ARE PART OF THE MEASUREMENT, NOT DECORATION.
       *
       * The same selector names the same PLACE on every screen, and the place does not always hold the same
       * words: `a.wordmark span:nth-of-type(1)` is "History & Archive" on 35 screens and "Watch" on `/watch/`.
       * An editor that reported only the first number would offer a button saying "change everywhere it
       * appears" and quietly rewrite a different sentence on the screens where it differed. **Saying how many
       * screens carry exactly this wording is the difference between a count and a claim.**
       */
      const { attr } = splitTextKey(key);
      const text = attr ? (attributesOf(match).get(attr) ?? '') : textOf(screen.html, match);
      reached.get(key)!.push({ screen: screen.name, text });
    }
  }
  return reached;
}

/**
 * Everything on a screen the owner may edit, with the page's current value for each.
 *
 * Run against the SERVED page (after the fills), because that is the document an override will be applied
 * to. `/donate/`'s notice does not exist in the design file at all — `fillDonate` writes it — so an
 * inventory built from the file would offer the owner a button the same fill has already deleted. **The
 * list is therefore of what is actually on the page**, which is also why a screen whose fill removed
 * something simply does not offer it, and says so by omission rather than by pretending.
 *
 * `offset` exists because the list is longer than any one page of it. `/about/` holds 370 places and the
 * editor draws 150, so without an offset the other 220 were described as "still editable through the same
 * route" while no route offered them. **A limit that cannot be walked past is not a limit, it is a wall.**
 */
export function designInventory(
  html: string,
  limit: number = INVENTORY_LIMIT,
  offset: number = 0
): { items: InventoryItem[]; total: number } {
  const { elements } = scanCached(html);
  const items: InventoryItem[] = [];
  const taken = new Set<string>();
  let total = 0;

  for (const element of elements) {
    if (NEVER_HIDDEN.has(element.tag)) continue;
    const attrs = attributesOf(element);
    if (attrs.has('hidden')) continue;
    const key = selectorFor(html, element);
    if (!key || taken.has(key)) continue;
    const classes = (attrs.get('class') ?? '').split(/\s+/).filter(Boolean);

    const isImage = element.tag === 'img' && attrs.has('src');
    const isLink = element.tag === 'a' && attrs.has('href');
    const text = textOf(html, element);
    /*
     * A TEXT-BEARING TAG IS OFFERED EVEN WHEN IT HAS MARKUP INSIDE IT — the decision about whether its text
     * may be replaced is made below, where what is inside it can be named. A tag that is only a container is
     * offered when it is a block with a name, because that is what the owner would point at to hide it.
     *
     * AND AN ELEMENT WITH NO TEXT OF ITS OWN IS STILL OFFERED WHEN IT HOLDS WORDS IN AN ATTRIBUTE. `<input>`
     * is not a text tag and never will be — it has no content — yet its `placeholder` is a sentence a reader
     * reads, so the places are collected BEFORE the decision about whether this element belongs in the list.
     */
    const hideEligible = classes.length > 0 || attrs.has('id');
    const places = isImage
      ? { places: [] as TextPlace[], reason: undefined as string | undefined }
      : textPlacesOf(html, element, key);
    if (!isImage && !isLink && places.places.length === 0 && !(hideEligible && BLOCK_TAGS.has(element.tag))) continue;

    total += 1;
    if (total <= offset) continue;
    if (items.length >= limit) continue;

    const item: InventoryItem = {
      key,
      tag: element.tag,
      label: labelFor(html, element),
      text,
      can: {
        text: places.places.length > 0,
        /*
         * A BLOCK, AND NOT EVERY ELEMENT WITH A CLASS. Hiding a `<span>` that is part of a sentence is not
         * "hiding a block without deleting it" — it is a hole inside a line — so the offer is limited to the
         * container vocabulary a reader would point at, and to the text elements that carry a class.
         */
        hide: !TEXT_ONLY.has(element.tag) && hideEligible && (BLOCK_TAGS.has(element.tag) || TEXT_TAGS.has(element.tag)),
        image: isImage,
        link: isLink,
      },
    };
    if (item.can.text) item.places = places.places;
    if (places.reason) item.textReason = places.reason;

    if (isImage) {
      item.text = attrs.get('alt') ?? '';
      item.src = attrs.get('src') ?? '';
      item.alt = attrs.get('alt') ?? '';
      const credit = creditSelectorFor(html, element);
      if (credit) {
        item.creditKey = credit.key;
        item.credit = credit.text;
      }
    }
    if (isLink) item.href = attrs.get('href') ?? '';
    items.push(item);
    taken.add(key);
  }
  return { items, total };
}

/* ================================================================================================
 * 7. THE VALUE CHECK — ONE DECLARATION, AND NOTHING ELSE
 * ============================================================================================== */

export const TOKEN_NAME_RE = /^--[a-z0-9-]+$/;

/**
 * Refuse anything that could end the declaration it is put in.
 *
 * The value is written into a `:root { --name: VALUE; }` block, so a value containing `;` or `}` is not a
 * bad colour — it is a second declaration, or a rule for every element on the page. This is checked when a
 * value is SAVED and again when it is SERVED, because a validation that exists in one place is a validation
 * that a second write path will not have.
 */
export function checkOverrideValue(
  kind: DesignOverrideKind,
  key: string,
  value: DesignOverrideValue,
  /**
   * What kind of value the DESIGN declares for this token, when the caller knows.
   *
   * The save path reads `tokens.css` and passes it, so a colour token must be given a colour. The serve path
   * does not have the stylesheet in hand and passes nothing, which is deliberate: a row that was written
   * before this check existed must still be served, and the security-relevant test — that the value cannot
   * end the declaration it lands in — does not need to know what kind of value it is.
   */
  expected?: DesignTokenClass
): string | null {
  const reject = (text: string): string | null => text;
  const risky = (text: string): boolean => /[;{}<>]|\/\*|\*\/|[\r\n]/.test(text);

  if (kind === 'token') {
    if (!TOKEN_NAME_RE.test(key)) return reject(`“${key}” is not a custom-property name.`);
    const raw = (value.value ?? '').trim();
    if (raw.length === 0) return reject('A token needs a value.');
    if (raw.length > 300) return reject('That value is longer than any declaration the design holds.');
    if (risky(raw)) return reject('A value may not contain “;”, “{”, “}”, “<”, “>” or a newline.');
    /*
     * AND IT MUST BE THE KIND OF VALUE THE TOKEN HOLDS.
     *
     * Found by setting `--accent` to a mistyped value through this very API: `%230b3d6b` was accepted, served,
     * declared in the stylesheet — and meant nothing, because an unparseable colour is a declaration the
     * browser drops. **The verification said "the stylesheet now declares it", which was true and useless**:
     * the page was unchanged and only looking at it would have told anyone. A colour token now has to carry a
     * colour, and a length has to carry a length.
     */
    if (expected === 'colour' && parseColour(raw) === null) {
      return reject(`“${raw}” is not a colour a browser will paint. Use #rrggbb, or rgb(…) / hsl(…).`);
    }
    if (expected === 'length' && raw !== '0' && !/^-?\d*\.?\d+(rem|px|em|%|ch|vw|vh)$/i.test(raw)) {
      return reject(`“${raw}” is not a length. Use a number with rem, px, em, %, ch, vw or vh.`);
    }
    if (expected === 'number' && !/^-?\d*\.?\d+$/.test(raw)) {
      return reject(`“${raw}” is not a number.`);
    }
    return null;
  }

  if (kind === 'text') {
    if ((value.text ?? '').length > 2000) return reject('That is longer than 2,000 characters. A heading or a note, not an essay.');
    /*
     * A KEY MAY NAME AN ATTRIBUTE, AND ONLY ONE OF THE TWO A READER READS. The stored value is written into
     * an attribute of the element the selector names, so an attribute this editor does not offer — `href`,
     * `onclick`, `style` — would be a way to write markup and behaviour through the text field.
     */
    const attribute = splitTextKey(key).attr;
    if (attribute !== null && !TEXT_ATTRIBUTES.includes(attribute)) {
      return reject(`“${attribute}” is not an attribute a reader reads as text.`);
    }
    return null;
  }
  if (kind === 'hide') return null;
  if (kind === 'image') {
    const src = (value.src ?? '').trim();
    if (src.length > 0 && risky(src)) return reject('An image address may not contain “;”, “{”, “}”, “<”, “>” or a newline.');
    if ((value.alt ?? '').length > 500) return reject('Alternative text should describe the image, not accompany it at length.');
    if ((value.credit ?? '').length > 500) return reject('A credit line should be short.');
    return null;
  }
  if (kind === 'link') {
    const href = (value.href ?? '').trim();
    if (href.length === 0 && (value.label ?? '').trim().length === 0) return reject('A link needs a destination or a label.');
    /*
     * A STORED ADDRESS IS A NAVIGATION INSTRUCTION, so only the two shapes a link on this site may take are
     * accepted: an absolute http(s) address, a mailto, or a path that starts with `/`. `javascript:` in a
     * stored href would be a script the owner could be tricked into saving, and it is refused here rather
     * than at the browser.
     */
    if (href.length > 0 && !/^(https?:\/\/|mailto:|\/)/i.test(href)) {
      return reject('An address must be a full http(s) or mailto address, or a path beginning with “/”.');
    }
    if (risky(href)) return reject('That address contains a character a link cannot carry.');
    if ((value.label ?? '').length > 300) return reject('A link label longer than 300 characters is not a label.');
    return null;
  }
  return reject('Unknown kind.');
}

/* ================================================================================================
 * 8. THE THEME — THE TOKEN OVERRIDES, AS CSS
 * ============================================================================================== */

/**
 * The `:root` block for a set of token overrides.
 *
 * ORDER FOLLOWS THE DESIGN'S OWN ORDER, which is why the caller passes the catalogue: the aliases
 * (`--bg: var(--paper)`) are declared AFTER the base tokens in `tokens.css`, and an override must land in
 * the same relative position or an alias override would be undone by the base token it follows. A
 * declaration for a token the design no longer holds is still emitted — silently dropping it would make the
 * owner's saved edit disappear with nothing said.
 */
export function themeCss(overrides: DesignOverride[], order: string[] = []): string {
  const wanted = new Map<string, string>();
  for (const override of overrides) {
    if (override.kind !== 'token') continue;
    if (checkOverrideValue('token', override.key, override.value) !== null) continue;
    wanted.set(override.key, (override.value.value ?? '').trim());
  }
  if (wanted.size === 0) return '';

  const position = new Map(order.map((name, index) => [`--${name}`, index]));
  const keys = [...wanted.keys()].sort((a, b) => (position.get(a) ?? 9999) - (position.get(b) ?? 9999));
  const lines = keys.map((key) => `  ${key}: ${wanted.get(key)};`);
  return `/* Ozikoro design overrides — set in /admin/design/, applied over the deliverable. */\n:root {\n${lines.join('\n')}\n}\n`;
}

/* ================================================================================================
 * 9. APPLYING THE ELEMENT OVERRIDES
 * ============================================================================================== */

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Edit { start: number; end: number; replacement: string }

/** Replace, add or leave an attribute on one open tag. Returns null when nothing changed. */
function setAttribute(openTag: string, name: string, value: string | null): string {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  if (value === null) return openTag.replace(pattern, '');
  if (pattern.test(openTag)) return openTag.replace(pattern, `$1"${escapeAttr(value)}"`);
  return openTag.replace(/\s*\/?>$/, (tail) => ` ${name}="${escapeAttr(value)}"${tail}`);
}

export interface ApplyOptions {
  /**
   * Emit token overrides as an inline `:root` block before `</head>`.
   *
   * FALSE FOR A SERVED PAGE: stored tokens are delivered by `/design-theme.css` — one stylesheet every
   * screen of both design routes links — so that a colour change reaches the article pages too, and an
   * inline block as well would be the same declarations in two places. TRUE FOR THE PREVIEW, where the
   * pending value exists nowhere else and must not be written to the database to be seen.
   */
  inlineTokens?: boolean;
  /** The catalogue's own order, so an inline block declares aliases after the tokens they read. */
  tokenOrder?: string[];
}

/**
 * Apply the element overrides — text, images, links and visibility — to a served design page.
 *
 * THE FILLS HAVE ALREADY RUN BY THE TIME THIS IS CALLED. That is the whole ordering rule: an override that
 * ran before the fills would be overwritten by the very pass that rewrites a heading's words, and the owner
 * would watch a save land in the database and change nothing on the page.
 *
 * Every edit is measured against the ORIGINAL string and applied from the end, so an element's byte offsets
 * cannot be invalidated by an earlier edit. A hidden ancestor wins over anything inside it: editing text
 * inside a block the owner has already hidden would produce output nobody can see and a row that looks
 * broken.
 */
export function applyDesignOverrides(html: string, overrides: DesignOverride[], options: ApplyOptions = {}): string {
  const elements = overrides.filter((o) => o.kind !== 'token');
  const tokens = overrides.filter((o) => o.kind === 'token');

  let out = html;
  if (options.inlineTokens && tokens.length > 0) {
    const css = themeCss(tokens, options.tokenOrder ?? []);
    if (css.length > 0) {
      const style = `<style data-ozikoro-theme>${css}</style>`;
      out = out.includes('</head>') ? out.replace('</head>', `${style}\n</head>`) : `${style}\n${out}`;
    }
  }
  if (elements.length === 0) return out;

  const { elements: nodes } = scanElements(out);
  const edits: Edit[] = [];

  /* Later rows win, so a preview value beats the stored one it is previewing. */
  const byKey = new Map<string, DesignOverride>();
  for (const override of elements) byKey.set(`${override.kind}\u0000${override.key}`, override);
  const ordered = [...byKey.values()].sort((a, b) => (a.kind === 'hide' ? 1 : 0) - (b.kind === 'hide' ? 1 : 0));

  for (const override of ordered) {
    if (checkOverrideValue(override.kind, override.key, override.value) !== null) continue;
    /* A text key may name an attribute rather than the element's content; the selector is the same either way. */
    const { selector, attr } = splitTextKey(override.key);
    const steps = parseSelector(selector);
    if (!steps) continue;
    const matches = nodes.filter((node) => matchesSelector(node, steps));
    /* ONE KEY, ONE ELEMENT. A key that matches two elements is a key that edits something the owner did not
     * point at, so it edits nothing and the serve step says so in the log. */
    if (matches.length !== 1) {
      if (matches.length > 1) console.error(`design override: ${override.key} matches ${matches.length} elements; skipped`);
      continue;
    }
    const element = matches[0]!;

    if (override.kind === 'hide') {
      edits.push({ start: element.start, end: element.end, replacement: '<!-- hidden by a design override -->' });
      continue;
    }
    if (override.kind === 'text') {
      /*
       * AN ATTRIBUTE IS NOT THE ELEMENT'S CONTENT. `placeholder` and a button's `value` are words a reader
       * reads and are not inside the element, so a content edit keyed to the same element would replace the
       * wrong thing — which is why the key says which of the two it means.
       */
      if (attr) {
        const openTag = setAttribute(out.slice(element.start, element.openEnd), attr, override.value.text ?? '');
        edits.push({ start: element.start, end: element.openEnd, replacement: openTag });
        continue;
      }
      if (element.closeStart === -1) continue;
      edits.push({ start: element.openEnd, end: element.closeStart, replacement: escapeText(override.value.text ?? '') });
      continue;
    }
    if (override.kind === 'image') {
      let openTag = out.slice(element.start, element.openEnd);
      if (typeof override.value.src === 'string' && override.value.src.trim().length > 0) {
        openTag = setAttribute(openTag, 'src', override.value.src.trim());
      }
      if (typeof override.value.alt === 'string') openTag = setAttribute(openTag, 'alt', override.value.alt);
      edits.push({ start: element.start, end: element.openEnd, replacement: openTag });
      /*
       * THE CREDIT FOLLOWS THE PHOTOGRAPH. The row carries the credit element the editor found, and when it
       * does not — a row written before the design had a caption, or a caption added since — the same finder
       * the editor uses is asked again rather than the credit being dropped with nothing said.
       */
      if (typeof override.value.credit === 'string' && override.value.credit.length > 0) {
        const creditKey = override.value.creditKey ?? creditSelectorFor(out, element)?.key;
        const creditSteps = creditKey ? parseSelector(creditKey) : null;
        const creditNode = creditSteps ? nodes.filter((node) => matchesSelector(node, creditSteps)) : [];
        if (creditNode.length === 1 && creditNode[0]!.closeStart !== -1) {
          edits.push({
            start: creditNode[0]!.openEnd,
            end: creditNode[0]!.closeStart,
            replacement: escapeText(override.value.credit),
          });
        } else {
          console.error(
            `design override: the image ${override.key} has a credit but no single element to put it in` +
              `${creditKey ? ` (${creditKey})` : ''}; the credit was not applied`
          );
        }
      }
      continue;
    }
    if (override.kind === 'link') {
      let openTag = out.slice(element.start, element.openEnd);
      const href = (override.value.href ?? '').trim();
      if (href.length > 0) openTag = setAttribute(openTag, 'href', href);
      edits.push({ start: element.start, end: element.openEnd, replacement: openTag });
      if (typeof override.value.label === 'string' && element.closeStart !== -1) {
        edits.push({ start: element.openEnd, end: element.closeStart, replacement: escapeText(override.value.label) });
      }
    }
  }

  if (edits.length === 0) return out;

  /* Drop an edit that sits inside a hidden block, then apply from the end so no earlier edit moves a range. */
  const hidden = edits.filter((e) => e.replacement.startsWith('<!-- hidden'));
  const keep = edits.filter((edit) => !hidden.some((h) => edit !== h && edit.start >= h.start && edit.end <= h.end));
  keep.sort((a, b) => b.start - a.start);
  for (const edit of keep) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}

/**
 * Does this override change the served page at all?
 *
 * WHY A SAVE ASKS THIS
 *
 * The owner's exact failure mode is a saved edit that is stored, served, applied and invisible, because the
 * selector matched nothing once the fills had run. The save path fetches the page it has just changed and
 * compares, so the answer the owner gets is measured rather than assumed — and the log line names the key
 * so a stale one can be found without a browser.
 */
export function overrideChangedPage(before: string, after: string): boolean {
  return before !== after;
}

/* ================================================================================================
 * 10. THE PREVIEW — A PENDING VALUE IN A URL, WHICH IS NEVER WRITTEN DOWN
 * ============================================================================================== */

/**
 * A pending override, carried in a query parameter.
 *
 * WHY A URL AND NOT A DRAFT TABLE
 *
 * A preview is a value the owner is CONSIDERING. Storing it would make every colour he hovered over a row in
 * the record, with an actor and a timestamp, and the point of the table is that one row is one decision made.
 * A URL parameter is discarded by closing the tab, and it reaches the page through the same
 * `applyDesignOverrides` the stored values go through — so what he sees is what he will get rather than an
 * approximation drawn by a second renderer. **It is honoured only for an account holding `manage_design`**,
 * because otherwise a shared link would let anyone restyle the site for whoever opened it.
 */
export function encodeDesignPreview(overrides: DesignOverride[]): string {
  const payload = overrides.map(({ screen, kind, key, value }) => ({ screen, kind, key, value }));
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * The pending overrides in a URL, with every field checked again.
 *
 * A parameter is attacker-reachable, so nothing here is trusted: an unknown kind, a key that is not a
 * custom-property name or a valid selector, or a value that could end the declaration it lands in is dropped
 * rather than rendered. **A preview that could inject a rule would be a way to make the site look like
 * something it is not, for whoever opened the link.**
 */
export function decodeDesignPreview(raw: string | null | undefined): DesignOverride[] {
  if (!raw || raw.length > 8000) return [];
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed)) return [];
    const out: DesignOverride[] = [];
    for (const row of parsed) {
      if (row === null || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const kind = record.kind;
      if (kind !== 'token' && kind !== 'text' && kind !== 'image' && kind !== 'link' && kind !== 'hide') continue;
      if (typeof record.key !== 'string' || record.key.length === 0 || record.key.length > 400) continue;
      if (kind !== 'token' && parseSelector(splitTextKey(record.key).selector) === null) continue;
      const value: DesignOverrideValue =
        record.value !== null && typeof record.value === 'object' ? (record.value as DesignOverrideValue) : {};
      if (checkOverrideValue(kind, record.key, value) !== null) continue;
      out.push({
        screen: typeof record.screen === 'string' ? record.screen.slice(0, 80) : ALL_SCREENS,
        kind,
        key: record.key,
        value,
      });
    }
    return out;
  } catch {
    return [];
  }
}
