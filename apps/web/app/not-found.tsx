/**
 * 404 for the dictionary.
 *
 * WHY IT IS MINIMAL (rounds 197-199)
 *
 * This application had no `not-found.tsx`, so a mistyped address on a site with 53 routes drew the
 * framework's page rather than the dictionary's. Round 198 added `loading.tsx` here under one rule: **use
 * only classes that appear in this application's own files**, so the new file cannot be the thing that
 * introduces a selector nothing defines. The same rule holds here — `wrap` and `muted` are used elsewhere in
 * `apps/web/app`, and the spacing is an inline style.
 *
 * **It is not an attempt at the dictionary's 404 design.** That belongs to whoever owns this site's design;
 * this is a correct, quiet page with a way back, which is what was missing. Nothing here claims to be more.
 */
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap" style={{ paddingBlock: '4rem' }}>
      <p className="muted">404</p>
      <h1>No entry at this address</h1>
      <p className="muted">
        The dictionary has no page here. The address may be misspelled, or it may belong to the other
        Ozikoro sites rather than to this one.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <Link href="/">Search the dictionary</Link>
      </p>
    </div>
  );
}
