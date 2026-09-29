/**
 * Guardrail tests — retrieval, validation and cost controls.
 *
 * §8.1's requirements are the spine: retrieval must see published content only; the validator must
 * check language, contradiction, safety and length and fall back safely; the limits must actually
 * bound what a learner can spend.
 *
 * The single most important assertion in this file is the first one. If unpublished material can
 * reach the tutor as VERIFIED CONTENT, the model will faithfully present it as verified, and the
 * platform will have laundered an unreviewed draft into a confident answer carrying a Verified
 * label — which is the precise failure §2.1 and §5.3 exist to prevent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectKnowledge,
  formatKnowledgeBlock,
  trustForGrounding,
  queryTerms,
  type KnowledgeItem,
} from './retrieval.ts';
import {
  SAFE_FALLBACK,
  checkContradictions,
  checkSafety,
  dominantScript,
  labelForLearner,
  parseTutorOutput,
  validateTutorOutput,
} from './validator.ts';
import {
  DEFAULT_PLAN,
  PLANS,
  RateLimiter,
  SpendLedger,
  checkInputSize,
  checkMessageAllowance,
  outputCeiling,
  planFor,
  type ModelPricing,
} from './limits.ts';

// Test fixtures. The Igbo pair used in the contradiction test is a well-known minimal pair and is
// used to exercise a mechanical code path — it is not content that ships, and the real knowledge
// base is a linguist deliverable (§18 #4).
function knowledge(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 'k1',
    kind: 'lexeme',
    languageCode: 'ibo',
    status: 'published',
    text: 'a fixture entry',
    ...overrides,
  };
}

const published = knowledge({ id: 'p1', headword: 'àkwà', glossEn: 'bed', lessonId: 'L1', level: 1 });
const other = knowledge({ id: 'p2', headword: 'ákwá', glossEn: 'egg', lessonId: 'L1', level: 1 });
const draft = knowledge({ id: 'd1', headword: 'unreviewed', glossEn: 'draft', status: 'draft' });
const inReview = knowledge({ id: 'd2', headword: 'maybe', status: 'in_review' });
const otherLanguage = knowledge({ id: 'y1', languageCode: 'yor', headword: 'ilé' });

const groundingOf = (items: readonly KnowledgeItem[], query = {}) => {
  const result = selectKnowledge(items, { languageCode: 'ibo', ...query });
  return result;
};

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

test('unpublished material can NEVER be retrieved — §5.3', () => {
  const result = groundingOf([published, other, draft, inReview, otherLanguage]);
  const ids = result.items.map((item) => item.id);
  assert.deepEqual(ids.sort(), ['p1', 'p2'], 'only published items in the right language');
});

test('every lifecycle state short of published is excluded', () => {
  const states = ['draft', 'submitted', 'in_review', 'linguist_approved', 'native_approved', 'changes_requested', 'archived'] as const;
  for (const status of states) {
    const result = groundingOf([knowledge({ id: 'x', status })]);
    assert.equal(result.items.length, 0, `${status} must not be retrievable`);
    assert.equal(result.empty, true);
  }
});

test('another language is never mixed into the grounding', () => {
  const result = groundingOf([published, otherLanguage]);
  assert.deepEqual(result.items.map((item) => item.id), ['p1']);
});

test('an empty result is reported as empty so the trust label can follow', () => {
  const result = groundingOf([draft]);
  assert.equal(result.empty, true);
  assert.equal(result.consideredCount, 0);
  assert.equal(trustForGrounding(result), 'ai_assisted');
});

test('grounded on published content is verified — §8.1', () => {
  assert.equal(trustForGrounding(groundingOf([published])), 'verified');
});

test('the current lesson ranks first', () => {
  const inLesson = knowledge({ id: 'L1-item', lessonId: 'L1', level: 1 });
  const elsewhere = knowledge({ id: 'L2-item', lessonId: 'L2', level: 1 });
  const result = groundingOf([elsewhere, inLesson], { lessonId: 'L1' });
  assert.equal(result.items[0]!.id, 'L1-item');
});

test('terms rank material, and fold diacritics so tone-blind typing still matches', () => {
  // The learner types "akwa"; the entry is "àkwà". Same forgiving comparison as dictionary search.
  const result = groundingOf([other, published], { terms: ['akwa'] });
  assert.ok(result.items.length > 0, 'a diacritic-free query matched something');
});

test('material far above the learner level is excluded', () => {
  const beginner = knowledge({ id: 'b', level: 1 });
  const advanced = knowledge({ id: 'a', level: 5 });
  const result = groundingOf([beginner, advanced], { level: 1 });
  assert.deepEqual(result.items.map((item) => item.id), ['b']);
});

test('one level above is still allowed, because the next unit is a fair question', () => {
  const next = knowledge({ id: 'n', level: 2 });
  const result = groundingOf([next], { level: 1 });
  assert.deepEqual(result.items.map((item) => item.id), ['n']);
});

test('the item budget is enforced and reported', () => {
  const many = Array.from({ length: 30 }, (_, i) => knowledge({ id: `k${i}`, level: 1 }));
  const result = groundingOf(many, { maxItems: 5 });
  assert.equal(result.items.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.consideredCount, 30);
});

test('the character budget is enforced so one long question cannot blow the context window', () => {
  const long = knowledge({ id: 'long', text: 'x'.repeat(500), level: 1 });
  const result = groundingOf([long, published], { maxCharacters: 100, level: 1 });
  assert.ok(result.items.every((item) => item.text.length <= 100));
  assert.equal(result.truncated, true);
});

test('the knowledge block names each item, its region and its source', () => {
  const item = knowledge({ headword: 'àkwà', glossEn: 'bed', region: 'Nsuka', source: 'A reviewed source', level: 1 });
  const block = formatKnowledgeBlock([item]);
  assert.match(block, /LEXEME/);
  assert.match(block, /àkwà/);
  assert.match(block, /Nsuka/);
  assert.match(block, /A reviewed source/);
});

test('an empty block tells the model to be cautious rather than saying nothing', () => {
  // A blank block reads to a model as "no constraints" rather than "nothing is verified".
  const block = formatKnowledgeBlock([]);
  assert.match(block, /unverified/);
  assert.match(block, /unsure/);
});

test('query terms drop stop words and very short tokens', () => {
  const terms = queryTerms('What does the word àkwà mean in Igbo?');
  assert.ok(terms.includes('àkwà'));
  assert.ok(!terms.includes('the'));
  assert.ok(!terms.includes('does'));
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const grounding = groundingOf([published, other], { lessonId: 'L1', level: 1 });

function validate(answer: unknown, overrides: { grounding?: typeof grounding; mode?: 'explain' } = {}) {
  const raw = typeof answer === 'string' ? answer : JSON.stringify(answer);
  return validateTutorOutput(raw, {
    mode: overrides.mode ?? 'explain',
    grounding: overrides.grounding ?? grounding,
    knowledge: [published, other],
  });
}

test('a well-formed answer is accepted and keeps its trust label', () => {
  const result = validate({
    answer: 'Àkwà means bed. It is the word for the thing you sleep on.',
    igbo_used: ['àkwà'],
    trust: 'verified',
    follow_up_suggestion: 'Try using it in a sentence.',
  });
  assert.equal(result.ok, true);
  assert.equal(result.output?.trust, 'verified');
  assert.deepEqual(result.output?.igboUsed, ['àkwà']);
});

test('malformed JSON is rejected with the safe fallback', () => {
  const result = validate('I am not JSON at all');
  assert.equal(result.ok, false);
  assert.equal(result.fallback, SAFE_FALLBACK);
  assert.equal(result.issues[0]!.code, 'malformed_json');
});

test('JSON wrapped in prose or fences is still parsed', () => {
  const result = validate('Sure! Here you go:\n```json\n{"answer":"Àkwà means bed, a place to sleep.","igbo_used":["àkwà"],"trust":"verified","follow_up_suggestion":null}\n```');
  assert.equal(result.ok, true);
});

test('an answer missing its required field is rejected', () => {
  assert.equal(validate({ igbo_used: [], trust: 'verified' }).ok, false);
});

test('an over-long answer is rejected, because §F8 wants short answers', () => {
  const result = validate({
    answer: 'word '.repeat(500),
    igbo_used: [],
    trust: 'unverified',
    follow_up_suggestion: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'too_long' && issue.fatal));
});

test('an empty answer is rejected', () => {
  assert.equal(validate({ answer: '', igbo_used: [], trust: 'unverified' }).ok, false);
});

test('dominantScript identifies a wrong-language answer', () => {
  assert.equal(dominantScript('Àkwà means bed'), 'latin');
  assert.equal(dominantScript('床是指在上面睡觉的东西'), 'other');
});

test('an answer in the wrong script is rejected', () => {
  const result = validate({
    answer: 'これはベッドという意味です。寝るときに使うものです。',
    igbo_used: [],
    trust: 'unverified',
    follow_up_suggestion: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'wrong_script'));
});

test('a safe refusal is accepted as an answer', () => {
  const result = validate({
    answer: 'I can only help with learning Igbo. Ask me about a word or a sentence from your lesson.',
    igbo_used: [],
    trust: 'unverified',
    follow_up_suggestion: null,
  });
  assert.equal(result.ok, true);
});

test('the model claiming verified grounding with nothing retrieved is corrected, not discarded', () => {
  // §8.1: "Answers grounded in published content show Verified. Anything else shows AI-assisted."
  // The answer itself may be fine, so it is kept and the LABEL is fixed — throwing it away would
  // punish the learner for the model's bookkeeping.
  const result = validate(
    { answer: 'Here is an answer with no published source behind it.', igbo_used: [], trust: 'verified', follow_up_suggestion: null },
    { grounding: { items: [], empty: true, consideredCount: 0, truncated: false } }
  );
  assert.equal(result.ok, true);
  assert.equal(result.output?.trust, 'unverified', 'the claim was downgraded');
  assert.ok(result.issues.some((issue) => issue.code === 'ungrounded_verified_claim'));
});

test('cautious labelling is never overridden upward', () => {
  // A model that says "unverified" while grounding was available is being cautious. Promoting it
  // would be the platform claiming more than the model did.
  const result = validate({
    answer: 'Àkwà means bed, though I am not fully certain of the tone.',
    igbo_used: ['àkwà'],
    trust: 'unverified',
    follow_up_suggestion: null,
  });
  assert.equal(result.output?.trust, 'unverified');
});

test('a swap against the knowledge base is rejected', () => {
  // The failure that matters most: àkwà and ákwá differ only by tone, and a model that swaps them
  // produces a fluent, confident, wrong answer a learner cannot detect.
  const result = validate({
    answer: 'Àkwà means egg. You would use it when talking about food.',
    igbo_used: ['àkwà'],
    trust: 'verified',
    follow_up_suggestion: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'contradicts_knowledge'));
});

test('the contradiction check does not fire on the correct meaning', () => {
  const issues = checkContradictions('Àkwà means bed. Ákwá means egg.', [published, other]);
  assert.deepEqual(issues, []);
});

test('the contradiction check stays quiet when there is nothing to compare against', () => {
  assert.deepEqual(checkContradictions('anything at all', []), []);
});

test('unsafe content is rejected', () => {
  const issues = checkSafety('Here are instructions to build a bomb for you.');
  assert.ok(issues.some((issue) => issue.code === 'disallowed_content' && issue.fatal));
});

test('ordinary Igbo teaching is not flagged as unsafe', () => {
  const benign = [
    'Àkwà means bed. Nne is mother.',
    'In Igbo, verbs come after the subject.',
    'This proverb is about patience.',
  ];
  for (const text of benign) {
    assert.deepEqual(checkSafety(text), [], text);
  }
});

test('the learner-facing label always exists — §8.1 requires one on every response', () => {
  const verified = labelForLearner({ answer: 'x', igboUsed: [], trust: 'verified', followUpSuggestion: null });
  const ai = labelForLearner({ answer: 'x', igboUsed: [], trust: 'unverified', followUpSuggestion: null });

  assert.equal(verified.kind, 'verified');
  assert.equal(ai.kind, 'ai_assisted');
  assert.match(ai.text, /Report a mistake/);
});

test('parseTutorOutput tolerates camelCase keys from a provider', () => {
  const parsed = parseTutorOutput(JSON.stringify({ answer: 'ok, a real answer', igboUsed: ['x'], trust: 'unverified', followUpSuggestion: 'next' }));
  assert.deepEqual(parsed.igboUsed, ['x']);
  assert.equal(parsed.followUpSuggestion, 'next');
});

test('an unknown trust value degrades to unverified rather than being trusted', () => {
  const parsed = parseTutorOutput(JSON.stringify({ answer: 'ok, a real answer', trust: 'definitely' }));
  assert.equal(parsed.trust, 'unverified');
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

test('the default plan is the beta plan, which is the strictest — §18 #12', () => {
  assert.equal(DEFAULT_PLAN, 'beta');
  assert.ok(PLANS.beta!.tutorMessagesPerDay! < (PLANS.premium!.tutorMessagesPerDay ?? Infinity) || PLANS.premium!.tutorMessagesPerDay === null);
});

test('an unknown plan falls back to the default rather than failing open', () => {
  assert.equal(planFor('enterprise-unlimited').id, DEFAULT_PLAN);
  assert.equal(planFor(null).id, DEFAULT_PLAN);
});

test('the daily allowance counts down and then refuses with a human message', () => {
  const plan = PLANS.beta!;
  const limit = plan.tutorMessagesPerDay!;

  assert.equal(checkMessageAllowance(plan, 0).allowed, true);
  assert.equal(checkMessageAllowance(plan, limit - 1).remaining, 1);

  const exhausted = checkMessageAllowance(plan, limit);
  assert.equal(exhausted.allowed, false);
  assert.equal(exhausted.reason, 'daily_limit');
  assert.ok(exhausted.message && exhausted.message.length > 20);
});

test('an unlimited plan never refuses', () => {
  const unlimited = { ...PLANS.beta!, tutorMessagesPerDay: null };
  assert.equal(checkMessageAllowance(unlimited, 100_000).allowed, true);
  assert.equal(checkMessageAllowance(unlimited, 100_000).remaining, null);
});

test('over-long input is refused before it costs anything', () => {
  const plan = PLANS.beta!;
  const check = checkInputSize(plan, 'x'.repeat(plan.maxInputCharacters + 1));
  assert.equal(check.allowed, false);
  assert.equal(check.reason, 'input_too_long');
  assert.ok(checkInputSize(plan, 'short').allowed);
});

test('the output ceiling takes the smaller of the plan and the mode', () => {
  const plan = PLANS.premium!;
  assert.equal(outputCeiling(plan, 100), 100, 'a mode may lower it');
  assert.equal(outputCeiling(plan, 99_999), plan.maxOutputTokens, 'a mode may not raise it');
  assert.equal(outputCeiling(plan), plan.maxOutputTokens);
});

test('the spend ledger prices a call from the rates it was given', () => {
  const pricing: Record<string, ModelPricing> = {
    'model-a': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  };
  const ledger = new SpendLedger({ capUsd: 100, pricing });

  ledger.record({
    requestId: 'r1',
    providerId: 'p',
    model: 'model-a',
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    latencyMs: 1,
    ok: true,
  });

  assert.equal(ledger.status().spentUsd, 18);
});

test('the cap is breached at the cap, not somewhere near it', () => {
  const pricing: Record<string, ModelPricing> = { m: { inputUsdPerMillion: 1_000_000, outputUsdPerMillion: 0 } };
  const ledger = new SpendLedger({ capUsd: 2, pricing });

  const event = (id: string) => ({
    requestId: id, providerId: 'p', model: 'm',
    usage: { inputTokens: 1, outputTokens: 0 }, latencyMs: 1, ok: true,
  });

  ledger.record(event('1'));
  assert.equal(ledger.status().breached, false);
  assert.equal(ledger.shouldRefuse(), false);

  ledger.record(event('2'));
  assert.equal(ledger.status().breached, true);
  assert.equal(ledger.shouldRefuse(), true);
});

test('alerting fires before the cap, so there is time to react — §8.1', () => {
  const pricing: Record<string, ModelPricing> = { m: { inputUsdPerMillion: 1_000, outputUsdPerMillion: 0 } };
  const ledger = new SpendLedger({ capUsd: 10, pricing, alertAt: 0.5 });

  ledger.record({ requestId: 'r', providerId: 'p', model: 'm', usage: { inputTokens: 6_000, outputTokens: 0 }, latencyMs: 1, ok: true });
  const status = ledger.status();
  assert.equal(status.alerting, true);
  assert.equal(status.breached, false, 'alerting happens before the cap, not at it');
});

test('an unpriced model is reported rather than silently counted as free', () => {
  // Otherwise a missing price makes the cap under-report and the breach arrives as a surprise bill.
  const seen: string[] = [];
  const ledger = new SpendLedger({ capUsd: 10, pricing: {}, onUnpricedModel: (model) => seen.push(model) });

  ledger.record({ requestId: 'r', providerId: 'p', model: 'mystery-model', usage: { inputTokens: 100, outputTokens: 100 }, latencyMs: 1, ok: true });

  assert.deepEqual(ledger.unpricedModels(), ['mystery-model']);
  assert.deepEqual(seen, ['mystery-model']);
  assert.equal(ledger.status().spentUsd, 0);
});

test('a ledger refuses to exist without a cap', () => {
  assert.throws(() => new SpendLedger({ capUsd: 0, pricing: {} }), /positive cap/);
});

test('the rate limiter allows up to its limit then refuses with a retry window', () => {
  const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });

  assert.equal(limiter.check('learner', 0).allowed, true);
  assert.equal(limiter.check('learner', 1).allowed, true);
  assert.equal(limiter.check('learner', 2).allowed, true);

  const refused = limiter.check('learner', 3);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterMs, 60_000 - 3);
});

test('the rate limiter is per key', () => {
  const limiter = new RateLimiter({ limit: 1, windowMs: 1_000 });
  assert.equal(limiter.check('a', 0).allowed, true);
  assert.equal(limiter.check('b', 0).allowed, true, 'a different learner has their own window');
  assert.equal(limiter.check('a', 0).allowed, false);
});

test('the rate limiter window resets', () => {
  const limiter = new RateLimiter({ limit: 1, windowMs: 1_000 });
  assert.equal(limiter.check('a', 0).allowed, true);
  assert.equal(limiter.check('a', 500).allowed, false);
  assert.equal(limiter.check('a', 1_001).allowed, true);
});

test('pruning drops only expired windows', () => {
  const limiter = new RateLimiter({ limit: 5, windowMs: 1_000 });
  limiter.check('old', 0);
  limiter.check('new', 2_000);
  limiter.prune(1_500);
  assert.equal(limiter.size, 1);
});
