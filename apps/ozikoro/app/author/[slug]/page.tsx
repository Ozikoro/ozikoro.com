/**
 * The `/author/<slug>/` addresses WordPress served.
 *
 * WHY THIS EXISTS
 *
 * WordPress published an archive page per author. The migration kept each contributor's slug, but this
 * platform served authors at `/researchers/` only — so 91 published articles, whose bodies link to
 * `/author/<name>/` 195 times, now contained roughly 25 links to a 404. Checked in round 74; the slugs
 * were confirmed to match the contributors table exactly in round 76.
 *
 * A route rather than a redirect, and deliberately: the address can be SERVED, which keeps it a 200 at
 * the URL WordPress published. Round 58 is the standing reminder of what rewriting archived addresses
 * to make a lookup work costs.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { listArticles, countArticles } from '@ozikoro/platform';
import { ArticleEntry } from '../../_components/article-entry';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

const PER_PAGE = 24;

async function authorArticles(slug: string, page: number) {
  const db = await getDb();
  const [articles, total] = await Promise.all([
    listArticles(db, { authorSlug: slug, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    countArticles(db, { authorSlug: slug }),
  ]);
  return { articles, total };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { articles, total } = await authorArticles(slug, 1);
  if (total === 0) return { title: 'Not found' };

  // The name comes from the records themselves rather than a second lookup: it is on every summary.
  const name = articles[0]?.authorName ?? slug;
  return {
    title: `${name} — records in the Ozikoro archive`,
    description: `${total} ${total === 1 ? 'record' : 'records'} by ${name} in the Ozikoro archive.`,
    alternates: { canonical: `https://ozikoro.com/author/${slug}/` },
  };
}

export default async function AuthorPage({ params }: PageProps) {
  const { slug } = await params;
  const { articles, total } = await authorArticles(slug, 1);
  if (total === 0) notFound();

  const name = articles[0]?.authorName ?? slug;

  /*
   * `CollectionPage` with `about` a `Person`, not a `ProfilePage`: this is a list of records BY someone,
   * and the archive is not asserting a biography it does not hold. The same reasoning as the subject
   * pages — describe the list, do not claim the thing.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${name} — records in the Ozikoro archive`,
    about: { '@type': 'Person', name },
    url: `https://ozikoro.com/author/${slug}/`,
    isPartOf: { '@type': 'Collection', name: 'The Ozikoro archive', url: 'https://ozikoro.com/archive/' },
    mainEntity: { '@type': 'ItemList', numberOfItems: total },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="wrap section">
        <header>
          <p className="eyebrow">Contributor</p>
          <h1>{name}</h1>
          <p className="small muted">
            {total} {total === 1 ? 'record' : 'records'} in the archive
          </p>
        </header>

        <div className="grid cards">
          {articles.map((a) => (
            <ArticleEntry key={a.id} article={a} />
          ))}
        </div>

        {total > PER_PAGE ? (
          <p className="small muted">
            Showing the first {PER_PAGE} of {total}. <Link href="/archive/">Browse the whole archive</Link>.
          </p>
        ) : null}
      </div>
    </>
  );
}
