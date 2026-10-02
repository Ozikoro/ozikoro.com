/**
 * Towns & communities — the places the archive holds records about.
 *
 * FROM REAL DATA. Every town on this page is a published row in `clan`, with the region it is recorded in.
 * Nothing here is a sample: the design's own screen lists Igbodo, Amai, Akumazi and Abbi as demonstration
 * values, and this page lists the 188 clans the archive actually holds instead. The brief's rule is that
 * prototype values from the design screens are never real data, so the design supplies the layout and the
 * archive supplies the contents.
 *
 * A TOWN IS NOT A CLAN, AND THIS PAGE DOES NOT PRETEND THEY ARE THE SAME
 *
 * The archive's unit is the clan, and a clan may hold several towns — `clan_town` records 995 of those
 * relationships. This page lists the clans, because that is what the records are filed under, and says so
 * rather than labelling them towns when the distinction matters.
 *
 * The search is a plain GET form, so a filtered list is a bookmarkable, citable URL and works with
 * JavaScript off — the brief's behavioural requirement.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Towns & communities',
  description:
    'Places in the archive. Choose a community to see its connected histories, photographs, recordings and records together.',
  alternates: { canonical: 'https://ozikoro.com/towns' },
  openGraph: {
    title: 'Towns & communities — Ozikoro',
    description: 'Places in the archive, with their connected histories and records.',
    type: 'website',
  },
};

interface TownRow {
  slug: string;
  name: string;
  region: string | null;
}

export default async function TownsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? '').trim();

  const db = await getDb();
  const rows = await db.rows(
    `select slug, name, region
       from clan
      where published = true
        and ($1 = '' or name ilike '%' || $1 || '%' or coalesce(region, '') ilike '%' || $1 || '%')
      order by region nulls last, name
      limit 400`,
    [query]
  );

  const towns: TownRow[] = rows.map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    region: r.region == null ? null : String(r.region),
  }));

  // `db.one` is `T | null`, so this is read defensively rather than asserted. A count of zero is a
  // real answer here — an archive with nothing filed is the empty state, not an error.
  const totalRow = await db.one<{ n: number }>('select count(*)::int n from clan where published = true');
  const total = Number(totalRow?.n ?? 0);

  return (
    <>
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">Places in the archive</p>
          <h1>Towns &amp; communities</h1>
          <p className="lede">
            Choose a community to see its connected histories, photographs, recordings and records
            together.
          </p>
          <form className="search" method="get" action="/towns">
            <label className="sr-only" htmlFor="q">
              Find a town
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Find a town"
            />
            <button className="btn btn-gold" type="submit">
              Find
            </button>
          </form>
        </div>
      </section>

      <section className="wrap section">
        {towns.length === 0 ? (
          <div className="empty section">
            <p className="eyebrow">Nothing filed</p>
            <h2>No community matches “{query}”.</h2>
            <p>
              The archive holds {total} communities and none of them matches that. It may be spelled
              differently in the records, or it may not be filed yet.
            </p>
            <p>
              <Link className="btn" href="/towns">
                Show every community
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="sx-town-grid">
              {towns.map((town) => (
                <Link key={town.slug} href={`/town/${town.slug}/`}>
                  <span>
                    <small>{town.region ?? 'Region not recorded'}</small>
                    <strong>{town.name}</strong>
                    <em>View connected records →</em>
                  </span>
                </Link>
              ))}
            </div>
            <p className="sx-source-note sx-light-note">
              {query
                ? `${towns.length} of ${total} communities match “${query}”.`
                : `All ${total} communities the archive holds.`}{' '}
              Records come from the archive&rsquo;s clan register; a community filed without a region
              says so rather than being given one.
            </p>
          </>
        )}
      </section>
    </>
  );
}
