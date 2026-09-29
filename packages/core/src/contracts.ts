/**
 * Frozen API response contracts.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The single most useful artefact in the reference implementation
 * (nkowaokwu/igbo_api) is not a schema or a model — it is a 70-line test helper
 * that freezes the exact JSON key set of every API response, per version:
 * `WORD_KEYS_V1`, `WORD_KEYS_V2`, `EXAMPLE_KEYS_V1`, `EXAMPLE_KEYS_V2`.
 *
 * That is what lets a public API change without breaking the people who built
 * on it. Everything else about that codebase has drifted (dead query params,
 * advertised-but-unenforced quotas, a field declared `[String]` but filled with
 * ObjectIds); the contract arrays are the part that held.
 *
 * So Ozituma freezes its own, and asserts them in the smoke test against real
 * responses.
 *
 * THE RULE
 * --------
 * Within a published version:
 *   - fields MAY be added              (additive, non-breaking)
 *   - fields MUST NOT be removed       (breaking)
 *   - fields MUST NOT change type      (breaking)
 *   - fields MUST NOT change meaning   (breaking, and the worst kind)
 *
 * A breaking change means a new version path (`/api/v2`), never an edit here.
 * When a field is superseded, keep it populated and mark it deprecated rather
 * than deleting it.
 *
 * Adding a key to these arrays is therefore a deliberate act with a
 * compatibility cost. If you are adding one to make a test pass, stop.
 */

/** Response envelope for every endpoint that returns a list. */
export const SEARCH_RESPONSE_KEYS_V1 = [
  'data',
  'total',
  'page',
  'perPage',
  'hasMore',
  'diagnostics',
] as const;

/** Diagnostics is deliberately inspectable, so integrators can tell why a
 * search behaved the way it did (and whether fuzzy matching was available). */
export const SEARCH_DIAGNOSTICS_KEYS_V1 = ['driver', 'trigram', 'strategy'] as const;

/** A result row from `GET /api/v1/words`. */
export const WORD_SUMMARY_KEYS_V1 = [
  'id',
  'language',
  'headword',
  'exactForm',
  'slug',
  'pronunciation',
  'isCommon',
  'isVerified',
  'frequencyRank',
  'glosses',
  'partOfSpeech',
  'matchType',
  'score',
] as const;

/** A full entry from `GET /api/v1/words/:id` — the summary plus detail. */
export const WORD_DETAIL_KEYS_V1 = [
  ...WORD_SUMMARY_KEYS_V1,
  'definitions',
  'dialects',
  'forms',
  'examples',
  'related',
  'audio',
  'attribution',
] as const;

export const DEFINITION_KEYS_V1 = ['text', 'label', 'position', 'partOfSpeech'] as const;

export const DIALECT_KEYS_V1 = ['code', 'name', 'spelling'] as const;

export const FORM_KEYS_V1 = ['formType', 'value'] as const;

export const EXAMPLE_KEYS_V1 = ['text', 'translation'] as const;

export const RELATION_KEYS_V1 = ['relationType', 'id', 'headword', 'slug'] as const;

export const AUDIO_KEYS_V1 = ['url', 'dialect'] as const;

/**
 * Attribution travels with every entry that came from a third-party corpus.
 * It is part of the contract, not decoration: Apache-2.0 and CC-BY-4.0 both
 * require it, so a response that omits it is a licence breach, not a bug.
 */
export const ATTRIBUTION_KEYS_V1 = [
  'sourceName',
  'sourceUrl',
  'license',
  'licenseUrl',
  'citation',
] as const;

export const LANGUAGE_KEYS_V1 = [
  'code',
  'name',
  'nativeName',
  'tier',
  'speakerCount',
  'direction',
  'wordCount',
  'dialectCount',
] as const;

export const STATS_KEYS_V1 = [
  'words',
  'definitions',
  'examples',
  'dialects',
  'languages',
  'languagesWithContent',
  'audio',
] as const;

export const ERROR_BODY_KEYS_V1 = ['error'] as const;
export const ERROR_KEYS_V1 = ['code', 'message', 'details'] as const;

/** `matchType` is a closed set; adding a value is additive for consumers that
 * switch on it, so new values must be documented in the OpenAPI enum too. */
export const MATCH_TYPES_V1 = [
  'headword',
  'variant',
  'dialect',
  'definition',
  'fuzzy',
] as const;

export type MatchTypeV1 = (typeof MATCH_TYPES_V1)[number];

/**
 * Compare an observed object's keys against a frozen contract.
 * Returns the fields that broke the contract, or an empty array when clean.
 *
 * Extra keys are allowed (additive changes); missing keys are not (removal).
 * That asymmetry encodes the whole rule above in one function.
 */
export function contractViolations(
  observed: Record<string, unknown>,
  contract: readonly string[],
  label: string
): string[] {
  const present = new Set(Object.keys(observed));
  return contract
    .filter((key) => !present.has(key))
    .map((key) => `${label}: missing required key "${key}"`);
}

/** Assert a contract, throwing with every violation listed at once. */
export function assertContract(
  observed: Record<string, unknown>,
  contract: readonly string[],
  label: string
): void {
  const violations = contractViolations(observed, contract, label);
  if (violations.length > 0) {
    throw new Error(`API contract violation:\n  - ${violations.join('\n  - ')}`);
  }
}

/**
 * The field mapping from igboapi.com v1 to Ozituma v1.
 *
 * Existing Igbo API developers porting to Ozituma need this, because the two
 * shapes differ deliberately — `headword` rather than `word`, `partOfSpeech`
 * rather than `wordClass`, `glosses` as plain strings rather than a nested
 * `definitions` array, and `language` on every row so one API serves many
 * languages.
 *
 * Kept in code, not just prose, so a migration helper can be generated from it
 * rather than maintained by hand.
 */
export const IGBOAPI_V1_FIELD_MAP: Record<string, { ozituma: string; note?: string }> = {
  id: { ozituma: 'id' },
  word: { ozituma: 'headword', note: 'Renamed: Ozituma is multi-language, so "word" was ambiguous.' },
  wordClass: {
    ozituma: 'partOfSpeech',
    note: 'Now a resolved name from the per-language part_of_speech table, not a bare enum code.',
  },
  pronunciation: { ozituma: 'pronunciation' },
  definitions: {
    ozituma: 'definitions (detail) / glosses (summary)',
    note: 'Was an array of objects with nested `definitions: []`. Ozituma exposes flat gloss strings in search rows and full objects on the entry endpoint.',
  },
  variations: { ozituma: 'forms', note: 'Alternate spellings are now typed form rows.' },
  stems: { ozituma: 'related (relationType="stem")', note: 'ObjectId arrays became a typed edge table.' },
  relatedTerms: { ozituma: 'related' },
  hypernyms: { ozituma: 'related (relationType="hypernym")' },
  hyponyms: { ozituma: 'related (relationType="hyponym")' },
  nsibidi: {
    ozituma: '— (word_script retained, unpopulated)',
    note: 'Dropped at the owner\'s direction. The Igbo API carried a Nsibidi column and a 5,250-entry symbol dictionary; it was imported once and then removed entirely. The word_script table stays because it is script-agnostic and Ajami and NKo will want it, but nothing writes to it.',
  },
  attributes: { ozituma: '—', note: 'Dropped. It encoded Igbo-specific grammatical flags; use partOfSpeech and tags instead.' },
  tags: { ozituma: '— (planned)', note: 'The tag tables exist; surfacing them in v1 is pending.' },
};
