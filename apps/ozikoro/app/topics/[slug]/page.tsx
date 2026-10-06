/**
 * One series, as the archive groups it.
 *
 * Series came across from the WordPress categories, so these are the owner's own divisions rather
 * than ones invented for the new site: Historical Studies, Cultural Heritage and the rest.
 *
 * ── TWO CONTROLS WERE ADDED HERE, AND WHY THIS PAGE IS THE RIGHT PLACE FOR THEM ──────────────────────
 *
 * The reader's dashboard draws *Saved histories* and *Followed topics* as its own modules, and until
 * migration `0060_ozikoro_library.sql` the save table did not exist at all — so those two labels could only
 * say "Not built yet", which is what the owner found. **The tables now exist, and a table with no control
 * that writes to it is furniture: it would leave both lists permanently empty.**
 *
 * This page is the archive's OWN page — a Next route, not one of the fifty-two design screens, which are
 * the inviolable deliverable and are never edited. **The record's reading page is a design screen**, so a
 * Save button there would mean drawing a new control into the owner's approved artwork; here it is one form
 * among the archive's own markup, and it is where a reader already is: looking at the records of a series
 * they may want to keep or hear about again.
 *
 * A SIGNED-OUT READER GETS A LINK TO SIGN IN RATHER THAN A FORM THAT CANNOT SAVE. A control that appears to
 * work and then refuses is the fault this whole round exists to remove.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { countArticles, getTopicBySlug, listArticles, listFollowing, savedAmong } from '@ozikoro/platform';
import { getCurrentAccount } from '@/lib/session';
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

  /*
   * THE VIEWER IS ASKED, NOT ASSUMED. `getCurrentAccount` reads the session cookie and answers null for a
   * stranger, which is the state every public page here has to render honestly.
   */
  const viewer = await getCurrentAccount().catch(() => null);
  const accountId = viewer?.account.id ?? null;

  const saved = accountId
    ? await savedAmong(db, { accountId, articleIds: articles.map((article) => article.id) })
    : new Set<number>();

  const following = accountId
    ? (await listFollowing(db, { accountId, viewerId: accountId })).some(
        (follow) => follow.kind === 'topic' && follow.topicId === topic.id
      )
    : false;

  const here = `/topics/${topic.slug}/`;

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">Series</p>
        <h1>{topic.name}</h1>
        {topic.description ? <p className="lede">{topic.description}</p> : null}
        <p className="small muted">{total.toLocaleString('en-GB')} records</p>

        {accountId ? (
          <form method="post" action="/api/follows" className="section">
            <input type="hidden" name="kind" value="topic" />
            <input type="hidden" name="on" value={following ? '0' : '1'} />
            <input type="hidden" name="topicId" value={topic.id} />
            <input type="hidden" name="returnTo" value={here} />
            <button className={following ? 'btn btn-quiet' : 'btn btn-gold'} type="submit">
              {following ? 'Unfollow this series' : 'Follow this series'}
            </button>
            <p className="small muted" style={{ marginTop: 'var(--s-2)' }}>
              {following
                ? 'You follow this series. It is listed in your library.'
                : 'Following adds this series to your library.'}
            </p>
          </form>
        ) : (
          <p className="section">
            <Link className="btn btn-quiet" href={`/signin/?next=${encodeURIComponent(here)}`}>
              Sign in to follow this series
            </Link>
          </p>
        )}
      </header>

      {articles.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">Nothing published yet</p>
          <p>This series has no published records. That is a gap in the archive, not a failure.</p>
        </div>
      ) : (
        <div className="stack-lg section">
          {articles.map((article) => (
            <div key={article.id}>
              <ArticleEntry article={article} />
              {accountId ? (
                <form method="post" action="/api/library" className="row" style={{ gap: 'var(--s-2)' }}>
                  <input type="hidden" name="action" value={saved.has(article.id) ? 'unsave' : 'save'} />
                  <input type="hidden" name="articleId" value={article.id} />
                  <input type="hidden" name="returnTo" value={`${here}#library-actions`} />
                  <button className="btn btn-quiet btn-sm" type="submit">
                    {saved.has(article.id) ? 'Saved — remove' : 'Save this history'}
                  </button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {accountId ? (
        <p className="small muted section" id="library-actions">
          Saved records and the series you follow are listed in <Link href="/library/">your library</Link>.
        </p>
      ) : null}
    </div>
  );
}
