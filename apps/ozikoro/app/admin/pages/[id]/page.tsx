/**
 * Edit Page — `/admin/pages/<id>`.
 *
 * A post id asked for here is a 404, for the same reason as the mirror of it: the kind is part of the read.
 */
import { notFound } from 'next/navigation';
import '../../classic-editor/classic-editor.css';
import { EditorScreen, type ListSearchParams } from '../../classic-editor/screens';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Edit Page', robots: { index: false, follow: false } };

export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { id } = await params;
  const articleId = Number.parseInt(id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();
  return <EditorScreen kind="page" id={articleId} params={await searchParams} />;
}
