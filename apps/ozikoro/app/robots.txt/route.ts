/**
 * `/robots.txt` — the crawler rules, **and the owner's own additions to them.**
 *
 * ── WHY THIS IS A ROUTE HANDLER RATHER THAN NEXT'S `robots.ts` ───────────────────────────────────────
 *
 * It was `app/robots.ts`, a `MetadataRoute.Robots`: a function that returns an object and is resolved by the
 * framework. **That object is built once and has no access to a request, and the owner's additions live in the
 * database** — so a `robots.ts` could carry the six disallows below and could never carry one he added on
 * `/admin/seo/tools/`. A setting that is stored and never read is the fault this file exists to avoid, and the
 * direction it would fail in is the invisible one: the screen would say the path was added and the served
 * `robots.txt` would not have it.
 *
 * The document this returns is the same document, to the character: `User-agent: *`, `Allow: /`, the five
 * disallows, the sitemap and the host. The only difference is that a stored path is appended to the disallow
 * list, **and nothing stored removes one of the archive's own.**
 *
 * ── THE ARCHIVE'S OWN LIST IS NOT EDITABLE, AND THAT IS DELIBERATE ───────────────────────────────────
 *
 * `/admin`, `/signin`, `/search`, `/design/` and `/api/` are excluded because leaving each crawlable put
 * either the demonstration content or a private surface into search results — the design directory is the
 * approved reference and is not the site. **A screen that could un-disallow `/admin` would be a screen that
 * could publish the back office**, so the setting is additive: it can say "and also this", never "not that".
 * The screen says so in the same words.
 *
 * `loadRobotsDisallow` degrades to `[]` when the table cannot be read, so a busy cluster serves the archive's
 * own list rather than a 500 on the one file every crawler fetches first.
 */
import { getDb } from '@ozituma/db/client';
import { loadRobotsDisallow, OWN_ROBOTS_DISALLOW, SITE_ORIGIN } from '@ozikoro/platform';

export const dynamic = 'force-dynamic';

/**
 * The paths this archive excludes for its own reasons. See the header: not editable from any screen.
 *
 * ⚠️ NOT EXPORTED. **A Next.js route module may export only the HTTP verbs and its own route configuration**,
 * and a named constant beside them fails the build with `"…" is not a valid Route export field` — the fault
 * `app/api/admin/seo/route.ts` already records at the bottom of its own file. The same list is exported for the
 * screen from `@ozikoro/platform`'s `OWN_ROBOTS_DISALLOW`, and the two are asserted equal by
 * `site-seo.test.ts`, so the file this route serves and the list the screen prints cannot drift.
 */
const OWN_DISALLOW: readonly string[] = OWN_ROBOTS_DISALLOW;

export async function GET(): Promise<Response> {
  const added = await loadRobotsDisallow(await getDb());
  /*
   * A path the owner added that is already one of the archive's own is not written twice, and the order is the
   * archive's first — so the served file is stable and a diff of two responses is readable.
   */
  const extra = added.filter((path) => !OWN_DISALLOW.includes(path));

  const lines = [
    'User-Agent: *',
    'Allow: /',
    ...OWN_DISALLOW.map((path) => `Disallow: ${path}`),
    ...extra.map((path) => `Disallow: ${path}`),
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    `Host: ${SITE_ORIGIN}`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // An hour: a crawl rule changes when a person changes it, not between two crawls of the same minute.
      'cache-control': 'public, max-age=3600',
    },
  });
}
