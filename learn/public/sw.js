/**
 * Ozituma Learn — offline support.
 *
 * THE ONE RULE THIS FILE FOLLOWS
 *
 * The HTML is NEVER served from cache. This application had a stale-page bug that took three
 * attempts to fix: pages were served with no `Cache-Control`, browsers cached them heuristically,
 * and learners saw an old version until they clicked something. A service worker that caches the
 * document would reintroduce exactly that, and worse — it would survive a deploy and be almost
 * impossible for a user to clear.
 *
 * So the document is network-only. Offline, the app shows the last app SHELL it managed to keep,
 * which is honest about being offline rather than pretending to be current.
 *
 * WHAT IS CACHED, AND WHY EACH IS SAFE
 *
 *   /assets/*        content-hashed filenames (`index-5ni9n1on.js`). The name changes when the
 *                    bytes change, so a cached copy can never be stale. Cache-first.
 *   /fonts/*         the Ndebe and interface fonts. Versioned by filename, never change in place.
 *   /brand/*         logos and icons. Same reasoning.
 *   media.ozituma.com/audio/*
 *                    the recordings. Big, immutable, and the reason offline is worth having at
 *                    all — a lesson without audio is a reading exercise.
 *
 * WHAT IS DELIBERATELY NOT CACHED
 *
 *   HTML documents   see above.
 *   Supabase calls   these are PER-USER. A cached response would show one learner another's data,
 *                    or show a signed-in view to a signed-out browser. Never cached, never offline.
 *   POST/PATCH       writes are not idempotent and must not be replayed from a cache.
 */

const VERSION = "ozituma-learn-v1";

/**
 * Pre-cached so the offline fallback exists locally.
 *
 * `/offline` rather than `/offline.html`: the router strips the extension and 307-redirects the
 * `.html` form, and a redirect is one more network round trip at the exact moment there is no
 * network. The file in `public/` is still `offline.html`; only the public path differs.
 */
const SHELL = [
  "/favicon.svg",
  "/site.webmanifest",
  "/offline",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Cache-first, for things whose URL changes when their content does. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(VERSION);
    // Cloned: a Response body can only be read once, and this one is read twice.
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Writes and non-GET traffic are never cached and never served from cache.
  if (request.method !== "GET") return;

  /*
   * The document: network-only.
   *
   * If the network fails there is nothing honest to show, so the error is allowed through rather
   * than masked with a stale page. `cache: "no-store"` also stops the BROWSER's HTTP cache from
   * answering with an old copy — belt and braces around the header set in vite.config.ts.
   */
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() => caches.match("/offline").then((r) => r ?? Response.error()))
    );
    return;
  }

  // Per-user data must never be shared between sessions or accounts.
  if (url.hostname.endsWith("supabase.co")) return;

  const cacheable =
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/keyboards/") ||
    // The recordings, which live on R2 behind media.ozituma.com.
    (url.hostname === "media.ozituma.com" && url.pathname.startsWith("/audio/"));

  if (cacheable) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else falls through to the network untouched.
});
