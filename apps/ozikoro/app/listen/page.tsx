/**
 * Listen — the audio library.
 *
 * THE DESIGN'S OWN SCREEN ALREADY CARRIES THE HONEST LABEL
 *
 * `screens/listen.html` opens with a banner: *"Audio library demonstration — no recorded episodes are claimed
 * or published here yet."* That sentence is correct on a demonstration and, on the live site, the second half
 * of it is simply true: **the archive holds no audio at all.** Measured: the `audio` table is 0 rows.
 *
 * So this page keeps the design's structure — the hero, the library, the transcript promise — and carries no
 * episode. The featured slot the design draws ("The Ikoro: the drum that spoke for a town", *Sample episode —
 * recording awaiting approval*) is **not reproduced**, because it names a recording that does not exist and a
 * town history that has not been narrated. The brief is explicit that audio states remain labelled design
 * states until approved recordings exist, and that inventing episodes to fill a library is forbidden.
 *
 * WHAT THE DESIGN PROMISES AND WHAT THIS PAGE CAN HONESTLY SAY
 *
 * "Narrated articles, oral traditions and folklore — arranged like a music library, **with a readable
 * transcript beside every record**." That transcript rule is the one part of this page that is a commitment
 * rather than a placeholder, and it is stated as one: **no recording will be published here without its
 * transcript**, because a reader who cannot hear it is otherwise shut out.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Listen',
  description:
    'The Ozikoro audio library: narrated articles, oral traditions and folklore, each with a readable transcript. No recording has been published yet.',
  alternates: { canonical: 'https://ozikoro.com/listen' },
  openGraph: {
    title: 'Listen — Ozikoro',
    description: 'Histories for the ear.',
    type: 'website',
  },
};

export default function ListenPage() {
  return (
    <>
      <section className="sx-collection-hero">
        <div className="wrap">
          <p className="eyebrow">Listen to the archive</p>
          <h1>Histories for the ear.</h1>
          <p className="lede">
            Narrated articles, oral traditions and folklore, arranged like a library, with a readable
            transcript beside every record. The archive holds no audio yet, so the library is empty.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <nav className="sx-subnav" aria-label="Collections">
          <Link href="/photographs">Photographs</Link>
          <Link href="/documents">Documents</Link>
          <Link href="/listen">Oral recordings</Link>
          <Link href="/material-culture">Material culture</Link>
        </nav>

        <div className="empty section">
          <p className="eyebrow">The library</p>
          <h2>No recording has been published.</h2>
          <p>
            Nothing is playable here yet, and nothing will be added by default. A recording appears in this
            library when it has a narrator credited, rights recorded, and a transcript published beside it.
          </p>
        </div>

        <section className="section">
          <h2>What will appear here</h2>
          <p className="muted">
            Oral recordings from the archive are collected here rather than on a page of their own — the
            design&rsquo;s own note says so, and <Link href="/oral-recordings">the old address</Link> sends a
            reader to this library.
          </p>
        </section>

        <article className="sx-record-placeholder">
          <div>
            <small>Collection state</small>
            <h2>More verified recordings appear here</h2>
            <p>
              Every entry will carry its narrator, its rights, and a transcript — published together, because
              a recording without one excludes anyone who cannot hear it.
            </p>
            <p>
              <Link className="btn" href="/about">
                About Ozi Ikoro
              </Link>
            </p>
          </div>
        </article>
      </section>
    </>
  );
}
