/**
 * The Suspense boundary for the archive's routes.
 *
 * WHY THIS FILE IS NOT ONLY A LOADING STATE (rounds 196)
 *
 * Sixteen pages under `app/` are **async server components** that read the database. Without a Suspense
 * boundary above them, a throw while such a page renders happens *before* any HTML can be produced for the
 * shell — and React's rule is that the type of the thrown value decides who handles it:
 *
 *     a Promise is thrown   ->  Suspense handles it
 *     an Error is thrown    ->  an error boundary handles it
 *
 * An async server component that has not resolved throws a **Promise**, so with no Suspense there is nothing
 * to catch it, the shell render fails, **no HTML reaches the client, and `error.tsx` never gets a chance to
 * run.** The archive had no `loading.tsx` and no `<Suspense>` anywhere — so `app/error.tsx`, added in round
 * 194, was unreachable for every one of those sixteen routes.
 *
 * **A `loading.tsx` is the Suspense boundary Next.js creates around a segment.** That is its real job here;
 * the spinner is the visible half and the smaller half.
 *
 * WHAT IS STILL NOT VERIFIED
 *
 * That client-side boundaries render — the mechanism is documented and this file supplies the missing half,
 * but the measurement needs a browser, which rounds 194 and 195 did not have. **`curl` sees server HTML and
 * a client-rendered boundary is not in it.** What this round can say is that the missing boundary is no
 * longer missing.
 */
export default function Loading() {
  return (
    <div className="wrap section">
      <div className="notfound">
        <p className="eyebrow">Loading</p>
        <h1>Fetching the record</h1>
        <p className="lede">
          This page is being assembled from the archive. It will appear in a moment; nothing needs to be
          clicked.
        </p>
      </div>
    </div>
  );
}
