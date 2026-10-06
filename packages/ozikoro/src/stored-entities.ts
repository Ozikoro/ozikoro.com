/**
 * The HTML entities the WordPress import stored as literal text, decoded back to characters.
 *
 * ── WHAT THIS IS FOR, AND WHY IT IS NOT AN escaper ───────────────────────────────────────────────────
 *
 * The archive arrived from WordPress, which writes some fields entity-encoded. **A title that a person
 * typed as `Ojeh & Arishi` is stored as `Ojeh &#038; Arishi`** — the entity is the *text* in the column,
 * not markup. The application is right to escape every value it writes into HTML, so the page ends up
 * carrying `&amp;#038;`, and **the reader is shown the entity itself, printed**: the owner reported
 * exactly that on `/ojeh-arishi-festival-of-aboh-kingdom-a-celebration-of-igbo-culture/`.
 *
 * So this function does the one thing that is missing: it turns the stored entity into the character it
 * names, *before* the escaper sees it. `esc(decodeStoredEntities(v))` writes `&amp;` for a stored
 * `&#038;` and a browser renders `&`; a value that already holds a literal `&` is unchanged by this
 * function and escaped exactly as it was.
 *
 * **IT IS DELIBERATELY NOT APPLIED TO `body_html`.** A record's body is *markup* that WordPress published
 * — it is inserted verbatim, its entities are load-bearing, and decoding it would turn a written
 * `&lt;div&gt;` into a real element. Measured on 2026-10-06: 1,503 article bodies and 2,958 revision
 * bodies hold entity tokens, and every one of them is correct as it stands. See
 * `scripts/repair-stored-entities.ts`, which lists the columns it touches and the ones it refuses.
 *
 * ── WHY A WHITELIST OF NAMES AND NOT `/&[a-z]+;/` ────────────────────────────────────────────────────
 *
 * A **numeric** reference is unambiguous: `&#038;` and `&#x26;` name a code point and nothing else, so
 * every one is decoded. A **named** reference is not, because the pattern matches things that are not
 * entities at all — `AT&T;` contains `&T;`, which names no character. Decoding by pattern would either
 * throw or invent a replacement, and *inventing a word to replace an entity is fabrication*. So a name is
 * decoded only when it is in the table below; anything else is left **exactly as it is**, which is the
 * rule this repository sets for prose it did not write.
 *
 * ── WHY IT RUNS TO A FIXED POINT ─────────────────────────────────────────────────────────────────────
 *
 * Two faults were described for this archive and they are not the same fault:
 *
 *   a stored entity that is CORRECT      `&#038;`      one decode  -> `&`          (what the reader wants)
 *   an entity escaped a second time      `&amp;#038;`  one decode  -> `&#038;`     still printed as an entity
 *
 * **A single pass repairs the first and leaves the second broken**, which is how a fix "works on the page
 * that was reported and leaves others showing the entity". So the decode repeats until the value stops
 * changing, bounded, and both classes come out as `&`.
 *
 * A title holding a literal `&` — `R&D`, `Uche & Sons` — is *not* touched by any pass: there is no entity
 * token in it to decode. Both halves are asserted in `stored-entities.test.ts`.
 */

/**
 * The named references this decodes, and the character each one names.
 *
 * The list is the set that actually occurs in material of this kind — the typographic punctuation a CMS
 * substitutes, the arithmetic signs that appear in image dimensions (`&#215;`/`&times;`), and the five
 * XML predefined entities the WordPress importer's own escaping produces. It is **not** every entity in
 * the HTML5 table: an unknown name is left as written rather than guessed at, and adding one is a
 * deliberate act with a character attached to it.
 */
const NAMED: Readonly<Record<string, string>> = {
  // The five XML predefined entities, which is what any escaper emits.
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Whitespace and punctuation a CMS writes.
  nbsp: '\u00a0',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  sbquo: '\u201a',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bdquo: '\u201e',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bull: '\u2022',
  middot: '\u00b7',
  sect: '\u00a7',
  para: '\u00b6',
  dagger: '\u2020',
  Dagger: '\u2021',
  permil: '\u2030',
  prime: '\u2032',
  Prime: '\u2033',
  // Signs and symbols, including the multiplication sign of a stored image dimension.
  times: '\u00d7',
  divide: '\u00f7',
  plusmn: '\u00b1',
  deg: '\u00b0',
  micro: '\u00b5',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  curren: '\u00a4',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  sup2: '\u00b2',
  sup3: '\u00b3',
  iexcl: '\u00a1',
  iquest: '\u00bf',
};

/** `&#038;` — a decimal code point. */
const DECIMAL = /&#(\d{1,7});/g;
/** `&#x26;` — a hexadecimal code point, in either case. */
const HEX = /&#[xX]([0-9a-fA-F]{1,6});/g;
/** `&amp;` — a named reference; the name is looked up, and an unknown one is left alone. */
const NAMED_REF = /&([a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * How many times the decode may be re-applied before it is declared stable.
 *
 * Two would do for the two classes above (`&#038;` and `&amp;#038;`). The bound exists so that a value
 * that somehow never stabilises — none is known, but a pathological string is not worth an infinite loop
 * — returns what it has rather than hanging a request. Reaching it is not an error: it means the value
 * still holds something that looks like an entity, and that is returned as it stands.
 */
const MAX_PASSES = 8;

/** The largest code point Unicode defines. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * The character a numeric reference names, or `null` when it names none.
 *
 * A reference above `MAX_CODE_POINT` or inside the surrogate range `D800–DFFF` names no character, and
 * `String.fromCodePoint` throws on both. Those are returned as `null` so the **token is left exactly as
 * it was written** rather than replaced with a guess or a replacement character.
 */
function codePointOf(digits: string, radix: number): string | null {
  const code = Number.parseInt(digits, radix);
  if (!Number.isFinite(code) || code < 0 || code > MAX_CODE_POINT) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

/** One pass: every decimal reference, then every hexadecimal one, then every known name. */
function onePass(value: string): string {
  return value
    .replace(DECIMAL, (token, digits: string) => codePointOf(digits, 10) ?? token)
    .replace(HEX, (token, digits: string) => codePointOf(digits, 16) ?? token)
    .replace(NAMED_REF, (token, name: string) => NAMED[name] ?? token);
}

/**
 * Decode the entity references a stored text field holds, to the characters they name.
 *
 * Runs to a fixed point so that a value escaped more than once is fully decoded, and stops at
 * `MAX_PASSES`. **A value with no entity reference in it comes back byte-identical**, which is the
 * property that lets this run over a whole column without touching a title a person wrote.
 */
export function decodeStoredEntities(value: string): string {
  let out = value;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = onePass(out);
    if (next === out) return out;
    out = next;
  }
  return out;
}

/** Whether a value holds anything this would decode. Used to select rows rather than rewrite them. */
export function hasStoredEntities(value: string): boolean {
  return decodeStoredEntities(value) !== value;
}

/**
 * The entity tokens a value holds, in order of first appearance. For reporting, not for rewriting.
 *
 * **A token is reported only when it would actually be decoded**, so this cannot report a repair that
 * `decodeStoredEntities` would not make: `AT&T;` contributes nothing and neither does `&#xD800;`.
 */
export function storedEntityTokens(value: string): string[] {
  const found: string[] = [];
  const take = (token: string, decodes: boolean): string => {
    if (decodes && !found.includes(token)) found.push(token);
    return token;
  };
  value
    .replace(DECIMAL, (token, digits: string) => take(token, codePointOf(digits, 10) !== null))
    .replace(HEX, (token, digits: string) => take(token, codePointOf(digits, 16) !== null))
    .replace(NAMED_REF, (token, name: string) => take(token, name in NAMED));
  return found;
}
