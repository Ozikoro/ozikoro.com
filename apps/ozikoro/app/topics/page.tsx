/**
 * Topics A–Z.
 *
 * The design draws this as a discovery index with a jump bar and letter sections. What fills it
 * here is real: 11,056 subjects migrated from the previous site's tags, which are how the existing
 * archive is found in search and the raw material the entity graph will resolve out of.
 *
 * It is deliberately not the whole list at once. A reader wants the subjects the archive actually
 * writes about, so each letter shows the most-used ones and says how many more there are. Listing
 * eleven thousand names on one page would be a data dump wearing an index's clothes.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getArchiveStats, listLabels, listTopics } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Topics',
  description: 'Every subject the Ozikoro archive writes about, A to Z.',
  alternates: { canonical: 'https://ozikoro.com/topics' },
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default async function TopicsPage() {
  const db = await getDb();
  const [series, stats] = await Promise.all([listTopics(db), getArchiveStats(db)]);

  // One query per letter would be 26 round trips; one query for the whole alphabet is one.
  const labels = await listLabels(db, { limit: 500 });
  const byLetter = new Map<string, { slug: string; name: string; articleCount: number }[]>();
  for (const label of labels) {
    const letter = (label.name[0] ?? '#').toUpperCase();
    const key = /[A-Z]/.test(letter) ? letter : '#';
    const bucket = byLetter.get(key) ?? [];
    bucket.push(label);
    byLetter.set(key, bucket);
  }
  const usedLetters = LETTERS.filter((l) => (byLetter.get(l)?.length ?? 0) > 0);

  return (
    <main>
      {/*
        The design's discovery hero. Its eyebrow is "A simple index" and its h1 "Topics A–Z", and the search
        form sits inside the hero rather than below it — a reader arrives to find a subject, so the box that
        finds one belongs with the title.
      */}
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">A simple index</p>
          <h1>Topics A–Z</h1>
          <p className="lede">
            Find a subject without knowing which collection or category holds it. The archive writes about{' '}
            {series.length} series and {stats.labels.toLocaleString('en-NG')} subjects.
          </p>
          <form className="search" action="/search" method="get" role="search">
            <label className="sr-only" htmlFor="q">
              Search topics
            </label>
            <input id="q" name="q" type="search" placeholder="Search topics" />
            <button className="btn btn-gold" type="submit">
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="wrap section">
        <nav className="sx-az-jump" aria-label="Jump to a letter">
          {/* A letter with subjects is a link; one without is a span, which is the design's own empty state
              and the honest one — a link to an empty section teaches a reader that the index lies. */}
          {LETTERS.map((letter) =>
            byLetter.has(letter) ? (
              <a href={`#letter-${letter}`} key={letter}>
                {letter}
              </a>
            ) : (
              <span key={letter} aria-hidden="true">
                {letter}
              </span>
            )
          )}
        </nav>

        <section className="section">
          <p className="eyebrow">Series</p>
          <nav className="sx-cats" aria-label="Series">
            {series.map((topic) => (
              <Link href={`/topics/${topic.slug}/`} key={topic.slug}>
                {topic.name} <span className="muted">{topic.articleCount}</span>
              </Link>
            ))}
          </nav>
        </section>

        <div className="sx-az-grid">
          {usedLetters.map((letter) => {
            const entries = byLetter.get(letter) ?? [];
            const shown = entries.slice(0, 40);
            return (
              <section className="sx-az-letter" id={`letter-${letter}`} key={letter}>
                <h2>{letter}</h2>
                <ul>
                  {shown.map((label) => (
                    <li key={label.slug}>
                      <Link href={`/labels/${label.slug}/`}>{label.name}</Link>
                      {label.articleCount > 0 ? (
                        <span className="muted small"> {label.articleCount}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {entries.length > shown.length ? (
                  <p className="muted small">
                    {entries.length - shown.length} more under {letter}, reachable through search.
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
