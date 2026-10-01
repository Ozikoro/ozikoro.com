/**
 * 404.
 *
 * The design draws a 404 rather than leaving one to the framework, and the brief treats empty and
 * partial states as real screens. A reader who followed a link from an old address and landed here
 * should be told what happened and given a way back into the record, not shown a bare "Not Found".
 */
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="wrap section">
      <div className="notfound">
        <p className="eyebrow">404</p>
        <h1>No record at this address</h1>
        <p className="lede">
          The archive holds {`the histories of Igbo and African peoples`}, and this address is not one
          of them. If you arrived from a link to the previous Ozikoro site, the record may have been
          renamed or may never have existed at this spelling.
        </p>
        <p className="row" style={{ marginTop: 'var(--s-5)' }}>
          <Link className="btn btn-ink" href="/archive">
            Browse the archive
          </Link>
          <Link className="btn btn-quiet" href="/search">
            Search
          </Link>
        </p>
      </div>
    </div>
  );
}
