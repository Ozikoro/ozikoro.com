/**
 * One child sitemap: every indexable address of a single kind.
 *
 * WHY THIS IS A ROUTE RATHER THAN `sitemap.ts`
 *
 * Next's metadata-route convention supports one `sitemap.ts` per segment, and its `generateSitemaps()` produces
 * NUMBERS — `/sitemap/0.xml`, `/sitemap/1.xml` — **which tells a reader nothing about what is in them.** These
 * are named: `/sitemap/histories`, `/sitemap/media`, `/sitemap/places`. **A URL in a sitemap index is read by
 * people as well as crawlers**, and the whole point of splitting it was to know which part is which.
 *
 * The enumeration is the same one the index uses. **There is no second definition of "indexable"** — this route
 * filters the one list rather than querying again, so the two can never disagree about what the archive holds.
 */
import { getDb } from '@ozituma/db/client';
import { listIndexableUrls, sitemapDocument, SITEMAP_GROUPS } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;

  // The trailing `.xml` is optional, because a sitemap URL is conventionally named one.
  const name = group.replace(/\.xml$/, '');
  if (!SITEMAP_GROUPS.includes(name as (typeof SITEMAP_GROUPS)[number])) {
    return new Response('Not found', { status: 404 });
  }

  const db = await getDb();
  const entries = (await listIndexableUrls(db)).filter((e) => e.group === name);

  return new Response(sitemapDocument(entries), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // An hour: the archive changes when a record is published, not between two crawls of the same minute.
      'cache-control': 'public, max-age=3600',
    },
  });
}
