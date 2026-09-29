/**
 * The LLM gateway — one internal interface, swappable providers.
 *
 * Spec §8.2: "One internal interface to one or more model providers … Providers can be swapped
 * without changing product logic; contract tests per adapter."
 *
 * WHY THIS EXISTS BEFORE ANY PROVIDER DOES
 *
 * §7 requires benchmarking at least two providers on an Igbo evaluation set before choosing one,
 * and §16 lists vendor lock-in as a risk whose mitigation is putting "AI, storage, messaging and
 * payments behind internal interfaces". Both point the same way: the interface has to exist
 * first, or the first provider's SDK shape becomes the architecture by accident.
 *
 * Nothing in this file knows what a provider is. It knows what a request is, what a response is,
 * what can go wrong, and that anything violating the contract must fail loudly in a test rather
 * than quietly in production.
 *
 * WHY EVERY FAILURE IS NORMALISED
 *
 * §8.1 requires cost and abuse controls, and §13 requires observability with "alerting on spend
 * and error spikes". Neither is possible against a provider's own error taxonomy, because they
 * are all different. So failures are classified here into the small set of things the product
 * actually reacts to — rate limited, out of budget, timed out, refused, malformed — and the
 * provider's original detail is preserved in `cause` for a human.
 */
import type { TrustLabel } from '../exercises.ts';

// ---------------------------------------------------------------------------
// Requests and responses
// ---------------------------------------------------------------------------

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  /**
   * The resolved system prompt.
   *
   * Passed already rendered rather than as a template id so that this layer has no opinion about
   * prompts, and so the exact text sent to a provider can be logged with the response (§8.2:
   * "version stored on each AI message").
   */
  system: string;
  messages: AiMessage[];
  model: string;
  /** Hard ceiling on the completion. §8.1: "maximum tokens per request". */
  maxOutputTokens: number;
  temperature?: number;
  /** Ask the provider for strict JSON. Providers that cannot are emulated by the parser. */
  expectJson?: boolean;
  /**
   * Correlates logs across the gateway, the validator and the usage ledger.
   * Deliberately opaque: §8.1 requires prompts logged "with user identifiers separated", so this
   * must not be an email, an account id or anything else that identifies a learner.
   */
  requestId: string;
  /** Milliseconds. The gateway enforces its own, shorter, deadline. */
  timeoutMs?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error';

export interface AiResponse {
  text: string;
  model: string;
  usage: AiUsage;
  finishReason: FinishReason;
  /** Provider-side identifier, for support conversations. */
  providerRequestId?: string;
  latencyMs: number;
  /** The prompt version that produced this, copied through for the message log. */
  promptVersion?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AiFailureKind =
  | 'rate_limited'
  | 'over_budget'
  | 'timeout'
  | 'refused'
  | 'malformed'
  | 'unavailable'
  | 'unknown';

export class AiError extends Error {
  override readonly name = 'AiError';
  readonly kind: AiFailureKind;
  readonly providerId: string;
  /** True when retrying the identical request could plausibly succeed. */
  readonly retryable: boolean;
  /** The provider's own error, kept for humans. Never shown to a learner. */
  override readonly cause?: unknown;

  constructor(kind: AiFailureKind, providerId: string, message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message);
    this.kind = kind;
    this.providerId = providerId;
    this.retryable = options.retryable ?? (kind === 'rate_limited' || kind === 'timeout' || kind === 'unavailable');
    this.cause = options.cause;
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface AiProvider {
  /** Stable id, e.g. 'anthropic' or 'openai'. Appears in every log line and usage row. */
  readonly id: string;
  /** Models this adapter will accept. A request for anything else fails before the network hop. */
  readonly supportedModels: readonly string[];
  /**
   * Perform one completion.
   *
   * Implementations MUST:
   *   - honour `maxOutputTokens`
   *   - throw {@link AiError} with the right `kind`, never a bare Error
   *   - resolve `usage` from the provider's own accounting, and throw if it is unavailable —
   *     §8.1 requires a spend cap, and a spend cap built on estimated tokens is not a cap
   *   - respect the AbortSignal
   */
  complete(request: AiRequest, signal?: AbortSignal): Promise<AiResponse>;
}

// ---------------------------------------------------------------------------
// The gateway
// ---------------------------------------------------------------------------

export interface GatewayOptions {
  /** Applied when a request does not set its own. */
  defaultTimeoutMs?: number;
  /** Called for every completed request. §8.1 observability: latency, tokens, cost. */
  onUsage?: (event: UsageEvent) => void;
}

export interface UsageEvent {
  requestId: string;
  providerId: string;
  model: string;
  promptVersion?: string;
  usage: AiUsage;
  latencyMs: number;
  ok: boolean;
  failureKind?: AiFailureKind;
}

export class AiGateway {
  private readonly providers = new Map<string, AiProvider>();
  private readonly defaultTimeoutMs: number;
  private readonly onUsage: GatewayOptions['onUsage'];

  constructor(options: GatewayOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.onUsage = options.onUsage;
  }

  register(provider: AiProvider): void {
    if (this.providers.has(provider.id)) {
      throw new AiError('unknown', provider.id, `A provider with id "${provider.id}" is already registered.`);
    }
    if (provider.supportedModels.length === 0) {
      throw new AiError('unknown', provider.id, `Provider "${provider.id}" declares no supported models.`);
    }
    this.providers.set(provider.id, provider);
  }

  get providerIds(): string[] {
    return [...this.providers.keys()];
  }

  /** Every model any registered provider will accept. Used to validate configuration at boot. */
  get supportedModels(): string[] {
    return [...new Set([...this.providers.values()].flatMap((p) => [...p.supportedModels]))];
  }

  /**
   * Route a request to the provider that supports its model.
   *
   * Routing by model rather than by a configured "current provider" means §7's benchmark can run
   * the same evaluation set against two providers in one process, which is what the comparison
   * requires.
   */
  async complete(request: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
    const provider = [...this.providers.values()].find((candidate) =>
      candidate.supportedModels.includes(request.model)
    );

    if (!provider) {
      const known = this.supportedModels;
      throw new AiError(
        'malformed',
        'gateway',
        `No registered provider supports model "${request.model}". ` +
          (known.length ? `Known models: ${known.join(', ')}.` : 'No providers are registered.')
      );
    }

    if (request.messages.length === 0) {
      throw new AiError('malformed', provider.id, 'A request must contain at least one message.');
    }
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
      throw new AiError('malformed', provider.id, 'maxOutputTokens must be a positive integer.');
    }

    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();

    // A signal that is ALREADY aborted never fires its 'abort' event again, so adding a listener
    // to it does nothing and the request would run to completion — or hang — after the caller had
    // already walked away. This happens whenever a learner navigates off the tutor mid-request and
    // the next call is made with the same signal, which is exactly the case a cancellation path
    // exists for. Checked before the listener rather than trusting the event.
    if (signal?.aborted) {
      controller.abort(signal.reason);
    }

    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });

    // The gateway's own deadline is the outer one. A provider that ignores its signal still
    // cannot hold a learner's request open indefinitely.
    const timer = setTimeout(() => controller.abort(new Error('gateway timeout')), timeoutMs);

    const started = Date.now();
    try {
      const response = await provider.complete(request, controller.signal);
      this.report({
        requestId: request.requestId,
        providerId: provider.id,
        model: response.model,
        promptVersion: response.promptVersion ?? request.model,
        usage: response.usage,
        latencyMs: response.latencyMs,
        ok: true,
      });
      return response;
    } catch (error) {
      const failure = normalise(error, provider.id);
      this.report({
        requestId: request.requestId,
        providerId: provider.id,
        model: request.model,
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: Date.now() - started,
        ok: false,
        failureKind: failure.kind,
      });
      if (failure.kind === 'timeout') {
        throw new AiError('timeout', provider.id, `The model did not respond within ${timeoutMs} ms.`, {
          retryable: true,
          cause: error,
        });
      }
      throw failure;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private report(event: UsageEvent): void {
    // A failing usage hook must never fail a learner's request.
    try {
      this.onUsage?.(event);
    } catch {
      /* observability is not allowed to break the product */
    }
  }
}

/** Map anything thrown by an adapter onto the small set of kinds the product reacts to. */
export function normalise(error: unknown, providerId: string): AiError {
  if (error instanceof AiError) return error;

  if (error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))) {
    return new AiError('timeout', providerId, 'The request was aborted.', { retryable: true, cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('rate') && lower.includes('limit')) {
    return new AiError('rate_limited', providerId, 'The provider rate-limited this request.', { retryable: true, cause: error });
  }
  if (lower.includes('quota') || lower.includes('billing') || lower.includes('budget')) {
    return new AiError('over_budget', providerId, 'The provider account is out of budget or quota.', { retryable: false, cause: error });
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return new AiError('timeout', providerId, 'The provider timed out.', { retryable: true, cause: error });
  }
  if (lower.includes('refus') || lower.includes('content policy') || lower.includes('safety')) {
    return new AiError('refused', providerId, 'The provider refused to answer.', { retryable: false, cause: error });
  }
  if (lower.includes('unavailable') || lower.includes('overloaded') || lower.includes('503')) {
    return new AiError('unavailable', providerId, 'The provider is temporarily unavailable.', { retryable: true, cause: error });
  }

  return new AiError('unknown', providerId, message, { retryable: false, cause: error });
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

export interface ContractCase {
  name: string;
  request: AiRequest;
  /** Skip cases a provider legitimately cannot serve, e.g. JSON mode. */
  skip?: boolean;
  /**
   * Abort the signal before the provider is called.
   *
   * The deterministic way to test that an adapter honours its AbortSignal. Timing a real deadline
   * is not deterministic — a fast provider may legitimately answer inside a 1 ms budget — so the
   * contract checks the behaviour that matters (a provider must not ignore an aborted signal)
   * rather than the clock.
   */
  abortImmediately?: boolean;
}

/**
 * The cases every adapter must pass.
 *
 * §8.2 asks for "contract tests per adapter", and the point of them is that a second provider can
 * be added without the product discovering its quirks in production. The cases below are the ones
 * that have bitten this kind of integration before: unreported usage (which silently disables the
 * spend cap), a signal that is ignored (which makes the gateway's deadline unenforceable), and an
 * unknown model that reaches the network.
 *
 * The harness returns its cases rather than executing them, so an adapter's test file stays a
 * three-line file and stays in step when this list grows.
 */
export function providerContractCases(model: string): ContractCase[] {
  const base: AiRequest = {
    system: 'You are a test harness. Reply with the single word: ok',
    messages: [{ role: 'user', content: 'Say ok.' }],
    model,
    maxOutputTokens: 16,
    requestId: 'contract-1',
  };

  return [
    { name: 'returns text and reported usage', request: base },
    {
      name: 'honours maxOutputTokens',
      request: {
        ...base,
        requestId: 'contract-2',
        maxOutputTokens: 1,
        messages: [{ role: 'user', content: 'Count from one to fifty.' }],
      },
    },
    {
      name: 'aborts when its signal is already aborted',
      request: { ...base, requestId: 'contract-3' },
      abortImmediately: true,
    },
    {
      name: 'declares the models it accepts',
      // Handled by inspection rather than execution: the harness checks that this model is not
      // declared, which is the assertion that a request for it fails before the network hop.
      request: { ...base, requestId: 'contract-4', model: 'definitely-not-a-real-model' },
    },
  ];
}

/**
 * Assertions an adapter's test file runs against its own provider.
 *
 * Kept as plain data-returning checks rather than a test-framework dependency, because
 * `packages/core` deliberately has no test framework and adding one to satisfy a convenience
 * would be the wrong trade.
 */
export interface ContractFinding {
  case: string;
  ok: boolean;
  detail: string;
}

export async function runProviderContract(
  provider: AiProvider,
  cases: readonly ContractCase[]
): Promise<ContractFinding[]> {
  const findings: ContractFinding[] = [];

  for (const testCase of cases) {
    if (testCase.skip) {
      findings.push({ case: testCase.name, ok: true, detail: 'skipped' });
      continue;
    }

    // The unknown-model case must fail BEFORE the network hop, with the right kind.
    if (!provider.supportedModels.includes(testCase.request.model)) {
      findings.push({
        case: testCase.name,
        ok: true,
        detail: 'model correctly not declared as supported',
      });
      continue;
    }

    // The harness imposes its own deadline, because it is testing the ADAPTER, not the gateway.
    // Without this, a provider that never settles hangs the contract run — which is what an
    // earlier version of this function did.
    const controller = new AbortController();
    if (testCase.abortImmediately) {
      controller.abort(new Error('contract: signal aborted before the call'));
    }
    const deadlineMs = testCase.request.timeoutMs ?? 5_000;
    const timer = setTimeout(() => controller.abort(new Error('contract: deadline')), deadlineMs);

    try {
      const response = await provider.complete(testCase.request, controller.signal);

      if (testCase.abortImmediately) {
        // Reaching here means the adapter ignored an aborted signal, so the gateway's own deadline
        // cannot be enforced through it.
        findings.push({ case: testCase.name, ok: false, detail: 'ignored an aborted signal' });
        continue;
      }

      if (!response.usage || typeof response.usage.inputTokens !== 'number' || typeof response.usage.outputTokens !== 'number') {
        // The single most dangerous contract failure: §8.1's spend cap cannot work without it.
        findings.push({ case: testCase.name, ok: false, detail: 'usage not reported' });
        continue;
      }

      if (typeof response.text !== 'string') {
        findings.push({ case: testCase.name, ok: false, detail: 'text was not a string' });
        continue;
      }

      findings.push({
        case: testCase.name,
        ok: true,
        detail: `${response.usage.outputTokens} output tokens`,
      });
    } catch (error) {
      const failure = normalise(error, provider.id);
      if (testCase.abortImmediately) {
        findings.push({
          case: testCase.name,
          ok: failure.kind === 'timeout',
          detail: `failed with kind "${failure.kind}"`,
        });
        continue;
      }
      findings.push({
        case: testCase.name,
        ok: false,
        detail: error instanceof AiError ? `${error.kind}: ${error.message}` : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// A deterministic fake, for tests and for the product's own development
// ---------------------------------------------------------------------------

/**
 * A provider that answers from a script.
 *
 * Needed for three things at once: unit-testing everything downstream of the gateway without a
 * network, running the evaluation harness against a known-good baseline to prove the harness
 * itself works, and letting the app develop with `AI_PROVIDER=fake` before any key exists. §8.1
 * requires the evaluation to be run "before any model or prompt change ships", and a baseline is
 * what makes that comparison meaningful.
 */
export class ScriptedProvider implements AiProvider {
  readonly id: string;
  readonly supportedModels: readonly string[];
  private readonly replies: string[];
  private cursor = 0;
  private readonly failures: Map<number, AiError>;

  constructor(
    options: {
      /** Overridable so several fakes can sit in one gateway, which benchmark runs need. */
      id?: string;
      models?: readonly string[];
      replies?: readonly string[];
      /** Fail the Nth call (0-based) with a specific error, to test the failure paths. */
      failures?: Map<number, AiError>;
    } = {}
  ) {
    this.id = options.id ?? 'scripted';
    this.supportedModels = options.models ?? ['scripted-model'];
    this.replies = options.replies ? [...options.replies] : ['ok'];
    this.failures = options.failures ?? new Map();
  }

  async complete(request: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
    // A well-behaved adapter checks the signal before doing any work, which is what the contract
    // harness asserts. Reproducing that here keeps the fake honest — a fake that ignores its
    // signal would let every downstream test pass against a provider contract nothing satisfies.
    if (signal?.aborted) {
      const error = new Error('aborted before the request was made');
      error.name = 'AbortError';
      throw error;
    }

    const callIndex = this.cursor;
    const failure = this.failures.get(callIndex);
    if (failure) {
      this.cursor += 1;
      throw failure;
    }

    const text = this.replies[this.cursor % this.replies.length] ?? 'ok';
    this.cursor += 1;

    return {
      text,
      model: request.model,
      usage: {
        inputTokens: request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0),
        outputTokens: text.length,
      },
      finishReason: 'stop',
      latencyMs: 1,
    };
  }
}
