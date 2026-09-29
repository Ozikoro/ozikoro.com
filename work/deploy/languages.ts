import type { Orthography } from './orthography.ts';

/**
 * The Ozituma language registry.
 *
 * The reference implementation is single-language by construction: Igbo's
 * grammar classes, Igbo's seven tenses, Igbo's 46 dialects and the Nsibidi
 * script are baked into its schemas and enums. Ozituma's core bet — stated
 * explicitly in the Ozikoro technical scope, section 5 — is that one database
 * shape must serve Igbo *and* Yoruba, Edo, Ibibio, Ijaw "and beyond".
 *
 * This registry is that bet made concrete: every language-specific fact lives
 * in data, so adding a language is a row plus a corpus, never a migration.
 *
 * `tier` reflects the delivery plan in the technical scope, not importance:
 *   tier 1 — Year 1 build: shipped with the platform launch
 *   tier 2 — Year 2: corpus preparation underway or planned
 *   tier 3 — registered so the schema is proven against them, corpus later
 */

export type LanguageTier = 1 | 2 | 3;

export interface LanguageDefinition extends Orthography {
  /** ISO 639-3 code — the canonical key used across the platform. */
  readonly code: string;
  /**
   * The name this language is addressed by in a URL.
   *
   * The ISO code is a join key, not a name. For Igbo the register inherited
   * `ibo`, a colonial-era spelling, so the URL says `igbo` instead. Every other
   * language keeps its code in the URL, because nothing asked for them to
   * change. The code stays what the database and the v1 API are keyed on, and
   * inbound links using a code still resolve.
   */
  readonly urlSlug: string;
  /** English name. */
  readonly name: string;
  /** Endonym, in the language's own orthography. */
  readonly nativeName: string;
  /** ISO 3166-1 alpha-2 country codes where it is spoken. */
  readonly countries: readonly string[];
  /** Niger-Congo branch, for grouping in the UI. */
  readonly family: string;
  /** Primary writing system(s). */
  readonly scripts: readonly string[];
  readonly direction: 'ltr' | 'rtl';
  readonly tier: LanguageTier;
  /**
   * True when the language is written with combining tone marks in its
   * standard orthography. Drives whether the UI offers tone-sensitive
   * matching as a user-selectable refinement.
   */
  readonly marksTone: boolean;
  /**
   * True when vowel harmony or consonant mutation means the same morpheme
   * surfaces with different vowels. Igbo and Edo both do this; the importer
   * uses it to decide whether near-miss forms may be auto-merged.
   */
  readonly vowelHarmony: boolean;
  /** Approximate speaker count, for UI ordering and honesty about reach. */
  readonly speakers: number;
}

/**
 * Languages Ozituma intends to serve, seeded from the corpus list assembled
 * for the Ozikoro language platform.
 */
export const LANGUAGES: readonly LanguageDefinition[] = [
  {
    code: 'ibo',
    urlSlug: 'igbo',
    name: 'Igbo',
    nativeName: 'Asụsụ Igbo',
    countries: ['NG'],
    family: 'Niger-Congo > Volta-Niger',
    scripts: ['Latin', 'Akagu'],
    direction: 'ltr',
    tier: 1,
    marksTone: true,
    vowelHarmony: true,
    speakers: 45_000_000,
  },
  {
    code: 'yor',
    urlSlug: 'yor',
    name: 'Yoruba',
    nativeName: 'Èdè Yorùbá',
    countries: ['NG', 'BJ', 'TG'],
    family: 'Niger-Congo > Volta-Niger',
    scripts: ['Latin', 'Ajami'],
    direction: 'ltr',
    tier: 2,
    marksTone: true,
    vowelHarmony: true,
    speakers: 45_000_000,
  },
  {
    code: 'bin',
    urlSlug: 'bin',
    name: 'Edo',
    nativeName: 'Ẹdo',
    countries: ['NG'],
    family: 'Niger-Congo > Volta-Niger > Edoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 2,
    marksTone: true,
    vowelHarmony: true,
    speakers: 1_600_000,
  },
  {
    code: 'urh',
    urlSlug: 'urh',
    name: 'Urhobo',
    nativeName: 'Urhobo',
    countries: ['NG'],
    family: 'Niger-Congo > Volta-Niger > Edoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: true,
    speakers: 2_000_000,
  },
  {
    code: 'efi',
    urlSlug: 'efi',
    name: 'Efik',
    nativeName: 'Efịk',
    countries: ['NG'],
    family: 'Niger-Congo > Cross River',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 2,
    marksTone: true,
    vowelHarmony: false,
    speakers: 400_000,
  },
  {
    code: 'ibb',
    urlSlug: 'ibb',
    name: 'Ibibio',
    nativeName: 'Ibibio',
    countries: ['NG'],
    family: 'Niger-Congo > Cross River',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 2,
    marksTone: true,
    vowelHarmony: false,
    speakers: 4_500_000,
  },
  {
    code: 'ijc',
    urlSlug: 'ijc',
    name: 'Izon (Ijaw)',
    nativeName: 'Izon',
    countries: ['NG'],
    family: 'Niger-Congo > Ijoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: true,
    speakers: 1_000_000,
  },
  {
    code: 'hau',
    urlSlug: 'hau',
    name: 'Hausa',
    nativeName: 'Harshen Hausa',
    countries: ['NG', 'NE', 'GH', 'TD'],
    family: 'Afro-Asiatic > Chadic',
    scripts: ['Latin', 'Ajami'],
    direction: 'ltr',
    tier: 2,
    marksTone: true,
    vowelHarmony: false,
    speakers: 80_000_000,
  },
  {
    code: 'twi',
    urlSlug: 'twi',
    name: 'Twi',
    nativeName: 'Twi',
    countries: ['GH'],
    family: 'Niger-Congo > Kwa',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: true,
    speakers: 9_000_000,
  },
  {
    code: 'wol',
    urlSlug: 'wol',
    name: 'Wolof',
    nativeName: 'Wolof',
    countries: ['SN', 'GM'],
    family: 'Niger-Congo > Senegambian',
    scripts: ['Latin', 'Garay'],
    direction: 'ltr',
    tier: 3,
    marksTone: false,
    vowelHarmony: true,
    speakers: 12_000_000,
  },
  {
    code: 'mnk',
    urlSlug: 'mnk',
    name: 'Mandinka',
    nativeName: 'Mandinka',
    countries: ['GM', 'SN', 'GN', 'ML'],
    family: 'Niger-Congo > Mande',
    scripts: ['Latin', 'NKo'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: false,
    speakers: 1_300_000,
  },
  {
    code: 'fuv',
    urlSlug: 'fuv',
    name: 'Fulfulde',
    nativeName: 'Fulfulde',
    countries: ['NG', 'CM', 'TD'],
    family: 'Niger-Congo > Senegambian',
    scripts: ['Latin', 'Ajami'],
    direction: 'ltr',
    tier: 3,
    marksTone: false,
    vowelHarmony: false,
    speakers: 4_000_000,
  },
  /*
   * ---------------------------------------------------------------------
   * Registered from the corpus material already on hand, found by scanning
   * this machine rather than by choosing languages in the abstract.
   *
   * Every one of these has real text or wordlists waiting in the local
   * source library - Bibles, sentence-pair datasets, speech corpora and
   * comparative wordlists - so each is a corpus to import rather than a
   * placeholder. They sit at tier 2 and 3 because the sources differ wildly
   * in quality, not because the languages are secondary: Tiv has a 1940
   * dictionary, a New Testament and 3,291 question-answer pairs, while Mbe
   * has a New Testament and little else.
   *
   * Deliberately NOT registered: `Ide`. It is a constructed language with no
   * speakers, and it appears throughout the IDE project only as a consumer of
   * these languages - it borrows Igala, Tiv, Idoma, Kanuri, Ekoid and
   * Fulfulde vocabulary. Including it would put an invented language in a
   * dictionary of languages people speak.
   * ---------------------------------------------------------------------
   */
  {
    code: 'idu',
    urlSlug: 'idu',
    name: 'Idoma',
    nativeName: 'Idoma',
    countries: ['NG'],
    family: 'Niger-Congo > Idomoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 2,
    marksTone: true,
    vowelHarmony: false,
    speakers: 1_000_000,
  },
  {
    code: 'igl',
    urlSlug: 'igl',
    name: 'Igala',
    nativeName: 'Ígálá',
    countries: ['NG'],
    family: 'Niger-Congo > Yoruboid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 2,
    marksTone: true,
    vowelHarmony: false,
    speakers: 1_000_000,
  },
  {
    code: 'tiv',
    urlSlug: 'tiv',
    name: 'Tiv',
    nativeName: 'Tiv',
    countries: ['NG'],
    family: 'Niger-Congo > Southern Bantoid > Tivoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 2,
    marksTone: true,
    vowelHarmony: false,
    speakers: 4_000_000,
  },
  {
    code: 'kau',
    urlSlug: 'kau',
    name: 'Kanuri',
    nativeName: 'Kanuri',
    countries: ['NG', 'NE', 'TD', 'CM'],
    family: 'Nilo-Saharan > Saharan',
    scripts: ['Latin', 'Ajami'],
    direction: 'ltr',
    tier: 2,
    marksTone: false,
    vowelHarmony: false,
    speakers: 4_000_000,
  },
  {
    code: 'etu',
    urlSlug: 'etu',
    name: 'Ejagham',
    nativeName: 'Ejagham',
    countries: ['NG', 'CM'],
    family: 'Niger-Congo > Southern Bantoid > Ekoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: false,
    speakers: 120_000,
  },
  {
    code: 'eka',
    urlSlug: 'eka',
    name: 'Ekajuk',
    nativeName: 'Ekajuk',
    countries: ['NG'],
    family: 'Niger-Congo > Southern Bantoid > Ekoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: false,
    speakers: 30_000,
  },
  {
    code: 'utr',
    urlSlug: 'utr',
    name: 'Etulo',
    nativeName: 'Etulo',
    countries: ['NG'],
    family: 'Niger-Congo > Idomoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: false,
    speakers: 10_000,
  },
  {
    code: 'mfo',
    urlSlug: 'mfo',
    name: 'Mbe',
    nativeName: 'Mbe',
    countries: ['NG'],
    family: 'Niger-Congo > Southern Bantoid',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: false,
    speakers: 15_000,
  },
  {
    code: 'men',
    urlSlug: 'men',
    name: 'Mende',
    nativeName: 'Mɛnde',
    countries: ['SL'],
    family: 'Niger-Congo > Mande',
    scripts: ['Latin', 'Kikakui'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: false,
    speakers: 1_500_000,
  },
  {
    code: 'kon',
    urlSlug: 'kon',
    name: 'Kikongo',
    nativeName: 'Kikongo',
    countries: ['CD', 'CG', 'AO'],
    family: 'Niger-Congo > Bantu',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: true,
    speakers: 7_000_000,
  },
  {
    code: 'kmb',
    urlSlug: 'kmb',
    name: 'Kimbundu',
    nativeName: 'Kimbundu',
    countries: ['AO'],
    family: 'Niger-Congo > Bantu',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: true,
    speakers: 6_000_000,
  },
  {
    code: 'umb',
    urlSlug: 'umb',
    name: 'Umbundu',
    nativeName: 'Umbundu',
    countries: ['AO'],
    family: 'Niger-Congo > Bantu',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: true,
    vowelHarmony: true,
    speakers: 7_000_000,
  },
  {
    code: 'gul',
    urlSlug: 'gul',
    name: 'Gullah',
    nativeName: 'Gullah',
    countries: ['US'],
    family: 'English-lexifier creole',
    scripts: ['Latin'],
    direction: 'ltr',
    tier: 3,
    marksTone: false,
    vowelHarmony: false,
    speakers: 250_000,
  },
];

/** Languages due in the Year 1 build, per the Ozikoro technical scope. */
export const TIER_1_LANGUAGES = LANGUAGES.filter((l) => l.tier === 1);

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/**
 * The URL slug for a language code, falling back to the code itself.
 *
 * Used wherever a link is built, so the site only ever emits `/word/igbo/...`
 * and `?language=igbo`, never the ISO code.
 */
export function languageUrlSlug(code: string): string {
  return getLanguage(code)?.urlSlug ?? code;
}

/**
 * Resolve whatever a visitor put in a URL to a canonical language code.
 *
 * Accepts a slug (`igbo`) or a legacy code (`ibo`), so links made before the
 * slugs existed still resolve and can be redirected rather than 404'd.
 */
export function languageCodeFromSlug(slugOrCode: string): string | undefined {
  const needle = slugOrCode.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  const found = LANGUAGES.find((l) => l.urlSlug === needle || l.code === needle);
  return found?.code;
}

/** True when the URL used the legacy code instead of the slug. */
export function isLegacyLanguageSlug(slugOrCode: string): boolean {
  const needle = slugOrCode.trim().toLowerCase();
  const found = LANGUAGES.find((l) => l.urlSlug === needle || l.code === needle);
  return found !== undefined && found.urlSlug !== needle;
}

export function getLanguage(code: string): LanguageDefinition | undefined {
  return BY_CODE.get(code);
}

export function requireLanguage(code: string): LanguageDefinition {
  const language = BY_CODE.get(code);
  if (!language) {
    throw new Error(
      `Unknown language code "${code}". Known codes: ${[...BY_CODE.keys()].join(', ')}`
    );
  }
  return language;
}

export function languageName(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

/** The language the definitions are written in, by default. */
export const DEFINITION_LANGUAGE = 'eng';

export const ENGLISH: LanguageDefinition = {
  code: 'eng',
  urlSlug: 'eng',
  name: 'English',
  nativeName: 'English',
  countries: ['GB', 'US', 'NG'],
  family: 'Indo-European > Germanic',
  scripts: ['Latin'],
  direction: 'ltr',
  tier: 1,
  marksTone: false,
  vowelHarmony: false,
  speakers: 1_500_000_000,
};
