/**
 * The two screens the Classic Editor plugin's owner asked for, as server components.
 *
 * ── WHY THE SCREENS LIVE IN ONE FILE AND THE PAGES ARE THIN ─────────────────────────────────────────
 *
 * The owner asked for **Posts** and **Pages** as two menus with two lists, and the whole risk of a
 * request like that is that somebody builds one screen and calls it both. So the *differences* are the
 * arguments, in one place, where they can be read together:
 *
 *   `/admin/posts`      is_page = false, has Categories and Tags, columns include them
 *   `/admin/pages`      is_page = true, has neither, and the box says why
 *
 * The route files under `posts/` and `pages/` then contain nothing but the kind they pass. **A reader who
 * wants to know how the two differ reads one file**, and there is no second list to drift from it.
 *
 * ── THE RAIL ────────────────────────────────────────────────────────────────────────────────────────
 *
 * WordPress's admin menu has Posts → (All Posts, Add New, Categories, Tags) and Pages → (All Pages, Add
 * New), and the design of this screen is the reason the owner asked. The archive's back office already has
 * its own rail — `app/admin/layout.tsx` — and this is the section's own submenu shown on every screen in
 * the section. The shared rail carries the two top-level entries; this carries what is under them.
 *
 * **AND IT OPENS LIKE A MENU.** The owner's complaint was that every link was laid out flat at once, so
 * each heading here is now a control: it keeps its place, a triangle says it can fold, and the links are
 * indented underneath it. `./rail-menu.tsx` draws it and remembers which groups are open.
 */
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import {
  countPieces,
  getPieceForEditor,
  listMediaChoices,
  listPieces,
  listTagCloud,
  listTopics,
  listWriters,
  sanitiseArchiveHtml,
  SITE_ORIGIN,
  type PieceKind,
  mediaUrlResolver,
  rewriteBodyImages,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Notices } from '../ui';
import { ClassicEditor, type EditorMedia, type EditorPiece } from './editor';
import { ListTable } from './list-table';
import { RailMenu, type RailGroup } from './rail-menu';

const PAGE_SIZE = 20;

/** What each list is called and where it lives. One table, so nothing works it out twice. */
export const KIND_ROUTES: Record<PieceKind, { base: string; all: string; addNew: string; noun: string; plural: string }> = {
  post: { base: '/admin/posts', all: 'All Posts', addNew: 'Add New Post', noun: 'Post', plural: 'Posts' },
  page: { base: '/admin/pages', all: 'All Pages', addNew: 'Add New Page', noun: 'Page', plural: 'Pages' },
};

/**
 * WordPress's Posts / Pages submenu, and the subsection the reader is in.
 *
 * ── WHY THIS IS NOW A MENU RATHER THAN A LIST ────────────────────────────────────────────────────────
 *
 * The owner pasted what stood here —
 *
 *     Posts · All Posts · Add New Post · Categories · Tags · Pages · All Pages ·
 *     The archive · Editorial queue · Trash
 *
 * — and asked for the section to open *"like wordpress drop-down, instead of all plastered on the writing
 * page like this."* **That flat list was this function**: three groups, each printing its heading and its
 * `<ul>` unconditionally. It was not the archive's shared rail in `app/admin/layout.tsx`, whose own section
 * list does not contain "All Posts", "Add New Post", "Categories" or "Tags" at all.
 *
 * So the markup that was here is now built as data and handed to `./rail-menu.tsx`, which draws the same
 * groups, the same links and the same `aria-current`, with each group's list behind its heading. **What is
 * passed to the menu below is exactly what used to be printed**, so nothing has been added to the section's
 * navigation and nothing taken away.
 *
 * `active` is compared against the path the reader asked for, exactly as the archive's own rail does with
 * `aria-current`, so the current screen is marked rather than merely listed — and the group holding it opens
 * by default.
 */
export function ClassicRail({ kind, active }: { kind: PieceKind; active: string }) {
  const routes = KIND_ROUTES[kind];
  const posts: RailGroup = {
    key: 'posts',
    heading: 'Posts',
    links: [
      { href: '/admin/posts', label: 'All Posts' },
      { href: '/admin/posts/new', label: 'Add New Post' },
      { href: '/admin/posts/categories', label: 'Categories' },
      { href: '/admin/posts/tags', label: 'Tags' },
    ],
  };
  const pages: RailGroup = {
    key: 'pages',
    heading: 'Pages',
    links: [
      { href: '/admin/pages', label: 'All Pages' },
      { href: '/admin/pages/new', label: 'Add New Page' },
    ],
  };
  const archive: RailGroup = {
    key: 'archive',
    heading: 'The archive',
    links: [
      { href: '/admin/archive', label: 'Editorial queue' },
      { href: '/admin/trash', label: 'Trash' },
    ],
  };
  // The section the reader is in comes first, which is the order the flat list was drawn in.
  const groups = kind === 'post' ? [posts, pages, archive] : [pages, posts, archive];
  return <RailMenu groups={groups} active={active} label={`${routes.plural} menu`} />;
}

/** The H1 and the submenu row, which is WordPress's header for both screens. */
function SectionHeader({
  title,
  kind,
  active,
  action,
}: {
  title: string;
  kind: PieceKind;
  active: string;
  action?: { href: string; label: string };
}) {
  const routes = KIND_ROUTES[kind];
  const subs: { href: string; label: string }[] =
    kind === 'post'
      ? [
          { href: '/admin/posts', label: routes.all },
          { href: '/admin/posts/new', label: 'Add New' },
          { href: '/admin/posts/categories', label: 'Categories' },
          { href: '/admin/posts/tags', label: 'Tags' },
        ]
      : [
          { href: '/admin/pages', label: routes.all },
          { href: '/admin/pages/new', label: 'Add New' },
        ];
  return (
    <>
      <h1 className="wpadmin__title">
        {title}
        {action ? (
          <a className="page-title-action" href={action.href}>
            {action.label}
          </a>
        ) : null}
      </h1>
      <ul className="wpadmin__subsubsub">
        {subs.map((sub) => (
          <li key={sub.href}>
            <a href={sub.href} className={active === sub.href ? 'current' : undefined}>
              {sub.label}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export interface ListSearchParams {
  status?: string;
  s?: string;
  page?: string;
  saved?: string;
  error?: string;
  info?: string;
}

/**
 * All Posts, or All Pages.
 *
 * THE GUARD IS THE FIRST STATEMENT AND NOT THE LAYOUT'S. `requireCapabilityOrRedirect` is called before
 * any query, for the reason written up in `lib/access.ts`: React renders a layout and its children
 * concurrently, so the layout's redirect does **not** keep a page's rows out of the response body — a
 * measured fault, 307 with the queue's real rows in it.
 */
export async function AllPiecesScreen({ kind, params }: { kind: PieceKind; params: ListSearchParams }) {
  const routes = KIND_ROUTES[kind];
  const status = (['all', 'publish', 'draft', 'pending', 'trash'].includes(params.status ?? '')
    ? (params.status as string)
    : 'all') as 'all' | 'publish' | 'draft' | 'pending' | 'trash';
  const search = (params.s ?? '').trim();
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const { capabilities } = await requireCapabilityOrRedirect('edit_entity', routes.base);

  const db = await getDb();
  const [rows, counts, topics, writers] = await Promise.all([
    listPieces(db, { kind, status, search: search || null, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countPieces(db, kind, search || null),
    listTopics(db),
    listWriters(db),
  ]);

  const query = new URLSearchParams();
  if (status !== 'all') query.set('status', status);
  if (search) query.set('s', search);
  if (page > 1) query.set('page', String(page));
  const returnTo = query.toString().length > 0 ? `${routes.base}?${query.toString()}` : routes.base;

  const shown = status === 'trash' ? counts.trash : counts.all;
  const hasNextPage = page * PAGE_SIZE < shown;

  return (
    <div className="wpadmin">
      <ClassicRail kind={kind} active={routes.base} />
      <SectionHeader
        title={routes.plural}
        kind={kind}
        active={routes.base}
        action={{ href: `${routes.base}/new`, label: 'Add New' }}
      />
      <Notices saved={params.saved} error={params.error} info={params.info} />
      <ListTable
        kind={kind}
        rows={rows.map((row) => ({
          id: row.id,
          title: row.title,
          slug: row.slug,
          status: row.status,
          author: row.author,
          topic: row.topic,
          topicId: row.topicId,
          tags: row.tags,
          publishedAt: row.publishedAt,
          modifiedAt: row.modifiedAt,
          deletedFromStatus: row.deletedFromStatus,
        }))}
        counts={counts}
        status={status}
        search={search}
        returnTo={returnTo}
        baseHref={routes.base}
        page={page}
        hasNextPage={hasNextPage}
        canPublish={capabilities.has('publish')}
        topics={topics.map((t) => ({ id: t.id, name: t.name }))}
        writers={writers.map((w) => ({ id: w.id, name: w.name }))}
        isTrashView={status === 'trash'}
      />
    </div>
  );
}

/**
 * The editor screen, for a piece that exists or for a new one.
 *
 * The four reads it needs — the series, the writers, the media register and the tag cloud — are made here
 * and passed to the client component as plain data. **The client component never queries**: the archive's
 * permission model is a database function and the database is not reachable from a browser, so the screen
 * receives what it may show and nothing else.
 */
export async function EditorScreen({
  kind,
  id,
  params,
}: {
  kind: PieceKind;
  id: number | null;
  params: ListSearchParams;
}) {
  const routes = KIND_ROUTES[kind];
  const returnTo = id === null ? `${routes.base}/new` : `${routes.base}/${id}`;
  const { capabilities } = await requireCapabilityOrRedirect('edit_entity', returnTo);

  const db = await getDb();

  let piece: EditorPiece | null = null;
  let previewHtml = '';
  let featuredMediaKey: string | null = null;
  let featuredMediaName: string | null = null;

  if (id !== null) {
    const stored = await getPieceForEditor(db, id, kind);
    if (!stored) notFound();
    /*
     * THE IMAGES ARE RESOLVED HERE, AND NOT BEFORE THIS ROUND.
     *
     * `sanitiseArchiveHtml` was called on the stored body alone, so this screen rendered **the address the
     * record was published at** rather than the file the archive serves: `https://ozikoro.com/wp-content/…`
     * 404s on the domain since the cutover, and a body quoting a Blogger or a BBC image was refused by the
     * site's own `img-src 'self' data:` policy. **Every image on every draft screen was broken, for one of
     * those two reasons**, which is exactly what the owner reported. `rewriteBodyImages` and
     * `mediaUrlResolver` are the same two functions the served article route calls, so the preview cannot
     * disagree with the page.
     */
    previewHtml = sanitiseArchiveHtml(rewriteBodyImages(stored.bodyHtml, await mediaUrlResolver(db)));
    if (stored.featuredMediaId !== null) {
      const chosen = await db.one<{ storage_key: string | null; title: string | null }>(
        `select storage_key, coalesce(title, storage_key) as title from ozikoro_media where id = $1`,
        [stored.featuredMediaId]
      );
      featuredMediaKey = chosen?.storage_key ? String(chosen.storage_key) : null;
      featuredMediaName = chosen?.title ? String(chosen.title) : null;
    }
    piece = {
      id: stored.id,
      title: stored.title,
      bodyHtml: stored.bodyHtml,
      standfirst: stored.standfirst ?? '',
      slug: stored.slugIsPlaceholder ? '' : stored.slug,
      slugIsPlaceholder: stored.slugIsPlaceholder,
      status: stored.status,
      topicId: stored.topicId,
      tags: stored.labels.map((l) => l.name),
      featuredMediaId: stored.featuredMediaId,
      featuredMediaKey,
      featuredMediaName,
      authorId: stored.authorId,
      publishedAt: stored.publishedAt,
      modifiedAt: stored.modifiedAt,
      accessTier: stored.accessTier,
    };
  }

  const [topics, writers, media, tagCloud] = await Promise.all([
    listTopics(db),
    listWriters(db),
    listMediaChoices(db, { includeId: piece?.featuredMediaId ?? null, limit: 40 }),
    listTagCloud(db, 30),
  ]);

  const mediaChoices: EditorMedia[] = media.map((m) => ({
    id: m.id,
    key: m.key,
    name: m.name,
    altText: m.altText,
    // What the file is. The picker draws an image as a thumbnail and anything else as a labelled plate,
    // and what the chosen record becomes in the body is decided by this too. See `editor.tsx`.
    kind: m.kind,
  }));

  const title = id === null ? routes.addNew : `Edit ${routes.noun}`;

  return (
    <div className="wpadmin">
      <ClassicRail kind={kind} active={id === null ? `${routes.base}/new` : routes.base} />
      <SectionHeader title={title} kind={kind} active={id === null ? `${routes.base}/new` : routes.base} />
      <Notices saved={params.saved} error={params.error} info={params.info} />
      <ClassicEditor
        kind={kind}
        mode={id === null ? 'new' : 'edit'}
        piece={piece}
        topics={topics.map((t) => ({ id: t.id, name: t.name, articleCount: t.articleCount }))}
        writers={writers.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))}
        media={mediaChoices}
        tagCloud={tagCloud}
        previewHtml={previewHtml}
        canPublish={capabilities.has('publish')}
        siteOrigin={SITE_ORIGIN}
      />
    </div>
  );
}

/**
 * The Categories screen: the fourteen series the migration carried across from WordPress.
 *
 * IT IS A LIST, NOT AN EDITOR, AND THAT IS SAID ON THE SCREEN. WordPress's Categories screen adds,
 * renames and deletes categories; here the fourteen are the archive's narrative spine, they arrived with
 * the import, and every published record references one. Renaming one is a decision about the whole
 * archive rather than about a post, and this archive has no screen for it — so this screen reports the
 * taxonomy, its sizes and where a piece is filed, and does not offer a control that would rewrite
 * fourteen years of filing from a form.
 */
export async function CategoriesScreen({ params }: { params: ListSearchParams }) {
  await requireCapabilityOrRedirect('edit_entity', '/admin/posts/categories');
  const db = await getDb();
  const topics = await listTopics(db);
  const total = topics.reduce((sum, t) => sum + t.articleCount, 0);

  return (
    <div className="wpadmin">
      <ClassicRail kind="post" active="/admin/posts/categories" />
      <SectionHeader title="Categories" kind="post" active="/admin/posts/categories" />
      <Notices saved={params.saved} error={params.error} info={params.info} />
      <div className="postbox">
        <div className="inside">
          <p className="wphelp" style={{ marginTop: 0 }}>
            These are the archive&rsquo;s series — the fourteen categories WordPress held, carried across by the
            migration and referenced by {total.toLocaleString('en-GB')} published record
            {total === 1 ? '' : 's'}. A record carries <strong>one</strong> series; the picker is on the editing
            screen, in the Categories box.
          </p>
          <table className="wp-list-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Slug</th>
                <th scope="col">Records</th>
                <th scope="col">Address</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((topic) => (
                <tr key={topic.id}>
                  <td>
                    <strong>{topic.name}</strong>
                    {topic.description ? <div className="wphelp">{topic.description}</div> : null}
                  </td>
                  <td className="mono">{topic.slug}</td>
                  <td>{topic.articleCount.toLocaleString('en-GB')}</td>
                  <td>
                    <a href={`/topics/${topic.slug}/`} target="_blank" rel="noopener noreferrer">
                      /topics/{topic.slug}/
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="wphelp">
            Adding a series, renaming one or removing one is not offered here. The series are how every published
            record is filed and how a reader browses the archive, so a change to one is a decision about the whole
            collection rather than a field on a form — the same reason the archive states its prohibitions where a
            reader can find them.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The Tags screen: a search over the register, with what each tag holds.
 *
 * WHY THERE IS NO TAG EDITOR ON IT. The register holds 11,056 labels, most of them names of places, people
 * and towns carried across from WordPress and used to find the archive in search. Renaming one renames the
 * address `/labels/<slug>/` that a search engine has indexed and a reader may have saved — so this screen
 * reports the register, and the Tags box on a piece is where a tag is applied or created.
 */
export async function TagsScreen({ params }: { params: ListSearchParams }) {
  await requireCapabilityOrRedirect('edit_entity', '/admin/posts/tags');
  const db = await getDb();
  const search = (params.s ?? '').trim();
  const labels = await listTagCloud(db, 200);
  const filtered = search
    ? labels.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))
    : labels;
  const total = await db.one<{ n: number }>(`select count(*)::int as n from ozikoro_label`);

  return (
    <div className="wpadmin">
      <ClassicRail kind="post" active="/admin/posts/tags" />
      <SectionHeader title="Tags" kind="post" active="/admin/posts/tags" />
      <Notices saved={params.saved} error={params.error} info={params.info} />
      <div className="postbox">
        <div className="inside">
          <p className="wphelp" style={{ marginTop: 0 }}>
            The register holds <strong>{Number(total?.n ?? 0).toLocaleString('en-GB')}</strong> tags, and the two
            hundred most used are listed here. A tag is applied or created from the Tags box on a piece: typing a
            name that already exists reuses that tag, and a name that is new is added to the register.
          </p>
          <form method="get" action="/admin/posts/tags" className="tablenav">
            <label className="screen-reader-text" htmlFor="tag-search">
              Search tags
            </label>
            <input id="tag-search" type="search" name="s" defaultValue={search} placeholder="Search the tags listed here" />
            <button type="submit" className="button">
              Search
            </button>
            {search ? (
              <a className="button" href="/admin/posts/tags">
                Clear
              </a>
            ) : null}
          </form>
          {filtered.length === 0 ? (
            <p className="empty-state">No tag in the two hundred most used matches “{search}”.</p>
          ) : (
            <table className="wp-list-table">
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Used by</th>
                  <th scope="col">Address</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((label) => (
                  <tr key={label.slug}>
                    <td>
                      <strong>{label.name}</strong>
                    </td>
                    <td>
                      {label.articleCount.toLocaleString('en-GB')} record{label.articleCount === 1 ? '' : 's'}
                    </td>
                    <td>
                      <a href={`/labels/${label.slug}/`} target="_blank" rel="noopener noreferrer">
                        /labels/{label.slug}/
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
