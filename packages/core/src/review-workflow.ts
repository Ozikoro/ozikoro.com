/**
 * The content lifecycle and review workflow.
 *
 * Spec §5.3 defines the lifecycle. §F10's acceptance criterion is the point of this file:
 * "All lifecycle transitions in Section 5 are enforced in code, not just in the UI."
 *
 * That sentence is why this is a pure module rather than a set of checks inside route handlers.
 * A rule enforced in the UI is a rule that holds until someone calls the API directly, and the
 * thing being protected here is not a user's convenience — it is the claim that learner-visible
 * Igbo has been reviewed by two qualified people. §2.1's first non-negotiable ("AI never authors
 * published language content") is only true if the transition that publishes it is refused by the
 * server.
 *
 * TWO THINGS THIS ENFORCES THAT ARE EASY TO GET WRONG
 *
 * 1. ORDER. §5.3 writes the lifecycle as `linguist_approved -> native_approved -> published`, and
 *    the order is not cosmetic: §11.5 requires "Two-person review (linguist and native speaker)".
 *    A native speaker approving an item the linguist has not seen is one reviewer, not two, and
 *    allowing it silently halves the review the platform claims to do.
 *
 * 2. SEPARATION. §11.5 says two people, so one person may not perform both approvals — including
 *    an admin. The alternative reading ("an admin can do everything") would mean the platform's
 *    strongest reviewer guarantee is waivable by the most powerful account, which is exactly
 *    backwards.
 */
import type { ReviewStatus, TrustLabel } from './exercises.ts';

export type { ReviewStatus };

/** §5.2's roles. */
export type Role =
  | 'guest'
  | 'learner'
  | 'contributor'
  | 'linguist'
  | 'native_reviewer'
  | 'content_editor'
  | 'editor'
  | 'admin'
  | 'owner';

/** Roles that may act on content rather than only consume it. */
export const STAFF_ROLES: readonly Role[] = [
  'contributor',
  'linguist',
  'native_reviewer',
  'content_editor',
  'editor',
  'admin',
  'owner',
];

/** The actions a lifecycle transition can represent. */
export type Transition =
  | 'submit'
  | 'start_review'
  | 'approve_linguist'
  | 'approve_native'
  | 'publish'
  | 'unpublish'
  | 'request_changes'
  | 'resubmit'
  | 'archive'
  | 'restore';

export interface Actor {
  id: number;
  role: Role;
  /** The account that created the item, when known. Used for the two-person rule. */
  isAuthor?: boolean;
}

export interface ContentFacts {
  status: ReviewStatus;
  /** §5.3: AI drafts "can never skip review". */
  aiGenerated: boolean;
  /** Who authored it, when known. */
  authorId?: number | null;
  /** Who performed the linguist approval, when it has happened. */
  linguistApprovedBy?: number | null;
  /** §F4: "A lexeme cannot be published without approved audio". */
  hasApprovedAudio?: boolean;
  /** Some content is grammar-only and carries a documented exception (§F4). */
  audioExempt?: boolean;
}

export type RefusalCode =
  | 'not_allowed'
  | 'wrong_state'
  | 'same_person'
  | 'missing_reason'
  | 'missing_audio'
  | 'ai_cannot_skip_review';

export interface TransitionResult {
  ok: boolean;
  /** The status the item moves to, when the transition is allowed. */
  to?: ReviewStatus;
  code?: RefusalCode;
  /** Shown to the reviewer. Says what is wrong, not merely that something is. */
  reason?: string;
}

/** The statuses, in the order §5.3 defines them. */
export const LIFECYCLE: readonly ReviewStatus[] = [
  'draft',
  'submitted',
  'in_review',
  'linguist_approved',
  'native_approved',
  'published',
];

/**
 * Which roles may perform which transition.
 *
 * Read directly from §5.2's table. Note that `publish` belongs to `content_editor` alone among the
 * specialist roles — §5.2: "Content editor: … final publish/unpublish of approved items" — and
 * that a linguist approving language is a different act from an editor publishing it.
 */
const ALLOWED: Record<Transition, readonly Role[]> = {
  submit: ['contributor', 'linguist', 'content_editor', 'editor', 'admin', 'owner'],
  start_review: ['linguist', 'native_reviewer', 'content_editor', 'editor', 'admin', 'owner'],
  approve_linguist: ['linguist', 'admin', 'owner'],
  approve_native: ['native_reviewer', 'admin', 'owner'],
  publish: ['content_editor', 'editor', 'admin', 'owner'],
  unpublish: ['content_editor', 'editor', 'admin', 'owner'],
  request_changes: ['linguist', 'native_reviewer', 'content_editor', 'editor', 'admin', 'owner'],
  resubmit: ['contributor', 'linguist', 'content_editor', 'editor', 'admin', 'owner'],
  archive: ['content_editor', 'editor', 'admin', 'owner'],
  restore: ['content_editor', 'editor', 'admin', 'owner'],
};

/**
 * The state machine, as §5.3 draws it.
 *
 * `request_changes` returns to `draft` because §5.3 shows it doing so: "-> changes_requested (with
 * reason) -> draft". The `changes_requested` status is recorded on the review task rather than held
 * as the item's status, so the item can be edited immediately — which is what a person who has been
 * asked for changes actually wants to do.
 */
const TRANSITIONS: Record<ReviewStatus, Partial<Record<Transition, ReviewStatus>>> = {
  draft: { submit: 'submitted' },
  submitted: { start_review: 'in_review', request_changes: 'draft', archive: 'archived' },
  in_review: {
    approve_linguist: 'linguist_approved',
    request_changes: 'draft',
    archive: 'archived',
  },
  linguist_approved: {
    approve_native: 'native_approved',
    request_changes: 'draft',
    archive: 'archived',
  },
  native_approved: { publish: 'published', request_changes: 'draft', archive: 'archived' },
  published: { unpublish: 'native_approved', archive: 'archived' },
  changes_requested: { resubmit: 'submitted', archive: 'archived' },
  archived: { restore: 'draft' },
};

export interface TransitionOptions {
  /** §5.3: "changes_requested (with reason)". */
  reason?: string;
}

/**
 * Decide whether a transition may happen.
 *
 * Pure: it looks at the item's facts and the actor, and returns a decision. It does not write
 * anything, so the same function guards a route handler, a CMS button and an import script.
 */
export function canTransition(
  facts: ContentFacts,
  actor: Actor,
  transition: Transition,
  options: TransitionOptions = {}
): TransitionResult {
  // 1. The target state must exist for the current one.
  const to = TRANSITIONS[facts.status]?.[transition];
  if (!to) {
    return {
      ok: false,
      code: 'wrong_state',
      reason: `"${transition}" is not a step from "${facts.status}".`,
    };
  }

  // 2. The actor's role must permit the action.
  if (!ALLOWED[transition].includes(actor.role)) {
    return {
      ok: false,
      code: 'not_allowed',
      reason: `A ${actor.role} may not "${transition}".`,
    };
  }

  // 3. Requesting changes must say what to change. A rejection with no reason is not review.
  if (transition === 'request_changes' && (options.reason ?? '').trim().length < 3) {
    return {
      ok: false,
      code: 'missing_reason',
      reason: 'Requesting changes requires a reason the author can act on.',
    };
  }

  // 4. §5.3: "AI-generated drafts are created with source = 'ai' and can never skip review."
  //
  // Applied to publishing only, because that is the door that matters. An AI draft may be
  // submitted, reviewed and approved exactly like anything else — what it may not do is reach a
  // learner without having passed through the two approvals, which the state machine already
  // requires. This check exists so that a future shortcut added to the machine cannot bypass it.
  if (transition === 'publish' && facts.aiGenerated && facts.status !== 'native_approved') {
    return {
      ok: false,
      code: 'ai_cannot_skip_review',
      reason:
        'AI-generated content can only be published from native_approved. It cannot skip the ' +
        'linguist and native-speaker review (§5.3).',
    };
  }

  // 5. §11.5: "Two-person review (linguist and native speaker)." One person may not be both.
  //
  // Checked against the author too: an author approving their own work is one person, whatever
  // their role. Admins are included deliberately — see this file's header.
  if (transition === 'approve_linguist' && facts.authorId != null && facts.authorId === actor.id) {
    return {
      ok: false,
      code: 'same_person',
      reason: 'The person who wrote this cannot be the linguist who approves it.',
    };
  }

  if (transition === 'approve_native') {
    if (facts.linguistApprovedBy != null && facts.linguistApprovedBy === actor.id) {
      return {
        ok: false,
        code: 'same_person',
        reason:
          'The native-speaker approval must come from a different person than the linguist approval.',
      };
    }
    if (facts.authorId != null && facts.authorId === actor.id) {
      return {
        ok: false,
        code: 'same_person',
        reason: 'The person who wrote this cannot be the native speaker who approves it.',
      };
    }
  }

  // 6. §F4: "A lexeme cannot be published without approved audio (configurable exception for
  //    grammar-only items)."
  if (transition === 'publish' && facts.hasApprovedAudio === false && facts.audioExempt !== true) {
    return {
      ok: false,
      code: 'missing_audio',
      reason:
        'This item has no approved recording. §F4 requires one before publication, unless the ' +
        'item is grammar-only and marked as exempt.',
    };
  }

  return { ok: true, to };
}

/**
 * Apply a transition, or throw.
 *
 * For callers that have already checked and want the failure to be loud — an import script or a
 * migration, where a refused transition means the data is inconsistent rather than the user having
 * pressed the wrong button.
 */
export class WorkflowError extends Error {
  override readonly name = 'WorkflowError';
  readonly code: RefusalCode;
  constructor(result: TransitionResult) {
    super(result.reason ?? 'The transition was refused.');
    this.code = result.code ?? 'not_allowed';
  }
}

export function applyTransition(
  facts: ContentFacts,
  actor: Actor,
  transition: Transition,
  options: TransitionOptions = {}
): ReviewStatus {
  const result = canTransition(facts, actor, transition, options);
  if (!result.ok || !result.to) throw new WorkflowError(result);
  return result.to;
}

/** §5.3: only published items are visible to learners. */
export function isLearnerVisible(status: ReviewStatus): boolean {
  return status === 'published';
}

/**
 * §5.3's trust labels, as a function of review state.
 *
 * Kept here rather than beside the exercise engine so the lifecycle has one owner: a label is a
 * statement about where an item is in this machine, and a second implementation elsewhere is a
 * second thing to keep in step.
 */
export function trustLabelForStatus(status: ReviewStatus, aiGenerated = false): TrustLabel {
  if (status === 'published') return 'verified';
  if (status === 'submitted' || status === 'in_review') return 'community_submission';
  if (status === 'linguist_approved' || status === 'native_approved') return 'verified';
  if (aiGenerated) return 'ai_assisted';
  return 'needs_review';
}

/**
 * Whether the AI tutor may use this item as trusted knowledge.
 *
 * §5.3: "Only items in published status are … available to the AI tutor as trusted knowledge."
 * A function rather than a condition, so the retrieval layer and any future caller cannot each
 * decide for themselves.
 */
export function isTutorGroundable(status: ReviewStatus): boolean {
  return status === 'published';
}

/**
 * What the actor may do next, for rendering a CMS without the UI re-deriving the rules.
 *
 * The probe supplies a placeholder reason, because a transition that requires one is still
 * AVAILABLE — the reason is collected after the reviewer chooses it, not before the button is
 * shown. Probing without it hid "request changes" from every reviewer, which is the one action a
 * review queue exists for.
 */
export function availableTransitions(facts: ContentFacts, actor: Actor): Transition[] {
  const all = Object.keys(TRANSITIONS[facts.status] ?? {}) as Transition[];
  return all.filter((transition) => canTransition(facts, actor, transition, { reason: '_probe' }).ok);
}

/** A progress summary for the CMS: which of §5.3's steps have happened. */
export interface ReviewProgress {
  stage: number;
  total: number;
  linguistApproved: boolean;
  nativeApproved: boolean;
  published: boolean;
}

export function reviewProgress(facts: ContentFacts): ReviewProgress {
  const index = LIFECYCLE.indexOf(facts.status);
  return {
    stage: index < 0 ? 0 : index,
    total: LIFECYCLE.length - 1,
    linguistApproved: facts.linguistApprovedBy != null,
    nativeApproved: index >= LIFECYCLE.indexOf('native_approved'),
    published: facts.status === 'published',
  };
}
