import Link from 'next/link';

/*
 * The 404, ported from the design's `404.html`.
 *
 * WHY THE COPY IS WHAT IT IS
 *
 * The design's four lines do the work a 404 has to do and are kept nearly verbatim, because each says
 * something a generic message does not:
 *
 *   "Either the entry has not been written yet, or the address has changed."
 *        **Not** "something went wrong". In an archive that is still being written, a missing entry is a
 *        normal state and often means the second thing — the entry exists and moved.
 *
 *   "Entries carry a reference number of the form OZ-H-0000."
 *        A citation that has rotted is a real reader problem, and this tells them the archive can fix it
 *        without them having to find the right page first.
 *
 * **The doors are the real top-level routes**, not the design's demonstration links — the design points at
 * `archive-index.html`, which in production is `/archive`.
 */
export default function NotFound() {
  return (
    <main className="wrap-narrow notfound">
      <p className="code">HTTP 404 — no entry at this address</p>
      <h1>This address does not resolve to an entry.</h1>
      <p className="lede">
        Either the entry has not been written yet, or the address has changed. Published entries stay at
        one address, and when that changes the archive keeps a record of where it went.
      </p>

      <form className="search" method="get" action="/search" role="search">
        <label className="skip" htmlFor="notfound-q">
          Search the archive
        </label>
        <input id="notfound-q" name="q" type="search" placeholder="Search the archive" />
        <button className="btn" type="submit">
          Search
        </button>
      </form>

      <div>
        <p className="eyebrow">Or start from a door</p>
        <ul className="stack">
          <li>
            <Link href="/archive">Browse the history archive by clan, town and period</Link>
          </li>
          <li>
            <Link href="/documents">The archive of documents, photographs and recordings</Link>
          </li>
          <li>
            <Link href="/researchers">Researchers and publications</Link>
          </li>
          <li>
            <Link href="/about">About Ozi Ikoro Limited</Link>
          </li>
        </ul>
      </div>

      {/* The three connected sites, which the design draws as doors of their own. */}
      <div>
        <p className="eyebrow">The three sites</p>
        <ul className="stack">
          <li>
            <Link href="/">ozikoro.com — archive &amp; research</Link>
          </li>
          <li>
            <a href="https://ozituma.com/">ozituma.com — dictionary</a>
          </li>
          <li>
            <Link href="/academy/">Academy — Learn Igbo</Link>
          </li>
        </ul>
      </div>

      <div className="provenance">
        <p className="eyebrow">Citing something that has moved</p>
        <p className="small">
          Entries carry a reference number of the form <span className="mono">OZ-H-0000</span>. If you have
          the reference from a citation, quote it and the archive will supply the current address rather than
          leaving you to search.
        </p>
        <p>
          <Link className="btn btn-quiet btn-sm" href="/about#contact">
            Report a broken citation
          </Link>
        </p>
      </div>
    </main>
  );
}
