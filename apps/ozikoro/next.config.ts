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

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "media-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    /*
     * The publication's policy: the strict policy above, with ONLY the two directives the browser's PDF
     * viewer needs changed. Derived by substitution so the other nine directives cannot drift.
     */
    const pdfCsp = csp
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
