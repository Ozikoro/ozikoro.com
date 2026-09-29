/**
 * The generation validator — §8.1's "validation layer".
 *
 * Spec §8.1: "After generation, code checks: response language rules, no vocabulary contradicting
 * the knowledge base for the same headword, no disallowed content, length limits. Failed checks
 * fall back to a safe reply."
 *
 * Spec §8.2: "Generation validator — Check structure, answerability and source grounding. Reject
 * malformed or unsupported output."
 *
 * WHY THERE IS A VALIDATOR AT ALL, GIVEN THE MODEL IS INSTRUCTED WELL
 *
 * Because the instruction is a request and this is a check. §8.1 lists both, in that order, and
 * the reason is that a prompt cannot be tested — only a code path can. Everything in this file
 * runs on every response, is deterministic, and has a test, which is what makes it possible to
 * say afterwards what the tutor will never do rather than what it was asked not to do.
 *
 * WHY SOME FAILURES REJECT AND OTHERS ONLY CORRECT
 *
 * The distinction is whether the learner is worse off with the answer than without it.
 *
 *   - A malformed response cannot be shown, so it is replaced.
 *   - A **wrong trust label** is corrected, not discarded: the answer itself may be perfectly
 *     good, and throwing it away would punish the learner for the model's bookkeeping. §8.1 is
 *     exact that grounding determines the label, so the code sets the label and the model's
 *     claim about it is not trusted.
 *   - A **contradiction with the knowledge base** is rejected. This is the one failure that
 *     actively teaches something false, and §1.1 names it as the reason the whole source-of-truth
 *     principle exists: "A single wrong example in a curriculum spreads."
 */
import { tidy, toSearchForm } from '../orthography.ts';
import type { TutorMode } from './prompts.ts';
import type { KnowledgeItem, RetrievalResult } from './retrieval.ts';

// ---------------------------------------------------------------------------
// The output contract (Appendix B)
// ---------------------------------------------------------------------------

export interface TutorOutput {
  /** The reply, in English, with Igbo where it helps. */
  answer: string;
  /** Every Igbo word or phrase used, with diacritics preserved. */
  igboUsed: string[];
  /** The model's own claim about grounding. Verified by the code, not trusted. */
  trust: 'verified' | 'unverified';
  followUpSuggestion: string | null;
}

export type ValidationCode =
  | 'malformed_json'
  | 'schema'
  | 'empty_answer'
  | 'too_short'
  | 'too_long'
  | 'wrong_script'
  | 'contradicts_knowledge'
  | 'disallowed_content'
  | 'ungrounded_verified_claim'
  | 'unreviewed_source_cited';

export interface ValidationIssue {
  code: ValidationCode;
  /** For a human — a reviewer reading a log, not a learner. */
  detail: string;
  /** True when this issue means the answer cannot be shown at all. */
  fatal: boolean;
}

export interface ValidationResult {
  /** False when the answer must be replaced by {@link TutorOutput | fallback}. */
  ok: boolean;
  /** Present when the answer survived. The trust label here is the CODE's, not the model's. */
  output: TutorOutput | null;
  issues: ValidationIssue[];
  /** What to show instead. Always safe, always non-empty. */
  fallback: string;
}

export interface ValidationContext {
  mode: TutorMode;
  /** What retrieval actually returned, which is what the trust label is derived from. */
  grounding: RetrievalResult;
  /** The catalogue, for the contradiction check. */
  knowledge: readonly KnowledgeItem[];
  /** Output ceiling for this mode, from the prompt template. */
  maxOutputTokens?: number;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Pull the JSON object out of a model response.
 *
 * Models wrap JSON in prose or fences however they feel, especially when asked for "nothing else",
 * so the object is located rather than assumed to be the whole string. A response with no object
 * at all is a hard failure.
 */
export function parseTutorOutput(raw: string): TutorOutput {
  const trimmed = raw.trim();

  let candidate = trimmed;
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('no JSON object found in the response');
    }
    candidate = candidate.slice(start, end + 1);
  }

  const parsed = JSON.parse(candidate) as Record<string, unknown>;

  if (typeof parsed.answer !== 'string' || parsed.answer.trim() === '') {
    throw new Error('answer must be a non-empty string');
  }

  const igboUsed = Array.isArray(parsed.igbo_used ?? parsed.igboUsed)
    ? ((parsed.igbo_used ?? parsed.igboUsed) as unknown[])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];

  const rawTrust = parsed.trust;
  const trust = rawTrust === 'verified' ? 'verified' : 'unverified';

  const suggestion = parsed.follow_up_suggestion ?? parsed.followUpSuggestion;

  return {
    answer: parsed.answer.trim(),
    igboUsed,
    trust,
    followUpSuggestion:
      typeof suggestion === 'string' && suggestion.trim() !== '' ? suggestion.trim() : null,
  };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

const LATIN = /[A-Za-z\u00c0-\u024f\u1e00-\u1eff]/;

/**
 * Which script dominates the text, coarsely.
 *
 * The real failure this catches is a model answering in the wrong language entirely — Chinese,
 * Arabic, Cyrillic — which happens when a multilingual model misreads the context and which no
 * amount of prompting reliably prevents. It is deliberately not a language detector: telling
 * English from Igbo is not the job, and §F8 explicitly allows Igbo inside an English answer.
 */
export function dominantScript(text: string): 'latin' | 'other' | 'mixed' {
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  if (letters.length === 0) return 'other';

  const latin = letters.filter((character) => LATIN.test(character)).length;
  const ratio = latin / letters.length;

  if (ratio > 0.9) return 'latin';
  if (ratio < 0.5) return 'other';
  return 'mixed';
}

/**
 * High-precision unsafe-content patterns.
 *
 * Deliberately narrow. A broad word list would flag a legitimate explanation of an Igbo word that
 * happens to be spelled like an English profanity, and a false positive here blocks a learner
 * asking a real question. This is a backstop behind the system prompt and provider-side
 * moderation, not the primary control — the primary control is §8.1's retrieval-first design and
 * the review workflow that keeps the knowledge base clean.
 */
const UNSAFE_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\b(child|minor|underage)\b[^.!?]{0,40}\b(sexual|explicit|pornograph)/i, label: 'sexual content involving a minor' },
  { pattern: /\b(how to|instructions? (to|for))\b[^.!?]{0,40}\b(kill|murder|poison|bomb|explosive)/i, label: 'instructions for harming people' },
  { pattern: /\b(genocide|ethnic cleansing)\b[^.!?]{0,20}\b(is|are|was|were)\b[^.!?]{0,20}\b(good|justified|necessary)/i, label: 'endorsement of atrocity' },
];

export function checkSafety(answer: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { pattern, label } of UNSAFE_PATTERNS) {
    const match = pattern.exec(answer);
    if (match) {
      issues.push({
        code: 'disallowed_content',
        detail: `${label}: matched "${match[0].slice(0, 60)}"`,
        fatal: true,
      });
    }
  }
  return issues;
}

/**
 * Does the model's answer contradict the published meaning of a word it used?
 *
 * This is the check §8.1 asks for and it targets the failure that actually happens: the model
 * confusing two words that differ only by tone or by a dot. `àkwà` is a bed and `ákwá` is an egg;
 * a model that swaps them produces a fluent, confident, wrong answer, and a learner has no way to
 * tell.
 *
 * WHY IDENTITY HERE IS TONE-PRESERVING
 *
 * The first version of this function keyed words by their fully folded search form — the same
 * forgiving comparison the dictionary search uses. That is correct for search and completely
 * wrong here, because folding is exactly what erases the distinction being checked: `àkwà` and
 * `ákwá` both fold to `akwa`, so the two entries collided in one map and the check reported a
 * contradiction on a perfectly correct answer. The tone IS the identity for this purpose.
 *
 * So a word is identified by its canonical spelling with tone intact, and the tone-stripped form
 * is only used as a second chance when it is unambiguous — when nothing else in the knowledge base
 * folds to the same thing. When it IS ambiguous, the answer has to spell the tone to be judgeable,
 * and an unattributable sentence is left alone rather than guessed at. A false positive here
 * discards a good answer, which is worse than missing a swap.
 *
 * It remains a heuristic: it catches swaps and misattributions, not semantic entailment. The
 * defence against a model inventing a plausible new meaning is retrieval and the §8.3 evaluation
 * set, not this function.
 */
export function checkContradictions(
  answer: string,
  knowledge: readonly KnowledgeItem[]
): ValidationIssue[] {
  const published = knowledge.filter(
    (item) => item.status === 'published' && item.headword && item.glossEn
  );
  if (published.length === 0) return [];

  const tidyAnswer = tidy(answer).toLowerCase();

  // Which headword(s) legitimately carry each meaning. English glosses are compared folded, which
  // is right: case and phrasing vary in English without changing the meaning.
  const ownersByGloss = new Map<string, string[]>();
  for (const item of published) {
    const glossKey = toSearchForm(item.glossEn!);
    ownersByGloss.set(glossKey, [...(ownersByGloss.get(glossKey) ?? []), tidy(item.headword!).toLowerCase()]);
  }

  const issues: ValidationIssue[] = [];

  for (const item of published) {
    const headword = tidy(item.headword!);
    const identity = headword.toLowerCase();
    const folded = toSearchForm(headword);

    // Is the tone-stripped form shared with another entry? If so it cannot be used to attribute.
    const twins = published.filter((other) => toSearchForm(tidy(other.headword!)) === folded);
    const forms = twins.length === 1 ? [identity, folded] : [identity];

    const presentForm = forms.find((form) => tidyAnswer.includes(form));
    if (!presentForm) continue;

    for (const [glossKey, owners] of ownersByGloss) {
      if (owners.includes(identity)) continue; // this is the meaning this headword carries

      const attached = new RegExp(
        `${escapeRegex(presentForm)}\\s+(?:means?|is|=|refers to)\\s+(?:a\\s+|an\\s+|the\\s+)?${escapeRegex(glossKey)}\\b`,
        'i'
      );
      if (attached.test(tidyAnswer)) {
        issues.push({
          code: 'contradicts_knowledge',
          detail:
            `The answer gives "${glossKey}" as the meaning of "${headword}", but the published ` +
            `entry for "${headword}" means "${item.glossEn}".`,
          fatal: true,
        });
      }
    }
  }

  return issues;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

/** Shown instead of an answer that failed a check. Warm, honest, and points somewhere useful. */
export const SAFE_FALLBACK =
  "I could not put together a reliable answer to that one. The Igbo in it may be beyond what I can check against the reviewed material we have, so I would rather not guess. Try asking about a word or sentence from your current lesson, or look it up in the dictionary — and if you think this is a bug, the report button sends it to the people who can fix it.";

/** Length bounds by mode. Characters, not tokens — this is about what a learner can read. */
const LENGTH_BOUNDS: Record<TutorMode, { min: number; max: number }> = {
  explain: { min: 20, max: 1_200 },
  correct: { min: 20, max: 1_200 },
  translate: { min: 5, max: 900 },
  explain_pasted: { min: 20, max: 2_400 },
};

export function validateTutorOutput(raw: string, context: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];

  // --- structure -------------------------------------------------------------
  let output: TutorOutput;
  try {
    output = parseTutorOutput(raw);
  } catch (error) {
    return {
      ok: false,
      output: null,
      issues: [
        {
          code: 'malformed_json',
          detail: error instanceof Error ? error.message : String(error),
          fatal: true,
        },
      ],
      fallback: SAFE_FALLBACK,
    };
  }

  const bounds = LENGTH_BOUNDS[context.mode];
  const length = output.answer.length;

  if (length === 0) {
    issues.push({ code: 'empty_answer', detail: 'the answer was empty', fatal: true });
  } else if (length < bounds.min) {
    // Not fatal. "Ọ dị mma." is a complete and correct answer to "what does this mean?".
    issues.push({
      code: 'too_short',
      detail: `answer was ${length} characters; ${bounds.min} is the usual floor for ${context.mode}`,
      fatal: false,
    });
  } else if (length > bounds.max) {
    issues.push({
      code: 'too_long',
      detail: `answer was ${length} characters; ${bounds.max} is the ceiling for ${context.mode}`,
      fatal: true,
    });
  }

  // --- response language -----------------------------------------------------
  const script = dominantScript(output.answer);
  if (script === 'other') {
    issues.push({
      code: 'wrong_script',
      detail: 'the answer is mostly not Latin script, so it is not English or Igbo',
      fatal: true,
    });
  }

  // --- disallowed content ----------------------------------------------------
  issues.push(...checkSafety(output.answer));

  // --- contradiction with the knowledge base ---------------------------------
  issues.push(...checkContradictions(output.answer, context.knowledge));

  // --- grounding, which decides the trust label ------------------------------
  //
  // §8.1: "Answers grounded in published content show Verified. Anything else shows AI-assisted."
  // The model's own claim is therefore advisory. This corrects it rather than rejecting: the
  // answer may be perfectly good, and discarding it would punish the learner for the model's
  // bookkeeping.
  if (output.trust === 'verified' && context.grounding.empty) {
    issues.push({
      code: 'ungrounded_verified_claim',
      detail: 'the model claimed verified grounding but retrieval returned no published material',
      fatal: false,
    });
    output = { ...output, trust: 'unverified' };
  }

  // A "verified" claim when some grounding was shown is allowed to stand.
  if (output.trust === 'unverified' && !context.grounding.empty) {
    // The model was cautious. Leave it — being cautious is never wrong, and overriding caution
    // upward would be the platform claiming more than the model did.
  }

  const fatal = issues.filter((issue) => issue.fatal);
  if (fatal.length > 0) {
    return { ok: false, output: null, issues, fallback: SAFE_FALLBACK };
  }

  return { ok: true, output, issues, fallback: SAFE_FALLBACK };
}

/**
 * The label a learner sees.
 *
 * §5.3: "Verified" means reviewed and approved; "AI-assisted" means generated with AI and not yet
 * editorially verified, shown with the amber note and the report button. §8.1 requires the label
 * on every response, which is why this cannot return null.
 */
export interface LearnerFacingLabel {
  kind: 'verified' | 'ai_assisted';
  text: string;
}

export function labelForLearner(output: TutorOutput): LearnerFacingLabel {
  return output.trust === 'verified'
    ? { kind: 'verified', text: 'Verified against reviewed Ozituma material.' }
    : {
        kind: 'ai_assisted',
        text: 'AI-generated: may contain errors. Report a mistake.',
      };
}
