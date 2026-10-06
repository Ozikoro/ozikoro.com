/** Tags — `/admin/posts/tags`. The register of tags, with what each is used by. */
import '../../classic-editor/classic-editor.css';
import { TagsScreen, type ListSearchParams } from '../../classic-editor/screens';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Tags', robots: { index: false, follow: false } };

export default async function Tags({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  return <TagsScreen params={await searchParams} />;
}
