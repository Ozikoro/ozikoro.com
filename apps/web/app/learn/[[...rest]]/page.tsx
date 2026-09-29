import { permanentRedirect } from 'next/navigation';

/**
 * `ozituma.com/learn` and everything beneath it → `learn.ozituma.com`.
 *
 * The courses have their own app and their own deployment now (§6.1: separate release cycle, clean
 * boundary). This route exists so that two things keep working:
 *
 *   1. The "Learn" item in this site's own navigation, which links to `/learn` and should not have
 *      to hard-code a second domain.
 *   2. Any link already shared. Before the split, `ozituma.com/learn/igbo/saying-hello` was a real
 *      address; a 404 there is a broken link in somebody's message.
 *
 * WHY A REDIRECT RATHER THAN SERVING THE PAGES HERE
 *
 * Serving them here is what the split just removed. Two apps rendering the same course page from
 * the same database means two places to change and no way to tell which one a learner is on — and
 * it was exactly the coupling that made a lesson-player change a risk to the live dictionary.
 *
 * `permanentRedirect` (308) rather than a temporary one, so a search engine moves the indexed
 * course pages to the canonical host instead of continuing to crawl this path. The subdomain is
 * the canonical address: it is what the app writes into its canonical links.
 */
export const dynamic = 'force-dynamic';

export default async function LearnRedirect({
  params,
}: {
  params: Promise<{ rest?: string[] }>;
}) {
  const { rest } = await params;

  const base = (process.env.OZITUMA_LEARN_URL ?? 'https://learn.ozituma.com').replace(/\/+$/, '');
  const path = (rest ?? []).map(encodeURIComponent).join('/');

  permanentRedirect(path === '' ? base : `${base}/${path}`);
}
