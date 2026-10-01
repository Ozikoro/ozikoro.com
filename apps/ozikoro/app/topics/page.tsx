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
    <div className="wrap section">
      <header>
        <p className="eyebrow">Discovery</p>
        <h1>Topics A–Z</h1>
        <p className="lede">
          {stats.labels.toLocaleString('en-GB')} subjects are filed in the archive, across{' '}
          {stats.articles.toLocaleString('en-GB')} records. These are the ones most written about.
        </p>
      </header>

      {series.filter((t) => t.articleCount > 0).length > 0 ? (
        <section className="section">
          <p className="eyebrow">Series</p>
          <ul className="chips">
            {series.filter((t) => t.articleCount > 0).map((topic) => (
              <li key={topic.slug}>
                <Link className="chip" href={`/topics/${topic.slug}`}>
                  {topic.name} <span className="muted">{topic.articleCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="section" aria-label="Jump to a letter">
        <ul className="chips">
          {usedLetters.map((letter) => (
            <li key={letter}>
              <a className="chip" href={`#letter-${letter}`}>{letter}</a>
            </li>
          ))}
        </ul>
      </nav>

      <form className="search section" method="get" action="/search" role="search">
        <label className="small" htmlFor="q">Search the archive instead</label>
        <div className="row">
          <input id="q" name="q" type="search" placeholder="A town, a clan, a person, a period…" />
          <button className="btn btn-ink" type="submit">Search</button>
        </div>
      </form>

      {usedLetters.map((letter) => (
        <section className="section" id={`letter-${letter}`} key={letter}>
          <h2>{letter}</h2>
          <ul className="chips">
            {(byLetter.get(letter) ?? []).slice(0, 40).map((label) => (
              <li key={label.slug}>
                <Link className="chip" href={`/labels/${label.slug}`}>
                  {label.name} <span className="muted">{label.articleCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="small muted section">
        Showing the most-used subjects. The remaining{' '}
        {(stats.labels - labels.length).toLocaleString('en-GB')} are reachable through{' '}
        <Link href="/search">search</Link> and through the record that carries them.
      </p>
    </div>
  );
}
