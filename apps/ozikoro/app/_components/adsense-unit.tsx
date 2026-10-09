'use client';

import { useEffect } from 'react';
import { ADSENSE_CLIENT, ADSENSE_SLOT } from '@/lib/adsense';

/**
 * THE OWNER'S AD UNIT ON THE REACT ROUTES, AND WHY IT IS A CLIENT COMPONENT.
 *
 * The owner: *"i did not see where to place the google adsense ads, so please add it yourself."* Two of the
 * three document producers build a document as a **string** and insert the owner's snippet verbatim — the 53
 * design screens and every record at `/<slug>/`. This is the third, and it is different because **React owns
 * this DOM**, which is a measured difference rather than a stylistic one:
 *
 *     MEASURED, review server, with the unit inserted as server markup plus an inline push:
 *
 *       GET /documents/        (a string-built design screen)   ad-status=unfilled  1440×280  iframes=1
 *       GET /                  (a string-built design screen)   ad-status=unfilled  1440×280  iframes=1
 *       GET /researchers/      (React)                          NO ad-status       1440×0    iframes=0
 *       GET /clan-towns/       (React)                          NO ad-status       1440×0    iframes=0
 *
 * **The same markup on a React page produced a unit with no `data-ad-status` and no iframe**: the element was
 * rendered, and AdSense never claimed it. Two facts explain it, and both point at the same remedy:
 *
 *   1. **An inline `<script>` that React renders is not executed on client-side navigation.** Inserting a
 *      script element through the DOM — which is what happens when Next renders a page in the browser after a
 *      `<Link>` — never runs it. A reader who arrives at `/researchers/` from the masthead and then follows a
 *      link to a record would therefore meet a unit that had never been pushed, on every page after the first.
 *   2. **React owns the subtree.** A unit pushed during HTML parsing can have the iframe AdSense injects into
 *      it reconciled away when React hydrates over that element.
 *
 * SO THE PUSH HAPPENS IN AN EFFECT, AFTER HYDRATION, ON EVERY MOUNT — the pattern AdSense's own React guidance
 * gives, and the only one of the three that is correct for a document React controls. It costs one small
 * client component, and it is rendered **only** on the pages `app/layout.tsx` admits through
 * `isAdsenseReaderPath`, so no private surface pays for it.
 *
 * ⚠️ **THE `<ins>` IS STILL SERVER-RENDERED.** `'use client'` marks the boundary, not the renderer: this is
 * still rendered to HTML on the server, so the unit is in the document a crawler or a no-JavaScript reader
 * receives. Only the push waits for the browser.
 *
 * ⚠️ **AND THE ATTRIBUTES ARE THE OWNER'S, CHARACTER FOR CHARACTER** — the same client, the same slot, the
 * same auto format and full-width flag the two string producers write, all from `@/lib/adsense`. There is no
 * second slot and no second client in this repository.
 */
export default function AdsenseUnit() {
  useEffect(() => {
    /*
     * THE QUEUE PUSH, AND IT CANNOT COST THE READER THE PAGE.
     *
     * `adsbygoogle` is created by this line if the loader has not arrived yet — that is the snippet's own
     * `(adsbygoogle = window.adsbygoogle || [])` idiom, and it is what makes the push safe whether the loader
     * is early, late, refused or blocked by an extension. **A failed ad is a missing ad and not a broken
     * page**, so the push is wrapped: an ad blocker that replaces `push` with something that throws must not
     * take a history down.
     *
     * ⚠️ **IT IS AN ARRAY AND IT MUST STAY ONE.** The loader drains this queue when it arrives, so it has to be
     * the array the snippet creates — not an object with a `push` method of our own, which would compile
     * perfectly and silently swallow every unit registered before the loader ran.
     *
     * ⚠️ **AND THE TYPE IS LOCAL RATHER THAN A `declare global`, WHICH IS A MEASURED CORRECTION.** The first
     * version of this file declared `window.adsbygoogle` as `{ push(config) }`. The BUILD refused it —
     * `next build` type-checks, which is the failure mode `next.config.ts`'s sibling rule records as
     * *"typecheck passing before a commit does not prove the commit compiles"*:
     *
     *     Type '(...items: never[]) => number' is not assignable to type '(config: Record<string, unknown>) => void'
     *
     * The union produced by `window.adsbygoogle || []` carries `never[]`'s own `push`, so the declared
     * signature could never be called. A local cast describing the ARRAY is what the runtime actually needs.
     */
    const queue = (window as unknown as { adsbygoogle?: Array<Record<string, unknown>> });
    try {
      (queue.adsbygoogle ??= []).push({});
    } catch {
      // The archive serves the record whatever the ad code does.
    }
  }, []);

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block' }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={ADSENSE_SLOT}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
