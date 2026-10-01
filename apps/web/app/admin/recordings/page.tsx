import { SectionView } from '../section-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recordings — Ozituma admin' };

/** Recordings, on its own page. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  return <SectionView section="recordings" page={page} saved={params.saved} error={params.error} />;
}
