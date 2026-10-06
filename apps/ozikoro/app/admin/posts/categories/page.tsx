/** Categories — `/admin/posts/categories`. The archive's fourteen series, and what each holds. */
import '../../classic-editor/classic-editor.css';
import { CategoriesScreen, type ListSearchParams } from '../../classic-editor/screens';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Categories', robots: { index: false, follow: false } };

export default async function Categories({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return <CategoriesScreen params={await searchParams} />;
}
