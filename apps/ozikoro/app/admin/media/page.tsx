/**
 * /admin/media — the media register: what the archive holds, and on what basis.
 *
 * WHY THIS IS A SEPARATE SCREEN FROM `/admin/rights`, WHICH ALREADY LISTS MEDIA
 *
 * They answer different questions and read the same table:
 *
 *   `/admin/rights`   **the work queue** — the 3,488 items nobody has checked, ordered by how many
 *                     published articles rest on each one, with the form that records a permission. It opens
 *                     on the numbers because "3,488 items with no rights recorded, used on N published
 *                     placements" is a legal exposure.
 *   `/admin/media`    **the register** — everything the archive holds, by kind, with its size, its credit and
 *                     whether any rights basis exists at all. It answers *"do we hold this, and on what
 *                     basis?"*, which is the question an editor asks while checking somebody else's claim.
 *
 * A register that only showed the unchecked items would be a work queue with a different title; a work queue
 * that showed every item would bury the 3,488 that need attention under the same list. Both are needed and
 * neither is the other, so the split is stated rather than left for a reader to infer.
 *
 * THE RIGHTS COLUMN IS THE RIGHTS TABLE, NOT THE LEGACY STRING.
 *
 * `ozikoro_media` carries `licence`, `credit` and `rights_note`, and WordPress filled none of them: every one
 * of the 3,488 rows has a null licence. The rights register already established that a rights basis means a
 * checked row in `ozikoro_media_rights`; reading the string column instead would report items as settled on
 * the strength of a value nobody recorded. The register shows which of the two it is reporting.
 *
 * WHAT IT DOES NOT DO
 *
 * No upload, no replace, no delete. **This register is a list, not an editor** — one item's own description
 * is edited at `/admin/media/[id]`, which is where the "Edit the record" link on each row leads. The file
 * itself has no write path anywhere in the archive: 3,443 objects against 3,488 rows, and 307 files with no
 * row at all whose keys were deliberately not invented.
 */
import { getDb } from '@ozituma/db/client';
import {
  countMediaRegister,
  getMediaStats,
  humanBytes,
  listMediaRegister,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head } from '../ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const KINDS = [
  { value: 'all', label: 'Every kind' },
  { value: 'image', label: 'Photographs' },
  { value: 'video', label: 'Video' },
  { value: 'document', label: 'Documents' },
  { value: 'audio', label: 'Audio' },
  { value: 'other', label: 'Other' },
];

const RIGHTS = [
  { value: 'all', label: 'Any rights state' },
  { value: 'missing', label: 'No rights recorded' },
  { value: 'recorded', label: 'Rights recorded' },
];

const KIND_LABEL: Record<string, string> = {
  image: 'Photograph',
  video: 'Video',
  document: 'Document',
  audio: 'Audio',
  dataset: 'Dataset',
  other: 'Other',
};

/** `1,240 × 900 · 240 KB`, or what is actually known about the file. */
function facts(item: {
  width: number | null;
  height: number | null;
  filesizeBytes: number | null;
  held: boolean;
}): string {
  const parts: string[] = [];
  if (item.width && item.height) parts.push(`${item.width} × ${item.height}`);
  const size = humanBytes(item.filesizeBytes);
  if (size) parts.push(size);
  if (!item.held) parts.push('file not held');
  return parts.join(' · ') || 'no size or dimensions recorded';
}

export default async function MediaRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; rights?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const kind = (params.kind ?? 'all').trim();
  const rights = (params.rights === 'recorded' || params.rights === 'missing' ? params.rights : 'all') as
    | 'all'
    | 'recorded'
    | 'missing';
  const search = params.q?.trim() || null;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  // The page's own guard, FIRST: this register lists what the archive holds with its credits, and an
  // anonymous request for it returned 307 with 50 KB of those rows in the body. See
  // `requireCapabilityOrRedirect`.
  await requireCapabilityOrRedirect('manage_media_rights', '/admin/media');

  const db = await getDb();
  const [stats, total, items] = await Promise.all([
    getMediaStats(db),
    countMediaRegister(db, { kind, rights, search }),
    listMediaRegister(db, { kind, rights, search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const query = (extra: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries({ kind, rights, q: search ?? undefined, ...extra })) {
      if (value && value !== 'all') usp.set(key, value);
    }
    const text = usp.toString();
    return `/admin/media${text ? `?${text}` : ''}`;
  };

  return (
    <>
      <Head title="Media register">
        <a className="btn btn--sm" href="/admin/rights/">
          Rights queue
        </a>
      </Head>

      <Card title="What the archive holds">
        <AtAGlance
          rows={[
            ['Items', stats.total.toLocaleString('en-GB')],
            ['Photographs', stats.images.toLocaleString('en-GB')],
            ['Video', stats.video.toLocaleString('en-GB')],
            ['Documents', stats.documents.toLocaleString('en-GB')],
            ['Audio', stats.audio.toLocaleString('en-GB')],
            ['Used by a published record', stats.usedByArticles.toLocaleString('en-GB')],
            ['With a rights record', stats.withRights.toLocaleString('en-GB')],
            ['Size on disk', humanBytes(stats.bytes) ?? 'not recorded'],
          ]}
        />
        <p className="help">
          Every figure is a <span className="mono">count(*)</span> over
          <span className="mono"> ozikoro_media</span>. A rights record means a checked row in
          <span className="mono"> ozikoro_media_rights</span> — <strong>not</strong> the licence string on the
          item, which the migration left null for every one of the {stats.total.toLocaleString('en-GB')} items.
        </p>
      </Card>

      <Card title="The register">
        <form method="get" action="/admin/media" className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
          <label className="visually-hidden" htmlFor="kind">Kind</label>
          <select id="kind" name="kind" defaultValue={kind}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="rights">Rights</label>
          <select id="rights" name="rights" defaultValue={rights}>
            {RIGHTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="q">Search</label>
          <input id="q" name="q" type="search" defaultValue={search ?? ''} placeholder="Search titles" />
          <button className="btn btn--sm btn--primary" type="submit">Apply</button>
        </form>

        {stats.total === 0 ? (
          <p className="help" style={{ marginTop: '1rem' }}>
            The archive holds no media at all. That is the real state of
            <span className="mono"> ozikoro_media</span>, not a failure to load: the 3,488 files arrive from the
            WordPress import, so an empty table means that import has not run.
          </p>
        ) : items.length === 0 ? (
          <p className="help" style={{ marginTop: '1rem' }}>
            Nothing matches {search ? `“${search}”` : 'that filter'}. Nothing has been hidden — the register
            holds {stats.total.toLocaleString('en-GB')} items and none of them answers this question.
          </p>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: '0.75rem' }}>
              {total.toLocaleString('en-GB')} {total === 1 ? 'item' : 'items'}
              {total > PAGE_SIZE ? `, showing ${items.length} on page ${page} of ${lastPage}` : ''}
            </p>

            <table className="record" style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Credit</th>
                  <th scope="col">Rights basis</th>
                  <th scope="col">Used by</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="mono small">{item.reference}</span>
                      <div>{item.title}</div>
                      <div className="history__when">{facts(item)}</div>
                    </td>
                    <td className="small">{KIND_LABEL[item.kind] ?? item.kind}</td>
                    <td className="small">
                      {item.creator ?? item.credit ?? 'no creator or credit recorded'}
                      {item.licence ? <div className="history__when">{item.licence}</div> : null}
                    </td>
                    <td className="small">
                      {item.rightsRecorded ? (
                        item.restricted ? (
                          'restricted by decision'
                        ) : item.allowsPublication ? (
                          'permits publication'
                        ) : (
                          'checked, does not permit publication'
                        )
                      ) : (
                        <>
                          not recorded
                          <div className="history__when">nothing is permitted</div>
                        </>
                      )}
                    </td>
                    <td className="small">
                      {item.usedByArticles} {item.usedByArticles === 1 ? 'placement' : 'placements'}
                    </td>
                    <td>
                      <div className="row" style={{ gap: '0.3rem', flexWrap: 'wrap' }}>
                        {item.url ? (
                          <a className="btn btn--sm" href={item.url} target="_blank" rel="noopener noreferrer">
                            Open the file
                          </a>
                        ) : null}
                        <a className="btn btn--sm btn--primary" href={`/admin/media/${item.id}`}>
                          Edit the record
                        </a>
                        <a className="btn btn--sm" href={`/admin/rights/?filter=all&item=${item.id}`}>
                          Record rights
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <nav className="row" style={{ marginTop: '1rem' }} aria-label="Pagination">
              {page > 1 ? (
                <a className="btn btn--sm" href={query({ page: String(page - 1) })}>← Previous</a>
              ) : <span />}
              <span className="small muted">page {page} of {lastPage}</span>
              {page < lastPage ? (
                <a className="btn btn--sm" href={query({ page: String(page + 1) })}>Next →</a>
              ) : <span />}
            </nav>
          </>
        )}
      </Card>

      <Card title="What this screen can and cannot do" quiet>
        <p>
          <strong>The register itself is a list.</strong> The write path is per record:{' '}
          <strong>Edit the record</strong> opens one item&apos;s own name, caption, alternative text,
          description, creator and credit, behind <span className="mono">edit_entity</span> — the same
          permission that edits a history. Recording a permission is a different job, on a different
          capability, and lives in the <a href="/admin/rights/">rights queue</a>.
        </p>
        <p>
          <strong>No file is uploaded, replaced or deleted anywhere.</strong> There are 3,443 objects in the
          bucket against 3,488 records, and a further 307 files in
          <span className="mono"> data/media/ozikoro-wp</span> with no record at all. Keying those was
          deliberately declined — it would mean inventing keys — and an upload control here is how they would
          get invented by accident.
        </p>
      </Card>
    </>
  );
}
