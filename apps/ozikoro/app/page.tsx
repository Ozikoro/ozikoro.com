/**
 * The archive homepage, built to the approved design's own structure.
 *
 * WHY THIS FILE WAS REWRITTEN
 *
 * It previously rendered five generic `<section class="wrap section">` blocks with an h1 of its own invention.
 * The approved design at `public/design/screens/home.html` has **seven named sections** — `sx-hero`,
 * `sx-marquee`, `sx-section sx-latest`, `sx-home-watch`, `sx-section sx-category-stage`, `sx-section sx-dark`,
 * `sx-section`, `sx-citation` — and none of them appeared on the page. The design FILES were byte-identical;
 * the page was not the design.
 *
 * Every class name below is the design's, and every piece of content is real: real clans from `clan`, real
 * publications from `ozikoro_article`, real series from `ozikoro_topic`, a real citation from `citationFor`.
 * **Where the design shows an element the archive cannot fill, it is left out rather than invented** — see the
 * notes at the watch and town sections.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { citationFor } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ozikoro — the stories of our towns, clans and kingdoms',
  description:
    'Read the histories of Igbo and African communities, explore old photographs and documents, and cite every record with a permanent address. Ozi Ikoro Limited.',
  alternates: { canonical: 'https://ozikoro.com' },
  openGraph: {
    title: 'Ozikoro — the stories of our towns, clans and kingdoms',
    description: 'Histories of Igbo and African communities, kept, told and cited.',
    type: 'website',
  },
};

export default async function HomePage() {
  const db = await getDb();

  const [latest, towns, topics, counts, featured] = await Promise.all([
    db.rows<{ slug: string; title: string; standfirst: string | null; published_at: string | null }>(
      `select a.slug, a.title, a.standfirst, a.published_at
         from ozikoro_article a
        where a.status = 'published' and a.is_page = false
        order by a.published_at desc nulls last
        limit 5`
    ),
    db.rows<{ slug: string; name: string; region: string | null }>(
      `select slug, name, region from clan where published = true order by name limit 12`
    ),
    db.rows<{ slug: string; name: string; n: number }>(
      `select t.slug, t.name, count(a.id)::int n
         from ozikoro_topic t
         left join ozikoro_article a on a.topic_id = t.id and a.status = 'published' and a.is_page = false
        group by t.slug, t.name
        order by n desc, t.name`
    ),
    Promise.all([
      db.one<{ n: number }>(`select count(*)::int n from ozikoro_article where status='published' and is_page=false`),
      db.one<{ n: number }>(`select count(*)::int n from clan where published = true`),
      db.one<{ n: number }>(`select count(*)::int n from ozikoro_media where kind='image'`),
    ]),
    db.one<{ slug: string; title: string; published_at: string | null }>(
      `select slug, title, published_at from ozikoro_article
        where status='published' and is_page=false order by published_at desc nulls last limit 1`
    ),
  ]);

  const nArticles = counts[0]?.n ?? 0;
  const nClans = counts[1]?.n ?? 0;
  const nImages = counts[2]?.n ?? 0;

  // The citation the design draws, from the newest real record rather than a placeholder reference.
  const cited = featured
    ? citationFor({
        authorName: 'Idenze Ezeme',
        title: featured.title,
        publishedAt: featured.published_at,
        url: `https://ozikoro.com/${featured.slug}/`,
      })
    : null;

  return (
    <main>
      {/* --- sx-hero ------------------------------------------------------- */}
      <section className="sx-hero">
        <div className="wrap">
          <p className="eyebrow fade-up">World of indigenous cultures, histories &amp; traditions</p>
          <h1 className="fade-up d1">
            The stories of our towns, clans and kingdoms — <em>kept, told and cited.</em>
          </h1>
          <p className="lede fade-up d2">
            Read the histories of Igbo and African communities, explore old photographs and documents, and
            send your own town&rsquo;s story to the archive. {nArticles.toLocaleString('en-NG')} records,{' '}
            {nClans.toLocaleString('en-NG')} towns, {nImages.toLocaleString('en-NG')} photographs.
          </p>
          <form className="search fade-up d3" action="/search" method="get">
            <label className="sr-only" htmlFor="q">
              Search the archive
            </label>
            <input id="q" name="q" type="search" placeholder="Search the archive" />
            <button className="btn btn-gold" type="submit">
              Search
            </button>
          </form>
          <div className="row fade-up d3">
            <Link className="btn btn-ghost" href="/archive">
              Browse all histories
            </Link>
            <Link className="btn btn-ghost" href="/submit">
              Share your town&rsquo;s story
            </Link>
          </div>
        </div>
      </section>

      {/* --- sx-marquee: the town names, from the clan table ---------------- */}
      <div className="sx-marquee">
        <Link className="sx-market-tab" href="/igbo-calendar">
          <b>Igbo Market Days</b>
          <em>See today →</em>
        </Link>
        <div className="sx-marquee-track">
          <ul>
            {[...towns, ...towns].map((t, i) => (
              <li key={`${t.slug}-${i}`}>{t.name}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* --- sx-section sx-latest ------------------------------------------ */}
      <section className="sx-section sx-latest">
        <div className="wrap">
          <div className="sx-archive-visual reveal">
            <div className="sx-archive-title">
              <p className="eyebrow">Newest on Ozikoro</p>
              <h2>Fresh from the archive</h2>
            </div>
          </div>
          <div className="sx-archive-index">
            {latest.map((a, i) => (
              <Link className="sx-archive-entry reveal" href={`/${a.slug}/`} key={a.slug}>
                <span className="index">{String(i + 1).padStart(2, '0')}</span>
                <span className="entry-copy">
                  <strong>{a.title}</strong>
                  {a.standfirst ? <span>{a.standfirst.slice(0, 160)}</span> : null}
                </span>
                <span className="more">Read history</span>
              </Link>
            ))}
          </div>
          <div className="sx-archive-foot reveal">
            <Link href="/archive">
              See all histories <span>→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* --- sx-home-watch --------------------------------------------------
          The design shows a lead film and three list items. The archive holds
          13 video records and NO published film pages, so the section is not
          drawn here rather than filled with names of films that do not exist.
          The Watch route itself is built and says what it holds.
      */}

      {/* --- sx-section sx-category-stage ---------------------------------- */}
      <section className="sx-section sx-category-stage">
        <div className="wrap">
          <div className="sx-head reveal">
            <div>
              <p className="eyebrow">The whole library</p>
              <h2>Browse by category</h2>
            </div>
            <span className="gold-rule" />
          </div>
          <nav className="sx-cats reveal" aria-label="Categories">
            {topics.map((t) => (
              <Link href={`/archive?topic=${encodeURIComponent(t.slug)}`} key={t.slug}>
                {t.name}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* --- sx-section sx-dark: the five doors, as the design draws them --- */}
      <section className="sx-section sx-dark">
        <div className="wrap">
          <div className="sx-head reveal">
            <div>
              <p className="eyebrow">Find your way in</p>
              <h2>What brings you here today?</h2>
            </div>
            <span className="gold-rule" />
          </div>
          <div className="sx-doors">
            <Link className="sx-door reveal" href="/towns">
              <span className="num">01</span>
              <strong>Find my family name or town</strong>
              <span>Start from a clan or a place and follow it through the record.</span>
            </Link>
            <Link className="sx-door reveal" href="/archive">
              <span className="num">02</span>
              <strong>Read for the first time</strong>
              <span>Long-form histories told from our own sources.</span>
            </Link>
            <Link className="sx-door reveal" href="/submit">
              <span className="num">03</span>
              <strong>Share photos or recordings</strong>
              <span>What we accept and the rights you keep.</span>
            </Link>
            <Link className="sx-door reveal" href="/cite">
              <span className="num">04</span>
              <strong>Cite or publish research</strong>
              <span>Permanent addresses and full citations.</span>
            </Link>
            <Link className="sx-door reveal" href="/about">
              <span className="num">05</span>
              <strong>Entrust a community history</strong>
              <span>How material is held and who may read it.</span>
            </Link>
          </div>
        </div>
      </section>

      {/* --- sx-section: explore by town ------------------------------------ */}
      <section className="sx-section">
        <div className="wrap">
          <div className="sx-head reveal">
            <div>
              <p className="eyebrow">Communities</p>
              <h2>Explore by town</h2>
            </div>
            <span className="gold-rule" />
            <Link className="btn btn-quiet" href="/towns">
              All towns
            </Link>
          </div>
          <div className="sx-strip reveal">
            {towns.map((t) => (
              <Link href={`/town/${t.slug}/`} key={t.slug}>
                <span>
                  <strong>{t.name}</strong>
                  {t.region ? <em>{t.region}</em> : null}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* --- sx-citation --------------------------------------------------- */}
      <section className="sx-citation">
        <div className="wrap sx-citation-inner reveal">
          <div className="sx-citation-intro">
            <p className="eyebrow">For students and researchers</p>
            <h2>Every history has a permanent address you can cite.</h2>
            <p>Copy a ready-made reference into your essay, thesis or book. The link will never move.</p>
            <Link className="btn btn-gold" href="/cite">
              How to cite Ozikoro
            </Link>
          </div>
          <div className="sx-citation-record">
            <div className="sx-record-top">
              <span>Ozikoro record</span>
              <span>Live</span>
            </div>
            <blockquote>
              {cited ?? 'No record is published yet.'}
            </blockquote>
            <div className="sx-record-foot">
              <span>Permanent link</span>
              <code>{featured ? `ozikoro.com/${featured.slug}` : '—'}</code>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
