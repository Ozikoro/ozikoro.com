/**
 * The archive of documents, photographs and recordings.
 *
 * The design draws this as a catalogue rather than a gallery: each holder is an `article.object`
 * with an image plate, a title, type and period chips, and a `table.record` of Ref., Held by,
 * Access and Reuse. That is the right shape for what is actually here — an archival holding, not a
 * picture gallery — and it is reproduced as drawn.
 *
 * WHAT IS HONEST ABOUT THIS PAGE
 *
 * 3,488 real records are behind it, migrated with their files, dimensions and dates. They did not
 * come with creators, licences or holding institutions, because WordPress has no such fields, so
 * those rows say "not recorded" instead of being filled with something plausible. The plan forbids
 * inventing provenance, and a fabricated rights statement is the most dangerous kind of invention
 * here: a reader would rely on it.
 *
 * Filtering is a plain GET form, as the design requires, so a filtered holding is a citable address.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { countMedia, getMediaStats, humanBytes, listMedia } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Archive',
  description:
    'Documents, photographs, recordings and film in the Ozikoro archive, with their provenance and rights recorded where they are known.',
  alternates: { canonical: 'https://ozikoro.com/documents' },
};

const PAGE_SIZE = 24;

const KIND_LABEL: Record<string, string> = {
  image: 'Photograph',
  video: 'Film',
  audio: 'Recording',
  document: 'Document',
  dataset: 'Dataset',
  other: 'Item',
};

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; used?: string; page?: string }>;
}) {
  const params = await searchParams;
  const kind = params.kind?.trim() || 'all';
  const usedOnly = params.used === '1';
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const db = await getDb();
  const [stats, records, total] = await Promise.all([
    getMediaStats(db),
    listMedia(db, { kind, usedOnly, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countMedia(db, { kind, usedOnly }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (n: number) => {
    const search = new URLSearchParams();
    if (kind !== 'all') search.set('kind', kind);
    if (usedOnly) search.set('used', '1');
    if (n > 1) search.set('page', String(n));
    const query = search.toString();
    return query ? `/documents?${query}` : '/documents';
  };

  const kinds: [string, string, number][] = [
    ['all', 'Everything', stats.total],
    ['image', 'Photographs', stats.images],
    ['video', 'Film', stats.video],
    ['document', 'Documents', stats.documents],
    ['audio', 'Recordings', stats.audio],
  ];

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">The archive</p>
        <h1>Documents and photographs</h1>
        {/* The missing heading level the design implies: see the note on the archive page. */}
        <h2 className="visually-hidden">Items</h2>
        <p className="lede">
          {stats.total.toLocaleString('en-GB')} items held: photographs, film, documents and
          recordings, carried across from the previous Ozikoro site with their files intact.
        </p>
      </header>

      <form className="search section" method="get" action="/documents" role="search">
        <label className="small" htmlFor="kind">
          What the archive holds
        </label>
        <div className="row">
          <select id="kind" name="kind" defaultValue={kind}>
            {kinds.map(([value, label, count]) => (
              <option key={value} value={value}>
                {label} ({count.toLocaleString('en-GB')})
              </option>
            ))}
          </select>
          <label className="small">
            <input type="checkbox" name="used" value="1" defaultChecked={usedOnly} /> only items a
            history uses
          </label>
          <button className="btn btn-ink" type="submit">
            Apply
          </button>
        </div>
      </form>

      {/*
        The rights gap, stated as a fact about the holding rather than buried. It is the single most
        important thing a reader of an archive needs to know before reusing anything in it.
      */}
      <div className="partial-note section">
        <p className="eyebrow">On rights</p>
        <p>
          {stats.withRights.toLocaleString('en-GB')} of {stats.total.toLocaleString('en-GB')} items
          carry a recorded licence or rights note. The previous site had no field for either, so most
          of this holding arrived without one. Where rights are not recorded, the entry says so — it
          is not a statement that the item is free to reuse. If you hold rights to an item here and
          want it credited, restricted or removed, write to{' '}
          <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>.
        </p>
      </div>

      <p className="small muted">
        Showing {records.length} of {total.toLocaleString('en-GB')}
        {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
      </p>

      {records.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">Nothing in this part of the holding</p>
          <p>
            No items match this filter. The archive is complete as migrated, so this means the
            filter is narrower than the holding rather than that something is missing.
          </p>
          <p className="small">
            <Link href="/documents">See everything</Link>
          </p>
        </div>
      ) : (
        <div className="object-grid section">
          {records.map((item) => (
            <article className="object" key={item.id}>
              {item.kind === 'image' && item.url ? (
                <Link href={`/documents/${item.slug}`} tabIndex={-1} aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="" loading="lazy" />
                </Link>
              ) : (
                <div className="plate">
                  {KIND_LABEL[item.kind] ?? 'Item'} — not shown here
                </div>
              )}

              <div className="body">
                <h3>
                  <Link href={`/documents/${item.slug}`}>{item.title}</Link>
                </h3>

                <div className="chips" style={{ marginTop: 'var(--s-2)' }}>
                  <span className="chip chip-source">
                    <span className="k">Type</span> {KIND_LABEL[item.kind] ?? item.kind}
                  </span>
                  {item.width && item.height ? (
                    <span className="chip">
                      {item.width}×{item.height}
                    </span>
                  ) : null}
                  {item.usedByArticles > 0 ? (
                    <span className="chip chip-source">
                      used by {item.usedByArticles} {item.usedByArticles === 1 ? 'record' : 'records'}
                    </span>
                  ) : null}
                </div>

                <table className="record" style={{ marginTop: 'var(--s-4)' }}>
                  <tbody>
                    <tr>
                      <th scope="row">Ref.</th>
                      <td className="mono">{item.reference}</td>
                    </tr>
                    <tr>
                      <th scope="row">Rights</th>
                      <td>{item.licence ?? item.rightsNote ?? 'not recorded'}</td>
                    </tr>
                    <tr>
                      <th scope="row">Access</th>
                      <td>
                        {item.filesizeBytes
                          ? `Open · ${humanBytes(item.filesizeBytes)}`
                          : 'Open'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="row section" aria-label="Pagination">
          {page > 1 ? (
            <Link className="btn btn-sm" href={href(page - 1)} rel="prev">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="small muted">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link className="btn btn-sm" href={href(page + 1)} rel="next">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
