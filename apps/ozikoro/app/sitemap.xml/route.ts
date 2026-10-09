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
import { listIndexableUrls, loadSitemapGroups, sitemapIndex, SITEMAP_GROUPS } from '@ozikoro/platform';

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

export async function GET() {
  const db = await getDb();
  const entries = await listIndexableUrls(db);

  /*
   * ── THE SECTIONS THE OWNER HAS CHOSEN TO LIST, ON `/admin/seo/tools/` ─────────────────────────────
   *
   * `loadSitemapGroups` returns `[]` when nothing is stored, and `[]` means every section — **so the empty
   * state is byte-for-byte the index this route built before the setting existed.** A stored selection
   * narrows the list and can never widen it: the entries are filtered from `SITEMAP_GROUPS` itself, and the
   * write path refuses a name that is not in it, so no screen can make this route name a section the archive
   * does not generate. The child route below is deliberately NOT filtered: a section that has been taken out
   * of the index is still served at its own address, so a crawler that already knows it is not sent a 404 by
   * a settings change.
   */
  const selected = await loadSitemapGroups(db);
  const listing = selected.length > 0 ? SITEMAP_GROUPS.filter((group) => selected.includes(group)) : SITEMAP_GROUPS;

  const groups = listing.map((group) => {
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
