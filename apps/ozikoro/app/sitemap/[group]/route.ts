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

/*
 * ⚠️ `revalidate` RATHER THAN `force-dynamic`, AND THE DIFFERENCE IS A HEADER GOOGLE READS.
 *
 * Measured on the live site: every sitemap response carried TWO `cache-control` headers —
 *
 *     cache-control: private, no-cache, no-store, max-age=0, must-revalidate   ← added by Next
 *     cache-control: public, max-age=3600                                      ← set by this route
 *
 * *The route was already asking to be cached for an hour; `force-dynamic` made Next add `no-store`
 * beside it.* **When two `cache-control` headers disagree, the most restrictive one governs** — so the
 * sitemap was uncacheable at every layer, and Cloudflare reported `cf-cache-status: DYNAMIC` on it.
 *
 * **That matters for exactly one reason, and it is the reason this file exists.** A sitemap is what a
 * crawler fetches to learn the site's shape; if nothing may cache it, then every fetch — Google's
 * included — reaches the origin, and **a fetch that lands while the container is being recreated for a
 * deploy fails.** *The archive was deployed eight times in one day. Every one of those was a window in
 * which a sitemap fetch could fail and be recorded as one.*
 *
 * **`revalidate = 3600` gives the response a single, honest hour of life** — *long enough that a deploy
 * cannot take the sitemap away from a crawler, short enough that a newly published record appears the
 * same day.* **The archive changes when someone publishes, not between two crawls of the same minute.**
 */
export const revalidate = 3600;

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
