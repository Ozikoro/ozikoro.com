/**
 * One label, and every record that carries it.
 *
 * The 11,056 migrated tags are how the existing site is found in search, and today they are also
 * the closest thing the archive has to entity pages: a label named for a town is a place the
 * articles write about. Keeping the pages means those addresses keep working and the traffic they
 * carry keeps arriving, while the entity graph is built underneath them.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getLabelBySlug, listArticles } from '@ozikoro/platform';
import { ArticleEntry } from '../../_components/article-entry';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const label = await getLabelBySlug(db, slug);
  if (!label) return { title: 'Not found' };
  return {
    title: label.name,
    description: `Records in the Ozikoro archive filed under ${label.name}.`,
    robots: { index: false, follow: true },
  };
}

export default async function LabelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const label = await getLabelBySlug(db, slug);
  if (!label) notFound();

  /*
   * IS THIS SUBJECT A CLAN THE DICTIONARY ALREADY PUBLISHES?
   *
   * Item 8 is "Ozituma integration linking to the dictionary rather than duplicating it." Round 141
   * measured both sides and found they already overlap: 93 labels match a published clan by slug, 99 by
   * name, and 268 articles carry such a label — umueri, nimo, abagana, idemili and the rest.
   *
   * So this needs no entity, no source, no period and no rights decision. It is a lookup. Building an
   * Ozikoro clan page would be exactly the duplication item 8 exists to prevent.
   *
   * `published = true` matters: the clan table holds 228 rows and only 188 are published, and a link to an
   * unpublished entry would be a 404 on the other site. A failure is caught rather than thrown, because a
   * missing clan must not stop a subject page rendering.
   */
  const clan = await db
    .one<{ slug: string }>(
      `select slug from clan where published = true and lower(slug) = lower($1) limit 1`,
      [label.slug]
    )
    .catch(() => null);

  const articles = await listArticles(db, { labelSlug: label.slug, limit: 30 });

  /*
   * Structured data for a subject page.
   *
   * 10,100 of these pages had none, and they are how the archive is actually found: a reader searches
   * a subject, not a title. `CollectionPage` with an `about` is the honest description — this is a list
   * of records concerning something, not the thing itself, and marking it up as the thing would claim
   * the archive IS the subject.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${label.name} — records in the Ozikoro archive`,
    about: { '@type': 'Thing', name: label.name },
    url: `https://ozikoro.com/labels/${label.slug}/`,
    isPartOf: { '@type': 'Collection', name: 'The Ozikoro archive', url: 'https://ozikoro.com/archive/' },
    ...(articles.length > 0 ? { mainEntity: { '@type': 'ItemList', numberOfItems: articles.length } } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

    <div className="wrap section">
      <header>
        <p className="eyebrow">Subject</p>
        <h1>{label.name}</h1>
        {clan ? (
          <p className="small muted">
            {/* A fixed external destination: one dictionary, one address. Not a per-request value. */}
            <Link href={`https://ozituma.com/clans/${clan.slug}/`}>
              Read the dictionary’s entry for {label.name}
            </Link>
          </p>
        ) : null}
        <p className="small muted">
          {articles.length} {articles.length === 1 ? 'record' : 'records'} filed under this subject
        </p>
      </header>

      {articles.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">No records yet</p>
          <p>
            No published record carries this subject. It was migrated from the previous site as a
            tag, and it will resolve to a full record as the knowledge graph is built.
          </p>
          <p className="small">
            <Link href="/archive">Browse the archive</Link>
          </p>
        </div>
      ) : (
        <div className="stack-lg section">
          {articles.map((article) => (
            <ArticleEntry key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
    </>
  );
}
