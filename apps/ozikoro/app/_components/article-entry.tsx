import Link from 'next/link';
import type { ArticleSummary } from '@ozikoro/platform';

/**
 * One article as a list entry.
 *
 * Uses the design's `.entry` vocabulary rather than inventing card markup: the design notes are
 * explicit that hairlines replace cards wherever a card would be decoration, because the register
 * is a catalogue and not a blog. Shared here so the home page, the archive index, a topic, a label
 * and a search result all render the same record the same way — a reader should not have to
 * relearn what an entry looks like when they move between them.
 */
export function ArticleEntry({ article, showImage = true }: { article: ArticleSummary; showImage?: boolean }) {
  const date = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <article className="entry">
      {showImage && article.imageUrl ? (
        <Link href={article.url} tabIndex={-1} aria-hidden="true">
          {/* The design's own image treatment; WordPress already serves resized files. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={article.imageUrl} alt="" loading="lazy" />
        </Link>
      ) : null}

      <div>
        <p className="eyebrow">
          {article.topicName ?? 'History'}
          {date ? ` · ${date}` : ''}
        </p>
        <h3>
          <Link href={article.url}>{article.title}</Link>
        </h3>
        {article.standfirst ? <p className="small muted">{article.standfirst}</p> : null}
        <p className="small muted">
          {article.authorName ? `${article.authorName} · ` : ''}
          {article.readingMinutes} min read
        </p>
      </div>
    </article>
  );
}
