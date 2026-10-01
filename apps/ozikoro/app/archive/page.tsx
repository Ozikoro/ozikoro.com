/**
 * The archive index, with the design's filter rail.
 *
 * Filtering is a plain GET form, exactly as the design specifies: "Search and filtering are plain
 * `GET` forms that submit and reload, so results have bookmarkable, citable addresses." That is
 * not a limitation to work around. A filtered view of a historical archive is a citation, and a
 * citation needs a URL.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { countArticles, listArticles, listTopics } from '@ozikoro/platform';
import { ArticleEntry } from '../_components/article-entry';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Histories',
  description:
    'The Ozikoro archive: town and kingdom histories, colonial records, oral histories and migration records, filterable by series.',
  alternates: { canonical: 'https://ozikoro.com/archive' },
};

const PAGE_SIZE = 24;

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; page?: string; order?: string }>;
}) {
  const params = await searchParams;
  const topicSlug = params.topic?.trim() || null;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const order = params.order === 'title' ? 'title' : 'recent';

  const db = await getDb();
  const [topics, articles, total] = await Promise.all([
    listTopics(db),
    listArticles(db, { topicSlug, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, order }),
    countArticles(db, { topicSlug }),
  ]);

  const populated = topics.filter((t) => t.articleCount > 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeTopic = topicSlug ? populated.find((t) => t.slug === topicSlug) : null;

  const pageHref = (n: number) => {
    const search = new URLSearchParams();
    if (topicSlug) search.set('topic', topicSlug);
    if (order !== 'recent') search.set('order', order);
    if (n > 1) search.set('page', String(n));
    const query = search.toString();
    return query ? `/archive?${query}` : '/archive';
  };

  return (
    <div className="wrap section">
      <header className="row">
        <div>
          <p className="eyebrow">The archive</p>
          <h1>{activeTopic ? activeTopic.name : 'Histories'}</h1>
          <p className="lede">
            {activeTopic?.description ??
              'Town and kingdom histories, colonial records, oral histories and migration records. Every record keeps the address it was published at.'}
          </p>
        </div>
      </header>

      <div className="sidebar-layout section">
        <aside className="rail" aria-label="Filter the archive">
          <form method="get" action="/archive">
            <fieldset>
              <legend>Series</legend>
              <p className="small">
                <Link href="/archive" aria-current={!topicSlug ? 'true' : undefined}>
                  All series <span className="muted">{populated.reduce((n, t) => n + t.articleCount, 0)}</span>
                </Link>
              </p>
              <ul className="stack">
                {populated.map((topic) => (
                  <li key={topic.slug}>
                    <Link
                      href={`/archive?topic=${encodeURIComponent(topic.slug)}`}
                      aria-current={topic.slug === topicSlug ? 'true' : undefined}
                    >
                      {topic.name} <span className="muted">{topic.articleCount}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </fieldset>

            <fieldset>
              <legend>Order</legend>
              <ul className="stack">
                <li>
                  <label className="small">
                    <input type="radio" name="order" value="recent" defaultChecked={order === 'recent'} /> Newest first
                  </label>
                </li>
                <li>
                  <label className="small">
                    <input type="radio" name="order" value="title" defaultChecked={order === 'title'} /> By title
                  </label>
                </li>
              </ul>
            </fieldset>

            {topicSlug ? <input type="hidden" name="topic" value={topicSlug} /> : null}

            <p style={{ marginTop: 'var(--s-5)' }}>
              <button className="btn btn-ink btn-sm" type="submit">
                Apply
              </button>
            </p>
          </form>
        </aside>

        <div>
          <p className="small muted">
            {total.toLocaleString('en-GB')} {total === 1 ? 'record' : 'records'}
            {activeTopic ? ` in ${activeTopic.name}` : ''}
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
          </p>

          {articles.length === 0 ? (
            <div className="empty section">
              <p className="eyebrow">Nothing here yet</p>
              <p>
                This series has no published records yet. That is a gap in the archive rather than a
                search that failed — the records are added as they are edited and sourced.
              </p>
              <p className="small">
                <Link href="/archive">See every series</Link>
              </p>
            </div>
          ) : (
            <div className="stack-lg section">
              {/* The heading level the design implies but does not draw — see
                  docs/OZIKORO-REMAINING.md. The stylesheets style headings by element, so
                  re-levelling the entries would change the approved design. */}
              <h2 className="visually-hidden">Records</h2>
              {articles.map((article) => (
                <ArticleEntry key={article.id} article={article} />
              ))}
            </div>
          )}

          {totalPages > 1 ? (
            <nav className="row section" aria-label="Pagination">
              {page > 1 ? (
                <Link className="btn btn-sm" href={pageHref(page - 1)} rel="prev">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="small muted">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <Link className="btn btn-sm" href={pageHref(page + 1)} rel="next">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
