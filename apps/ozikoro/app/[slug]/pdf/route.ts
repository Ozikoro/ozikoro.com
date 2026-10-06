/**
 * Download an article as a publication.
 *
 * WHAT A READER GETS
 *
 * **A real document, not a screenshot of a page.** It is A4, typeset, with a cover, running heads, page numbers
 * and a references section — **and every word is selectable text**, so it can be searched, copied and read by a
 * screen reader, and it does not turn to mush when zoomed.
 *
 * AND WHAT IT WILL NOT DO
 *
 * **It renders and does not edit.** The article's own title, its own paragraphs, its own captions and its own
 * references go in. Where the archive holds no subtitle, no biography or no featured image, **that part of the
 * page is designed away rather than filled with something invented.**
 *
 * ── BUILT ON THE FIRST CLICK AND KEPT AFTER IT ──────────────────────────────────────────────────────
 *
 * The owner's choice was "generated on demand when clicked", and the document is still built on demand — but
 * it is built **once**. Before this, every click re-rendered the whole publication: the body, the figures,
 * the references, the embedded fonts and the logo. Now the first click renders it and stores it, and every
 * later reader is served the bytes. See `lib/publication-cache.ts` for where it is kept, and for why it is
 * kept in the archive's own object storage rather than as a row in `ozikoro_media`.
 *
 * `x-ozikoro-publication` reports which happened. It is a diagnostic and not a promise a reader depends on:
 * the response is the same document either way, and a cache that is unreachable degrades to building.
 */
import { NextResponse } from 'next/server';
import { publicationFor } from '@/lib/publication-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clean = slug.replace(/\.pdf$/i, '');
  const result = await publicationFor(clean);
  if (!result) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      'content-type': 'application/pdf',
      // Stated, so the browser can show a progress bar against a real length rather than an open-ended wait.
      'content-length': String(result.pdf.length),
      // Inline, so a reader can look before deciding to keep it, with the filename offered either way.
      'content-disposition': `inline; filename="${clean}.pdf"`,
      /*
       * AN HOUR, AND NOT A YEAR. The document is immutable at its key, but this address is not the key: the
       * record can be edited and the address must then serve the new document. A year-long header here would
       * be a promise this route cannot keep, and the key is where the immutable cache belongs.
       */
      'cache-control': 'public, max-age=3600',
      'x-ozikoro-publication': result.source,
    },
  });
}
