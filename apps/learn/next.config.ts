import type { NextConfig } from 'next';

/**
 * Ozituma Learn — the courses at learn.ozituma.com.
 *
 * Spec §6.1 chose a separate deployment for the courses over a path on the dictionary, for
 * "separate deployment and scaling; independent release cycle; clean security boundary". This app
 * is that decision made real: it shares `@ozituma/core` and `@ozituma/db` with the dictionary, so
 * the lexicon, the orthography module, the session handling and the account table are not
 * duplicated — but it builds, ships and can be taken down on its own.
 *
 * The two apps also share ONE DATABASE, which is what makes an account created on either work on
 * both. See docs/learn/ACCOUNTS.md.
 */
const nextConfig: NextConfig = {
  // The database and core packages are TypeScript source, consumed directly rather than pre-built.
  // Same reason as the dictionary app: one source of truth for the schema and the domain logic.
  transpilePackages: ['@ozituma/core', '@ozituma/db'],

  /**
   * Keep the database drivers out of the server bundle — see the note in the dictionary's
   * next.config.ts. PGlite locates its WebAssembly with `readFile(new URL(..., import.meta.url))`,
   * and webpack rewrites `import.meta.url`, so bundling it makes every query fail.
   */
  serverExternalPackages: ['@electric-sql/pglite', 'pg', '@aws-sdk/client-s3'],

  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,

  /**
   * The service worker must never be cached.
   *
   * Everything else in `public/` is a static asset with a long max-age, which is right — the icons
   * and the favicon never change. The service worker is the exception, and the difference matters: a
   * browser holding a stale worker keeps running last week's caching rules and last week's fetch
   * handler no matter what is deployed, and the symptom is a site that appears not to update.
   *
   * Measured on the deployed site: without this the header is `max-age=14400`, four hours. Chrome
   * caps script caching at 24 hours regardless, so the worst case is bounded — but a day of a broken
   * worker is still a day of a broken worker, and this costs one header.
   *
   * `no-cache`, not `no-store`: the browser may keep a copy, it must simply revalidate before using
   * it. The request is conditional and normally answered 304, so this is a few bytes per navigation.
   */
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, must-revalidate' },
          // Lets the worker control the whole origin, which it needs in order to serve the shell.
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
