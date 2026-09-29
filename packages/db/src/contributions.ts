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
import {
  deriveForms,
  languageUrlSlug,
  requireLanguage,
  slugify,
  type LanguageDefinition,
} from '@ozituma/core';
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
  | 'proverb_edit'
  | 'word_edit'
  | 'name_edit'
  | 'clan_edit';

const GENDERS: readonly string[] = ['unisex', 'male', 'female'];

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

/**
 * A proposed edit to a dictionary entry.
 *
 * Meanings travel as one text block, a line each, because that is what the page shows: an ordered
 * list. `definition` rows are rewritten from it on approval, and the previous list is recorded
 * whole, so an edit is reversible and a source's wording is never destroyed silently.
 */
export interface WordEditPayload {
  wordId: number;
  previousHeadword: string;
  previousMeanings: string;
  headword: string;
  meanings: string;
  /**
   * The example sentences, in the order they should be read.
   *
   * The owner asked for these to be editable: "a contributor and user should be able to edit
   * everything, including the examples, dialect, meanings". A sentence carries both languages, so
   * the pair travels together rather than as two lists that could drift out of step.
   */
  /**
   * The examples, each naming the row it IS when it already exists.
   *
   * The id is what makes this safe. The page shows two examples while an entry may hold eight, so
   * matching by position meant an edit to the first of the two rewrote the first two rows and then
   * dropped the links to the other six — one correction, six examples gone from the entry. With the
   * id, an edit touches the row it was shown and nothing else, and rows the form never displayed are
   * never mentioned again.
   */
  examples: Array<{ exampleId: number | null; text: string; translation: string | null }>;
  previousExamples: Array<{ exampleId: number | null; text: string; translation: string | null }>;
  /**
   * The dialect spellings, one per variety that says the word differently.
   *
   * Only the ones with a spelling: a variety that uses the headword's own spelling has nothing to
   * record, which is how the section already treats it.
   */
  dialects: Array<{ dialectCode: string; spelling: string }>;
  previousDialects: Array<{ dialectCode: string; spelling: string }>;
  note?: string | null;
}

/** A proposed edit to a personal name: spelling, meaning, gender and variants. */
export interface NameEditPayload {
  nameId: number;
  previousName: string;
  previousMeaning: string;
  previousGender: string;
  previousVariants: string[];
  name: string;
  meaning: string;
  gender: string;
  variants: string[];
  note?: string | null;
}

/**
 * A proposed edit to a clan entry.
 *
 * The registry has gaps the people reading it can fill — 196 of 201 entries have no state recorded,
 * because the records came from a survey that located a group by colonial division. So `states` and
 * `lgas` are the point of this as much as the description is: they are what a reader in the place
 * knows and the file does not.
 */
export interface ClanEditPayload {
  clanId: number;
  previousName: string;
  previousOrigin: string;
  previousDescription: string[];
  previousStates: string[];
  previousLgas: string[];
  previousTowns: string[];
  name: string;
  origin: string;
  description: string[];
  states: string[];
  lgas: string[];
  towns: string[];
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
  /**
   * A link to the thing being edited, resolved from the ids in the payload.
   *
   * Null when the row it pointed at has since been deleted, which is honest: the queue then shows
   * the proposal without a link rather than a link to nothing.
   */
  target?: SuggestionTarget | null;
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
  /**
   * Who is submitting, or null for an editor entering something directly.
   *
   * Null is a real case and not a missing argument: it is what distinguishes editorial work from a
   * community submission, and `applySuggestion` reads it to choose the attribution source. The
   * parameter was typed `number`, which was simply wrong — the API always passes an account, so
   * nothing caught it until a test submitted as the editor.
   */
  accountId: number | null,
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

    case 'word_edit': {
      const raw = (input.payload ?? {}) as Partial<WordEditPayload>;
      const wordId = Number(raw.wordId);
      if (!Number.isInteger(wordId) || wordId <= 0) {
        throw new ContributionError('invalid_submission', 'An entry edit must name the entry.');
      }
      const previousHeadword = requireText(raw.previousHeadword, 'previousHeadword', MAX_HEADWORD);
      const headword = requireText(raw.headword, 'headword', MAX_HEADWORD);
      const previousMeanings = String(raw.previousMeanings ?? '').trim();
      const meanings = String(raw.meanings ?? '').trim();

      const readExamples = (value: unknown) =>
        (Array.isArray(value) ? value : [])
          .map((row) => {
            const record = (row ?? {}) as { exampleId?: unknown; text?: unknown; translation?: unknown };
            const id = Number(record.exampleId);
            return {
              exampleId: Number.isInteger(id) && id > 0 ? id : null,
              text: String(record.text ?? '').trim().slice(0, MAX_TEXT),
              translation: String(record.translation ?? '').trim().slice(0, MAX_TEXT) || null,
            };
          })
          .filter((row) => row.text.length > 0)
          .slice(0, 12);
      const examples = readExamples(raw.examples);
      const previousExamples = readExamples(raw.previousExamples);

      const readDialects = (value: unknown) =>
        (Array.isArray(value) ? value : [])
          .map((row) => {
            const record = (row ?? {}) as { dialectCode?: unknown; spelling?: unknown };
            return {
              dialectCode: String(record.dialectCode ?? '').trim().slice(0, 20),
              spelling: String(record.spelling ?? '').trim().slice(0, MAX_HEADWORD),
            };
          })
          .filter((row) => row.dialectCode.length > 0 && row.spelling.length > 0)
          .slice(0, 60);
      const dialects = readDialects(raw.dialects);
      const previousDialects = readDialects(raw.previousDialects);

      const same =
        headword === previousHeadword &&
        meanings === previousMeanings &&
        JSON.stringify(examples) === JSON.stringify(previousExamples) &&
        JSON.stringify(dialects) === JSON.stringify(previousDialects);
      if (same) {
        throw new ContributionError('invalid_submission', 'That edit changes nothing.');
      }
      for (const row of examples) {
        rejectControlCharacters(row.text, 'examples');
        if (row.translation) rejectControlCharacters(row.translation, 'examples');
      }
      for (const row of dialects) rejectControlCharacters(row.spelling, 'dialects');
      rejectControlCharacters(headword, 'headword');
      if (meanings) rejectControlCharacters(meanings, 'meanings');
      payload = {
        wordId,
        previousHeadword,
        previousMeanings,
        headword,
        meanings,
        examples,
        previousExamples,
        dialects,
        previousDialects,
        note: optionalText(raw.note, 'note', MAX_NOTE),
      };
      break;
    }

    case 'name_edit': {
      const raw = (input.payload ?? {}) as Partial<NameEditPayload>;
      const nameId = Number(raw.nameId);
      if (!Number.isInteger(nameId) || nameId <= 0) {
        throw new ContributionError('invalid_submission', 'A name edit must name the entry.');
      }
      const previousName = requireText(raw.previousName, 'previousName', MAX_HEADWORD);
      const name = requireText(raw.name, 'name', MAX_HEADWORD);
      const previousMeaning = String(raw.previousMeaning ?? '').trim();
      const meaning = String(raw.meaning ?? '').trim();
      const previousGender = String(raw.previousGender ?? '').trim();
      const gender = String(raw.gender ?? '').trim();
      if (!GENDERS.includes(gender)) {
        throw new ContributionError('invalid_submission', 'A gender is one of unisex, male or female.');
      }
      const variants = (Array.isArray(raw.variants) ? raw.variants : [])
        .map((v) => String(v).trim())
        .filter((v) => v.length > 0)
        .slice(0, 40);
      const previousVariants = (Array.isArray(raw.previousVariants) ? raw.previousVariants : [])
        .map((v) => String(v).trim())
        .filter((v) => v.length > 0);
      const same =
        name === previousName &&
        meaning === previousMeaning &&
        gender === previousGender &&
        variants.join('|') === previousVariants.join('|');
      if (same) {
        throw new ContributionError('invalid_submission', 'That edit changes nothing.');
      }
      rejectControlCharacters(name, 'name');
      if (meaning) rejectControlCharacters(meaning, 'meaning');
      for (const v of variants) rejectControlCharacters(v, 'variants');
      payload = {
        nameId,
        previousName,
        previousMeaning,
        previousGender,
        previousVariants,
        name,
        meaning,
        gender,
        variants,
        note: optionalText(raw.note, 'note', MAX_NOTE),
      };
      break;
    }

    case 'clan_edit': {
      const raw = (input.payload ?? {}) as Partial<ClanEditPayload>;
      const clanId = Number(raw.clanId);
      if (!Number.isInteger(clanId) || clanId <= 0) {
        throw new ContributionError('invalid_submission', 'A clan edit must name the entry.');
      }
      const readList = (value: unknown, max: number) =>
        (Array.isArray(value) ? value : [])
          .map((item) => String(item).trim().slice(0, 120))
          .filter((item) => item.length > 0)
          .slice(0, max);
      const readParagraphs = (value: unknown) =>
        (Array.isArray(value) ? value : [])
          .map((item) => String(item).trim().slice(0, MAX_TEXT))
          .filter((item) => item.length > 0)
          .slice(0, 20);

      const name = requireText(raw.name, 'name', MAX_HEADWORD);
      const origin = String(raw.origin ?? '').trim().slice(0, MAX_TEXT);
      const description = readParagraphs(raw.description);
      const states = readList(raw.states, 20);
      const lgas = readList(raw.lgas, 40);
      const towns = readList(raw.towns, 400);
      const previousName = requireText(raw.previousName, 'previousName', MAX_HEADWORD);
      const previousOrigin = String(raw.previousOrigin ?? '').trim();
      const previousDescription = readParagraphs(raw.previousDescription);
      const previousStates = readList(raw.previousStates, 20);
      const previousLgas = readList(raw.previousLgas, 40);
      const previousTowns = readList(raw.previousTowns, 400);

      const same =
        name === previousName &&
        origin === previousOrigin &&
        JSON.stringify(description) === JSON.stringify(previousDescription) &&
        JSON.stringify(states) === JSON.stringify(previousStates) &&
        JSON.stringify(lgas) === JSON.stringify(previousLgas) &&
        JSON.stringify(towns) === JSON.stringify(previousTowns);
      if (same) throw new ContributionError('invalid_submission', 'That edit changes nothing.');

      rejectControlCharacters(name, 'name');
      if (origin) rejectControlCharacters(origin, 'origin');
      for (const p of description) rejectControlCharacters(p, 'description');
      for (const v of [...states, ...lgas, ...towns]) rejectControlCharacters(v, 'places');

      payload = {
        clanId, previousName, previousOrigin, previousDescription, previousStates, previousLgas,
        previousTowns, name, origin, description, states, lgas, towns,
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

    /*
     * An administrator's own edit is the decision, not a request for one.
     *
     * The owner, after editing Ohaffia to Ohafia and being told "This is your own
     * submission, so you cannot review it. Ask another editor": "how can i edit
     * something as the admin, and i am being asked this instead of getting applied
     * immediately. fix this and recognise that admin has all authorities."
     *
     * He is right, and the queue was decoration in the wrong direction: an editor
     * exists to check other people's work, and there is nobody above an
     * administrator to check theirs. So a submission from an admin or the owner is
     * applied at once, and the review row still records who decided and why — the
     * trail is kept, the waiting is not.
     *
     * If applying fails the submission is left pending rather than lost, and the
     * reason is returned so the page can say what happened.
     */
    const submitter = accountId
      ? await db.one<{ role: string }>(`select role from account where id = $1`, [accountId])
      : null;
    const holdsAuthority = submitter?.role === 'admin' || submitter?.role === 'owner';

    if (accountId && holdsAuthority) {
      const created = await getSuggestion(db, Number(row.id));
      if (created) {
        try {
          const applied = await applySuggestion(db, created, accountId);
          const status: ReviewStatus = applied.outcome === 'merged' ? 'merged' : 'approved';
          await db.query(
            `update suggestion
                set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
              where id = $1`,
            [
              Number(row.id),
              status,
              accountId,
              'Applied on submission: this account holds administrative authority.',
            ]
          );
          return { id: Number(row.id), uuid: row.uuid, kind: input.kind, status };
        } catch (error) {
          console.error('[contributions] an administrator\'s submission could not be applied', error);
        }
      }
    }

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

/** A payload field that should be a list of strings, whatever it arrived as. */
function asStringList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);
}

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

/**
 * Where the thing being edited actually lives, so a reviewer can open it.
 *
 * The owner: "When you show me request on the admin dashboard from contributors, please also show or
 * add the direct link to the particular edit... At least when i go to the dashboard to see the edits,
 * I can easily see the direct link to the edited words, names, proverbs or anything edited by the
 * contributors."
 *
 * A queue that shows only the proposed text makes a reviewer hunt for the entry by hand, and the
 * entry may have been renamed since. The ids in the payload are the ones the submission was made
 * against, so they resolve to a real page even when a spelling has changed. Resolved with a handful
 * of small queries rather than by joining on JSON: the ids differ by kind, and a join would have to
 * know that.
 */
export interface SuggestionTarget {
  label: string;
  url: string;
  /** What kind of thing it is, for the queue's own wording. */
  what: 'word' | 'name' | 'proverb';
}

async function resolveTargets(
  db: Db,
  records: SuggestionRecord[]
): Promise<Map<number, SuggestionTarget>> {
  const out = new Map<number, SuggestionTarget>();

  const wordIds = new Set<number>();
  const nameIds = new Set<number>();
  const exampleIds = new Set<number>();

  for (const record of records) {
    const payload = record.payload ?? {};
    if (record.targetWordId !== null) wordIds.add(record.targetWordId);
    const nameId = Number(payload.nameId);
    if (record.kind === 'name_edit' && Number.isInteger(nameId) && nameId > 0) nameIds.add(nameId);
    const exampleId = Number(payload.exampleId);
    if (record.kind === 'proverb_edit' && Number.isInteger(exampleId) && exampleId > 0) {
      exampleIds.add(exampleId);
    }
  }

  const words = new Map<number, { label: string; url: string }>();
  if (wordIds.size > 0) {
    for (const row of await db.rows<{ id: string; headword: string; slug: string; language_code: string }>(
      `select id, headword, slug, language_code from word where id = any($1::bigint[])`,
      [[...wordIds]]
    )) {
      words.set(Number(row.id), {
        label: row.headword,
        url: `/word/${languageUrlSlug(row.language_code)}/${encodeURIComponent(row.slug)}`,
      });
    }
  }

  const names = new Map<number, { label: string; url: string }>();
  if (nameIds.size > 0) {
    for (const row of await db.rows<{ id: string; name: string; slug: string }>(
      `select id, name, slug from person_name where id = any($1::bigint[])`,
      [[...nameIds]]
    )) {
      names.set(Number(row.id), {
        label: row.name,
        url: `/names/${encodeURIComponent(row.slug)}`,
      });
    }
  }

  const proverbs = new Map<number, { label: string }>();
  if (exampleIds.size > 0) {
    for (const row of await db.rows<{ id: string; text: string }>(
      `select id, text from example where id = any($1::bigint[])`,
      [[...exampleIds]]
    )) {
      proverbs.set(Number(row.id), { label: row.text });
    }
  }

  for (const record of records) {
    const payload = record.payload ?? {};
    if (record.kind === 'name_edit') {
      const found = names.get(Number(payload.nameId));
      if (found) out.set(record.id, { ...found, what: 'name' });
      continue;
    }
    if (record.kind === 'proverb_edit') {
      const found = proverbs.get(Number(payload.exampleId));
      if (found) {
        out.set(record.id, { label: found.label, url: `/proverbs/${Number(payload.exampleId)}`, what: 'proverb' });
      }
      continue;
    }
    if (record.targetWordId !== null) {
      const found = words.get(record.targetWordId);
      if (found) out.set(record.id, { ...found, what: 'word' });
    }
  }

  return out;
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

  const records = rows.map(normaliseSuggestion);
  const targets = await resolveTargets(db, records);
  return {
    data: records.map((record) => ({ ...record, target: targets.get(record.id) ?? null })),
    total: Number(totalRow?.n ?? 0),
  };
}

export async function getSuggestion(db: Db, id: number): Promise<SuggestionRecord | null> {
  const row = await db.one<Record<string, unknown>>(`${SUGGESTION_SELECT} where s.id = $1`, [id]);
  if (!row) return null;
  const record = normaliseSuggestion(row);
  const targets = await resolveTargets(db, [record]);
  return { ...record, target: targets.get(record.id) ?? null };
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
async function applySuggestion(
  db: Db,
  suggestion: SuggestionRecord,
  reviewerId: number | null = null
): Promise<ApplyResult> {
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
        // The reviewer is passed in rather than read off the suggestion: the
        // suggestion is marked reviewed AFTER this runs, so reading it here gave
        // a revision row with nobody's name on it — which is the one field an
        // audit trail cannot afford to lose.
        reviewerId,
      ]
    );

    if (!alreadySame) {
      await db.query(
        `update example
            set text = $1, search_form = $2, translation = $3,
                -- The cast matters: Postgres cannot infer the type of a bare
                -- parameter inside a CASE, and the whole approval failed with
                -- "could not determine data type of parameter $3" until it was
                -- told. Found by running the flow, not by reading it.
                translation_language_code = case when $3::text is null then null else 'eng' end
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

  if (suggestion.kind === 'word_edit') {
    const wordId = Number(suggestion.payload.wordId ?? 0);
    const previousHeadword = String(suggestion.payload.previousHeadword ?? '').trim();
    const nextHeadword = String(suggestion.payload.headword ?? '').trim();
    const previousMeanings = String(suggestion.payload.previousMeanings ?? '').trim();
    const nextMeanings = String(suggestion.payload.meanings ?? '').trim();
    if (!Number.isInteger(wordId) || wordId <= 0 || nextHeadword.length === 0) {
      throw new ContributionError('invalid_submission', 'That entry edit is incomplete.');
    }

    const row = await db.one<{ id: string; headword: string; language_code: string }>(
      `select id, headword, language_code from word where id = $1`,
      [wordId]
    );
    if (!row) throw new ContributionError('invalid_submission', 'That entry no longer exists.');

    // The entry moved under the proposer's feet. Refused rather than applied over the top of a
    // change they never saw — the same rule the proverb edit follows, for the same reason.
    if (row.headword.trim() !== previousHeadword && previousHeadword.length > 0) {
      throw new ContributionError(
        'conflict',
        `This entry is now spelled "${row.headword}" and was "${previousHeadword}" when that edit was proposed, so it was not applied.`
      );
    }

    const current = await db.rows<{ text: string }>(
      `select text from definition where word_id = $1 order by position, id`,
      [wordId]
    );
    const currentMeanings = current.map((d) => d.text).join('\n');
    if (currentMeanings.trim() !== previousMeanings && previousMeanings.length > 0) {
      throw new ContributionError(
        'conflict',
        'The meanings have changed since that edit was proposed, so it was not applied.'
      );
    }

    const alreadySame = row.headword.trim() === nextHeadword && currentMeanings.trim() === nextMeanings;

    await db.query(
      `insert into word_revision
         (word_id, suggestion_id, previous_headword, previous_meanings, headword, meanings,
          proposed_by, approved_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        wordId,
        suggestion.id,
        row.headword,
        currentMeanings,
        nextHeadword,
        nextMeanings,
        suggestion.submittedBy,
        reviewerId,
      ]
    );

    if (!alreadySame) {
      if (row.headword.trim() !== nextHeadword) {
        const fields = deriveForms(nextHeadword, language);
        await db.query(
          `update word set headword = $1, exact_form = $2, search_form = $3 where id = $4`,
          [nextHeadword, fields.exactForm, fields.searchForm, wordId]
        );
      }
      if (currentMeanings.trim() !== nextMeanings) {
        const lines = nextMeanings
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        /*
         * The list is rewritten in place, row by row, rather than deleted and re-inserted.
         *
         * A `definition` row carries more than its text: the part of speech recorded for that
         * sense, whether it is the primary one, and which source printed it. Deleting the list and
         * writing a new one from the form throws all of that away, so an editor correcting a
         * spelling would silently strip the grammar off every sense of the entry. Existing rows
         * keep their identity and only their text changes; the list grows or shrinks at the end.
         */
        const existing = await db.rows<{ id: string }>(
          `select id from definition where word_id = $1 order by position, id`,
          [wordId]
        );
        const shared = Math.min(existing.length, lines.length);

        for (let index = 0; index < shared; index += 1) {
          const target = existing[index];
          if (!target) continue;
          await db.query(`update definition set text = $1 where id = $2`, [
            lines[index],
            target.id,
          ]);
        }
        for (let index = existing.length; index < lines.length; index += 1) {
          await db.query(
            `insert into definition (word_id, language_code, text, position, is_primary, source_id)
             values ($1, 'eng', $2, $3, false, $4)`,
            [wordId, lines[index], index, sourceId]
          );
        }
        if (existing.length > lines.length) {
          await db.query(
            `delete from definition
              where id = any($1::bigint[])`,
            [existing.slice(lines.length).map((r) => Number(r.id))]
          );
        }
      }
    }

    /*
     * Examples and dialect spellings, rewritten the same way the meanings are: in place, matched by
     * position, with the list growing or shrinking at the end.
     *
     * An `example` row is a sentence with its translation and its own attribution; a `word_dialect`
     * row is a spelling attached to a variety. Deleting and re-inserting either would throw away
     * what the row knows about itself — the source that printed the sentence, the recording attached
     * to the spelling — so nothing is deleted that is not genuinely gone from the list.
     */
    const nextExamples = (Array.isArray(suggestion.payload.examples) ? suggestion.payload.examples : []) as Array<{
      exampleId: number | null;
      text: string;
      translation: string | null;
    }>;
    const previousExamples = (Array.isArray(suggestion.payload.previousExamples)
      ? suggestion.payload.previousExamples
      : []) as Array<{ exampleId: number | null; text: string; translation: string | null }>;

    if (JSON.stringify(nextExamples) !== JSON.stringify(previousExamples)) {
      /*
       * By id, one row at a time. Nothing is deleted and nothing is matched by position.
       *
       * The page shows two examples; an entry may hold eight. Position-matching against the whole
       * list is what made an edit to a visible example drop the links to the invisible ones, so this
       * only ever touches a row the form named: an id updates that row, and no id inserts a new one.
       * Examples the form did not display are left exactly as they are, which is the only outcome
       * that can be right — the proposer never saw them and cannot have meant to change them.
       */
      for (const wanted of nextExamples) {
        if (wanted.exampleId === null) {
          const created = await db.one<{ id: string }>(
            `insert into example (language_code, text, search_form, translation, style, status, source_id)
             values ($1, $2, $3, $4, 'colloquial', 'published', $5) returning id`,
            [
              languageCode,
              wanted.text,
              deriveForms(wanted.text, language).searchForm,
              wanted.translation,
              sourceId,
            ]
          );
          if (created) {
            await db.query(`insert into example_word (example_id, word_id) values ($1, $2)`, [
              Number(created.id),
              wordId,
            ]);
          }
          continue;
        }
        // Scoped to this word: an id from the form must be an example OF this entry, or a doctored
        // submission could rewrite a sentence belonging to another one.
        await db.query(
          `update example e set text = $1, translation = $2
             from example_word ew
            where e.id = ew.example_id and ew.word_id = $3 and e.id = $4`,
          [wanted.text, wanted.translation, wordId, wanted.exampleId]
        );
      }
    }

    const nextDialects = (Array.isArray(suggestion.payload.dialects) ? suggestion.payload.dialects : []) as Array<{
      dialectCode: string;
      spelling: string;
    }>;
    const previousDialects = (Array.isArray(suggestion.payload.previousDialects)
      ? suggestion.payload.previousDialects
      : []) as Array<{ dialectCode: string; spelling: string }>;

    if (JSON.stringify(nextDialects) !== JSON.stringify(previousDialects)) {
      const currentDialects = await db.rows<{ id: string; dialect_id: string; spelling: string }>(
        `select wd.id, wd.dialect_id, wd.spelling
           from word_dialect wd join dialect d on d.id = wd.dialect_id
          where wd.word_id = $1 and d.language_code = $2
          order by wd.id`,
        [wordId, languageCode]
      );
      const dialectIds = new Map<string, number>();
      for (const row of await db.rows<{ id: string; code: string }>(
        `select id, code from dialect where language_code = $1`,
        [languageCode]
      )) {
        dialectIds.set(row.code.toUpperCase(), Number(row.id));
      }

      const keptIds = new Set<number>();
      for (const wanted of nextDialects) {
        const dialectId = dialectIds.get(wanted.dialectCode.toUpperCase());
        if (dialectId === undefined) continue;
        const existing = currentDialects.find(
          (row) => Number(row.dialect_id) === dialectId
        );
        if (existing) {
          keptIds.add(Number(existing.id));
          if (existing.spelling !== wanted.spelling) {
            await db.query(`update word_dialect set spelling = $1, search_form = $2 where id = $3`, [
              wanted.spelling,
              deriveForms(wanted.spelling, language).searchForm,
              existing.id,
            ]);
          }
        } else {
          await db.query(
            `insert into word_dialect (word_id, dialect_id, spelling, search_form)
             values ($1, $2, $3, $4) on conflict do nothing`,
            [wordId, dialectId, wanted.spelling, deriveForms(wanted.spelling, language).searchForm]
          );
        }
      }
      const removed = currentDialects
        .filter((row) => !keptIds.has(Number(row.id)))
        .map((row) => Number(row.id));
      if (removed.length > 0) {
        // A spelling with a recording keeps its row: the recording is attached to it, and dropping
        // the row would take the audio with it.
        await db.query(
          `delete from word_dialect wd
            where wd.id = any($1::bigint[])
              and not exists (select 1 from audio a where a.word_dialect_id = wd.id)`,
          [removed]
        );
      }
    }

    return {
      outcome: alreadySame ? 'noop' : 'approved',
      wordId,
      definitionsAdded: 0,
      detail: alreadySame
        ? 'The entry already said that; the revision was recorded and nothing changed.'
        : `Entry ${wordId} updated to "${nextHeadword}".`,
    };
  }

  if (suggestion.kind === 'name_edit') {
    const nameId = Number(suggestion.payload.nameId ?? 0);
    const previousName = String(suggestion.payload.previousName ?? '').trim();
    const nextName = String(suggestion.payload.name ?? '').trim();
    const nextMeaning = String(suggestion.payload.meaning ?? '').trim() || null;
    const nextGender = String(suggestion.payload.gender ?? '').trim();
    const nextVariants = (Array.isArray(suggestion.payload.variants) ? suggestion.payload.variants : [])
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
    if (!Number.isInteger(nameId) || nameId <= 0 || nextName.length === 0) {
      throw new ContributionError('invalid_submission', 'That name edit is incomplete.');
    }

    const row = await db.one<{
      id: string;
      name: string;
      meaning: string | null;
      gender: string;
      gender_basis: string | null;
      variants: string[] | null;
    }>(
      `select id, name, meaning, gender, gender_basis, variants from person_name where id = $1`,
      [nameId]
    );
    if (!row) throw new ContributionError('invalid_submission', 'That name no longer exists.');
    if (row.name.trim() !== previousName && previousName.length > 0) {
      throw new ContributionError(
        'conflict',
        `This name is now written "${row.name}" and was "${previousName}" when that edit was proposed, so it was not applied.`
      );
    }

    const currentVariants = row.variants ?? [];
    const alreadySame =
      row.name.trim() === nextName &&
      (row.meaning ?? '') === (nextMeaning ?? '') &&
      row.gender === nextGender &&
      currentVariants.join('|') === nextVariants.join('|');

    await db.query(
      `insert into name_revision
         (person_name_id, suggestion_id, previous_name, previous_meaning, previous_gender,
          previous_variants, name, meaning, gender, variants, proposed_by, approved_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        nameId,
        suggestion.id,
        row.name,
        row.meaning,
        row.gender,
        currentVariants,
        nextName,
        nextMeaning,
        nextGender,
        nextVariants,
        suggestion.submittedBy,
        reviewerId,
      ]
    );

    if (!alreadySame) {
      const slug = slugify(nextName).slice(0, 80);
      await db.query(
        `update person_name
            set name = $1,
                search_form = $2,
                slug = case when name = $1 then slug else $3 end,
                meaning = $4,
                gender = $5,
                -- A stated gender is the owner's or an editor's word, not the morpheme rule's,
                -- so the basis moves with it. Leaving the old basis would have the gate claim a
                -- derivation that no longer applies.
                gender_basis = case when $5 = 'unisex' then 'unisex' else 'owner' end,
                variants = $6
          where id = $7`,
        [nextName, deriveForms(nextName).searchForm, slug, nextMeaning, nextGender, nextVariants, nameId]
      );
    }

    return {
      outcome: alreadySame ? 'noop' : 'approved',
      wordId: null,
      definitionsAdded: 0,
      detail: alreadySame
        ? 'The name already said that; the revision was recorded and nothing changed.'
        : `Name ${nameId} updated to "${nextName}".`,
    };
  }

  if (suggestion.kind === 'clan_edit') {
    const clanId = Number(suggestion.payload.clanId ?? 0);
    const nextName = String(suggestion.payload.name ?? '').trim();
    const nextOrigin = String(suggestion.payload.origin ?? '').trim() || null;
    const nextDescription = asStringList(suggestion.payload.description);
    const nextStates = asStringList(suggestion.payload.states);
    const nextLgas = asStringList(suggestion.payload.lgas);
    const nextTowns = asStringList(suggestion.payload.towns);
    const previousName = String(suggestion.payload.previousName ?? '').trim();
    if (!Number.isInteger(clanId) || clanId <= 0 || nextName.length === 0) {
      throw new ContributionError('invalid_submission', 'That clan edit is incomplete.');
    }

    const row = await db.one<{
      id: string;
      name: string;
      origin_summary: string | null;
      description: string[] | null;
      states: string[] | null;
      lgas: string[] | null;
    }>(
      `select id, name, origin_summary, description, states, lgas from clan where id = $1`,
      [clanId]
    );
    if (!row) throw new ContributionError('invalid_submission', 'That entry no longer exists.');
    if (row.name.trim() !== previousName && previousName.length > 0) {
      throw new ContributionError(
        'conflict',
        `This entry is now named "${row.name}" and was "${previousName}" when that edit was proposed, so it was not applied.`
      );
    }

    const currentTowns = (
      await db.rows<{ name: string }>(
        `select name from clan_town where clan_id = $1 order by name`,
        [clanId]
      )
    ).map((t) => t.name);

    const alreadySame =
      row.name.trim() === nextName &&
      (row.origin_summary ?? '') === (nextOrigin ?? '') &&
      JSON.stringify(row.description ?? []) === JSON.stringify(nextDescription) &&
      JSON.stringify(row.states ?? []) === JSON.stringify(nextStates) &&
      JSON.stringify(row.lgas ?? []) === JSON.stringify(nextLgas) &&
      JSON.stringify(currentTowns) === JSON.stringify([...nextTowns].sort());

    await db.query(
      `insert into clan_revision
         (clan_id, suggestion_id, previous_name, previous_origin, previous_description,
          previous_states, previous_lgas, previous_towns, name, origin, description, states, lgas,
          towns, proposed_by, approved_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        clanId, suggestion.id, row.name, row.origin_summary, row.description ?? [],
        row.states ?? [], row.lgas ?? [], currentTowns, nextName, nextOrigin, nextDescription,
        nextStates, nextLgas, nextTowns, suggestion.submittedBy, reviewerId,
      ]
    );

    if (!alreadySame) {
      await db.query(
        `update clan
            set name = $1, slug = $2, origin_summary = $3, description = $4,
                states = $5, lgas = $6, updated_at = now()
          where id = $7`,
        [nextName, slugify(nextName), nextOrigin, nextDescription, nextStates, nextLgas, clanId]
      );

      /*
       * The towns, reconciled by name: the ones that are new are added and the ones no longer listed
       * are removed. Nothing is deleted that is still in the list, so a town keeps its row — and its
       * head marker, which says which town leads the group.
       */
      for (const town of nextTowns) {
        await db.query(
          `insert into clan_town (clan_id, name) values ($1, $2) on conflict do nothing`,
          [clanId, town]
        );
      }
      const keep = new Set(nextTowns);
      const drop = currentTowns.filter((name) => !keep.has(name));
      if (drop.length > 0) {
        await db.query(`delete from clan_town where clan_id = $1 and name = any($2::text[])`, [
          clanId,
          drop,
        ]);
      }
    }

    return {
      outcome: alreadySame ? 'noop' : 'approved',
      wordId: null,
      definitionsAdded: 0,
      detail: alreadySame
        ? 'The entry already said that; the revision was recorded and nothing changed.'
        : `Clan ${clanId} updated to "${nextName}".`,
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
    /*
     * Self-approval would make the review queue decorative — for an editor. An
     * administrator and the owner are the top of the ladder and have nobody above
     * them to ask, so the rule stops where it stops making sense. Without this the
     * owner was locked out of deciding anything he had typed himself, which is what
     * he met when he corrected a spelling and was told to ask another editor.
     */
    const reviewer = await db.one<{ role: string }>(
      `select role from account where id = $1`,
      [input.reviewerId]
    );
    const holdsAuthority = reviewer?.role === 'admin' || reviewer?.role === 'owner';
    if (!holdsAuthority) {
      throw new ContributionError(
        'self_review',
        'You cannot review your own submission. Ask another editor to look at it.'
      );
    }
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
  const applied = await applySuggestion(db, suggestion, input.reviewerId);

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
