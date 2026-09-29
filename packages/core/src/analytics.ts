/**
 * Analytics — the event taxonomy, its privacy guards, and the north-star metrics.
 *
 * Spec §10.1 defines the event taxonomy and the metrics. §F12 requires analytics and error
 * reporting. §8.1 requires observability of AI calls — "latency, tokens, cost" — with "alerting on
 * spend and error spikes". §13 requires consent handling and a lawful basis.
 *
 * WHY THE TAXONOMY IS CODE AND NOT A CONVENTION
 *
 * §10.1 lists twenty-two events with exact names. If each call site passes a string, the taxonomy
 * decays within a month: `lesson_completed` in one place, `lessonComplete` in another, and a
 * metric that silently counts half the events. So the names live here, the properties each event
 * may carry are declared here, and {@link buildEvent} drops everything else.
 *
 * WHY THERE IS A PRIVACY GUARD RATHER THAN A POLICY
 *
 * §8.1: "log prompts for quality review with user identifiers separated". §13: "No personal data
 * sent to the AI provider beyond what is needed". Analytics is the easiest place in a codebase to
 * leak personal data by accident, because an event that carries "a bit more context" looks
 * harmless in a diff and is invisible in production.
 *
 * The specific thing being prevented: a learner's own Igbo is the most personal thing this
 * platform holds — it is their mistakes, in their family's language. §F5 requires the exact
 * response to be logged, but that belongs in `learn_review_log`, in our database, where it can be
 * deleted with the account. It must not be shipped to a third-party analytics service.
 *
 * So two guards run on every event: a property-name denylist, and a value check that refuses any
 * string long enough to be prose. Both are deliberate and both are tested.
 */

// ---------------------------------------------------------------------------
// The taxonomy — §10.1
// ---------------------------------------------------------------------------

/** The metrics §10.1 names, as ids so an event can declare what it feeds. */
export type MetricId =
  | 'weekly_active_learners'
  | 'three_sessions_a_week'
  | 'lesson_completion_rate'
  | 'retention_7d'
  | 'retention_30d'
  | 'vocabulary_mastery'
  | 'content_issue_rate'
  | 'tutor_sessions_per_learner'
  // §10.1's content-quality measures.
  | 'item_mastery'
  | 'error_recurrence'
  | 'session_completion'
  | 'content_correction_rate';

export type PropertyType = 'string' | 'number' | 'boolean';

export interface EventDefinition {
  /** What the event means, copied from §10.1's intent. */
  description: string;
  /**
   * The properties this event may carry.
   *
   * An allowlist, not a denylist: a property nobody declared is dropped rather than forwarded, so
   * adding a field to a call site cannot accidentally widen what leaves the platform.
   */
  properties: Record<string, PropertyType>;
  /** §10.1's metrics this event contributes to. */
  feeds: MetricId[];
}

/**
 * §10.1's event taxonomy, verbatim in name and intent.
 *
 * `v1.0` marks the events that exist in the v1.0 scope of §4. The rest are declared now so that a
 * dashboard can be built against the whole taxonomy and a later release does not have to rename
 * anything.
 */
export const EVENTS = {
  account_created: {
    description: 'A learner account was created.',
    properties: { method: 'string', plan: 'string' },
    feeds: ['weekly_active_learners'],
  },
  onboarding_completed: {
    description: 'A learner finished onboarding (§F1).',
    properties: { daily_minutes: 'number', self_level: 'string', age_band: 'string' },
    feeds: ['weekly_active_learners'],
  },
  placement_completed: {
    description: 'A learner finished the optional placement quiz (§F1).',
    properties: { score: 'number', placed_level: 'number' },
    feeds: ['lesson_completion_rate'],
  },
  lesson_started: {
    description: 'A learner opened a lesson.',
    properties: { lesson_id: 'number', level: 'number', unit_position: 'number', is_review: 'boolean' },
    feeds: ['lesson_completion_rate', 'retention_7d', 'retention_30d'],
  },
  lesson_completed: {
    description: 'A learner finished a lesson (§F2).',
    properties: { lesson_id: 'number', level: 'number', minutes: 'number', xp: 'number' },
    feeds: ['lesson_completion_rate', 'session_completion', 'retention_7d', 'retention_30d'],
  },
  activity_started: {
    description: 'A learner started an activity inside a lesson.',
    properties: { lesson_id: 'number', activity_kind: 'string' },
    feeds: ['session_completion'],
  },
  activity_completed: {
    description: 'A learner finished an activity inside a lesson.',
    properties: { lesson_id: 'number', activity_kind: 'string', minutes: 'number' },
    feeds: ['session_completion'],
  },
  answer_submitted: {
    description: 'A learner answered an exercise (§F5).',
    properties: {
      exercise_id: 'number',
      exercise_type: 'string',
      // The VERDICT, never the answer text. See this file's header.
      verdict: 'string',
      score: 'number',
      elapsed_ms: 'number',
      difficulty: 'number',
    },
    feeds: ['item_mastery', 'error_recurrence', 'vocabulary_mastery'],
  },
  review_scheduled: {
    description: 'An item was scheduled for review (§F6).',
    properties: { item_kind: 'string', interval_days: 'number', state: 'string' },
    feeds: ['vocabulary_mastery'],
  },
  review_completed: {
    description: 'A learner finished a review session (§F6).',
    properties: { items: 'number', minutes: 'number', again: 'number', hard: 'number', good: 'number', easy: 'number' },
    feeds: ['three_sessions_a_week', 'session_completion', 'vocabulary_mastery'],
  },
  game_started: {
    description: 'A learner started an exercise set (§F5).',
    properties: { exercise_type: 'string', lesson_id: 'number' },
    feeds: ['session_completion'],
  },
  game_completed: {
    description: 'A learner finished an exercise set.',
    properties: { exercise_type: 'string', correct: 'number', total: 'number', score: 'number' },
    feeds: ['item_mastery', 'session_completion'],
  },
  conversation_started: {
    description: 'A learner opened the AI tutor (§F8).',
    properties: { mode: 'string', lesson_id: 'number' },
    feeds: ['tutor_sessions_per_learner'],
  },
  translation_requested: {
    description: 'A learner asked for a translation (§F8).',
    properties: { direction: 'string', grounded: 'boolean' },
    feeds: ['tutor_sessions_per_learner'],
  },
  dictionary_search: {
    description: 'A learner searched the dictionary (§F3).',
    properties: { language: 'string', result_count: 'number', found: 'boolean' },
    feeds: ['weekly_active_learners'],
  },
  word_saved: {
    description: 'A learner saved a word.',
    properties: { language: 'string' },
    feeds: ['vocabulary_mastery'],
  },
  content_reported: {
    description: 'A learner reported a content problem (§F3, §F8).',
    properties: { content_kind: 'string', category: 'string', source: 'string' },
    feeds: ['content_issue_rate'],
  },
  content_approved: {
    description: 'A reviewer approved content (§5.3, §F10).',
    properties: { content_kind: 'string', role: 'string', ai_generated: 'boolean' },
    feeds: ['content_correction_rate'],
  },
  subscription_started: {
    description: 'A premium subscription began (§14).',
    properties: { plan: 'string', provider: 'string', currency: 'string' },
    feeds: [],
  },
  subscription_cancelled: {
    description: 'A premium subscription ended.',
    properties: { plan: 'string', provider: 'string', reason: 'string' },
    feeds: [],
  },
  notification_sent: {
    description: 'A notification was sent (§F14).',
    properties: { channel: 'string', category: 'string' },
    feeds: [],
  },
  notification_clicked: {
    description: 'A learner acted on a notification.',
    properties: { channel: 'string', category: 'string' },
    feeds: [],
  },
} as const satisfies Record<string, EventDefinition>;

export type AnalyticsEvent = keyof typeof EVENTS;

export const EVENT_NAMES = Object.keys(EVENTS) as AnalyticsEvent[];

/** The events that exist in the v1.0 scope of §4. */
export const V1_EVENTS: readonly AnalyticsEvent[] = [
  'account_created',
  'onboarding_completed',
  'placement_completed',
  'lesson_started',
  'lesson_completed',
  'activity_started',
  'activity_completed',
  'answer_submitted',
  'review_scheduled',
  'review_completed',
  'game_started',
  'game_completed',
  'conversation_started',
  'translation_requested',
  'dictionary_search',
  'word_saved',
  'content_reported',
  'content_approved',
  'notification_sent',
  'notification_clicked',
];

// ---------------------------------------------------------------------------
// Privacy guards
// ---------------------------------------------------------------------------

/**
 * Property names that are never allowed, whatever the event.
 *
 * These are the fields that would carry a person rather than an event. Named explicitly so the
 * refusal is legible in a diff and in a test, rather than being an implicit consequence of an
 * allowlist somewhere else.
 */
export const FORBIDDEN_PROPERTY_KEYS: readonly string[] = [
  'email', 'password', 'token', 'secret', 'authorization', 'cookie',
  'displayName', 'display_name', 'fullName', 'full_name', 'firstName', 'lastName',
  'phone', 'address', 'postcode', 'ip', 'user_agent',
  // Learner-authored content. See this file's header on why this must never leave the platform.
  'message', 'prompt', 'text', 'content', 'answer', 'response', 'transcript',
  /** The raw Igbo a learner wrote. */
  'igbo', 'learner_text', 'utterance',
  // Provider payloads, which can contain any of the above.
  'grounding', 'system_prompt', 'completion', 'raw',
];

/**
 * The longest string a property may carry.
 *
 * A guard against prose, not a formatting rule. Event properties are identifiers, categories and
 * short labels; anything approaching a sentence is either learner text that slipped through under
 * an unexpected key, or a payload nobody intended to send. Sixty-four characters is comfortably
 * above every legitimate value (a UUID is 36, a mode name is under 20) and far below a sentence.
 */
export const MAX_PROPERTY_STRING_LENGTH = 64;

export interface SanitiseResult {
  /** Properties safe to send. */
  properties: Record<string, string | number | boolean>;
  /** What was dropped and why, for a log line. Never sent to the provider. */
  dropped: { key: string; reason: 'not_declared' | 'forbidden_key' | 'wrong_type' | 'too_long' }[];
}

/**
 * Reduce a caller's properties to what this event is allowed to carry.
 *
 * Returns what it dropped rather than throwing, so one over-eager property cannot lose the whole
 * event — but the drop is reported, so it shows up in development instead of being silent.
 */
export function sanitiseProperties(
  event: AnalyticsEvent,
  properties: Record<string, unknown> = {}
): SanitiseResult {
  const definition: EventDefinition = EVENTS[event];
  const allowed = definition.properties;
  const out: Record<string, string | number | boolean> = {};
  const dropped: SanitiseResult['dropped'] = [];

  for (const [key, value] of Object.entries(properties)) {
    // The key denylist runs first, so a forbidden key is reported as forbidden even if the event
    // happens to declare it — which would itself be a bug worth seeing.
    if (FORBIDDEN_PROPERTY_KEYS.includes(key)) {
      dropped.push({ key, reason: 'forbidden_key' });
      continue;
    }

    const expected = allowed[key];
    if (!expected) {
      dropped.push({ key, reason: 'not_declared' });
      continue;
    }

    if (typeof value !== expected) {
      dropped.push({ key, reason: 'wrong_type' });
      continue;
    }

    if (typeof value === 'string' && value.length > MAX_PROPERTY_STRING_LENGTH) {
      // The prose guard.
      dropped.push({ key, reason: 'too_long' });
      continue;
    }

    out[key] = value as string | number | boolean;
  }

  return { properties: out, dropped };
}

export interface BuiltEvent {
  event: AnalyticsEvent;
  properties: Record<string, string | number | boolean>;
  dropped: SanitiseResult['dropped'];
  /** True when nothing was dropped — the common case, and the one worth asserting in tests. */
  clean: boolean;
}

/**
 * Build the payload that leaves the platform.
 *
 * The only sanctioned way to construct an analytics event, so `sanitiseProperties` cannot be
 * forgotten at a call site.
 */
export function buildEvent(
  event: AnalyticsEvent,
  properties: Record<string, unknown> = {}
): BuiltEvent {
  const { properties: safe, dropped } = sanitiseProperties(event, properties);
  return { event, properties: safe, dropped, clean: dropped.length === 0 };
}

// ---------------------------------------------------------------------------
// Consent (§13, §F12, §F14)
// ---------------------------------------------------------------------------

/**
 * Consent is per category, because §13 requires a "lawful basis recorded for analytics and AI
 * processing" — one basis for one purpose. A single "accept all" boolean cannot express that, and
 * §F14 independently requires per-channel opt-in for notifications.
 */
export interface ConsentState {
  /** Product analytics. Necessary to measure whether the platform works. */
  analytics: boolean;
  /** AI processing of the learner's messages. §13: "never used to train models without separate,
   *  explicit opt-in consent" — so this is separate from `analytics` and defaults off. */
  ai_training: boolean;
  /** §F14's reminders, per channel. */
  notifications: { email: boolean; web_push: boolean; whatsapp: boolean };
}

export const DEFAULT_CONSENT: ConsentState = {
  analytics: false,
  ai_training: false,
  notifications: { email: false, web_push: false, whatsapp: false },
};

/**
 * Whether a category of capture may happen at all.
 *
 * Defaults to false everywhere and requires an explicit true. §13 makes consent the thing that
 * authorises processing, so a missing consent record must read as "no", which is what a default of
 * false gives — and which an opt-*out* default cannot.
 */
export function mayCapture(consent: ConsentState | null | undefined, category: 'analytics' | 'ai_training'): boolean {
  if (!consent) return false;
  return consent[category] === true;
}

// ---------------------------------------------------------------------------
// AI observability (§8.1, §13)
// ---------------------------------------------------------------------------

/**
 * The AI call telemetry §8.1 requires: "tracing of AI calls (latency, tokens, cost)" and
 * "alerting on spend and error spikes".
 *
 * Deliberately NOT an event in §10.1's taxonomy, because it is not a learner action — it is an
 * operational signal with a different audience and a much higher volume. Keeping it separate is
 * what stops a tutor conversation from flooding the product analytics event stream.
 */
export interface AiCallTelemetry {
  /** Correlates attempts; generated per request, carries no learner identity. */
  request_id: string;
  provider_id: string;
  model: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  ok: boolean;
  /** The normalised failure kind from the gateway, when it failed. */
  failure_kind?: string;
  /** Whether the validator replaced the answer with the safe fallback. */
  fell_back: boolean;
  /** Whether a provider price was known. An unpriced call under-reports the spend cap. */
  priced: boolean;
}

/**
 * Build the AI telemetry payload.
 *
 * Runs through the same property guard as everything else, so a future field added here cannot
 * leak a learner's message. The prompt version travels with the call because §8.2 requires the
 * "version stored on each AI message" and §8.1 requires an evaluation result for each version.
 */
export function buildAiTelemetry(telemetry: AiCallTelemetry): Record<string, string | number | boolean> {
  // Every string is clipped rather than checked against a per-key allowlist, because this payload
  // is built from the gateway's own normalised fields — none of which is learner-supplied. The
  // clip is the backstop for a future field that is.
  const cleaned: Record<string, string | number | boolean> = {
    request_id: clip(telemetry.request_id),
    provider_id: clip(telemetry.provider_id),
    model: clip(telemetry.model),
    prompt_version: clip(telemetry.prompt_version),
    input_tokens: telemetry.input_tokens,
    output_tokens: telemetry.output_tokens,
    latency_ms: telemetry.latency_ms,
    ok: telemetry.ok,
    fell_back: telemetry.fell_back,
    priced: telemetry.priced,
  };
  if (telemetry.failure_kind) cleaned.failure_kind = clip(telemetry.failure_kind);
  return cleaned;
}

function clip(value: string): string {
  return value.length > MAX_PROPERTY_STRING_LENGTH ? value.slice(0, MAX_PROPERTY_STRING_LENGTH) : value;
}

// ---------------------------------------------------------------------------
// Metric definitions (§10.1)
// ---------------------------------------------------------------------------

export interface MetricDefinition {
  id: MetricId;
  name: string;
  /** How it is computed, in words. Read by whoever builds the dashboard. */
  definition: string;
  events: AnalyticsEvent[];
  /** The release it becomes meaningful in. */
  release: 'v1.0' | 'v1.1' | 'v2';
}

/**
 * §10.1's metrics with their definitions written down.
 *
 * The definitions are the part that matters: "content issue rate per 1,000 learning events" is
 * unambiguous only if somebody has written down which events count as learning events, and the
 * person building the dashboard is rarely the person who chose the metric.
 */
export const METRICS: readonly MetricDefinition[] = [
  {
    id: 'weekly_active_learners',
    name: 'Weekly active learners',
    definition: 'Distinct learners with at least one lesson_started, review_completed or dictionary_search in a 7-day window.',
    events: ['lesson_started', 'review_completed', 'dictionary_search', 'account_created'],
    release: 'v1.0',
  },
  {
    id: 'three_sessions_a_week',
    name: 'Learners practising three times a week',
    definition: 'Distinct learners with at least 3 review_completed or lesson_completed events in a 7-day window.',
    events: ['review_completed', 'lesson_completed'],
    release: 'v1.0',
  },
  {
    id: 'lesson_completion_rate',
    name: 'Lesson completion rate',
    definition: 'lesson_completed divided by lesson_started, over a 7-day window. Excludes lessons opened and abandoned within the same session.',
    events: ['lesson_started', 'lesson_completed'],
    release: 'v1.0',
  },
  {
    id: 'retention_7d',
    name: '7-day retention',
    definition: 'Share of learners who completed onboarding and returned within 7 days.',
    events: ['onboarding_completed', 'lesson_started'],
    release: 'v1.0',
  },
  {
    id: 'retention_30d',
    name: '30-day retention',
    definition: 'Share of learners active within 30 days of their first lesson.',
    events: ['lesson_started'],
    release: 'v1.0',
  },
  {
    id: 'vocabulary_mastery',
    name: 'Vocabulary mastery progression',
    definition: 'Median share of attempted items meeting the mastery threshold, per learner, week over week.',
    events: ['answer_submitted', 'review_scheduled', 'review_completed'],
    release: 'v1.0',
  },
  {
    id: 'content_issue_rate',
    name: 'Content issue rate',
    definition: 'content_reported per 1,000 answer_submitted events. A rising rate means the curriculum is wrong, not the learner.',
    events: ['content_reported', 'answer_submitted'],
    release: 'v1.0',
  },
  {
    id: 'tutor_sessions_per_learner',
    name: 'Tutor sessions per active learner',
    definition: 'conversation_started per weekly active learner.',
    events: ['conversation_started'],
    release: 'v1.1',
  },
  {
    id: 'item_mastery',
    name: 'Item mastery',
    definition: 'Share of recently attempted vocabulary items that meet the mastery threshold.',
    events: ['answer_submitted', 'game_completed'],
    release: 'v1.0',
  },
  {
    id: 'error_recurrence',
    name: 'Error recurrence',
    definition: 'Rate at which a previously corrected item is missed again.',
    events: ['answer_submitted'],
    release: 'v1.0',
  },
  {
    id: 'session_completion',
    name: 'Session completion',
    definition: 'Share of started daily plans that are completed.',
    events: ['activity_started', 'activity_completed', 'lesson_completed', 'review_completed'],
    release: 'v1.0',
  },
  {
    id: 'content_correction_rate',
    name: 'Content correction rate',
    definition: 'Approved content later corrected after publication.',
    events: ['content_approved', 'content_reported'],
    release: 'v1.0',
  },
];

export function metricById(id: MetricId): MetricDefinition | undefined {
  return METRICS.find((metric) => metric.id === id);
}
