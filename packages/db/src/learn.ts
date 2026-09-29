/**
 * Ozituma Learn — the curriculum data layer.
 *
 * This module is the only thing that reads `learn_*` tables, so the shape of a
 * course is defined in one place and every caller agrees about it.
 *
 * WHY THE LESSON BODY IS A TYPED UNION RATHER THAN RAW JSON
 *
 * `learn_lesson.body` is jsonb, which means the database will accept anything.
 * That is the wrong kind of freedom: a curriculum file with a typo'd block type
 * would import cleanly and then render nothing, and the failure would surface as
 * a blank lesson in production rather than as an error at import. So the blocks
 * are parsed and validated here, on the way in, and a bad block is a loud
 * failure naming the lesson and the position.
 *
 * WHY EXERCISES ARE COMPOSED DETERMINISTICALLY BUT SHUFFLED PER REQUEST
 *
 * Two requirements pull in opposite directions:
 *
 *   - Grading happens on the server (see learn-exercises.ts for why), so when
 *     the browser submits answers the server has to rebuild the same exercises
 *     to know what was asked. That needs composition to be deterministic.
 *   - A learner must not be able to memorise "the answer is always the second
 *     button". That needs the presentation to vary.
 *
 * The resolution: WHICH exercises a lesson contains is a pure function of the
 * lesson's content, and the ORDER of the options is shuffled on every request.
 * The identity of the correct answer never moves, so the server can grade a
 * submission it did not itself serve, and the learner still cannot learn the
 * positions.
 */
import type { Db } from './client.ts';

// ---------------------------------------------------------------------------
// Lesson content blocks
// ---------------------------------------------------------------------------

/** An example pair inside a grammar note or tip. */
export interface BlockExample {
  igbo: string;
  english: string;
}

export type LessonBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  /** A grammar explanation with worked examples. */
  | { type: 'grammar'; title: string; text: string; examples?: BlockExample[] }
  /** A reference table — pronouns, numbers, tone pairs. */
  | { type: 'table'; title?: string; columns: string[]; rows: string[][] }
  /** A conversation, rendered line by line with the English beneath. */
  | { type: 'dialogue'; title?: string; lines: { speaker: string; igbo: string; english: string }[] }
  /** Advice about how to learn, as opposed to what to learn. */
  | { type: 'tip'; title?: string; text: string }
  /** A caveat — a common mistake, a regional difference. */
  | { type: 'note'; title?: string; text: string }
  /** Placeholder that renders the lesson's own vocabulary list. */
  | { type: 'vocab' }
  /** Placeholder that renders the lesson's own phrase list. */
  | { type: 'phrases' };

export class LearnError extends Error {
  override readonly name = 'LearnError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LearnError('invalid_block', `${where} must be a non-empty string.`);
  }
  return value;
}

function optionalExamples(value: unknown, where: string): BlockExample[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new LearnError('invalid_block', `${where}.examples must be an array.`);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new LearnError('invalid_block', `${where}.examples[${index}] must be an object.`);
    }
    return {
      igbo: requireString(item.igbo, `${where}.examples[${index}].igbo`),
      english: requireString(item.english, `${where}.examples[${index}].english`),
    };
  });
}

/**
 * Validate one block. Exported because the importer validates before it writes,
 * so a malformed curriculum file fails before it has touched the database.
 */
export function parseLessonBlock(value: unknown, where: string): LessonBlock {
  if (!isRecord(value)) {
    throw new LearnError('invalid_block', `${where} must be an object.`);
  }
  const type = value.type;

  switch (type) {
    case 'paragraph':
      return { type, text: requireString(value.text, `${where}.text`) };

    case 'heading':
      return { type, text: requireString(value.text, `${where}.text`) };

    case 'grammar': {
      const block: LessonBlock = {
        type,
        title: requireString(value.title, `${where}.title`),
        text: requireString(value.text, `${where}.text`),
      };
      const examples = optionalExamples(value.examples, where);
      if (examples) block.examples = examples;
      return block;
    }

    case 'tip':
    case 'note': {
      const text = requireString(value.text, `${where}.text`);
      // Built as two returns rather than by assigning an optional property
      // afterwards: `type` narrows to the union 'tip' | 'note' here, so the
      // assigned object stays the whole union and a later `.title =` would not
      // typecheck.
      if (value.title !== undefined) {
        return { type, title: requireString(value.title, `${where}.title`), text };
      }
      return { type, text };
    }

    case 'table': {
      if (!Array.isArray(value.columns) || value.columns.length === 0) {
        throw new LearnError('invalid_block', `${where}.columns must be a non-empty array.`);
      }
      const columns = value.columns.map((c, i) => requireString(c, `${where}.columns[${i}]`));
      if (!Array.isArray(value.rows)) {
        throw new LearnError('invalid_block', `${where}.rows must be an array.`);
      }
      const rows = value.rows.map((row, r) => {
        if (!Array.isArray(row)) {
          throw new LearnError('invalid_block', `${where}.rows[${r}] must be an array.`);
        }
        // A row of the wrong width is a rendering bug waiting to happen — the
        // gap would show as a silently misaligned column.
        if (row.length !== columns.length) {
          throw new LearnError(
            'invalid_block',
            `${where}.rows[${r}] has ${row.length} cells but ${columns.length} columns were declared.`
          );
        }
        return row.map((cell, c) => requireString(cell, `${where}.rows[${r}][${c}]`));
      });
      const block: LessonBlock = { type, columns, rows };
      if (value.title !== undefined) block.title = requireString(value.title, `${where}.title`);
      return block;
    }

    case 'dialogue': {
      if (!Array.isArray(value.lines) || value.lines.length === 0) {
        throw new LearnError('invalid_block', `${where}.lines must be a non-empty array.`);
      }
      const lines = value.lines.map((line, i) => {
        if (!isRecord(line)) {
          throw new LearnError('invalid_block', `${where}.lines[${i}] must be an object.`);
        }
        return {
          speaker: requireString(line.speaker, `${where}.lines[${i}].speaker`),
          igbo: requireString(line.igbo, `${where}.lines[${i}].igbo`),
          english: requireString(line.english, `${where}.lines[${i}].english`),
        };
      });
      const block: LessonBlock = { type, lines };
      if (value.title !== undefined) block.title = requireString(value.title, `${where}.title`);
      return block;
    }

    case 'vocab':
    case 'phrases':
      // Placement markers: they carry no payload, they just say where the
      // lesson's own vocabulary or phrase list belongs in the prose.
      return { type };

    default:
      throw new LearnError(
        'invalid_block',
        `${where} has unknown type ${JSON.stringify(type)}. ` +
          `Known types: paragraph, heading, grammar, table, dialogue, tip, note, vocab, phrases.`
      );
  }
}

/** Validate a whole lesson body, naming the offending block by position. */
export function parseLessonBody(value: unknown, lessonSlug: string): LessonBlock[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new LearnError('invalid_body', `Lesson "${lessonSlug}" body must be an array of blocks.`);
  }
  return value.map((block, index) =>
    parseLessonBlock(block, `Lesson "${lessonSlug}" body[${index}]`)
  );
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface LearnVocabItem {
  id: number;
  igbo: string;
  english: string;
  pos: string | null;
  pronunciation: string | null;
  literal: string | null;
  note: string | null;
  audioUrl: string | null;
  /** Present only when the dictionary actually has the entry. */
  dictionaryHeadword: string | null;
  dictionarySlug: string | null;
}

export interface LearnPhrase {
  id: number;
  igbo: string;
  english: string;
  pronunciation: string | null;
  note: string | null;
  audioUrl: string | null;
}

export interface LessonProgress {
  state: 'started' | 'completed';
  bestScore: number | null;
  attempts: number;
  completedAt: string | null;
}

export interface LearnLessonSummary {
  id: number;
  slug: string;
  title: string;
  objective: string | null;
  estMinutes: number;
  unitSlug: string;
  unitTitle: string;
  vocabCount: number;
  phraseCount: number;
  /** How many exercises this lesson can build. 0 means practice is not offered. */
  exerciseCount: number;
  progress: LessonProgress | null;
}

export interface LearnLesson extends LearnLessonSummary {
  body: LessonBlock[];
  vocab: LearnVocabItem[];
  phrases: LearnPhrase[];
  courseSlug: string;
  courseTitle: string;
  languageCode: string;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}

export interface LearnUnit {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  lessons: LearnLessonSummary[];
}

export interface LearnCourseSummary {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  level: string;
  /** The §5.3 lifecycle state. Only 'published' is learner-visible. */
  status: string;
  languageCode: string;
  languageName: string;
  nativeName: string;
  lessonCount: number;
  vocabCount: number;
  completedCount: number;
  /** True when the course has at least one lesson that can be practised. */
  practiceable: boolean;
}

export interface LearnCourse extends LearnCourseSummary {
  units: LearnUnit[];
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface CourseRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  level: string;
  status: string;
  language_code: string;
  language_name: string;
  native_name: string;
  lesson_count: number | string;
  vocab_count: number | string;
  completed_count?: number | string;
}

interface LessonRow {
  id: string;
  slug: string;
  title: string;
  objective: string | null;
  est_minutes: number;
  unit_slug: string;
  unit_title: string;
  body: unknown;
  vocab_count: number | string;
  phrase_count: number | string;
  state?: string | null;
  best_score?: number | null;
  attempts?: number | null;
  completed_at?: string | null;
}

function num(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function progressFrom(row: LessonRow): LessonProgress | null {
  if (!row.state) return null;
  return {
    state: row.state === 'completed' ? 'completed' : 'started',
    bestScore: row.best_score ?? null,
    attempts: num(row.attempts),
    completedAt: row.completed_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/**
 * Every published course, with its size and — when an account is given — how
 * much of it that account has finished.
 *
 * `accountId` is optional and defaults to null, which is the signed-out case:
 * the counts still come back, and every `completedCount` is 0 because there is
 * no learner to have completed anything. That is the honest answer, not a lie.
 */
export async function listCourses(db: Db, accountId: number | null = null): Promise<LearnCourseSummary[]> {
  const rows = await db.rows<CourseRow>(
    `select c.id, c.slug, c.title, c.subtitle, c.description, c.level, c.status,
            c.language_code, l.name as language_name, l.native_name,
            (select count(*) from learn_lesson le
               join learn_unit u on u.id = le.unit_id
              where u.course_id = c.id and le.status = 'published'
                and u.status = 'published') as lesson_count,
            (select count(*) from learn_vocab v
               join learn_lesson le on le.id = v.lesson_id
               join learn_unit u on u.id = le.unit_id
              where u.course_id = c.id and le.status = 'published'
                and u.status = 'published') as vocab_count,
            (select count(*) from learn_progress p
               join learn_lesson le on le.id = p.lesson_id
               join learn_unit u on u.id = le.unit_id
              where u.course_id = c.id and p.account_id = $1
                and p.state = 'completed') as completed_count
       from learn_course c
       join language l on l.code = c.language_code
      where c.status = 'published'
      order by c.position, c.slug`,
    [accountId]
  );

  return rows.map((row) => ({
    id: num(row.id),
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    level: row.level,
    status: row.status,
    languageCode: row.language_code,
    languageName: row.language_name,
    nativeName: row.native_name,
    lessonCount: num(row.lesson_count),
    vocabCount: num(row.vocab_count),
    completedCount: num(row.completed_count),
    practiceable: num(row.lesson_count) > 0,
  }));
}

/** One course with its units and lessons, ordered as the author ordered them. */
export async function getCourse(
  db: Db,
  slug: string,
  accountId: number | null = null,
  options: { includeUnpublished?: boolean } = {}
): Promise<LearnCourse | null> {
  /**
   * Whether to return an unpublished course.
   *
   * Learner-facing callers must not, because §5.3 makes published the only visible state. Two
   * callers legitimately must: the CMS, which edits drafts, and the test suite, whose subject is
   * the engine rather than the content — after the unverified Igbo draft was quarantined to
   * `draft` (docs/decisions.md T5) the engine tests could no longer reach it.
   *
   * The default is the safe one on purpose: a caller that forgets this argument gets the learner's
   * view, not the editor's.
   */
  const includeUnpublished = options.includeUnpublished === true;
  const course = await db.one<CourseRow>(
    `select c.id, c.slug, c.title, c.subtitle, c.description, c.level, c.status,
            c.language_code, l.name as language_name, l.native_name,
            (select count(*) from learn_lesson le
               join learn_unit u on u.id = le.unit_id
              where u.course_id = c.id
                and ($3 or (le.status = 'published' and u.status = 'published'))) as lesson_count,
            (select count(*) from learn_vocab v
               join learn_lesson le on le.id = v.lesson_id
               join learn_unit u on u.id = le.unit_id
              where u.course_id = c.id
                and ($3 or (le.status = 'published' and u.status = 'published'))) as vocab_count,
            (select count(*) from learn_progress p
               join learn_lesson le on le.id = p.lesson_id
               join learn_unit u on u.id = le.unit_id
              where u.course_id = c.id and p.account_id = $2
                and p.state = 'completed') as completed_count
       from learn_course c
       join language l on l.code = c.language_code
      where c.slug = $1 and ($3 or c.status = 'published')`,
    [slug, accountId, includeUnpublished]
  );
  if (!course) return null;

  const lessonRows = await db.rows<LessonRow>(
    `select le.id, le.slug, le.title, le.objective, le.est_minutes,
            u.slug as unit_slug, u.title as unit_title, u.id as unit_id,
            (select count(*) from learn_vocab v where v.lesson_id = le.id) as vocab_count,
            (select count(*) from learn_phrase p where p.lesson_id = le.id) as phrase_count,
            p.state, p.best_score, p.attempts, p.completed_at
       from learn_lesson le
       join learn_unit u on u.id = le.unit_id
       left join learn_progress p on p.lesson_id = le.id and p.account_id = $2
      where u.course_id = $1
        and ($3 or (le.status = 'published' and u.status = 'published'))
      order by u.position, u.id, le.position, le.id`,
    [num(course.id), accountId, includeUnpublished]
  );

  const unitRows = await db.rows<{ id: string; slug: string; title: string; summary: string | null }>(
    `select id, slug, title, summary from learn_unit
      where course_id = $1 and ($2 or status = 'published')
      order by position, id`,
    [num(course.id), includeUnpublished]
  );

  const lessonsByUnit = new Map<string, LearnLessonSummary[]>();
  for (const row of lessonRows) {
    const summary: LearnLessonSummary = {
      id: num(row.id),
      slug: row.slug,
      title: row.title,
      objective: row.objective,
      estMinutes: row.est_minutes,
      unitSlug: row.unit_slug,
      unitTitle: row.unit_title,
      vocabCount: num(row.vocab_count),
      phraseCount: num(row.phrase_count),
      exerciseCount: exerciseCapacity(num(row.vocab_count)),
      progress: progressFrom(row),
    };
    const list = lessonsByUnit.get(row.unit_slug);
    if (list) list.push(summary);
    else lessonsByUnit.set(row.unit_slug, [summary]);
  }

  const units: LearnUnit[] = unitRows
    .map((unit) => ({
      id: num(unit.id),
      slug: unit.slug,
      title: unit.title,
      summary: unit.summary,
      lessons: lessonsByUnit.get(unit.slug) ?? [],
    }))
    // An empty unit is a drafting state, not something to show a learner.
    .filter((unit) => unit.lessons.length > 0);

  return {
    id: num(course.id),
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    level: course.level,
    status: course.status,
    languageCode: course.language_code,
    languageName: course.language_name,
    nativeName: course.native_name,
    lessonCount: num(course.lesson_count),
    vocabCount: num(course.vocab_count),
    completedCount: num(course.completed_count),
    practiceable: lessonRows.some((row) => exerciseCapacity(num(row.vocab_count)) > 0),
    units,
  };
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

/**
 * How many exercises a lesson with this much vocabulary can build.
 *
 * Exported and shared with the exercise builder so the number the course page
 * promises is the number the exercise page can actually deliver. A lesson needs
 * four terms before a multiple-choice question has plausible wrong answers, and
 * below that the honest answer is "no exercises" rather than a two-option guess.
 */
export function exerciseCapacity(vocabCount: number): number {
  if (vocabCount < MIN_VOCAB_FOR_CHOICE) return 0;
  return Math.min(vocabCount, MAX_EXERCISES);
}

/** Below four terms there are not enough wrong answers to make a real question. */
export const MIN_VOCAB_FOR_CHOICE = 4;
/** Long enough to be a lesson's practice, short enough to finish. */
export const MAX_EXERCISES = 10;

const LESSON_SELECT = `
  select le.id, le.slug, le.title, le.objective, le.est_minutes, le.body,
         u.slug as unit_slug, u.title as unit_title,
         (select count(*) from learn_vocab v where v.lesson_id = le.id) as vocab_count,
         (select count(*) from learn_phrase ph where ph.lesson_id = le.id) as phrase_count,
         p.state, p.best_score, p.attempts, p.completed_at
    from learn_lesson le
    join learn_unit u on u.id = le.unit_id
    join learn_course c on c.id = u.course_id
    left join learn_progress p on p.lesson_id = le.id and p.account_id = $3
   where c.slug = $1 and le.slug = $2
     and ($4 or (le.status = 'published' and u.status = 'published' and c.status = 'published'))
`;

export async function getLesson(
  db: Db,
  courseSlug: string,
  lessonSlug: string,
  accountId: number | null = null,
  options: { includeUnpublished?: boolean } = {}
): Promise<LearnLesson | null> {
  const row = await db.one<LessonRow>(LESSON_SELECT, [
    courseSlug,
    lessonSlug,
    accountId,
    options.includeUnpublished === true,
  ]);
  if (!row) return null;

  const vocab = await db.rows<{
    id: string;
    igbo: string;
    english: string;
    pos: string | null;
    pronunciation: string | null;
    literal: string | null;
    note: string | null;
    audio_url: string | null;
    dictionary_headword: string | null;
    dictionary_slug: string | null;
  }>(
    // The dictionary join is a LEFT join on purpose — the course must render
    // whether or not the corpus has been imported.
    `select v.id, v.igbo, v.english, v.pos, v.pronunciation, v.literal, v.note,
            v.audio_url, v.dictionary_headword, w.slug as dictionary_slug
       from learn_vocab v
       left join word w
              on w.headword = v.dictionary_headword
             and w.language_code = $2
             and w.status = 'published'
      where v.lesson_id = $1
      order by v.position, v.id`,
    [num(row.id), await courseLanguage(db, courseSlug)]
  );

  const phrases = await db.rows<{
    id: string;
    igbo: string;
    english: string;
    pronunciation: string | null;
    note: string | null;
    audio_url: string | null;
  }>(
    `select id, igbo, english, pronunciation, note, audio_url
       from learn_phrase where lesson_id = $1 order by position, id`,
    [num(row.id)]
  );

  // Neighbours are computed across the whole course in course order, so "next"
  // at the end of a unit moves into the following unit rather than dead-ending.
  const neighbours = await db.rows<{ slug: string; title: string }>(
    `select le.slug, le.title
       from learn_lesson le
       join learn_unit u on u.id = le.unit_id
       join learn_course c on c.id = u.course_id
      where c.slug = $1 and ($2 or (le.status = 'published' and u.status = 'published'))
      order by u.position, u.id, le.position, le.id`,
    [courseSlug, options.includeUnpublished === true]
  );
  const index = neighbours.findIndex((n) => n.slug === lessonSlug);

  const course = await db.one<{ title: string; language_code: string }>(
    `select title, language_code from learn_course where slug = $1`,
    [courseSlug]
  );

  return {
    id: num(row.id),
    slug: row.slug,
    title: row.title,
    objective: row.objective,
    estMinutes: row.est_minutes,
    unitSlug: row.unit_slug,
    unitTitle: row.unit_title,
    vocabCount: num(row.vocab_count),
    phraseCount: num(row.phrase_count),
    exerciseCount: exerciseCapacity(num(row.vocab_count)),
    progress: progressFrom(row),
    body: parseLessonBody(row.body, row.slug),
    vocab: vocab.map((item) => ({
      id: num(item.id),
      igbo: item.igbo,
      english: item.english,
      pos: item.pos,
      pronunciation: item.pronunciation,
      literal: item.literal,
      note: item.note,
      audioUrl: item.audio_url,
      dictionaryHeadword: item.dictionary_headword,
      dictionarySlug: item.dictionary_slug,
    })),
    phrases: phrases.map((phrase) => ({
      id: num(phrase.id),
      igbo: phrase.igbo,
      english: phrase.english,
      pronunciation: phrase.pronunciation,
      note: phrase.note,
      audioUrl: phrase.audio_url,
    })),
    courseSlug,
    courseTitle: course?.title ?? courseSlug,
    languageCode: course?.language_code ?? 'ibo',
    prev: index > 0 ? neighbours[index - 1]! : null,
    next: index >= 0 && index < neighbours.length - 1 ? neighbours[index + 1]! : null,
  };
}

async function courseLanguage(db: Db, courseSlug: string): Promise<string> {
  const row = await db.one<{ language_code: string }>(
    `select language_code from learn_course where slug = $1`,
    [courseSlug]
  );
  return row?.language_code ?? 'ibo';
}

/** Just the vocabulary, for the exercise builder. */
export async function getLessonVocab(db: Db, lessonId: number): Promise<LearnVocabItem[]> {
  const rows = await db.rows<{
    id: string;
    igbo: string;
    english: string;
    pos: string | null;
    pronunciation: string | null;
    literal: string | null;
    note: string | null;
    audio_url: string | null;
    dictionary_headword: string | null;
  }>(
    `select id, igbo, english, pos, pronunciation, literal, note, audio_url, dictionary_headword
       from learn_vocab where lesson_id = $1 order by position, id`,
    [lessonId]
  );
  return rows.map((item) => ({
    id: num(item.id),
    igbo: item.igbo,
    english: item.english,
    pos: item.pos,
    pronunciation: item.pronunciation,
    literal: item.literal,
    note: item.note,
    audioUrl: item.audio_url,
    dictionaryHeadword: item.dictionary_headword,
    dictionarySlug: null,
  }));
}

/** Just the phrases, for the exercise builder's sentence questions. */
export async function getLessonPhrases(db: Db, lessonId: number): Promise<LearnPhrase[]> {
  const rows = await db.rows<{
    id: string;
    igbo: string;
    english: string;
    pronunciation: string | null;
    note: string | null;
    audio_url: string | null;
  }>(`select id, igbo, english, pronunciation, note, audio_url from learn_phrase where lesson_id = $1 order by position, id`, [
    lessonId,
  ]);
  return rows.map((phrase) => ({
    id: num(phrase.id),
    igbo: phrase.igbo,
    english: phrase.english,
    pronunciation: phrase.pronunciation,
    note: phrase.note,
    audioUrl: phrase.audio_url,
  }));
}

/** The lesson id for a course/slug pair, or null. Used by the API routes. */
export async function findLessonId(
  db: Db,
  courseSlug: string,
  lessonSlug: string
): Promise<number | null> {
  const row = await db.one<{ id: string }>(
    `select le.id from learn_lesson le
       join learn_unit u on u.id = le.unit_id
       join learn_course c on c.id = u.course_id
      where c.slug = $1 and le.slug = $2
        and le.status = 'published' and u.status = 'published' and c.status = 'published'`,
    [courseSlug, lessonSlug]
  );
  return row ? num(row.id) : null;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface RecordAttemptInput {
  accountId: number | null;
  lessonId: number;
  correct: number;
  total: number;
}

export interface RecordedProgress {
  state: 'started' | 'completed';
  bestScore: number | null;
  attempts: number;
  /** False for a signed-out learner, whose attempt is logged but not attached. */
  persisted: boolean;
}

/**
 * What score counts as having completed a lesson.
 *
 * Not 100%: a learner who understands the material but slips on one tone pair
 * has learned the lesson, and making them re-sit to satisfy an arbitrary bar
 * teaches them to grind rather than to move on. Not 50% either, which would let
 * someone pass by guessing — four options means guessing alone averages 25%.
 * Eighty per cent is five of six, or four of five, and it is the point at which
 * the learner demonstrably knew most of it.
 */
export const COMPLETION_THRESHOLD = 80;

/**
 * Record a finished exercise set.
 *
 * Runs as one transaction so that the append-only attempt log and the
 * current-state progress row can never disagree — a crash between the two would
 * otherwise leave a learner with credit for an attempt that progress denies.
 */
export async function recordAttempt(db: Db, input: RecordAttemptInput): Promise<RecordedProgress> {
  const { accountId, lessonId, correct, total } = input;
  if (total <= 0) {
    throw new LearnError('invalid_attempt', 'An attempt must have at least one exercise.');
  }
  if (correct < 0 || correct > total) {
    throw new LearnError('invalid_attempt', `Cannot score ${correct} out of ${total}.`);
  }

  const score = Math.round((correct / total) * 100);

  await db.exec('begin');
  try {
    await db.query(
      `insert into learn_attempt (account_id, lesson_id, correct, total) values ($1, $2, $3, $4)`,
      [accountId, lessonId, correct, total]
    );

    let persisted = false;
    if (accountId !== null) {
      // The upsert keeps the best score rather than the latest: returning to a
      // lesson to warm up should not erase having mastered it. `attempts` still
      // counts every run, because that is history and it is the honest number.
      await db.query(
        `insert into learn_progress (account_id, lesson_id, state, best_score, attempts, completed_at, updated_at)
         values ($1, $2, $3, $4, 1, case when $3 = 'completed' then now() else null end, now())
         on conflict (account_id, lesson_id) do update
            set state        = case when learn_progress.state = 'completed' then 'completed' else excluded.state end,
                best_score   = greatest(coalesce(learn_progress.best_score, 0), excluded.best_score),
                attempts     = learn_progress.attempts + 1,
                completed_at = coalesce(
                                 learn_progress.completed_at,
                                 case when excluded.state = 'completed' then now() else null end
                               ),
                updated_at   = now()`,
        [accountId, lessonId, score >= COMPLETION_THRESHOLD ? 'completed' : 'started', score]
      );
      persisted = true;
    }

    await db.exec('commit');
    return await readProgress(db, accountId, lessonId, persisted);
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function readProgress(
  db: Db,
  accountId: number | null,
  lessonId: number,
  persisted: boolean
): Promise<RecordedProgress> {
  if (accountId === null) {
    return { state: 'started', bestScore: null, attempts: 0, persisted: false };
  }
  const row = await db.one<{ state: string; best_score: number | null; attempts: number }>(
    `select state, best_score, attempts from learn_progress where account_id = $1 and lesson_id = $2`,
    [accountId, lessonId]
  );
  return {
    state: row?.state === 'completed' ? 'completed' : 'started',
    bestScore: row?.best_score ?? null,
    attempts: num(row?.attempts),
    persisted,
  };
}

/** Progress for one lesson, for a signed-in learner. */
export async function getProgress(
  db: Db,
  accountId: number,
  lessonId: number
): Promise<LessonProgress | null> {
  const row = await db.one<{
    state: string;
    best_score: number | null;
    attempts: number;
    completed_at: string | null;
  }>(
    `select state, best_score, attempts, completed_at
       from learn_progress where account_id = $1 and lesson_id = $2`,
    [accountId, lessonId]
  );
  if (!row) return null;
  return {
    state: row.state === 'completed' ? 'completed' : 'started',
    bestScore: row.best_score,
    attempts: num(row.attempts),
    completedAt: row.completed_at,
  };
}

/** The next lesson this learner has not finished, or null when the course is done. */
export async function nextUnfinishedLesson(
  db: Db,
  courseSlug: string,
  accountId: number | null
): Promise<{ slug: string; title: string } | null> {
  const row = await db.one<{ slug: string; title: string }>(
    `select le.slug, le.title
       from learn_lesson le
       join learn_unit u on u.id = le.unit_id
       join learn_course c on c.id = u.course_id
       left join learn_progress p on p.lesson_id = le.id and p.account_id = $2
      where c.slug = $1 and le.status = 'published' and u.status = 'published'
        and (p.state is null or p.state <> 'completed')
      order by u.position, u.id, le.position, le.id
      limit 1`,
    [courseSlug, accountId]
  );
  return row ?? null;
}
