/**
 * `/favicon.ico` — the one address a browser asks for unprompted, which is how the owner's icon reaches
 * every page of this site.
 *
 * ── WHY THIS IS A ROUTE AND NOT A FILE, AND WHY THE FILES WERE DELETED ────────────────────────────────
 *
 * `apps/ozikoro/public/favicon.ico` and `public/favicon.png` used to answer this path. **A static file in
 * `public/` is served BEFORE the router**, so leaving them would shadow this route completely and the
 * setting would appear to save and change nothing — the exact "stored, served and invisible" fault this
 * repository has already paid for twice. Both were removed in the same change, and `DEFAULT_ICON` in
 * `@ozikoro/platform` is their bytes, so an archive with no icon set serves exactly what it served before.
 * (`/apple-touch-icon.png` was left alone: an iOS home-screen icon is a different file with a different
 * purpose, and this setting does not pretend to be it.)
 *
 * ── WHY THIS REACHES THE DESIGN SCREENS AND `app/layout.tsx` DOES NOT ────────────────────────────────
 *
 * Measured: `GET /` is `public/design/screens/home.html` rewritten by the middleware, and it references zero
 * `/_next/` assets — it never enters the React tree, so no layout here runs for it. The same is true of all
 * fifty-three screens and of the 1,051 articles, which `app/[slug]/route.ts` serves from the same
 * deliverable. **A `<link rel="icon">` in `app/layout.tsx` is therefore seen by the React routes and by
 * nothing else**, and adding one to `seoHead` would mean editing that function and all four of its callers to
 * reach pages that already ask for this address by themselves.
 *
 * So the icon is answered where every page already asks for it: a document that declares no icon gets
 * `/favicon.ico` from the browser, and this route is what answers. One endpoint, one setting, no head
 * rewritten.
 *
 * ── CACHING, WHICH IS THE ONE THING THIS GETS WRONG IF IT IS CLEVER ───────────────────────────────────
 *
 * `no-store`, for the reason `/design-theme.css` carries it: a favicon is cached harder than anything else on
 * a page — a stale one survives an ordinary reload and several more — so an owner who changes his icon and
 * sees the old one concludes the editor does not work. **That conclusion is the fault this whole round
 * exists to remove**, and it is worth one small request per page to avoid it. `no-store` also means the
 * browser does not revalidate, which is what makes the change visible on the very next load.
 */
import { getDb } from '@ozituma/db/client';
import { defaultIcon, loadSiteFavicon } from '@ozikoro/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let body: Buffer = defaultIcon();
  let contentType = 'image/x-icon';

  try {
    const favicon = await loadSiteFavicon(await getDb());
    if (favicon) {
      /*
       * THE STORED VALUE IS RE-CHECKED HERE, NOT TRUSTED.
       *
       * `loadSiteFavicon` already refuses a row whose value is not an icon, and the decode below is still
       * guarded: this response goes to every page on the site, so a row written by hand with SQL must not be
       * able to answer this address with something that is not an image. A failure falls back to the design's
       * own mark and says so in the log — a page with the wrong icon is a fault, a page with no icon at all
       * is a worse one.
       */
      const decoded = Buffer.from(favicon.dataUrl.slice(favicon.dataUrl.indexOf(',') + 1), 'base64');
      if (decoded.byteLength > 0) {
        body = decoded;
        contentType = favicon.mediaType;
      }
    }
  } catch (error) {
    // Degrade to the design's own mark. A settings row that cannot be read must not cost 1,104 pages their
    // icon; the owner sees the old mark and can see on this screen that nothing is stored.
    console.error('[ozikoro/site-icon] could not read the site icon for /favicon.ico:', String(error).slice(0, 200));
  }

  /*
   * A `Uint8Array` VIEW RATHER THAN THE `Buffer`, because the body of a `Response` is typed against
   * `BodyInit` and a Node `Buffer` is a `Uint8Array` whose overloads do not line up with it in this
   * TypeScript configuration — which is a typecheck failure, not a runtime one, and the build is the gate.
   */
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': contentType,
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

/**
 * ⚠️ AND NOTHING ELSE MAY BE EXPORTED FROM A ROUTE MODULE.
 *
 * A Next.js route file may export only the HTTP verbs and its own route configuration, and a named constant
 * beside them fails the build with `"…" is not a valid Route export field` — which is exactly how another
 * screen in this application failed its first build while the running site kept serving the previous one. The
 * constants this route needs live in `@ozikoro/platform` for that reason.
 */
