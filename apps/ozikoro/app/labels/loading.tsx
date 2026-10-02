/**
 * Segment-level Suspense boundary for the label routes (rounds 200-201).
 *
 * Round 196 put this at `app/loading.tsx`, which wrapped the ROOT segment's children — **including the
 * not-found rendering** — so Next began streaming the shell and committed `200 OK` before it knew a route
 * had not matched, and every unmatched address returned 200 instead of 404. Round 200 reverted it.
 *
 * **This one is inside a route segment**, so it wraps that segment's page and nothing else. The status of an
 * unmatched address is decided before this boundary is entered, which is the property the root-level file
 * broke.
 *
 * It is added to ONE route first on purpose: round 200's lesson is that a boundary's effect is measured
 * rather than assumed.
 */
export default function Loading() {
  return (
    <div className="wrap section">
      <div className="notfound">
        <p className="eyebrow">Loading</p>
        <h1>Fetching the subjects</h1>
        <p className="lede">This list is being assembled from the archive.</p>
      </div>
    </div>
  );
}
