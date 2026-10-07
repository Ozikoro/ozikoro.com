/**
 * One entry in the clan register: a clan, a town, a section, a confederation, a kingdom or a grouping.
 *
 * THE DESIGN THIS REPRODUCES
 *
 * `public/design/screens/town.html` is the design's one-place page, and this is it: a `sx-town-hero` with
 * the back-link, the eyebrow, the `h1` and the lede; then `wrap section` holding a `sx-town-layout` — a
 * sticky `aside` with an "On this page" nav, and the main column of sections beside it; and at the foot of
 * that column the design's own `sx-correction` block, with its heading, its sentence and its button. The
 * classes, the arrangement and the type are the design's. Two things differ, and both are because the
 * design's screen is a demonstration:
 *
 *   * The hero carries no `<img>`. The design's hero has a photograph of Igbodo. `clan` has no image
 *     column, and a panel of the archive's own photographs for a place is a different job from this one —
 *     so no picture is shown rather than a picture borrowed from somewhere else. The app's existing
 *     `/town/[slug]` makes the same call.
 *   * The `sx-correction` copy says "Know this place?" where the design's says "Know this town?". The design
 *     is drawing a town; this page also serves clans, sections and confederations, and 151 of the register's
 *     188 published entries are not towns. The rest of the sentence is the design's, word for word.
 *
 * WHERE THE CONTENT COMES FROM, AND WHY SOME OF IT IS EMPTY
 *
 * Every field is read from the shared database: the name, aliases, kind, ethnic group, division, region,
 * present-day states and local government areas, the origin summary, the narrative paragraphs, the towns,
 * and the source. Nothing is invented, and nothing is inferred — `region`, `states` and `lgas` are nullable
 * and a blank one is shown as blank.
 *
 * The towns are only the towns a source enumerates. `0015_clans.sql` says so in the table's own comment:
 * "an empty `clan_town` set means the sources did not enumerate its towns, not that it has none." So an
 * entry with no towns gets a sentence saying exactly that, not a gap and not a guess. The same rule governs
 * the names: they are attached to a place by their documented origins, and an empty set means the name
 * material does not reach this place yet.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getPlace, placeKindSingular } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

function capitalise(word: string): string {
  return word.length === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const place = await getPlace(db, slug);
  if (!place) return { title: 'Entry not found' };
  const kind = placeKindSingular(place.kind);
  const where = place.region ? ` in ${place.region}` : '';
  return {
    title: place.name,
    description:
      place.originSummary ??
      `${place.name}, a ${kind} recorded${where} in the Ozikoro clan register, with its towns, its region and the names borne there.`,
    alternates: { canonical: `https://ozikoro.com/clans/${place.slug}` },
    openGraph: { title: `${place.name} — Ozikoro`, type: 'article' },
  };
}

export default async function ClanRegisterEntryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = await getDb();
  const place = await getPlace(db, slug);
  if (!place) notFound();

  const kindWord = capitalise(placeKindSingular(place.kind));
  const eyebrow = [place.ethnicGroup, kindWord, place.tribe ?? place.region]
    .filter(Boolean)
    .join(' · ');

  const firstState = place.states[0];
  const stateNote =
    firstState && firstState !== place.region ? ` (${place.states.join(', ')})` : '';

  return (
    <>
      <section className="sx-town-hero">
        <div className="wrap">
          <Link href="/clans">← All entries in the register</Link>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="oz-igbo" lang="ig">
            {place.name}
          </h1>
          <p className="lede">
            {place.region
              ? `Recorded in ${place.region}${stateNote}. `
              : 'The region for this entry is not recorded in the archive. '}
            A register entry gathers the towns the sources list, the names borne there and the records the
            archive holds, instead of opening only one article.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="sx-town-layout">
          <aside>
            <p className="eyebrow">On this page</p>
            <nav>
              <a href="#record">The record</a>
              <a href="#towns">Towns</a>
              <a href="#people">Names borne here</a>
              <a href="#records">Archive records</a>
              <a href="#contribute">Add knowledge</a>
            </nav>
          </aside>

          <div>
            <section id="record">
              <div className="sx-head">
                <div>
                  <p className="eyebrow">The record</p>
                  <h2>What the archive holds for {place.name}</h2>
                </div>
              </div>

              <table>
                <tbody>
                  <tr>
                    <th scope="row">Region</th>
                    <td>{place.region ?? <span className="unsourced">Not recorded</span>}</td>
                  </tr>
                  {place.states.length > 0 ? (
                    <tr>
                      <th scope="row">State</th>
                      <td>{place.states.join(', ')}</td>
                    </tr>
                  ) : null}
                  {place.lgas.length > 0 ? (
                    <tr>
                      <th scope="row">Local government</th>
                      <td>{place.lgas.join(', ')}</td>
                    </tr>
                  ) : null}
                  {place.tribe && place.tribeSlug ? (
                    <tr>
                      <th scope="row">Division</th>
                      <td>
                        <Link href={`/clans/tribes#${place.tribeSlug}`}>{place.tribe}</Link>
                      </td>
                    </tr>
                  ) : null}
                  <tr>
                    <th scope="row">Ethnic group</th>
                    <td>{place.ethnicGroup}</td>
                  </tr>
                  <tr>
                    <th scope="row">Recorded as</th>
                    <td>{placeKindSingular(place.kind)}</td>
                  </tr>
                  {place.aliases.length > 0 ? (
                    <tr>
                      <th scope="row">Also known as</th>
                      <td>
                        <span className="oz-igbo" lang="ig">
                          {place.aliases.join(', ')}
                        </span>
                      </td>
                    </tr>
                  ) : null}
                  {place.parent ? (
                    <tr>
                      <th scope="row">Part of</th>
                      <td>
                        <Link href={`/clans/${place.parent.slug}/`}>
                          <span className="oz-igbo" lang="ig">
                            {place.parent.name}
                          </span>
                        </Link>{' '}
                        <span className="small muted">({placeKindSingular(place.parent.kind)})</span>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              {place.originSummary || place.description.length > 0 ? (
                <div className="prose section">
                  {place.originSummary ? <p>{place.originSummary}</p> : null}
                  {/* One paragraph per element: the column is `text[]`, and welding them into one string
                      is how four paragraphs become one wall of text. */}
                  {place.description.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              ) : (
                <p className="lede">
                  No narrative is recorded for this entry yet. The register holds its name and where it is,
                  and nothing more has been written.
                </p>
              )}

              {place.members.length > 0 ? (
                <div className="section">
                  <p className="eyebrow">
                    Made up of {place.members.length}{' '}
                    {place.members.length === 1 ? 'entry' : 'entries'}
                  </p>
                  <ul className="chips">
                    {place.members.map((member) => (
                      <li key={member.slug}>
                        <Link className="chip" href={`/clans/${member.slug}/`}>
                          <span className="oz-igbo" lang="ig">
                            {member.name}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {place.source ? (
                <div className="provenance section">
                  <p className="eyebrow">Sources</p>
                  <p className="small">{place.source}</p>
                </div>
              ) : (
                <div className="unsourced section">
                  <p className="eyebrow">No source recorded</p>
                  <p className="small">
                    This record carries no source note. Treat it as unverified until one is added.
                  </p>
                </div>
              )}
            </section>

            <section id="towns" className="section">
              <div className="sx-head">
                <div>
                  <p className="eyebrow">Towns</p>
                  <h2>
                    {place.towns.length > 0
                      ? `The ${place.towns.length} ${place.towns.length === 1 ? 'town' : 'towns'} recorded inside ${place.name}`
                      : `Towns inside ${place.name}`}
                  </h2>
                </div>
              </div>
              {place.towns.length === 0 ? (
                <div className="unsourced">
                  <p className="eyebrow">No towns recorded</p>
                  <p>
                    The sources this entry rests on do not enumerate its towns. That is a gap in the record
                    rather than a statement that it has none — a source that lists them is what fills it.
                  </p>
                </div>
              ) : (
                <ul className="stack">
                  {place.towns.map((town) => (
                    <li key={town.name}>
                      <span className="oz-igbo" lang="ig">
                        {town.name}
                      </span>
                      {town.isHead ? <span className="small muted"> · the main town</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section id="people" className="section">
              <div className="sx-head">
                <div>
                  <p className="eyebrow">Names</p>
                  <h2>Names borne in {place.name}</h2>
                </div>
              </div>
              {place.names.length === 0 ? (
                <div className="unsourced">
                  <p className="eyebrow">No names recorded</p>
                  <p>
                    A name is attached to a place by its documented origin, and no published name in the
                    register names {place.name} yet. This is the state of the name material rather than a
                    statement about the names people bear.
                  </p>
                </div>
              ) : (
                <ul className="stack">
                  {place.names.map((name) => (
                    <li key={name.id}>
                      {/* The name register is the dictionary's, so the name itself is read there. */}
                      <a href={`https://ozituma.com/names/${name.slug}/`} rel="noopener noreferrer">
                        <span className="oz-igbo" lang="ig">
                          {name.name}
                        </span>
                      </a>
                      {name.meaning ? <span className="small muted"> · {name.meaning}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section id="records" className="section">
              <h2>Archive records</h2>
              <p className="lede">
                Photographs, oral testimony and documents connected to {place.name} appear here with their
                provenance.
              </p>

              {place.entitySlug || place.labelSlug ? (
                <ul className="stack section">
                  {place.entitySlug ? (
                    <li>
                      <Link href={`/entities/${place.entitySlug}/`}>
                        The knowledge-graph record for {place.name}
                      </Link>
                      <span className="small muted">
                        {' '}
                        · the archive&rsquo;s own entry, with the histories linked to it
                      </span>
                    </li>
                  ) : null}
                  {place.labelSlug ? (
                    <li>
                      <Link href={`/labels/${place.labelSlug}/`}>Records filed under {place.name}</Link>
                      <span className="small muted">
                        {' '}
                        · the migrated subject label of the same name
                      </span>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="small muted">
                  The archive holds no photograph, recording or document filed to {place.name} yet, so this
                  section names nothing rather than being filled with something else.
                </p>
              )}

              <Link className="btn" href="/documents" style={{ marginTop: '1.5rem' }}>
                Open the archive
              </Link>
            </section>

            <section className="sx-correction" id="contribute">
              <div>
                <h2>Know this place?</h2>
                <p>Suggest a correction, identify a person or contribute a connected history.</p>
              </div>
              <div className="row">
                <Link className="btn" href="/submit">
                  Add knowledge
                </Link>
              </div>
            </section>
          </div>
        </div>
      </section>
    </>
  );
}
