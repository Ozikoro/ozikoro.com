/**
 * A record's address in the editorial queue, which now opens the piece's own editing screen.
 *
 * ── THE FAULT THIS ANSWERS, IN THE OWNER'S WORDS ────────────────────────────────────────────────────
 *
 * *"this is a page https://ozikoro.com/admin/archive/2154 and it does not look like classic editor
 * dashboard, and also not white, and shows completely html editor, not even an option to switch"*.
 *
 * He was right, and this was the page he was looking at: two bare `<textarea>`s under the archive's own
 * cream chrome. A WordPress Classic Editor already existed beside it at `/admin/posts/<id>` and nothing
 * linked to it — which is the whole reason the fault survived. Building the editor was not the work;
 * **wiring it was.**
 *
 * ── WHY A REDIRECT RATHER THAN A SECOND RENDER OF THE EDITOR ────────────────────────────────────────
 *
 * The editor asks for a piece by id **and kind**: `getPieceForEditor` refuses a page id asked for as a
 * post, so no caller can make the editor write a page's body through a post's endpoint. Resolving the
 * kind here and sending the reader to the one screen that owns that kind keeps a single render path, a
 * single set of section menus and a single write route, instead of a second editor that could drift.
 *
 * The record's other editorial fields — clan, period, source type, citations, history — are one segment
 * down at `/admin/archive/<id>/record`, which is where the queue's rows and the editor's own sidebar
 * link to them. Before this change that screen was at this address, and this address was the only way in.
 */
import { notFound, redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { requireCapabilityOrRedirect } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function RecordAddress({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const articleId = Number.parseInt(id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();

  // The page's own guard, FIRST: `requireCapabilityOrRedirect` is called before any query, because the
  // layout's redirect does not keep a page's rows out of the response body — see `lib/access.ts`.
  await requireCapabilityOrRedirect('edit_entity', `/admin/archive/${articleId}`);

  const db = await getDb();
  const row = await db.one<{ is_page: boolean }>(`select is_page from ozikoro_article where id = $1`, [articleId]);
  if (!row) notFound();

  // WordPress keeps pages and posts in two namespaces, and so do the two editing screens.
  redirect(row.is_page ? `/admin/pages/${articleId}` : `/admin/posts/${articleId}`);
}
