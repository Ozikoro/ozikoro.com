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
 * WHAT IT DOES NOT DO, AND WHAT IT NOW DOES
 *
 * **The register itself has no replace and no delete, and it still has no upload control** — one item's own
 * description is edited at `/admin/media/[id]`, which is where the "Edit the record" link on each card leads.
 * The file itself has no delete path anywhere in the archive: 3,443 objects against 3,488 rows, and 307 files
 * with no row at all whose keys were deliberately not invented.
 *
 * **Adding a NEW file is possible, and it is not on this screen.** `/api/admin/media/upload` stores a file
 * and opens its record, and it is reached from the media picker on the writing screens — "Add Media" and "Set
 * featured image" — because that is where a person is when they want a picture. This paragraph used to read
 * *"No file is uploaded, replaced or deleted anywhere"*, which stopped being true when that route was added;
 * it is corrected here rather than left as a claim a reader would act on.
 *
 * AND THE REGISTER IS NOW PICTURES.
 *
 * The owner asked for the archive's media section to look like his own design, whose library is a grid of
 * thumbnails rather than a list of names. Every card's picture is a real `ozikoro_media` row fetched from its
 * own `/media/<key>` address, and **a record that is not a picture is drawn as a labelled plate rather than
 * given a stand-in image** — a broken `<img>` would be the archive claiming to hold a picture it does not.
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
import { MediaThumb } from '../classic-editor/media-thumb';
import '../classic-editor/media-register.css';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

/**
 * The design's subtab row: `All (126) | Images (98) | Audio (9) | Video (7) | Documents (12)`.
 *
 * The labels are the design's own words, and each tab asks the register for its own count under the filters
 * already in force — see `kindCounts`. `dataset` is not a tab: the archive holds none, and a tab reading
 * "(0)" would be a link to an empty grid. Those records still appear under **All**, which is where a filter
 * that does not name them belongs.
 */
const SUBTABS = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
  { value: 'document', label: 'Documents' },
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

  /*
   * THE SUBTAB COUNTS, ASKED OF THE REGISTER FOR EACH KIND AND UNDER THE FILTERS ALREADY CHOSEN.
   *
   * The design draws `All (126) | Images (98) | Audio (9) …`. Those numbers are only useful if they answer
   * the question the screen is currently asking, so each one is a `count(*)` under the same rights state and
   * the same search the grid below is showing — **not the table's total, which would be a different number
   * from the one a click produces.** Five counts over a table of a few thousand rows is cheaper than the
   * grid's own query.
   */
  const kindCounts = await Promise.all(
    SUBTABS.map((tab) => countMediaRegister(db, { kind: tab.value === 'all' ? null : tab.value, rights, search }))
  );

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
        {/*
          THE SUBTABS, THE FILTERS AND THE GRID ARE THE DESIGN'S OWN STRUCTURE, SCOPED UNDER `.mediareg`.

          The class names are the owner's (`subtabs`, `filters`, `media-grid`, `media`, `thumb`, `mi`,
          `pager`, `pg`, `status`, `input`, `select`, `btn`) and they are scoped because the admin shell has
          its own stylesheet: a bare `.status` or `.pg` would reach every other admin screen. See
          `media-register.css`, which says the same thing where the rules are written.
        */}
        <div className="mediareg">
          <nav className="subtabs" aria-label="Filter by kind">
            {SUBTABS.map((tab, index) => (
              <a
                key={tab.value}
                href={query({ kind: tab.value === 'all' ? undefined : tab.value, page: undefined })}
                aria-current={kind === tab.value ? 'page' : undefined}
              >
                {tab.label} ({kindCounts[index]!.toLocaleString('en-GB')})
              </a>
            ))}
          </nav>

          <form method="get" action="/admin/media" className="filters">
            {/* The kind is carried by the subtabs above, so the form keeps it in a hidden field. */}
            <input type="hidden" name="kind" value={kind} />
            <label className="visually-hidden" htmlFor="rights">Rights basis</label>
            <select className="select" id="rights" name="rights" defaultValue={rights}>
              {RIGHTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <label className="visually-hidden" htmlFor="q">Search</label>
            <div className="search">
              <input
                className="input"
                id="q"
                name="q"
                type="search"
                defaultValue={search ?? ''}
                placeholder="Search titles"
              />
              <button className="btn btn--sm btn--primary" type="submit">Search</button>
            </div>
          </form>

          {stats.total === 0 ? (
            <p className="help" style={{ marginTop: '1rem' }}>
              The archive holds no media at all. That is the real state of
              <span className="mono"> ozikoro_media</span>, not a failure to load: the 3,488 files arrive from
              the WordPress import, so an empty table means that import has not run.
            </p>
          ) : items.length === 0 ? (
            <p className="help" style={{ marginTop: '1rem' }}>
              Nothing matches {search ? `“${search}”` : 'that filter'}. Nothing has been hidden — the register
              holds {stats.total.toLocaleString('en-GB')} items and none of them answers this question.
            </p>
          ) : (
            <>
              <p className="meta" style={{ margin: '0 0 0.6rem' }}>
                {total.toLocaleString('en-GB')} {total === 1 ? 'item' : 'items'}
                {total > PAGE_SIZE ? `, showing ${items.length} on page ${page} of ${lastPage}` : ''}
              </p>

              {/*
                ⚠️ THE DESIGN DRAWS A `.mc` CHECKBOX ON EVERY CARD AND NO CHECKBOX IS DRAWN HERE.

                A tick box exists to select rows for a bulk action, and this archive has no bulk media route:
                `/api/admin/media` acts on ONE `mediaId` per request — a caption save or a move to the trash.
                A checkbox with no Apply button behind it is the exact fault the owner has reported three
                times, so the control is not rendered. **What the card does draw is the three real links
                below**, and one of them moves a record to the trash.
              */}
              <div className="media-grid">
                {items.map((item) => (
                  <div className="media" key={item.id}>
                    <div className="thumb">
                      {item.kind === 'image' ? (
                        /*
                          The picture is the record's own file, at its own /media/<key> address, drawn through
                          `MediaThumb` so that a row whose object is genuinely absent becomes a labelled plate
                          rather than the browser's broken-image glyph. See that component.
                        */
                        <MediaThumb
                          src={item.url}
                          alt={item.altText ?? ''}
                          label={KIND_LABEL[item.kind] ?? item.kind}
                          file={item.url ? item.url.split('/').pop()! : 'file not held'}
                        />
                      ) : (
                        <span className="thumb__plate">
                          <strong>{KIND_LABEL[item.kind] ?? item.kind}</strong>
                          <span className="thumb__file">{item.url ? item.url.split('/').pop() : 'file not held'}</span>
                        </span>
                      )}
                    </div>
                    <div className="mi">
                      <b title={item.title}>{item.title}</b>
                      <small>
                        {KIND_LABEL[item.kind] ?? item.kind}
                        {humanBytes(item.filesizeBytes) ? ` · ${humanBytes(item.filesizeBytes)}` : ''}
                      </small>
                      <small className="mono">{item.reference}</small>
                      <small>
                        <span
                          className={`status ${
                            item.rightsRecorded
                              ? item.restricted || !item.allowsPublication
                                ? 'draft'
                                : 'published'
                              : ''
                          }`}
                        >
                          {item.rightsRecorded
                            ? item.restricted
                              ? 'restricted by decision'
                              : item.allowsPublication
                                ? 'permits publication'
                                : 'checked, does not permit publication'
                            : 'no rights recorded'}
                        </span>
                      </small>
                      <small>
                        {item.usedByArticles} {item.usedByArticles === 1 ? 'placement' : 'placements'}
                        {item.creator || item.credit ? ` · ${item.creator ?? item.credit}` : ''}
                      </small>
                      <span className="mi__actions">
                        {item.url ? (
                          <a className="btn btn--sm" href={item.url} target="_blank" rel="noopener noreferrer">
                            Open
                          </a>
                        ) : null}
                        <a className="btn btn--sm btn--primary" href={`/admin/media/${item.id}`}>
                          Edit
                        </a>
                        <a className="btn btn--sm" href={`/admin/rights/?filter=all&item=${item.id}`}>
                          Rights
                        </a>
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <nav className="pager" aria-label="Pagination">
                {page > 1 ? (
                  <a className="pg" href={query({ page: page - 1 === 1 ? undefined : String(page - 1) })}>
                    ‹ Previous
                  </a>
                ) : (
                  <span className="pg pg--off">‹ Previous</span>
                )}
                <span className="pg pg--active">{page}</span>
                <span className="pg pg--off">
                  page {page} of {lastPage}
                </span>
                {page < lastPage ? (
                  <a className="pg" href={query({ page: String(page + 1) })}>
                    Next ›
                  </a>
                ) : (
                  <span className="pg pg--off">Next ›</span>
                )}
              </nav>
            </>
          )}
        </div>
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
          <strong>No file is replaced or deleted anywhere on this screen.</strong> There are 3,443 objects in
          the bucket against 3,488 records, and a further 307 files in
          <span className="mono"> data/media/ozikoro-wp</span> with no record at all. Keying those was
          deliberately declined — it would mean inventing keys — and an upload control here is how they would
          get invented by accident.
        </p>
        <p>
          <strong>A new file can be added, from the writing screens.</strong> The media picker behind{' '}
          <strong>Add Media</strong> and <strong>Set featured image</strong> uploads through{' '}
          <span className="mono">/api/admin/media/upload</span> and the file joins this register. It is not a
          control on this screen because a picture is chosen while writing, not while auditing.
        </p>
      </Card>
    </>
  );
}
