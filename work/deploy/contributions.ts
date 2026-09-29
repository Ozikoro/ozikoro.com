/**
 * Open contribution and the editorial review queue.
 *
 * This is the pattern the Ozikoro technical scope names explicitly for both the
 * Name Dictionary and the Language Platform: "a contribution/submission flow so
 * ... the public can submit entries, with a review step before publishing — the
 * same open-contribution-plus-editorial-queue model both Afam and nkowaokwu.com
 * already use successfully."
 *
 * HOW IT WORKS
 *
 * 1. Anyone with an account submits a `suggestion` row. That row is INERT: it is
 *    data about a proposed change, not the change. Nothing it contains reaches
 *    the dictionary.
 *
 * 2. An account with the `editor` or `admin` role reviews it. Approval is the
 *    only code path that writes to `word` / `definition` / `example`.
 *
 * 3. Approved submissions attach to a `source` row, so a community entry is
 *    attributed as a community entry. Without that, the "every headword names a
 *    source" invariant in verify.ts would be satisfied by a lie.
 *
 * WHY THE PAYLOAD IS JSONB
 *
 * A submission's shape varies by kind and will keep evolving as kinds are added.
 * Storing it as jsonb lets the review UI render and act on a submission it does
 * not yet fully understand, instead of a new kind being unreadable until the UI
 * ships. Every field is validated on the way IN (here) and again when applied.
 *
 * MERGE RATHER THAN REJECT
 *
 * If an approved `new_word` names a headword that already exists, the definitions
 * are attached to the existing entry and the suggestion is marked `merged`
 * rather than failing. A contributor who supplies a good second sense for an
 * existing word has done something useful, and the review queue should not throw
 * that away because the headword was already present.
 */
import { deriveForms, requireLanguage, slugify, type LanguageDefinition } from '@ozituma/core';
import type { Db } from './client.ts';
import { loadPosIndex } from './import/corpus.ts';
import { MAX_AUDIO_BYTES, normaliseAudioType } from './storage.ts';

export type SuggestionKind =
  | 'new_word'
  | 'edit_word'
  | 'new_definition'
  | 'new_example'
  | 'audio'
  | 'correction'
  | 'dialect'
  /**
   * A proposed change to a proverb: its Igbo text, its English, or both.
   *
   * Its own kind rather than `correction`, because a correction is a note ABOUT
   * an entry and this is a replacement FOR one — the reviewer has to compare two
   * texts and decide, and the queue should say so.
   */
  | 'proverb_edit';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'merged';

export class ContributionError extends Error {
  /** Set explicitly: without it every subclass reports its name as "Error". */
  override readonly name = 'ContributionError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Limits, so a submission cannot be used to write megabytes into the database. */
const MAX_HEADWORD = 120;
const MAX_DEFINITION = 600;
const MAX_DEFINITIONS = 10;
const MAX_EXAMPLE = 500;
const MAX_NOTE = 1000;
/** A proverb or its rendering. Some run long; this bounds a paste accident. */
const MAX_TEXT = 600;

export interface NewWordPayload {
  headword: string;
  definitions: string[];
  language?: string;
  partOfSpeech?: string | null;
  example?: { text: string; translation?: string | null } | null;
  dialectNote?: string | null;
  note?: string | null;
}

export interface NewDefinitionPayload {
  /** Numeric id of the entry being extended. */
  wordId?: number | null;
  /** Fallback: resolve the entry by its headword within a language. */
  headword?: string | null;
  definitions: string[];
  language?: string;
  note?: string | null;
}

export interface CorrectionPayload {
  wordId?: number | null;
  headword?: string | null;
  language?: string;
  note: string;
}

/**
 * A pronunciation recording.
 *
 * The bytes are uploaded to object storage first and only the key is carried
 * here, so the review queue never holds media and a rejected recording is a
 * row plus an orphaned object rather than a transaction that has to roll back
 * a file write.
 */
export interface ProverbEditPayload {
  /** The `example` row being edited. */
  exampleId: number;
  /** The proverb's text as it stood when the form was opened. */
  previousText: string;
  /** The Igbo after the proposed edit. */
  text: string;
  /** The English after the proposed edit; null clears it. */
  translation: string | null;
  note?: string | null;
}

export interface AudioPayload {
  storageKey: string;
  mimeType: string;
  byteSize: number;
  durationMs?: number | null;
  dialectCode?: string | null;
  provenanceNote?: string | null;
}

export interface SuggestionRecord {
  id: number;
  uuid: string;
  kind: SuggestionKind;
  languageCode: string | null;
  targetWordId: number | null;
  payload: Record<string, unknown>;
  status: ReviewStatus;
  submittedBy: number | null;
  submittedByName: string | null;
  submittedAt: string;
  reviewedBy: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ContributionError('invalid_submission', `"${field}" is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ContributionError(
      'invalid_submission',
      `"${field}" must be at most ${max} characters (got ${trimmed.length}).`
    );
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field, max);
}

/**
 * Reject control characters and the Unicode bidi overrides.
 *
 * Beyond mere tidiness this is a real spoofing vector: a headword containing
 * U+202E (right-to-left override) renders reversed in the UI and in search
 * results, so a contributed word could be made to display as a different word
 * than the one stored.
 */
function rejectControlCharacters(value: string, field: string): void {
  // Allow tab/newline only in long prose fields, never in a headword.
  const forbidden = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
  if (forbidden.test(value)) {
    throw new ContributionError(
      'invalid_submission',
      `"${field}" contains control characters that are not allowed.`
    );
  }
}

function cleanDefinitions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ContributionError('invalid_submission', '"definitions" must be a list.');
  }
  const cleaned: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    rejectControlCharacters(trimmed, 'definitions');
    if (trimmed.length > MAX_DEFINITION) {
      throw new ContributionError(
        'invalid_submission',
        `A definition may be at most ${MAX_DEFINITION} characters.`
      );
    }
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
  }
  if (cleaned.length === 0) {
    throw new ContributionError('invalid_submission', 'At least one definition is required.');
  }
  if (cleaned.length > MAX_DEFINITIONS) {
    throw new ContributionError(
      'invalid_submission',
      `At most ${MAX_DEFINITIONS} definitions per submission.`
    );
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmitResult {
  id: number;
  uuid: string;
  kind: SuggestionKind;
  status: ReviewStatus;
}

export async function submitSuggestion(
  db: Db,
  accountId: number,
  input: { kind: SuggestionKind; language?: string; targetWordId?: number | null; payload: unknown }
): Promise<SubmitResult> {
  const languageCode = input.language ? input.language.trim().toLowerCase() : null;
  if (languageCode !== null) {
    // `requireLanguage` throws a plain Error; translate it so the API layer can
    // return a 400 with a stable code rather than a generic 500.
    try {
      requireLanguage(languageCode);
    } catch {
      throw new ContributionError(
        'invalid_language',
        `"${languageCode}" is not a language this platform serves.`
      );
    }
  }

  let payload: Record<string, unknown>;

  switch (input.kind) {
    case 'new_word': {
      const raw = (input.payload ?? {}) as Partial<NewWordPayload>;
      const headword = requireText(raw.headword, 'headword', MAX_HEADWORD);
      rejectControlCharacters(headword, 'headword');
      const definitions = cleanDefinitions(raw.definitions);
      const example =
        raw.example && typeof raw.example === 'object'
          ? {
              text: requireText((raw.example as { text?: unknown }).text, 'example.text', MAX_EXAMPLE),
              translation: optionalText(
                (raw.example as { translation?: unknown }).translation,
                'example.translation',
                MAX_EXAMPLE
              ),
            }
          : null;
      if (example) {
        rejectControlCharacters(example.text, 'example.text');
        if (example.translation) rejectControlCharacters(example.translation, 'example.translation');
      }
      payload = {
        headword,
        definitions,
        partOfSpeech: optionalText(raw.partOfSpeech, 'partOfSpeech', 20),
        example,
        dialectNote: optionalText(raw.dialectNote, 'dialectNote', MAX_NOTE),
        note: optionalText(raw.note, 'note', MAX_NOTE),
      };
      break;
    }

    case 'new_definition': {
      const raw = (input.payload ?? {}) as Partial<NewDefinitionPayload>;
      const definitions = cleanDefinitions(raw.definitions);
      if (input.targetWordId == null && !raw.headword) {
        throw new ContributionError(
          'invalid_submission',
          'A definition submission must name the entry it extends.'
        );
      }
      payload = {
        headword: optionalText(raw.headword, 'headword', MAX_HEADWORD),
        definitions,
        note: optionalText(raw.note, 'note', MAX_NOTE),
      };
      break;
    }

    case 'proverb_edit': {
      const raw = (input.payload ?? {}) as Partial<ProverbEditPayload>;
      const exampleId = Number(raw.exampleId);
      if (!Number.isInteger(exampleId) || exampleId <= 0) {
        throw new ContributionError(
          'invalid_submission',
          'A proverb edit must name the proverb it changes.'
        );
      }
      const previousText = requireText(raw.previousText, 'previousText', MAX_TEXT);
      const nextText = requireText(raw.text, 'text', MAX_TEXT);
      const translation = optionalText(raw.translation, 'translation', MAX_TEXT);
      if (nextText === previousText && translation === null) {
        throw new ContributionError('invalid_submission', 'That edit changes nothing.');
      }
      rejectControlCharacters(nextText, 'text');
      if (translation) rejectControlCharacters(translation, 'translation');
      payload = {
        exampleId,
        previousText,
        text: nextText,
        translation,
        note: optionalText(raw.note, 'note', MAX_NOTE),
      };
      break;
    }

    case 'correction': {
      const raw = (input.payload ?? {}) as Partial<CorrectionPayload>;
      payload = {
        headword: optionalText(raw.headword, 'headword', MAX_HEADWORD),
        note: requireText(raw.note, 'note', MAX_NOTE),
      };
      break;
    }

    case 'audio': {
      const raw = (input.payload ?? {}) as Partial<AudioPayload>;

      // The recording must name the entry it pronounces.
      if (input.targetWordId == null) {
        throw new ContributionError(
          'invalid_submission',
          'A recording must name the word it is a pronunciation of.'
        );
      }

      const storageKey = requireText(raw.storageKey, 'storageKey', 400);
      let mimeType: string;
      try {
        // Re-validated here as well as in the upload route: a storage key can
        // be resubmitted, and the queue must not trust that it came from our
        // own upload path.
        mimeType = normaliseAudioType(requireText(raw.mimeType, 'mimeType', 100));
      } catch (error) {
        throw new ContributionError(
          'invalid_submission',
          error instanceof Error ? error.message : 'Unsupported audio format.'
        );
      }

      const byteSize = Number(raw.byteSize);
      if (!Number.isFinite(byteSize) || byteSize <= 0) {
        throw new ContributionError('invalid_submission', 'The recording size is missing.');
      }
      if (byteSize > MAX_AUDIO_BYTES) {
        throw new ContributionError(
          'invalid_submission',
          `Recording is ${Math.round(byteSize / 1024)} KB; the limit is ${Math.round(MAX_AUDIO_BYTES / 1024)} KB.`
        );
      }

      const durationMs = raw.durationMs == null ? null : Number(raw.durationMs);
      if (durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 120_000)) {
        throw new ContributionError(
          'invalid_submission',
          'Recordings must be under two minutes.'
        );
      }

      payload = {
        storageKey,
        mimeType,
        byteSize,
        durationMs,
        dialectCode: optionalText(raw.dialectCode, 'dialectCode', 12),
        provenanceNote: optionalText(raw.provenanceNote, 'provenanceNote', MAX_NOTE),
      };
      break;
    }

    default:
      // The remaining kinds (edit_word, new_example, dialect) are recognised by
      // the schema but have no review handler yet. Refusing them explicitly is
      // better than accepting a row nobody can act on.
      throw new ContributionError(
        'unsupported_kind',
        `Submissions of kind "${input.kind}" are not accepted yet.`
      );
  }

  try {
    const row = await db.one<{ id: string; uuid: string; status: string }>(
      `insert into suggestion (kind, language_code, target_word_id, payload, submitted_by)
       values ($1, $2, $3, $4::jsonb, $5)
       returning id, uuid, status`,
      [input.kind, languageCode, input.targetWordId ?? null, JSON.stringify(payload), accountId]
    );
    if (!row) throw new ContributionError('internal', 'Could not record that submission.');
    return {
      id: Number(row.id),
      uuid: row.uuid,
      kind: input.kind,
      status: row.status as ReviewStatus,
    };
  } catch (error) {
    // The partial unique index is what catches accidental double-submits; give
    // the person a clear message rather than a constraint violation.
    if (error instanceof Error && /suggestion_no_duplicate_pending/.test(error.message)) {
      throw new ContributionError(
        'duplicate_submission',
        'You already have this submission pending review.'
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reading the queue
// ---------------------------------------------------------------------------

const SUGGESTION_SELECT = `
  select s.id, s.uuid, s.kind, s.language_code, s.target_word_id, s.payload, s.status,
         s.submitted_by, s.submitted_at, s.reviewed_by, s.reviewed_at, s.review_note,
         submitter.display_name as submitter_name, submitter.email as submitter_email,
         reviewer.display_name  as reviewer_name,  reviewer.email  as reviewer_email
    from suggestion s
    left join account submitter on submitter.id = s.submitted_by
    left join account reviewer  on reviewer.id  = s.reviewed_by
`;

function normaliseSuggestion(row: Record<string, unknown>): SuggestionRecord {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    kind: String(row.kind) as SuggestionKind,
    languageCode: (row.language_code as string | null) ?? null,
    targetWordId: row.target_word_id === null ? null : Number(row.target_word_id),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: String(row.status) as ReviewStatus,
    submittedBy: row.submitted_by === null ? null : Number(row.submitted_by),
    submittedByName:
      (row.submitter_name as string | null) ?? (row.submitter_email as string | null) ?? null,
    submittedAt: String(row.submitted_at),
    reviewedBy: row.reviewed_by === null ? null : Number(row.reviewed_by),
    reviewedByName: (row.reviewer_name as string | null) ?? (row.reviewer_email as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    reviewNote: (row.review_note as string | null) ?? null,
  };
}

export async function listSuggestions(
  db: Db,
  filters: { status?: ReviewStatus; submittedBy?: number; limit?: number; offset?: number } = {}
): Promise<{ data: SuggestionRecord[]; total: number }> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`s.status = $${params.length}`);
  }
  if (filters.submittedBy !== undefined) {
    params.push(filters.submittedBy);
    clauses.push(`s.submitted_by = $${params.length}`);
  }
  const where = clauses.length > 0 ? `where ${clauses.join(' and ')}` : '';

  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await db.rows<Record<string, unknown>>(
    `${SUGGESTION_SELECT} ${where}
     order by case when s.status = 'pending' then 0 else 1 end,
              s.submitted_at asc
     limit ${limit} offset ${offset}`,
    // The limit/offset are inlined as validated integers (never user strings),
    // so the only placeholders here come from `where` — and they must be bound.
    params
  );

  const totalRow = await db.one<{ n: number }>(
    `select count(*)::int as n from suggestion s ${where}`,
    params
  );

  return { data: rows.map(normaliseSuggestion), total: Number(totalRow?.n ?? 0) };
}

export async function getSuggestion(db: Db, id: number): Promise<SuggestionRecord | null> {
  const row = await db.one<Record<string, unknown>>(`${SUGGESTION_SELECT} where s.id = $1`, [id]);
  return row ? normaliseSuggestion(row) : null;
}

export interface QueueStats {
  pending: number;
  approved: number;
  rejected: number;
  merged: number;
  contributors: number;
}

export async function getQueueStats(db: Db): Promise<QueueStats> {
  const row = await db.one<Record<string, unknown>>(
    `select
       count(*) filter (where status = 'pending')::int  as pending,
       count(*) filter (where status = 'approved')::int as approved,
       count(*) filter (where status = 'rejected')::int as rejected,
       count(*) filter (where status = 'merged')::int   as merged,
       count(distinct submitted_by)::int                as contributors
     from suggestion`
  );
  return {
    pending: Number(row?.pending ?? 0),
    approved: Number(row?.approved ?? 0),
    rejected: Number(row?.rejected ?? 0),
    merged: Number(row?.merged ?? 0),
    contributors: Number(row?.contributors ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Applying an approved submission
// ---------------------------------------------------------------------------

/** Find a free slug for a headword within a language. */
async function allocateSlug(
  db: Db,
  languageCode: string,
  headword: string,
  language: LanguageDefinition
): Promise<string> {
  const base = slugify(headword, language);
  for (let suffix = 0; suffix < 500; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const taken = await db.one<{ id: string }>(
      `select id from word where language_code = $1 and slug = $2`,
      [languageCode, candidate]
    );
    if (!taken) return candidate;
  }
  throw new ContributionError('internal', `Could not allocate a URL slug for "${headword}".`);
}

async function sourceIdFor(db: Db, slug: string): Promise<number> {
  const row = await db.one<{ id: number }>(`select id from source where slug = $1`, [slug]);
  if (!row) {
    throw new ContributionError(
      'internal',
      `Source "${slug}" is missing. Run \`npm run seed\` before reviewing contributions.`
    );
  }
  return Number(row.id);
}

export interface ApplyResult {
  /**
   * What the approval actually did.
   *   created — a new entry was inserted
   *   merged  — content was attached to an entry that already existed
   *   approved — something other than a dictionary entry was published (audio)
   *   noop    — nothing changed, because the content was already present
   */
  outcome: 'created' | 'merged' | 'approved' | 'noop';
  wordId: number | null;
  definitionsAdded: number;
  detail: string;
}

/**
 * Write an approved submission into the dictionary.
 *
 * Caller must already have verified the reviewer's role; this function is the
 * mechanism, not the policy.
 */
async function applySuggestion(db: Db, suggestion: SuggestionRecord): Promise<ApplyResult> {
  const languageCode = suggestion.languageCode ?? 'ibo';
  const language = requireLanguage(languageCode);
  // A submission from the community is attributed as one. If an editor entered
  // it directly there is no submitter, and it is editorial work.
  const sourceSlug = suggestion.submittedBy === null ? 'ozituma-editorial' : 'ozituma-community';
  const sourceId = await sourceIdFor(db, sourceSlug);
  const posIndex = await loadPosIndex(db, languageCode);

  if (suggestion.kind === 'new_word') {
    const headword = String(suggestion.payload.headword ?? '').trim();
    if (headword.length === 0) {
      throw new ContributionError('invalid_submission', 'The submission has no headword.');
    }
    const definitions = Array.isArray(suggestion.payload.definitions)
      ? (suggestion.payload.definitions as unknown[]).filter(
          (d): d is string => typeof d === 'string' && d.trim().length > 0
        )
      : [];
    if (definitions.length === 0) {
      throw new ContributionError('invalid_submission', 'The submission has no definitions.');
    }

    const fields = deriveForms(headword, language);
    const posCode = String(suggestion.payload.partOfSpeech ?? 'UNK').trim() || 'UNK';
    const posId = posIndex.byCode.get(posCode) ?? posIndex.unclassified;

    // Does the headword already exist? `= $2` on the stored headword, which is
    // case-sensitive by design, but fall back to the folded key so a contributor
    // spelling `ulo` attaches to the existing `ụlọ` rather than creating a twin.
    const existing = await db.one<{ id: string }>(
      `select id from word
        where language_code = $1 and (headword = $2 or search_form = $3)
        order by case when headword = $2 then 0 else 1 end
        limit 1`,
      [languageCode, fields.headword, fields.searchForm]
    );

    if (existing) {
      const wordId = Number(existing.id);
      let added = 0;
      for (const [index, text] of definitions.entries()) {
        const result = await db.query(
          `insert into definition (word_id, language_code, part_of_speech_id, text, position, is_primary, source_id)
           values ($1, 'eng', $2, $3, $4, false, $5)
           on conflict (word_id, language_code, text) do nothing`,
          [wordId, posId, text, index + 100, sourceId]
        );
        added += result.rowCount;
      }
      return {
        outcome: added > 0 ? 'merged' : 'noop',
        wordId,
        definitionsAdded: added,
        detail:
          added > 0
            ? `Attached ${added} definition(s) to the existing entry "${fields.headword}".`
            : `"${fields.headword}" already has those definitions; nothing changed.`,
      };
    }

    const slug = await allocateSlug(db, languageCode, fields.headword, language);
    const wordRow = await db.one<{ id: string }>(
      `insert into word (language_code, headword, exact_form, search_form, slug, source_id, is_verified)
       values ($1, $2, $3, $4, $5, $6, false)
       returning id`,
      [languageCode, fields.headword, fields.exactForm, fields.searchForm, slug, sourceId]
    );
    if (!wordRow) throw new ContributionError('internal', 'Could not create the entry.');
    const wordId = Number(wordRow.id);

    for (const [index, text] of definitions.entries()) {
      await db.query(
        `insert into definition (word_id, language_code, part_of_speech_id, text, position, is_primary, source_id)
         values ($1, 'eng', $2, $3, $4, $5, $6)
         on conflict (word_id, language_code, text) do nothing`,
        [wordId, posId, text, index, index === 0, sourceId]
      );
    }

    // An example supplied with the word is worth keeping; it is the field that
    // shows a learner how the word is actually used.
    const example = suggestion.payload.example as
      | { text?: unknown; translation?: unknown }
      | null
      | undefined;
    if (example && typeof example.text === 'string' && example.text.trim().length > 0) {
      const text = example.text.trim();
      const translation =
        typeof example.translation === 'string' && example.translation.trim().length > 0
          ? example.translation.trim()
          : null;
      const exampleRow = await db.one<{ id: string }>(
        `insert into example (language_code, text, search_form, translation, translation_language_code, source_id)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          languageCode,
          text,
          deriveForms(text, language).searchForm,
          translation,
          translation ? 'eng' : null,
          sourceId,
        ]
      );
      if (exampleRow) {
        await db.query(
          `insert into example_word (example_id, word_id) values ($1, $2) on conflict do nothing`,
          [Number(exampleRow.id), wordId]
        );
      }
    }

    return {
      outcome: 'created',
      wordId,
      definitionsAdded: definitions.length,
      detail: `Created "${fields.headword}" with ${definitions.length} definition(s).`,
    };
  }

  if (suggestion.kind === 'new_definition') {
    let wordId = suggestion.targetWordId;
    if (wordId === null) {
      const headword = String(suggestion.payload.headword ?? '').trim();
      const fields = deriveForms(headword, language);
      // Deterministic target: an exact headword match wins over a folded one.
      // "ụlọ", "ùlò" and "ụlō" all fold to "ulo", so without the ordering this
      // could attach a definition to a different tone than the one submitted.
      const found = await db.one<{ id: string }>(
        `select id from word
          where language_code = $1 and (headword = $2 or search_form = $3)
          order by case when headword = $2 then 0 else 1 end
          limit 1`,
        [languageCode, fields.headword, fields.searchForm]
      );
      wordId = found ? Number(found.id) : null;
    }
    if (wordId === null) {
      throw new ContributionError(
        'invalid_submission',
        'That entry no longer exists, so the definition cannot be attached.'
      );
    }

    const definitions = (suggestion.payload.definitions as unknown[]).filter(
      (d): d is string => typeof d === 'string' && d.trim().length > 0
    );

    const existingCount = await db.one<{ n: number }>(
      `select count(*)::int as n from definition where word_id = $1 and language_code = 'eng'`,
      [wordId]
    );
    let position = Number(existingCount?.n ?? 0);

    let added = 0;
    for (const text of definitions) {
      const result = await db.query(
        `insert into definition (word_id, language_code, part_of_speech_id, text, position, is_primary, source_id)
         values ($1, 'eng', $2, $3, $4, false, $5)
         on conflict (word_id, language_code, text) do nothing`,
        [wordId, posIndex.unclassified, text, position, sourceId]
      );
      added += result.rowCount;
      position += 1;
    }

    return {
      // Adding a sense to an entry that already exists *is* a merge, and the
      // suggestion is recorded as such so the queue can tell the two apart.
      outcome: added > 0 ? 'merged' : 'noop',
      wordId,
      definitionsAdded: added,
      detail:
        added > 0
          ? `Added ${added} definition(s) to entry ${wordId}.`
          : 'Those definitions were already present; nothing changed.',
    };
  }

  /*
   * A proverb edit. The old text is copied into proverb_revision BEFORE the
   * update, so approving a change cannot lose what the proverb said — and the
   * review note records the wording the reviewer was looking at, which is how a
   * later reader knows what was replaced.
   */
  if (suggestion.kind === 'proverb_edit') {
    const exampleId = Number(suggestion.payload.exampleId ?? 0);
    const previousText = String(suggestion.payload.previousText ?? '').trim();
    const nextText = String(suggestion.payload.text ?? '').trim();
    const nextTranslation = suggestion.payload.translation;
    if (!Number.isInteger(exampleId) || exampleId <= 0 || nextText.length === 0) {
      throw new ContributionError('invalid_submission', 'That proverb edit is incomplete.');
    }

    const row = await db.one<{ id: string; text: string; translation: string | null; style: string | null }>(
      `select id, text, translation, style from example where id = $1`,
      [exampleId]
    );
    if (!row) {
      throw new ContributionError('invalid_submission', 'That proverb no longer exists.');
    }
    if (row.style !== 'proverb') {
      throw new ContributionError('invalid_submission', 'That entry is not a proverb.');
    }
    // The proverb has been edited since the form was opened — by an editor, or by
    // another accepted suggestion. The submission is refused rather than applied
    // over the top of a change its author never saw.
    if (row.text.trim() !== previousText && previousText.length > 0) {
      throw new ContributionError(
        'conflict',
        'This proverb has changed since that edit was proposed, so it was not applied.'
      );
    }

    const alreadySame = row.text.trim() === nextText && (row.translation ?? null) === (nextTranslation ?? null);

    await db.query(
      `insert into proverb_revision
         (example_id, suggestion_id, previous_text, previous_translation, text, translation,
          proposed_by, approved_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        exampleId,
        suggestion.id,
        row.text,
        row.translation,
        nextText,
        nextTranslation ?? null,
        suggestion.submittedBy,
        suggestion.reviewedBy,
      ]
    );

    if (!alreadySame) {
      await db.query(
        `update example
            set text = $1, search_form = $2, translation = $3,
                translation_language_code = case when $3 is null then null else 'eng' end
          where id = $4`,
        [nextText, deriveForms(nextText, language).searchForm, nextTranslation ?? null, exampleId]
      );
    }

    return {
      outcome: alreadySame ? 'noop' : 'approved',
      wordId: null,
      definitionsAdded: 0,
      detail: alreadySame
        ? 'The proverb already said that; the revision was recorded and nothing changed.'
        : `Proverb ${exampleId} updated from "${row.text}" to "${nextText}".`,
    };
  }

  if (suggestion.kind === 'audio') {
    const storageKey = String(suggestion.payload.storageKey ?? '').trim();
    const mimeType = String(suggestion.payload.mimeType ?? '').trim();
    if (storageKey.length === 0 || mimeType.length === 0) {
      throw new ContributionError('invalid_submission', 'The recording has no stored file.');
    }

    // The recording is attached to whatever `target_word_id` pointed at when it
    // was submitted, or resolved by headword if the entry was later recreated.
    let wordId = suggestion.targetWordId;
    if (wordId === null) {
      const headword = String(suggestion.payload.headword ?? '').trim();
      if (headword.length > 0) {
        const fields = deriveForms(headword, language);
        const found = await db.one<{ id: string }>(
          `select id from word
            where language_code = $1 and (headword = $2 or search_form = $3)
            order by case when headword = $2 then 0 else 1 end
            limit 1`,
          [languageCode, fields.headword, fields.searchForm]
        );
        wordId = found ? Number(found.id) : null;
      }
    }
    if (wordId === null) {
      throw new ContributionError(
        'invalid_submission',
        'That entry no longer exists, so the recording cannot be attached.'
      );
    }

    // Optional dialect attribution, so a recording in a specific variety is
    // labelled rather than presented as the standard pronunciation.
    let dialectId: number | null = null;
    const dialectCode = String(suggestion.payload.dialectCode ?? '').trim();
    if (dialectCode.length > 0) {
      const dialect = await db.one<{ id: string }>(
        `select id from dialect where language_code = $1 and code = $2`,
        [languageCode, dialectCode]
      );
      dialectId = dialect ? Number(dialect.id) : null;
    }

    const byteSize = Number(suggestion.payload.byteSize ?? 0);
    const durationMs = suggestion.payload.durationMs == null
      ? null
      : Number(suggestion.payload.durationMs);
    const provenanceNote =
      typeof suggestion.payload.provenanceNote === 'string'
        ? suggestion.payload.provenanceNote
        : null;

    // The speaker is the person who submitted it, which is what makes the
    // recording attributable and removable on request.
    const speaker = suggestion.submittedBy === null
      ? null
      : await db.one<{ display_name: string | null; email: string }>(
          `select display_name, email from account where id = $1`,
          [suggestion.submittedBy]
        );

    const inserted = await db.query(
      `insert into audio
         (language_code, dialect_id, word_id, storage_key, mime_type, byte_size,
          duration_ms, speaker_name, status, license_code, source_id,
          contributor_account_id, provenance_note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'published', 'CC-BY-4.0', $9, $10, $11)
       -- The predicate must be repeated here: Postgres only infers a PARTIAL
       -- unique index when the ON CONFLICT target carries the same WHERE clause.
       on conflict (word_id, coalesce(storage_key, ''), coalesce(external_url, ''))
         where word_id is not null
         do nothing`,
      [
        languageCode,
        dialectId,
        wordId,
        storageKey,
        mimeType,
        byteSize > 0 ? byteSize : null,
        durationMs,
        speaker?.display_name ?? speaker?.email ?? null,
        sourceId,
        suggestion.submittedBy,
        provenanceNote,
      ]
    );

    return {
      outcome: inserted.rowCount > 0 ? 'approved' : 'noop',
      wordId,
      definitionsAdded: 0,
      detail:
        inserted.rowCount > 0
          ? `Published the pronunciation on entry ${wordId}.`
          : 'That recording is already attached to this entry.',
    };
  }

  // Corrections are notes to the editorial team. They carry no mechanical
  // change, so approving one records the decision and nothing else.
  return {
    outcome: 'noop',
    wordId: suggestion.targetWordId,
    definitionsAdded: 0,
    detail: 'Correction noted; no dictionary change applied.',
  };
}

export interface ReviewResult {
  suggestion: SuggestionRecord;
  applied: ApplyResult | null;
}

/**
 * Approve or reject a submission.
 *
 * Rejects outright if the submission is not pending, so a second approve cannot
 * double-apply a suggestion, and a rejected submission cannot later be approved
 * by a stale tab.
 */
export async function reviewSuggestion(
  db: Db,
  input: { suggestionId: number; reviewerId: number; decision: 'approve' | 'reject'; note?: string | null }
): Promise<ReviewResult> {
  const suggestion = await getSuggestion(db, input.suggestionId);
  if (!suggestion) {
    throw new ContributionError('not_found', 'No such submission.');
  }
  if (suggestion.status !== 'pending') {
    throw new ContributionError(
      'already_reviewed',
      `That submission was already ${suggestion.status}.`
    );
  }
  if (suggestion.submittedBy === input.reviewerId && suggestion.submittedBy !== null) {
    // Self-approval would make the review queue decorative. An admin may still
    // approve their own submission deliberately via the role check, but the
    // default path refuses.
    throw new ContributionError(
      'self_review',
      'You cannot review your own submission. Ask another editor to look at it.'
    );
  }

  const note = input.note?.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;

  if (input.decision === 'reject') {
    await db.query(
      `update suggestion
          set status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
        where id = $1 and status = 'pending'`,
      [input.suggestionId, input.reviewerId, note]
    );
    const updated = await getSuggestion(db, input.suggestionId);
    return { suggestion: updated ?? suggestion, applied: null };
  }

  // Apply first, then record the decision. If the write fails, the submission
  // stays pending and can be retried — the opposite order would mark it approved
  // and silently lose the contribution.
  const applied = await applySuggestion(db, suggestion);

  const finalStatus: ReviewStatus = applied.outcome === 'merged' ? 'merged' : 'approved';

  await db.query(
    `update suggestion
        set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
      where id = $1 and status = 'pending'`,
    [input.suggestionId, finalStatus, input.reviewerId, note ?? applied.detail]
  );

  const updated = await getSuggestion(db, input.suggestionId);
  return { suggestion: updated ?? suggestion, applied };
}
