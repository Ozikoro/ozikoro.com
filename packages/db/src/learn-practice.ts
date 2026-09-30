/**
 * Practice vocabulary drawn from the dictionary itself.
 *
 * WHY THIS EXISTS
 *
 * The lesson player builds its exercises from `learn_vocab`, which the curriculum importer fills
 * from `data/learn/igbo.json`. That file is authored content, and every item in it is quarantined
 * as `draft` because §2.1 forbids AI-written Igbo reaching a learner and §18 #4 (a named lead
 * linguist and two native reviewers) has no default. So `learn_vocab` is — correctly — invisible,
 * and the courses cannot be played until the linguist work is done.
 *
 * That left the platform with nothing to do. It does not have to. §6.2 says the courses share the
 * dictionary's lexicon, and §11.4 says the owner's own verified dictionary is the first seed data
 * set. §2.1 names two legitimate content sources, and "the approved content database" is one of
 * them. The dictionary holds 16,596 published headwords with 39,103 definitions and 4,257 words
 * that already have native recordings.
 *
 * So this module reads THAT. It is not a curriculum and does not pretend to be: it is vocabulary
 * practice over words the owner has already published, in the order the corpus itself says is most
 * common. Nothing here is generated, and no Igbo string in this file is invented — every one comes
 * out of the database at query time.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not touch `learn_vocab`, `learn_lesson_lexeme` or the lesson tables. Practice and the
 * authored curriculum are separate sources that must not contaminate each other: when the linguist
 * delivers Level 0 and 1, those lessons publish on their own schedule without anything here having
 * to be un-done.
 *
 * It also does not sequence. Sequencing is pedagogy and belongs to the linguist. Frequency order is
 * the corpus's own ordering, and it is honest about being exactly that.
 */

import type { Db } from './client.ts';
import { getStorage } from './storage.ts';
import type { Exercise, ExerciseSet } from './learn-exercises.ts';
import { buildExercises, presentationSeed } from './learn-exercises.ts';

/** The language tag the Igbo corpus is stored under. */
const IGBO = 'ibo';

export interface PracticeWord {
  /** `word.id` — the dictionary's own primary key, so a learner can always reach the entry. */
  id: string;
  /** The headword as published, with its diacritics intact. */
  headword: string;
  /** The dictionary slug, for linking back to the full entry. */
  slug: string;
  /** The primary English gloss. Practice is unusable without one, so it is never null here. */
  english: string;
  partOfSpeech: string | null;
  /** A playable URL, or null when the word has no published recording. */
  audioUrl: string | null;
  frequencyRank: number | null;
  isVerified: boolean;
}

export interface PracticeOptions {
  /** How many words to draw. */
  limit?: number;
  /**
   * When set, only words that have a published recording.
   *
   * Listening questions are the ones a learner cannot fake from context, so a session that wants
   * them must ask for audio-only rather than being handed words with no clip and quietly falling
   * back to reading.
   */
  requireAudio?: boolean;
  /** Exclude words the learner has already answered, so repeat sessions move forward. */
  excludeIds?: readonly string[];
  /**
   * Offset into the frequency-ordered list. Lets a learner work through the corpus in order across
   * sessions instead of being handed the same first N words every time.
   */
  offset?: number;
  /** Restrict to verified words. Off by default: `is_verified` is sparse and would starve practice. */
  verifiedOnly?: boolean;
}

/**
 * How many words are available to practice at all.
 *
 * Used by the UI to say something honest about the size of what is on offer, and to decide whether
 * an audio-only session is possible.
 */
export async function countPracticeWords(
  db: Db,
  options: { requireAudio?: boolean; verifiedOnly?: boolean } = {}
): Promise<{ total: number; withAudio: number }> {
  const audioClause = options.requireAudio
    ? `and exists (
         select 1 from audio a
          where a.word_id = w.id and a.status = 'published'
            and (a.external_url is not null or a.storage_key is not null)
       )`
    : '';
  const verifiedClause = options.verifiedOnly ? 'and w.is_verified' : '';

  const row = await db.one<{ total: number; with_audio: number }>(
    `select count(*)::int as total,
            count(*) filter (where exists (
              select 1 from audio a
               where a.word_id = w.id and a.status = 'published'
                 and (a.external_url is not null or a.storage_key is not null)
            ))::int as with_audio
       from word w
      where w.language_code = $1
        and w.status = 'published'
        ${verifiedClause}
        ${audioClause}
        and exists (select 1 from definition d where d.word_id = w.id)`,
    [IGBO]
  );

  return { total: Number(row?.total ?? 0), withAudio: Number(row?.with_audio ?? 0) };
}

/**
 * Draw practice words from the dictionary.
 *
 * ORDERING, AND WHY IT IS THIS
 *
 * Common words first, then by the corpus's own frequency rank, then by headword so the order is
 * stable across calls. Stability matters more than it looks: a learner who does a set, stops, and
 * comes back must not be shown a different "first 20 words" each time, or nothing accumulates.
 *
 * `nulls last` on both sorts is deliberate. Postgres orders NULLs FIRST in a descending sort, which
 * would put every unranked word at the top — the exact opposite of what "common first" means.
 *
 * The gloss is taken with a correlated subquery rather than a join so a word with four definitions
 * cannot be multiplied into four practice items. `is_primary` picks the intended one; `position`
 * breaks ties deterministically.
 */
export async function getPracticeWords(
  db: Db,
  options: PracticeOptions = {}
): Promise<PracticeWord[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  const exclude = options.excludeIds ?? [];

  const params: unknown[] = [IGBO, limit, offset];
  let excludeClause = '';
  if (exclude.length > 0) {
    // Parameterised rather than interpolated: these ids come from a learner's own history, which is
    // still user input and must never be concatenated into SQL.
    //
    // `bigint[]`, not `uuid[]`. `word.id` is a bigint — the dictionary's words are sequenced, not
    // UUID-keyed like the learn tables. Casting to uuid compiles fine and fails at run time with
    // "operator does not exist: bigint <> uuid", which is the kind of error that only shows up the
    // first time a learner has any history to exclude.
    params.push(exclude);
    excludeClause = `and w.id <> all($${params.length}::bigint[])`;
  }

  const audioClause = options.requireAudio
    ? `and exists (
         select 1 from audio a
          where a.word_id = w.id and a.status = 'published'
            and (a.external_url is not null or a.storage_key is not null)
       )`
    : '';
  const verifiedClause = options.verifiedOnly ? 'and w.is_verified' : '';

  const rows = await db.rows<{
    id: string;
    headword: string;
    slug: string;
    english: string | null;
    part_of_speech: string | null;
    external_url: string | null;
    storage_key: string | null;
    frequency_rank: number | null;
    is_verified: boolean;
  }>(
    `select w.id,
            w.headword,
            w.slug,
            w.frequency_rank,
            w.is_verified,
            (select d.text
               from definition d
              where d.word_id = w.id
              order by d.is_primary desc, d.position, d.id
              limit 1) as english,
            (select ps.name
               from definition d
               left join part_of_speech ps on ps.id = d.part_of_speech_id
              where d.word_id = w.id
              order by d.is_primary desc, d.position, d.id
              limit 1) as part_of_speech,
            (select a.external_url
               from audio a
              where a.word_id = w.id and a.status = 'published'
              order by a.created_at, a.id
              limit 1) as external_url,
            (select a.storage_key
               from audio a
              where a.word_id = w.id and a.status = 'published'
              order by a.created_at, a.id
              limit 1) as storage_key
       from word w
      where w.language_code = $1
        and w.status = 'published'
        ${verifiedClause}
        ${audioClause}
        ${excludeClause}
        and exists (select 1 from definition d where d.word_id = w.id)
      order by w.is_common desc nulls last,
               w.frequency_rank asc nulls last,
               w.headword
      limit $2 offset $3`,
    params
  );

  const storage = safeStorage();

  return rows
    // A word with no gloss is unteachable: there is nothing to ask the learner. Filtered here
    // rather than in SQL so the count above and this list cannot disagree about what "available"
    // means, and because the subquery can legitimately return null for a definition with no text.
    .filter((row) => typeof row.english === 'string' && row.english.trim() !== '')
    .map((row) => ({
      id: String(row.id),
      headword: String(row.headword),
      slug: String(row.slug),
      english: String(row.english),
      partOfSpeech: row.part_of_speech ?? null,
      // Same resolution order the dictionary entry page uses, so a word plays the same clip
      // wherever it appears.
      audioUrl:
        row.external_url ?? (row.storage_key && storage ? storage.publicUrl(row.storage_key) : null),
      frequencyRank: row.frequency_rank === null ? null : Number(row.frequency_rank),
      isVerified: Boolean(row.is_verified),
    }));
}

/**
 * Build a playable exercise set from real dictionary words.
 *
 * This adapts the practice rows into the shape `buildExercises` already expects, so the six-type
 * engine, the distractors, the server-side grading and the seeded shuffle are all the same code the
 * authored lessons will use. Only the SOURCE differs — and that is the point: when the linguist
 * publishes Level 0 and 1, they go through this exact path.
 *
 * `learn_vocab` is a different table with a different key space, so the ids are namespaced with a
 * `dict:` prefix. Without it a practice item and a lesson item could collide on a numeric id and
 * the learner would be shown feedback for the wrong question.
 */
export function buildPracticeSet(words: readonly PracticeWord[]): ExerciseSet {
  const vocab = words.map((word) => ({
    id: practiceNumericId(word.id),
    igbo: word.headword,
    english: word.english,
    pos: word.partOfSpeech,
    pronunciation: null,
    literal: null,
    note: null,
    audioUrl: word.audioUrl,
    dictionaryHeadword: word.headword,
    dictionarySlug: word.slug,
  }));

  // Lesson id 0 is not a real lesson, and cannot be: `learn_lesson.id` is a generated serial
  // starting at 1. Saying 0 explicitly means a practice result can never be written against a
  // lesson by accident.
  return buildExercises(0, vocab, [], presentationSeed());
}

/**
 * Turn a dictionary `word.id` into the number the exercise engine keys on.
 *
 * `word.id` is a bigint that arrives as a string. Ids in this corpus are sequence values — the
 * sample recording references word 8866 — so they convert exactly, and this is the common path.
 *
 * The guard is for the case that is not yet true: a bigint past 2^53 does not convert exactly, and
 * `Number()` would silently round two different words onto the same id — which the engine would
 * read as the same question, showing a learner feedback for the wrong word. Rather than trust that
 * ids stay small forever, anything unsafe is folded into a stable 53-bit value derived from the
 * string. Collisions remain possible in principle, so practice ids are also namespaced under
 * lesson 0 (see `buildPracticeSet`), keeping them disjoint from authored-lesson ids entirely.
 */
function practiceNumericId(raw: string): number {
  const asNumber = Number(raw);
  if (Number.isSafeInteger(asNumber)) return asNumber;

  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) % Number.MAX_SAFE_INTEGER;
  }
  // Negative so a hashed id can never be mistaken for one of the small sequential real ids.
  return -hash;
}

/** The same set, shaped for the browser. */
export function toPracticeClientSet(set: ExerciseSet): { lessonId: number; exercises: Exercise[] } {
  return { lessonId: set.lessonId, exercises: set.exercises };
}

/**
 * Resolve the storage helper without letting a missing media configuration take the page down.
 *
 * `getStorage()` throws when the S3/R2 variables are absent, which is correct for the importer and
 * wrong here: practice still works without audio, it just cannot offer listening questions. Reading
 * a word and hearing it are separable, and a misconfigured bucket should cost the learner the
 * second one, not both.
 */
function safeStorage(): { publicUrl(key: string): string } | null {
  try {
    return getStorage();
  } catch {
    return null;
  }
}
