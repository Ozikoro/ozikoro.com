/**
 * Folklores — the tales, customs and oral traditions.
 *
 * WHY THIS IS A SECTION AND NOT A SEPARATE KIND OF PAGE
 *
 * The design drew folklores twice: a storybook index, and a reader with a full-bleed hero image
 * behind a scrim. The owner's decision, given after seeing both, is that the reader should not be
 * a separate design at all:
 *
 *     "I prefer the design of inside page of history contents there, so use it to replace the one
 *      they did for folklores. It fits it better. Especially the title and first image, but use
 *      same design on history articles for folklore."
 *
 * So a folktale is read exactly as a history is read — the same `sx-article-opening`, the same
 * title treatment, the same first-image figure — and the argument for it is not only preference.
 * The design notes describe the `.provenance` block as carrying "the same visual weight as a pull
 * quote" on the article, the publication and the profile, because an academic decides in seconds
 * whether a site is serious. A folktale is oral history, and the brief is explicit that oral
 * history is given "the same visual standing as the other two, not a lesser one". A scrim and a
 * hero is a storybook; a record with an opening, a source note and a citation is an archive. The
 * plain reader is the one that says a folktale is evidence.
 *
 * The records themselves are not moved. They keep the addresses WordPress published them at, and
 * they render through the same `/[slug]` route as everything else. This section is a way in.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { countArticles, getTopicBySlug, listArticles } from '@ozikoro/platform';
import { ArticleEntry } from '../_components/article-entry';

export const dynamic = 'force-dynamic';

/** The series folklores were filed under in WordPress. */
const FOLKLORE_TOPIC = 'folklores';

export const metadata: Metadata = {
  title: 'Folklores',
  description:
    'Igbo tales, myths, customs and oral traditions in the Ozikoro archive, recorded as they were told and distinguished from other kinds of evidence.',
  alternates: { canonical: 'https://ozikoro.com/folklore' },
};

export default async function FolklorePage() {
  const db = await getDb();
  const topic = await getTopicBySlug(db, FOLKLORE_TOPIC);

  const [records, total] = await Promise.all([
    listArticles(db, { topicSlug: FOLKLORE_TOPIC, limit: 30 }),
    countArticles(db, { topicSlug: FOLKLORE_TOPIC }),
  ]);

  return (
    <>
      <section className="sx-folk-intro">
        <div className="wrap">
          <div className="sx-folk-heading">
        <p className="eyebrow">Oral traditions</p>
        <h1>{topic?.name ?? 'Folklores'}</h1>
        <p className="lede">
          Tales, myths, customs and the things people were told. These are recorded as oral
          tradition — which the archive gives the same standing as its written sources, and marks
          as a different kind of evidence rather than a lesser one.
        </p>
        {total > 0 ? <p className="small muted">{total.toLocaleString('en-GB')} records</p> : null}
        </div>
        <div className="row">
          <Link className="btn btn-gold" href="/listen">Listen instead</Link>
          <Link className="btn btn-quiet" href="/archive">Browse the histories</Link>
        </div>
        </div>
      </section>

      <section className="sx-folk-index">
        <div className="wrap">
          <header className="sx-index-head">
            <div>
              <p className="eyebrow">The collection</p>
              <h2>Choose a story</h2>
            </div>
            <p>
              Each entry has equal place in this collection. Open one to read it as a continuous story.
            </p>
          </header>

      {/*
        Said plainly, because it is the archive's own rule and the brief requires it: oral tradition
        is not silently promoted into established fact, and a reader should know which they are
        reading.
      */}
      <div className="partial-note section">
        <p className="eyebrow">How to read these</p>
        <p>
          A folktale is a record of what a community tells, not a claim that the events happened.
          Where a record rests on a named narrator or a published collection, that is attached to it
          as a source. Where it does not yet, the record says so on its own page.
        </p>
      </div>

      {records.length === 0 ? (
        <div className="empty section">
          <p className="eyebrow">Nothing published yet</p>
          <p>
            No folklores are published in the archive yet. The collections the owner has asked about
            are in copyright and come by way of their publishers, so this section fills as those
            permissions arrive rather than being filled with anything to hand.
          </p>
          <p className="small">
            <Link href="/archive">Browse the histories</Link> in the meantime.
          </p>
        </div>
      ) : (
        <div className="sx-folk-grid">
          {/* The heading level the design implies but does not draw: it jumps from the
              h1 straight to the h3 titles of its entries. The stylesheets style headings
              by element, so re-levelling the entries would change the approved design. */}
          <h2 className="visually-hidden">Folklores</h2>
          {records.map((article) => (
            <ArticleEntry key={article.id} article={article} />
          ))}
        </div>
      )}
        </div>
      </section>
    </>
  );
}
