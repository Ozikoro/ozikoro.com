/**
 * A provider adapter for any OpenAI-compatible chat completions API.
 *
 * WHY THIS SHAPE
 *
 * §7 says providers must be swappable and the gateway is built for that. In practice almost every
 * hosted model now speaks the same `/chat/completions` shape — OpenAI, Groq, Together, Fireworks,
 * OpenRouter, DeepSeek, and most self-hosted servers — so one adapter pointed at a configurable base
 * URL covers the realistic choices, and the owner picks by setting three environment variables
 * rather than by waiting for code.
 *
 * WHAT IT REFUSES TO DO
 *
 * `AiProvider.complete` requires that `usage` come from the provider's OWN accounting and that a
 * missing count be an error rather than an estimate. §8.1 requires a spend cap, and a cap computed
 * from estimated tokens is not a cap — it is a guess that reads like a limit. So a response without
 * a usage block throws, and the tutor falls back to its safe reply. That is the correct outcome: an
 * unattributable request is a request the platform cannot account for.
 *
 * UNTESTED AGAINST A LIVE PROVIDER, AND THAT IS STATED RATHER THAN IMPLIED
 *
 * There is no AI credential in this deployment (§18 #10 leaves the account and the cap with the
 * owner), so this file has never completed a real request. It is written to the documented shape and
 * it typechecks, but it should be treated as unverified until a key exists and one call is made
 * through it. The failure mode if the shape is wrong is a thrown AiError and a safe fallback, not a
 * wrong answer — which is the reason the fallback path was built first.
 */

import { AiError, type AiProvider, type AiRequest, type AiResponse } from '@ozituma/core';

/** How long to wait before giving up. The gateway also enforces a shorter deadline of its own. */
const DEFAULT_TIMEOUT_MS = 30_000;

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

/** Provider `finish_reason` values mapped onto the gateway's vocabulary. */
function finishReason(raw: string | undefined): AiResponse['finishReason'] {
  switch (raw) {
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'stop':
      return 'stop';
    default:
      return 'stop';
  }
}

export function openAiCompatibleProvider(options: {
  id: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}): AiProvider {
  // A base URL with a trailing slash would produce a double slash in the path, which some gateways
  // 404 on and others silently redirect. Normalised once here rather than at every call.
  const base = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

  return {
    id: options.id,
    supportedModels: [options.model],

    async complete(request: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
      const started = Date.now();

      // Two deadlines: the caller's, and this adapter's. `AbortSignal.any` would be tidier but is
      // newer than the runtimes this has to work in.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const onOuterAbort = () => controller.abort();
      signal?.addEventListener('abort', onOuterAbort);

      // An already-aborted signal never fires its event, so it is checked directly rather than
      // trusted to notify. This is the same trap the gateway's own tests document.
      if (signal?.aborted) controller.abort();

      try {
        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: request.model,
            // The system prompt is passed as a message rather than a top-level `system` field,
            // because that is the shape every OpenAI-compatible server accepts.
            messages: [
              { role: 'system', content: request.system },
              ...request.messages.map((message) => ({ role: message.role, content: message.content })),
            ],
            max_tokens: request.maxOutputTokens,
            temperature: request.temperature ?? 0.2,
            ...(request.expectJson ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          // Mapped to the gateway's failure kinds so the caller can decide between "try again" and
          // "stop" without parsing provider-specific bodies.
          const kind =
            response.status === 429
              ? 'rate_limited'
              : response.status === 408 || response.status === 504
                ? 'timeout'
                : response.status === 402 || response.status === 403
                  ? 'over_budget'
                  : 'unavailable';
          throw new AiError(
            kind,
            options.id,
            `The provider refused the request (${response.status}). ${detail.slice(0, 300)}`,
            // The status is carried in the message rather than as a field: AiError's options are
            // `retryable` and `cause`, and `retryable` is already derived from the kind. A caller
            // that needs the number can read it off the message, and one that needs the DECISION
            // reads `retryable`, which is the thing that should drive a retry.
            { retryable: kind === 'rate_limited' || kind === 'timeout' || kind === 'unavailable' }
          );
        }

        const body = (await response.json()) as ChatCompletion;

        if (body.error) {
          throw new AiError('unavailable', options.id, body.error.message ?? 'Provider error.');
        }

        const choice = body.choices?.[0];
        const text = choice?.message?.content;
        if (typeof text !== 'string') {
          // A 200 with no content is a malformed response, not an empty answer. Treated as malformed
          // so the validator never sees it and the learner gets the safe fallback.
          throw new AiError('malformed', options.id, 'The provider returned no message content.');
        }

        const inputTokens = body.usage?.prompt_tokens;
        const outputTokens = body.usage?.completion_tokens;
        if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
          // See the note at the top: an uncountable request cannot be charged against the cap.
          throw new AiError(
            'malformed',
            options.id,
            'The provider returned no token usage, so this request cannot be accounted for.'
          );
        }

        return {
          text,
          model: body.model ?? request.model,
          usage: { inputTokens, outputTokens },
          finishReason: finishReason(choice?.finish_reason),
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        if (error instanceof AiError) throw error;
        // A network failure or an abort. `normalise` in the gateway would also catch these, but
        // throwing the right kind here keeps the reason attached to the provider that produced it.
        if (controller.signal.aborted) {
          throw new AiError('timeout', options.id, 'The model did not answer in time.');
        }
        throw new AiError(
          'unavailable',
          options.id,
          error instanceof Error ? error.message : 'Unknown provider failure.'
        );
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onOuterAbort);
      }
    },
  };
}

/**
 * Whether a tutor provider is configured.
 *
 * Exported so the page and the API route answer the question the same way. Two copies of "is there
 * a key" would eventually disagree — one checking a variable the other had renamed — and the
 * symptom would be a page that offers a working-looking chat box over an endpoint that always
 * refuses.
 *
 * `AI_MODEL_TUTOR` is required as well as the key: a key with no model is a configuration that
 * cannot complete a request, and reporting it as configured would promise something that fails.
 */
export function providerConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim() && process.env.AI_MODEL_TUTOR?.trim());
}
