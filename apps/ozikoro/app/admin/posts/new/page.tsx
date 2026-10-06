/**
 * Add New Post — `/admin/posts/new`.
 *
 * The same editor component as the edit screen with no piece behind it, which is what WordPress's
 * `post-new.php` is: `post.php` with an empty document. Save Draft creates a draft and lands on the edit
 * screen; Publish creates it and puts it live in one press.
 */
import '../../classic-editor/classic-editor.css';
import { EditorScreen, type ListSearchParams } from '../../classic-editor/screens';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Add New Post', robots: { index: false, follow: false } };

export default async function AddNewPost({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return <EditorScreen kind="post" id={null} params={await searchParams} />;
}
