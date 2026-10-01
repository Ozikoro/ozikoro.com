/**
 * A small rate limiter for the endpoints that start and finish an OAuth flow.
 *
 * WHAT IT IS FOR, AND WHAT IT IS NOT
 *
 * The thing being protected is not really the OAuth state machine: a callback without a valid
 * state does one indexed lookup and is refused, so hammering it achieves nothing except load.
 * The reason to limit it anyway is that load is the whole risk. The connect endpoint is worse
 * than the callback — each accepted request writes a row — so an authenticated administrator
 * looping it could fill a table.
 *
 * WHAT IT IS NOT: a distributed limiter. The window lives in this process's memory, so with
 * several instances behind a load balancer each instance allows the full quota and the real
 * ceiling is multiplied by the number of instances. That is stated here rather than left to be
 * discovered, and it is an acceptable trade for these two endpoints: the volume is a handful
 * of requests per hour from one administrator, and the alternative is a shared store or a
 * database round trip on every callback.
 *
 * If Ozikoro later runs several instances and the ceiling matters, the fix is one table with a
 * per-key counter, in the same shape as `plan_limit` — not a bigger in-memory window.
 */

interface Window {
  count: number;
  /** Epoch milliseconds at which this window is replaced. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Ceiling on tracked keys, so the map cannot grow without bound. */
const MAX_KEYS = 5_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Whole seconds until the window resets. Never zero on a refusal. */
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Count one request against `key`.
 *
 * The key is normally an IP address, and it is passed in rather than derived here so that the
 * caller decides what it considers the identity — behind a proxy that is `x-forwarded-for`,
 * which this app already trusts for the session's `ip_address` column.
 */
export function rateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;

  // Cheap, bounded housekeeping: expired windows are dropped before the map is touched again.
  if (windows.size > MAX_KEYS) {
    for (const [existingKey, window] of windows) {
      if (window.resetAt <= now) windows.delete(existingKey);
    }
    // Still full after sweeping means genuine pressure, not leaks. Clearing is the safe
    // direction: a limiter that fails open here would be worse than one that forgets history.
    if (windows.size > MAX_KEYS) windows.clear();
  }

  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  if (current.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: options.limit - current.count,
    retryAfterSeconds: 0,
  };
}

/**
 * The client's address, as far as it can be trusted here.
 *
 * `x-forwarded-for` is a list and the left-most entry is the original client; the rest are
 * proxies. It is only meaningful because this app runs behind Caddy, which sets it. When it is
 * absent the caller is on a direct connection and there is no header to trust, so a single
 * shared bucket is used rather than skipping the limit — an unidentifiable caller should not
 * get unlimited attempts.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim();
  if (first) return first;
  return request.headers.get('x-real-ip')?.trim() || 'unknown-client';
}

/** Reset every window. Exported for tests, which must not inherit another test's counts. */
export function resetRateLimits(): void {
  windows.clear();
}
