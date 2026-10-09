import { GA_INLINE, GA_LOADER_SRC } from '@/lib/analytics';

/**
 * THE OWNER'S GA4 TAG, IN THE `<head>` OF THE REACT ROUTES.
 *
 * ⚠️ **THIS IS A SERVER COMPONENT ON PURPOSE, AND IT IS A SEPARATE FILE FOR THE SAME REASON
 * `adsense-loader.tsx` IS.** The tag is one `<script async src>` and one inline block with no state and no
 * handler, so it must not be pulled into the client bundle — an analytics script that the archive pays to
 * download should not be the thing that also adds JavaScript to every route. Keeping it in a file with no
 * `'use client'` is what says that.
 *
 * ── THE TWO TAGS, AND WHY THE INLINE ONE IS NOT OPTIONAL ──────────────────────────────────────────────
 *
 * **THE LOADER IS `async` AND THE INLINE BLOCK IS AFTER IT, EXACTLY AS THE OWNER SUPPLIED.** The inline block
 * creates `window.dataLayer`, defines `gtag` and pushes the owner's own two calls. It has to be inline and it
 * has to be here for one measured reason: `gtag.js` drains `dataLayer` when it arrives, so **a request that is
 * still in flight when the page is parsed must find the config already queued** — a config that waited for the
 * loader to reply would lose the pageview of every reader who leaves early, and it would make the tag's
 * arrival the gate on the measurement rather than on nothing.
 *
 * ⚠️ AND IT IS THE OWNER'S SNIPPET, NOT AN APPROXIMATION OF IT. Both the loader address and the inline text
 * come from `@/lib/analytics` rather than being typed again here, so the string producers and this file cannot
 * disagree about the id, the URL or the two `gtag` calls.
 *
 * ── WHERE IT IS RENDERED, AND THE ONE BRANCH IT IS NOT ───────────────────────────────────────────────
 *
 * `app/layout.tsx` renders it in `<head>` on **every path that reaches the public shell**, and deliberately
 * not only on the ad allow-list — see `@/lib/analytics` for why the analytics question is not the ad question.
 * **IT IS NOT RENDERED IN `hasOwnChrome`'s BRANCH, AND THAT BRANCH IS NOT AN OVERSIGHT TO BE FIXED HERE.**
 * `/design-screen/…` writes its own whole document from the screen route and carries the tag from
 * `withAnalyticsTag`; `/admin/` and `/signin/` return through that first branch, so **they are unmeasured** —
 * measured on the served pages and stated in the round's report rather than papered over here. A layout cannot
 * ask for the path (it arrives as an `x-pathname` header for exactly that reason), so the branch that returns
 * before the public shell is also the branch that returns before this tag.
 */
export function AnalyticsTag() {
  return (
    <>
      <script async src={GA_LOADER_SRC} />
      <script dangerouslySetInnerHTML={{ __html: GA_INLINE }} />
    </>
  );
}
