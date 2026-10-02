/**
 * The Suspense boundary for this application's routes.
 *
 * WHY THIS IS NOT ONLY A LOADING STATE (round 197)
 *
 * Checking which boundaries each app had found that this one — the dictionary, the site with the most
 * traffic, 49 async page components — has **none of the three**: no `loading.tsx`, no `error.tsx`, no
 * `not-found.tsx`, and no `<Suspense>` anywhere.
 *
 * React decides who handles a throw by the type of the value:
 *
 *     a Promise is thrown  ->  Suspense handles it
 *     an Error is thrown   ->  an error boundary handles it
 *
 * An async server component that has not resolved throws a **Promise**. With no Suspense above it there is
 * nothing to catch that, the shell render fails, **no HTML reaches the client, and an error boundary would
 * never be reached** — which is why this file comes first when three are missing, and why it is worth having
 * even while `error.tsx` does not yet exist here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   it invents no classes. `wrap` and `muted` are used in this application's own files and the spacing is an
 *   inline style, so this file cannot be the thing that introduces a selector nothing defines. **Guessing
 *   another site's CSS vocabulary is how a half-finished page ends up on a working site** (rounds 165, 178).
 *
 *   it claims nothing about visual design. A loading state that matches the dictionary's design should be
 *   drawn by whoever owns that design; this is the boundary, which is the part that is missing.
 */
export default function Loading() {
  return (
    <div className="wrap" style={{ paddingBlock: '4rem' }}>
      <p className="muted">Loading…</p>
    </div>
  );
}
