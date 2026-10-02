/**
 * `/sitemap.xml` — the sitemap INDEX.
 *
 * WHY THIS IS A ROUTE AND NOT `sitemap.ts`
 *
 * Next's `app/sitemap.ts` returns entries and the framework wraps them in a `<urlset>`. **A sitemap index must
 * be a `<sitemapindex>` containing `<sitemap>` elements — a different document type** — so the convention
 * produced a file listing the child URLs as if they were pages. **A crawler reading it would have tried to
 * index `/sitemap/histories` as a page of the site.**
 *
 * The route also cannot be reached by the middleware: the matcher skips anything ending in `.xml`, which is
 * exactly right here and is why this address needs no entry in the known-segments list.
 */
import { getDb } from '@ozituma/db/client';
import { listIndexableUrls, sitemapIndex, SITEMAP_GROUPS } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await getDb();
  const entries = await listIndexableUrls(db);

  const groups = SITEMAP_GROUPS.map((group) => {
    const mine = entries.filter((e) => e.group === group);
    const latest = mine
      .map((e) => e.lastModified)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1);
    return { group, count: mine.length, ...(latest ? { lastModified: latest } : {}) };
  });

  return new Response(sitemapIndex(groups), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
