/**
 * Photographs — the image records the archive holds.
 *
 * FROM REAL RECORDS, AND SERVED FROM OUR OWN STORAGE
 *
 * The design's screen shows one sample card labelled "Sample record · source context required" with the
 * reference `OZ-PH-EXAMPLE`, and then a placeholder saying more records appear here. **The live archive holds
 * 3,462 image records**, so this page draws them.
 *
 * **The images are served from `/media/`, not hotlinked from the old WordPress site.** The old site does serve
 * them — round 214 found the 404s were unencoded spaces, not missing files — but serving an archive's own
 * holdings from a host we are migrating away from is the thing item 1 of the original plan exists to stop.
 * Files without a `storage_key` fall back to the recorded source address and are marked as such.
 *
 * WHAT THE DESIGN ASKS A PHOTOGRAPH RECORD TO CARRY, AND WHAT THIS SHOWS
 *
 * "Historic photographs are shown with date, place, holder and reuse status." The archive records a title,
 * alt text, a caption, a description, a reference (its WordPress id), a MIME type and dimensions, and — for
 * 3,488 of 3,488 rows — a source. **It does not record a holder or reuse terms per image**, so this page says
 * what it holds and does not invent the rest. Where a caption exists it is shown; where none does, the card
 * says so rather than being filled.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Photographs',
  description:
    'Image records from the Ozikoro archive, shown with their caption, reference and source. Historic photographs, digitised and served from the archive itself.',
  alternates: { canonical: 'https://ozikoro.com/photographs' },
  openGraph: {
    title: 'Photographs — Ozikoro',
    description: 'Image records from the archive.',
    type: 'website',
  },
};

const PAGE_SIZE = 60;

interface Row {
  slug: string;
  title: string | null;
  alt_text: string | null;
  caption: string | null;
  storage_key: string | null;
  source_url: string;
  wp_media_id: number | null;
}

export default async function PhotographsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const db = await getDb();
  const rows = await db.rows(
    `select slug, title, alt_text, caption, storage_key, source_url, wp_media_id
       from ozikoro_media
      where kind = 'image'
        and ($1 = '' or coalesce(title, '') ilike '%' || $1 || '%'
                      or coalesce(caption, '') ilike '%' || $1 || '%')
      order by wp_media_id
      limit $2 offset $3`,
    [query, PAGE_SIZE, offset]
  );

  const totalRow = await db.one<{ n: number }>(
    `select count(*)::int n from ozikoro_media
      where kind = 'image'
        and ($1 = '' or coalesce(title, '') ilike '%' || $1 || '%'
                      or coalesce(caption, '') ilike '%' || $1 || '%')`,
    [query]
  );
  const total = Number(totalRow?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const images = rows.map((r) => ({
    slug: String(r.slug),
    title: (r.title as string | null) ?? null,
    alt: (r.alt_text as string | null) ?? null,
    caption: (r.caption as string | null) ?? null,
    storageKey: (r.storage_key as string | null) ?? null,
    sourceUrl: String(r.source_url),
    reference: r.wp_media_id == null ? null : `OZ-PH-${r.wp_media_id}`,
  }));

  return (
    <>
      <section className="sx-collection-hero">
        <div className="wrap">
          <p className="eyebrow">Image records</p>
          <h1>Photographs</h1>
          <p className="lede">
            Historic photographs are shown with their caption, reference and source. Images are served
            from the archive itself rather than from the site being migrated away from.
          </p>
          <form className="search" method="get" action="/photographs">
            <label className="sr-only" htmlFor="q">
              Search photographs
            </label>
            <input id="q" name="q" type="search" defaultValue={query} placeholder="Search photographs" />
            <button className="btn btn-gold" type="submit">
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="wrap section">
        <nav className="sx-subnav" aria-label="Media collections">
          <Link href="/photographs">Photographs</Link>
          <Link href="/documents">Documents</Link>
          <Link href="/oral-recordings">Oral recordings</Link>
          <Link href="/material-culture">Material culture</Link>
        </nav>

        {images.length === 0 ? (
          <div className="empty section">
            <p className="eyebrow">Nothing filed</p>
            <h2>No photograph matches “{query}”.</h2>
            <p>
              The archive holds {total} image records and none matches that. It may be described
              differently in the records, or it may not be filed yet.
            </p>
            <p>
              <Link className="btn" href="/photographs">
                Show every photograph
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="sx-record-gallery">
              {images.map((image) => (
                <article key={image.slug}>
                  <div>
                    <small>Photograph</small>
                    <h2>{image.title ?? 'Untitled image record'}</h2>
                    {/* Served from our own storage where we hold the file; otherwise the recorded source,
                        marked so a reader knows the difference. */}
                    <img
                      src={image.storageKey ? `/media/${image.storageKey}` : image.sourceUrl}
                      alt={image.alt ?? image.caption ?? ''}
                      loading="lazy"
                      decoding="async"
                    />
                    <p>
                      {image.caption ?? (
                        <span className="unsourced">No caption is recorded for this image.</span>
                      )}
                    </p>
                    {image.reference ? (
                      <p>
                        <code>{image.reference}</code>
                        {image.storageKey ? (
                          <span className="muted"> · held by the archive</span>
                        ) : (
                          <span className="muted"> · not yet copied into the archive</span>
                        )}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <article className="sx-record-placeholder">
              <div>
                <small>Collection state</small>
                <h2>
                  {total} image records{query ? ` matching “${query}”` : ''}, showing{' '}
                  {offset + 1}–{offset + images.length}
                </h2>
                <p>
                  Pages of sixty. Reuse terms and holding institution are not recorded per image in the
                  archive, so they are not shown rather than being assumed.
                </p>
                <p>
                  {page > 1 ? (
                    <Link className="btn" href={`/photographs?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page - 1}`}>
                      ← Previous
                    </Link>
                  ) : null}{' '}
                  {page < pages ? (
                    <Link className="btn" href={`/photographs?${query ? `q=${encodeURIComponent(query)}&` : ''}page=${page + 1}`}>
                      Next →
                    </Link>
                  ) : null}
                </p>
              </div>
            </article>
          </>
        )}
      </section>
    </>
  );
}
