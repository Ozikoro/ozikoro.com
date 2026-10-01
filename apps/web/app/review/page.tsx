import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The review queue, inside the contributor dashboard.
 *
 * It used to sit at the top level with no dashboard shell at all — so an editor opening the queue
 * lost the navigation and the page arrived wearing nothing. Moving it under /contribute gives it
 * the same shell, the same sidenav and the same vocabulary as the rest of Dashboard A, which is
 * the design's whole point: an editor's extra capability is additive, not a separate product.
 *
 * The address is kept so links and bookmarks to /review still work.
 */
export default function Page() {
  redirect('/contribute/review');
}
