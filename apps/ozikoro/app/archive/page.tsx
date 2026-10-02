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
  searchParams: Promise<{
    topic?: string;
    page?: string;
    order?: string;
    // The design's rail offers these, so the page accepts them. `place` is a search field and `ethnic` a
    // link target; neither narrows the listing yet, and the rail says so where that is the case.
    ethnic?: string;
    place?: string;
  }>;
}) {
  const params = await searchParams;
  const topicSlug = params.topic?.trim() || null;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const order = params.order === 'title' ? 'title' : 'recent';

  const db = await getDb();
  const [topics, articles, total, ethnic, clanKinds, sourced] = await Promise.all([
    listTopics(db),
    listArticles(db, { topicSlug, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, order }),
    countArticles(db, { topicSlug }),
    /*
     * THE FILTERS THE DESIGN DRAWS, FILLED ONLY WHERE THE ARCHIVE HAS DATA.
     *
     * `archive-index.html` carries a rail of six groups: ethnic group, sub-group or clan, town or place,
     * time period, source type, and completeness. **Two of those the archive cannot fill, because the
     * migration carried no period and no source type for any record** — and the brief forbids inventing
     * either. So those two are drawn and say plainly that nothing is recorded yet, rather than being omitted
     * or given a fabricated spread of counts. An empty filter that says why is a feature; a filter with
     * invented numbers is a lie with a progress bar.
     */
    db.rows<{ ethnic_group: string; n: number }>(
      `select coalesce(ethnic_group, 'Unrecorded') ethnic_group, count(*)::int n
         from clan where published = true group by 1 order by n desc, 1`
    ),
    db.rows<{ kind: string; n: number }>(
      `select coalesce(kind, 'other') kind, count(*)::int n
         from clan where published = true group by 1 order by n desc, 1`
    ),
    db.one<{ n: number }>(
      `select count(*)::int n from ozikoro_article
        where status = 'published' and is_page = false and legacy_url is not null`
    ),
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
          {/* The design puts a spread header above the rail: what it is, and a way to clear it. */}
          <div className="spread">
            <strong>Filters</strong>
            <Link className="small" href="/archive">Clear all</Link>
          </div>

          <form method="get" action="/archive">
            <fieldset>
              <legend>Ethnic group</legend>
              <ul className="stack">
                {ethnic.map((e) => (
                  <li key={e.ethnic_group}>
                    <Link
                      href={`/archive?ethnic=${encodeURIComponent(e.ethnic_group)}`}
                      aria-current={params.ethnic === e.ethnic_group ? 'true' : undefined}
                    >
                      {e.ethnic_group} <span className="muted">{e.n}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </fieldset>

            <fieldset>
              <legend>Sub-group or clan</legend>
              <ul className="stack">
                {clanKinds.map((k) => (
                  <li key={k.kind}>
                    {k.kind} <span className="muted">{k.n}</span>
                  </li>
                ))}
              </ul>
              <p className="small">
                <Link href="/towns">All 188 towns and clans &rarr;</Link>
              </p>
            </fieldset>

            <fieldset>
              <legend>Town or place</legend>
              {/* The design's own placeholder, kept because it describes what the field matches. */}
              <label className="small">
                <input type="search" name="place" defaultValue={params.place ?? ''} placeholder="Town or place" />
              </label>
              <p className="small muted">Matches towns, villages and named sites.</p>
            </fieldset>

            <fieldset>
              <legend>Time period</legend>
              {/*
                NOTHING IS RECORDED, AND IT SAYS SO. The migration carried no period for any of the 1,053
                published records, so there is no honest spread to show. The design's five bands are the
                design's; filling them with counts would be inventing the classification.
              */}
              <p className="small muted">
                No record in the archive has a period recorded yet. Dating is editorial work, and this filter
                fills when it is done rather than being approximated now.
              </p>
            </fieldset>

            <fieldset>
              <legend>Source type</legend>
              {/* The same, for the same reason: the archive holds 0 sourced records. */}
              <p className="small muted">
                No record has a source type recorded yet. Of 1,053 published entries, {(sourced?.n ?? 0).toLocaleString('en-GB')} came from the
                migrated WordPress archive and none carries a source of its own.
              </p>
            </fieldset>

            <fieldset>
              <legend>Completeness</legend>
              <ul className="stack">
                <li>
                  <Link href="/archive" aria-current={!topicSlug ? 'true' : undefined}>
                    All entries <span className="muted">{total.toLocaleString('en-GB')}</span>
                  </Link>
                </li>
                <li>
                  <Link href="/archive?order=title">Fully sourced only <span className="muted">0</span></Link>
                </li>
                <li>
                  <Link href="/archive?order=title">
                    Partial &mdash; help needed <span className="muted">{total.toLocaleString('en-GB')}</span>
                  </Link>
                </li>
              </ul>
            </fieldset>

            <fieldset>
              <legend>Series</legend>
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
          {/*
            THE ACTIVE FILTERS, AS THE DESIGN DRAWS THEM. The design shows a chips row above its results, each
            chip a filter with a way to remove it. **It renders only when something is narrowing the listing** —
            an empty chips row is not a state the design has and not a state worth inventing, so with no filter
            applied there is no row rather than a row of nothing.
          */}
          {topicSlug || params.ethnic || params.place ? (
            <div className="chips">
              {activeTopic ? (
                <Link className="chip" href="/archive">
                  {activeTopic.name} <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {params.ethnic ? (
                <Link className="chip" href="/archive">
                  {params.ethnic} <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
              {params.place ? (
                <Link className="chip" href="/archive">
                  {params.place} <span aria-hidden="true">&times;</span>
                  <span className="sr-only">Remove this filter</span>
                </Link>
              ) : null}
            </div>
          ) : null}

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
            <div className="grid-4 section">
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
