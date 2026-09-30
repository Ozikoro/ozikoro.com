'use client';

import { useCallback, useEffect, useState } from 'react';
import { clearQueue, queueAvailable, readQueue, syncQueue } from '@/lib/offline-queue';

/**
 * Registers the service worker, reports the connection, and drains the offline queue.
 *
 * WHY THE SYNC IS DRIVEN FROM HERE AND NOT FROM A BACKGROUND SYNC API
 *
 * The Background Sync API would let the browser retry with the app closed, which is genuinely
 * better — and it is not available in Safari on iOS, which §13 names as a supported target. A
 * feature that works on two of four named browsers, invisibly, is worse than one that works
 * everywhere while the app is open. The queue survives the app being closed either way, because it
 * is in `localStorage`; what is lost is only the retry while closed.
 *
 * `online` IS NOT TRUSTED ALONE
 *
 * The event fires when the browser thinks it has a connection, which on Nigerian mobile networks is
 * frequently while nothing is actually reachable. So the sync also runs on becoming visible and on
 * load, and a failed sync simply leaves the queue where it was — the cost of trying is one request.
 */
export function PwaRegister({ signedIn }: { signedIn: boolean }) {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [storageWorks, setStorageWorks] = useState(true);

  const sync = useCallback(async () => {
    const pending = readQueue().length;
    if (pending === 0) return;

    const result = await syncQueue();
    setQueued(result.remaining);

    if (result.sent > 0) {
      setNote(
        `${result.sent} offline review${result.sent === 1 ? '' : 's'} synced.`
      );
      // Nothing else announces it, and a learner who answered offline deserves to know it landed.
      window.setTimeout(() => setNote(null), 6000);
    } else if (result.reasons.length > 0) {
      // A refusal, not a network problem. Said plainly so it does not read as a lost action.
      setNote(result.reasons[0] ?? null);
    }
  }, []);

  /*
   * Clear the queue when the session ends.
   *
   * The queue is one account's data held on a shared device. Leaving it behind would show the next
   * person a count of somebody else's unsent reviews — and, worse, the sync would send them under
   * whichever account signs in next.
   *
   * Driven by the session the layout already read, not by intercepting the sign-out form: the form
   * posts and redirects on the server, so there is no client-side moment to hook, and a second
   * mechanism watching for the same event is a second mechanism to get out of step.
   */
  useEffect(() => {
    if (!signedIn) {
      clearQueue();
      setQueued(0);
    }
  }, [signedIn]);

  useEffect(() => {
    setStorageWorks(queueAvailable());
    setOnline(navigator.onLine);
    setQueued(readQueue().length);

    /*
     * Register, and tell the browser never to serve the worker itself from the HTTP cache.
     *
     * WHY THIS AND NOT A CACHE-CONTROL HEADER
     *
     * The header was tried first and does not hold here. The origin sets it, and Cloudflare's
     * Browser Cache TTL — four hours by default — REWRITES the browser-facing `Cache-Control`
     * whatever the origin said. Measured on the deployed site: `/sw.js` came back as
     * `max-age=14400, must-revalidate` rather than the `no-cache` that was configured, and the icons
     * showed the same four hours. Fixing that properly means a Cloudflare cache rule, which is
     * another project's configuration and another project's credential.
     *
     * `updateViaCache: 'none'` is the mechanism that does not depend on any of that. It is a
     * browser-side instruction: the worker script is always revalidated with the server rather than
     * taken from the HTTP cache, so a stale worker cannot outlive a deploy no matter what the CDN
     * says about caching.
     *
     * Registration itself is best-effort. A browser without service workers — or a page served over
     * plain HTTP, where they are refused — should still be a working site, just without offline
     * support.
     */
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined);
    }

    const goOnline = () => {
      setOnline(true);
      void sync();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);

    // Once on load, because a learner may have closed the tab with reviews queued and reopened it
    // with a connection that was never lost — so no `online` event ever fires.
    void sync();

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sync]);

  // Nothing to say and nothing to warn about. Rendered as nothing rather than an empty div, so it
  // cannot affect layout.
  if (online && queued === 0 && note === null && storageWorks) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '0.8rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        maxWidth: 'min(92vw, 30rem)',
        padding: '0.55rem 0.9rem',
        borderRadius: 'var(--radius)',
        background: 'var(--ink)',
        color: 'var(--paper)',
        fontSize: '0.86rem',
        boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
      }}
    >
      {!online ? (
        <span>
          Offline. You can keep reviewing — answers are saved on this device and sent when you
          reconnect.
        </span>
      ) : !storageWorks ? (
        // Said plainly rather than silently dropping replies, which is what private mode would
        // otherwise do.
        <span>
          This browser is not saving anything locally, so answers given offline cannot be kept. Your
          online progress is unaffected.
        </span>
      ) : note !== null ? (
        <span>{note}</span>
      ) : (
        <span>
          {queued} review{queued === 1 ? '' : 's'} waiting to sync.
        </span>
      )}
    </div>
  );
}
