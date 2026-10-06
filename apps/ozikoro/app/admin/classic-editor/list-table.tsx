'use client';

/**
 * The list table: All Posts, and All Pages.
 *
 * ── WHAT THIS REPRODUCES ────────────────────────────────────────────────────────────────────────────
 *
 * WordPress's `edit.php`: the row of status links at the top of the table — `All | Published | Drafts |
 * Pending | Trash`, each with its count — the bulk-action dropdown, the columns, and the row actions that
 * appear on hover (`Edit | Quick Edit | Trash | Preview`, and `Restore | Delete Permanently` in the bin).
 *
 * ── THE TWO LISTS ARE TWO TABLES, NOT ONE TABLE WITH A FILTER ──────────────────────────────────────
 *
 * `kind` is a required prop and it goes into every submission, so a row can only ever act on a piece of
 * the kind the list it appeared in holds. The endpoint checks it again against `is_page`, so a hand-made
 * request cannot use the posts list to edit a page. The owner's brief asks for them as different menus and
 * different lists, and the schema's own `is_page` is what makes that structural rather than cosmetic.
 *
 * ── QUICK EDIT IS A ROW, NOT A SCREEN, WHICH IS THE POINT OF IT ────────────────────────────────────
 *
 * WordPress's Quick Edit expands under the row so that the thing being changed and the thing being looked
 * at are in the same place. This does that. **And it deliberately does NOT offer "Published"**: changing a
 * draft to published from a table — with no body on the screen — is the one transition this archive will
 * not make from a checkbox. Publications go through the editor, and `quickEditPiece` refuses the
 * transition with the same sentence the refusal here shows.
 */
import { Fragment, useState } from 'react';

export type PieceKind = 'post' | 'page';

export interface ListRow {
  id: number;
  title: string;
  slug: string;
  status: string;
  author: string | null;
  topic: string | null;
  topicId: number | null;
  tags: string[];
  publishedAt: string | null;
  modifiedAt: string | null;
  deletedFromStatus: string | null;
}

export interface ListCounts {
  all: number;
  publish: number;
  draft: number;
  pending: number;
  trash: number;
}

export interface ListTableProps {
  kind: PieceKind;
  rows: ListRow[];
  counts: ListCounts;
  status: string;
  search: string;
  /** The address of this exact list, including its filters, so a write returns to what was on screen. */
  returnTo: string;
  /** Base list address without query, for the status links. */
  baseHref: string;
  /** `?page=` handling. */
  page: number;
  hasNextPage: boolean;
  canPublish: boolean;
  topics: { id: number; name: string }[];
  writers: { id: number; name: string }[];
  /** Whether these rows are the bin, which changes the actions a row offers. */
  isTrashView: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  review: 'Pending',
  published: 'Published',
  archived: 'Archived',
  trashed: 'Trash',
};

function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

export function ListTable(props: ListTableProps) {
  const { kind, rows, counts, status, search, returnTo, baseHref, page, hasNextPage, canPublish } = props;
  const isPage = kind === 'page';
  const noun = isPage ? 'Page' : 'Post';

  const [selected, setSelected] = useState<number[]>([]);
  const [quickEdit, setQuickEdit] = useState<number | null>(null);
  const [bulkAction, setBulkAction] = useState('');

  const statusLinks: { key: string; label: string; count: number; href: string }[] = [
    { key: 'all', label: 'All', count: counts.all, href: `${baseHref}${search ? `?s=${encodeURIComponent(search)}` : ''}` },
    { key: 'publish', label: 'Published', count: counts.publish, href: `${baseHref}?status=publish${search ? `&s=${encodeURIComponent(search)}` : ''}` },
    { key: 'draft', label: 'Drafts', count: counts.draft, href: `${baseHref}?status=draft${search ? `&s=${encodeURIComponent(search)}` : ''}` },
    { key: 'pending', label: 'Pending', count: counts.pending, href: `${baseHref}?status=pending${search ? `&s=${encodeURIComponent(search)}` : ''}` },
    { key: 'trash', label: 'Trash', count: counts.trash, href: `${baseHref}?status=trash${search ? `&s=${encodeURIComponent(search)}` : ''}` },
  ];

  const toggleAll = (checked: boolean) => setSelected(checked ? rows.map((r) => r.id) : []);
  const allChecked = rows.length > 0 && selected.length === rows.length;

  /** What the bulk dropdown offers depends on which list this is, exactly as WordPress's does. */
  const bulkOptions = props.isTrashView
    ? [
        { value: '', label: 'Bulk actions' },
        { value: 'restore', label: 'Restore' },
      ]
    : [
        { value: '', label: 'Bulk actions' },
        { value: 'trash', label: 'Move to Trash' },
        ...(canPublish ? [{ value: 'draft', label: 'Return to draft' }] : []),
      ];

  return (
    <div className="wplist">
      <div className="tablenav">
        <form method="post" action="/api/admin/posts" id={`bulk-${kind}`} style={{ display: 'contents' }}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="action" value="bulk" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="ids" value={selected.join(',')} />
          <label className="screen-reader-text" htmlFor={`bulk-action-${kind}`}>
            Select bulk action
          </label>
          <select
            id={`bulk-action-${kind}`}
            name="bulkAction"
            value={bulkAction}
            onChange={(event) => setBulkAction(event.target.value)}
          >
            {bulkOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="submit" className="button" disabled={selected.length === 0 || bulkAction === ''}>
            Apply
          </button>
          {selected.length > 0 ? <span className="small muted">{selected.length} selected</span> : null}
        </form>
        <span className="displaying-num">
          {counts.all + counts.trash} item{counts.all + counts.trash === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="wpadmin__subsubsub">
        {statusLinks.map((link) => (
          <li key={link.key}>
            <a href={link.href} className={status === link.key ? 'current' : undefined}>
              {link.label} <span className="wpadmin__count">({link.count})</span>
            </a>
          </li>
        ))}
      </ul>

      <form method="get" action={baseHref} className="tablenav">
        {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
        <label className="screen-reader-text" htmlFor={`search-${kind}`}>
          Search {noun}s
        </label>
        <input id={`search-${kind}`} type="search" name="s" defaultValue={search} placeholder={`Search ${noun}s`} />
        <button type="submit" className="button">
          Search {noun}s
        </button>
        {search ? (
          <a className="button" href={status === 'all' ? baseHref : `${baseHref}?status=${status}`}>
            Clear
          </a>
        ) : null}
      </form>

      {rows.length === 0 ? (
        /*
         * AN EMPTY STATE IS A REAL STATE. With nothing here the table says so and says which nothing it
         * is — a search with no matches and a list that is genuinely empty are different answers, and a
         * fabricated row would be the archive inventing a record.
         */
        <div className="postbox">
          <div className="inside empty-state">
            {search
              ? `No ${noun.toLowerCase()} matches “${search}”.`
              : status === 'trash'
                ? `The trash is empty. Nothing has been deleted, so there is nothing to restore.`
                : status === 'draft'
                  ? `No drafts. A ${noun.toLowerCase()} saved without being published appears here.`
                  : `No ${noun.toLowerCase()}s yet. “Add New” is the way to write the first one.`}
          </div>
        </div>
      ) : (
        <table className="wp-list-table">
          <thead>
            <tr>
              <td style={{ width: '2.2rem' }}>
                <input
                  type="checkbox"
                  aria-label={`Select all ${noun.toLowerCase()}s`}
                  checked={allChecked}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
              </td>
              <th scope="col" className="column-title">
                Title
              </th>
              <th scope="col" className="column-author">
                Author
              </th>
              {!isPage ? (
                <>
                  <th scope="col" className="column-categories">
                    Categories
                  </th>
                  <th scope="col" className="column-tags">
                    Tags
                  </th>
                </>
              ) : null}
              <th scope="col" className="column-date">
                {props.isTrashView ? 'Deleted from' : 'Date'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const editHref = `${baseHref}/${row.id}`;
              const permalink = `/${row.slug}/`;
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.title || 'the untitled piece'}`}
                        checked={selected.includes(row.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)
                          )
                        }
                      />
                    </td>
                    <td>
                      <a className="row-title" href={editHref}>
                        {row.title.trim() || (
                          <span className="row-title--empty">
                            (no title) <span className="post-state">— {STATUS_LABEL[row.status]?.toLowerCase() ?? row.status}</span>
                          </span>
                        )}
                      </a>
                      {row.title.trim() ? (
                        <>
                          {' '}
                          <span className="post-state">— {STATUS_LABEL[row.status] ?? row.status}</span>
                        </>
                      ) : null}
                      {/* The row actions, shown on hover and on keyboard focus. */}
                      <div className="row-actions">
                        <span>
                          <a href={editHref}>Edit</a>
                        </span>
                        {!props.isTrashView ? (
                          <span>
                            <button type="button" onClick={() => setQuickEdit(quickEdit === row.id ? null : row.id)}>
                              Quick Edit
                            </button>
                          </span>
                        ) : null}
                        {/*
                          THE ROW ACTIONS, WHICH ARE WORDPRESS'S OWN SET FOR THE STATE THE ROW IS IN.
                          A live row offers Edit | Quick Edit | Trash | Preview. A row in the bin offers
                          Restore | Delete Permanently — and "Delete Permanently" LEAVES THIS SCREEN, because
                          destroying something for good is `purge_trash`, which is the one act this archive
                          withholds from an editor and which lives on `/admin/trash` behind its own guard and
                          its own confirmation. A button here would be a second door to it.
                        */}
                        {props.isTrashView ? (
                          <>
                            <span>
                              <form method="post" action="/api/admin/posts" style={{ display: 'inline' }}>
                                <input type="hidden" name="kind" value={kind} />
                                <input type="hidden" name="action" value="restore" />
                                <input type="hidden" name="id" value={row.id} />
                                <input type="hidden" name="returnTo" value={returnTo} />
                                <button type="submit">Restore</button>
                              </form>
                            </span>
                            <span>
                              <a href="/admin/trash">Delete Permanently</a>
                            </span>
                          </>
                        ) : (
                          <span>
                            <form method="post" action="/api/admin/posts" style={{ display: 'inline' }}>
                              <input type="hidden" name="kind" value={kind} />
                              <input type="hidden" name="action" value="trash" />
                              <input type="hidden" name="id" value={row.id} />
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <button type="submit" className="submitdelete">
                                Trash
                              </button>
                            </form>
                          </span>
                        )}
                        {row.status === 'published' && !props.isTrashView ? (
                          <span>
                            <a href={permalink} target="_blank" rel="noopener noreferrer">
                              Preview
                            </a>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>{row.author ?? '—'}</td>
                    {!isPage ? (
                      <>
                        <td>{row.topic ?? '—'}</td>
                        {/*
                          A CAP ON THE TAGS A ROW PRINTS, AND IT STATES WHAT IT IS HOLDING BACK.
                          The archive's 11,056 imported tags mean one record can carry forty of them, and
                          a cell that prints all forty makes the row 700 px tall and the table unreadable —
                          which is a fault a list has. Measured on the first row of All Posts before this:
                          the tag cell alone was taller than the viewport. The remainder is counted rather
                          than dropped silently.
                        */}
                        <td>
                          {row.tags.length === 0
                            ? '—'
                            : `${row.tags.slice(0, 6).join(', ')}${row.tags.length > 6 ? ` … and ${row.tags.length - 6} more` : ''}`}
                        </td>
                      </>
                    ) : null}
                    <td>
                      {props.isTrashView
                        ? `${STATUS_LABEL[row.deletedFromStatus ?? 'draft'] ?? row.deletedFromStatus}`
                        : row.status === 'published'
                          ? `Published ${formatDay(row.publishedAt)}`
                          : row.status === 'draft'
                            ? `Last saved ${formatDay(row.modifiedAt)}`
                            : formatDay(row.publishedAt ?? row.modifiedAt)}
                    </td>
                  </tr>

                  {/*
                    THE QUICK EDIT ROW. It is a separate form from the bulk form above, deliberately: a
                    bulk action applies to the ticked rows and a quick edit applies to one, and one form
                    doing both is how a change lands on the wrong row.
                  */}
                  {quickEdit === row.id ? (
                    <tr className="quick-edit-row">
                      <td colSpan={isPage ? 4 : 6}>
                        <form method="post" action="/api/admin/posts">
                          <input type="hidden" name="kind" value={kind} />
                          <input type="hidden" name="action" value="quick-edit" />
                          <input type="hidden" name="id" value={row.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <div className="quick-edit-grid">
                            <div>
                              <label htmlFor={`qe-title-${row.id}`}>Title</label>
                              <input id={`qe-title-${row.id}`} name="title" type="text" defaultValue={row.title} />
                            </div>
                            <div>
                              <label htmlFor={`qe-slug-${row.id}`}>Slug</label>
                              <input id={`qe-slug-${row.id}`} name="slug" type="text" defaultValue={row.slug} />
                            </div>
                            <div>
                              <label htmlFor={`qe-author-${row.id}`}>Author</label>
                              <select id={`qe-author-${row.id}`} name="authorId" defaultValue="">
                                <option value="">— no byline —</option>
                                {props.writers.map((w) => (
                                  <option key={w.id} value={String(w.id)}>
                                    {w.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label htmlFor={`qe-date-${row.id}`}>Date</label>
                              <input
                                id={`qe-date-${row.id}`}
                                name="publishedAt"
                                type="datetime-local"
                                defaultValue={row.publishedAt ? row.publishedAt.slice(0, 16) : ''}
                              />
                            </div>
                            {!isPage ? (
                              <>
                                <div>
                                  <label htmlFor={`qe-topic-${row.id}`}>Category</label>
                                  <select id={`qe-topic-${row.id}`} name="topicId" defaultValue={row.topicId === null ? '' : String(row.topicId)}>
                                    <option value="">— none —</option>
                                    {props.topics.map((t) => (
                                      <option key={t.id} value={String(t.id)}>
                                        {t.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label htmlFor={`qe-tags-${row.id}`}>Tags</label>
                                  <input
                                    id={`qe-tags-${row.id}`}
                                    name="tags"
                                    type="text"
                                    defaultValue={row.tags.join(', ')}
                                    placeholder="separated by commas"
                                  />
                                </div>
                              </>
                            ) : null}
                            <div>
                              <label htmlFor={`qe-status-${row.id}`}>Status</label>
                              <select
                                id={`qe-status-${row.id}`}
                                name="status"
                                defaultValue={row.status === 'archived' ? 'draft' : row.status}
                              >
                                <option value="draft">Draft</option>
                                <option value="review">Pending</option>
                                {row.status === 'published' ? <option value="published">Published</option> : null}
                              </select>
                              <p className="wphelp">
                                Publishing is not the quick editor&rsquo;s: open the piece and use Publish, where its
                                title, its text and its date are in front of you.
                              </p>
                            </div>
                          </div>
                          <p style={{ marginTop: '10px' }}>
                            <button type="submit" className="button button-primary">
                              Update
                            </button>{' '}
                            <button type="button" className="button" onClick={() => setQuickEdit(null)}>
                              Cancel
                            </button>
                          </p>
                        </form>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="tablenav">
        {page > 1 ? (
          <a
            className="button"
            href={`${returnTo}${returnTo.includes('?') ? '&' : '?'}page=${page - 1}`}
          >
            ← Previous
          </a>
        ) : (
          <span />
        )}
        <span className="small muted">page {page}</span>
        {hasNextPage ? (
          <a className="button" href={`${returnTo}${returnTo.includes('?') ? '&' : '?'}page=${page + 1}`}>
            Next →
          </a>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
