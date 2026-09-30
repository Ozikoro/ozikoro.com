/*
 * Ozituma Learn — the service worker.
 *
 * WHAT IT IS FOR
 *
 * §13 requires an installable PWA where a learner can "download the current unit (text plus audio)
 * and complete lessons and reviews offline; progress queues and syncs". This file is the offline
 * half: it decides what survives a lost connection.
 *
 * WHAT IT DELIBERATELY DOES NOT CACHE
 *
 * AUTHENTICATED API RESPONSES. Every one of /api/learn/plan, /api/learn/practice and
 * /api/learn/tutor returns data belonging to one account, and a service worker cache is keyed by
 * URL — not by who asked. Caching them would mean that on a shared phone the next person to open
 * the app is served the previous person's review queue, their practice history and, if the tutor
 * were included, their conversation. That is a data leak produced by a performance optimisation, and
 * it would be invisible: the page would render perfectly.
 *
 * So the offline queue is kept where the ACCOUNT is known — in the page, in `localStorage`, cleared
 * on sign-out by the app that knows a sign-out happened. This worker handles only content that is
 * the same for everybody: the shell, static assets, and reviewed media.
 *
 * WHAT IT DOES CACHE
 *
 *   - the app shell, so the site opens with no connection
 *   - an offline fallback page, so a navigation that misses does not show a browser error
 *   - static build output, which is immutable and content-hashed by Next
 *   - audio from media.ozituma.com, which §F4 makes part of the content and which never changes
 *     once published
 *   - whatever the page explicitly asks for with a CACHE_URLS message, which is how "download this
 *     unit" works
 *
 * VERSIONING
 *
 * The cache names carry a version. Bumping it in a deploy is what evicts the previous shell — the
 * alternative, never versioning, means a learner keeps an old bundle forever and reports bugs that
 * were fixed months ago.
 */

const VERSION = 'v1';
const SHELL_CACHE = `ozituma-learn-shell-${VERSION}`;
const MEDIA_CACHE = `ozituma-learn-media-${VERSION}`;
const PACK_CACHE = `ozituma-learn-pack-${VERSION}`;

/** The minimum needed to render something offline. Deliberately short. */
const SHELL_URLS = ['/', '/offline', '/manifest.webmanifest'];

/** Media is immutable once published, so it is worth a much larger budget than the shell. */
const MEDIA_HOST = 'media.ozituma.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually rather than `addAll`, which rejects the whole install if any single URL fails.
      // A shell that installs without its fallback page is degraded; a shell that refuses to install
      // at all is a site with no offline support, which is worse.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
        )
      );
      // Take over as soon as possible. Without this the first load after a deploy is uncontrolled
      // and the offline support appears not to work until the second visit.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, MEDIA_CACHE, PACK_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

/** Is this a request whose response belongs to one learner? */
function isAuthenticatedApi(url) {
  return url.pathname.startsWith('/api/');
}

/** Static build output. Content-hashed by Next, so a hit can never be stale. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:css|js|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET is safe to cache or replay. A POST is a state change — a review, a sign-in — and
  // serving a cached response to one would silently drop the learner's action.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch another origin except the media host. A worker that intercepts everything turns
  // every third-party hiccup into its own problem.
  if (url.origin !== self.location.origin && url.hostname !== MEDIA_HOST) return;

  // See the note at the top: authenticated data is not this worker's to keep.
  if (isAuthenticatedApi(url)) return;

  // ---------------------------------------------------------------- media
  // Cache-first, because a published recording never changes and a learner replaying a word should
  // not spend their data allowance doing it.
  if (url.hostname === MEDIA_HOST) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const response = await fetch(request);
          // Opaque responses (no CORS) are still playable and still worth keeping; `ok` would be
          // false for them and caching would never happen.
          if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
          return response;
        } catch (error) {
          // Offline and not in the pack. A 504 rather than a rejected promise, so the audio element
          // shows its own error instead of the page throwing.
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // ------------------------------------------------------- static assets
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch {
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // ------------------------------------------------------------ documents
  // Network-first, so a learner with a connection always gets the current page — a shell cached
  // from last week would show a lesson list that no longer matches the server. The cache is the
  // fallback, and the fallback page is the fallback's fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const hit = (await cache.match(request)) ?? (await cache.match('/offline'));
          return (
            hit ??
            new Response('<h1>Offline</h1><p>Reconnect to continue.</p>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          );
        }
      })()
    );
  }
});

/*
 * Explicit downloads.
 *
 * The page asks for a set of URLs — a unit's audio, mostly — and this fetches and stores them. The
 * count of what actually succeeded is sent back, because a partial pack reported as complete is
 * worse than one reported as partial: the learner would travel with it and find gaps.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'CACHE_URLS' || !Array.isArray(data.urls)) return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(PACK_CACHE);
      let stored = 0;
      let failed = 0;

      for (const url of data.urls) {
        try {
          // Already held, so a second download of the same unit costs nothing.
          if (await cache.match(url)) {
            stored += 1;
            continue;
          }
          const response = await fetch(url, { mode: 'no-cors' });
          if (response.ok || response.type === 'opaque') {
            await cache.put(url, response.clone());
            stored += 1;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
      }

      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'CACHE_URLS_DONE', stored, failed, requested: data.urls.length });
      }
    })()
  );
});
