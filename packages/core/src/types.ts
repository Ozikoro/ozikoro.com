/**
 * Shared domain and API types.
 *
 * These are the shapes the public API promises to developers — the equivalent
 * of the `WORD_KEYS_V1/V2` key contracts the reference implementation froze in
 * its test suite. Versioned deliberately: `v1` shapes may gain fields but never
 * lose or repurpose one.
 */

export const API_VERSIONS = ['v1'] as const;
export type ApiVersion = (typeof API_VERSIONS)[number];

/** Lifecycle of a dictionary entry. Only `published` is served publicly. */
export const ENTRY_STATUSES = ['draft', 'pending_review', 'published', 'archived'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** How an entry got into the database — drives attribution and trust display. */
export const PROVENANCE_KINDS = [
  'imported_corpus',
  'editorial',
  'community',
  'partner',
  'ai_assisted',
] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/** Relations between headwords, generalised beyond Igbo's `stems`. */
export const RELATION_TYPES = [
  'synonym',
  'antonym',
  'hypernym',
  'hyponym',
  'variant',
  'stem',
  'derived',
  'related',
  'see_also',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** Grammar categories are per-language rows, not a global enum. */
export interface PartOfSpeechDTO {
  code: string;
  name: string;
  abbreviation: string;
}

export interface DialectDTO {
  code: string;
  name: string;
  nativeName?: string;
}

/** A dialect-specific spelling/pronunciation of a headword. */
export interface WordDialectDTO {
  dialect: DialectDTO;
  spelling: string;
  pronunciation?: string | null;
  audioUrl?: string | null;
  notes?: string | null;
}

/** An inflected or derived surface form (Igbo's "tenses" generalised). */
export interface WordFormDTO {
  formType: string;
  value: string;
}

export interface DefinitionDTO {
  text: string;
  language: string;
  partOfSpeech?: PartOfSpeechDTO | null;
  label?: string | null;
  order: number;
}

export interface ExampleDTO {
  text: string;
  language: string;
  translation?: string | null;
  translationLanguage?: string | null;
  audioUrl?: string | null;
}

/** Attribution travels with every entry that came from a third-party corpus. */
export interface AttributionDTO {
  sourceName: string;
  sourceUrl?: string | null;
  license: string;
  licenseUrl?: string | null;
  citation?: string | null;
}

/** The public representation of a dictionary entry. */
export interface WordDTO {
  id: string;
  language: string;
  headword: string;
  /** Tone-stripped, letter-mark-preserving form used for exact matching. */
  exactForm: string;
  slug: string;
  pronunciation?: string | null;
  syllables?: string | null;
  isCommon: boolean;
  isVerified: boolean;
  status: EntryStatus;
  definitions: DefinitionDTO[];
  dialects: WordDialectDTO[];
  forms: WordFormDTO[];
  examples: ExampleDTO[];
  related: { type: RelationType; word: { id: string; headword: string; language: string } }[];
  audio: { url: string; dialect?: string | null; speaker?: string | null }[];
  attribution: AttributionDTO | null;
}

/** Envelope for paginated collection endpoints. */
export interface PaginatedResponse<T> {
  data: T[];
  /** Total matching rows across all pages — also surfaced as `Content-Range`. */
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Present on validation failures. */
    details?: unknown;
  };
}

/**
 * Error codes the API can return. The reference implementation defaulted every
 * failure to HTTP 400 — including rate limiting, which its own skipped test
 * expected to be 403. These are explicit and correctly mapped.
 */
export const API_ERROR_CODES = {
  MISSING_API_KEY: 'missing_api_key',
  INVALID_API_KEY: 'invalid_api_key',
  REVOKED_API_KEY: 'revoked_api_key',
  QUOTA_EXCEEDED: 'quota_exceeded',
  RATE_LIMITED: 'rate_limited',
  NOT_FOUND: 'not_found',
  INVALID_PARAMETER: 'invalid_parameter',
  UNSUPPORTED_LANGUAGE: 'unsupported_language',
  INTERNAL: 'internal_error',
} as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/** Status code for each error code, so routes never guess. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  missing_api_key: 401,
  invalid_api_key: 401,
  revoked_api_key: 401,
  quota_exceeded: 429,
  rate_limited: 429,
  not_found: 404,
  invalid_parameter: 400,
  unsupported_language: 400,
  internal_error: 500,
};
