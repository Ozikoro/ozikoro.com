/**
 * /admin/trash — what has been deleted, by whom, and the one button in this archive that destroys something.
 *
 * WHY THIS SCREEN EXISTS
 *
 * The owner's rule is that *"every content deleted will have to go to trash, unless permanently deleted from
 * trash"*, which makes the bin a real place with two jobs rather than a flag: **a delete is a move, and this
 * is where the move lands.** Before this screen there was nowhere for a deletion to go, so there was no
 * deletion at all — the archive's only statuses were draft, review, published and archived, and `archived`
 * meant "retired", not "removed".
 *
 * ⚠️ AND THE DESIGN DRAWS NO TRASH SCREEN. MEASURED, NOT ASSUMED.
 *
 * `dashboard-admin.html` and `dashboard-editor.html` draw navigation, metrics, task rows and module tiles, and
 * **no form and no list of deleted things**; there is no `dashboard-contributor.html` at all; and a search of
 * all 52 screens finds `trash` in none of them. So there is no drawn control to copy for a bin, and inventing
 * a panel is forbidden. **What is copied is the design's own vocabulary for a list of things**: a
 * `<table class="record">` with `<th scope="col">` heads and a `<th scope="row">` label column — the shape the
 * design uses in `upload.html` for "what the record will say" and the media register already uses here — a
 * `.btn` per action, the `.btn--primary` for the safe action and `.btn--danger` for destruction, and an
 * `.help` sentence where the list is empty. **A dedicated trash screen is a design decision for the owner**;
 * this is the archive's list vocabulary rather than a new one.
 */
import { getDb } from '@ozituma/db/client';
import {
  TRASH_PURGE_CAPABILITY,
  countTrash,
  listTrash,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head, Notices } from '../ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; info?: string; page?: string }>;
}) {
  const notices = await searchParams;
  const page = Math.max(1, Number.parseInt(notices.page ?? '1', 10) || 1);

  /*
   * The page's own guard, FIRST and before anything is read. Restoring is an edit, so the door is
   * `edit_entity` — an editor's. **The purge is NOT gated here**, because gating the whole page on
   * `purge_trash` would refuse an editor the restore the owner has said is theirs; the purge's own check is
   * made per row and again inside the write. The page asks for the capability only to decide whether to DRAW
   * the purge control, which is presentation and not authorisation.
   */
  const { capabilities } = await requireCapabilityOrRedirect('edit_entity', '/admin/trash');
  const mayPurge = capabilities.has(TRASH_PURGE_CAPABILITY);

  const db = await getDb();
  const [counts, items] = await Promise.all([
    countTrash(db),
    listTrash(db, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);
  const lastPage = Math.max(1, Math.ceil(counts.total / PAGE_SIZE));

  return (
    <>
      <Head title="Trash">
        <a className="btn btn--sm" href="/admin/archive">Editorial queue</a>
        <a className="btn btn--sm" href="/admin/media">Media register</a>
      </Head>

      <Notices saved={notices.saved} error={notices.error} info={notices.info} />

      <Card title="What is in the bin">
        <p className="small muted">
          {counts.total.toLocaleString('en-GB')} deleted{' '}
          {counts.total === 1 ? 'item' : 'items'} — {counts.articles.toLocaleString('en-GB')} record
          {counts.articles === 1 ? '' : 's'} and {counts.media.toLocaleString('en-GB')} media item
          {counts.media === 1 ? '' : 's'}. Nothing here has been destroyed.
        </p>
        <p className="help">
          A deleted record stops being served at its own address and leaves the archive. Its entities, its
          sources and its whole revision history are left exactly where they were, so restoring it returns it
          to the state it was taken out of — <strong>a record that was published comes back published</strong>.
        </p>
      </Card>

      {counts.total === 0 ? (
        <Card title="The bin is empty">
          <p className="help">
            Nothing has been deleted. That is the real state of the trash, not a failure to load: deleting a
            record from the archive queue or the media register moves it here, and nothing has been deleted
            since the trash was built.
          </p>
        </Card>
      ) : (
        <Card title="Deleted items">
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Was</th>
                <th scope="col">Deleted</th>
                <th scope="col">By</th>
                <th scope="col">Restore</th>
                <th scope="col">Destroy</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.kind}-${item.id}`}>
                  <td>
                    <span className="mono small">{item.reference}</span>
                    <div>{item.title}</div>
                    <div className="history__when">{item.detail}</div>
                  </td>
                  <td className="small">{item.wasStatus ?? '—'}</td>
                  {/*
                    WHO DELETED IT AND WHEN, WHICH THE OWNER NAMED AS NOT OPTIONAL. `deleted_by` is a foreign
                    key to `account`, so a null here means the account was deleted rather than that nobody was
                    recorded — and the cell says which.
                  */}
                  <td className="small">{new Date(item.deletedAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td className="small">{item.deletedByEmail ?? 'an account since deleted'}</td>
                  <td>
                    <form method="post" action="/api/admin/trash">
                      <input type="hidden" name="action" value="restore" />
                      <input type="hidden" name="kind" value={item.kind} />
                      <input type="hidden" name="id" value={item.id} />
                      <button className="btn btn--sm btn--primary" type="submit">Restore</button>
                    </form>
                  </td>
                  <td>
                    {mayPurge ? (
                      /*
                        THE CONFIRMATION NAMES THE ITEM. The operator types the record's own reference, which
                        is the only kind of confirmation a person actually reads, and it is compared inside the
                        write against a reference derived from the row — see `/api/admin/trash`.
                      */
                      <form method="post" action="/api/admin/trash">
                        <input type="hidden" name="action" value="purge" />
                        <input type="hidden" name="kind" value={item.kind} />
                        <input type="hidden" name="id" value={item.id} />
                        <label className="visually-hidden" htmlFor={`confirm-${item.kind}-${item.id}`}>
                          Type {item.reference} to destroy this
                        </label>
                        <input
                          id={`confirm-${item.kind}-${item.id}`}
                          name="confirm"
                          type="text"
                          placeholder={item.reference}
                          style={{ maxWidth: '10rem' }}
                          autoComplete="off"
                        />
                        <button className="btn btn--sm btn--danger" type="submit">
                          Destroy for good
                        </button>
                      </form>
                    ) : (
                      <span className="small muted">
                        Needs the “purge trash” permission, which this account does not have.
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <nav className="row" style={{ marginTop: '1rem' }} aria-label="Pagination">
            {page > 1 ? (
              <a className="btn btn--sm" href={`/admin/trash?page=${page - 1}`}>← Previous</a>
            ) : <span />}
            <span className="small muted">page {page} of {lastPage}</span>
            {page < lastPage ? (
              <a className="btn btn--sm" href={`/admin/trash?page=${page + 1}`}>Next →</a>
            ) : <span />}
          </nav>
        </Card>
      )}

      <Card title="What “destroy for good” does, exactly" quiet>
        <p>
          It is the only act in this archive that cannot be undone, and there is no undo because there is
          nothing left to undo it with. <strong>Type the item&apos;s reference to do it</strong> — a
          confirmation that names the thing is the only kind a person reads.
        </p>
        <p>
          <strong>Destroying a record destroys its links and its whole revision history with it</strong>,
          because <span className="mono">ozikoro_article_revision.article_id</span> and the four
          <span className="mono"> ozikoro_article_*</span> link tables are <span className="mono">on delete
          cascade</span>. <strong>That includes the 4,266 WordPress revisions</strong> — text that exists
          nowhere else, and the reason those tables were built.
        </p>
        <p>
          <strong>The audit rows survive.</strong> <span className="mono">ozikoro_audit.entity_id</span> has no
          foreign key to the record it is about, so the trail outlives the thing it is about and &ldquo;who
          destroyed this, and when&rdquo; stays answerable. The purge writes its audit row <em>before</em> it
          deletes, and refuses the whole act if that row cannot be written — an irreversible act with no record
          of its author is worse than no act at all.
        </p>
        <p>
          <strong>Destroying a media record does not destroy the file.</strong> This archive has no way to
          delete an object from storage, so the picture stays in the bucket and is still served to anyone who
          has the address — and the round that measured that bucket found the media host answers anonymous
          requests. A purge here removes the catalogue entry, not the photograph, and the notice says so rather
          than implying otherwise.
        </p>
      </Card>
    </>
  );
}
