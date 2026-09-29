/**
 * Analytics tests.
 *
 * The tests that matter here are the privacy ones. Everything else is bookkeeping; the guards are
 * the reason a learner's own Igbo cannot reach a third-party analytics service, and a guard that
 * is not tested is a guard that stops working the first time somebody adds a property.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONSENT,
  EVENTS,
  EVENT_NAMES,
  FORBIDDEN_PROPERTY_KEYS,
  MAX_PROPERTY_STRING_LENGTH,
  METRICS,
  V1_EVENTS,
  buildAiTelemetry,
  buildEvent,
  mayCapture,
  metricById,
  sanitiseProperties,
  type AnalyticsEvent,
} from './analytics.ts';

// ---------------------------------------------------------------------------
// The taxonomy — §10.1
// ---------------------------------------------------------------------------

test('every event §10.1 names exists', () => {
  // Copied from §10.1's taxonomy list. If one of these disappears, a metric silently stops being
  // measurable, so the list is asserted rather than left to review.
  const required = [
    'account_created', 'onboarding_completed', 'placement_completed',
    'lesson_started', 'lesson_completed', 'activity_started', 'activity_completed',
    'answer_submitted', 'review_scheduled', 'review_completed',
    'game_started', 'game_completed', 'conversation_started', 'translation_requested',
    'dictionary_search', 'word_saved', 'content_reported', 'content_approved',
    'subscription_started', 'subscription_cancelled', 'notification_sent', 'notification_clicked',
  ] as const;

  for (const name of required) {
    assert.ok(EVENT_NAMES.includes(name), `${name} is missing from the taxonomy`);
  }
  assert.equal(required.length, 22, '§10.1 lists twenty-two events');
});

test('every v1.0 event is in the taxonomy', () => {
  for (const name of V1_EVENTS) {
    assert.ok(EVENT_NAMES.includes(name), name);
  }
});

test('every event declares its properties and what it feeds', () => {
  for (const name of EVENT_NAMES) {
    const definition = EVENTS[name];
    assert.ok(definition.description.length > 10, `${name} needs a real description`);
    assert.ok(Array.isArray(definition.feeds), `${name} must declare its metrics`);
  }
});

test('no event declares a forbidden property', () => {
  // A declared property that is also on the denylist is a contradiction, and it would be resolved
  // silently at runtime in favour of the denylist.
  for (const name of EVENT_NAMES) {
    for (const key of Object.keys(EVENTS[name].properties)) {
      assert.ok(
        !FORBIDDEN_PROPERTY_KEYS.includes(key),
        `${name} declares "${key}", which is on the forbidden list`
      );
    }
  }
});

test('every metric named in §10.1 has a definition', () => {
  const ids = METRICS.map((metric) => metric.id);
  for (const required of [
    'weekly_active_learners', 'three_sessions_a_week', 'lesson_completion_rate',
    'retention_7d', 'retention_30d', 'vocabulary_mastery', 'content_issue_rate',
    'item_mastery', 'error_recurrence', 'session_completion', 'content_correction_rate',
  ] as const) {
    assert.ok(ids.includes(required), `${required} has no definition`);
  }
});

test('every metric definition names the events it is computed from', () => {
  for (const metric of METRICS) {
    assert.ok(metric.definition.length > 30, `${metric.id} needs a usable definition`);
    assert.ok(metric.events.length > 0, `${metric.id} names no events`);
    for (const event of metric.events) {
      assert.ok(EVENT_NAMES.includes(event), `${metric.id} references unknown event ${event}`);
    }
  }
});

test('metricById finds a metric and returns undefined for an unknown one', () => {
  assert.equal(metricById('content_issue_rate')?.release, 'v1.0');
  assert.equal(metricById('nope' as never), undefined);
});

test('the tutor metric is the only v1.1 metric, matching §4', () => {
  const late = METRICS.filter((metric) => metric.release !== 'v1.0').map((metric) => metric.id);
  assert.deepEqual(late, ['tutor_sessions_per_learner']);
});

// ---------------------------------------------------------------------------
// The privacy guards — the reason this module exists
// ---------------------------------------------------------------------------

test('a learner’s own Igbo cannot be sent, whatever key it arrives under', () => {
  const learnerSentence = 'Aha m bụ Chidi, esi m na Enugu.';

  for (const key of ['igbo', 'learner_text', 'utterance', 'message', 'answer', 'response', 'text']) {
    const { dropped } = sanitiseProperties('answer_submitted', { [key]: learnerSentence });
    assert.ok(
      dropped.some((d) => d.key === key),
      `"${key}" carrying learner text must be dropped`
    );
  }
});

test('forbidden keys are refused even when an event declares them', () => {
  for (const key of FORBIDDEN_PROPERTY_KEYS) {
    const { properties, dropped } = sanitiseProperties('answer_submitted', { [key]: 'x' });
    assert.equal(properties[key], undefined, key);
    assert.ok(dropped.some((d) => d.key === key), key);
  }
});

test('prose is refused by length even under a declared key', () => {
  // The guard that catches a field nobody thought about. A declared string property is still
  // refused when its value is long enough to be a sentence.
  const prose = 'x'.repeat(MAX_PROPERTY_STRING_LENGTH + 1);
  const { properties, dropped } = sanitiseProperties('answer_submitted', { verdict: prose });

  assert.equal(properties.verdict, undefined);
  assert.equal(dropped[0]!.reason, 'too_long');
});

test('legitimate values pass comfortably under the length guard', () => {
  // A UUID is 36 characters, a mode name under 20, an exercise type under 20. The ceiling must not
  // clip anything real.
  const { properties, dropped } = sanitiseProperties('answer_submitted', {
    verdict: 'almost',
    exercise_type: 'sentence_build',
    exercise_id: 12345,
    score: 0.5,
    elapsed_ms: 4210,
  });

  assert.deepEqual(dropped, []);
  assert.equal(properties.verdict, 'almost');
  assert.equal(properties.score, 0.5);
});

test('an undeclared property is dropped rather than forwarded', () => {
  // An allowlist, not a denylist: adding a field at a call site cannot widen what leaves the
  // platform.
  const { properties, dropped } = sanitiseProperties('lesson_started', {
    lesson_id: 1,
    somethingNobodyDeclared: 'value',
  });

  assert.deepEqual(properties, { lesson_id: 1 });
  assert.deepEqual(dropped, [{ key: 'somethingNobodyDeclared', reason: 'not_declared' }]);
});

test('a property of the wrong type is dropped', () => {
  const { properties, dropped } = sanitiseProperties('lesson_started', { lesson_id: 'not a number' });
  assert.deepEqual(properties, {});
  assert.equal(dropped[0]!.reason, 'wrong_type');
});

test('buildEvent reports whether anything was dropped', () => {
  const clean = buildEvent('lesson_started', { lesson_id: 7, level: 1 });
  assert.equal(clean.clean, true);
  assert.deepEqual(clean.dropped, []);

  const dirty = buildEvent('lesson_started', { lesson_id: 7, email: 'someone@example.com' });
  assert.equal(dirty.clean, false);
  assert.equal(dirty.dropped[0]!.reason, 'forbidden_key');
  assert.equal(dirty.properties.email, undefined);
});

test('an event with no properties is valid', () => {
  const built = buildEvent('dictionary_search');
  assert.equal(built.clean, true);
  assert.deepEqual(built.properties, {});
});

test('the answer event carries the verdict, never the answer', () => {
  // §F5 requires the exact response to be logged — in our database, in learn_review_log, where it
  // can be deleted with the account. This is the assertion that it does not also go to PostHog.
  const built = buildEvent('answer_submitted', {
    exercise_id: 42,
    exercise_type: 'recall',
    verdict: 'almost',
    score: 0.5,
    elapsed_ms: 3100,
    // What a careless call site might add:
    answer: 'àkwà',
    expected: 'ákwá',
  });

  assert.equal(built.clean, false, 'the extra fields are refused');
  assert.equal(built.properties.answer, undefined);
  assert.equal(built.properties.expected, undefined);
  assert.equal(built.properties.verdict, 'almost');
});

// ---------------------------------------------------------------------------
// Consent — §13, §F12, §F14
// ---------------------------------------------------------------------------

test('consent defaults to false everywhere', () => {
  // A missing consent record must read as "no". An opt-out default cannot give that.
  assert.equal(DEFAULT_CONSENT.analytics, false);
  assert.equal(DEFAULT_CONSENT.ai_training, false);
  assert.deepEqual(DEFAULT_CONSENT.notifications, { email: false, web_push: false, whatsapp: false });
});

test('capture is refused without consent, and without a record at all', () => {
  assert.equal(mayCapture(null, 'analytics'), false);
  assert.equal(mayCapture(undefined, 'analytics'), false);
  assert.equal(mayCapture(DEFAULT_CONSENT, 'analytics'), false);
});

test('capture is allowed once consented, per category', () => {
  const consent = { ...DEFAULT_CONSENT, analytics: true };
  assert.equal(mayCapture(consent, 'analytics'), true);
  // §13: "never used to train models without separate, explicit opt-in consent" — so granting
  // analytics must not grant training.
  assert.equal(mayCapture(consent, 'ai_training'), false);
});

// ---------------------------------------------------------------------------
// AI observability — §8.1
// ---------------------------------------------------------------------------

test('AI telemetry carries the fields §8.1 asks to trace', () => {
  const telemetry = buildAiTelemetry({
    request_id: 'req-1',
    provider_id: 'anthropic',
    model: 'a-model',
    prompt_version: 'tutor.explain@1',
    input_tokens: 1200,
    output_tokens: 240,
    latency_ms: 830,
    ok: true,
    fell_back: false,
    priced: true,
  });

  assert.equal(telemetry.input_tokens, 1200);
  assert.equal(telemetry.output_tokens, 240);
  assert.equal(telemetry.latency_ms, 830);
  assert.equal(telemetry.prompt_version, 'tutor.explain@1');
  assert.equal(telemetry.ok, true);
});

test('AI telemetry records whether a price was known, so the spend cap cannot under-report', () => {
  const unpriced = buildAiTelemetry({
    request_id: 'r', provider_id: 'p', model: 'unknown', prompt_version: 'v@1',
    input_tokens: 1, output_tokens: 1, latency_ms: 1, ok: true, fell_back: false, priced: false,
  });
  assert.equal(unpriced.priced, false);
});

test('AI telemetry clips a field long enough to carry content', () => {
  const telemetry = buildAiTelemetry({
    request_id: 'r'.repeat(500),
    provider_id: 'p', model: 'm', prompt_version: 'v@1',
    input_tokens: 1, output_tokens: 1, latency_ms: 1, ok: true, fell_back: false, priced: true,
  });
  assert.equal(String(telemetry.request_id).length, MAX_PROPERTY_STRING_LENGTH);
});

test('AI telemetry carries a failure kind when the call failed', () => {
  const failed = buildAiTelemetry({
    request_id: 'r', provider_id: 'p', model: 'm', prompt_version: 'v@1',
    input_tokens: 0, output_tokens: 0, latency_ms: 30_000, ok: false,
    failure_kind: 'timeout', fell_back: true, priced: true,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.failure_kind, 'timeout');
  assert.equal(failed.fell_back, true);
});

test('an event name is only accepted if it is in the taxonomy', () => {
  // Type-level, asserted for completeness: the union is the allowlist.
  const names = EVENT_NAMES as readonly AnalyticsEvent[];
  assert.ok(names.includes('lesson_completed'));
  assert.ok(!(names as readonly string[]).includes('lessonComplete'), 'camelCase is not in the taxonomy');
});
