/** Add New Page — `/admin/pages/new`. A page has no Categories and no Tags, which is WordPress's rule too. */
import '../../classic-editor/classic-editor.css';
import { EditorScreen, type ListSearchParams } from '../../classic-editor/screens';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Add New Page', robots: { index: false, follow: false } };

export default async function AddNewPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return <EditorScreen kind="page" id={null} params={await searchParams} />;
}
