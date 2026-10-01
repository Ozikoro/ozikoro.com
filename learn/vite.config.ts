// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  /*
   * Stop browsers caching the HTML.
   *
   * THE BUG THIS FIXES
   *
   * Pages were served with no `Cache-Control` at all, so browsers applied HEURISTIC caching —
   * guessing a freshness lifetime and reusing the response without asking the server. The symptom
   * was a site that showed a stale page and then appeared to "refresh" once you clicked something,
   * which reads as the app being broken rather than cached.
   *
   * WHY IT IS HERE AND NOT IN MIDDLEWARE
   *
   * `requestMiddleware` in src/start.ts and the wrapper in src/server.ts both looked like the right
   * place, and neither reached the document render: in TanStack Start 1.168.60 the HTML is produced
   * by Nitro's own h3 router, and `src/server.ts` is only the `ssr` fallback service. `routeRules`
   * is the layer that actually decorates the outgoing response.
   *
   * `no-cache` does not mean "do not cache". It means "revalidate before using", and the ETag still
   * turns an unchanged page into a cheap 304. `cdn-cache-control: no-store` additionally stops
   * Cloudflare holding one visitor's HTML and handing it to everyone else.
   *
   * Hashed assets are the opposite case — their filename changes when their contents do, so they can
   * be cached hard and can never be stale. `public/_headers` covers the static files.
   */
  nitro: {
    routeRules: {
      // Specific rules first. Nitro merges header sets rather than replacing them, so listing the
      // immutable cases ahead of the broad rule keeps a hash-named file from also being told
      // "no-cache", which would be contradictory and would win as the stricter instruction.
      "/assets/**": {
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      },
      "/fonts/**": {
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      },
      "/keyboards/**": {
        headers: { "cache-control": "public, max-age=604800" },
      },
      // Everything else is the app itself. The HTML keeps the same URL forever, so it must
      // revalidate — that is the whole fix.
      "/**": {
        headers: {
          "cache-control": "no-cache, must-revalidate",
          "cdn-cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      },
    },
  },
} as Parameters<typeof defineConfig>[0]);
