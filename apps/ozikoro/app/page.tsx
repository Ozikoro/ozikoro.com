/**
 * The home page, showing the real archive.
 *
 * The design's home screen has five explicit doors, one per audience, and a hero. What this page
 * adds is that the archive underneath is the actual one: 1,057 migrated articles, the real
 * authors, the real series, the real counts. Nothing here is a designed placeholder, because the
 * plan forbids replacing real content with the demonstration values the design prototype used.
 *
 * The brief's rule that a reader should reach their own way in without reading the whole page is
 * why the doors come before any listing.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getArchiveStats, listArticles, listTopics } from '@ozikoro/platform';
import { ArticleEntry } from './_components/article-entry';

export const dynamic = 'force-dynamic';

const DOORS: { href: string; label: string; note: string }[] = [
  {
    href: '/search',
    label: 'Find a name, a town or a clan',
    note: 'Search the whole archive: histories, records, places and the sources behind them.',
  },
  {
    href: '/archive',
    label: 'Read the histories',
    note: 'Town and kingdom histories, migration records and colonial records, by series.',
  },
  {
    href: '/folklore',
    label: 'Read the folklores',
    note: 'Tales, customs and oral traditions, recorded as they were told.',
  },
  {
    href: '/researchers',
    label: 'Publish research',
    note: 'A profile, a paper and a place in the record for students and researchers.',
  },
  {
    href: '/about',
    label: 'Give to the archive',
    note: 'Documents, photographs, recordings and oral histories, and what happens to them.',
  },
];

export default async function HomePage() {
  const db = await getDb();
  const [stats, latest, topics] = await Promise.all([
    getArchiveStats(db),
    listArticles(db, { limit: 6 }),
    listTopics(db),
  ]);

  const populatedTopics = topics.filter((t) => t.articleCount > 0);

  return (
    <>
      <section className="wrap section">
        <div className="hero">
          <p className="eyebrow">Ozi Ikoro Limited</p>
          <h1>The history and archive of Igbo and African peoples</h1>
          <p className="lede">
            Town and kingdom histories, colonial records, oral histories and migration records —
            with the sources behind them, so the record can be checked and cited rather than
            taken on trust.
          </p>

          {/* A plain GET form, as the design requires: results get an address that can be cited. */}
          <form className="search" method="get" action="/search" role="search">
            <label className="small" htmlFor="q">
              Search the archive
            </label>
            <div className="row">
              <input id="q" name="q" type="search" placeholder="A town, a clan, a person, a period…" />
              <button className="btn btn-ink" type="submit">
                Search
              </button>
            </div>
          </form>

          {/* Real counts from the real tables, computed on every request. */}
          <div className="stat-row">
            <div className="stat">
              <b>{stats.articles.toLocaleString('en-GB')}</b>
              <span>records</span>
            </div>
            <div className="stat">
              <b>{populatedTopics.length}</b>
              <span>series</span>
            </div>
            <div className="stat">
              <b>{stats.contributors}</b>
              <span>contributors</span>
            </div>
            <div className="stat">
              <b>{stats.media.toLocaleString('en-GB')}</b>
              <span>media records</span>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <p className="eyebrow">Five ways in</p>
        <ul className="doors">
          {DOORS.map((door) => (
            <li key={door.href} className="door">
              <Link href={door.href}>
                <b>{door.label}</b>
              </Link>
              <p className="small muted">{door.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap section">
        <div className="row">
          <p className="eyebrow">Latest additions</p>
          <Link className="small" href="/archive">
            All {stats.articles.toLocaleString('en-GB')} records →
          </Link>
        </div>
        <div className="grid-3">
          {/* The heading level the design implies but does not draw: it jumps from the
              h1 straight to the h3 titles of its entries. The stylesheets style headings
              by element, so re-levelling the entries would change the approved design. */}
          <h2 className="visually-hidden">Latest records</h2>
          {latest.map((article) => (
            <ArticleEntry key={article.id} article={article} />
          ))}
        </div>
      </section>

      {populatedTopics.length > 0 ? (
        <section className="wrap section">
          <p className="eyebrow">Series</p>
          <ul className="chips">
            {populatedTopics.map((topic) => (
              <li key={topic.slug}>
                <Link className="chip" href={`/topics/${topic.slug}`}>
                  {topic.name} <span className="muted">{topic.articleCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Said plainly on the front page rather than hidden: the archive has just moved, and its
        structured tagging — sources, periods, clans, places — is being applied by editors. The
        brief asks that a thin archive feel intentional rather than broken, and the honest way to
        do that is to say what is happening.
      */}
      <section className="wrap section">
        <div className="partial-note">
          <p className="eyebrow">The state of this archive</p>
          <p>
            {stats.articles.toLocaleString('en-GB')} records have been carried across from the
            previous Ozikoro site with their text, authors, series and images intact. Their sources,
            periods and place relations are being attached by editors, entry by entry — until then
            each record says so on the page rather than implying a provenance it does not yet have.
          </p>
        </div>
      </section>
    </>
  );
}
