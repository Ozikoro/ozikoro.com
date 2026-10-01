/**
 * One series, as the archive groups it.
 *
 * Series came across from the WordPress categories, so these are the owner's own divisions rather
 * than ones invented for the new site: Historical Studies, Cultural Heritage and the rest.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { countArticles, getTopicBySlug, listArticles } from '@ozikoro/platform';
import { ArticleEntry } from '../../_components/article-entry';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const topic = await getTopicBySlug(db, slug);
  if (!topic) return { title: 'Not found' };
  return {
    title: topic.name,
    description: topic.description ?? `${topic.articleCount} records in ${topic.name} in the Ozikoro archive.`,
    alternates: { canonical: `https://ozikoro.com/topics/${topic.slug}` },
  };
}

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const topic = await getTopicBySlug(db, slug);
  if (!topic) notFound();

  const [articles, total] = await Promise.all([
    listArticles(db, { topicSlug: topic.slug, limit: 30 }),
    countArticles(db, { topicSlug: topic.slug }),
  ]);

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">Series</p>
        <h1>{topic.name}</h1>
        {topic.description ? <p className="lede">{topic.description}</p> : null}
        <p className="small muted">{total.toLocaleString('en-GB')} records</p>
      </header>

      {articles.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">Nothing published yet</p>
          <p>This series has no published records. That is a gap in the archive, not a failure.</p>
        </div>
      ) : (
        <div className="stack-lg section">
          {articles.map((article) => (
            <ArticleEntry key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
