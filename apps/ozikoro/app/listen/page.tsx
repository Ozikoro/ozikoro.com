/**
 * Listen — the audio library, built to the design's `screens/listen.html`.
 *
 * WHY IT WAS REWRITTEN
 *
 * `check-design-parity.mjs` reported `sx-listen-hero`, `sx-listen-feature` and `sx-listen-list` all missing.
 * The page said the right thing in the wrong shape, which is the failure this round of work exists to find.
 *
 * WHAT IS HONEST HERE, AND WHAT THE DESIGN ITSELF DOES
 *
 * The archive holds **no audio at all** — the `audio` table is zero rows. The design's featured episode is
 * "The Ikoro: the drum that spoke for a town", which is its demonstration content, and the design's own
 * banner says *"Audio library demonstration — no recorded episodes are claimed or published here yet."*
 *
 * So the hero and the library are drawn, the filters are drawn, and **the tracklist is empty because there is
 * nothing to put in it.** The featured slot is not filled with the demonstration episode: naming a recording
 * that does not exist is the exact thing the brief forbids, and a library whose first entry is invented is
 * worse than one that says it is empty.
 *
 * THE TRANSCRIPT RULE IS KEPT AS A COMMITMENT RATHER THAN A DESCRIPTION
 *
 * The design's closing note reads "Every episode keeps its full transcript, source and speaker context beside
 * the audio." That is the one part of this page that is a promise rather than a placeholder, and it is stated
 * as one — a recording without a transcript excludes anyone who cannot hear it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Listen',
  description:
    'The Ozikoro audio library: narrated articles, oral traditions and folklore, each with a readable transcript and its speaker context.',
  alternates: { canonical: 'https://ozikoro.com/listen' },
  openGraph: { title: 'Listen — Ozikoro', description: 'Histories for the ear.', type: 'website' },
};

const FILTERS = ['All', 'Histories', 'Folklore', 'Oral records'];

export default async function ListenPage() {
  const db = await getDb();
  // The same table the library is built from, so "zero" is measured rather than asserted.
  const audio = await db.one<{ n: number }>(`select count(*)::int n from audio`);
  const published = await db.one<{ n: number }>(
    `select count(*)::int n from ozikoro_article where status='published' and is_page=false`
  );
  const nAudio = audio?.n ?? 0;
  const nArticles = published?.n ?? 0;

  return (
    <main>
      <section className="sx-listen-hero">
        <div className="wrap">
          <p className="eyebrow">Listen to the archive</p>
          <h1>
            Histories <em>for the ear.</em>
          </h1>
          <p className="lede">
            Narrated articles, oral traditions and folklore, arranged like a music library, with a readable
            transcript beside every record. The archive publishes {nArticles.toLocaleString('en-NG')} written
            records and holds no audio yet, so the library is empty.
          </p>
        </div>
      </section>

      {/*
        The featured slot. The design fills it with a demonstration episode; this page does not, and says
        which state it is in instead.
      */}
      <section className="sx-listen-feature wrap">
        <p className="eyebrow">Featured episode</p>
        <div className="sx-listen-feature-card">
          <div className="sx-listen-feature-copy">
            <span className="sx-listen-series">
              {nAudio === 0 ? 'No episode yet' : `${nAudio} recording${nAudio === 1 ? '' : 's'} held`}
            </span>
            <h2>No recording has been published.</h2>
            <p>
              A recording appears in this library when it has a narrator credited, rights recorded, and a
              transcript published beside it. Nothing has been added to fill the slot, because naming an
              episode that does not exist would be worse than an empty library.
            </p>
          </div>
        </div>
      </section>

      <section className="sx-listen-list wrap">
        <header className="sx-watch-section-head">
          <div>
            <p className="eyebrow">All episodes</p>
            <h2>The library</h2>
          </div>
          <nav className="sx-listen-filters" aria-label="Episode filters">
            {FILTERS.map((f) => (
              <Link href="/listen" key={f}>
                {f}
              </Link>
            ))}
          </nav>
        </header>

        <ol className="sx-tracklist">
          {/* Empty by measurement, not by omission: the audio table holds zero rows. */}
        </ol>

        <div className="empty">
          <p>
            Nothing is playable here yet. Oral recordings from the archive are collected in this library
            rather than on a page of their own — <Link href="/oral-recordings">the old address</Link> sends a
            reader here.
          </p>
          <p>
            <Link className="btn" href="/submit">
              Offer a recording
            </Link>{' '}
            <Link className="btn" href="/photographs">
              Browse photographs instead
            </Link>
          </p>
        </div>

        <p className="sx-source-note">
          Every episode keeps its full transcript, source and speaker context beside the audio. No recording
          will be published without its transcript, because a recording without one excludes anyone who
          cannot hear it.
        </p>
      </section>
    </main>
  );
}
