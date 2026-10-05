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
  // THE BUILD TARGET IS NAMED, AND IT IS NOT CLOUDFLARE.
  //
  // @lovable.dev/vite-tanstack-config supplies `{ defaultPreset: "cloudflare-module" }`, so left
  // alone this app builds a Cloudflare Worker — an artefact `node` cannot run and that no container
  // on the Ozikoro host can serve. The Academy is deployed as a Node server behind Caddy, so the
  // preset is stated here: the wrapper spreads user options over its default, so naming it wins.
  //
  // `node-server` also serves the client assets itself (`serveStatic: true`) and listens on
  // PORT/NITRO_PORT, defaulting to 3000, which is the port Caddy proxies to and the port the
  // Dockerfile exposes.
  nitro: {
    preset: "node-server",
  },
});
