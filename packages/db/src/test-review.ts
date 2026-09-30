/**
 * Tests for §5.3's review queue.
 *
 * Run with: npm -w @ozituma/db run test:review
 *
 * WHAT THESE ARE ACTUALLY CHECKING
 *
 * The lifecycle rules are tested in `packages/core/src/review-workflow.test.ts`. What is new here is
 * that they SURVIVE A ROUND TRIP through the database — that the facts read back from a row are the
 * facts the domain needs, and that a refusal is a refusal rather than a silent write.
 *
 * The two that matter most, because both are ways content could reach a learner wrongly:
 *
 *   1. THE TWO-PERSON RULE. A linguist must not be able to approve their own work. If
 *      `linguist_approved_by` were not read back, the rule would pass in a unit test and fail here.
 *   2. AN AI DRAFT CANNOT SKIP REVIEW. §5.3 is explicit. `generation_method` is what turns the rule
 *      on, so if that column were misread, a machine-written lesson could publish.
 *
 * Everything is created and destroyed by this file, so it is safe against a live database.
 */
import { createDb, type Db } from './client.ts';
import { registerAccount } from './accounts.ts';
import {
  applyContentTransition,
  claimReviewTask,
  createReviewTask,
  listAuditLog,
  listReviewTasks,
  loadContentFacts,
  ReviewError,
  snapshotContentVersion,
  UNSUPPORTED_KINDS,
} from './learn-review.ts';
import type { Actor } from '@ozituma/core';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  const db: Db = await createDb({});
  const stamp = Date.now();

  // Four accounts: an author, a linguist, a native reviewer and an editor.
  const author = await registerAccount(db, { email: `rev-author-${stamp}@ozituma.test`, password: 'review-test-password' });
  const linguist = await registerAccount(db, { email: `rev-ling-${stamp}@ozituma.test`, password: 'review-test-password' });
  const native = await registerAccount(db, { email: `rev-native-${stamp}@ozituma.test`, password: 'review-test-password' });
  const editor = await registerAccount(db, { email: `rev-editor-${stamp}@ozituma.test`, password: 'review-test-password' });

  // 'contributor', not 'author'. `author` is not one of the nine roles in §5.2 — the domain
  // refused it with "A author may not submit", which is the check working. A contributor is who
  // authors and submits content.
  const authorActor: Actor = { id: author.id, role: 'contributor' as never, isAuthor: true };
  const linguistActor: Actor = { id: linguist.id, role: 'linguist' as never };
  const nativeActor: Actor = { id: native.id, role: 'native_reviewer' as never };
  // Publishing is a THIRD role again. §5.3 separates approving the language (linguist), approving
  // the audio (native reviewer) and putting it live (content editor) so that no single person can
  // carry a piece of content from draft to a learner on their own.
  const editorActor: Actor = { id: editor.id, role: 'content_editor' as never };

  // A course and unit are needed because a lesson references them.
  // `level` is TEXT with a check on named levels ('beginner', 'elementary', ...), not an integer.
  // The first version of this test passed 0 and the insert was refused by
  // `learn_course_level_check` — which is the constraint doing its job.
  const course = await db.one<{ id: number }>(
    `insert into learn_course (slug, title, language_code, level) values ($1,$2,'ibo','beginner') returning id`,
    [`rev-course-${stamp}`, 'Review Test']
  );
  const unit = await db.one<{ id: number }>(
    `insert into learn_unit (course_id, slug, title) values ($1,$2,$3) returning id`,
    [course!.id, `rev-unit-${stamp}`, 'Unit']
  );

  let lessonId = 0;

  try {
    // ---------------------------------------------------------------------
    // A lesson starts as a draft, and cannot be transitioned by just anyone
    // ---------------------------------------------------------------------
    // `created_by` is set: without it `authorId` reads null and the two-person rule silently has
    // nothing to compare against. The first version of this test omitted it and the rule appeared
    // to work only because it refused everything.
    const lesson = await db.one<{ id: number }>(
      `insert into learn_lesson (unit_id, slug, title, status, created_by)
       values ($1,$2,$3,'draft',$4) returning id`,
      [unit!.id, `rev-lesson-${stamp}`, 'Lesson', author.id]
    );
    lessonId = lesson!.id;

    const facts = await loadContentFacts(db, 'lesson', lessonId);
    check('a new lesson reads back as a draft', facts.status === 'draft');
    check('an authored lesson is not flagged as AI-generated', facts.aiGenerated === false);
    check('the author is recorded', facts.authorId !== null);

    // The migration 0031 fix: a lesson must be able to reach `submitted`. Before it, this write was
    // a constraint violation.
    const submitted = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'submit',
      actor: authorActor,
    });
    check('a lesson can be submitted for review (migration 0031)', submitted.ok, submitted.reason ?? submitted.code);
    check('submitting moves it to submitted', submitted.to === 'submitted', submitted.to ?? '');
    check('a submitted lesson is not learner-visible', submitted.learnerVisible === false);

    // ---------------------------------------------------------------------
    // The lifecycle has SIX steps, not four. §5.3 puts `start_review` between submitting and
    // approving, so a linguist picks a submission up deliberately rather than it appearing in
    // their approval list the instant an author finishes writing. The first version of this test
    // went straight from `submitted` to `approve_linguist` and the domain refused it with
    // "approve_linguist is not a step from submitted" — which is the state machine working.
    // ---------------------------------------------------------------------
    const started = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'start_review',
      actor: linguistActor,
    });
    check('a reviewer can start the review', started.ok, started.reason ?? started.code);
    check('starting review moves it to in_review', started.to === 'in_review', started.to ?? '');

    // ---------------------------------------------------------------------
    // Only the right role may act
    // ---------------------------------------------------------------------
    const wrongRole = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'approve_linguist',
      actor: nativeActor,
    });
    check('a native reviewer cannot perform the linguist approval', !wrongRole.ok, `code ${wrongRole.code}`);
    check('the refusal names a reason', typeof wrongRole.reason === 'string' && wrongRole.reason.length > 0);

    // ---------------------------------------------------------------------
    // THE TWO-PERSON RULE
    // ---------------------------------------------------------------------
    // The linguist IS the author of this lesson. Approving their own work must be refused.
    await db.rows(`update learn_lesson set created_by = $1 where id = $2`, [linguist.id, lessonId]);
    const selfApprove = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'approve_linguist',
      actor: { id: linguist.id, role: 'linguist' as never, isAuthor: true },
    });
    check(
      'a linguist CANNOT approve their own content',
      !selfApprove.ok,
      selfApprove.ok ? 'the two-person rule was bypassed' : `code ${selfApprove.code}`
    );

    // And it is not merely the `isAuthor` flag on the actor: the author_id stored on the row is what
    // the domain reads back, so the same actor with the flag unset is still refused.
    const selfApproveNoFlag = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'approve_linguist',
      actor: { id: linguist.id, role: 'linguist' as never },
    });
    check(
      'nor by omitting the isAuthor flag — the stored author_id decides',
      !selfApproveNoFlag.ok,
      selfApproveNoFlag.ok ? 'the rule depends on a caller-supplied flag' : `code ${selfApproveNoFlag.code}`
    );

    // A DIFFERENT linguist can approve it.
    await db.rows(`update learn_lesson set created_by = $1 where id = $2`, [author.id, lessonId]);
    const approved = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'approve_linguist',
      actor: linguistActor,
    });
    check('a different linguist can approve', approved.ok, approved.reason ?? approved.code);

    const afterApproval = await loadContentFacts(db, 'lesson', lessonId);
    check('the linguist approval is persisted on the row', afterApproval.linguistApprovedBy === linguist.id);

    // ---------------------------------------------------------------------
    // The full chain to published, then visibility
    // ---------------------------------------------------------------------
    const nativeApproved = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'approve_native',
      actor: nativeActor,
    });
    check('the native reviewer can approve', nativeApproved.ok, nativeApproved.reason ?? nativeApproved.code);

    const linguistPublish = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'publish',
      actor: linguistActor,
    });
    check(
      'a linguist CANNOT publish — approving the language is not the same as shipping it',
      !linguistPublish.ok,
      linguistPublish.ok ? 'the three-role separation was bypassed' : `code ${linguistPublish.code}`
    );

    const published = await applyContentTransition(db, {
      kind: 'lesson',
      id: lessonId,
      transition: 'publish',
      actor: editorActor,
    });
    check('a content editor can publish', published.ok, published.reason ?? published.code);
    check('a published lesson IS learner-visible', published.learnerVisible === true);
    check('and carries the verified trust label', published.trustLabel === 'verified', published.trustLabel ?? '');

    const stored = await db.one<{ status: string }>(`select status from learn_lesson where id = $1`, [lessonId]);
    check('the published status is what is stored', stored?.status === 'published', stored?.status ?? '');

    // ---------------------------------------------------------------------
    // AN AI DRAFT CANNOT SKIP REVIEW
    // ---------------------------------------------------------------------
    const aiLesson = await db.one<{ id: number }>(
      `insert into learn_lesson (unit_id, slug, title, status, generation_method, created_by)
       values ($1,$2,$3,'draft','ai',$4) returning id`,
      [unit!.id, `rev-ai-${stamp}`, 'AI Lesson', author.id]
    );

    const aiFacts = await loadContentFacts(db, 'lesson', aiLesson!.id);
    check('an AI-generated lesson reads back as AI-generated', aiFacts.aiGenerated === true);

    const aiSkip = await applyContentTransition(db, {
      kind: 'lesson',
      id: aiLesson!.id,
      transition: 'publish',
      actor: linguistActor,
    });
    check(
      'an AI draft CANNOT be published directly',
      !aiSkip.ok,
      aiSkip.ok ? 'an AI draft reached a learner without review' : `code ${aiSkip.code}`
    );

    const aiStored = await db.one<{ status: string }>(
      `select status from learn_lesson where id = $1`,
      [aiLesson!.id]
    );
    check('and its status is unchanged by the refusal', aiStored?.status === 'draft', aiStored?.status ?? '');

    // ---------------------------------------------------------------------
    // The audit log
    // ---------------------------------------------------------------------
    const audit = await listAuditLog(db, { contentKind: 'lesson', contentId: lessonId });
    check('every successful transition was logged', audit.length >= 4, `${audit.length} entries`);
    check(
      'a refused transition was NOT logged',
      !audit.some((entry) => entry.action === 'publish' && entry.after === null)
    );
    const publishEntry = audit.find((entry) => entry.action === 'publish');
    check('the audit entry records before and after', publishEntry?.before !== null && publishEntry?.after !== null);
    check('the audit entry records who did it', publishEntry?.actorId === editor.id, `actor ${publishEntry?.actorId}`);

    // ---------------------------------------------------------------------
    // Review tasks and the queue
    // ---------------------------------------------------------------------
    const task = await createReviewTask(db, {
      contentKind: 'lesson',
      contentId: lessonId,
      requiredRole: 'linguist' as never,
      origin: 'author',
      reason: 'Ready for review',
    });
    check('a review task can be opened', task.id > 0);
    check('it starts open', task.state === 'open');

    const queue = await listReviewTasks(db, { requiredRole: 'linguist' as never });
    check('it appears in the queue', queue.some((t) => t.id === task.id));
    check(
      'the queue carries the content status',
      queue.find((t) => t.id === task.id)?.contentStatus === 'published'
    );
    check('a lesson task is actionable', queue.find((t) => t.id === task.id)?.actionable === true);

    // Claiming is exclusive.
    const firstClaim = await claimReviewTask(db, task.id, linguist.id);
    check('a task can be claimed', firstClaim === true);
    const secondClaim = await claimReviewTask(db, task.id, native.id);
    check('a second reviewer CANNOT claim it', secondClaim === false);

    // ---------------------------------------------------------------------
    // Unsupported kinds are refused clearly rather than throwing a table error
    // ---------------------------------------------------------------------
    check('lexeme and exercise are listed as unsupported here', UNSUPPORTED_KINDS.length === 2);
    let kindError: ReviewError | null = null;
    try {
      await loadContentFacts(db, 'lexeme' as never, 1);
    } catch (error) {
      kindError = error as ReviewError;
    }
    check('a lexeme read raises a ReviewError, not a SQL error', kindError instanceof ReviewError);
    check('and says why', kindError?.code === 'unsupported_kind');

    // A task for an unsupported kind still displays, marked as not actionable.
    const lexemeTask = await createReviewTask(db, {
      contentKind: 'lexeme' as never,
      contentId: lessonId,
      requiredRole: 'native_reviewer' as never,
    });
    const queueWithLexeme = await listReviewTasks(db, { requiredRole: 'native_reviewer' as never });
    const shown = queueWithLexeme.find((t) => t.id === lexemeTask.id);
    check('a lexeme task is shown in the queue', shown !== undefined);
    check('and is marked not actionable', shown?.actionable === false);

    // ---------------------------------------------------------------------
    // Versions
    // ---------------------------------------------------------------------
    const v1 = await snapshotContentVersion(db, {
      contentKind: 'lesson',
      contentId: lessonId,
      snapshot: { title: 'Lesson' },
      authorId: author.id,
      changeNote: 'first',
    });
    const v2 = await snapshotContentVersion(db, {
      contentKind: 'lesson',
      contentId: lessonId,
      snapshot: { title: 'Lesson v2' },
      authorId: author.id,
      changeNote: 'second',
    });
    check('the first snapshot is version 1', v1 === 1, `got ${v1}`);
    check('the second is version 2', v2 === 2, `got ${v2}`);
  } finally {
    await db.rows(`delete from learn_audit_log where content_kind = 'lesson' and content_id = any($1::bigint[])`, [[lessonId]]);
    await db.rows(`delete from learn_review_task where content_kind in ('lesson','lexeme') and content_id = any($1::bigint[])`, [[lessonId]]);
    await db.rows(`delete from learn_content_version where content_kind = 'lesson' and content_id = any($1::bigint[])`, [[lessonId]]);
    if (course) await db.rows(`delete from learn_lesson where unit_id = $1`, [unit!.id]);
    if (course) await db.rows(`delete from learn_unit where id = $1`, [unit!.id]);
    if (course) await db.rows(`delete from learn_course where id = $1`, [course.id]);

    for (const account of [author, linguist, native, editor]) {
      await db.rows('delete from auth_session where account_id = $1', [account.id]);
      await db.rows('delete from account where id = $1', [account.id]);
    }

    const leftover = await db.one<{ n: number }>(
      `select count(*)::int as n from learn_review_task where content_id = $1`,
      [lessonId]
    );
    check('the test left no review tasks behind', Number(leftover?.n ?? 0) === 0);
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  await db.close();
  if (failed > 0) process.exitCode = 1;
}

await main();
