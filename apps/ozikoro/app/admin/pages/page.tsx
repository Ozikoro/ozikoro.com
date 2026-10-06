/**
 * All Pages — `/admin/pages`.
 *
 * The same component as All Posts with `kind="page"`: no Categories column, no Tags column, and a list
 * that cannot contain a post. A page is site content rather than a filed record — the schema's own
 * distinction, migration 0036 — and this list is that distinction drawn.
 */
import '../classic-editor/classic-editor.css';
import { AllPiecesScreen, type ListSearchParams } from '../classic-editor/screens';

export const dynamic = 'force-dynamic';

export default async function AllPages({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return <AllPiecesScreen kind="page" params={await searchParams} />;
}
