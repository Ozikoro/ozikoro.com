import type { NextConfig } from 'next';

/**
 * Ozikoro — the history and archive at ozikoro.com.
 *
 * This is the parent site, and it is a separate app from the dictionary for the same reason
 * the courses are: ozikoro.com and ozituma.com are two registrable domains with two jobs, and
 * a cookie cannot span them (see the note on OZITUMA_AUTH_COOKIE_DOMAIN in .env.example). It
 * shares `@ozituma/core` and `@ozituma/db` with the dictionary, so the account table, the
 * session handling and the Spotify connection are one implementation rather than two.
 *
 * The public design for this site is still to be built. What exists here now is the part that
 * had to exist first and is not a design decision: the administrator's area, the account
 * session it sits behind, and the Spotify connection that the podcast workflow will depend
 * on.
 *
 * The production OAuth callback this app must answer is:
 *
 *     https://ozikoro.com/api/spotify/callback
 *
 * It is served by `app/api/spotify/callback/route.ts`. The address is configured with the
 * Spotify Developer Dashboard and with SPOTIFY_REDIRECT_URI, and the two must match exactly.
 */
const nextConfig: NextConfig = {
  /**
   * WHERE THE BUILD IS WRITTEN, OVERRIDABLE SO A BUILD CANNOT DESTROY THE SERVER THAT IS SERVING.
   *
   * `next build` empties its output directory before it writes. Measured on 2026-10-04: with the
   * review server running out of `.next/standalone`, a second build — and even a build that then
   * FAILED on an unrelated type error — left `.next` with no `BUILD_ID` and no `.next/standalone` at
   * all. The process survived; every request that needed a server chunk or a manifest answered
   * **404**, because Next reads those from disk as it serves. So a build in place does not merely
   * risk shipping a bad build: it takes the site down at the first second of the build, whether or
   * not the build succeeds. That is the mechanism behind the owner's "the site keeps going down".
   *
   * `scripts/serve-review.sh` therefore builds into `.next-next` and swaps the directory in once the
   * build has finished and its artefact has been asserted complete. The running server keeps its own
   * files for the whole build, a failed build leaves the site untouched, and the outage becomes the
   * seconds of the swap rather than the 60–120 seconds of the build.
   *
   * **The default is unchanged and the override is inert unless the variable is set**, which is what
   * makes this safe in a shared tree: every other caller — `npm run build`, `verify-all`,
   * `build-standalone.sh`, the Docker image — still writes `.next` exactly as before.
   *
   * It is read from `process.env.OZIKORO_DIST_DIR` rather than passed on a command line because
   * `next build` has no flag for its output directory.
   */
  distDir: process.env.OZIKORO_DIST_DIR || '.next',

  /**
   * THE DESIGN DELIVERABLE'S OWN STYLESHEETS, AT THE PATH ITS RELATIVE LINKS ASK FOR.
   *
   * Every screen in `public/design/screens/` links its stylesheets as `../styles/main.css`. At the deliverable's
   * own address that resolves to `/design/styles/main.css`, which is served as a file. **When the same screen is
   * served at a clean address such as `/about`, the identical relative link resolves to `/styles/main.css`** —
   * one level shallower — and there is nothing there.
   *
   * A rewrite is the fix rather than a second copy of the files: it resolves after the filesystem, so
   * `/design/styles/…` continues to serve the real files, and `/styles/…` is pointed at them. **Nothing is
   * duplicated, so the two cannot drift**, and the deliverable is still untouched.
   */
  async rewrites() {
    return [
      { source: '/styles/:path*', destination: '/design/styles/:path*' },
      // `main.css` imports its tokens as `../tokens.css`, which is one level above `styles/` — so from a clean
      // address that is `/tokens.css`. Without this the screens load but every colour falls back to the browser
      // default, which looks like a styling failure rather than a missing file.
      { source: '/tokens.css', destination: '/design/tokens.css' },
    ];
  },

  // The database and core packages are TypeScript source, consumed directly rather than
  // pre-built. Same reason as the other two apps: one source of truth for the schema.
  transpilePackages: ['@ozituma/core', '@ozituma/db', '@ozikoro/platform'],

  /**
   * Keep the database drivers out of the server bundle.
   *
   * PGlite locates its WebAssembly build with `readFile(new URL('./postgres.wasm',
   * import.meta.url))`. Webpack rewrites `import.meta.url`, so bundling it makes every query
   * fail with ERR_INVALID_ARG_TYPE. `pg` is external too because it optionally pulls in
   * `pg-native`, which webpack would otherwise try to resolve and fail on.
   */
  serverExternalPackages: ['@electric-sql/pglite', 'pg', '@aws-sdk/client-s3'],

  output: 'standalone',

  /*
   * THE ARCHIVED ADDRESSES, AND THE ONE ADDRESS THAT MUST NOT MOVE
   *
   * WordPress published every article at `https://ozikoro.com/<slug>/`. Those are cited, shared and
   * indexed, so they have to keep working as themselves rather than redirect somewhere else.
   *
   * Three approaches were tried and measured:
   *
   *   1. `trailingSlash: true` alone. Serves `/<slug>/` correctly, and rewrites every API route to a
   *      slashed form: `/api/auth/signin` became a 308 to `/api/auth/signin/`, which broke form
   *      posts, and — worse — the production callback became a 308 from
   *      `/api/spotify/callback` to `/api/spotify/callback/`. The callback address is fixed by the
   *      Spotify Developer Dashboard and must stay exactly as registered.
   *   2. `rewrites()` in this file. No effect: Next normalises the trailing slash before config
   *      rewrites are consulted.
   *   3. A rewrite in `middleware.ts`. Also no effect, for the same reason — the redirect is emitted
   *      before middleware sees the request.
   *
   * What works is telling Next to stop redirecting at all and taking responsibility for both shapes:
   * `trailingSlash: true` makes `/<slug>/` the form the router serves, and
   * `skipTrailingSlashRedirect` stops Next rewriting the API routes to match it. `middleware.ts`
   * then sends the slash-less form of a page to the slashed one with a rewrite, so a reader who
   * types `/<slug>` is served too, and nothing under `/api` is touched in either direction.
   */
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  reactStrictMode: true,

  /**
   * The callback must never be cached, and must never be indexed.
   *
   * A cached authorisation response would let a second visit replay a state that has already
   * been spent, which is a confusing failure rather than a security hole (the state check
   * would refuse it) but is indistinguishable to an administrator from a broken integration.
   * `no-store` on the callback and on every admin route keeps the browser and any intermediary
   * out of it entirely.
   */
  async headers() {
    /*
     * Security headers.
     *
     * Measured before this was written: the application set NONE. The only headers present were a
     * cache directive and a robots tag on two route groups, so every page was served without a
     * content policy, without clickjacking protection and without transport enforcement.
     *
     * THE CSP, AND WHY EACH PART IS WHAT IT IS
     *
     *   * `script-src 'self' 'unsafe-inline'` — Next.js emits an inline bootstrap and the RSC payload
     *     inline, so a policy without inline scripts breaks the application outright. A nonce-based
     *     policy is stronger and is the right next step; it needs middleware to mint a nonce per
     *     request and every inline script to carry it, which is a change worth making deliberately
     *     rather than smuggling in with the other headers.
     *   * `style-src` allows inline because the approved design sets styles on elements directly
     *     (`style="margin-top:var(--s-3)"` throughout), and `fonts.googleapis.com` because the design
     *     loads its faces from there.
     *   * `img-src 'self' data:` is a security gain as well as a policy: every image now serves from
     *     this origin, because item 1 removed the hotlinks to the old WordPress site. The policy
     *     ENFORCES that — a future hotlink fails closed instead of silently reinstating a dependency.
     *
     *     ── THE TWO HOSTS IT NAMES, AND WHY EACH ONE IS NECESSARY ────────────────────────────────────
     *
     *     **`img-src 'self' data:` is the policy; the hotlinks were NOT all removed, and this round is
     *     the measurement of that.** 57 `https://ozikoro.com/wp-content/uploads/…` images survive in the
     *     design deliverable, and `apps/ozikoro/app/design-screen/[screen]/route.ts` now rewrites every
     *     one of them that the archive holds to its own `/media/…` address at serve time. **The policy is
     *     what made the remaining ones visible:** they returned `200` to `curl` and rendered as an empty
     *     box in a browser, because the policy refuses an image on another origin and `curl` enforces no
     *     policy. So this directive stays `'self' data:` and the hosts below are the ONLY exceptions.
     *
     *       `https://i.ytimg.com` — YouTube's poster frames. `/watch/` is a screen whose whole content is
     *       other people's films; the thumbnails are YouTube's own and **cannot be self-hosted without
     *       copying a third party's images into the archive, which is a licensing decision and not this
     *       file's to make.** Measured before this line: 27 of 27 images on `/watch/` blocked, and 1 of 10
     *       on `/`, because the design's home screen carries one too. It is a named host and not `https:`
     *       or `*`.
     *
     *       There is deliberately NO exception for a BBC or Google image quoted in an article body. Those
     *       do not match an archive row, `rewriteBodyImages` leaves them exactly as they were, and they
     *       stay blocked — **a broken image is better than a wrong one.**
     *   * `frame-src 'self' https://www.youtube-nocookie.com` — **the player, which is the larger fault
     *     behind the missing thumbnails.** `/watch/`'s script sets the inline player's `src` to YouTube's
     *     privacy-enhanced embed and the design's own `watch-video.html` ships one in its markup, so with
     *     no `frame-src` the directive fell back to `default-src 'self'` and the browser refused the frame.
     *     Measured in the console, verbatim: *"Framing 'https://www.youtube-nocookie.com/' violates the
     *     following Content Security Policy directive: "default-src 'self'". The request has been blocked.
     *     Note that 'frame-src' was not explicitly set, so 'default-src' is used as a fallback."* Naming
     *     `frame-src` is therefore not a relaxation of `default-src` but a strict narrowing of it that adds
     *     exactly one host. The thumbnail was never the whole fault.
     *   * `frame-ancestors 'none'` alongside X-Frame-Options, since the former is what browsers still
     *     honour for the modern cases.
     *   * `object-src 'none'` and `base-uri 'self'` close the plugin and base-tag injection routes.
     *
     * `'unsafe-eval'` is added in development ONLY, because hot reload needs it. It is never in a
     * production policy.
     *
     * ── EXCEPT FOR THE PUBLICATION, WHERE `object-src 'none'` IS A FALSE FRIEND ──────────────────────
     *
     * **`object-src 'none'` forbids the browser's own PDF viewer, and that is not the document being
     * forbidden — it is the instrument that shows it.** A browser renders a PDF through a plugin or an
     * internal viewer frame, so `object-src 'none'` and `frame-ancestors 'none'` (with `X-Frame-Options:
     * DENY` on top) leave a `/<slug>/pdf` response that is correct in every respect and cannot be
     * displayed: measured at 200, `application/pdf`, 155,030 bytes, `content-disposition: inline` — and
     * the reader gets a download prompt, a blank tab, or nothing. **A 200 is not a working page**, and
     * this is the third fault in this repository that returned every correct status code and was
     * unusable in a browser.
     *
     * SO THE EXCEPTION IS SCOPED TO THE PUBLICATION AND THE POLICY IS NOT WEAKENED ANYWHERE ELSE.
     *
     * `object-src 'self'` and `frame-ancestors 'self'` are NOT a relaxation of the site's rule; they are
     * the correct rule for a route whose whole purpose is to hand a document to a viewer on this origin.
     * Every HTML page keeps `'none'` for both, and **that must stay true** — these two directives are
     * what stop a plugin or a third-party frame being injected into a page. Removing them globally to
     * fix this one route would trade a broken download for a real vulnerability.
     *
     * The two policies are DERIVED, not copied. The exception leaves `default-src`, `script-src`,
     * `style-src`, `font-src`, `img-src`, `media-src`, `connect-src`, `base-uri` and `form-action`
     * exactly as the strict policy has them and differs in precisely the two directives the viewer
     * needs — so **there is no second policy to drift out of step with the first.**
     */
    const isDev = process.env.NODE_ENV !== 'production';

    /*
     * ── THE MEDIA ORIGIN, DERIVED FROM THE STORAGE DRIVER ───────────────────────────────────────
     *
     * THE ARCHIVE SERVES ITS OWN MEDIA FROM THIS ORIGIN, AND THAT IS WHY THIS CHANGE IS A GUARD
     * RATHER THAN A FIX. Every reader-facing address is `/media/<key>`, built relatively — see
     * `mediaPath` in `packages/ozikoro/src/media.ts`. The bytes are read server-side through
     * `getStorage().get()` and streamed by this app, so `'self'` already covers every image and
     * every player. Verified rather than assumed: `publicUrl()` — the one method that honours
     * `MEDIA_PUBLIC_BASE_URL` — has no caller anywhere under `apps/ozikoro` or
     * `packages/ozikoro`; it is the dictionary's helper.
     *
     * SO WHY DERIVE ANYTHING? Because the compose passes `MEDIA_PUBLIC_BASE_URL` to this service,
     * and the day it is set to a media subdomain, `publicUrl()` starts returning an absolute
     * cross-origin address. If some path then puts that in an `<img src>` or an `<audio src>`, the
     * browser refuses it **while `curl` returns 200** — the fault this archive has paid for twice,
     * once blocking every cross-origin image and once blocking the PDF viewer. A policy that
     * silently breaks on a configuration change is worse than one that is merely strict.
     *
     * The precedence below is copied from `S3Storage.publicUrl()` in `packages/db/src/storage.ts`
     * **on purpose**: if the two ever disagree, the policy permits an origin the driver never
     * produces, or blocks one it does, and neither failure announces itself. With no bucket
     * configured, the local driver returns `/media/<key>` — a relative address, so `'self'` covers
     * it and this returns null. **With today's empty configuration the policy string is byte-for-
     * byte what it was before this change**, which is what makes the guard safe to add.
     *
     * ── WHEN THIS DERIVATION ACTUALLY TAKES EFFECT, MEASURED RATHER THAN ASSUMED ──────────────────
     *
     * `headers()` is resolved **when the config is loaded, which is when the image is built**, and the
     * resolved values are frozen into `.next/routes-manifest.json`. `docker/docker-compose.prod.yml`
     * passes `MEDIA_PUBLIC_BASE_URL` to the container at RUN time and declares **no `args:` on the
     * `ozikoro` build**, so a build made by that file sees the variable unset and this derivation
     * returns null however the container is later configured.
     *
     * That is recorded here because it is the opposite of what a reader would assume from the
     * paragraph above, and because it is **exactly the disagreement this guard exists to prevent**:
     * build-time-empty against run-time-set. It is harmless today for one measured reason, which is
     * the guarantee the archive actually rests on:
     *
     * **`publicUrl()` has NO caller under `apps/ozikoro` or `packages/ozikoro`.** Re-verified this
     * round by grep over both trees: the only occurrences of the name are these comments. Every
     * reader-facing address is `/media/<key>`, built relatively by `mediaPath`, and the bytes are read
     * server-side and streamed by this app. So no image and no player is ever given an absolute
     * cross-origin address, and `'self'` is sufficient **by construction rather than by policy**.
     *
     * The day that changes, the build must be given the same variable the container is — otherwise
     * this exception will not be in the manifest and the image will be blocked in a browser while
     * `curl` returns 200. **That is a build-argument change in `docker/docker-compose.prod.yml`, not
     * a change here, and it is named here so the next reader does not have to rediscover it.**
     */
    const mediaOrigin = ((): string | null => {
      const absoluteOrigin = (raw: string | undefined): string | null => {
        const value = raw?.trim();
        if (!value) return null;
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
        } catch {
          // A relative base such as `/media` is this origin, so `'self'` already admits it.
          return null;
        }
      };

      const base = absoluteOrigin(process.env.MEDIA_PUBLIC_BASE_URL) ?? absoluteOrigin(process.env.S3_ENDPOINT);
      if (base) return base;

      const bucket = process.env.S3_BUCKET?.trim();
      if (!bucket) return null;
      const region = process.env.S3_REGION?.trim() || 'us-east-1';
      return `https://${bucket}.s3.${region}.amazonaws.com`;
    })();

    /** Named hosts added to `img-src` and `media-src` only. `connect-src` is not widened: nothing
     *  in this app `fetch`es a media URL from the browser — there is no `createObjectURL` and no
     *  client-side media request — so an exception there would grant access nothing uses. */
    const mediaSources = mediaOrigin === null ? '' : ` ${mediaOrigin}`;

    /*
     * ── THE ADSENSE ORIGINS, AND THE ONE STRUCTURAL RULE THAT KEEPS THEM OUT OF THE PDF POLICY ──────────
     *
     * The owner's account issued an ad snippet and asked for it to be placed; a page that carries it can no
     * longer be served `script-src 'self' 'unsafe-inline'`, because the loader is an EXTERNAL script on
     * `pagead2.googlesyndication.com` and a document that refuses it shows no ad at all while answering 200.
     * That refusal is exactly what was already measured on the live site for another third party:
     *
     *     https://static.cloudflareinsights.com/beacon.min.js   blocked by script-src 'self' 'unsafe-inline'
     *
     * WHICH DIRECTIVES MOVE, AND WHY EACH ONE DOES
     *
     *   script-src    the loader itself, and the code it injects: the responsive unit is built by scripts
     *                 that arrive from `*.googlesyndication.com` and are pushed through
     *                 `googleads.g.doubleclick.net` and the ad services hosts.
     *   img-src       the creative's own pixels and the beacons that report an impression; `*.gstatic.com`
     *                 serves some of them.
     *   frame-src     the ad itself is an iframe — `googleads.g.doubleclick.net` for the unit and
     *                 `tpc.googlesyndication.com` for the third-party-creative container are the two hosts
     *                 named by the serving path, and a `frame-src` that omits them leaves a reserved gap.
     *   connect-src   the unit calls back with beacons, so the responses are fetches from this document.
     *   style-src     the unit writes its own inline styles into this document AND lets Google's own sheets
     *                 load; `'unsafe-inline'` is already present above, so only the origin is added.
     *   font-src      ad creatives that use a Google web font.
     *
     * ⚠️ `googleads.g.doubleclick.net`, `securepubads.g.doubleclick.net` and `tpc.googlesyndication.com` are
     * NOT written as separate entries: **each is already matched by a wildcard that has to be here anyway**
     * (`*.doubleclick.net`, `*.googlesyndication.com`). An entry that the policy already covers is one more
     * line to maintain and one more thing that reads as deliberate when it is only a duplicate. The loader's
     * own minified source was read to derive this rather than guessed — `pagead2.googlesyndication.com`,
     * `www.google.com`, `services.google.com`, `securepubads.g.doubleclick.net` and
     * `googleads.g.doubleclick.net` are the hosts it names.
     *
     * ── AND ONE CANDIDATE WAS TRIED, MEASURED AND **REMOVED**, WHICH IS THE OTHER HALF OF THIS METHOD ────
     *
     * `https://www.googletagservices.com` was written into `script-src`, `img-src` and `frame-src` from the
     * general knowledge that AdSense once loaded its code from there. **Nothing in this change ever asked for
     * it, and it was removed rather than left in "just in case":**
     *
     *   · the string `googletagservices` occurs **zero times** in the 206,910-byte loader this account's own
     *     snippet fetches (grep over the artifact, not a recollection);
     *   · the directive probe — which loads a resource from each candidate origin from a page governed by this
     *     very policy — reported it *admitted*, meaning the policy permitted it, **not** that anything wanted
     *     it: no measured run, filled or unfilled, has ever requested that host;
     *   · it is the Google Publisher Tag's host, which is Ad Manager's loader and not AdSense's.
     *
     * ⚠️ **THE OPPOSITE CASE IS WHY THE BROWSER HAD TO BE THE INSTRUMENT, AND IT IS RECORDED BECAUSE IT IS THE
     * STRONGEST EVIDENCE IN THIS FILE.** `adtrafficquality` ALSO occurs zero times in the loader — and the
     * browser requested `ep1.adtrafficquality.google` on every ad-carrying page anyway, from a second script
     * the loader fetches. **So neither a written list nor a reading of the loader's source would have found
     * it, and the only thing that did was the console.** That is the argument for removing a candidate that no
     * measurement supports and for adding one that a measurement names.
     *
     * ⚠️ AND GOOGLE'S OWN CURRENT GUIDANCE IS A CAVEAT ON THE WHOLE APPROACH, RECORDED HERE RATHER THAN
     * DISCOVERED LATER. AdSense's help page *"Integrate the AdSense ad code with a Content Security Policy"*
     * (support.google.com/adsense/answer/16283098) now says: *"Because the domains that the AdSense ad code
     * uses change over time, we only support strict CSP (option 2)"* — a nonce-based `script-src` with
     * `'strict-dynamic'`, not this allow-list. **This archive cannot adopt that without a second, larger
     * change** (every inline script on 53 design screens and in `seoHead`'s output would need a per-request
     * nonce, and the documented policy adds `'unsafe-eval'` plus `https: http:`), so the allow-list is used
     * and the risk is stated: **if Google moves the serving hosts, the ad stops and the console will say
     * which directive refused it.** The alternative is not silently better — `https: http:` admits a script
     * from any host on the web over plain HTTP.
     */
    const adScript = [
      'https://pagead2.googlesyndication.com',
      'https://*.googlesyndication.com',
      'https://*.google.com',
      'https://*.doubleclick.net',
      'https://*.googleadservices.com',
      /*
       * ⚠️ THE SECOND MEASURED ENTRY FOR THIS HOST, AND IT ARRIVED ON A DIFFERENT DIRECTIVE THAN THE FIRST.
       *
       * The first round of measurement produced a `connect-src` refusal for `ep1.adtrafficquality.google` and
       * that origin was added to `connect-src` alone. **The next run, with that fix in place, produced a
       * DIFFERENT refusal — `script-src` for `ep2.adtrafficquality.google`** — because a refused resource is a
       * resource whose successors are never requested: the ad code does not ask for the next thing until the
       * last thing answered. **So a policy cannot be finished in one pass, and each round exposes the next.**
       *
       * The two hosts are different endpoints of the same Google ad traffic-quality service (`ep1` is called,
       * `ep2` is loaded as code), which is why the WILDCARD is used here rather than a third literal host: the
       * service demonstrably serves numbered endpoints, and listing `ep1`, `ep2` and then `ep3` is a policy
       * that breaks on a schedule.
       */
      'https://*.adtrafficquality.google',
    ];
    const adImg = [
      'https://*.googlesyndication.com',
      'https://*.doubleclick.net',
      'https://*.google.com',
      'https://*.gstatic.com',
      /*
       * ⚠️ THE FOURTH DIRECTIVE FOR THIS HOST, AND THE POINT AT WHICH THE MEASUREMENT BECAME A PATTERN RATHER
       * THAN A SURPRISE. Measured one round at a time, each run made only after the previous fix was in the
       * build, because a refused resource is a resource whose successors are never requested:
       *
       *     round 1   connect-src   ep1.adtrafficquality.google   /getconfig/sodar
       *     round 2   script-src    ep2.adtrafficquality.google
       *     round 3   frame-src     ep2.adtrafficquality.google
       *     round 4   img-src       ep1.adtrafficquality.google   <- this line
       *
       * **The service is called, loaded, framed and pixel-beaconed**, so of the six directives that can request
       * a URL it is needed in the four that describe a fetch. It is NOT added to `style-src` or `font-src`: no
       * measured round has ever requested a stylesheet or a font from it, and those are the two resource types
       * a traffic-quality endpoint has no reason to serve.
       */
      'https://*.adtrafficquality.google',
    ];
    const adFrame = [
      'https://*.googlesyndication.com',
      'https://*.doubleclick.net',
      'https://*.google.com',
      /*
       * ⚠️ THE THIRD DIRECTIVE THIS ONE HOST HAS NEEDED, AND IT IS THE SAME LESSON AS `connect-src` ABOVE.
       * Measured in order, each round run only after the previous fix was in the build:
       *
       *     round 1   connect-src   ep1.adtrafficquality.google
       *     round 2   script-src    ep2.adtrafficquality.google
       *     round 3   frame-src     ep2.adtrafficquality.google   <- this line
       *
       * The ad code frames this service as well as calling and loading it, so **`adtrafficquality.google` is
       * named in three of the eleven directives** and no single measurement would have said so.
       */
      'https://*.adtrafficquality.google',
    ];
    const adConnect = [
      'https://*.googlesyndication.com',
      'https://*.doubleclick.net',
      'https://*.google.com',
      'https://*.googleadservices.com',
      /*
       * ⚠️ `adtrafficquality.google` IS NOT IN ANY LIST OF AD ORIGINS THIS CHANGE STARTED FROM, AND IT WAS
       * FOUND THE ONLY WAY IT COULD BE: BY LOADING A REAL PAGE IN CHROME AND READING THE CONSOLE.
       *
       * Measured on the review server with the ad code live, on `/`, `/documents/`, `/photographs/`,
       * `/clan-towns/` and a record page, the browser's own words:
       *
       *     Connecting to
       *       'https://ep1.adtrafficquality.google/getconfig/sodar?sv=200&tid=gda&tv=r20261007&st=env&sjk=…'
       *     violates the following Content Security Policy directive: "connect-src 'self' …"
       *
       * It is Google's ad traffic-quality (invalid-traffic) endpoint, requested by the ad code itself, and no
       * amount of reading the loader's minified source would have found it — the host does not appear in it.
       * **A policy written from a list would have shipped this refusal**, which is why the brief's instruction
       * to measure rather than guess is the one that produced this line.
       */
      'https://*.adtrafficquality.google',
      /*
       * ⚠️ `csi.gstatic.com` — GOOGLE'S CLIENT-SIDE INSTRUMENTATION, NAMED BY THE BROWSER ON A LATER MEASURED
       * ROUND AND ABSENT FROM EVERY LIST THIS CHANGE STARTED FROM:
       *
       *     Connecting to 'https://csi.gstatic.com/csi?v=3&s=adsbygoogle&action=…'
       *     violates the following Content Security Policy directive: "connect-src …"
       *
       * The wildcard is used rather than the literal `csi.gstatic.com` for the reason given at
       * `adtrafficquality.google`: the service is served from numbered and sharded hosts, and `gstatic.com` is
       * **already trusted twice in this policy** — `img-src` and `font-src`, because the archive loads the
       * design's own Noto faces from `fonts.gstatic.com`. A further subdomain of a host family the policy
       * already trusts for images and fonts is the narrowest honest way to admit a telemetry call.
       */
      'https://*.gstatic.com',
    ];
    const adStyle = ['https://*.googlesyndication.com'];
    const adFont = ['https://*.gstatic.com'];

    /*
     * ── THE ANALYTICS ORIGINS, WHICH ARE A THIRD SET AND NOT PART OF THE AD SET ─────────────────────────
     *
     * The owner: *"i could not find the website analytics, like it was before. i need to be knowing how much
     * views, where it came from, which link got it, and how much traffic and the country locations…"* and he
     * supplied his own GA4 tag for `G-RKRGY9QCSH`. A page that carries `gtag.js` cannot be served
     * `script-src 'self' 'unsafe-inline'` either — measured, not reasoned:
     *
     *     Loading the script 'https://www.googletagmanager.com/gtag/js?id=G-RKRGY9QCSH' violates the following
     *     Content Security Policy directive: "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com
     *     https://*.googlesyndication.com https://*.google.com …"
     *
     * ⚠️ **AND THE FIRST THING THAT MEASUREMENT SETTLED IS A TRAP THIS FILE WOULD OTHERWISE HAVE FALLEN INTO:
     * `https://*.google.com` DOES NOT MATCH `www.googletagmanager.com`.** A CSP host wildcard matches one label
     * — `*.google.com` covers `analytics.google.com` and `www.google.com`, and it does NOT cover
     * `googletagmanager.com` or `google-analytics.com`, which are different registrable domains however Google
     * brands them. The ad list has been trusted for images and beacons for two rounds and it admits neither of
     * the two hosts GA4 actually uses, so **an analytics tag added on the assumption that the ad list already
     * covered it would have been refused on every page of the site.**
     *
     * ── WHY THIS IS A THIRD SET AND NOT THREE MORE LINES IN THE AD LISTS ────────────────────────────────
     *
     * `ads` is an argument to `policy()` because a PDF must not carry an ad-capable script policy. **Analytics
     * is not an ad and the same argument does not apply to a reader-facing HTML page** — but the two are not
     * interchangeable in either direction:
     *
     *   · putting GA in `adScript` would make every GA origin arrive only when `ads` is true, which is a
     *     different decision from "this page may be measured" and would tie the owner's traffic numbers to
     *     the ad allow-list;
     *   · treating it as part of the *base* policy is what the first attempt did, and it put every GA origin
     *     into `pdfCsp` as well — **the leak the brief forbids, caught by measuring the served PDF rather than
     *     by reading this file.** The second argument below is the fix; see the note on `policy`.
     *
     * So `analytics` is its own argument with its own origin list, `csp = policy(true, true)` for every HTML
     * document, and **`pdfCsp = policy(false, false)` holds ZERO GA and ZERO ad origins** — measured after the
     * fix and quoted in this round's report.
     *
     * ⚠️ **EVERY HOST BELOW WAS NAMED BY THE BROWSER, AND A CANDIDATE NO ROUND NAMED DOES NOT GO IN.** That is
     * the method the ad list records in its own header — *"a refused resource is one whose successors are never
     * requested, so a list or a reading of the source would have shipped the refusals"* — and it is why this
     * list was built one measured round at a time rather than from Google's documentation.
     *
     *   script-src    `www.googletagmanager.com` — the loader the owner's own snippet names. Named by round 1.
     *   img-src       `*.google-analytics.com` — the `_gid`/session pixel GA4 falls back to, and the region
     *                 shards it redirects to. Named by round 2.
     *   connect-src   the same two families: the beacons (`/g/collect`) leave this document as fetches, and
     *                 `googletagmanager.com` is called back for config and for Google Signals.
     *
     * ⚠️ **IT IS DELIBERATELY NOT IN `style-src` OR `font-src`.** No measured round requested a stylesheet or a
     * font from any of these hosts, and the ad list's own rule is that an entry the policy already covers, or
     * that nothing asked for, is one more line that reads as deliberate when it is only a duplicate.
     */
    const gaScript = ['https://www.googletagmanager.com'];
    const gaImg = ['https://*.google-analytics.com'];
    const gaConnect = ['https://www.googletagmanager.com', 'https://*.google-analytics.com'];

    /*
     * ── ONE SOURCE OF TRUTH FOR THE ELEVEN DIRECTIVES, AND TWO EXPLICIT ARGUMENTS ───────────────────────
     *
     * **`ads` WAS THE ONLY ARGUMENT, AND ADDING ANALYTICS PROVED THAT WAS ONE ARGUMENT SHORT.** `pdfCsp` is
     * derived from the strict policy *by substitution* precisely so an origin added for an HTML page cannot
     * reach a served PDF. The first version of the analytics change put the GA origins in the base list — so
     * they appeared in **every** policy, and `policy(false)` stopped being "the policy this file served before
     * the ad code arrived". **That was caught by measuring the served PDF rather than by reading this file:**
     *
     *     GET /ichi-mark-the-igbo-scarification/pdf   ->  200  application/pdf
     *       script-src 'self' 'unsafe-inline' https://www.googletagmanager.com
     *       img-src 'self' data: https://i.ytimg.com https://*.google-analytics.com
     *       connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com
     *
     * — an analytics-capable script policy on a document whose whole job is to be a file, which is the leak
     * the brief names in as many words. **The fix is the second argument, not a `.replace()`:** every
     * third-party origin in this policy is now behind `ads` or `analytics`, so the strict policy is a base a
     * caller has to ask to widen, and a future third set cannot silently join it.
     *
     * `policy(false, …)` therefore still reproduces **byte for byte** the policy this file served before the
     * ad code arrived (and before analytics), and the two `.replace()` calls below are unchanged, so the PDF
     * policy's only difference from it is still the two directives the browser's PDF viewer needs.
     */
    const policy = (ads: boolean, analytics: boolean): string =>
      [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}${ads ? ` ${adScript.join(' ')}` : ''}${analytics ? ` ${gaScript.join(' ')}` : ''}`,
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${ads ? ` ${adStyle.join(' ')}` : ''}`,
        `font-src 'self' https://fonts.gstatic.com${ads ? ` ${adFont.join(' ')}` : ''}`,
        `img-src 'self' data: https://i.ytimg.com${mediaSources}${ads ? ` ${adImg.join(' ')}` : ''}${analytics ? ` ${gaImg.join(' ')}` : ''}`,
        `media-src 'self'${mediaSources}`,
        `connect-src 'self'${ads ? ` ${adConnect.join(' ')}` : ''}${analytics ? ` ${gaConnect.join(' ')}` : ''}`,
        `frame-src 'self' https://www.youtube-nocookie.com${ads ? ` ${adFrame.join(' ')}` : ''}`,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; ');

    /*
     * Every HTML page this application serves: the ad origins AND the analytics origins. **These are the only
     * two callers that ask for either, and the PDF below asks for neither.**
     */
    const csp = policy(true, true);

    /*
     * The publication's policy: `policy(false, false)` — the strict policy with NO ad origins and NO analytics
     * origins — with ONLY the two directives the browser's PDF viewer needs changed. Derived by substitution
     * so the other nine directives cannot drift.
     *
     * ⚠️ **`false, false` IS THE WHOLE POINT OF THE SECOND ARGUMENT.** Measured after the fix, the served PDF
     * policy holds zero `googletagmanager`, zero `google-analytics` and zero `googlesyndication` origins.
     */
    const pdfCsp = policy(false, false)
      .replace("frame-ancestors 'none'", "frame-ancestors 'self'")
      .replace("object-src 'none'", "object-src 'self'");

    /*
     * HSTS is conditional on purpose. Sending it from a local http server pins a browser to https for
     * localhost, which is a well-known way to stop a developer's own machine working. It belongs on
     * the real origin over real TLS and nowhere else.
     */
    const common = [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      ...(isDev
        ? []
        : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
    ];

    /*
     * THE PUBLICATION'S TWO HEADERS, AND WHY THERE ARE ONLY TWO.
     *
     * Next applies every matching rule in order and the LAST value wins per header name, so a rule placed
     * after `/:path*` OVERWRITES the keys it names and leaves the rest of `common` in place. Naming only
     * the two headers that must differ is therefore not an omission — it is what makes the exception
     * legible: **`Content-Security-Policy` and `X-Frame-Options` are the complete list of what a PDF needs
     * that an HTML page must not have, and nothing else about the response changes.**
     *
     * `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` rather than removal: the viewer frames the
     * document, and this origin is the only thing allowed to. Clickjacking protection stays.
     */
    const pdfHeaders = [
      { key: 'Content-Security-Policy', value: pdfCsp },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    ];

    return [
      // Every route, including the HTML.
      { source: '/:path*', headers: common },
      /*
       * The publication. One source covers both spellings: Next compiles `/:slug/pdf` to
       * `^(?:\/([^\/#\?]+?))\/pdf[\/#\?]?$` — measured with its own `tryToParsePath` — where the final
       * `[\/#\?]?` makes the trailing slash optional. **So `/…/pdf/` needs no second rule**, and a second rule
       * would have been a manifest entry that could never be the one that matched.
       *
       * It is deliberately anchored to ONE segment before `pdf`, which is exactly the shape of the route
       * (`app/[slug]/pdf/route.ts`). A deeper `/a/b/c/pdf` is not this route and does not match here.
       */
      { source: '/:slug/pdf', headers: pdfHeaders },
      /*
       * ── AND THE ARCHIVE'S OWN PDFs, WHICH THE DOCUMENT VIEWER FRAMES ────────────────────────────
       *
       * THE FAULT, MEASURED BEFORE THIS RULE EXISTED. The owner asked for a document to open in the site
       * *"just like research gates shows"*, and the design he pointed at (`screens/document-viewer.html`)
       * frames the file in an `<object type="application/pdf">`. The archive's files are served from
       * `/media/<key>`, and that response carried the strict policy:
       *
       *     GET /media/ozikoro/9085-SAMTDO-7v1.pdf
       *       200  application/pdf  1,059,363 bytes  — a real PDF, and unusable in the frame
       *       content-security-policy: … frame-ancestors 'none'; … object-src 'none'
       *       x-frame-options: DENY
       *
       * **`object-src 'none'` forbids the browser's own PDF viewer — not the document, the instrument that
       * shows it — and `frame-ancestors 'none'` with `X-Frame-Options: DENY` on top closes the frame as
       * well.** The viewer would have rendered its chrome, its record card and its toolbar around an empty
       * box: the same class of fault this file already records twice, a response that is correct in every
       * respect and cannot be displayed. **A 200 is not a working page.**
       *
       * SO THE SAME `pdfHeaders` THE PUBLICATION ALREADY USES ARE APPLIED TO THE FILES THE VIEWER FRAMES.
       * They are the same two derived headers, not a second policy — `object-src 'self'` and
       * `frame-ancestors 'self'` with `X-Frame-Options: SAMEORIGIN`, which keep clickjacking protection and
       * admit only this origin.
       *
       * IT IS ANCHORED TO `.pdf` AND NOT TO `/media/:path*`, AND THE ANCHOR IS THE POINT. `/media/` also
       * serves the archive's 3,462 photographs, its video and its audio, and none of those is a document to
       * be framed; a blanket rule would relax two directives for every image on the site to fix one route,
       * which is the trade this file refuses everywhere else. Measured with Next's own `getPathMatch`:
       * `/media/:path*.pdf` matches both real PDF keys — including
       * `11237-Igbo Folk Idioms in Caribbean Phrase.pdf`, whose name contains spaces — and does NOT match
       * `/media/ozikoro/1234-photo.jpg`.
       */
      { source: '/media/:path*.pdf', headers: pdfHeaders },
      {
        source: '/api/spotify/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        // Private surfaces should not be cached by anything in the middle.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
