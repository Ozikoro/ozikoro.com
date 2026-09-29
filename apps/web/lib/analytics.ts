/**
 * PostHog capture — server-side, consent-gated, no client SDK.
 *
 * Spec §7 (PostHog for product analytics), §F12 (analytics and reporting), §10.1 (the event
 * taxonomy), §8.1 (AI call tracing), §13 (consent and lawful basis).
 *
 * WHY THERE IS NO `posthog-js` IN THE BROWSER BUNDLE
 *
 * The obvious implementation is the PostHog client SDK and autocapture. This deliberately is not
 * that, for four reasons that all point the same way:
 *
 * 1. EVERY EVENT THE SPEC ASKS FOR IS A SERVER-SIDE FACT. §F12 wants "signup, onboarding, first
 *    lesson, day-7 return, exercise accuracy per lexeme, hardest words, tutor usage and report
 *    rates". Each of those is known to the server and to nothing else. A client SDK would mean
 *    shipping the same facts from the browser, where they can be forged, and inferring the rest.
 *
 * 2. THE PRIVACY GUARD CANNOT BE BYPASSED. `packages/core/src/analytics.ts` refuses forbidden
 *    property names and anything long enough to be prose. With a client SDK the browser can send
 *    whatever it likes straight to PostHog, and the guard becomes a convention. Here, every event
 *    passes through `buildEvent` on the way out — there is no other route.
 *
 * 3. §13'S PERFORMANCE BUDGET. §13 requires LCP under 2.5 s on a mid-range Android phone over
 *    throttled 4G, and names a JavaScript budget. An analytics SDK plus autocapture is one of the
 *    largest things a site ships, and it is spent on a feature the specification never asks for.
 *
 * 4. §13'S PRIVACY STANCE. Autocapture records interactions that were never designed as
 *    measurements. "Lawful basis recorded for analytics" is much easier to answer honestly when
 *    the set of things measured is a list of twenty-two events rather than "whatever was clicked".
 *
 * If client-side analytics is wanted later, it is added as a deliberate second channel — and it
 * should be, for page views and funnel drop-off. Noted as a gap rather than left implied.
 *
 * THE TOKEN
 *
 * A PostHog project token (`phc_…`) is a PUBLISHABLE key: PostHog expects it in client-side code
 * and it grants only the ability to send events to one project. It is still read from the
 * environment rather than committed, per §2.1, and it is worth knowing the difference: a PostHog
 * PERSONAL API key (`phx_…`) is a real secret that can read and delete data, and must never appear
 * here.
 *
 * WHAT A 200 FROM POSTHOG DOES AND DOES NOT PROVE
 *
 * Verified against the live API: `/capture/`, `/batch/` and `/i/v0/e/` all return
 * `200 {"status":"Ok"}` **even for a completely invalid token**. Ingestion accepts first and
 * validates asynchronously, so a successful response means the request was well-formed, not that
 * the event reached a project.
 *
 * Two consequences worth knowing before debugging this:
 *
 *   - The once-per-process warning below catches network failures and malformed payloads (a
 *     missing `distinct_id` is a 400), but it will NOT catch a wrong or revoked token. Confirming
 *     delivery needs the PostHog UI, or a personal API key — which is a real secret and must not
 *     be handed to an agent.
 *   - `/decide/` is the endpoint that DOES validate a token: project config for a good key,
 *     `401 authentication_failed` for a bad one. That is how this integration's token was
 *     confirmed valid.
 */
import { buildEvent, type AnalyticsEvent } from '@ozituma/core';

export interface AnalyticsConfig {
  /** The project token. Absent means capture is a no-op, which is what local dev without analytics looks like. */
  key: string | undefined;
  host: string;
  /** §13 requires a lawful basis. Nothing is sent unless this is true. */
  consentGranted: boolean;
}

export function analyticsConfig(): AnalyticsConfig {
  return {
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    host: (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/+$/, ''),
    // Read at call time rather than module load, so a consent cookie set during a request applies
    // to that same request.
    consentGranted: process.env.OZITUMA_ANALYTICS_CONSENT === 'true',
  };
}

/** True when events will actually be sent. Useful for a health check and for tests. */
export function analyticsEnabled(): boolean {
  const config = analyticsConfig();
  return Boolean(config.key) && config.consentGranted;
}

export interface CaptureOptions {
  /**
   * Who the event is about.
   *
   * MUST be the account's UUID, never an email or a display name. §8.1 requires prompts logged
   * "with user identifiers separated": the UUID is pseudonymous and is the join key back to our
   * own database, where the real identity and the deletion path live.
   */
  distinctId: string;
  /** Overrides the environment consent flag, for a learner who has granted consent in-session. */
  consent?: boolean;
  /** ISO timestamp. Defaults to now. */
  at?: string;
  /** Extra properties, subject to the taxonomy's allowlist. */
  properties?: Record<string, unknown>;
}

interface QueuedEvent {
  event: AnalyticsEvent;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, string | number | boolean>;
}

/**
 * A small batching queue.
 *
 * Analytics must never delay a response or fail a request, so capture appends to a buffer and a
 * flush sends it. The buffer is bounded, and when it is full events are DROPPED rather than the
 * process being allowed to grow — an analytics backlog is not worth an outage.
 */
const MAX_QUEUE = 200;
let queue: QueuedEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;

/** Analytics failures are logged once per process, not once per event. */
let reportedFailure = false;

export function capture(event: AnalyticsEvent, options: CaptureOptions): void {
  const config = analyticsConfig();
  if (!config.key) return;
  if (!(options.consent ?? config.consentGranted)) return;

  // The guard. Anything the taxonomy does not allow — including a learner's own text under an
  // unexpected key — is dropped here and never queued.
  const built = buildEvent(event, options.properties);

  if (queue.length >= MAX_QUEUE) return;

  queue.push({
    event,
    distinct_id: options.distinctId,
    timestamp: options.at ?? new Date().toISOString(),
    properties: built.properties,
  });

  // A short delay lets a page render several events into one request. `unref` so a pending flush
  // never holds the process open — otherwise a CLI script would hang for a second after finishing.
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flush();
    }, 1_000);
    flushTimer.unref?.();
  }
}

/** Send everything queued. Safe to call directly, and called on a timer otherwise. */
export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;

  const config = analyticsConfig();
  if (!config.key) {
    queue = [];
    return;
  }

  const batch = queue;
  queue = [];

  try {
    const response = await fetch(`${config.host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: config.key, batch }),
      // Analytics must not hold a request open. If it does not land in three seconds it is lost,
      // which is the correct trade against a learner waiting.
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok && !reportedFailure) {
      reportedFailure = true;
      console.warn(`[analytics] PostHog returned ${response.status}; events are being dropped.`);
    }
  } catch (error) {
    // Never rethrow. An analytics outage must not become a product outage.
    if (!reportedFailure) {
      reportedFailure = true;
      console.warn('[analytics] capture failed; events are being dropped.', error);
    }
  }
}

/**
 * The distinct_id used for operational telemetry.
 *
 * PostHog rejects an event with no `distinct_id` — verified against the live API, which returns
 * 400 "event submitted without a distinct_id". So AI telemetry needs one, and the privacy
 * requirement is that it must not identify anybody.
 *
 * This constant is that compromise: a fixed string naming the PLATFORM, not a learner. Every AI
 * call trace lands under the same id, which is correct — the trace is about a request, not a
 * person, and `$ai_trace_id` is what correlates them. §8.1's "user identifiers separated" is
 * satisfied in the strongest available form: there is no user identifier at all.
 */
export const SYSTEM_DISTINCT_ID = 'ozituma-system';

/**
 * Send a single AI-call trace (§8.1).
 *
 * Separate from `capture` because AI telemetry is operational rather than a learner action: a
 * different audience, a much higher volume, and it must not be mixed into the funnel. It is sent
 * immediately rather than batched so a spend alert is not delayed by a second.
 */
export async function captureAiTelemetry(telemetry: {
  requestId: string;
  providerId: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  ok: boolean;
  failureKind?: string;
  fellBack: boolean;
  priced: boolean;
}): Promise<void> {
  const config = analyticsConfig();
  if (!config.key || !config.consentGranted) return;

  try {
    const response = await fetch(`${config.host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.key,
        event: '$ai_generation',
        distinct_id: SYSTEM_DISTINCT_ID,
        properties: {
          $ai_trace_id: telemetry.requestId,
          $ai_provider: telemetry.providerId,
          $ai_model: telemetry.model,
          $ai_prompt_version: telemetry.promptVersion,
          $ai_input_tokens: telemetry.inputTokens,
          $ai_output_tokens: telemetry.outputTokens,
          $ai_latency: telemetry.latencyMs / 1_000,
          $ai_is_error: !telemetry.ok,
          ...(telemetry.failureKind ? { $ai_error_kind: telemetry.failureKind } : {}),
          validation_fell_back: telemetry.fellBack,
          priced: telemetry.priced,
        },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3_000),
    });

    // Reported once per process, not once per call. Telemetry that fails silently is telemetry
    // nobody notices is missing — which is how the missing distinct_id above went unseen until the
    // endpoint was called directly.
    if (!response.ok && !reportedFailure) {
      reportedFailure = true;
      const detail = await response.text().catch(() => '');
      console.warn(`[analytics] AI telemetry rejected (${response.status}) ${detail.slice(0, 200)}`);
    }
  } catch (error) {
    // Same rule as above: telemetry never breaks the thing it observes.
    if (!reportedFailure) {
      reportedFailure = true;
      console.warn('[analytics] AI telemetry capture failed.', error);
    }
  }
}

/** Test seam: empties the queue without sending. */
export function resetForTests(): void {
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  reportedFailure = false;
}
