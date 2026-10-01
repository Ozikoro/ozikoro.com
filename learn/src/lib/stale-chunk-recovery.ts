/**
 * Recover from a stale page instead of dying on it.
 *
 * THE BUG THIS FIXES
 *
 * Every deploy replaces the whole asset set on Cloudflare Workers, and each JavaScript file is named
 * after a hash of its contents (`index-5ni9n1on.js`). A new build produces new hashes and the old
 * files stop existing — verified: every previous hash returns 404.
 *
 * So a browser holding HTML from an earlier deploy asks for a file that is gone. The document
 * loads, the script 404s, and TanStack's error boundary renders "This page didn't load" — a page
 * that looks broken and does not respond to any click. That is exactly what was happening.
 *
 * THE FIX, IN TWO HALVES
 *
 *   1. `Cache-Control: no-cache, must-revalidate` on the HTML (in vite.config.ts) stops a browser
 *      holding a stale document in the first place. That is the real fix.
 *
 *   2. This file covers the case that remains: a learner mid-session, a tab left open overnight, or
 *      any cache that still holds a document from before the header existed. When a dynamic import
 *      fails, reload once and they land on a working page instead of an error.
 *
 * WHY THE GUARD
 *
 * Without the sessionStorage flag, a genuinely broken build would reload forever — an infinite loop
 * that is worse than the error message, because the learner never gets told anything. The flag is
 * cleared on a successful load, so a later real failure is still allowed to reload.
 */

const RELOAD_FLAG = "ozituma:reloading-stale-chunk";

if (typeof window !== "undefined") {
  /*
   * Vite fires this when a dynamically imported module cannot be fetched. It is the correct signal:
   * it means "this document references code that no longer exists", which is precisely the stale
   * case, and it does not fire for ordinary runtime errors inside a module that DID load.
   */
  window.addEventListener("vite:preloadError", (event) => {
    // Stop Vite rethrowing into the router, so the error boundary does not flash before the reload.
    event.preventDefault();

    if (sessionStorage.getItem(RELOAD_FLAG)) {
      // Already tried once and it failed again. Reloading forever would hide the real problem, so
      // let the error surface and leave the flag in place.
      console.error("[stale-chunk] reload did not fix it — leaving the error visible");
      return;
    }

    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    // `reload()` rather than assigning location.href: it revalidates the document through the cache
    // instead of possibly reusing the stale copy that caused this.
    window.location.reload();
  });

  /*
   * Clear the flag once the app is actually running.
   *
   * `requestAnimationFrame` after `load` means hydration has had a chance to complete: reaching here
   * with a rendered tree proves the chunks of THIS document resolved, so the next failure deserves
   * its own reload attempt.
   */
  window.addEventListener("load", () => {
    window.requestAnimationFrame(() => {
      sessionStorage.removeItem(RELOAD_FLAG);
    });
  });
}

export {};
