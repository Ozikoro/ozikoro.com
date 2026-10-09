/*
 * analytics.ts — THE OWNER'S GA4 TAG, AND THE THREE DOCUMENTS IT HAS TO REACH.
 *
 * The owner: *"i could not find the website analytics, like it was before. i need to be knowing how much views,
 * where it came from, which link got it, and how much traffic and the country locations, if possible, cities or
 * states or counties"* — and he supplied the tag himself, verbatim.
 *
 * ⚠️ **HE MEASURED THE FAULT BEFORE ANYTHING WAS BUILT, AND IT IS NOT A MISSING DASHBOARD: THE SITE HAS NO
 * ANALYTICS ON IT AT ALL.** Every common tag was searched for on the served homepage and zero were found —
 * `gtag(` 0, `googletagmanager` 0, `google-analytics` 0, `cloudflareinsights` 0, `plausible` 0, `umami` 0,
 * `matomo` 0, `posthog` 0. **So nothing is collecting, and there is no dashboard to find because no data
 * exists.** (One near-miss worth recording because it looks like evidence and is not:
 * `static.cloudflareinsights.com` appears in this repository **only as a comment** in
 * `apps/ozikoro/next.config.ts`, where an agent recorded the browser refusing its beacon during the CSP work.
 * It is not in any served page.)
 *
 * ── ONE ID, AND THERE IS NO SECOND ───────────────────────────────────────────────────────────────────
 *
 * `G-RKRGY9QCSH` is the owner's, copied from the tag he issued and **not one character of it is invented**.
 * There is no second measurement id in this repository and none may be added without the owner issuing one: a
 * measurement id is an account fact, and an invented one reports into somebody else's property or into
 * nothing. **No second vendor is added either** — this is Google Analytics 4 and nothing else.
 *
 * ── WHY THIS IS APP-LOCAL AND NOT IN `@ozikoro/platform` ─────────────────────────────────────────────
 *
 * It sits beside `adsense.ts`, `discussion.ts` and the other app-local helpers, and it is imported through the
 * `@/lib/…` alias the three call sites already use. *Which pages of which site are measured* is a property of
 * THIS site's product surface and of no other application that depends on the platform package — the
 * dictionary and the Academy must never inherit a measurement policy from the archive by importing a barrel.
 * **The same reasoning `adsense.ts` records for its own placement applies here, and this file follows its
 * shape rather than inventing a second mechanism: one module, one address, three document producers.**
 *
 * ── THE THREE DOCUMENT PRODUCERS, WHICH IS WHY THERE ARE THREE CALL SITES ────────────────────────────
 *
 * `apps/ozikoro/app/layout.tsx`'s comment records the fact that measured this design: *"This layout does not
 * run for the design screens or the articles."* The same measurement `adsense.ts` states in full holds here,
 * and it is the reason a `layout.tsx`-only change would have measured nothing:
 *
 *     app/layout.tsx                        the React public routes  (`/researchers/`, `/clan-towns/`, …)
 *     app/design-screen/[screen]/route.ts   53 design screens     (`/`, `/archive/`, `/documents/`, …)
 *     app/[slug]/route.ts                   every published record  (`/<slug>/`)
 *
 * **The homepage, the archive and all 1,051 records never reach `layout.tsx`** — they are served as whole
 * documents by their own routes — so a tag placed only in the layout would have left the three pages the owner
 * looks at most unmeasured, and the dashboard would have shown him an archive with almost no traffic.
 *
 * ── THE TAG DOES NOT GATE, AND THAT IS A DECISION RATHER THAN AN OMISSION ────────────────────────────
 *
 * 🔴 **GA4 SETS COOKIES ON FIRST VISIT. THIS TAG FIRES IMMEDIATELY, WITH NO CONSENT GATE, AND THE OWNER IS
 * MAKING THAT DECISION KNOWINGLY — IT IS STATED IN PLAIN WORDS IN THIS ROUND'S REPORT.** GA4 needs a consent
 * mechanism in the EU and UK because it stores client ids in first-party cookies (`_ga`, `_ga_<container>`)
 * and reports across sessions; the UK and Nigeria are both in this archive's readership. The alternative — a
 * real consent gate that suppresses the tag until a reader accepts — is a second piece of UI, a stored
 * decision and a measurement of *nothing* about the readers who decline, and it was not built.
 *
 * ⚠️ **AND A HALF-GATE WAS DELIBERATELY NOT BUILT.** A banner that looks like consent and still fires the tag
 * would be worse than no gate at all: it would take a reader's decision and do the opposite of it. **If a gate
 * is wanted, it is a separate change with its own proof that `gtag` is never called before consent** — and
 * that proof is what this file's absence of a gate is honest about.
 *
 * `gtag('config', id, { anonymize_ip: true })` IS included, and it is NOT a reduction of what the owner asked
 * for: Google has applied IP anonymisation by default in GA4 since 2023, and anonymising the IP **does not
 * remove or shorten the geo fields** — country, region and city are derived before the IP is discarded and GA4
 * reports them regardless. What is deliberately NOT added is `allow_google_signals: false` or
 * `allow_ad_personalization_signals: false`: those would reduce the reporting the owner asked for (Google
 * Signals powers the demographics and interests dimensions) and the owner asked for **more geography and more
 * attribution, not less**. If he later wants them off, Google Signals is a property setting in the GA4 admin
 * UI, and the cost is stated there.
 */

/**
 * The owner's GA4 measurement id, exactly as his tag issued it.
 *
 * ⚠️ ONE MEASUREMENT ID, WRITTEN ONCE. See the file header: there is no second id and no second vendor.
 */
export const GA_MEASUREMENT_ID = 'G-RKRGY9QCSH';

/**
 * THE LOADER, WHICH GOES IN `<head>` ONCE PER DOCUMENT.
 *
 * `?id=` carries the measurement id because gtag.js reads it to know which property to configure — the same
 * address the owner's own snippet names, built from the constant above rather than typed again.
 *
 * ⚠️ THE ADDRESS IS ITS OWN EXPORT BECAUSE THE REACT ROUTES CANNOT USE THE STRING. `app/layout.tsx` renders a
 * document through JSX rather than by string concatenation, so it writes `<script async src={…}>` — and it
 * writes **this constant**, not a second copy of the URL. One address, three document producers.
 */
export const GA_LOADER_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

/**
 * THE OWNER'S TWO CALLS, VERBATIM, AND THE LOADER'S OWN QUEUE.
 *
 * `window.dataLayer` is created by the first line if it does not exist — the snippet's own
 * `window.dataLayer = window.dataLayer || []` idiom — and `gtag` is defined to push its arguments onto it.
 * **The queue is why the tag is safe to emit before the loader arrives:** the push registers the calls, and
 * gtag.js drains whatever is on `dataLayer` when it loads. A slow, refused or extension-blocked loader
 * therefore costs the measurement and not the page, which is the same rule `adsense.ts` holds for the ad
 * queue.
 *
 * ⚠️ **THE TWO `gtag` CALLS ARE THE OWNER'S, CHARACTER FOR CHARACTER** — `gtag('js', new Date())` and
 * `gtag('config', …)` — with only the `anonymize_ip` config added, for the reason in the file header.
 */
export const GA_INLINE = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}', { anonymize_ip: true });`;

/**
 * The owner's tag as markup, for the two producers that build a document as a string.
 *
 * The loader is `async` and the config is inline after it, **exactly as he supplied** — `async` is what keeps
 * the tag off the critical path, and the inline block is what makes `gtag` available immediately so no page
 * script has to wait for the network.
 */
export const GA_TAG = `<script async src="${GA_LOADER_SRC}"></script>
<script>
${GA_INLINE}
</script>`;

/**
 * Put the owner's tag in a document's `<head>`.
 *
 * Returns the document **byte for byte unchanged** when it has no `</head>`, which is the same contract
 * `withAdsenseLoader` and `insertDiscussion` hold and the reason a fill that cannot find its anchor is a
 * missing measurement rather than a mangled page.
 *
 * ⚠️ **AND IT RETURNS THE DOCUMENT UNCHANGED WHEN THE TAG IS ALREADY IN IT, WHICH IS NOT DEFENSIVENESS FOR ITS
 * OWN SAKE.** Two producers call this on documents that can also reach the other: a design screen served at
 * `/design-screen/<name>` is the same screen the middleware rewrites a public address to, and a route that
 * called this twice would emit the loader twice and **count one reader as two pageviews** — a wrong number is
 * worse than a missing one, because nothing in the report says it is wrong. The guard is one `includes` on the
 * measurement id, and it makes a second call a no-op instead of a doubled measurement.
 */
export function withAnalyticsTag(html: string): string {
  if (html.includes(GA_MEASUREMENT_ID)) return html;
  const at = html.lastIndexOf('</head>');
  if (at === -1) return html;
  return `${html.slice(0, at)}${GA_TAG}\n${html.slice(at)}`;
}

/*
 * ── WHICH PAGES CARRY THE TAG, AND WHY THIS IS NOT `ADSENSE_READER_SCREENS` ─────────────────────────────
 *
 * `adsense.ts` holds an allow-list of 26 reading screens and 7 React route families, and the brief asks
 * whether the same list is right for analytics. **It is not, and the reason is that the two lists answer
 * different questions.** The ad list answers *"may a third party be paid to put a rectangle here?"* — a
 * question about a reader's attention and about the site's own editorial integrity, which is why the
 * solicitation pages, the recruitment page and the 404 are excluded. **The analytics list answers *"how many
 * people came here, and where from?"* — a question that is worth asking about almost every page, and whose
 * worst case on a page nobody wanted measured is one row too many in a report.**
 *
 * SO THE TAG GOES ON EVERY DOCUMENT THESE THREE PRODUCERS SERVE, AND THE ARGUMENT IS MADE PER PRODUCER BELOW.
 * There is no allow-list here **on purpose**, and the two places that a list would still be wrong are closed by
 * the producers themselves rather than by a name list that could drift:
 *
 *   1. **THE LEGAL GATE, THE 403 AND THE RETIRED WORDPRESS PAGES ARE CLOSED BY THE RECORD ROUTE'S OWN CONTROL
 *      FLOW.** `app/[slug]/route.ts` serves a legacy page through `servePublishedPage` and returns its two 403
 *      refusal documents **before** the line that calls `withAdsense` — measured in the file: `await
 *      servePublishedPage(db, clean)` returns at line 345 and `html = withAdsense(html)` is at line 949, with
 *      the 403 responses at 293 and the 404 at 346. The tag rides on that same call, so those documents carry
 *      it no more than they carry an ad. **A gate a reader cannot pass must not be a page this archive
 *      counts.**
 *   2. **THE BACK OFFICE AND THE SIGN-IN SCREEN ARE MEASURED, AND THAT IS THE DECISION.** `layout.tsx`'s
 *      `hasOwnChrome` branch returns before the public shell and would be the natural place to exclude
 *      `/admin`, `/signin` and `/design` — **and it deliberately does not.** `/admin/` is the surface the
 *      owner works in and a page count of his own sessions is genuinely useful to him; `/signin/` is a page
 *      whose traffic tells him whether a login wall is being met; and neither address carries a secret in its
 *      URL. A 404 is measured too, and that is a positive: a 404 report is how a broken link is found.
 *
 * ⚠️ **WHAT IS NOT MEASURED IS NOT A PAGE AT ALL.** The PDF responses (`/<slug>/pdf` and `/media/**​.pdf`) are
 * documents served without a `<head>` of ours and are not touched by this module — measured after the change:
 * **the PDF policy holds ZERO GA origins and ZERO ad origins.**
 *
 * ⚠️ **AND NOTHING HERE GATES.** See the file header: GA4 sets cookies on first visit and this tag fires
 * immediately. That is the owner's decision, stated plainly, and it is not disguised as a consent mechanism.
 */
