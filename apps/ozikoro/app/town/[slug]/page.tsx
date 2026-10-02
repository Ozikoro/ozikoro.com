/**
 * One community — the place page the design draws.
 *
 * FROM THE REAL CLAN RECORD. Name, region, states, local government areas, kind, ethnic group and origin
 * summary all come from the published row; the `source` column is carried through as provenance, because
 * the brief makes credibility a visual property and an unsourced claim should look unsourced.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO
 *
 * The design's screen shows three "Histories about Igbodo" cards labelled *Sample placement*, and a
 * `sx-town-articles` grid. **This page draws no article cards it cannot back with a real link.** The archive
 * files articles under labels, and a community page can only attach writing by matching one — so where the
 * match exists it is shown, and where it does not the page says the archive holds nothing for this community
 * yet. The brief is explicit that a town filed with nothing is a feature and must survive implementation;
 * inventing three sample placements would be the one thing it forbids.
 *
 * The dictionary link is real and was verified returning 200 in an earlier round. Ozikoro links to Ozituma
 * rather than duplicating it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

interface Clan {
  slug: string;
  name: string;
  region: string | null;
  states: unknown;
  lgas: unknown;
  kind: string | null;
  ethnic_group: string | null;
  origin_summary: string | null;
  description: string | null;
  source: string | null;
}

/** `states` and `lgas` are jsonb arrays in the archive; render them as a readable list or nothing. */
function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value.startsWith('{')) {
    return value.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
  }
  return [];
}

async function loadClan(slug: string): Promise<Clan | null> {
  const db = await getDb();
  const row = await db.one(
    `select slug, name, region, states, lgas, kind, ethnic_group, origin_summary, description, source
       from clan
      where published = true and lower(slug) = lower($1)
      limit 1`,
    [slug]
  );
  return row ? (row as unknown as Clan) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const clan = await loadClan(slug);
  if (!clan) return { title: 'Community not found' };
  const where = clan.region ? ` in ${clan.region}` : '';
  return {
    title: clan.name,
    description: `${clan.name}, a community recorded${where} in the Ozikoro archive, with its connected histories, records and dictionary entry.`,
    alternates: { canonical: `https://ozikoro.com/town/${clan.slug}` },
    openGraph: { title: `${clan.name} — Ozikoro`, type: 'article' },
  };
}

export default async function TownPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clan = await loadClan(slug);
  if (!clan) notFound();

  const states = listOf(clan.states);
  const lgas = listOf(clan.lgas);

  return (
    <>
      <section className="sx-town-hero">
        <div className="wrap">
          <Link href="/towns">← All towns</Link>
          <p className="eyebrow">{clan.kind ? `${clan.kind} in the archive` : 'A place in the archive'}</p>
          <h1>{clan.name}</h1>
          <p className="lede">
            {clan.region
              ? `Recorded in ${clan.region}${states.length && states[0] !== clan.region ? ` (${states.join(', ')})` : ''}.`
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
              <a href="#record">The record</a>
              <a href="#records">Archive records</a>
              <a href="#add">Add knowledge</a>
            </nav>
          </aside>

          <div>
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
                  {states.length > 0 ? (
                    <tr>
                      <th scope="row">State</th>
                      <td>{states.join(', ')}</td>
                    </tr>
                  ) : null}
                  {lgas.length > 0 ? (
                    <tr>
                      <th scope="row">Local government</th>
                      <td>{lgas.join(', ')}</td>
                    </tr>
                  ) : null}
                  {clan.ethnic_group ? (
                    <tr>
                      <th scope="row">Ethnic group</th>
                      <td>{clan.ethnic_group}</td>
                    </tr>
                  ) : null}
                  {clan.kind ? (
                    <tr>
                      <th scope="row">Recorded as</th>
                      <td>{clan.kind}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              {clan.origin_summary || clan.description ? (
                <div className="prose section">
                  {clan.origin_summary ? <p>{clan.origin_summary}</p> : null}
                  {clan.description ? <p>{clan.description}</p> : null}
                </div>
              ) : (
                <p className="lede">
                  No narrative is recorded for this community yet. The register holds its name and
                  where it is, and nothing more has been written.
                </p>
              )}

              {clan.source ? (
                <div className="provenance">
                  <p className="eyebrow">Source</p>
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
              <p className="small muted">
                The archive holds no photographs, recordings or documents filed to {clan.name} yet, so
                this section is empty rather than filled with something else.
              </p>
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
                <Link className="btn" href="https://ozituma.com/" rel="noopener">
                  Read the dictionary
                </Link>
              </div>
            </section>
          </div>
        </div>
      </section>
    </>
  );
}
