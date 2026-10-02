'use client';

/**
 * A screen for a page that failed.
 *
 * WHY IT IS MINIMAL (rounds 197-199)
 *
 * This application had no error boundary, and with no `loading.tsx` either there was no Suspense boundary
 * above its 49 async page components — so a throw during their render fails the shell before any HTML can be
 * produced. Round 198 added the loading boundary; this is the boundary it makes reachable.
 *
 * The same rule as that file: **only classes that appear in this application's own files**, and spacing as
 * inline styles.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   it does not show `error.message` — an exception's text can carry a query, a path or a fragment of a
 *   record, and `error.digest` is the identifier the server log also has
 *   it does not claim the entry is missing — **an error is not a 404**, and saying so would state something
 *   this site does not know
 *   it is not an attempt at the dictionary's error design
 */
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[web] page error', error.digest ?? '(no digest)', error);
  }, [error]);

  return (
    <div className="wrap" style={{ paddingBlock: '4rem' }}>
      <p className="muted">Error</p>
      <h1>This page could not be loaded</h1>
      <p className="muted">
        Something went wrong while assembling this page, so it is not shown rather than shown incomplete.
        The dictionary itself has not been changed.
      </p>
      <p style={{ marginTop: '1.5rem' }}>
        <button className="btn" onClick={reset} type="button">
          Try again
        </button>
      </p>
      {error.digest ? (
        <p className="muted" style={{ marginTop: '1.5rem' }}>
          Reference <code>{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}
