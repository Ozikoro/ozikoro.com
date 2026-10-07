'use client';

/**
 * The Categories and Tags tables — WordPress's `edit-tags.php`, as two client components.
 *
 * ── WHAT THE OWNER ASKED FOR, IN HIS WORDS ────────────────────────────────────────────────────────
 *
 *   *"on the admin that shows categories … why can't one edit the categories like it is on wordpress?
 *    same as tags? i could edit the posts, even their permalinks, and even do quick edit, so i should
 *    be able to do same for categories and tags."*
 *
 * Both screens were a table and a paragraph saying editing was not offered. These components give them
 * WordPress's set for the state each row is in:
 *
 *   row actions   Edit · Quick Edit · Delete, on hover and on keyboard focus
 *   quick edit    a row that expands under the row, changing Name, Slug and Parent in place
 *   edit          the same row with the Description box as well
 *   bulk          a checkbox per row, a select-all box, and one Delete in the dropdown
 *   columns       sortable headers — Name, Slug, and the count
 *
 * ── WHY `Edit` EXPANDS THE ROW RATHER THAN OPENING A SECOND SCREEN, AND WHY THAT IS SAID ──────────
 *
 * WordPress's `Edit` opens `term.php`, a page of its own. Here it expands the same row, and the two
 * boxes differ exactly as WordPress's do: **Quick Edit is Name, Slug and Parent; Edit is those three
 * plus Description.** The difference from WordPress is the address, not the capability — and it is one
 * fewer screen whose form could fall out of step with the list it edits. The row that is open is the
 * row being changed, which is what quick edit is for and is no worse for the fuller form.
 *
 * ── AND THE ONE PLACE IT DELIBERATELY ADDS A SENTENCE WORDPRESS DOES NOT ──────────────────────────
 *
 * A Category's slug is `/topics/<slug>/` and a Tag's is `/labels/<slug>/`. **Both are live addresses
 * and this archive has no redirect store, so renaming a slug moves the address and the old one stops
 * resolving.** The note sits above the Slug field rather than appearing after the fact. See the block
 * comment in `packages/ozikoro/src/archive.ts` for why there is no redirect and why a delete of a term
 * in use is refused instead of performed.
 */
import { Fragment, useState } from 'react';

/** The endpoint every form here posts to. One writer, so the permission check cannot drift. */
const ENDPOINT = '/api/admin/taxonomy';

export interface TopicRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  parentId: number | null;
  articleCount: number;
}

export interface LabelRow {
  id: number;
  slug: string;
  name: string;
  articleCount: number;
}

export type SortOrder = 'asc' | 'desc';

/**
 * A sortable column header.
 *
 * It is an `<a href>` and not a button, so the ordering is in the address and a sorted list can be
 * bookmarked and reloaded — the same rule the archive's own rail follows. `aria-sort` is set on the
 * active column so the state is announced and not only coloured.
 */
function SortHeader({
  label,
  column,
  orderBy,
  order,
  href,
  className,
}: {
  label: string;
  column: 'name' | 'slug' | 'count';
  orderBy: string;
  order: SortOrder;
  href: (orderBy: string, order: SortOrder) => string;
  className?: string;
}) {
  const active = orderBy === column;
  const next: SortOrder = active && order === 'asc' ? 'desc' : 'asc';
  return (
    <th scope="col" className={className} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <a href={href(column, next)}>
        {label}
        {active ? <span aria-hidden="true"> {order === 'asc' ? '▲' : '▼'}</span> : null}
      </a>
    </th>
  );
}

/** The row actions every term row carries, in WordPress's order. */
function RowActions({
  slug,
  addressPrefix,
  onEdit,
  onQuickEdit,
  onDelete,
  screen,
  id,
  returnTo,
  noun,
}: {
  slug: string;
  addressPrefix: string;
  onEdit: () => void;
  onQuickEdit: () => void;
  /** Returns whether the submit should be CANCELLED — true when the reader declined the question. */
  onDelete: () => boolean;
  screen: 'category' | 'tag';
  id: number;
  returnTo: string;
  noun: string;
}) {
  return (
    <div className="row-actions">
      <span>
        <button type="button" onClick={onEdit}>
          Edit
        </button>
      </span>
      <span>
        <button type="button" onClick={onQuickEdit}>
          Quick Edit
        </button>
      </span>
      <span>
        <form method="post" action={ENDPOINT} style={{ display: 'inline' }}>
          <input type="hidden" name="screen" value={screen} />
          <input type="hidden" name="action" value={screen === 'category' ? 'delete-topic' : 'delete-label'} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {/*
            `onDelete` ASKS BEFORE THE FORM GOES, WHICH IS THE ONE THING WORDPRESS'S DELETE LINK DOES
            THAT A PLAIN BUTTON WOULD NOT. The question is the browser's own `confirm`, so it works
            with scripting in the page and needs nothing else; if it is declined the submit is
            cancelled and nothing is sent. The server refuses a term in use either way — this only
            stops a mis-click on a term that would delete cleanly.
          */}
          <button type="submit" className="submitdelete" onClick={(event) => onDelete() && event.preventDefault()}>
            Delete
          </button>
        </form>
      </span>
      <span>
        <a href={`${addressPrefix}${slug}/`} target="_blank" rel="noopener noreferrer">
          View
        </a>
      </span>
    </div>
  );
}

/** Ask before a delete, and return whether the click should be cancelled. */
function confirmDelete(noun: string, name: string): boolean {
  return !window.confirm(
    `Delete the ${noun} “${name}”?\n\nIf any record is filed under it, it will not be deleted and you will be told how many are.`
  );
}

export function CategoriesTable({
  rows,
  returnTo,
  orderBy,
  order,
}: {
  rows: TopicRow[];
  returnTo: string;
  orderBy: string;
  order: SortOrder;
}) {
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [openMode, setOpenMode] = useState<'edit' | 'quick'>('quick');
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState('');

  const toggleAll = (checked: boolean) => setSelected(checked ? rows.map((r) => r.id) : []);
  const allChecked = rows.length > 0 && selected.length === rows.length;

  const sortHref = (column: string, next: SortOrder) =>
    `/admin/posts/categories?orderby=${column}&order=${next}`;

  const open = (id: number, mode: 'edit' | 'quick') => {
    setOpenRow(openRow === id && openMode === mode ? null : id);
    setOpenMode(mode);
  };

  return (
    <div className="wplist">
      <div className="tablenav">
        <form method="post" action={ENDPOINT} id="bulk-category" style={{ display: 'contents' }}>
          <input type="hidden" name="screen" value="category" />
          <input type="hidden" name="action" value="bulk-topic" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="ids" value={selected.join(',')} />
          <label className="screen-reader-text" htmlFor="bulk-action-category">
            Select bulk action
          </label>
          <select
            id="bulk-action-category"
            name="bulkAction"
            value={bulkAction}
            onChange={(event) => setBulkAction(event.target.value)}
          >
            <option value="">Bulk actions</option>
            <option value="delete">Delete</option>
          </select>
          <button type="submit" className="button" disabled={selected.length === 0 || bulkAction === ''}>
            Apply
          </button>
          {selected.length > 0 ? <span className="small muted">{selected.length} selected</span> : null}
        </form>
        <span className="displaying-num">
          {rows.length} item{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <table className="wp-list-table">
        <thead>
          <tr>
            <td style={{ width: '2.2rem' }}>
              <input
                type="checkbox"
                aria-label="Select all categories"
                checked={allChecked}
                onChange={(event) => toggleAll(event.target.checked)}
              />
            </td>
            <SortHeader label="Name" column="name" orderBy={orderBy} order={order} href={sortHref} className="column-title" />
            <th scope="col">Description</th>
            <SortHeader label="Slug" column="slug" orderBy={orderBy} order={order} href={sortHref} />
            <SortHeader label="Records" column="count" orderBy={orderBy} order={order} href={sortHref} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <tr>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selected.includes(row.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)
                      )
                    }
                  />
                </td>
                <td>
                  <strong className="row-title">{row.name}</strong>
                  <RowActions
                    slug={row.slug}
                    addressPrefix="/topics/"
                    noun="category"
                    screen="category"
                    id={row.id}
                    returnTo={returnTo}
                    onEdit={() => open(row.id, 'edit')}
                    onQuickEdit={() => open(row.id, 'quick')}
                    onDelete={() => confirmDelete('category', row.name)}
                  />
                </td>
                <td>{row.description ?? '—'}</td>
                <td className="mono">{row.slug}</td>
                <td>{row.articleCount.toLocaleString('en-GB')}</td>
              </tr>

              {openRow === row.id ? (
                <tr className="quick-edit-row">
                  <td colSpan={5}>
                    <form method="post" action={ENDPOINT}>
                      <input type="hidden" name="screen" value="category" />
                      <input type="hidden" name="action" value={openMode === 'edit' ? 'update-topic' : 'quick-edit-topic'} />
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <div className="quick-edit-grid">
                        <div>
                          <label htmlFor={`cat-name-${row.id}`}>Name</label>
                          <input id={`cat-name-${row.id}`} name="name" type="text" defaultValue={row.name} required />
                        </div>
                        <div>
                          <label htmlFor={`cat-slug-${row.id}`}>Slug</label>
                          <input id={`cat-slug-${row.id}`} name="slug" type="text" defaultValue={row.slug} />
                          <p className="wphelp">
                            The address is <span className="mono">/topics/{row.slug}/</span>. Changing this moves it, and the
                            old address stops resolving — there is no redirect.
                          </p>
                        </div>
                        <div>
                          <label htmlFor={`cat-parent-${row.id}`}>Parent</label>
                          <select id={`cat-parent-${row.id}`} name="parentId" defaultValue={row.parentId === null ? '' : String(row.parentId)}>
                            <option value="">None</option>
                            {rows
                              .filter((other) => other.id !== row.id)
                              .map((other) => (
                                <option key={other.id} value={String(other.id)}>
                                  {other.name}
                                </option>
                              ))}
                          </select>
                          <p className="wphelp">
                            Recorded on the category. The archive&rsquo;s rail lists the fourteen categories flat, so a parent is
                            not drawn on the public site yet.
                          </p>
                        </div>
                        {openMode === 'edit' ? (
                          <div>
                            <label htmlFor={`cat-desc-${row.id}`}>Description</label>
                            <textarea id={`cat-desc-${row.id}`} name="description" rows={3} defaultValue={row.description ?? ''} />
                          </div>
                        ) : null}
                      </div>
                      <p style={{ marginTop: '10px' }}>
                        <button type="submit" className="button button-primary">
                          Update
                        </button>{' '}
                        <button type="button" className="button" onClick={() => setOpenRow(null)}>
                          Cancel
                        </button>
                      </p>
                    </form>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TagsTable({
  rows,
  returnTo,
  search,
  orderBy,
  order,
  page,
  pageSize,
  total,
}: {
  rows: LabelRow[];
  returnTo: string;
  search: string;
  orderBy: string;
  order: SortOrder;
  page: number;
  pageSize: number;
  total: number;
}) {
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [openMode, setOpenMode] = useState<'edit' | 'quick'>('quick');
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState('');

  const toggleAll = (checked: boolean) => setSelected(checked ? rows.map((r) => r.id) : []);
  const allChecked = rows.length > 0 && selected.length === rows.length;

  const query = (extra: Record<string, string> = {}): string => {
    const params = new URLSearchParams();
    if (search) params.set('s', search);
    params.set('orderby', extra.orderby ?? orderBy);
    params.set('order', extra.order ?? order);
    if (extra.page) params.set('page', extra.page);
    return `/admin/posts/tags?${params.toString()}`;
  };

  const open = (id: number, mode: 'edit' | 'quick') => {
    setOpenRow(openRow === id && openMode === mode ? null : id);
    setOpenMode(mode);
  };

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="wplist">
      <div className="tablenav">
        <form method="post" action={ENDPOINT} id="bulk-tag" style={{ display: 'contents' }}>
          <input type="hidden" name="screen" value="tag" />
          <input type="hidden" name="action" value="bulk-label" />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="ids" value={selected.join(',')} />
          <label className="screen-reader-text" htmlFor="bulk-action-tag">
            Select bulk action
          </label>
          <select
            id="bulk-action-tag"
            name="bulkAction"
            value={bulkAction}
            onChange={(event) => setBulkAction(event.target.value)}
          >
            <option value="">Bulk actions</option>
            <option value="delete">Delete</option>
          </select>
          <button type="submit" className="button" disabled={selected.length === 0 || bulkAction === ''}>
            Apply
          </button>
          {selected.length > 0 ? <span className="small muted">{selected.length} selected</span> : null}
        </form>
        <span className="displaying-num">
          {total.toLocaleString('en-GB')} item{total === 1 ? '' : 's'}
        </span>
      </div>

      <table className="wp-list-table">
        <thead>
          <tr>
            <td style={{ width: '2.2rem' }}>
              <input
                type="checkbox"
                aria-label="Select all tags listed here"
                checked={allChecked}
                onChange={(event) => toggleAll(event.target.checked)}
              />
            </td>
            <SortHeader
              label="Name"
              column="name"
              orderBy={orderBy}
              order={order}
              href={(column, next) => query({ orderby: column, order: next })}
              className="column-title"
            />
            <SortHeader
              label="Slug"
              column="slug"
              orderBy={orderBy}
              order={order}
              href={(column, next) => query({ orderby: column, order: next })}
            />
            <SortHeader
              label="Used by"
              column="count"
              orderBy={orderBy}
              order={order}
              href={(column, next) => query({ orderby: column, order: next })}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <tr>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selected.includes(row.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)
                      )
                    }
                  />
                </td>
                <td>
                  <strong className="row-title">{row.name}</strong>
                  <RowActions
                    slug={row.slug}
                    addressPrefix="/labels/"
                    noun="tag"
                    screen="tag"
                    id={row.id}
                    returnTo={returnTo}
                    onEdit={() => open(row.id, 'edit')}
                    onQuickEdit={() => open(row.id, 'quick')}
                    onDelete={() => confirmDelete('tag', row.name)}
                  />
                </td>
                <td className="mono">{row.slug}</td>
                <td>
                  {row.articleCount.toLocaleString('en-GB')} record{row.articleCount === 1 ? '' : 's'}
                </td>
              </tr>

              {openRow === row.id ? (
                <tr className="quick-edit-row">
                  <td colSpan={4}>
                    <form method="post" action={ENDPOINT}>
                      <input type="hidden" name="screen" value="tag" />
                      <input type="hidden" name="action" value={openMode === 'edit' ? 'update-label' : 'quick-edit-label'} />
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <div className="quick-edit-grid">
                        <div>
                          <label htmlFor={`tag-name-${row.id}`}>Name</label>
                          <input id={`tag-name-${row.id}`} name="name" type="text" defaultValue={row.name} required />
                        </div>
                        <div>
                          <label htmlFor={`tag-slug-${row.id}`}>Slug</label>
                          <input id={`tag-slug-${row.id}`} name="slug" type="text" defaultValue={row.slug} />
                          <p className="wphelp">
                            The address is <span className="mono">/labels/{row.slug}/</span>. Changing this moves it, and the
                            old address stops resolving — there is no redirect.
                          </p>
                        </div>
                      </div>
                      <p style={{ marginTop: '10px' }}>
                        <button type="submit" className="button button-primary">
                          Update
                        </button>{' '}
                        <button type="button" className="button" onClick={() => setOpenRow(null)}>
                          Cancel
                        </button>
                      </p>
                    </form>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="tablenav">
        {page > 1 ? (
          <a className="button" href={query({ page: String(page - 1) })}>
            ← Previous
          </a>
        ) : (
          <span />
        )}
        <span className="small muted">
          page {page} of {pageCount}
        </span>
        {page < pageCount ? (
          <a className="button" href={query({ page: String(page + 1) })}>
            Next →
          </a>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
