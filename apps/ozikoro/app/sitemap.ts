/**
 * The sitemap.
 *
 * Every address the archive wants found, assembled from one enumeration in `@ozikoro/platform`'s
 * `seo.ts` — because the previous version of this file listed whatever its author remembered, and
 * what was forgotten was most of the archive: 11,056 subject pages and 3,488 media pages were absent,
 * so a crawler was shown roughly 8% of what the archive holds.
 *
 * The site serves with `trailingSlash: true`, so every entry is emitted in its slashed form. A sitemap
 * that names a non-canonical address is asking a crawler to index a redirect — the previous version
 * listed `/archive` and `/about` that way.
 *
 * Search results, paginated views and the design reference are deliberately absent: they are
 * `noindex`, not canonical, or not part of the archive at all.
 */
import type { MetadataRoute } from 'next';
import { getDb } from '@ozituma/db/client';
import { listIndexableUrls } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = await getDb();
  const entries = await listIndexableUrls(db);

  return entries.map((entry) => ({
    url: entry.url,
    ...(entry.lastModified ? { lastModified: new Date(entry.lastModified) } : {}),
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
