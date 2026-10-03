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
 */
import { NextResponse } from 'next/server';
import { buildPublication } from '@/lib/publication';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clean = slug.replace(/\.pdf$/i, '');
  const result = await buildPublication(clean);
  if (!result) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(result.pdf), {
    headers: {
      'content-type': 'application/pdf',
      // Inline, so a reader can look before deciding to keep it, with the filename offered either way.
      'content-disposition': `inline; filename="${clean}.pdf"`,
      'cache-control': 'public, max-age=3600',
    },
  });
}
