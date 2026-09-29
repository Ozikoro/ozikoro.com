/**
 * Gateway and provider-contract tests.
 *
 * §8.2 asks for "contract tests per adapter", and the contract's real job is to catch the failure
 * that silently disables a control elsewhere: a provider that does not report token usage makes
 * §8.1's spend cap unenforceable, and nothing else in the system would notice. So the contract is
 * asserted here rather than left as a convention.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiError,
  AiGateway,
  ScriptedProvider,
  normalise,
  providerContractCases,
  runProviderContract,
  type AiProvider,
  type AiRequest,
  type AiResponse,
  type UsageEvent,
} from './gateway.ts';

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    system: 'You are a test.',
    messages: [{ role: 'user', content: 'hello' }],
    model: 'scripted-model',
    maxOutputTokens: 100,
    requestId: 'r1',
    ...overrides,
  };
}

/** A provider that never answers, but honours its abort signal. */
function hangingProvider(id = 'hanging'): AiProvider {
  return {
    id,
    supportedModels: ['hang-model'],
    complete(_request: AiRequest, signal?: AbortSignal) {
      const abort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        return error;
      };

      // An already-aborted signal will not fire its event again, so it is checked first.
      if (signal?.aborted) return Promise.reject(abort());

      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(abort()));
      });
    },
  };
}

/** A provider that reports no usage — the contract violation that matters most. */
function usageLessProvider(): AiProvider {
  return {
    id: 'usageless',
    supportedModels: ['usageless-model'],
    async complete(aiRequest: AiRequest) {
      // Deliberately missing `usage`. Cast rather than annotated, because the type is exactly what
      // is being violated and the harness under test is what must notice.
      return {
        text: 'ok',
        model: aiRequest.model,
        finishReason: 'stop',
        latencyMs: 1,
      } as unknown as AiResponse;
    },
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('a request is routed to the provider that declares its model', async () => {
  const gateway = new AiGateway();
  gateway.register(new ScriptedProvider({ id: 'provider-a', models: ['a-model'], replies: ['from-a'] }));
  gateway.register(new ScriptedProvider({ id: 'provider-b', models: ['b-model'], replies: ['from-b'] }));

  assert.equal((await gateway.complete(request({ model: 'a-model' }))).text, 'from-a');
  assert.equal((await gateway.complete(request({ model: 'b-model' }))).text, 'from-b');
});

test('an unsupported model fails before any network hop', async () => {
  const gateway = new AiGateway();
  gateway.register(new ScriptedProvider({ models: ['a-model'] }));

  await assert.rejects(
    () => gateway.complete(request({ model: 'nonexistent' })),
    (error: unknown) => {
      assert.ok(error instanceof AiError);
      assert.equal(error.kind, 'malformed');
      assert.match(error.message, /a-model/);
      return true;
    }
  );
});

test('a gateway with no providers says so rather than failing obscurely', async () => {
  const gateway = new AiGateway();
  assert.deepEqual(gateway.providerIds, []);
  await assert.rejects(() => gateway.complete(request()), /No providers are registered/);
});

test('registering the same provider id twice is refused', () => {
  const gateway = new AiGateway();
  gateway.register(new ScriptedProvider({ models: ['m'] }));
  assert.throws(() => gateway.register(new ScriptedProvider({ models: ['m'] })), /already registered/);
});

test('a provider declaring no models is refused at registration', () => {
  const gateway = new AiGateway();
  assert.throws(
    () => gateway.register({ id: 'empty', supportedModels: [], complete: async () => { throw new Error('x'); } }),
    /declares no supported models/
  );
});

test('supportedModels is the union across providers', () => {
  const gateway = new AiGateway();
  gateway.register(new ScriptedProvider({ models: ['a', 'b'] }));
  gateway.register(new ScriptedProvider({ id: 'second', models: ['c'] }));
  assert.deepEqual(gateway.supportedModels.sort(), ['a', 'b', 'c']);
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

test('a request with no messages is refused', async () => {
  const gateway = new AiGateway();
  gateway.register(new ScriptedProvider());
  await assert.rejects(() => gateway.complete(request({ messages: [] })), /at least one message/);
});

test('a non-positive token ceiling is refused', async () => {
  const gateway = new AiGateway();
  gateway.register(new ScriptedProvider());
  await assert.rejects(() => gateway.complete(request({ maxOutputTokens: 0 })), /maxOutputTokens/);
});

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

test('the gateway enforces its own deadline', async () => {
  const gateway = new AiGateway();
  gateway.register(hangingProvider());

  await assert.rejects(
    () => gateway.complete(request({ model: 'hang-model', timeoutMs: 20 })),
    (error: unknown) => {
      assert.ok(error instanceof AiError);
      assert.equal(error.kind, 'timeout');
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test('a caller-supplied abort signal stops the request', async () => {
  const gateway = new AiGateway();
  gateway.register(hangingProvider());

  const controller = new AbortController();
  const pending = gateway.complete(request({ model: 'hang-model', timeoutMs: 5_000 }), controller.signal);
  controller.abort();

  await assert.rejects(() => pending, (error: unknown) => {
    assert.ok(error instanceof AiError);
    assert.equal(error.kind, 'timeout');
    return true;
  });
});

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

test('provider errors are classified into the kinds the product reacts to', () => {
  const cases: [string, string][] = [
    ['429 rate limit exceeded', 'rate_limited'],
    ['You have exceeded your quota', 'over_budget'],
    ['the request timed out', 'timeout'],
    ['refused by content policy', 'refused'],
    ['service unavailable, please retry', 'unavailable'],
    ['something strange happened', 'unknown'],
  ];

  for (const [message, expected] of cases) {
    assert.equal(normalise(new Error(message), 'p').kind, expected, message);
  }
});

test('retryability follows the kind, not the message', () => {
  assert.equal(normalise(new Error('rate limit'), 'p').retryable, true);
  assert.equal(normalise(new Error('quota'), 'p').retryable, false);
  assert.equal(normalise(new Error('nonsense'), 'p').retryable, false);
});

test('an abort is a timeout, not an unknown failure', () => {
  const error = new Error('aborted');
  error.name = 'AbortError';
  assert.equal(normalise(error, 'p').kind, 'timeout');
});

test('an AiError passes through unchanged', () => {
  const original = new AiError('refused', 'p', 'no');
  assert.equal(normalise(original, 'p'), original);
});

test('the provider cause is preserved for humans', () => {
  const cause = new Error('underlying detail');
  assert.equal(normalise(cause, 'p').cause, cause);
});

// ---------------------------------------------------------------------------
// Usage reporting
// ---------------------------------------------------------------------------

test('the usage hook fires on success with real token counts', async () => {
  const events: UsageEvent[] = [];
  const gateway = new AiGateway({ onUsage: (event) => events.push(event) });
  gateway.register(new ScriptedProvider({ replies: ['hello there'] }));

  await gateway.complete(request());
  assert.equal(events.length, 1);
  assert.equal(events[0]!.ok, true);
  assert.ok(events[0]!.usage.outputTokens > 0);
  assert.equal(events[0]!.requestId, 'r1');
});

test('the usage hook fires on failure, so errors are observable too', async () => {
  const events: UsageEvent[] = [];
  const gateway = new AiGateway({ onUsage: (event) => events.push(event) });
  gateway.register(hangingProvider());

  await assert.rejects(() => gateway.complete(request({ model: 'hang-model', timeoutMs: 10 })));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.ok, false);
  assert.equal(events[0]!.failureKind, 'timeout');
});

test('a throwing usage hook cannot break a learner request', async () => {
  const gateway = new AiGateway({
    onUsage: () => {
      throw new Error('observability is down');
    },
  });
  gateway.register(new ScriptedProvider({ replies: ['still fine'] }));

  const response = await gateway.complete(request());
  assert.equal(response.text, 'still fine');
});

// ---------------------------------------------------------------------------
// The contract harness
// ---------------------------------------------------------------------------

test('the scripted provider passes the contract', async () => {
  const provider = new ScriptedProvider({ models: ['scripted-model'] });
  const findings = await runProviderContract(provider, providerContractCases('scripted-model'));

  const failures = findings.filter((finding) => !finding.ok);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test('the contract catches a provider that does not report usage', async () => {
  const findings = await runProviderContract(usageLessProvider(), [
    { name: 'returns text and reported usage', request: request({ model: 'usageless-model' }) },
  ]);
  assert.equal(findings[0]!.ok, false);
  assert.match(findings[0]!.detail, /usage not reported/);
});

test('the contract catches a provider that ignores an aborted signal', async () => {
  // A provider that answers anyway cannot have the gateway's deadline enforced through it, so a
  // learner's request could outlive every timeout the platform sets.
  const ignoring: AiProvider = {
    id: 'ignoring',
    supportedModels: ['ignoring-model'],
    async complete(aiRequest: AiRequest) {
      return {
        text: 'answered regardless',
        model: aiRequest.model,
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
        latencyMs: 1,
      };
    },
  };

  const findings = await runProviderContract(ignoring, [
    {
      name: 'aborts when its signal is already aborted',
      request: request({ model: 'ignoring-model' }),
      abortImmediately: true,
    },
  ]);
  assert.equal(findings[0]!.ok, false);
  assert.match(findings[0]!.detail, /ignored an aborted signal/);
});

test('the contract accepts a provider that aborts correctly', async () => {
  const findings = await runProviderContract(hangingProvider(), [
    {
      name: 'aborts when its signal is already aborted',
      request: request({ model: 'hang-model' }),
      abortImmediately: true,
    },
  ]);
  assert.equal(findings[0]!.ok, true);
  assert.match(findings[0]!.detail, /timeout/);
});

test('the harness imposes its own deadline so a hanging provider cannot stall the run', async () => {
  // The regression this guards: an earlier version called providers with no signal at all, so a
  // provider that never settles hung the whole contract run rather than failing one case.
  const findings = await runProviderContract(hangingProvider(), [
    { name: 'answers at all', request: request({ model: 'hang-model', timeoutMs: 30 }) },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.ok, false, 'a provider that never answers fails the case');
});

test('contract cases can be skipped explicitly', async () => {
  const findings = await runProviderContract(new ScriptedProvider(), [
    { name: 'something unsupported', request: request(), skip: true },
  ]);
  assert.equal(findings[0]!.ok, true);
  assert.equal(findings[0]!.detail, 'skipped');
});
