/**
 * The regions of the register.
 *
 * WHAT A REGION IS HERE, AND WHY IT IS SHOWN AS FREE TEXT
 *
 * `clan.region` holds the present-day state or the plain geographic area an entry is recorded in. It is a
 * text column, not a foreign key, and migration 0025 treats it that way deliberately: a region is what a
 * source states, so an entry the research has not placed says nothing rather than being assigned to the
 * nearest guess. The values in production are seven present-day states plus one entry recorded as spanning
 * two, and one entry with no region at all — which is why the last section on this page is a count and not a
 * region.
 *
 * A REGION IS NOT AN ORIGIN
 *
 * Where an entry is recorded today is not a statement about where its people came from, and this page makes
 * no such statement. It groups by the column the register holds and names no origin for any entry.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getPlaceFacets, listPlaces, placeKindSingular, type PlaceSummary } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The regions',
  description:
    'The present-day states and areas the archive’s clan register records its entries in, with the entries held in each.',
  alternates: { canonical: 'https://ozikoro.com/clans/regions' },
};

/** An anchor from a region's own text, so `Imo and Abia` is linkable without renaming it. */
function anchor(region: string): string {
  return region
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function RegionsPage() {
  const db = await getDb();
  const [facets, register] = await Promise.all([
    getPlaceFacets(db),
    listPlaces(db, { limit: 400 }),
  ]);

  const held = new Map<string, PlaceSummary[]>();
  for (const place of register.data) {
    if (!place.region) continue;
    const bucket = held.get(place.region);
    if (bucket) bucket.push(place);
    else held.set(place.region, [place]);
  }

  const unrecorded = register.data.filter((place) => !place.region);

  return (
    <>
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">The register</p>
          <h1>The regions</h1>
          <p className="lede">
            The present-day state or area each entry is recorded in, as the sources give it. A region is where
            an entry is recorded, not where its people came from: an entry the research has not placed is
            listed at the foot of this page as not recorded, rather than being assigned to the nearest one.
          </p>
          <form className="search" method="get" action="/clans">
            <label className="sr-only" htmlFor="q">
              Find a clan, town or region
            </label>
            <input id="q" name="q" type="search" placeholder="Find a clan, a town or a region" />
            <button className="btn btn-gold" type="submit">
              Find
            </button>
          </form>
        </div>
      </section>

      <section className="wrap section">
        {facets.regions.map((region) => {
          const bucket = held.get(region.region) ?? [];
          return (
            <section key={region.region} id={anchor(region.region)} className="section">
              <div className="sx-head">
                <div>
                  <p className="eyebrow">Region</p>
                  <h2>{region.region}</h2>
                </div>
                <p className="small muted">
                  {bucket.length} {bucket.length === 1 ? 'entry' : 'entries'}
                </p>
              </div>
              <ul className="chips">
                {bucket.map((place) => (
                  <li key={place.slug}>
                    <Link className="chip" href={`/clans/${place.slug}/`}>
                      <span className="oz-igbo" lang="ig">
                        {place.name}
                      </span>
                      <span className="small muted">{placeKindSingular(place.kind)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="section" id="not-recorded">
          <div className="sx-head">
            <div>
              <p className="eyebrow">Not recorded</p>
              <h2>Region not recorded</h2>
            </div>
            <p className="small muted">
              {facets.regionsUnrecorded} {facets.regionsUnrecorded === 1 ? 'entry' : 'entries'}
            </p>
          </div>
          <p className="small muted">
            The register does not record a region for{' '}
            {facets.regionsUnrecorded === 1 ? 'this entry' : 'these entries'}. A region is a fact a source
            states, so it is left blank rather than guessed.
          </p>
          {unrecorded.length > 0 ? (
            <ul className="chips">
              {unrecorded.map((place) => (
                <li key={place.slug}>
                  <Link className="chip" href={`/clans/${place.slug}/`}>
                    <span className="oz-igbo" lang="ig">
                      {place.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <p className="sx-source-note sx-light-note">
          All {facets.total} published entries are listed in full on the{' '}
          <Link href="/clans">register index</Link>, and the divisions they are filed under on the{' '}
          <Link href="/clans/tribes">divisions</Link> page. A region is the archive&rsquo;s own column, and
          it is shown as the register holds it.
        </p>
      </section>
    </>
  );
}
