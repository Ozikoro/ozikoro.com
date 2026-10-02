'use client';

/**
 * A screen for a page that failed, rather than the framework's.
 *
 * WHY THIS EXISTS (round 194)
 *
 * `not-found.tsx` has drawn a designed 404 since the design was copied in, and there was **no error
 * boundary at all** — so an unexpected failure produced Next.js's own unstyled screen while a missing
 * address produced a page in the archive's own voice. A reader cannot tell those two apart, and the design
 * brief treats empty and partial states as real screens.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   it does not show `error.message`. An exception's text can carry a query, a path or a fragment of a
 *   record, and a reader has no use for it. `error.digest` is the identifier a server log also has, so that
 *   is what is shown — enough for somebody to find the occurrence, and nothing that leaks a record.
 *
 *   it does not say the record is missing. **An error is not a 404**, and telling a reader a history does
 *   not exist because a query failed would be this archive stating something it does not know. The wording
 *   distinguishes the two on purpose.
 *
 * WHY IT IS A CLIENT COMPONENT
 *
 * Next.js requires error boundaries to be, because recovery happens in the browser. This is the only
 * `'use client'` file under `app/` that is not a form or an interactive control.
 */
import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Reported once per failure so it reaches the server log with the same digest the reader is shown.
  useEffect(() => {
    console.error('[ozikoro] page error', error.digest ?? '(no digest)', error);
  }, [error]);

  return (
    <div className="wrap section">
      <div className="notfound">
        <p className="eyebrow">Error</p>
        <h1>This page could not be loaded</h1>
        <p className="lede">
          Something went wrong while assembling this page, so it is not shown rather than shown
          incomplete. The record itself has not been changed, and most pages will be unaffected.
        </p>
        <p className="row" style={{ marginTop: 'var(--s-5)' }}>
          <button className="btn btn-ink" onClick={reset} type="button">
            Try again
          </button>
          <Link className="btn btn-quiet" href="/archive">
            Browse the archive
          </Link>
        </p>
        {error.digest ? (
          <p className="small muted" style={{ marginTop: 'var(--s-5)' }}>
            Reference <code>{error.digest}</code> — quoting it helps us find what happened.
          </p>
        ) : null}
      </div>
    </div>
  );
}
