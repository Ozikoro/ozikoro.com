/**
 * Review workflow tests.
 *
 * §F10's acceptance criterion is that the lifecycle is "enforced in code, not just in the UI", so
 * these tests are the evidence for that claim. They are written as attacks as much as happy paths:
 * every one of them asks whether the machine can be talked into publishing something that has not
 * been reviewed by two people.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFECYCLE,
  WorkflowError,
  applyTransition,
  availableTransitions,
  canTransition,
  isLearnerVisible,
  isTutorGroundable,
  reviewProgress,
  trustLabelForStatus,
  type Actor,
  type ContentFacts,
} from './review-workflow.ts';

const linguist: Actor = { id: 1, role: 'linguist' };
const native: Actor = { id: 2, role: 'native_reviewer' };
const editor: Actor = { id: 3, role: 'content_editor' };
const admin: Actor = { id: 9, role: 'admin' };
const author: Actor = { id: 5, role: 'contributor' };

function facts(overrides: Partial<ContentFacts> = {}): ContentFacts {
  return {
    status: 'draft',
    aiGenerated: false,
    authorId: author.id,
    hasApprovedAudio: true,
    ...overrides,
  };
}

/** Drive an item through the whole lifecycle with three different people. */
function toPublished(start: ContentFacts = facts()) {
  let current = start;
  const steps: [Actor, Parameters<typeof canTransition>[2]][] = [
    [author, 'submit'],
    [linguist, 'start_review'],
    [linguist, 'approve_linguist'],
    [native, 'approve_native'],
    [editor, 'publish'],
  ];
  for (const [actor, transition] of steps) {
    const result = canTransition(current, actor, transition);
    assert.equal(result.ok, true, `${transition} refused: ${result.reason}`);
    current = {
      ...current,
      status: result.to!,
      ...(transition === 'approve_linguist' ? { linguistApprovedBy: actor.id } : {}),
    };
  }
  return current;
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test('an item can be published through the full §5.3 lifecycle by three different people', () => {
  const published = toPublished();
  assert.equal(published.status, 'published');
  assert.equal(isLearnerVisible(published.status), true);
});

test('every step of the lifecycle appears in the declared order', () => {
  assert.deepEqual(LIFECYCLE, ['draft', 'submitted', 'in_review', 'linguist_approved', 'native_approved', 'published']);
});

test('applyTransition returns the new status or throws', () => {
  assert.equal(applyTransition(facts(), author, 'submit'), 'submitted');
  assert.throws(() => applyTransition(facts(), author, 'publish'), WorkflowError);
});

test('the thrown error carries a machine-readable code', () => {
  try {
    applyTransition(facts(), author, 'publish');
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof WorkflowError);
    assert.equal(error.code, 'wrong_state');
  }
});

// ---------------------------------------------------------------------------
// Order — §11.5's two-person review
// ---------------------------------------------------------------------------

test('native approval cannot happen before linguist approval', () => {
  // The order is not cosmetic: §11.5 requires a linguist AND a native speaker, so approving in the
  // other order is one reviewer, not two.
  const result = canTransition(facts({ status: 'in_review' }), native, 'approve_native');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'wrong_state');
});

test('publishing is refused from every status except native_approved', () => {
  for (const status of ['draft', 'submitted', 'in_review', 'linguist_approved'] as const) {
    const result = canTransition(facts({ status }), editor, 'publish');
    assert.equal(result.ok, false, `publish from ${status} must be refused`);
  }
  assert.equal(canTransition(facts({ status: 'native_approved' }), editor, 'publish').ok, true);
});

test('the author cannot be the linguist who approves their own work', () => {
  const selfApproving: Actor = { id: author.id, role: 'linguist' };
  const result = canTransition(facts({ status: 'in_review' }), selfApproving, 'approve_linguist');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'same_person');
});

test('the author cannot be the native speaker who approves their own work', () => {
  const selfApproving: Actor = { id: author.id, role: 'native_reviewer' };
  const result = canTransition(
    facts({ status: 'linguist_approved', linguistApprovedBy: linguist.id }),
    selfApproving,
    'approve_native'
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'same_person');
});

test('one person may not perform both approvals, even an admin', () => {
  // The alternative reading — "an admin can do everything" — would make the platform's strongest
  // reviewer guarantee waivable by its most powerful account, which is backwards.
  const factsAt: ContentFacts = { ...facts({ status: 'linguist_approved' }), linguistApprovedBy: admin.id };
  const result = canTransition(factsAt, admin, 'approve_native');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'same_person');
});

test('different people may perform the two approvals', () => {
  const result = canTransition(
    facts({ status: 'linguist_approved', linguistApprovedBy: linguist.id }),
    native,
    'approve_native'
  );
  assert.equal(result.ok, true);
  assert.equal(result.to, 'native_approved');
});

// ---------------------------------------------------------------------------
// Roles — §5.2
// ---------------------------------------------------------------------------

test('a learner may not act on content at all', () => {
  const learner: Actor = { id: 7, role: 'learner' };
  for (const transition of ['submit', 'start_review', 'approve_linguist', 'approve_native', 'publish'] as const) {
    const result = canTransition(facts({ status: 'in_review' }), learner, transition);
    assert.equal(result.ok, false, `a learner must not be able to ${transition}`);
  }
});

test('a linguist may not publish — that is the editor’s act, not theirs', () => {
  const result = canTransition(facts({ status: 'native_approved' }), linguist, 'publish');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_allowed');
});

test('a native reviewer may not approve the language', () => {
  const result = canTransition(facts({ status: 'in_review' }), native, 'approve_linguist');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_allowed');
});

test('a content editor may not approve language or audio', () => {
  assert.equal(canTransition(facts({ status: 'in_review' }), editor, 'approve_linguist').ok, false);
  assert.equal(
    canTransition(facts({ status: 'linguist_approved' }), editor, 'approve_native').ok,
    false
  );
});

// ---------------------------------------------------------------------------
// AI content — §5.3's "can never skip review"
// ---------------------------------------------------------------------------

test('AI-generated content cannot be published without the two approvals', () => {
  const result = canTransition(
    facts({ status: 'draft', aiGenerated: true }),
    editor,
    'publish'
  );
  assert.equal(result.ok, false, 'the state machine already refuses this, and the label says why');
});

test('an AI draft can still be submitted and reviewed like anything else', () => {
  // §5.3 forbids SKIPPING review, not being reviewed.
  const submitted = canTransition(facts({ aiGenerated: true }), author, 'submit');
  assert.equal(submitted.ok, true);
});

test('AI content reaches a learner only through the full lifecycle', () => {
  const published = toPublished(facts({ aiGenerated: true }));
  assert.equal(published.status, 'published');
  assert.equal(isLearnerVisible(published.status), true);
});

// ---------------------------------------------------------------------------
// Audio — §F4
// ---------------------------------------------------------------------------

test('an item without approved audio cannot be published', () => {
  const result = canTransition(
    facts({ status: 'native_approved', hasApprovedAudio: false }),
    editor,
    'publish'
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_audio');
});

test('a grammar-only item may carry the documented exemption', () => {
  const result = canTransition(
    facts({ status: 'native_approved', hasApprovedAudio: false, audioExempt: true }),
    editor,
    'publish'
  );
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Requesting changes — §5.3 requires a reason
// ---------------------------------------------------------------------------

test('requesting changes without a reason is refused', () => {
  for (const reason of [undefined, '', '  ', 'no']) {
    const result = canTransition(facts({ status: 'in_review' }), linguist, 'request_changes', {
      reason,
    });
    assert.equal(result.ok, false, `reason ${JSON.stringify(reason)} should be refused`);
    assert.equal(result.code, 'missing_reason');
  }
});

test('requesting changes with a reason returns the item to draft', () => {
  const result = canTransition(facts({ status: 'in_review' }), linguist, 'request_changes', {
    reason: 'The tone on the second syllable is wrong.',
  });
  assert.equal(result.ok, true);
  assert.equal(result.to, 'draft');
});

// ---------------------------------------------------------------------------
// Visibility and labels
// ---------------------------------------------------------------------------

test('only published content is visible to a learner — §5.3', () => {
  const statuses = [
    'draft', 'submitted', 'in_review', 'linguist_approved', 'native_approved', 'changes_requested', 'archived',
  ] as const;
  for (const status of statuses) {
    assert.equal(isLearnerVisible(status), false, `${status} must not be learner-visible`);
  }
  assert.equal(isLearnerVisible('published'), true);
});

test('only published content may ground the AI tutor — §5.3', () => {
  // The rule the retrieval layer depends on, expressed once so two callers cannot disagree.
  assert.equal(isTutorGroundable('published'), true);
  for (const status of ['draft', 'in_review', 'linguist_approved', 'native_approved'] as const) {
    assert.equal(isTutorGroundable(status), false, status);
  }
});

test('trust labels follow the review state', () => {
  assert.equal(trustLabelForStatus('published'), 'verified');
  assert.equal(trustLabelForStatus('native_approved'), 'verified');
  assert.equal(trustLabelForStatus('linguist_approved'), 'verified');
  assert.equal(trustLabelForStatus('in_review'), 'community_submission');
  assert.equal(trustLabelForStatus('submitted'), 'community_submission');
  assert.equal(trustLabelForStatus('draft'), 'needs_review');
  assert.equal(trustLabelForStatus('draft', true), 'ai_assisted');
});

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

test('published content can be archived and restored, and loses visibility while archived', () => {
  const published = toPublished();
  const archived = canTransition(published, editor, 'archive');
  assert.equal(archived.ok, true);
  assert.equal(archived.to, 'archived');
  assert.equal(isLearnerVisible('archived'), false);

  const restored = canTransition({ ...published, status: 'archived' }, editor, 'restore');
  assert.equal(restored.ok, true);
  assert.equal(restored.to, 'draft', 'restoring returns it for review, not to published');
});

test('content can be unpublished, which sends it back a step rather than to draft', () => {
  const published = toPublished();
  const result = canTransition(published, editor, 'unpublish');
  assert.equal(result.ok, true);
  assert.equal(result.to, 'native_approved', 'the approvals are not discarded by unpublishing');
  assert.equal(isLearnerVisible(result.to!), false);
});

// ---------------------------------------------------------------------------
// The CMS view
// ---------------------------------------------------------------------------

test('availableTransitions reports what this actor may do next', () => {
  const atReview = facts({ status: 'in_review' });
  // A linguist approves the language or sends it back. Archiving is an editorial act, not theirs.
  assert.deepEqual(availableTransitions(atReview, linguist).sort(), ['approve_linguist', 'request_changes'].sort());
  // A native reviewer cannot approve the language yet, but §5.2 gives them "flag usage and dialect
  // issues" — and flagging an issue IS requesting a change. Withholding that would take away the
  // one action their role is explicitly for.
  assert.deepEqual(availableTransitions(atReview, native), ['request_changes']);
  // An editor may send it back or archive it, but may not approve the language.
  assert.deepEqual(availableTransitions(atReview, editor).sort(), ['archive', 'request_changes'].sort());
});

test('availableTransitions never offers publishing before native approval', () => {
  for (const status of ['draft', 'submitted', 'in_review', 'linguist_approved'] as const) {
    assert.ok(
      !availableTransitions(facts({ status }), editor).includes('publish'),
      `publish offered at ${status}`
    );
  }
});

test('reviewProgress summarises where an item is', () => {
  const start = reviewProgress(facts());
  assert.equal(start.stage, 0);
  assert.equal(start.published, false);

  const end = reviewProgress(toPublished());
  assert.equal(end.published, true);
  assert.equal(end.linguistApproved, true);
  assert.equal(end.nativeApproved, true);
  assert.equal(end.stage, end.total);
});
