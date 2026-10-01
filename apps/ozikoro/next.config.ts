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

    return [
      // Every route, including the HTML.
      { source: '/:path*', headers: common },
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
