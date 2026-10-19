/**
 * The Classic Editor's stable address.
 *
 * The editor itself is the Posts screen (`/admin/posts/new`, and `/admin/posts/<id>` once a draft
 * exists), exactly as WordPress's `post-new.php` is the writing screen. This route exists because
 * `/admin/classic-editor/` is the name of the feature a person naturally tries; it must take them to
 * the editor rather than answer 404.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function ClassicEditorLanding() {
  redirect('/admin/posts/new');
}
