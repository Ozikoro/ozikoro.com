/**
 * The editorial queue: the 1,051 migrated records, worst-documented first.
 *
 * This is the screen the technical scope asks for — "a re-tagging tool (even a simple internal admin
 * screen) so a human can go through each article and assign it to an ethnic group, sub-group, and
 * layer". It is deliberately plain: the work is deciding which clan a history is about and which
 * book it rests on, and a screen that drew attention to itself would be competing with that.
 *
 * It opens on the records with the least recorded about them, because that is where the archive's
 * credibility is thinnest: an entry with no source looks incomplete, and the design says so on the
 * page. Closing that gap is this queue's whole purpose.
 */
import { getDb } from '@ozituma/db/client';
import { getEditorialProgress, listEditorialQueue } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head } from '../ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const GAPS: { value: string; label: string }[] = [
  { value: 'any', label: 'Everything outstanding' },
  { value: 'sources', label: 'No source attached' },
  { value: 'period', label: 'No period' },
  { value: 'source_type', label: 'No source type' },
  { value: 'entities', label: 'No clan, town or place' },
  { value: 'topic', label: 'No series' },
];

export default async function ArchiveQueue({
  searchParams,
}: {
  searchParams: Promise<{ gap?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const gap = (params.gap ?? 'any') as 'any' | 'sources' | 'period' | 'source_type' | 'entities' | 'topic';
  const search = params.q?.trim() || null;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  // The page's own guard, FIRST and before any query. The layout's guard does not stop this page rendering:
  // React renders a layout and its children concurrently, so without this line an anonymous request returned
  // **307 with the queue's real rows in the body**. See `requireCapabilityOrRedirect`.
  await requireCapabilityOrRedirect('edit_entity', '/admin/archive');

  const db = await getDb();
  const [progress, items] = await Promise.all([
    getEditorialProgress(db),
    listEditorialQueue(db, { gap, search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  const pct = (n: number) => `${Math.round((n / Math.max(progress.records, 1)) * 100)}%`;

  return (
    <>
      <Head title="Editorial queue">
        <a className="btn btn--sm" href="/admin">
          Back to overview
        </a>
      </Head>

      <Card title="What the archive still needs">
        <AtAGlance
          rows={[
            ['Records', progress.records.toLocaleString('en-GB')],
            ['Have a series', `${progress.withSeries.toLocaleString('en-GB')} (${pct(progress.withSeries)})`],
            ['Have a source type', `${progress.withSourceType.toLocaleString('en-GB')} (${pct(progress.withSourceType)})`],
            ['Have a period', `${progress.withPeriod.toLocaleString('en-GB')} (${pct(progress.withPeriod)})`],
            ['Name a clan, town or place', `${progress.withEntities.toLocaleString('en-GB')} (${pct(progress.withEntities)})`],
            ['Rest on a source', `${progress.withSources.toLocaleString('en-GB')} (${pct(progress.withSources)})`],
            ['Fully documented', `${progress.fullyTagged.toLocaleString('en-GB')} (${pct(progress.fullyTagged)})`],
            ['Sources in the archive', progress.sources.toLocaleString('en-GB')],
            ['Entities in the graph', progress.entities.toLocaleString('en-GB')],
          ]}
        />
        <p className="help">
          Series came across from the WordPress categories, so every record already has one. The other
          four facets are the work, and nothing is filled in automatically: a script that guessed
          which clan a history is about would be inventing history.
        </p>
      </Card>

      <Card title="The queue">
        <form method="get" action="/admin/archive" className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <label className="visually-hidden" htmlFor="gap">Filter</label>
          <select id="gap" name="gap" defaultValue={gap}>
            {GAPS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
          <label className="visually-hidden" htmlFor="q">Search</label>
          <input id="q" name="q" type="search" defaultValue={search ?? ''} placeholder="Search by title" />
          <button className="btn btn--primary" type="submit">Apply</button>
        </form>

        {items.length === 0 ? (
          <p className="help" style={{ marginTop: '1rem' }}>
            Nothing matches. If you filtered to one gap, the archive has caught up on it.
          </p>
        ) : (
          <table className="record" style={{ marginTop: '1rem' }}>
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Series</th>
                <th scope="col">Still missing</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={`/admin/archive/${item.id}`}>{item.title}</a>
                    <div className="history__when">
                      {item.authorName ?? 'no author'} · {item.url}
                    </div>
                  </td>
                  <td className="small">{item.topicName ?? '—'}</td>
                  <td className="small">
                    {item.missing.length === 0
                      ? 'nothing'
                      : item.missing.join(', ')}
                    <div className="history__when">{item.completeness} of 5 facets</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <nav className="row" style={{ marginTop: '1rem' }} aria-label="Pagination">
          {page > 1 ? (
            <a className="btn btn--sm" href={`/admin/archive?gap=${gap}${search ? `&q=${encodeURIComponent(search)}` : ''}&page=${page - 1}`}>
              ← Previous
            </a>
          ) : <span />}
          <span className="small muted">page {page}</span>
          {items.length === PAGE_SIZE ? (
            <a className="btn btn--sm" href={`/admin/archive?gap=${gap}${search ? `&q=${encodeURIComponent(search)}` : ''}&page=${page + 1}`}>
              Next →
            </a>
          ) : <span />}
        </nav>
      </Card>
    </>
  );
}
