/**
 * `/document-viewer/` — one document the archive holds, read in the page.
 *
 * ── WHY THIS IS AN APPLICATION ROUTE AND NOT THE DELIVERABLE'S SCREEN, WHICH IS A DECISION ────────────
 *
 * The design ships `screens/document-viewer.html` and the archive serves it, because the deliverable is the
 * specification and a screen served by a second implementation is a screen that drifts from it. **That rule
 * has one exception, and this screen is it: the design's viewer carries no archive content and cannot be
 * given any.**
 *
 * What it carries, read from the file: a *demonstration* record — reference `OZ-P-2026-0041`, "Journal
 * article", "CC BY 4.0", attributed to two invented authors — beside an `<object>` whose only address is
 * `../downloads/research-download-demonstration.pdf`, a demonstration PDF that sits in the deliverable and is
 * not an archive document. That address does not even resolve from this screen: `designScreenLinks` rewrites
 * the screen's `href`s to `/design/downloads/…`, and the `<object>`'s `data` is left as written, so a browser
 * resolves it against `/document-viewer/` to `/downloads/research-download-demonstration.pdf`, which does not
 * exist. **So a reader who reached the served screen got a fabricated citation with a Download button, and no
 * preview at all** — the brief's own prohibition, that a demonstration must not be what a reader gets.
 *
 * The design cannot be filled either: a `document-viewer.html` is one record's chrome and the deliverable has
 * no way to say *which* record. **So this route takes the record from its address (`?doc=<slug>`) and frames
 * the file the archive actually holds.** The design file is untouched in `public/design/` and its own copy is
 * still served for design work at `/design-screen/document-viewer`.
 *
 * ── NO DOCUMENT IS NOT A DEMONSTRATION ───────────────────────────────────────────────────────────────
 *
 * A viewer with no document says so, and offers the library. **It never falls back to the deliverable's
 * demonstration PDF, and never invents a reference, an author or a licence** — an empty state is a real state.
 * The same is true when the address names a record the archive does not hold, or holds without a file.
 *
 * ── THE PREVIEW IS AN `<iframe>` BECAUSE THE POLICY FORBIDS AN `<object>` ─────────────────────────────
 *
 * Measured in Chrome: `object-src 'none'` on every HTML page refuses the browser's PDF viewer outright, while
 * `frame-src 'self'` is already open and `/media/…pdf` is served with `frame-ancestors 'self'` and
 * `X-Frame-Options: SAMEORIGIN`. So the document renders in a frame and no security header was relaxed. See
 * the same note on the record page, `app/documents/[slug]/page.tsx`.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  getMediaBySlug, humanBytes, mediaName, MEDIA_KIND_LABEL as KIND_LABEL,
} from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Document viewer',
  description: 'Read a document the Ozikoro archive holds, in the page, and download its file.',
  /*
   * ⚠️ THIS DIRECTIVE IS ABOUT *THIS* PAGE, AND IT USED TO CLAIM THE RECORD PAGES SHARED IT.
   *
   * It read: *"The record pages are `noindex, follow` for the same reason: a record is an archive entry
   * rather than a landing page."* **The record pages are `index` as of 2026-10-09**, because
   * `packages/ozikoro/src/seo.ts` lists every media record in a sitemap (`/sitemap/photographs` and
   * `/sitemap/media`) and a sitemap URL carrying `noindex` is a defect rather than a crawl instruction.
   * See the note on `apps/ozikoro/app/documents/[slug]/page.tsx`.
   *
   * THE REASON BELOW IS STILL TRUE OF THE VIEWER AND ONLY OF THE VIEWER: it takes its record from
   * `?doc=<slug>`, so one record has as many addresses here as there are spellings of its slug. That is
   * a page a crawler has to choose between, and it has no address of its own to be listed at.
   */
  robots: { index: false, follow: true },
};

export default async function DocumentViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const params = await searchParams;
  const requested = (params.doc ?? '').trim();

  const db = await getDb();
  const record = requested ? await getMediaBySlug(db, requested) : null;

  /*
   * WHAT CAN BE SHOWN, AND WHY THE TEST IS THIS ONE. A document is viewable when the archive holds the file
   * (`url`, which is only ever the archive's own `/media/…` address) and the file is a PDF, or when the record
   * does not state a media type at all — the migration left some rows without one, and the extension of the
   * stored key is what `the media route` serves them as. A saved web page filed as a document is not viewable
   * and is not offered as though it were.
   */
  const viewable = record
    && record.kind === 'document'
    && record.url
    && (record.mimeType === null || record.mimeType === 'application/pdf')
    ? record
    : null;

  if (viewable) {
    const named = mediaName(viewable);
    return (
      <div className="wrap section">
        <p className="eyebrow">
          <Link href="/documents">Documents</Link> · {KIND_LABEL[viewable.kind] ?? viewable.kind}
          {viewable.reference ? <> · <span className="mono">{viewable.reference}</span></> : null}
        </p>
        <h1>{named.name}</h1>

        <div className="section">
          <iframe
            src={viewable.url!}
            title={viewable.altText ?? named.name}
            style={{ width: '100%', height: '80vh', border: '1px solid rgba(0,0,0,.08)' }}
          />
          <p className="small muted">
            If the document does not appear above, this browser cannot show a PDF inside the page. The
            download button serves the same file.
          </p>
          <p className="small">
            <a className="btn" href={viewable.url!} download>
              Download document{viewable.filesizeBytes ? ` (${humanBytes(viewable.filesizeBytes)})` : ''}
            </a>{' '}
            <Link className="btn btn-quiet" href={`/documents/${viewable.slug}/`}>
              Record and citation
            </Link>
          </p>
        </div>

        {/*
          THE RIGHTS SENTENCE IS THE RECORD'S OWN, AND IT SAYS WHEN NOTHING IS RECORDED. The design's viewer
          states "CC BY 4.0" for every document it draws; that is the one thing this page must never copy from
          it, because a licence the archive does not hold is a permission it cannot give.
        */}
        <p className="small muted">
          {viewable.licence || viewable.rightsNote
            ? `Rights: ${viewable.licence ?? viewable.rightsNote}. Check them before reuse.`
            : 'No rights statement is recorded against this document, so permission has not been established either way. Write to the archive before republishing it.'}
        </p>
      </div>
    );
  }

  /*
   * ── THE HONEST EMPTY STATE, IN THREE SHAPES ─────────────────────────────────────────────────────────
   *
   * They are told apart because a reader needs different things from each: an address with no document named
   * needs the library; an address naming something the archive does not hold needs to be told the address is
   * wrong; and an address naming a record it does hold without a file needs the record, which is still a real
   * catalogue entry even though nothing can be shown.
   *
   * **NONE OF THE THREE RENDERS A PDF, AND NONE OF THEM INVENTS ONE.**
   */
  const reason = !requested
    ? 'No document is named in this address, so there is nothing to show.'
    : record
      ? `The archive holds a record at “${requested}”, but it is not a document it can show — ${
          record.kind === 'document' && !record.held
            ? 'the file is no longer available, so only its catalogue entry remains.'
            : 'either it is not a PDF or the file was never brought across into the archive.'
        }`
      : `No record in the archive answers to “${requested}”, so there is no document here to show.`;

  return (
    <div className="wrap section">
      <p className="eyebrow">Document viewer</p>
      <h1>Nothing is open in the viewer.</h1>
      <p>{reason}</p>
      <p>
        The archive&rsquo;s documents are listed in the{' '}
        <Link href="/documents">document library</Link>, and each one opens with its PDF already in the page
        on its own record. This address exists so a document can be linked to directly: a document&rsquo;s
        record address with <span className="mono">?doc=&lt;slug&gt;</span> opens it here.
      </p>
      {record ? (
        <p>
          <Link className="btn btn-quiet" href={`/documents/${record.slug}/`}>
            Open the record for {mediaName(record).name}
          </Link>
        </p>
      ) : null}
      <p className="small muted">
        Nothing is shown in the place of a document. The design deliverable&rsquo;s demonstration PDF is not
        an archive document and is never served from this page.
      </p>
    </div>
  );
}
