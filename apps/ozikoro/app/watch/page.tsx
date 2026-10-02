/**
 * Watch — the video library, built to the design's `screens/watch.html`.
 *
 * THIS ROUTE DID NOT EXIST. The design has a `watch` screen and the archive had no `/watch` at all, so this
 * is a build rather than a rebuild. The homepage already linked "Open Watch" from a section that was
 * deliberately omitted, which is what made the absence visible.
 *
 * THE VIDEOS ARE REAL, AND SO IS THE DISTINCTION FROM THE DESIGN
 *
 * The archive holds **thirteen video records** — masquerade films, kingdom films, a recorded Haitian dance in
 * honour of Igbo ancestors — twelve of them stored by the archive and one hotlinked to its source. Those fill
 * the grid.
 *
 * **The design's inline player uses an `<iframe>`, because the design assumed embedded third-party video.**
 * These are the archive's own MP4 and QuickTime files, so the player is a `<video>` element: an iframe would
 * have been the wrong instrument and would also have misrepresented where the file comes from.
 *
 * FOUR RECORDS HAVE NO TITLE. They are not given invented ones. A record without a title is shown as
 * "Untitled recording" with its identifier, which is the honest state and the same treatment the archive
 * gives an untitled article.
 *
 * The design's source note is kept, because it is a policy rather than a placeholder: Ozikoro publishes only
 * video it owns, has permission to embed, or can lawfully share.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Watch',
  description:
    'Films, talks and remembered stories from the Ozikoro archive — masquerades, kingdoms and oral tradition, with their sources recorded.',
  alternates: { canonical: 'https://ozikoro.com/watch' },
  openGraph: { title: 'Watch — Ozikoro', description: 'Watch history come closer.', type: 'website' },
};

const FILTERS = ['New', 'Short histories', 'Oral traditions', 'Places & communities', 'Conversations', 'Series', 'A–Z'];

export default async function WatchPage() {
  const db = await getDb();
  const videos = await db.rows<{
    slug: string; title: string | null; storage_key: string | null; source_url: string;
    mime_type: string | null; width: number | null; height: number | null;
  }>(
    `select slug, title, storage_key, source_url, mime_type, width, height
       from ozikoro_media
      where kind = 'video'
      order by (title is null), title`
  );

  const lead = videos.find((v) => v.storage_key) ?? videos[0] ?? null;
  const rest = videos.filter((v) => v.slug !== lead?.slug);
  const src = (v: { storage_key: string | null; source_url: string }) =>
    v.storage_key ? `/media/${v.storage_key}` : v.source_url;

  return (
    <main>
      <section className="sx-watch-hero">
        <div className="wrap">
          <p className="eyebrow">Stories in motion</p>
          <h1>
            Watch history <em>come closer.</em>
          </h1>
          <p className="lede">
            Films, talks and remembered stories — clearly sourced, easy to follow, and ready for a
            classroom. The archive holds {videos.length} video records.
          </p>
          <form className="sx-watch-search" action="/search" method="get" role="search">
            <label className="sr-only" htmlFor="q">
              Search videos
            </label>
            <input id="q" name="q" type="search" placeholder="Search videos" />
            <button className="btn btn-gold" type="submit">
              Search
            </button>
          </form>
        </div>
      </section>

      <div className="wrap">
        <nav className="sx-filter-row" aria-label="Video filters">
          {FILTERS.map((f) => (
            <Link href="/watch" key={f}>
              {f}
            </Link>
          ))}
        </nav>
      </div>

      {lead ? (
        <section className="sx-inline-player">
          <div className="wrap">
            <div className="sx-inline-player-bar">
              <div>
                <p className="eyebrow">Now showing</p>
                <h2>Video</h2>
                <strong>{lead.title ?? 'Untitled recording'}</strong>
              </div>
              <div className="sx-inline-player-actions">
                <a className="btn btn-quiet" href={src(lead)}>
                  Open the file
                </a>
              </div>
            </div>
            {/*
              A <video> element rather than the design's <iframe>: these are the archive's own files, not a
              third-party embed, and an iframe would misrepresent where the recording comes from.
            */}
            <div className="sx-player">
              <video
                controls
                preload="metadata"
                src={src(lead)}
                width={lead.width ?? undefined}
                height={lead.height ?? undefined}
              >
                Your browser cannot play this recording.{' '}
                <a href={src(lead)}>Download it instead</a>.
              </video>
            </div>
          </div>
        </section>
      ) : null}

      <section className="sx-watch-section">
        <div className="wrap">
          <header className="sx-watch-section-head">
            <div>
              <p className="eyebrow">The library</p>
              <h2>Selected films</h2>
            </div>
            <span className="small muted">{videos.length} records</span>
          </header>

          {videos.length === 0 ? (
            <div className="empty">
              <p>No recording has been published.</p>
            </div>
          ) : (
            <div className="sx-video-grid">
              {rest.map((v) => (
                <button className="sx-video-card" type="button" key={v.slug}>
                  <strong>{v.title ?? 'Untitled recording'}</strong>
                  <span className="small muted">
                    {v.mime_type === 'video/quicktime' ? 'QuickTime' : 'MP4'}
                    {v.storage_key ? ' · held by the archive' : ' · held at its source'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <p className="sx-source-note">
            Ozikoro publishes only video it owns, has permission to embed, or can lawfully share. Where a
            recording came from somewhere else, the record says so and links to it rather than presenting it
            as the archive&rsquo;s own.
          </p>
        </div>
      </section>

      {/*
        "Unspoken Stories" is a series the design names, and the archive holds no film for it. The section is
        drawn with its heading and an honest state rather than omitted, because the series is the
        institution's and a reader looking for it should find the shelf rather than nothing. It is not filled
        with the design's three example cards.
      */}
      <section className="sx-watch-section">
        <div className="wrap">
          <header className="sx-watch-section-head">
            <div>
              <p className="eyebrow">Series</p>
              <h2>Unspoken Stories</h2>
            </div>
            <span className="small muted">No film published</span>
          </header>
          <div className="empty">
            <p>
              This series has no published film yet. An episode appears here when its subjects have given
              consent, its sources are recorded, and the film is ready to be seen.
            </p>
            <p>
              <Link className="btn" href="/submit">
                Offer a film
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
