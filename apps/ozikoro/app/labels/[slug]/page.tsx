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
  /*
   * NO `robots` HERE, AND ITS ABSENCE IS THE DIRECTIVE.
   *
   * This page carried `robots: { index: false, follow: true }`, so it served `noindex, follow` while the
   * sitemap listed all 10,175 of these addresses and the comment on that query said each one "is a real
   * page listing the records filed under it". **Two halves of the archive disagreed about the same page,
   * and Search Console reported the consequence as "Excluded by 'noindex' tag".** Measured on the served
   * site before this change: `/labels/igbo/` was 56,649 bytes with 37 internal links and
   * `<meta name="robots" content="noindex, follow">`.
   *
   * The root layout (`app/layout.tsx`) already declares `robots: { index: true, follow: true }` for the
   * archive, and a page-level `robots` replaces it rather than merging. So the override is deleted and the
   * page inherits the layout's directive — **one statement of it, in the place that owns the site's
   * identity**, rather than a second `robots` written here to fight the first.
   *
   * ⚠️ THE OTHER `noindex` PAGES ARE NOT THIS PAGE AND KEEP THEIRS: `/signin/`, `/join/`, `/library/`,
   * `/workspace/`, `/submit/`, `/reviews/`, `/account/` and the rest are back office or forms, each
   * excluded on purpose and each served by a different mechanism — a header, a redirect, or its own
   * metadata. None of them reads this file, and none was touched.
   */
  return {
    title: label.name,
    description: `Records in the Ozikoro archive filed under ${label.name}.`,
  };
}

export default async function LabelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const label = await getLabelBySlug(db, slug);
  if (!label) notFound();

  /*
   * IS THIS SUBJECT AN ENTRY THE CLAN REGISTER ALREADY PUBLISHES?
   *
   * Item 8 was "Ozituma integration linking to the dictionary rather than duplicating it." Round 141
   * measured both sides and found they already overlap: 93 labels match a published entry by slug, 99 by
   * name, and 268 articles carry such a label — umueri, nimo, abagana, idemili and the rest.
   *
   * THE RATIONALE HAS CHANGED, SO THE DESTINATION HAS CHANGED WITH IT.
   *
   * That comment used to end "Building an Ozikoro clan page would be exactly the duplication item 8 exists
   * to prevent." The owner has since decided the register belongs to Ozikoro, and the register is now built
   * at `/clans/` on this site. Link to the dictionary from here and the subject page would send a reader off
   * the site to read a page this site now serves — and to a route the dictionary is in the process of
   * giving up. So the link is internal, and it reads the register's own slug rather than the label's.
   *
   * `published = true` still matters: the table holds 228 rows and only 188 are published, and an
   * unpublished entry has no page to link to. A failure is caught rather than thrown, because a missing
   * entry must not stop a subject page rendering.
   */
  const clan = await db
    .one<{ slug: string; region: string | null }>(
      `select slug, region from clan where published = true and lower(slug) = lower($1) limit 1`,
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
            {/* The register is this site's now, so this stays inside Ozikoro. */}
            <Link href={`/clans/${clan.slug}/`}>
              Read the register entry for {label.name}
            </Link>
          {clan.region ? (
            <span>
              {' '}· the register places it in {clan.region}
            </span>
          ) : null}
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
