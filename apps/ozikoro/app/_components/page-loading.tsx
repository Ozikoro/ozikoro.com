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
 */
export default function PageLoading() {
  return (
    <div className="wrap section">
      <div className="notfound">
        <p className="eyebrow">Loading</p>
        <h1>Fetching the record</h1>
        <p className="lede">
          This page is being assembled from the archive. It will appear in a moment.
        </p>
      </div>
    </div>
  );
}
