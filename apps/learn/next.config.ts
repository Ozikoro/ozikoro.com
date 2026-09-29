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
};

export default nextConfig;
