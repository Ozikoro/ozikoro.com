/**
 * Edit Post — `/admin/posts/<id>`.
 *
 * A page id asked for here is a 404 and not a post screen with a page in it: `getPieceForEditor` takes the
 * kind as part of the question and returns null when it does not match, so the two screens cannot be made
 * to edit each other's rows by changing a number in the address.
 */
import { notFound } from 'next/navigation';
import '../../classic-editor/classic-editor.css';
import { EditorScreen, type ListSearchParams } from '../../classic-editor/screens';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit Post', robots: { index: false, follow: false } };

export default async function EditPost({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { id } = await params;
  const articleId = Number.parseInt(id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();
  return <EditorScreen kind="post" id={articleId} params={await searchParams} />;
}
