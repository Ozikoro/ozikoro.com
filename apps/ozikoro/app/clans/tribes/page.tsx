/**
 * The divisions of the register — the level above the clans.
 *
 * WHY THIS PAGE SAYS "DIVISION" AND THE ADDRESS SAYS "TRIBES"
 *
 * The table holding this level is `tribe`, the column pointing at it is `clan.tribe_id`, and the owner's
 * brief for this section calls them tribes. The register's own writing calls them **divisions**, and so does
 * the dictionary's own interface, which labels this filter group "Division". The reason is in
 * `0015_clans.sql` and in the import file: the level directly below a division is what the sources call a
 * tribe — Western Igbo's three are Ukwuani, Enuani and Ika — and calling both levels a tribe is how a reader
 * is led to conclude that the Igbo are several peoples rather than one. The address keeps the brief's word;
 * the page uses the word that cannot be misread, and says why.
 *
 * WHAT IS ON THE PAGE, AND WHAT IS NOT
 *
 * Each division's own note, exactly as the register holds it, and the entries filed under it. Nothing is
 * summarised and nothing is added: a division with no note shows no note. The note is the register's, not
 * this page's, which is why it is quoted rather than rewritten.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getPlaceFacets, listPlaces, placeKindSingular, type PlaceSummary } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'The divisions',
  description:
    'The divisions of the Igbo world the archive files its clans under, each with the register’s own note and the entries it holds.',
  alternates: { canonical: 'https://ozikoro.com/clans/tribes' },
};

export default async function DivisionsPage() {
  const db = await getDb();
  const [facets, register] = await Promise.all([
    getPlaceFacets(db),
    listPlaces(db, { limit: 400 }),
  ]);

  const members = new Map<string, PlaceSummary[]>();
  for (const place of register.data) {
    if (!place.tribeSlug) continue;
    const held = members.get(place.tribeSlug);
    if (held) held.push(place);
    else members.set(place.tribeSlug, [place]);
  }

  const unassigned = register.data.filter((place) => !place.tribeSlug);

  return (
    <>
      <section className="sx-discovery-hero">
        <div className="wrap">
          <p className="eyebrow">The register</p>
          <h1>The divisions of the Igbo world</h1>
          <p className="lede">
            Six regional divisions, each holding the clans and towns the sources file under it. The level
            below a division — Ukwuani, Enuani, Ika and the rest — is where the word <em>tribe</em> belongs:
            calling both levels a tribe is how a reader is led to conclude that the Igbo are several peoples.
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
        {facets.tribes.map((tribe) => {
          const held = members.get(tribe.slug) ?? [];
          return (
            <section key={tribe.slug} id={tribe.slug} className="section">
              <div className="sx-head">
                <div>
                  <p className="eyebrow">Division</p>
                  <h2>{tribe.name}</h2>
                </div>
                <p className="small muted">
                  {held.length} {held.length === 1 ? 'entry' : 'entries'}
                </p>
              </div>

              {tribe.note ? (
                <div className="prose">
                  <p>{tribe.note}</p>
                </div>
              ) : (
                <p className="small muted">
                  No note is recorded for this division yet, so none is shown.
                </p>
              )}

              {held.length > 0 ? (
                <ul className="chips section">
                  {held.map((place) => (
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
              ) : (
                <p className="small muted">Nothing published in the register is filed under this division.</p>
              )}
            </section>
          );
        })}

        {unassigned.length > 0 ? (
          <section className="section">
            <div className="sx-head">
              <div>
                <p className="eyebrow">Not yet filed</p>
                <h2>No division recorded</h2>
              </div>
              <p className="small muted">
                {unassigned.length} {unassigned.length === 1 ? 'entry' : 'entries'}
              </p>
            </div>
            <p className="small muted">
              The register does not place these entries in a division. That is the state of the research
              rather than a claim that they belong to none.
            </p>
            <ul className="chips section">
              {unassigned.map((place) => (
                <li key={place.slug}>
                  <Link className="chip" href={`/clans/${place.slug}/`}>
                    <span className="oz-igbo" lang="ig">
                      {place.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="sx-source-note sx-light-note">
          The {facets.total} published entries are listed in full on the{' '}
          <Link href="/clans">register index</Link>, and the region each is recorded in on the{' '}
          <Link href="/clans/regions">regions</Link> page. Each division&rsquo;s note is the
          register&rsquo;s own.
        </p>
      </section>
    </>
  );
}
