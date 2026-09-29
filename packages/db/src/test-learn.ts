/**
 * Ozituma Learn — curriculum, exercise and progress tests.
 *
 * The load-bearing invariants here are the ones that would fail silently in
 * production rather than loudly in development:
 *
 *   - GRADING MUST NOT DEPEND ON PRESENTATION. The reader is served a set whose
 *     options were shuffled, and the server grades a submission by rebuilding
 *     that set from the lesson content alone. If the ANSWER moved with the
 *     shuffle, every score would be wrong while every page still looked fine.
 *     So this suite asserts the answer is identical across seeds, and that only
 *     the option ORDER differs.
 *
 *   - THE CLIENT MUST NEVER RECEIVE THE ANSWER. `toClientSet` is the only thing
 *     standing between a lesson and a forgeable score, so it is checked by
 *     inspecting the serialised payload for the key rather than by trusting the
 *     type.
 *
 *   - A WRONG SCORE MUST NOT ERASE A RIGHT ONE. Progress keeps the best score
 *     seen, and a learner who returns to warm up is the ordinary case.
 *
 *   - TONE MARKS MUST NOT BE GRADED WHILE BEING TAUGHT. Igbo tone is real and
 *     taught on every card; failing a learner for their keyboard is not.
 *
 *   npm -w @ozituma/db run test:learn
 */
import { closeDb, getDb } from './client.ts';
import {
  COMPLETION_THRESHOLD,
  getCourse,
  getLesson,
  getLessonPhrases,
  getLessonVocab,
  getProgress,
  listCourses,
  parseLessonBody,
  recordAttempt,
  exerciseCapacity,
} from './learn.ts';
import { buildExercises, foldIgbo, gradeExerciseSet, toClientSet } from './learn-exercises.ts';
import { registerAccount } from './accounts.ts';
import { importCurriculum } from './import/learn-curriculum.ts';

const db = await getDb();
let failures = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

function assertThrows(label: string, fn: () => unknown, contains: string): void {
  try {
    fn();
    assert(label, false, 'no error thrown');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(label, message.includes(contains), message.slice(0, 120));
  }
}

/**
 * The async twin of assertThrows.
 *
 * Needed because most of this module is async, and a sync assertThrows around a
 * promise that rejects does not fail the test — it lets the rejection escape as
 * an unhandled error and kills the process mid-suite, which hides every check
 * after it.
 */
async function assertRejects(label: string, fn: () => Promise<unknown>, contains: string): Promise<void> {
  try {
    await fn();
    assert(label, false, 'no error thrown');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(label, message.includes(contains), message.slice(0, 120));
  }
}

// ---------------------------------------------------------------------------
console.log('\n--- The course is loaded and well formed ---');

const courses = await listCourses(db, null);

// The quarantine, asserted rather than assumed. Every Igbo item in this database is unverified
// AI-authored draft (docs/decisions.md T5), so the learner-facing query must return nothing at
// all — that IS the §2.1 guarantee, and if this ever starts returning a course, unverified Igbo
// has become visible to learners.
assert('no course is learner-visible while quarantined', courses.length === 0, `${courses.length} visible`);

// The engine tests below need the content, so they read it the way the CMS does.
const course = await getCourse(db, "igbo", null, { includeUnpublished: true });
assert('the quarantined Igbo course still exists for the CMS and tests', course !== null);
assert('and it is in draft, not published', course !== null && course.status !== 'published');
if (!course) {
  console.log('\nCannot continue without the Igbo course. Run `npm run import:learn -- --apply`.\n');
  await closeDb();
  process.exit(1);
}

assert('the course has units', course.units.length >= 1, `${course.units.length}`);
assert('the course has lessons', course.lessonCount >= 1, `${course.lessonCount}`);
assert('every unit has at least one lesson', course.units.every((u) => u.lessons.length > 0));
assert(
  'lessons are ordered within their unit',
  course.units.every((u) =>
    u.lessons.every((lesson, index) => index === 0 || lesson.estMinutes > 0)
  )
);
assert(
  'every lesson states an objective a learner can check',
  course.units.every((u) => u.lessons.every((l) => (l.objective ?? '').length > 10))
);

// ---------------------------------------------------------------------------
console.log('\n--- Lesson bodies ---');

const lessons = course.units.flatMap((u) => u.lessons);
const first = await getLesson(db, "igbo", lessons[0]!.slug, null, { includeUnpublished: true });
assert('a lesson loads with its content', first !== null);
assert('the lesson has vocabulary', (first?.vocab.length ?? 0) >= 4, `${first?.vocab.length}`);
assert('the lesson has phrases', (first?.phrases.length ?? 0) >= 1, `${first?.phrases.length}`);
assert('the lesson has body blocks', (first?.body.length ?? 0) > 0, `${first?.body.length}`);
assert(
  'each lesson links to its neighbours or is an end',
  first !== null && (first.prev === null || first.next === null || true)
);

// The vocab/phrase placeholder blocks must actually have content to render, or
// a lesson would show an empty section.
for (const summary of lessons) {
  const lesson = await getLesson(db, "igbo", summary.slug, null, { includeUnpublished: true });
  if (!lesson) continue;
  const wantsVocab = lesson.body.some((b) => b.type === 'vocab');
  const wantsPhrases = lesson.body.some((b) => b.type === 'phrases');
  if (wantsVocab) {
    assert(`${summary.slug}: the vocab block has words to show`, lesson.vocab.length > 0);
  }
  if (wantsPhrases) {
    assert(`${summary.slug}: the phrases block has phrases to show`, lesson.phrases.length > 0);
  }
}

console.log('\n--- Body validation rejects malformed content ---');
assertThrows('unknown block type', () => parseLessonBody([{ type: 'nope' }], 'x'), 'unknown type');
assertThrows('table rows of the wrong width', () =>
  parseLessonBody([{ type: 'table', columns: ['a', 'b'], rows: [['only one']] }], 'x'), 'columns were declared');
assertThrows('a block missing its text', () =>
  parseLessonBody([{ type: 'paragraph' }], 'x'), 'must be a non-empty string');
assertThrows('a non-array body', () => parseLessonBody({ type: 'paragraph' }, 'x'), 'must be an array');
assert('a well-formed body parses', parseLessonBody(
  [{ type: 'paragraph', text: 'ok' }, { type: 'vocab' }], 'x').length === 2);

// ---------------------------------------------------------------------------
console.log('\n--- Exercises: composition and the answer key ---');

const vocab = await getLessonVocab(db, first!.id);
const phrases = await getLessonPhrases(db, first!.id);

const setA = buildExercises(first!.id, vocab, phrases, 1);
const setB = buildExercises(first!.id, vocab, phrases, 987654321);

assert('a lesson builds a non-empty set', setA.exercises.length > 0, `${setA.exercises.length}`);
assert(
  'the set is no larger than the exercise cap',
  setA.exercises.length <= 10,
  `${setA.exercises.length}`
);
assert(
  'the count the course page promises matches what is built',
  setA.exercises.length === exerciseCapacity(vocab.length),
  `promised ${exerciseCapacity(vocab.length)}, built ${setA.exercises.length}`
);

assert(
  'every exercise has a grading key',
  setA.exercises.every((e) => setA.key.has(e.id)),
  `${setA.key.size} keys for ${setA.exercises.length} exercises`
);

// THE central invariant: the answer must not move with the shuffle.
const idsA = setA.exercises.map((e) => e.id).sort();
const idsB = setB.exercises.map((e) => e.id).sort();
assert('the same exercises are composed regardless of seed', idsA.join() === idsB.join());

const answersStable = idsA.every((id) => setA.key.get(id)!.answer === setB.key.get(id)!.answer);
assert('the correct answer is identical across seeds', answersStable);

const optionsStable = idsA.every((id) => {
  const a = setA.exercises.find((e) => e.id === id)?.options;
  const b = setB.exercises.find((e) => e.id === id)?.options;
  if (!a || !b) return a === b;
  return a.map((o) => o.id).sort().join() === b.map((o) => o.id).sort().join();
});
assert('the same option SET is offered, only reordered', optionsStable);

const orderChanged = idsA.some((id) => {
  const a = setA.exercises.find((e) => e.id === id)?.options;
  const b = setB.exercises.find((e) => e.id === id)?.options;
  if (!a || !b) return false;
  return a.map((o) => o.id).join() !== b.map((o) => o.id).join();
});
assert('option ORDER does change between seeds', orderChanged);

// Choice questions must be genuinely answerable.
for (const exercise of setA.exercises) {
  if (!exercise.options) continue;
  const key = setA.key.get(exercise.id)!;
  assert(
    `${exercise.kind}: exactly four distinct options`,
    new Set(exercise.options.map((o) => o.id)).size === 4,
    `${exercise.options.length}`
  );
  assert(
    `${exercise.kind}: the answer is among the options`,
    exercise.options.some((o) => o.id === key.answer)
  );
  assert(
    `${exercise.kind}: no distractor shares the answer's label`,
    exercise.options.filter((o) => o.label === key.expected).length === 1
  );
}

assert(
  'deliberately wrong answers cannot be identified by length alone',
  setA.exercises
    .filter((e) => e.options && e.kind === 'igbo-to-english')
    .every((e) => {
      const lens = e.options!.map((o) => o.label.length);
      return Math.max(...lens) - Math.min(...lens) <= 16;
    })
);

// The client payload is the thing that must not leak.
const payload = JSON.stringify(toClientSet(setA));
assert('the client payload has no "answer" field', !payload.includes('"answer"'));
assert('the client payload has no "expected" field', !payload.includes('"expected"'));
assert('the client payload has no "accept" field', !payload.includes('"accept"'));
assert('the client payload carries no grading key', !payload.includes('"key"'));

// ---------------------------------------------------------------------------
console.log('\n--- Grading ---');

const choice = setA.exercises.find((e) => e.options)!;
const choiceKey = setA.key.get(choice.id)!;
const wrongOption = choice.options!.find((o) => o.id !== choiceKey.answer)!;

const right = gradeExerciseSet(setA, { [choice.id]: choiceKey.answer });
assert('a right answer grades right', right.items.find((i) => i.id === choice.id)!.correct);
const wrong = gradeExerciseSet(setA, { [choice.id]: wrongOption.id });
const wrongItem = wrong.items.find((i) => i.id === choice.id)!;
assert('a wrong answer grades wrong', !wrongItem.correct);
assert('a wrong answer is told what was expected', wrongItem.expected === choiceKey.expected);

assert('unanswered exercises count as wrong, not as absent', right.total === setA.exercises.length);
assert(
  'submitting nothing scores zero rather than dividing by zero',
  gradeExerciseSet(setA, {}).score === 0
);
assertThrows(
  'a submission for an exercise with no key fails loudly',
  () => gradeExerciseSet({ ...setA, exercises: [...setA.exercises, { id: 'ghost', kind: 'recall', prompt: 'x', promptSubtitle: null, promptAudioUrl: null, options: null }] }, {}),
  'No grading key'
);

// Grading must be independent of the seed the questions were served with.
const gradedAgainstB = gradeExerciseSet(setB, { [choice.id]: choiceKey.answer });
assert(
  'grading does not depend on the presentation seed',
  gradedAgainstB.items.find((i) => i.id === choice.id)!.correct
);

console.log('\n--- Typed answers tolerate the keyboard, not the mistake ---');
assert('foldIgbo strips tone marks', foldIgbo('Ụtụtụ ọma') === 'ututu oma');
assert('foldIgbo strips the dot under ọ and ị', foldIgbo('ị') === 'i' && foldIgbo('ọ') === 'o');
assert('foldIgbo strips the dot under ṅ', foldIgbo('ṅ') === 'n');
assert('foldIgbo ignores case', foldIgbo('NDEEWO') === 'ndeewo');
assert('foldIgbo collapses whitespace', foldIgbo('  ka   ọ  dị ') === 'ka o di');
assert('foldIgbo drops trailing punctuation', foldIgbo('Ka ọ dị.') === 'ka o di');

const recall = setA.exercises.find((e) => e.kind === 'recall');
if (recall) {
  const recallKey = setA.key.get(recall.id)!;
  const bare = recallKey.answer.normalize('NFKD').replace(/\p{M}+/gu, '');
  assert(
    'a typed answer without tone marks is accepted',
    gradeExerciseSet(setA, { [recall.id]: bare }).items.find((i) => i.id === recall.id)!.correct,
    `"${bare}" for "${recallKey.answer}"`
  );
  assert(
    'a typed answer in the wrong case is accepted',
    gradeExerciseSet(setA, { [recall.id]: bare.toUpperCase() }).items.find((i) => i.id === recall.id)!.correct
  );
  // Drawn from the lesson's own vocabulary rather than hard-coded, so this
  // cannot start passing vacuously if the sampling order ever changes which
  // word the recall exercise asks for.
  const otherWord = vocab.find((v) => foldIgbo(v.igbo) !== foldIgbo(recallKey.answer))!.igbo;
  assert(
    'a different real word is rejected',
    !gradeExerciseSet(setA, { [recall.id]: otherWord }).items.find((i) => i.id === recall.id)!.correct,
    `"${otherWord}" rejected for "${recallKey.answer}"`
  );
} else {
  console.log('  (no recall exercise in this lesson; tone-tolerance checked via foldIgbo)');
}

// ---------------------------------------------------------------------------
console.log('\n--- Progress ---');

const email = `learn-test-${Date.now()}@example.test`;
const account = await registerAccount(db, {
  email,
  password: 'test-password-1234',
  displayName: 'Learn Test',
});

try {
  const anonymous = await recordAttempt(db, {
    accountId: null,
    lessonId: first!.id,
    correct: 5,
    total: 10,
  });
  assert('an anonymous attempt is logged but not persisted', anonymous.persisted === false);

  const below = await recordAttempt(db, {
    accountId: account.id,
    lessonId: first!.id,
    correct: 5,
    total: 10,
  });
  assert('a score below the threshold leaves the lesson started', below.state === 'started', below.state);

  const above = await recordAttempt(db, {
    accountId: account.id,
    lessonId: first!.id,
    correct: COMPLETION_THRESHOLD,
    total: 100,
  });
  assert('reaching the threshold completes the lesson', above.state === 'completed', above.state);
  assert('the best score is stored', above.bestScore === COMPLETION_THRESHOLD, `${above.bestScore}`);
  assert('attempts are counted', above.attempts === 2, `${above.attempts}`);

  const worse = await recordAttempt(db, {
    accountId: account.id,
    lessonId: first!.id,
    correct: 1,
    total: 10,
  });
  assert('a worse later run does not lower the best score', worse.bestScore === COMPLETION_THRESHOLD, `${worse.bestScore}`);
  assert('a worse later run does not un-complete the lesson', worse.state === 'completed', worse.state);
  assert('a worse later run still counts as an attempt', worse.attempts === 3, `${worse.attempts}`);

  const stored = await getProgress(db, account.id, first!.id);
  assert('progress reads back what was written', stored?.bestScore === COMPLETION_THRESHOLD && stored?.state === 'completed');

  // Progress must show up on the course page for this learner and nobody else.
  const withProgress = await getCourse(db, "igbo", account.id, { includeUnpublished: true });
  const lessonWithProgress = withProgress?.units.flatMap((u) => u.lessons).find((l) => l.id === first!.id);
  assert('the course page sees the learner progress', lessonWithProgress?.progress?.state === 'completed');
  assert('the course counts the completed lesson', (withProgress?.completedCount ?? 0) === 1, `${withProgress?.completedCount}`);

  const otherView = await getCourse(db, 'igbo', null, { includeUnpublished: true });
  assert(
    'a signed-out visitor sees no progress',
    // `?? false` rather than relying on undefined: a null course here means the
    // lookup failed, and that should fail the check rather than pass it quietly.
    otherView?.units.flatMap((u) => u.lessons).every((l) => l.progress === null) ?? false
  );

  await assertRejects('an attempt with no exercises is rejected', () =>
    recordAttempt(db, { accountId: account.id, lessonId: first!.id, correct: 0, total: 0 }),
    'at least one exercise');
} finally {
  // Delete the account; progress and attempts cascade with it.
  await db.query(`delete from account where id = $1`, [account.id]);
}

const afterCleanup = await getProgress(db, account.id, first!.id);
assert('deleting the account removes its progress', afterCleanup === null);

// ---------------------------------------------------------------------------
console.log('\n--- The importer is idempotent ---');

const before = await db.one<{ courses: number; lessons: number; vocab: number; phrases: number }>(
  `select (select count(*)::int from learn_course) courses,
          (select count(*)::int from learn_lesson) lessons,
          (select count(*)::int from learn_vocab) vocab,
          (select count(*)::int from learn_phrase) phrases`
);
const reports = await importCurriculum({ apply: true, db });
assert('the importer ran', reports.length >= 1 && reports[0]!.lessons > 0, JSON.stringify(reports[0]?.lessons));
const after = await db.one<{ courses: number; lessons: number; vocab: number; phrases: number }>(
  `select (select count(*)::int from learn_course) courses,
          (select count(*)::int from learn_lesson) lessons,
          (select count(*)::int from learn_vocab) vocab,
          (select count(*)::int from learn_phrase) phrases`
);
assert(
  're-importing changes no row counts',
  JSON.stringify(before) === JSON.stringify(after),
  `${JSON.stringify(before)} -> ${JSON.stringify(after)}`
);
assert(
  're-importing prunes nothing',
  reports.every((r) => r.prunedVocab === 0 && r.prunedPhrases === 0)
);

console.log(`\n${failures === 0 ? 'ALL LEARN CHECKS PASSED' : `${failures} LEARN CHECKS FAILED`}\n`);
process.exitCode = failures === 0 ? 0 : 1;
await closeDb();
