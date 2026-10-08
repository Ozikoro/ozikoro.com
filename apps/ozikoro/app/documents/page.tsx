/**
 * Documents — the research and document library, built to the design's `screens/documents.html`.
 *
 * WHY IT WAS REWRITTEN
 *
 * `check-design-parity.mjs` reported the design's whole skeleton missing: `sx-document-hero` and both
 * `sx-library-section` blocks, with the h1 reading "Published work, ready to read." This page had a different
 * title and none of the structure.
 *
 * AND WHAT THE SAME H1 BECAME. The owner asked for that heading to be removed — *"the title is wrong"* — and
 * it was a slogan rather than a name: read from the deliverable, `/photographs/` is headed "Photographs",
 * `/archive/` "Histories" and `/publications/` "Publications", so `documents.html` was the one screen that
 * sold the page instead of naming it. The served `<h1>` is now "Documents", rewritten at serve time in
 * `fillDocuments` because `public/design/` is inviolable.
 *
 * ⚠️ **AND THIS FILE'S OWN `<h1>` IS NOT WHAT A READER MEETS.** `/documents/` is in the middleware's own
 * screen set, so it is rewritten to `/design-screen/documents` and the hero a reader receives is the
 * deliverable's. The `<h1>` and the `openGraph` description below are corrected rather than left carrying
 * the withdrawn slogan — a stale slogan in the tree is how it comes back — but **the head that is served is
 * built by the design-screen route**, which is where that line has to be checked.
 *
 * WHAT THE LIBRARY ACTUALLY HOLDS, WHICH IS NOT WHAT THE WORD SUGGESTS
 *
 * Twelve media records are filed as documents. **Only two are PDFs.** The other ten are `text/html` captures
 * of web pages — Alamy stock-photo listings and a British Museum object page — because the WordPress library
 * had filed them as attachments. **They are not documents and this page does not present them as such.** The
 * grid shows the two PDFs; the ten HTML captures are excluded, and the page says how many and why, because a
 * reader counting the archive's holdings should be able to see the difference between a document and a
 * scraped web page.
 *
 * AND THERE ARE NO PUBLICATIONS AT ALL
 *
 * The design's first library section is researcher publications. `ozikoro_publication` holds zero rows, so the
 * section states that plainly rather than rendering an empty list. **The design itself is honest in the same
 * place** — its source note reads "Download buttons currently provide clearly labelled demonstration PDFs.
 * Approved publication [records will replace them]" — and the two PDFs here are exactly those demonstration
 * files. They are labelled as demonstration files and are not presented as published research.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Documents',
  description:
    'Download open research by Ozikoro contributors and browse the PDF records the archive holds. Restricted work is marked.',
  alternates: { canonical: 'https://ozikoro.com/documents' },
  /*
   * THE SLOGAN DOES NOT COME BACK THROUGH THE CARD.
   *
   * The headline the owner asked to have removed was `Published work, ready to read.`, and it was doing
   * double duty: this line put the same words into the Open Graph card, where they are the ONLY description
   * a reader sees when the page is shared — and the page itself had no publication at all. *"Remove this,
   * the title is wrong"* is not answered by taking the words off the page and leaving them on the card that
   * advertises it. The on-page `<h1>` is rewritten at serve time (`fillDocuments`, because the deliverable is
   * inviolable); this is the head of the same page and it is this file's own to correct.
   */
  openGraph: {
    title: 'Documents — Ozikoro',
    description:
      'PDF records the archive holds and open research by Ozikoro contributors, with the rights recorded against each one.',
    type: 'website',
  },
};

interface Doc {
  slug: string;
  title: string | null;
  mime_type: string | null;
  storage_key: string | null;
  source_url: string;
  filesize_bytes: number | null;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const view = params.view ?? 'all';

  const db = await getDb();

  // Only real documents. The HTML captures are counted separately and named below.
  const pdfs = await db.rows<Doc>(
    `select slug, title, mime_type, storage_key, source_url, filesize_bytes
       from ozikoro_media
      where kind = 'document' and mime_type = 'application/pdf'
        and ($1 = '' or coalesce(title,'') ilike '%' || $1 || '%')
      order by title`,
    [query]
  );
  const htmlCaptures = await db.one<{ n: number }>(
    `select count(*)::int n from ozikoro_media where kind='document' and mime_type <> 'application/pdf'`
  );
  const publications = await db.one<{ n: number }>(
    `select count(*)::int n from ozikoro_publication where status = 'published'`
  );
  const nCaptures = htmlCaptures?.n ?? 0;
  const nPublications = publications?.n ?? 0;

  const kb = (b: number | null) => (b && b > 0 ? `${Math.max(1, Math.round(b / 1024))} KB` : null);

  return (
    <main>
      <section className="sx-document-hero">
        <div className="wrap">
          <p className="eyebrow">Research &amp; document library</p>
          <h1>Documents</h1>
          <p className="lede">
            Download open research by Ozikoro contributors and browse the PDF records the archive holds.
            Restricted work is marked, and nothing here is presented as peer-reviewed unless that review
            actually happened.
          </p>
          <form className="search" method="get" action="/documents">
            <label className="sr-only" htmlFor="q">
              Search documents
            </label>
            <input id="q" name="q" type="search" defaultValue={query} placeholder="Search documents" />
            <button className="btn btn-gold" type="submit">
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="wrap section">
        <div className="sx-document-toolbar">
          <nav aria-label="Document views">
            <Link href="/documents" aria-current={view === 'all' ? 'true' : undefined}>
              All documents
            </Link>
            <Link href="/publications">Research papers</Link>
            <Link href="/documents?view=pdf">PDFs</Link>
            <Link href="/documents?view=restricted">Restricted</Link>
          </nav>
          <form method="get" action="/documents">
            <label htmlFor="sort">
              Sort
              <select id="sort" name="sort" defaultValue="title">
                <option value="title">Title A–Z</option>
                <option value="date">Newest first</option>
              </select>
            </label>
            <button className="btn btn-quiet" type="submit">
              Apply
            </button>
          </form>
        </div>

        {/* --- researcher publications ------------------------------------- */}
        <section className="sx-library-section">
          <div className="sx-head">
            <div>
              <p className="eyebrow">Deposited by researchers</p>
              <h2>Researcher publications</h2>
            </div>
            <span className="small muted">{nPublications} published</span>
          </div>
          {nPublications === 0 ? (
            <div className="empty">
              <p>
                No publication has been deposited yet. A paper appears here once it has been submitted,
                screened and published through the archive&rsquo;s review, with its version history and its
                access terms recorded.
              </p>
              <p>
                <Link className="btn" href="/submit">
                  Deposit a paper
                </Link>
              </p>
            </div>
          ) : null}
        </section>

        {/* --- reports, catalogues and source guides ----------------------- */}
        <section className="sx-library-section">
          <div className="sx-head">
            <div>
              <p className="eyebrow">Other PDFs</p>
              <h2>Reports, catalogues and source guides</h2>
            </div>
            <span className="small muted">{pdfs.length} PDF records</span>
          </div>

          {pdfs.length === 0 ? (
            <div className="empty">
              <p>No PDF matches “{query}”.</p>
            </div>
          ) : (
            <div className="sx-pdf-grid">
              {pdfs.map((doc) => (
                <article key={doc.slug}>
                  <span className="small muted">PDF{kb(doc.filesize_bytes) ? ` · ${kb(doc.filesize_bytes)}` : ''}</span>
                  <h3>{doc.title ?? 'Untitled document'}</h3>
                  {/* The design labels these as demonstration files and so does this page. */}
                  <p className="small muted">
                    Demonstration file held by the archive, not an approved publication.
                  </p>
                  <a className="btn" href={doc.storage_key ? `/media/${doc.storage_key}` : doc.source_url}>
                    Download
                  </a>
                </article>
              ))}
            </div>
          )}

          {nCaptures > 0 ? (
            <p className="muted small">
              {nCaptures} further attachment{nCaptures === 1 ? '' : 's'} in the library{' '}
              {nCaptures === 1 ? 'is' : 'are'} not listed here. They are <code>text/html</code> captures of web
              pages — stock-photograph listings and a museum object page — filed as attachments by the site
              this archive was migrated from. A captured web page is not a document, so it is counted and not
              presented as one.
            </p>
          ) : null}
        </section>

        <p className="sx-source-note sx-light-note">
          Approved publication records will replace the demonstration files as they are deposited. Nothing in
          this library has been marked peer-reviewed, because no review has taken place.
        </p>
      </section>
    </main>
  );
}
