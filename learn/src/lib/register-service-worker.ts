/**
 * Register the offline service worker.
 *
 * WHY IN PRODUCTION ONLY
 *
 * In development Vite serves modules that change on every save, and a service worker caching them
 * produces confusing results that look like a code bug. Registration is skipped unless this is a
 * production build, so the offline layer cannot be the reason a change "did not apply" locally.
 *
 * WHY AFTER `load`
 *
 * Registration downloads and installs `sw.js`, competing with the page for bandwidth on a slow
 * connection. Waiting until the page has loaded keeps the first paint fast, and offline support is
 * only useful on the SECOND visit anyway.
 */
if (typeof window !== "undefined" && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A failed registration costs offline support and nothing else. Logged, never surfaced —
      // an error toast would worry a learner about something that does not affect the lesson.
      console.warn("[sw] offline support unavailable");
    });
  });
}

export {};
