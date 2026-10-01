/**
 * The rate limiter, and the one property the sign-in fix depends on.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `apps/ozikoro` had no test harness — no test files and no test script — so the two security fixes
 * that live in this application, the origin guard (round 42) and the sign-in rate limit (round 43),
 * were exercised only by hand. The redirect check was moved into the tested package in round 47 for
 * that reason; `rate-limit.ts` has no dependencies and can simply be tested here.
 *
 * Run with: npm -w @ozikoro/site run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientKey, rateLimit, resetRateLimits } from './rate-limit.ts';

test('allows up to the limit, then refuses', () => {
  resetRateLimits();
  const options = { limit: 3, windowSeconds: 300 };
  const outcomes = [1, 2, 3, 4].map(() => rateLimit('k', options).allowed);
  assert.deepEqual(outcomes, [true, true, true, false]);
});

test('different keys have independent windows', () => {
  resetRateLimits();
  const options = { limit: 1, windowSeconds: 300 };
  assert.equal(rateLimit('a', options).allowed, true);
  assert.equal(rateLimit('a', options).allowed, false);
  assert.equal(rateLimit('b', options).allowed, true, 'b must not be affected by a');
});

test('a refusal reports how long to wait', () => {
  resetRateLimits();
  const options = { limit: 1, windowSeconds: 300 };
  rateLimit('k', options);
  const refused = rateLimit('k', options);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 300,
    `retryAfterSeconds was ${refused.retryAfterSeconds}`);
});

test('resetRateLimits clears every window', () => {
  resetRateLimits();
  const options = { limit: 1, windowSeconds: 300 };
  rateLimit('k', options);
  assert.equal(rateLimit('k', options).allowed, false);
  resetRateLimits();
  assert.equal(rateLimit('k', options).allowed, true);
});

test('clientKey prefers the first x-forwarded-for address', () => {
  const request = new Request('https://ozikoro.com/', {
    headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2' },
  });
  assert.equal(clientKey(request), '203.0.113.9');
});

test('clientKey falls back to x-real-ip, then to a constant', () => {
  assert.equal(clientKey(new Request('https://ozikoro.com/', { headers: { 'x-real-ip': '198.51.100.7' } })), '198.51.100.7');
  assert.equal(clientKey(new Request('https://ozikoro.com/')), 'unknown-client');
});

/*
 * THE PROPERTY THE SIGN-IN FIX RELIES ON.
 *
 * The sign-in endpoint limits on two keys, and the client key is defeatable: `x-forwarded-for` is a
 * request header, so an attacker varies it and gets a fresh allowance every time. That was verified
 * against the running server in round 43 by rotating the header across fourteen addresses — the client
 * limit was bypassed completely and the ACCOUNT limit still throttled at attempt eleven.
 *
 * This asserts the mechanism underneath, so a refactor cannot quietly make the account key client-
 * scoped and turn the limit back into something a header defeats.
 */
test('rotating the client key does not reset the account key', () => {
  resetRateLimits();
  const options = { limit: 2, windowSeconds: 300 };
  const account = 'signin-account:victim@example.com';
  const outcomes: boolean[] = [];

  /*
   * The route permits the attempt only when BOTH keys allow it, so this models that exactly: the
   * client key rotates every iteration, the account key does not.
   *
   * The first version of this test called the account key five times and never touched a client key,
   * so it proved the account key throttles but nothing about rotation — while its name claimed
   * otherwise. Rotating is the whole point: without it the test would pass even if the account key
   * were client-scoped, which is the failure it exists to catch.
   */
  for (let i = 0; i < 5; i += 1) {
    const byClient = rateLimit(`signin-client:10.0.0.${i}`, options).allowed;
    const byAccount = rateLimit(account, options).allowed;
    outcomes.push(byClient && byAccount);
  }

  assert.deepEqual(
    outcomes,
    [true, true, false, false, false],
    'a fresh client key must not buy another guess at the same account'
  );
});
