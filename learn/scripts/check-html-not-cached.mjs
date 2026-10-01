/**
 * Fail if the service worker would cache a document.
 *
 * WHY THIS CHECK EXISTS
 *
 * Stale pages were the worst bug in this project — a learner clicking a menu item got a page from a
 * previous deploy, and the advice was to clear the cache, which is not an acceptable answer.
 *
 * A service worker caching the HTML would be far worse than the HTTP cache ever was: it survives
 * deploys, it survives hard refreshes, and the only fix is a cache clear the learner should never
 * have to perform.
 *
 * This is a one-line change away from returning, so it is checked mechanically.
 */
import { readFileSync } from "node:fs";

const sw = readFileSync("public/sw.js", "utf8");
const checks = [];

// Every navigation and document request must be fetched network-only.
checks.push(["the worker handles navigations", /request\.mode === "navigate"/.test(sw)]);
checks.push(["documents bypass the cache", /no-store/.test(sw)]);

/*
 * Navigation must not be written to the cache.
 *
 * THE BRANCH IS EXTRACTED BY BRACE MATCHING, and that is not fussiness — three earlier versions of
 * this check were wrong, and each one PASSED against code with the guard removed:
 *
 *   1. a one-line `if` pattern, which missed the real multi-line form
 *   2. `indexOf` offsets, but the cache helper is defined above the handler so the slice was empty
 *   3. a search for the first `return;` after the guard, which found the UNRELATED `return;` for
 *      supabase requests further down the handler and reported success
 *
 * A guard that passes when the thing it guards is deleted is worse than no guard: it is a claim of
 * safety with nothing behind it. So this locates the block by matching its braces and reads only the
 * statements inside it.
 */
function blockAfter(source, marker) {
  const at = source.indexOf(marker);
  if (at === -1) return null;
  const open = source.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

const navBranch = blockAfter(sw, 'request.mode === "navigate"');

checks.push(["the navigation branch exists", navBranch !== null]);
// The branch must END in a return, so control cannot fall through to the caching path below.
checks.push([
  "navigation returns before anything is cached",
  navBranch !== null && /return;\s*$/.test(navBranch.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").trim()),
]);
checks.push(["navigation never calls cache.put", navBranch !== null && !/cache\.put/.test(navBranch)]);
checks.push(["navigation fetches with no-store", navBranch !== null && /no-store/.test(navBranch)]);

// Per-user and mutating requests must never be cached.
checks.push(["non-GET requests are not cached", /method !== "GET"|request\.method/.test(sw)]);
checks.push(["supabase responses are never cached", /supabase/i.test(sw)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\n  ${failed} caching check(s) failed. A cached document cannot be cleared by a learner.`);
  process.exit(1);
}
