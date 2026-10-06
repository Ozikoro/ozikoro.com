/**
 * All Posts — `/admin/posts`.
 *
 * The screen is `AllPiecesScreen` with `kind="post"` and nothing else, so the difference between this list
 * and All Pages is one argument in one file rather than two screens that could drift. See
 * `../classic-editor/screens.tsx` for the guard, the query and the rail.
 */
import '../classic-editor/classic-editor.css';
import { AllPiecesScreen, type ListSearchParams } from '../classic-editor/screens';

export const dynamic = 'force-dynamic';

export default async function AllPosts({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return <AllPiecesScreen kind="post" params={await searchParams} />;
}
