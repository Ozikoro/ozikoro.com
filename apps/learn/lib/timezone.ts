/**
 * The learner's time zone, for anything that counts a day.
 *
 * WHY THIS IS NOT JUST `Intl.DateTimeFormat().resolvedOptions().timeZone` ON THE SERVER
 *
 * A Node process resolves that to the zone of the HOST, which in production is UTC inside a
 * container. §F7 requires the streak day to be defined in the LEARNER's zone — a learner in Lagos
 * practising at 00:30 has started a new day; the same instant in UTC is still 23:30 the previous
 * day, and getting it wrong resets their streak for practising, which is the worst possible reason.
 *
 * So the zone travels with the request. It is not trusted for anything that matters — a wrong zone
 * can only move a streak day, never grant XP, expose data or write to another account — but it is
 * still validated, because an unvalidated string reaches `Intl` and a malformed one throws at the
 * point where a learner is trying to answer a question.
 *
 * WHAT IT FALLS BACK TO, AND WHY THAT IS HONEST
 *
 * `UTC` when nothing is supplied. Onboarding is where §F1 collects a learner's goal and could
 * collect their zone properly; until then a browser that sends nothing gets UTC, which is wrong for
 * most people but wrong in the same direction for all of them. The alternative — guessing from an
 * IP — is a third-party lookup that would still be wrong for anyone on a VPN, and would send a
 * learner's address to someone else to produce it.
 */

/** Zones are cheap to check and the set is small; `Intl` is the authority rather than a regex. */
function isValidTimeZone(value: string): boolean {
  try {
    // Throws on an unknown zone. `Intl.supportedValuesOf('timeZone')` would also work but is not
    // available in every runtime this code has to run in.
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_TIME_ZONE = 'UTC';

/**
 * Resolve the zone from a header or a body field.
 *
 * The header is preferred because it is set once by the client and applies to every request, while a
 * body field has to be remembered at each call site. Accepting both means a JSON client can send
 * either, and the form-posted routes (which have no body to speak of) still work.
 */
export function learnerTimeZone(
  request: Request,
  body?: Record<string, unknown> | null
): string {
  const fromBody = typeof body?.timeZone === 'string' ? body.timeZone : '';
  const fromHeader = request.headers.get('x-learner-timezone') ?? '';
  const candidate = (fromHeader || fromBody).trim();

  if (candidate && candidate.length <= 64 && isValidTimeZone(candidate)) return candidate;
  return DEFAULT_TIME_ZONE;
}
