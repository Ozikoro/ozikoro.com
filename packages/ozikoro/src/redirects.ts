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

/**
 * Did this request come from this site?
 *
 * GROUPED WITH THE REDIRECT CHECK FOR THE SAME REASON
 *
 * It lived in `apps/ozikoro/lib/access.ts` until round 49 and could not be tested there: that file
 * imports `next/navigation`, which does not resolve outside a Next runtime, so a plain `node --test`
 * cannot load it. It closed a real gap — four state-changing routes took cross-site form submissions
 * while four others refused them — and a guard that cannot be tested is a guard that disappears.
 *
 * WHAT IT DOES AND WHAT IT DELIBERATELY DOES NOT
 *
 * `Origin` and `Host` are compared as whole authorities, so `https://evil.example` is refused and
 * `https://ozikoro.com` with any port mismatch is refused.
 *
 * A MISSING `Origin` IS ALLOWED, and that is a decision rather than an oversight. Browsers send
 * `Origin` on cross-site requests, which is the case this guards; they do not send it on same-origin
 * navigations, and non-browser clients (curl, a scheduler, a health check) send nothing at all.
 * Refusing those would break legitimate use to defend against a request the browser would not make.
 *
 * The session cookie is `SameSite=Lax` as well, so a cross-site POST arrives without credentials
 * anyway. This is the second lock, not the only one.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  const host = request.headers.get('host');
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
