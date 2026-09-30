import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The database and core packages are TypeScript source, consumed directly
  // rather than pre-built. That keeps one source of truth for the schema and
  // domain logic, and means `next build` type-checks them as part of the app.
  transpilePackages: ['@ozituma/core', '@ozituma/db'],

  /**
   * Keep the database drivers out of the server bundle.
   *
   * PGlite locates its WebAssembly build with `readFile(new URL('./postgres.wasm',
   * import.meta.url))`. Webpack rewrites `import.meta.url`, so bundling it makes
   * every query fail with ERR_INVALID_ARG_TYPE ("path argument must be a string
   * or URL"). Marking it external leaves the require() to Node at runtime, where
   * import.meta.url resolves correctly.
   *
   * `pg` is external too: it optionally pulls in `pg-native`, which webpack
   * would otherwise try to resolve and fail on.
   */
  serverExternalPackages: ['@electric-sql/pglite', 'pg', '@aws-sdk/client-s3'],

  // A Docker image for AWS needs a self-contained server bundle.
  output: 'standalone',

  poweredByHeader: false,
  reactStrictMode: true,

  /*
   * /volunteer is gone.
   *
   * The owner: "delete the volunteer page. Contribute page is already enough, so remove
   * volunteer." The page, its navigation entry and its footer link are removed. This
   * redirect stays so that the address does not become a 404 for anybody who has it in a
   * history, a bookmark or a message — the work it described is what /contribute is for,
   * and a reader who followed a link to it lands where the doing happens.
   */
  async redirects() {
    return [
      { source: '/volunteer', destination: '/contribute', permanent: true },
    ];
  },

  async headers() {
    return [
      {
        // The public API is meant to be called from other people's servers
        // and browsers, so it gets permissive CORS like igboapi.com.
        source: '/api/v1/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, X-API-Key, Authorization',
          },
          { key: 'Access-Control-Expose-Headers', value: 'Content-Range, X-RateLimit-Limit, X-RateLimit-Remaining' },
        ],
      },
    ];
  },
};

export default nextConfig;
