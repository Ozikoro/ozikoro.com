/**
 * The design EDITOR's own logic: what control a token gets, and what a stored value must survive.
 *
 * ── WHY THIS IS NOT IN THE PAGE ──────────────────────────────────────────────────────────────────────
 *
 * The owner's report is that `/admin/design/` *"everything is just showing in one page, instead of having
 * selection to change colours, fonts, texts, logo, favicon"*, and the first draft of the answer was markup:
 * a fieldset per group and an `<input type="color">` per swatch, written inline in a React server component.
 * **That is untestable, and the faults it would produce are exactly the silent ones** — a gradient handed to
 * a colour picker, a font offered that the page cannot render, a value rewritten into something the owner
 * did not type. None of those shows up in a screenshot of the editor.
 *
 * So the decision — *which control does this token get, and can the value be expressed in it* — is a pure
 * function here, over the same `DesignToken[]` the page already builds, and `design-editor.test.ts` asserts
 * it against the deliverable's own `tokens.css`. The page renders whatever this returns.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO KEEP ────────────────────────────────────────────────────────────
 *
 * **A CONTROL MAY NOT REWRITE A VALUE IT CANNOT EXPRESS.**
 *
 * `<input type="color">` holds `#rrggbb` and nothing else. `--gradient-gold` is a `linear-gradient(…)` and
 * `--shadow-lift` is a shadow, and the screen that existed before this file put BOTH of them beside a colour
 * picker — its own filter was `['colour', 'gradient'].includes(effectiveClass(t))` — and then relied on the
 * owner typing into a text box instead. **The picker was always there, and pressing Save with it untouched
 * posted `#000000` over the gradient.** That is the fault this module removes, and it is removed by asking
 * the VALUE rather than by asking the token's name.
 */
import {
  CONTRAST_PAIRS,
  type DesignOverride,
  type DesignToken,
  type DesignTokenClass,
  type InventoryItem,
} from './design-override.ts';

/* ================================================================================================
 * 1. WHICH CONTROL A TOKEN GETS
 * ============================================================================================== */

/**
 * The controls a token can honestly be edited with.
 *
 *   colour  a native colour picker AND a text box, because the picker cannot hold `rgba()` and the box can
 *   text    a text box: a gradient, a `color-mix()`, a shadow, an alias — anything the picker would replace
 *   length  a text box with the length grammar (`0.75rem`, `4px`, `68ch`), which the save path enforces
 *   number  a number, for a unitless token such as a line-height or a count
 *   font    a chooser of the families the page actually loads, PLUS the text box for a stack of one's own
 */
export type TokenControlKind = 'colour' | 'text' | 'length' | 'number' | 'font';

export interface TokenControl {
  /** The token's name without its leading `--`. */
  token: string;
  /** The stored key: `--name`, which is the form every row in the table already uses. */
  key: string;
  /** The class the DESIGN declares, which is what the save path holds a new value against. */
  declaredClass: DesignTokenClass;
  /** The class at the end of any `var(--x)` chain — used ONLY to say what the value means. */
  effectiveClass: DesignTokenClass;
  control: TokenControlKind;
  /**
   * The value a colour picker is seeded with, or null.
   *
   * NON-NULL ONLY FOR A PLAIN COLOUR, and it is the value the picker is seeded with. When it is null no
   * picker is drawn at all, rather than a picker seeded with black.
   */
  pickerValue: string | null;
  /**
   * The value in force, normalised into the form this editor writes back.
   *
   * For a plain colour that is the lowercase six-digit hex — so pressing Save on an untouched swatch is a
   * no-op rather than a change nobody asked for. For everything else it is the value exactly as it stands.
   */
  normalised: string;
  /** The value the DESIGN declares, shown beside the field so a reset has something to go back to. */
  designValue: string;
  /** Whether an override is in force for this token. */
  overridden: boolean;
  /** A sentence about what the control can and cannot express here, or null when there is nothing to say. */
  caveat: string | null;
  /** How many rules in the design's stylesheets read this token. */
  uses: number;
  group: string;
  role: 'decoration' | 'meaning';
  note: string | null;
}

/**
 * `#abc` and `#AABBCC` → `#aabbcc`; anything else unchanged.
 *
 * WHY NORMALISE AT ALL: the colour input is seeded with this string and posts `#rrggbb` back. If the design
 * declares `#FFF` and the picker posts `#ffffff`, pressing Save on a swatch the owner never touched writes a
 * row — an edit nobody made, in the audit trail, with his name on it. Lowercasing and expanding makes the
 * untouched round trip a no-op in the two forms the picker itself can produce.
 */
export function normaliseColour(value: string): string {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return v;
}

/**
 * The value a colour picker can hold, or null when it cannot hold this one.
 *
 * THE TEST IS THE VALUE, NOT THE CLASS. `parseColour` already answers "can a browser read a colour out of
 * this string", but a colour input is stricter than a browser: it holds `#rrggbb` and gives `#rrggbb` back,
 * so a value is only offered to the picker when **the picker can give back exactly what it was given**.
 * `rgba(13, 92, 69, 0.5)` is a colour and a picker would drop its alpha; `rebeccapurple` is a colour and a
 * picker would rewrite it as a hex. Both keep the text box.
 *
 * The accepted form is therefore enumerated rather than guessed: the six-digit hex, which is the only one
 * an `<input type="color">` round-trips, and nothing else. Four- and eight-digit hexes carry alpha and are
 * refused for the same reason `rgba()` is.
 */
export function pickerHolds(value: string): string | null {
  const v = normaliseColour(value);
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

/**
 * The class at the end of a `var(--x)` chain — what the value MEANS, which is what a reader is choosing.
 *
 * A cycle returns the class it reached rather than looping, for the same reason `resolveToken` returns null:
 * a stylesheet with a cycle in it is a fault to report, not a page to hang.
 */
export function effectiveClassOf(token: DesignToken, byName: Map<string, DesignToken>): DesignTokenClass {
  let current = token;
  const seen = new Set<string>([token.name]);
  while (current.tokenClass === 'alias') {
    const next = byName.get(current.references[0] ?? '');
    if (!next || seen.has(next.name)) break;
    seen.add(next.name);
    current = next;
  }
  return current.tokenClass;
}

/** `--font-serif` and friends: the tokens whose value is a font stack. */
export function isFontToken(text: string): boolean {
  const t = text.trim();
  return /^(["']?.+["']?,\s*(serif|sans-serif|monospace|system-ui))/i.test(t) || /^["']/.test(t);
}

/** The families named in a font stack, primary first. Generic families are not names. */
export function fontFamilies(stack: string): string[] {
  return stack
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, '').trim())
    .filter((part) => part.length > 0 && !/^(serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-\w+)$/i.test(part));
}

/**
 * The families the design's OWN Google Fonts request asks for.
 *
 * ── WHY THIS IS A CONSTANT HERE AND NOT READ FROM THE HEAD ────────────────────────────────────────────
 *
 * The owner's second-fault brief: *"a font picker that offers fonts the page cannot render … offer only what
 * the design actually loads, and say what a change costs."* The request the pages make is written twice in
 * the repository — `seoHead`'s `fonts.googleapis.com` link and the same link in the design's own screens —
 * and it cannot be read out of the deliverable because it is in `public/design/`, which is byte-frozen but
 * still a file tree this module would have to be told about.
 *
 * So the list is **asserted against the pages rather than remembered**: `design-editor.test.ts` reads every
 * `fonts.googleapis.com/css2` link out of `packages/ozikoro/src/seo-head.ts` and the design's screens, and
 * fails if any of them asks for a family that is not here, or if this list holds one none of them asks for.
 * A list that is checked against the source can be a constant; a list that is merely written down cannot.
 */
export const LOADED_FONT_FAMILIES: readonly string[] = ['Noto Serif', 'Noto Sans', 'Noto Sans Mono'];

export interface FontOption {
  /** The family as Google Fonts names it, e.g. `Noto Sans Mono`. */
  family: string;
  /** The whole declaration the owner's choice writes, e.g. `"Noto Sans Mono", ui-monospace, …`. */
  stack: string;
  /** The token this stack was read from, so the option is provably a stack the design already declares. */
  fromToken: string;
  loaded: boolean;
}

/**
 * A font choice, as `fontOptions` returns it. Aliased so the page's props do not reach into the package's
 * shape by inference — a change here that broke the chooser should be a typecheck failure at the call site.
 */
export type FontChoice = FontOption;

/**
 * Every choice the font picker may offer, and each one is a stack the design itself already declares.
 *
 * ONE STACK PER OPTION, READ FROM THE TOKEN THAT ALREADY USES IT. `--font-sans` is
 * `"Noto Sans", "Charis SIL", system-ui, sans-serif`; choosing "Noto Sans" writes back **that exact
 * declaration**, so no option can be a stack the design has never seen. The alternative — composing
 * `"${family}", serif` from the chosen name — invents a fallback chain, and a chain that drops `"Charis SIL"`
 * is a chain that renders an Igbo page differently on a machine where Noto is blocked.
 */
export function fontOptions(tokens: DesignToken[]): FontOption[] {
  const loaded = new Set(LOADED_FONT_FAMILIES.map((name) => name.toLowerCase()));
  const options: FontOption[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!isFontToken(token.value)) continue;
    const primary = fontFamilies(token.value)[0];
    if (!primary) continue;
    const key = primary.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ family: primary, stack: token.value, fromToken: token.name, loaded: loaded.has(key) });
  }
  return options;
}

/**
 * What control each token gets, with the value in force and the sentence about what the control costs.
 *
 * `values` maps a token name to the value in force: the owner's override when there is one, otherwise the
 * design's declaration with the application's own `a11y.css` corrections laid over it. The page builds that
 * map, because the page is the only place that knows both, and it passes the overrides in so this function
 * can seed an untouched control with the value that is actually painting rather than with the design's.
 */
export function tokenControls(
  tokens: DesignToken[],
  values: Map<string, string>,
  overridden: ReadonlySet<string> = new Set()
): TokenControl[] {
  const byName = new Map(tokens.map((token) => [token.name, token]));
  return tokens.map((token) => {
    const raw = values.get(token.name) ?? token.value;
    const declaredClass = token.tokenClass;
    const effectiveClass = effectiveClassOf(token, byName);

    let control: TokenControlKind;
    if (isFontToken(raw)) control = 'font';
    else if (declaredClass === 'colour') control = 'colour';
    else if (declaredClass === 'length') control = 'length';
    else if (declaredClass === 'number') control = 'number';
    else control = 'text';

    /*
     * THE PICKER IS ONLY DRAWN WHERE IT CANNOT LIE. A colour token holding `rgba(…)` or an eight-digit hex
     * falls back to the text box and says why, rather than being handed a control that would drop its alpha
     * on the first Save.
     */
    const candidate = control === 'colour' ? pickerHolds(raw) : null;
    if (control === 'colour' && candidate === null) control = 'text';
    const pickerValue = control === 'colour' ? candidate : null;
    const normalised = control === 'colour' ? normaliseColour(raw) : raw.trim();

    let caveat: string | null = null;
    if (declaredClass === 'alias') {
      caveat =
        'This token is an alias: its value is a reference such as var(--paper), not a colour. Editing it ' +
        'replaces that reference, which is a different act from changing the colour it points at.';
    } else if (control === 'text' && effectiveClass === 'colour') {
      caveat =
        'The design declares this as a colour, but not as a plain one — a colour picker holds #rrggbb and ' +
        'would replace this with black. Type the value instead; it is kept exactly as you write it.';
    } else if (effectiveClass === 'gradient') {
      caveat = 'A gradient is a function rather than a colour, so it is edited as text.';
    } else if (effectiveClass === 'shadow') {
      caveat = 'A shadow is a list of offsets and a colour, so it is edited as text.';
    }

    return {
      token: token.name,
      key: `--${token.name}`,
      declaredClass,
      effectiveClass,
      control,
      pickerValue,
      normalised,
      designValue: token.value,
      overridden: overridden.has(token.name),
      caveat,
      uses: token.uses,
      group: token.group,
      role: token.role,
      note: token.note,
    };
  });
}

/**
 * The key a token control is stored under.
 *
 * **THE KEY NAMES THE TOKEN, AND THAT IS DELIBERATE RATHER THAN LAZY.** The obvious "more stable" design is
 * to key the semantic roles by ROLE — `role:background` rather than `--bg` — so that a re-export which
 * renames `--bg` lets the owner's edit follow the role. It is not done, and the reason is that the table
 * currently holds `--bg`, `--link` and `--text` rows: introducing role keys means every existing row has to
 * be migrated in the same change, and a migration that is not written is a set of edits that silently stop
 * applying. **The role of each stable token is written under the control instead, on the screen**, so an
 * owner reading the editor can see that "Background" is `--bg` — which is the information the role key was
 * for, without a data migration to get it wrong.
 */
export function controlKey(token: DesignToken): string {
  return `--${token.name}`;
}

/* ================================================================================================
 * 2. WHAT REACHES A PAGE, SO THE EDITOR CAN SAY WHERE EACH KIND LANDS
 * ============================================================================================== */

/**
 * The section an override belongs to, which is the editor's own vocabulary and not the database's `kind`.
 *
 * THE OWNER'S COMPLAINT IS THE REASON THIS EXISTS. *"everything is just showing in one page, instead of
 * having selection to change colours, fonts, texts, logo, favicon, etc."* An editor that offers the five
 * KINDS is an editor that asks the owner to know that a colour is a `token` and that an icon is not stored
 * at all. The sections below are named for what a person is trying to change.
 */
export type EditorSection = 'colours' | 'type' | 'texts' | 'images' | 'links';

export const EDITOR_SECTIONS: readonly EditorSection[] = ['colours', 'type', 'texts', 'images', 'links'];

/** Where a stored override appears in the editor's own sections. */
export function sectionOf(override: DesignOverride): EditorSection {
  if (override.kind === 'token') return isFontToken(override.value.value ?? '') ? 'type' : 'colours';
  if (override.kind === 'image') return 'images';
  if (override.kind === 'link') return 'links';
  if (override.kind === 'hide') return 'texts';
  /*
   * A TEXT OVERRIDE THAT REPLACES A LINK'S LABEL BELONGS WITH THE LINKS.
   *
   * This is the one place a stored kind and a section disagree, and it is deliberate: `kind: 'text'` on an
   * `<a>`'s own label is what "change what this link says" writes, so an owner looking for it under "Text on
   * the page" would not find the sentence he just changed. The selector's tag is the evidence.
   */
  if (/^\s*a[.#:\[]/.test(override.key) || /^\s*a\s/.test(override.key)) return 'links';
  return 'texts';
}

/**
 * The contrast pairs a token appears in, so a failing ratio is printed on the rule it is about.
 *
 * Read from `CONTRAST_PAIRS` rather than written out, because that table is the design's own statement of
 * which colours sit on which — a second list here would be a second answer to the same question.
 */
export function contrastPairsFor(token: string): typeof CONTRAST_PAIRS {
  return CONTRAST_PAIRS.filter((pair) => pair.fg === token || pair.bg === token);
}

/* ================================================================================================
 * 3. THE LOGO, WHICH IS AN IMAGE OVERRIDE ON THE MASTHEAD'S OWN SLOT
 * ============================================================================================== */

/**
 * The masthead's logo slot, found in the served page's inventory rather than hard-coded.
 *
 * ── HOW IT IS MADE ADDRESSABLE, WHICH IS THE QUESTION THE BRIEF ASKS ──────────────────────────────────
 *
 * The design draws the wordmark as `<a class="wordmark" href="home.html">`, and **on one of the 53 screens it
 * carries an `<img>`**: `home.html` has
 *
 *     <img src="https://ozikoro.com/wp-content/uploads/2024/08/cropped-Ozi-Ikoro-Icon-Yellow-1-80x80.png" alt="">
 *
 * inside it. Every other screen draws the mark as the word `Ozikoro` in `<b>`, with no image at all.
 *
 * So the logo is made addressable exactly the way every other photograph on the page is: `selectorFor` gives
 * that `<img>` a unique selector — measured on the served home page, `a.wordmark img` — and an `image`
 * override keyed to it already changes the masthead logo, already goes through the audit, and already has a
 * reset in the Undo list. **No second mechanism is invented for one element.**
 *
 * THIS FUNCTION IS WHAT TURNS IT INTO A FIRST-CLASS CONTROL. It is given the served page's own inventory and
 * answers "which of these is the masthead's mark", so the editor draws it as *Masthead logo* with a URL field
 * and a preview instead of as one row among 370. It prefers the design's own names for the slot —
 * `wordmark`, `masthead`, `brand`, `site-logo` — and returns null rather than guessing, because a wrong guess
 * here edits a different photograph.
 *
 * IT READS THE PAGE IT IS TOLD ABOUT, AND NOT ANOTHER. The logo is only present on the screen being
 * previewed, so the section says which screen the control will change. A control that claimed to be
 * site-wide and wrote a row that nine screens out of ten cannot apply would be the same fault in the
 * toolbar that this whole feature exists to remove from the page.
 */
export interface LogoCandidate {
  /** The selector the image override is stored under. */
  key: string;
  /** What the page has there now, so the URL field has a baseline to show. */
  src: string;
  alt: string;
  /** What the owner calls it. */
  label: string;
}

export function logoSlotIn(items: InventoryItem[]): LogoCandidate | null {
  const chosen = items.find((item) => item.can.image && /wordmark|masthead|brand|site-logo/i.test(item.key));
  if (!chosen) return null;
  return { key: chosen.key, src: chosen.src ?? '', alt: chosen.alt ?? '', label: 'Masthead logo' };
}
