/**
 * /admin/entities — the knowledge graph, and the one button that fills it.
 *
 * WHY THIS SCREEN EXISTS AT ALL
 *
 * The archive's filter rail can offer a clan, a town or an ethnic group only if a record is linked
 * to one, and the link lives in `ozikoro_article_entity` pointing at `ozikoro_entity`. **That table
 * held zero rows**, so every one of those filters was provably empty and `/admin/archive` could not
 * report a single record as naming a place. The 188 published clans and their 995 towns already
 * exist in the dictionary, migrated and sourced; what was missing was the node that points at them.
 *
 * WHAT THE BUTTON DOES
 *
 * It runs `buildEntityGraph`, which is also what `npm run build:entities` runs. Every published clan
 * becomes one entity whose identity is the dictionary row, and every record whose TITLE names one
 * of them is linked to it. **Coordinates are not written** — the dictionary holds none and the
 * brief forbids inventing them, which is why the number is stated on the screen rather than left
 * for a reader to assume.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It attaches no periods and no sources. Those need somebody to read the record and decide, and
 * that is `/admin/archive`. A graph builder that guessed them would be inventing history with a
 * progress bar.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getEntityGraphState } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;
  // Editors own the graph; the layout lets them into the back office and this asks for the capability.
  await requireCapabilityOrRedirect('edit_entity', '/admin/entities');

  const db = await getDb();
  const state = await getEntityGraphState(db);

  const pct = (n: number) => `${Math.round((n / Math.max(state.records, 1)) * 100)}%`;

  return (
    <>
      <Head title="The knowledge graph">
        <Link className="btn btn--sm" href="/admin">
          Back to overview
        </Link>
        <Link className="btn btn--sm" href="/admin/archive">
          Editorial queue
        </Link>
      </Head>

      <Notices saved={notices.saved} error={notices.error} />

      <Card title="What the graph holds">
        <AtAGlance
          rows={[
            ['Entities', state.entities.toLocaleString('en-GB')],
            ['Links from a record to an entity', state.articleLinks.toLocaleString('en-GB')],
            [
              'Records naming a place',
              `${state.articlesWithAPlace.toLocaleString('en-GB')} of ${state.records.toLocaleString('en-GB')} (${pct(state.articlesWithAPlace)})`,
            ],
            ['Relations between entities', state.relations.toLocaleString('en-GB')],
            /*
             * THE ZERO THAT MATTERS MOST, STATED RATHER THAN OMITTED.
             *
             * A map is the platform's most visually ambitious layer and it is explicitly not built
             * (brief §3.5). What a reader could reasonably conclude from an empty map is that
             * somebody forgot; the honest answer is that no coordinate exists for any of these
             * places in this archive, and inventing one is the one thing the brief forbids.
             */
            ['With coordinates', `${state.withCoordinates.toLocaleString('en-GB')} — the dictionary holds none, and the brief forbids inventing them`],
            ['Published rows in the dictionary', state.dictionaryPublished.toLocaleString('en-GB')],
            [
              'Of those, not a place anybody names',
              `${state.dictionaryNotPlaces.toLocaleString('en-GB')} — colonial sections and administrative groupings`,
            ],
          ]}
        />
        <p className="help">
          An entity is one thing the archive knows about: a clan, a town, a kingdom, a people. The
          dictionary already holds {state.dictionaryPublished.toLocaleString('en-GB')} published
          clans and towns and this archive does not restate them — an entity points at the dictionary
          row, so the two cannot disagree about a name or a state.
        </p>
      </Card>

      <Card title={state.entities > 0 ? 'Entities by kind' : 'Nothing in the graph yet'}>
        {state.byKind.length === 0 ? (
          <p className="help">
            The graph is empty, which is the state the archive has been in since the migration. No
            record can name a clan, a town or an ethnic group until an entity exists to point at, so
            every one of those filters on <Link href="/archive">the archive index</Link> is
            genuinely empty rather than broken.
          </p>
        ) : (
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Entities</th>
              </tr>
            </thead>
            <tbody>
              {state.byKind.map((k) => (
                <tr key={k.kind}>
                  <td>{k.kind.replace(/_/g, ' ')}</td>
                  <td className="small">{k.n.toLocaleString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Build the graph from the dictionary">
        <p>
          One pass over the dictionary&rsquo;s {state.dictionaryPublished.toLocaleString('en-GB')}{' '}
          published clans and towns. Each becomes an entity named by the dictionary&rsquo;s own
          record, with its own aliases and its own summary — nothing is written here that is not
          already recorded there.
        </p>
        <p className="help">
          A record is linked to a place only when its <strong>title</strong> names one. A title match
          is evidence the record is about the place; a match anywhere in the body is evidence the
          place was mentioned, which is a much weaker claim — so the run links fewer records than a
          body search would, and every link it makes is defensible. The rest is editorial work, and
          the queue is where it is done.
        </p>
        <p className="help">
          <strong>Running it twice is safe and does nothing the second time.</strong> A clan is
          identified by the dictionary row it came from, not by its name, so a second run links
          nothing that is already linked and creates nothing that already exists. New clans
          published in the dictionary are picked up by the next run.
        </p>
        <form method="post" action="/api/admin/entities">
          <input type="hidden" name="action" value="build-graph" />
          <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
            <button className="btn btn--primary" type="submit">
              {state.entities === 0 ? 'Build the graph' : 'Bring the graph up to date'}
            </button>
          </p>
        </form>
        <p className="help">
          Every entity created and every record linked writes an <code>ozikoro_audit</code> row
          naming the account that ran it. What that produced is readable on{' '}
          <Link href="/admin/audit">the audit trail</Link>.
        </p>
      </Card>
    </>
  );
}
