/**
 * The article, served at the address WordPress published it at.
 *
 * THE URL IS NOT A DETAIL
 *
 * WordPress published these at the site root: `https://ozikoro.com/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/`.
 * The plan requires that existing URLs and their search value survive the move, so this route is
 * `[slug]` at the root and serves the same path. Moving 1,051 articles under `/articles/` would
 * mean 1,051 redirects and the loss of whatever those addresses have accumulated in search. The
 * cost of keeping them is that every top-level route added later must not collide with a slug,
 * which is why the reserved names are listed and checked rather than assumed.
 *
 * WHAT THE PAGE SHOWS, AND WHAT IT SHOWS WHEN THERE IS NOTHING
 *
 * The brief says an article is "a scholarly object, not a blog post" and that an entry without a
 * source should look incomplete. The archive has just been migrated, so almost none of the 1,057
 * articles has a source, a period or a clan attached yet — that re-tagging is a human editorial
 * task and the schema deliberately leaves those columns empty rather than guessing.
 *
 * So the `.unsourced` block is not an edge case here; it is the honest state of most of the
 * archive on the day it opens, and the design anticipated exactly this: "a missing source is
 * designed ... this makes incompleteness a deliberate, legible state rather than an absence
 * nobody notices."
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getArticleBySlug, getRelatedArticles, getTopicBySlug } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Dates as a scholarly record states them: unambiguous, and UTC so the server's zone cannot shift them. */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const article = await getArticleBySlug(db, slug);
  if (!article) return { title: 'Not found' };

  const description = article.seoDescription ?? article.standfirst ?? undefined;
  return {
    title: article.seoTitle ?? article.title,
    ...(description ? { description } : {}),
    alternates: { canonical: `https://ozikoro.com${article.url}` },
    openGraph: {
      type: 'article',
      title: article.title,
      ...(description ? { description } : {}),
      url: `https://ozikoro.com${article.url}`,
      ...(article.publishedAt ? { publishedTime: article.publishedAt } : {}),
      ...(article.imageUrl ? { images: [{ url: article.imageUrl, alt: article.imageAlt ?? article.title }] } : {}),
    },
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const db = await getDb();
  const article = await getArticleBySlug(db, slug);
  if (!article) {
    /*
     * A WordPress CATEGORY archive, reached at `/<category>/`.
     *
     * The old site served `/historical-studies/`, `/biography/` and their siblings as archive pages. This
     * platform serves those records at `/topics/<slug>/`, and `/<category>/` is a single segment — the
     * same shape as an article — so the router cannot tell them apart and 404s.
     *
     * Round 74 found 27 in-body links doing exactly this, inside 91 published articles.
     *
     * A redirect rather than serving here: the topic page already exists and rendering a second copy at
     * an alias would split the two addresses. This is deliberately checked AFTER the article lookup, so
     * a real article always wins and no article address can be shadowed by a topic of the same name.
     */
    const topic = await getTopicBySlug(db, slug);
    /*
     * `permanentRedirect`, not `redirect`. The default is a **307**, which tells a crawler the move is
     * temporary and to keep the old address indexed — the opposite of what a migrated archive wants. The
     * concern recorded at the top of this file is "the loss of whatever those addresses have accumulated
     * in search", and a 307 preserves exactly that loss. 308 is the permanent, method-preserving form.
     */
    if (topic) permanentRedirect(`/topics/${topic.slug}/`);
    notFound();
  }

  const related = await getRelatedArticles(db, article.id, 4);
  const published = formatDate(article.publishedAt);
  const revised = article.modifiedAt && article.modifiedAt !== article.publishedAt ? formatDate(article.modifiedAt) : null;

  /*
   * JSON-LD, so the archive is citable and machine-readable. `ScholarlyArticle` rather than
   * `BlogPosting`: the brief's register is a university press, and that is what the markup should
   * tell a crawler. The author is only asserted when the archive actually holds one.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: article.title,
    ...(article.standfirst ? { description: article.standfirst } : {}),
    ...(published ? { datePublished: article.publishedAt } : {}),
    ...(article.modifiedAt ? { dateModified: article.modifiedAt } : {}),
    ...(article.authorName ? { author: { '@type': 'Person', name: article.authorName } } : {}),
    publisher: { '@type': 'Organization', name: 'Ozi Ikoro Limited' },
    isPartOf: { '@type': 'Periodical', name: 'Ozikoro' },
    url: article.ownerUrl,
    license: 'https://ozikoro.com/terms',
    ...(article.sources.length > 0
      ? {
          citation: article.sources.map((s) =>
            [s.authors.join(', '), s.year ? `(${s.year})` : '', s.title, s.publisher ?? s.journal ?? '']
              .filter(Boolean)
              .join(' ')
          ),
        }
      : {}),
  };

  return (
    <>
      {/* The design's own reader script: copy-link, share, print, and browser narration. */}
      <script src="/design/reader.js" defer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="wrap section">
        <div className="article-layout">
          <article>
            {/*
              The opening, reproduced from the design's `article.html` — `sx-article-opening`
              containing `sx-article-title` (eyebrow, title, byline) and `sx-article-image` (the
              first image, with the publication dates and the share/print actions beneath it).

              The owner asked for exactly this treatment, and for it to carry folklores as well as
              histories: "I prefer the design of inside page of history contents there ... especially
              the title and first image ... use same design on history articles for folklore." So
              this is the one opening for both, rather than the folklore screen's full-bleed hero.
            */}
            <header className="sx-article-opening">
              <div className="sx-article-title">
                <p className="eyebrow">
                  {article.topicName ?? 'History'}
                  {article.sourceType ? ` · ${article.sourceType.replace(/_/g, ' ')}` : ''}
                </p>
                <h1>{article.title}</h1>
                {article.authorName ? (
                  <p className="sx-article-byline">
                    By <strong>{article.authorName}</strong>
                  </p>
                ) : null}
              </div>

              <figure className="sx-article-image">
                {article.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={article.imageUrl} alt={article.imageAlt ?? ''} loading="eager" />
                ) : (
                  /* The design's deliberate plate for a record with no picture, never a broken icon. */
                  <div className="object" aria-hidden="true" />
                )}
                <figcaption>
                  {article.imageAlt ?? 'No picture is held for this record yet.'}
                  {article.imageCredit ? ` · ${article.imageCredit}` : ''}
                </figcaption>

                <div className="sx-article-utility">
                  <dl>
                    {published ? (
                      <div>
                        <dt>Published</dt>
                        <dd>{published}</dd>
                      </div>
                    ) : null}
                    {revised ? (
                      <div>
                        <dt>Last updated</dt>
                        <dd>{revised}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Sources</dt>
                      <dd>{article.sources.length > 0 ? `${article.sources.length} attached` : 'none attached yet'}</dd>
                    </div>
                  </dl>

                  {/*
                    The design's share and print actions. They are progressive enhancement, not a
                    requirement: without JavaScript the buttons do nothing and the page is still
                    fully readable, which is the design's own "no JavaScript at all" rule for
                    reading, browsing and searching. `reader.js` is the design's own file, loaded
                    below, and it also drives the browser-narration panel.
                  */}
                  <div className="sx-article-actions" aria-label="Share or print this article">
                    <span>Share</span>
                    <button className="sx-icon-action" type="button" data-copy-link title="Copy this record's link" aria-label="Copy this record's link">
                      ↗
                    </button>
                    <button className="sx-icon-action" type="button" data-share="facebook" title="Share on Facebook" aria-label="Share on Facebook">
                      f
                    </button>
                    <button className="sx-icon-action" type="button" data-share="x" title="Share on X" aria-label="Share on X">
                      𝕏
                    </button>
                    <button className="sx-print-action" type="button" data-print-article title="Print or save as PDF">
                      <span aria-hidden="true">▤</span> Print / PDF
                    </button>
                  </div>
                  <p className="sx-copy-status" data-copy-status aria-live="polite" />
                </div>
              </figure>
            </header>

            {/* The brief's required structure, as chips under the opening, before the body. */}
            <div className="chips section">
              {article.sourceType ? (
                <span className={`chip${article.sourceType === 'oral_history' ? ' chip-oral' : ' chip-source'}`}>
                  {article.sourceType.replace(/_/g, ' ')}
                </span>
              ) : null}
              {article.periodLabel ? <span className="chip chip-period">{article.periodLabel}</span> : null}
              {article.entities.map((entity) => (
                <span
                  key={`${entity.kind}-${entity.id}`}
                  className={`chip${entity.role === 'town' || entity.role === 'place' ? ' chip-place' : ''}`}
                >
                  {entity.name}
                </span>
              ))}
              {article.labels.slice(0, 8).map((label) => (
                <Link key={label.slug} className="chip" href={`/labels/${label.slug}`}>
                  {label.name}
                </Link>
              ))}
            </div>

            {/* The record table: metadata as a catalogue states it. */}
            <table className="record section">
              <tbody>
                <tr>
                  <th scope="row">Archive</th>
                  <td>Ozikoro — History &amp; Archive</td>
                </tr>
                {article.topicName ? (
                  <tr>
                    <th scope="row">Series</th>
                    <td>
                      <Link href={`/topics/${article.topicSlug}`}>{article.topicName}</Link>
                    </td>
                  </tr>
                ) : null}
                {published ? (
                  <tr>
                    <th scope="row">Published</th>
                    <td>{published}</td>
                  </tr>
                ) : null}
                <tr>
                  <th scope="row">Words</th>
                  <td>{article.wordCount.toLocaleString('en-GB')}</td>
                </tr>
                <tr>
                  <th scope="row">Sources</th>
                  <td>
                    {article.sources.length > 0
                      ? `${article.sources.length} attached`
                      : 'none attached yet — see the note below'}
                  </td>
                </tr>
              </tbody>
            </table>

            {/*
              The body. Already sanitised by `prepareArchiveHtml` at the repository boundary, so
              this is allowlisted markup and not the raw WordPress HTML.
            */}
            <div className="prose section" dangerouslySetInnerHTML={{ __html: article.bodyHtml }} />

            {/* Provenance, or the deliberate absence of it. */}
            {article.sources.length > 0 ? (
              <section className="provenance section" aria-labelledby="sources">
                <p className="eyebrow" id="sources">
                  Sources and references
                </p>
                <ol>
                  {article.sources.map((source) => (
                    <li key={source.id}>
                      {source.authors.length > 0 ? `${source.authors.join(', ')}. ` : ''}
                      <em>{source.title}</em>
                      {source.year ? `, ${source.year}${source.yearNote ? ` (${source.yearNote})` : ''}` : ''}
                      {source.publisher ? `. ${source.publisher}` : ''}
                      {source.journal ? `. ${source.journal}` : ''}
                      {source.url ? (
                        <>
                          {' '}
                          <a href={source.url} rel="noopener noreferrer">
                            {source.url}
                          </a>
                        </>
                      ) : null}
                      {source.evidenceType ? (
                        <span className="small muted"> · {source.evidenceType.replace(/_/g, ' ')}</span>
                      ) : null}
                      {source.stance !== 'supports' ? (
                        <span className="small muted"> · {source.stance}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <section className="unsourced section" aria-labelledby="unsourced">
                <p className="eyebrow" id="unsourced">
                  No sources attached yet
                </p>
                <p>
                  This record has been carried across from the previous Ozikoro site with its text
                  intact, and its sources have not yet been attached in the archive. That is a gap
                  in the record, not a statement that the account is unsupported.
                </p>
                <p className="small">
                  Editors attach sources, periods, clans and places from the editorial queue. If you
                  hold a document, a photograph or a published reference for this entry,{' '}
                  <a href="mailto:hello@ozikoro.com">write to the archive</a>.
                </p>
              </section>
            )}

            {/* The citation, ready to copy, in the design's monospace block. */}
            <section className="section" aria-labelledby="cite">
              <p className="eyebrow" id="cite">
                Cite this record
              </p>
              <div className="cite-block">{article.citation}</div>
            </section>

            {related.length > 0 ? (
              <section className="section" aria-labelledby="related">
                <p className="eyebrow" id="related">
                  Continue reading
                </p>
                <h2>Related histories</h2>
                <ul className="stack">
                  {related.map((item) => (
                    <li key={item.id}>
                      <Link href={item.url}>{item.title}</Link>
                      {item.topicName ? <span className="small muted"> · {item.topicName}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>

          {/* The rail: the record's own metadata, and the archive's. */}
          <aside className="rail" aria-label="Record details">
            <p className="eyebrow">The record</p>
            <dl className="stack">
              <div>
                <dt className="small muted">Migrated from</dt>
                <dd className="small mono">{article.url}</dd>
              </div>
              {article.authorName ? (
                <div>
                  <dt className="small muted">Author</dt>
                  <dd className="small">{article.authorName}</dd>
                </div>
              ) : null}
              {published ? (
                <div>
                  <dt className="small muted">Published</dt>
                  <dd className="small">{published}</dd>
                </div>
              ) : null}
              {article.modifiedAt && article.modifiedAt !== article.publishedAt ? (
                <div>
                  <dt className="small muted">Last revised</dt>
                  <dd className="small">{formatDate(article.modifiedAt)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="small muted" style={{ marginTop: 'var(--s-5)' }}>
              This record keeps its original address. It was published at{' '}
              <span className="mono">ozikoro.com{article.url}</span> and is served at the same path
              here.
            </p>
            <p className="small" style={{ marginTop: 'var(--s-4)' }}>
              <Link href="/archive">Browse the archive</Link>
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}
