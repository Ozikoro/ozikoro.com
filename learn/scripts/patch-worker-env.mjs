/**
 * Expose the Worker bindings to route handlers.
 *
 * THE BUG THIS PATCHES
 *
 * Nitro's generated Cloudflare entry stores `globalThis.__env__ = env` in its `queue`, `tail` and
 * `trace` handlers but NOT in `fetch` — so a normal HTTP request, which is every request this app
 * serves, finds no bindings on `globalThis`. The Workers AI binding is therefore unreachable from a
 * route handler and the tutor returns `ai_unavailable`.
 *
 * WHY THIS RUNS AFTER THE BUILD
 *
 * `index.mjs` is generated on every build, so an edit to it is lost the next time. Patching here, as
 * the last step before deploy, is the only place the change survives to the deployed artifact.
 *
 * WHY NOT `.output/server/wrangler.json` ALONE
 *
 * That declares the binding. This makes it REACHABLE. Both are needed: a declared binding nothing
 * can read is the same as no binding.
 *
 * The patch is idempotent and fails loudly if Nitro changes the shape, rather than silently
 * deploying a Worker whose AI binding does nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";

const ENTRY = ".output/server/index.mjs";
const MARKER = "globalThis.__env__ = env;";

let source;
try {
  source = readFileSync(ENTRY, "utf8");
} catch {
  console.error(`  ${ENTRY} not found — run the build first.`);
  process.exit(1);
}

// The fetch handler signature Nitro emits for the cloudflare-module preset.
const FETCH = "createHandler({ fetch(cfRequest, env, context, url) {";

if (source.includes(`${FETCH}\n\t${MARKER}`) || source.includes(`${FETCH} ${MARKER}`)) {
  console.log("  entry already exposes env — nothing to patch");
  process.exit(0);
}

if (!source.includes(FETCH)) {
  console.error(
    "  Could not find the fetch handler in the generated entry.\n" +
      "  Nitro's output shape has changed. The AI binding will NOT be reachable.\n" +
      `  Looked for: ${FETCH}`
  );
  process.exit(1);
}

const patched = source.replace(FETCH, `${FETCH}\n\t/* Injected: Nitro omits this in fetch, so bindings are unreachable. */\n\t${MARKER}`, 1);

writeFileSync(ENTRY, patched);
console.log("  entry patched: Worker bindings now reachable from route handlers");
