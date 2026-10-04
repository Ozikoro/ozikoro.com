/**
 * One community — the place page the design draws.
 *
 * FROM THE REAL REGISTER RECORD, THROUGH THE SHARED QUERY LAYER. Name, region, states, local government
 * areas, kind, ethnic group and origin summary all come from the published row; the `source` column is
 * carried through as provenance, because the brief makes credibility a visual property and an unsourced
 * claim should look unsourced.
 *
 * TWO FIXES WHILE THIS PAGE WAS OPEN, BOTH SMALL AND BOTH REAL
 *
 *   * The narrative was rendered as `{clan.description}` inside one `<p>`. `description` is `text[]`, so
 *     React was handed an array and concatenated four paragraphs into one unbroken wall with no space
 *     between them. It is now mapped, one `<p>` per paragraph — `places.ts` returns the array typed.
 *   * The SQL lives in `@ozikoro/platform`'s `places.ts` now. This was the only data-driven page in the app
 *     that kept its own query, and four routes read these rows.
 *
 * THE CANONICAL POINTS AT THE REGISTER
 *
 * `/town/<slug>/` serves the same record as `/clans/<slug>/`. Both exist — this one is the design's own
 * `town.html` and the register is the section built on it — so this page declares the register address as
 * its canonical and is left out of the sitemap. That is how duplicate content is declared rather than
 * duplicated, and it is the honest fix while the owner decides whether the two routes should be one.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO
 *
 * The design's screen shows three "Histories about Igbodo" cards labelled *Sample placement*, and a
 * `sx-town-articles` grid. **This page draws no article cards it cannot back with a real link.** The archive
 * files articles under labels, and a community page can only attach writing by matching one — so where the
 * match exists it is shown, and where it does not the page says the archive holds nothing for this community
 * yet. The brief is explicit that a town filed with nothing is a feature and must survive implementation;
 * inventing three sample placements would be the one thing it forbids.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { getEntityBySlug, getPlace, placeKindSingular } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const db = await getDb();
  const clan = await getPlace(db, slug);
  if (!clan) return { title: 'Community not found' };
  const where = clan.region ? ` in ${clan.region}` : '';
  return {
    title: clan.name,
    description: `${clan.name}, ${placeKindSingular(clan.kind)} recorded${where} in the Ozikoro archive, with its connected histories and records.`,
    // The register address is the canonical one for this record. See the note at the head of this file.
    alternates: { canonical: `https://ozikoro.com/clans/${clan.slug}` },
    openGraph: { title: `${clan.name} — Ozikoro`, type: 'article' },
  };
}

export default async function TownPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const clan = await getPlace(db, slug);
  if (!clan) notFound();

  /*
   * THE ARTICLES THE ARCHIVE LINKS TO THIS COMMUNITY.
   *
   * The design's town.html draws a `#histories` section — `<h2>Histories about <name></h2>` over an
   * `sx-town-articles` grid — and this page drew nothing there, because it read the REGISTER row
   * (`getPlace`, which has no article query) and never the KNOWLEDGE-GRAPH record. The relationship the
   * archive actually holds is `ozikoro_article_entity`, and `getEntityBySlug` already reads it:
   *
   *     where ae.entity_id = $1 and a.status = 'published' and a.is_page = false
   *
   * The design's three cards are labelled "Sample placement" and are never reproduced. Where the link
   * exists the card is real; where it does not, the page says so — which is what the brief requires and
   * what this page was doing for the wrong reason.
   */
  const entity = clan.entitySlug ? await getEntityBySlug(db, clan.entitySlug) : null;
  const histories = entity?.articles ?? [];

  return (
    <>
      <section className="sx-town-hero">
        <div className="wrap">
          <Link href="/towns">← All towns</Link>
          <p className="eyebrow">
            {placeKindSingular(clan.kind)} in the archive
          </p>
          <h1 className="oz-igbo" lang="ig">
            {clan.name}
          </h1>
          <p className="lede">
            {clan.region
              ? `Recorded in ${clan.region}${clan.states.length && clan.states[0] !== clan.region ? ` (${clan.states.join(', ')})` : ''}.`
              : 'The region for this community is not recorded in the archive.'}{' '}
            A place page gathers every related history, image, recording and document rather than
            opening only one article.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="sx-town-layout">
          <aside>
            <p className="eyebrow">On this page</p>
            <nav>
              <a href="#histories">Histories</a>
              <a href="#record">The record</a>
              <a href="#records">Archive records</a>
              <a href="#add">Add knowledge</a>
            </nav>
          </aside>

          <div>
            <section id="histories">
              <div className="sx-head">
                <div>
                  <p className="eyebrow">Connected writing</p>
                  <h2>Histories about {clan.name}</h2>
                </div>
              </div>
              {histories.length > 0 ? (
                <div className="sx-town-articles">
                  {histories.map((article) => (
                    <Link key={article.slug} href={`/${article.slug}/`}>
                      <small>{article.role} · {placeKindSingular(clan.kind)} record</small>
                      <strong>{article.title}</strong>
                      <span>Read article →</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="lede">
                  The archive links no published history to {clan.name} yet. Its neighbours&rsquo; histories
                  are not shown here, because a link to another community is not a history of this one.
                </p>
              )}
            </section>

            <section id="record">
              <div className="sx-head">
                <div>
                  <p className="eyebrow">The record</p>
                  <h2>What the archive holds for {clan.name}</h2>
                </div>
              </div>

              <table>
                <tbody>
                  <tr>
                    <th scope="row">Region</th>
                    <td>{clan.region ?? <span className="unsourced">Not recorded</span>}</td>
                  </tr>
                  {clan.states.length > 0 ? (
                    <tr>
                      <th scope="row">State</th>
                      <td>{clan.states.join(', ')}</td>
                    </tr>
                  ) : null}
                  {clan.lgas.length > 0 ? (
                    <tr>
                      <th scope="row">Local government</th>
                      <td>{clan.lgas.join(', ')}</td>
                    </tr>
                  ) : null}
                  {clan.tribe ? (
                    <tr>
                      <th scope="row">Division</th>
                      <td>{clan.tribe}</td>
                    </tr>
                  ) : null}
                  <tr>
                    <th scope="row">Ethnic group</th>
                    <td>{clan.ethnicGroup}</td>
                  </tr>
                  <tr>
                    <th scope="row">Recorded as</th>
                    <td>{placeKindSingular(clan.kind)}</td>
                  </tr>
                </tbody>
              </table>

              {clan.originSummary || clan.description.length > 0 ? (
                <div className="prose section">
                  {clan.originSummary ? <p>{clan.originSummary}</p> : null}
                  {/* One `<p>` per paragraph. `description` is `text[]`; rendering the array put four
                      paragraphs through one element and welded them together with nothing between them. */}
                  {clan.description.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              ) : (
                <p className="lede">
                  No narrative is recorded for this community yet. The register holds its name and
                  where it is, and nothing more has been written.
                </p>
              )}

              {clan.source ? (
                <div className="provenance">
                  <p className="eyebrow">Sources</p>
                  <p className="small">{clan.source}</p>
                </div>
              ) : (
                <div className="unsourced">
                  <p className="eyebrow">No source recorded</p>
                  <p className="small">
                    This record carries no source note. Treat it as unverified until one is added.
                  </p>
                </div>
              )}
            </section>

            <section className="section" id="records">
              <h2>Archive records</h2>
              <p className="lede">
                Photographs, oral testimony and documents connected to this community would appear
                here with provenance.
              </p>
              {clan.entitySlug || clan.labelSlug ? (
                <ul className="stack">
                  {clan.entitySlug ? (
                    <li>
                      <Link href={`/entities/${clan.entitySlug}/`}>
                        The knowledge-graph record for {clan.name}
                      </Link>
                    </li>
                  ) : null}
                  {clan.labelSlug ? (
                    <li>
                      <Link href={`/labels/${clan.labelSlug}/`}>Records filed under {clan.name}</Link>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="small muted">
                  The archive holds no photographs, recordings or documents filed to {clan.name} yet, so
                  this section is empty rather than filled with something else.
                </p>
              )}
            </section>

            <section className="sx-correction" id="add">
              <div>
                <h2>Add knowledge</h2>
                <p>
                  Corrections to a community record are reviewed before they are published, and a
                  published record is never silently replaced. The review trail stays visible.
                </p>
              </div>
              <div className="row">
                {/*
                  This pointed at ozituma.com's front page under the label "Read the dictionary", which is
                  neither a correction route nor this record's dictionary entry. The register entry on this
                  site is the page that holds the rest of this record — its towns, its names, its division
                  and its sources — so that is where a reader is sent.
                */}
                <Link className="btn" href={`/clans/${clan.slug}/`}>
                  The full register entry
                </Link>
              </div>
            </section>
          </div>
        </div>
      </section>
    </>
  );
}
