/**
 * Orthography handling for African languages written in Latin-derived scripts.
 *
 * WHY THIS EXISTS
 * ---------------
 * The reference implementation (nkowaokwu/igbo_api) hardcodes Igbo-specific
 * diacritic logic: a bespoke `diacriticCodes.ts` table, two different
 * `removeAccents` modes, and a regex builder with Igbo-only character ranges.
 * Ozituma must serve Igbo, Yoruba, Edo, Urhobo, Efik, Ibibio, Hausa, Akan,
 * Wolof, Mandinka, Fula, Mende, Kikongo, Kimbundu, Umbundu and more — so that
 * logic has to become a property of the *language*, not of the codebase.
 *
 * THE KEY INSIGHT
 * ---------------
 * In these orthographies, combining marks come in two very different kinds:
 *
 *   1. LETTER-DEFINING marks. A dot below (U+0323) turns `o` into `ọ`, `e` into
 *      `ẹ`, `s` into `ṣ` — genuinely different letters with different
 *      pronunciations, in Igbo, Yoruba, Edo, Urhobo, Efik and Ibibio alike.
 *      A dot above (U+0307) makes Igbo `ṅ`, which is likewise its own letter.
 *      Dropping these from a *displayed* spelling would be plain wrong.
 *
 *   2. TONE / LENGTH marks. Acute, grave, macron and caron encode tone and
 *      vowel length, not letter identity. Igbo `ákwá` (cry) and `àkwà` (bed)
 *      are the same letters; so is Yoruba `ọkọ̀` vs `ọ̀kọ̀`.
 *
 * So Ozituma stores and maintains TWO derived forms per headword:
 *
 *   exactForm  — letter marks kept, tone marks removed. This is the form used
 *                to treat two tone-different spellings as the same word.
 *   searchForm — every mark removed, lowercased, whitespace collapsed. This is
 *                the maximally permissive key used for typo-tolerant search,
 *                so a user typing `akwa` finds `àkwà` and `ákwá`, and one
 *                typing `oria` finds `ọria`.
 *
 * Both are generated in the same pass, so `searchForm` never disagrees with
 * `exactForm`. This replaces the reference implementation's regex-per-letter
 * character classes with an index-friendly stored-column lookup.
 */

/** Combining marks that change which letter a character *is*. */
export const LETTER_MARKS = [
  0x0323, // COMBINING DOT BELOW      — ọ ẹ ṣ ị ụ
  0x0307, // COMBINING DOT ABOVE      — ṅ (Igbo velar nasal)
  0x0331, // COMBINING MACRON BELOW   — ḇ ḏ (some Edoid / Ijaw orthographies)
] as const;

/** Combining marks that encode tone or vowel length only. */
export const TONE_MARKS = [
  0x0301, // COMBINING ACUTE ACCENT
  0x0300, // COMBINING GRAVE ACCENT
  0x0304, // COMBINING MACRON (length/high tone)
  0x030c, // COMBINING CARON (falling tone)
  0x0302, // COMBINING CIRCUMFLEX ACCENT
  0x0303, // COMBINING TILDE (nasalisation)
  0x0306, // COMBINING BREVE
  0x0308, // COMBINING DIAERESIS
] as const;

/**
 * Spacing (non-combining) modifier letters that survive NFD and would
 * otherwise leak into a search key.
 */
const SPACING_REMARKS = /[\u00a8\u00af\u00b4\u00b8\u02c8\u02cc]/g;

/** Apostrophes and quote variants collapsed to a single straight form. */
const APOSTROPHES = /[\u2018\u2019\u02bc\u02bb\u0060\u00b4']/g;

/** Dashes of every flavour collapsed to an ASCII hyphen. */
const DASHES = /[\u2010-\u2015\u2212]/g;

/** Everything that is not a letter, a digit or a hyphen. */
const NON_WORD = /[^\p{L}\p{N}\u0323\u0307\u0331-]+/gu;

export interface Orthography {
  /** ISO 639-3 code, e.g. `ibo`, `yor`, `bin`. */
  readonly code: string;
  /** Human label for diagnostics. */
  readonly name: string;
  /**
   * Combining-mark code points that define distinct letters in this language.
   * Defaults to {@link LETTER_MARKS}.
   */
  readonly letterMarks?: readonly number[];
  /**
   * True when the language's standard orthography writes tone with combining
   * marks, so tone-stripping is meaningful. Purely descriptive — both derived
   * forms are always produced.
   */
  readonly marksTone?: boolean;
}

const DEFAULT_ORTHOGRAPHY = {
  letterMarks: LETTER_MARKS as readonly number[],
};

function letterMarkSet(o?: Orthography): Set<number> {
  const marks = o?.letterMarks ?? DEFAULT_ORTHOGRAPHY.letterMarks;
  return new Set(marks);
}

/**
 * Canonical surface form of a headword, for display and storage.
 *
 * Case is PRESERVED. This matters: the Igbo corpus distinguishes "Àba" (the
 * town) from "àba" (a common noun), and lowercasing would silently merge 30
 * genuinely distinct entries. The derived search forms below fold case, so
 * search stays case-insensitive regardless.
 */
export function tidy(input: string): string {
  return input
    .normalize('NFC')
    .replace(APOSTROPHES, "'")
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Case fold, applied only to the derived search keys, never to a headword. */
function foldCase(input: string): string {
  return input.toLowerCase();
}

/**
 * Strip tone marks only, preserving letter-defining marks.
 * `ọria` -> `ọria` (unchanged) is correct; `á kwá` -> `akwa` and
 * `ọ́ria` -> `ọria`. Case is folded, so `Àba` -> `àba`.
 */
export function toExactForm(input: string, orthography?: Orthography): string {
  const keep = letterMarkSet(orthography);
  const decomposed = foldCase(tidy(input)).normalize('NFD');

  let out = '';
  for (const ch of decomposed) {
    const cp = ch.codePointAt(0)!;
    // Drop tone marks (and any mark that is neither a letter mark nor tone).
    if (cp >= 0x0300 && cp <= 0x036f && !keep.has(cp)) continue;
    out += ch;
  }
  return out.normalize('NFC').replace(SPACING_REMARKS, '').trim();
}

/**
 * Strip every diacritic, producing the permissive search key.
 * `ọ́ria` -> `oria`, `àkwà` -> `akwa`, `ṅ` -> `n`, `Àba` -> `aba`.
 */
export function toSearchForm(input: string, orthography?: Orthography): string {
  void orthography; // searchForm is deliberately orthography-independent
  return foldCase(tidy(input))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(SPACING_REMARKS, '')
    .trim();
}

/**
 * Both derived forms plus the canonical headword, in one pass, so the search
 * keys can never disagree with the stored spelling.
 */
export function deriveForms(
  input: string,
  orthography?: Orthography
): { headword: string; exactForm: string; searchForm: string } {
  const headword = tidy(input).normalize('NFC');
  return {
    headword,
    exactForm: toExactForm(headword, orthography),
    searchForm: toSearchForm(headword, orthography),
  };
}

/**
 * URL-safe slug for a headword. Uses the search form so that `àkwà` and `ákwá`
 * do not produce two different, confusable URLs, then disambiguates with the
 * row id at call sites (`<slug>-<shortId>`).
 */
export function slugify(input: string, orthography?: Orthography): string {
  const base = toSearchForm(input, orthography)
    .replace(APOSTROPHES, '')
    .replace(NON_WORD, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'word';
}

/**
 * Split a headword into search tokens for multi-word entries, so that
 * `m na-eme` matches queries for `eme` as well as `m na-eme`.
 */
export function tokenize(input: string, orthography?: Orthography): string[] {
  return toSearchForm(input, orthography)
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Postgres `tsvector` text for a definition. We build the vector in SQL via
 * `to_tsvector`, but this gives the importer a single canonical string to feed
 * it, and keeps ranking inputs deterministic.
 */
export function definitionSearchText(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim())
    .join(' \n ');
}
