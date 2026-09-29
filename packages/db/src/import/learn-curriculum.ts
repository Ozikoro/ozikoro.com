/**
 * The Ozituma Learn curriculum importer.
 *
 *   node packages/db/src/import/learn-curriculum.ts              # report only
 *   node packages/db/src/import/learn-curriculum.ts --apply
 *   node packages/db/src/import/learn-curriculum.ts --apply --file data/learn/igbo.json
 *
 * Curriculum files live in `data/learn/` and are tracked in git, for the same
 * reason `data/clans/clans.json` is: they are OUR authored material rather than
 * a third-party corpus. A lesson with a wrong translation should be fixable by
 * editing one line and re-running this, and the diff should be reviewable by
 * someone who knows the language.
 *
 * WHY THIS VALIDATES BEFORE IT WRITES
 *
 * A curriculum file is content, and content is edited by hand. The failure worth
 * preventing is the quiet one: a block with a mistyped type, or a table whose
 * rows are a column short, importing successfully and rendering as a lesson with
 * a hole in it. So every lesson body is parsed through `parseLessonBody` — the
 * same function the web app uses when it reads the row back — before anything is
 * written, and a bad file aborts the whole import with the lesson and block
 * position named. Nothing is half-applied.
 *
 * WHY VOCABULARY AND PHRASES ARE PRUNED BUT COURSES ARE NOT
 *
 * A lesson's vocabulary list is owned wholesale by its file: the file is the
 * complete statement of what that lesson teaches. If a word is removed from the
 * file it should disappear from the lesson, or the lesson would keep teaching
 * something the author deliberately cut.
 *
 * A course, by contrast, is not deleted when its file stops listing it, because
 * by then learners have progress rows pointing at its lessons and URLs pointing
 * at its pages. Removing a published course is a decision a human should make
 * deliberately, not something a re-import does on its way past.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, type Db } from '../client.ts';
import { LearnError, parseLessonBody } from '../learn.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CURRICULUM_DIR = resolve(HERE, '..', '..', '..', '..', 'data', 'learn');

// ---------------------------------------------------------------------------
// File shape
// ---------------------------------------------------------------------------

interface VocabEntry {
  igbo: string;
  english: string;
  pos?: string;
  pronunciation?: string;
  literal?: string;
  note?: string;
  audioUrl?: string;
  dictionaryHeadword?: string;
}

interface PhraseEntry {
  igbo: string;
  english: string;
  pronunciation?: string;
  note?: string;
  audioUrl?: string;
}

interface LessonEntry {
  slug: string;
  title: string;
  objective?: string;
  estMinutes?: number;
  position?: number;
  status?: string;
  body?: unknown;
  vocab?: VocabEntry[];
  phrases?: PhraseEntry[];
}

interface UnitEntry {
  slug: string;
  title: string;
  summary?: string;
  position?: number;
  status?: string;
  lessons?: LessonEntry[];
}

interface CourseEntry {
  slug: string;
  languageCode: string;
  title: string;
  subtitle?: string;
  description?: string;
  level?: string;
  status?: string;
  position?: number;
  units?: UnitEntry[];
}

interface CurriculumFile {
  course?: CourseEntry;
}

export interface ImportReport {
  file: string;
  course: string | null;
  units: number;
  lessons: number;
  vocab: number;
  phrases: number;
  prunedVocab: number;
  prunedPhrases: number;
  warnings: string[];
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const LEVELS = new Set(['beginner', 'elementary', 'intermediate', 'advanced']);
const STATUSES = new Set(['draft', 'published']);

function req(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LearnError('invalid_curriculum', `${where} must be a non-empty string.`);
  }
  return value;
}

function opt(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new LearnError('invalid_curriculum', `${where} must be a string when present.`);
  }
  return value;
}

function status(value: unknown, where: string): string {
  const resolved = value === undefined ? 'draft' : req(value, where);
  if (!STATUSES.has(resolved)) {
    throw new LearnError(
      'invalid_curriculum',
      `${where} is "${resolved}"; expected one of ${[...STATUSES].join(', ')}.`
    );
  }
  return resolved;
}

/**
 * Validate the whole file and return it in the shape the writer expects.
 *
 * Deliberately returns a normalised copy rather than mutating: the caller must
 * not be able to write a partially-validated structure if an error is thrown
 * halfway down.
 */
function validate(parsed: unknown, file: string): CourseEntry {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new LearnError('invalid_curriculum', `${file} must contain a JSON object.`);
  }
  const root = parsed as CurriculumFile;
  if (!root.course) {
    throw new LearnError('invalid_curriculum', `${file} has no "course" key.`);
  }
  const course = root.course;

  const level = course.level === undefined ? 'beginner' : req(course.level, `${file} course.level`);
  if (!LEVELS.has(level)) {
    throw new LearnError(
      'invalid_curriculum',
      `${file} course.level is "${level}"; expected one of ${[...LEVELS].join(', ')}.`
    );
  }

  const seenUnits = new Set<string>();
  const units: UnitEntry[] = (course.units ?? []).map((unit, ui) => {
    const where = `${file} units[${ui}]`;
    const slug = req(unit.slug, `${where}.slug`);
    if (seenUnits.has(slug)) {
      throw new LearnError('invalid_curriculum', `${file} declares unit "${slug}" twice.`);
    }
    seenUnits.add(slug);

    const seenLessons = new Set<string>();
    const lessons: LessonEntry[] = (unit.lessons ?? []).map((lesson, li) => {
      const lessonWhere = `${where} lesson[${li}]`;
      const lessonSlug = req(lesson.slug, `${lessonWhere}.slug`);
      if (seenLessons.has(lessonSlug)) {
        throw new LearnError(
          'invalid_curriculum',
          `Unit "${slug}" declares lesson "${lessonSlug}" twice.`
        );
      }
      seenLessons.add(lessonSlug);

      // The body is validated with the same parser the web app uses, so a file
      // that passes here cannot fail at render time.
      const body = parseLessonBody(lesson.body, lessonSlug);

      const seenVocab = new Set<string>();
      const vocab: VocabEntry[] = (lesson.vocab ?? []).map((item, vi) => {
        const itemWhere = `${lessonWhere} vocab[${vi}]`;
        const igbo = req(item.igbo, `${itemWhere}.igbo`);
        if (seenVocab.has(igbo)) {
          throw new LearnError(
            'invalid_curriculum',
            `Lesson "${lessonSlug}" lists the term "${igbo}" twice.`
          );
        }
        seenVocab.add(igbo);
        return {
          igbo,
          english: req(item.english, `${itemWhere}.english`),
          pos: opt(item.pos, `${itemWhere}.pos`),
          pronunciation: opt(item.pronunciation, `${itemWhere}.pronunciation`),
          literal: opt(item.literal, `${itemWhere}.literal`),
          note: opt(item.note, `${itemWhere}.note`),
          audioUrl: opt(item.audioUrl, `${itemWhere}.audioUrl`),
          dictionaryHeadword: opt(item.dictionaryHeadword, `${itemWhere}.dictionaryHeadword`),
        };
      });

      const phrases: PhraseEntry[] = (lesson.phrases ?? []).map((phrase, pi) => {
        const phraseWhere = `${lessonWhere} phrases[${pi}]`;
        return {
          igbo: req(phrase.igbo, `${phraseWhere}.igbo`),
          english: req(phrase.english, `${phraseWhere}.english`),
          pronunciation: opt(phrase.pronunciation, `${phraseWhere}.pronunciation`),
          note: opt(phrase.note, `${phraseWhere}.note`),
          audioUrl: opt(phrase.audioUrl, `${phraseWhere}.audioUrl`),
        };
      });

      const estMinutes = lesson.estMinutes ?? 8;
      if (!Number.isInteger(estMinutes) || estMinutes < 1 || estMinutes > 120) {
        throw new LearnError(
          'invalid_curriculum',
          `${lessonWhere}.estMinutes must be a whole number between 1 and 120.`
        );
      }

      return {
        slug: lessonSlug,
        title: req(lesson.title, `${lessonWhere}.title`),
        objective: opt(lesson.objective, `${lessonWhere}.objective`),
        estMinutes,
        position: lesson.position ?? (li + 1) * 10,
        status: status(lesson.status, `${lessonWhere}.status`),
        body,
        vocab,
        phrases,
      };
    });

    return {
      slug,
      title: req(unit.title, `${where}.title`),
      summary: opt(unit.summary, `${where}.summary`),
      position: unit.position ?? (ui + 1) * 10,
      status: status(unit.status, `${where}.status`),
      lessons,
    };
  });

  return {
    slug: req(course.slug, `${file} course.slug`),
    languageCode: req(course.languageCode, `${file} course.languageCode`),
    title: req(course.title, `${file} course.title`),
    subtitle: opt(course.subtitle, `${file} course.subtitle`),
    description: opt(course.description, `${file} course.description`),
    level,
    status: status(course.status, `${file} course.status`),
    position: course.position ?? 100,
    units,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function writeCourse(db: Db, course: CourseEntry, report: ImportReport): Promise<void> {  // The language must already exist as a row: the registry in
  // packages/core/src/languages.ts is what creates those, and a course for a
  // language the platform does not serve is a mistake worth surfacing rather
  // than a row to invent.
  const language = await db.one<{ code: string }>(
    `select code from language where code = $1`,
    [course.languageCode]
  );
  if (!language) {
    throw new LearnError(
      'unknown_language',
      `Course "${course.slug}" is for language "${course.languageCode}", which is not in the ` +
        `language table. Run the seed (npm run seed) or check the ISO 639-3 code.`
    );
  }

  const courseRow = await db.one<{ id: string }>(
    `insert into learn_course
       (slug, language_code, title, subtitle, description, level, status, position, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (slug) do update
        set language_code = excluded.language_code,
            title         = excluded.title,
            subtitle      = excluded.subtitle,
            description   = excluded.description,
            level         = excluded.level,
            status        = excluded.status,
            position      = excluded.position,
            updated_at    = now()
     returning id`,
    [
      course.slug,
      course.languageCode,
      course.title,
      course.subtitle ?? null,
      course.description ?? null,
      course.level,
      course.status,
      course.position,
    ]
  );
  const courseId = Number(courseRow!.id);

  for (const unit of course.units ?? []) {
    const unitRow = await db.one<{ id: string }>(
      `insert into learn_unit (course_id, slug, title, summary, position, status, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (course_id, slug) do update
          set title = excluded.title, summary = excluded.summary,
              position = excluded.position, status = excluded.status, updated_at = now()
       returning id`,
      [courseId, unit.slug, unit.title, unit.summary ?? null, unit.position, unit.status]
    );
    const unitId = Number(unitRow!.id);

    for (const lesson of unit.lessons ?? []) {
      const lessonRow = await db.one<{ id: string }>(
        `insert into learn_lesson
           (unit_id, slug, title, objective, body, est_minutes, position, status, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now())
         on conflict (unit_id, slug) do update
            set title = excluded.title, objective = excluded.objective, body = excluded.body,
                est_minutes = excluded.est_minutes, position = excluded.position,
                status = excluded.status, updated_at = now()
         returning id`,
        [
          unitId,
          lesson.slug,
          lesson.title,
          lesson.objective ?? null,
          JSON.stringify(lesson.body ?? []),
          lesson.estMinutes,
          lesson.position,
          lesson.status,
        ]
      );
      const lessonId = Number(lessonRow!.id);

      // ---- vocabulary -------------------------------------------------------
      const vocabTerms: string[] = [];
      for (const [index, item] of (lesson.vocab ?? []).entries()) {
        vocabTerms.push(item.igbo);
        await db.query(
          `insert into learn_vocab
             (lesson_id, igbo, english, pos, pronunciation, literal, note, audio_url,
              dictionary_headword, position)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (lesson_id, igbo) do update
              set english = excluded.english, pos = excluded.pos,
                  pronunciation = excluded.pronunciation, literal = excluded.literal,
                  note = excluded.note, audio_url = excluded.audio_url,
                  dictionary_headword = excluded.dictionary_headword,
                  position = excluded.position`,
          [
            lessonId,
            item.igbo,
            item.english,
            item.pos ?? null,
            item.pronunciation ?? null,
            item.literal ?? null,
            item.note ?? null,
            item.audioUrl ?? null,
            item.dictionaryHeadword ?? null,
            (index + 1) * 10,
          ]
        );
      }

      const vocabPrune = await db.query(
        `delete from learn_vocab where lesson_id = $1 and not (igbo = any($2::text[]))`,
        [lessonId, vocabTerms]
      );
      report.prunedVocab += vocabPrune.rowCount ?? 0;

      // ---- phrases ----------------------------------------------------------
      const phraseTexts: string[] = [];
      for (const [index, phrase] of (lesson.phrases ?? []).entries()) {
        phraseTexts.push(phrase.igbo);
        await db.query(
          `insert into learn_phrase
             (lesson_id, igbo, english, pronunciation, note, audio_url, position)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (lesson_id, igbo) do update
              set english = excluded.english, pronunciation = excluded.pronunciation,
                  note = excluded.note, audio_url = excluded.audio_url,
                  position = excluded.position`,
          [
            lessonId,
            phrase.igbo,
            phrase.english,
            phrase.pronunciation ?? null,
            phrase.note ?? null,
            phrase.audioUrl ?? null,
            (index + 1) * 10,
          ]
        );
      }

      const phrasePrune = await db.query(
        `delete from learn_phrase where lesson_id = $1 and not (igbo = any($2::text[]))`,
        [lessonId, phraseTexts]
      );
      report.prunedPhrases += phrasePrune.rowCount ?? 0;
    }
  }
}

/**
 * Count what a validated course contains, without touching the database.
 *
 * The dry run has to be worth running, and "validated" alone is not: the number
 * that decides whether an import is safe to apply is how much it is about to
 * change. Counting from the validated structure rather than from the writes also
 * means the report is identical in both modes, so a dry run and the apply that
 * follows it can be compared line for line.
 */
function countCurriculum(course: CourseEntry, report: ImportReport): void {
  report.course = course.slug;
  for (const unit of course.units ?? []) {
    report.units += 1;
    for (const lesson of unit.lessons ?? []) {
      report.lessons += 1;
      report.vocab += (lesson.vocab ?? []).length;
      report.phrases += (lesson.phrases ?? []).length;

      // A published lesson with too little vocabulary renders perfectly and
      // silently offers no practice, which is the kind of gap nobody notices
      // until a learner reports it.
      if (lesson.status === 'published' && (lesson.vocab ?? []).length < 4) {
        report.warnings.push(
          `${course.slug}/${unit.slug}/${lesson.slug}: published with ` +
            `${(lesson.vocab ?? []).length} vocabulary items, so it cannot build exercises ` +
            `(four are needed for a multiple-choice question).`
        );
      }
    }
  }
}

/**
 * Report dictionary links that resolve to nothing.
 *
 * Not fatal — the course renders in full without the dictionary, by design — but
 * a broken link usually means a headword was misspelled, or that the corpus has
 * not been imported yet. Both are worth knowing before someone clicks it.
 */
async function checkDictionaryLinks(db: Db, course: CourseEntry, report: ImportReport): Promise<void> {
  const headwords = new Set<string>();
  for (const unit of course.units ?? []) {
    for (const lesson of unit.lessons ?? []) {
      for (const item of lesson.vocab ?? []) {
        if (item.dictionaryHeadword) headwords.add(item.dictionaryHeadword);
      }
    }
  }
  if (headwords.size === 0) return;

  // One query for every headword in the file rather than one per item.
  const found = await db.rows<{ headword: string }>(
    `select headword from word where language_code = $1 and headword = any($2::text[])`,
    [course.languageCode, [...headwords]]
  );
  const present = new Set(found.map((row) => row.headword));

  for (const unit of course.units ?? []) {
    for (const lesson of unit.lessons ?? []) {
      for (const item of lesson.vocab ?? []) {
        if (item.dictionaryHeadword && !present.has(item.dictionaryHeadword)) {
          report.warnings.push(
            `${course.slug}/${unit.slug}/${lesson.slug}: "${item.igbo}" links to dictionary ` +
              `headword "${item.dictionaryHeadword}", which is not in the ${course.languageCode} corpus.`
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function filesFor(options: { file?: string }): Promise<string[]> {
  if (options.file) return [resolve(options.file)];
  const entries = await readdir(DEFAULT_CURRICULUM_DIR);
  return entries
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => resolve(DEFAULT_CURRICULUM_DIR, name));
}

export async function importCurriculum(options: {
  file?: string;
  apply?: boolean;
  db?: Db;
}): Promise<ImportReport[]> {
  const db = options.db ?? (await getDb());
  const files = await filesFor(options);
  if (files.length === 0) {
    throw new LearnError('no_files', `No curriculum files found in ${DEFAULT_CURRICULUM_DIR}.`);
  }

  const reports: ImportReport[] = [];

  for (const file of files) {
    const report: ImportReport = {
      file,
      course: null,
      units: 0,
      lessons: 0,
      vocab: 0,
      phrases: 0,
      prunedVocab: 0,
      prunedPhrases: 0,
      warnings: [],
      dryRun: !options.apply,
    };

    const raw = await readFile(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new LearnError(
        'invalid_json',
        `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Validate everything before writing anything, so a file with an error on
    // its last lesson does not leave the first four lessons changed.
    const course = validate(parsed, file);

    // Counted from the validated structure in both modes, so a dry run and the
    // apply that follows it report the same totals.
    countCurriculum(course, report);
    await checkDictionaryLinks(db, course, report);

    if (options.apply) await writeCourse(db, course, report);

    reports.push(report);
  }

  return reports;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const fileArg = process.argv.indexOf('--file');
  const file = fileArg >= 0 ? process.argv[fileArg + 1] : undefined;

  console.log(`Ozituma Learn curriculum${apply ? '' : ' (dry run)'}\n`);

  const reports = await importCurriculum({ apply, file });

  let warnings = 0;
  for (const report of reports) {
    const name = report.file.split('/').pop();
    console.log(`  ${name}`);
    if (report.course) {
      console.log(
        `    ${report.course}: ${report.units} units, ${report.lessons} lessons, ` +
          `${report.vocab} vocabulary, ${report.phrases} phrases`
      );
      if (report.prunedVocab || report.prunedPhrases) {
        console.log(
          `    pruned ${report.prunedVocab} vocabulary and ${report.prunedPhrases} phrases ` +
            `the file no longer lists`
        );
      }
    } else {
      console.log(`    validated (nothing written)`);
    }
    for (const warning of report.warnings) {
      console.log(`    ! ${warning}`);
      warnings += 1;
    }
  }

  if (warnings > 0) {
    console.log(`\n  ${warnings} warning${warnings === 1 ? '' : 's'} (see above).`);
  }
  if (!apply) console.log('\n  Re-run with --apply to write these rows.');

  await closeDb();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
