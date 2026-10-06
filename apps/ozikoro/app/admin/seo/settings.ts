/**
 * The two constants every search-engine screen and endpoint shares.
 *
 * ── WHY THEY ARE NOT IN `sections.ts` ───────────────────────────────────────────────────────────────
 *
 * `sections.ts` is a client-safe description of the area's layout — labels, paths, and whether a section does
 * the thing it names. These two are the *rule*: the capability every screen and every write asks for, and the
 * endpoint every form posts to. A screen importing the layout file gets no capability by accident, and the
 * capability is written as a literal at each guard site as well, because `npm run check:capabilities` reads it
 * out of the call site and proves some role holds it — a value reached only through a constant would be a
 * capability that check cannot see.
 */

/** The capability that opens and writes every screen in `/admin/seo/`. */
export const SEO_CAPABILITY = 'manage_design';

/** Every form in the area posts here. One endpoint, for the reason `app/api/admin/site-seo/route.ts` gives. */
export const SEO_ACTION = '/api/admin/site-seo';
