/**
 * The archive's segment loading state, shared by the per-route `loading.tsx` files.
 *
 * Rounds 200 and 201 established the placement rule the hard way. A `loading.tsx` at `app/` wraps the root
 * segment's children **including the not-found rendering**, so Next streams the shell and commits `200 OK`
 * before it knows a route did not match — every unmatched address returned 200 instead of 404. A file inside
 * a **route segment** wraps that segment's page and nothing else, so the status is decided before the boundary
 * is entered and an error boundary is reachable without the status breaking.
 *
 * **Each route re-exports this rather than repeating it**, so the wording and the design classes live in one
 * place, which is the same reason the design itself is linked rather than copied.
 *
 * It is deliberately plain: a segment loading state is a courtesy while a database read completes, not a
 * designed screen. The 404 and error pages are the ones written in the archive's voice.
 *
 * WHY THERE IS NO `<h1>` HERE, WHICH IS A FIX AND NOT A TIDY-UP
 *
 * This used to render `<h1>Fetching the record</h1>`. Next wraps a page that has a `loading.tsx` in a
 * Suspense boundary, so the fallback is flushed in the streamed shell before the page's own content — and
 * **that placeholder `<h1>` arrives before the page's real heading, so any reader that takes the first
 * heading gets the fallback.** Measured on the running site: `/admin/claims` and `/admin/rights` served
 * `h1 "Fetching the record"` with the real heading further down, and both looked like pages stuck loading
 * when they had in fact rendered.
 *
 * The remedy is not a better fallback heading. **A loading state is not the page and must not claim to be**,
 * because there is no wording that is true of every route it stands in front of — `/admin/reviews`, `/search`
 * and `/signin` have nothing in common for it to describe. So it announces itself as a status and leaves the
 * heading to the page that owns it.
 */
export default function PageLoading() {
  return (
    <div className="wrap section" role="status" aria-live="polite">
      <div className="notfound">
        <p className="eyebrow">Loading</p>
        <p className="lede">
          This page is being assembled from the archive. It will appear in a moment.
        </p>
      </div>
    </div>
  );
}
