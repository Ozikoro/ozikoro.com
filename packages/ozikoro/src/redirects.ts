/**
 * Where a redirect is allowed to send somebody.
 *
 * WHY THIS LIVES IN THE TESTED PACKAGE RATHER THAN IN THE APPLICATION
 *
 * This was `safeRedirectPath`, a private function inside `apps/ozikoro/lib/access.ts`. It closed a
 * real open redirect — an authenticated POST carrying `returnTo=https://evil.example` answered `303`
 * with that absolute URL — and it had **no test**, because `access.ts` imports the database client and
 * the application has no test harness at all. A security decision that cannot be tested is a security
 * decision that reverts the next time somebody tidies the file.
 *
 * Moving it here puts it where the rest of the logic is tested. `access.ts` imports it, so there is
 * still exactly one implementation.
 *
 * WHAT IT REFUSES, AND WHY EACH CASE IS SEPARATE
 *
 *   `https://evil.example`  — not a path. The obvious case.
 *   `//evil.example`        — **protocol-relative: absolute despite beginning with a slash.** This is
 *                             the one a naive `startsWith('/')` check misses, and it is why the check
 *                             is not simply "does it start with a slash".
 *   `/\evil.example`        — some browsers normalise a backslash to a forward slash, so this becomes
 *                             protocol-relative after the browser has finished with it.
 *
 * Anything else beginning with a single slash is returned unchanged, and everything else becomes `/`.
 */
export function safeRedirectPath(path: string): string {
  const candidate = (path ?? '').trim();
  if (candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.includes('\\')) {
    return candidate;
  }
  return '/';
}
