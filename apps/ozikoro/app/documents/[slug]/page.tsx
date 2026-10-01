/**
 * One item in the archive.
 *
 * The design treats a document as a catalogued object, so this shows the record rather than a
 * lightbox: the object, then what is known about it, then what is not. Where the previous site
 * recorded nothing about rights — which is most of the holding — the page says "not recorded"
 * rather than leaving the row out, because an absent row reads as "no restriction".
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getMediaArticles, getMediaBySlug, humanBytes } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  image: 'Photograph', video: 'Film', audio: 'Recording', document: 'Document',
  dataset: 'Dataset', other: 'Item',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const item = await getMediaBySlug(db, slug);
  if (!item) return { title: 'Not found' };
  return {
    title: item.title,
    description: item.caption ?? item.description ?? `${KIND_LABEL[item.kind] ?? 'Item'} ${item.reference} in the Ozikoro archive.`,
    robots: { index: false, follow: true },
  };
}

export default async function MediaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const item = await getMediaBySlug(db, slug);
  if (!item) notFound();

  const using = await getMediaArticles(db, item.id);
  const uploaded = formatDate(item.uploadedAt);

  /*
   * Structured data for a media record.
   *
   * 3,488 of these pages had none, and they are records in their own right — a photograph with a
   * creator, a date, a place and a rights statement — not merely decoration on an article. The type is
   * `ImageObject` for an image and `MediaObject` otherwise, and `license` is emitted ONLY when a
   * licence has actually been recorded. Emitting a licence we do not hold would be the same
   * overstatement the rights module exists to prevent, made to a machine instead of a reader.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': item.kind === 'image' ? 'ImageObject' : 'MediaObject',
    name: item.title,
    ...(item.description ? { description: item.description } : {}),
    ...(item.caption ? { caption: item.caption } : {}),
    ...(item.creator ? { creator: { '@type': 'Person', name: item.creator } } : {}),
    ...(item.credit ? { creditText: item.credit } : {}),
    ...(item.uploadedAt ? { datePublished: item.uploadedAt.slice(0, 10) } : {}),
    ...(item.licence ? { license: item.licence } : {}),
    ...(item.url ? { contentUrl: `https://ozikoro.com${item.url}` } : {}),
    ...(item.width && item.height ? { width: item.width, height: item.height } : {}),
    ...(item.mimeType ? { encodingFormat: item.mimeType } : {}),
    url: `https://ozikoro.com/documents/${item.slug}/`,
    isPartOf: { '@type': 'Collection', name: 'The Ozikoro archive', url: 'https://ozikoro.com/documents/' },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

    <div className="wrap section">
      <p className="eyebrow">
        <Link href="/documents">Archive</Link> · {KIND_LABEL[item.kind] ?? item.kind}
      </p>
      <h1>{item.title}</h1>

      {/*
        The archive shows a file only when it holds the file.

        51 of the 3,488 migrated items were measured, and their original addresses now return 404 —
        gone from the old site, not merely not-yet-fetched. Showing an <img> pointing there would put a
        broken picture on the page AND quietly re-establish the dependency on the site this archive
        exists to replace. So the absence is stated, and the address is kept as provenance.
      */}
      {!item.held ? (
        <div className="unsourced section">
          <p className="eyebrow">The archive does not hold this file</p>
          <p>
            This record describes an item published on the previous site. Its metadata is preserved
            here, but the file itself is no longer available: the address it was served from now
            returns &ldquo;not found&rdquo;, so the archive cannot show it and will not pretend to.
          </p>
          {item.sourceUrl ? (
            <p className="small muted">It was published at <span className="mono">{item.sourceUrl}</span>.</p>
          ) : null}
          {item.caption || item.altText ? (
            <p className="small">Recorded caption: {item.caption ?? item.altText}</p>
          ) : null}
        </div>
      ) : null}

      {item.kind === 'image' && item.url ? (
        <figure className="section">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.altText ?? ''} />
          {item.caption || item.altText ? <figcaption className="small muted">{item.caption ?? item.altText}</figcaption> : null}
        </figure>
      ) : item.kind === 'video' && item.url ? (
        <video className="section" controls preload="metadata" src={item.url} style={{ maxWidth: '100%' }} />
      ) : item.kind === 'audio' && item.url ? (
        <audio className="section" controls preload="metadata" src={item.url} />
      ) : (
        <div className="plate section">This item is a {KIND_LABEL[item.kind]?.toLowerCase() ?? 'file'} and is not shown inline.</div>
      )}

      {item.description ? <div className="prose section"><p>{item.description}</p></div> : null}

      <table className="record section">
        <tbody>
          <tr><th scope="row">Ref.</th><td className="mono">{item.reference}</td></tr>
          <tr><th scope="row">Type</th><td>{KIND_LABEL[item.kind] ?? item.kind}{item.mimeType ? ` · ${item.mimeType}` : ''}</td></tr>
          {item.creator ? <tr><th scope="row">Creator</th><td>{item.creator}</td></tr> : null}
          {item.credit ? <tr><th scope="row">Credit</th><td>{item.credit}</td></tr> : null}
          {uploaded ? <tr><th scope="row">Added</th><td>{uploaded}</td></tr> : null}
          {item.width && item.height ? <tr><th scope="row">Dimensions</th><td>{item.width} × {item.height}</td></tr> : null}
          {item.filesizeBytes ? <tr><th scope="row">Size</th><td>{humanBytes(item.filesizeBytes)}</td></tr> : null}
          <tr><th scope="row">Rights</th><td>{item.licence ?? item.rightsNote ?? 'not recorded'}</td></tr>
        </tbody>
      </table>

      {using.length > 0 ? (
        <section className="section">
          <p className="eyebrow">Used in</p>
          <ul className="stack">
            {using.map((a) => (
              <li key={a.slug}><Link href={`/${a.slug}/`}>{a.title}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="partial-note section">
        <p className="eyebrow">Reusing this</p>
        <p>
          {item.licence || item.rightsNote
            ? 'The rights recorded above are what the archive holds. Check them before reuse.'
            : 'No rights statement is recorded against this item, so permission has not been established either way. Write to the archive before republishing it.'}
        </p>
      </div>
    </div>
    </>
  );
}
