/**
 * Both routes that serve a design screen must rewrite its scripts, and this is what says so.
 *
 * WHY THIS FILE EXISTS
 *
 * The rewrite that points `../reader.js` at `/design/reader.js` was written once, in the design-screen route,
 * and **the article route — which serves a design screen too — never got it.** So `/market-days/` was fixed
 * and every article kept four dead controls: share, copy-link, print and read-aloud, on 1,051 records, behind
 * a page that returned 200 and looked complete.
 *
 * Fixing it in the second place would have left the same trap for the third. It lives in `design-paths.ts`
 * now, and the second test below is the one that matters: **it reads both route files and fails if either
 * stops calling it**, which is the only thing a shared function cannot assert about itself.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { designScriptPaths } from './design-paths.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(here, '..', '..', '..', 'apps', 'ozikoro', 'app');

const ARTICLE = '<script src="../reader.js"></script><script src="../mobile-nav.js" defer></script>';

test('a sibling script reference is served from where the file actually is', () => {
  const out = designScriptPaths(ARTICLE);
  assert.match(out, /src="\/design\/reader\.js"/, 'the article screen\'s whole behaviour still 404s');
  assert.match(out, /src="\/design\/mobile-nav\.js" defer/, 'mobile-nav still 404s');
  assert.doesNotMatch(out, /src="\.\.\//, 'a relative sibling reference survived');
});

test('a rooted or injected reference is left alone', () => {
  const kept = '<script src="/design/reader.js"></script><script src="/article-share.js" defer></script>';
  assert.equal(designScriptPaths(kept), kept);
  // A path with a segment in it is not the deliverable's own sibling grammar, so the rule does not reach it.
  const nested = '<script src="../lib/thing.js"></script>';
  assert.equal(designScriptPaths(nested), nested);
});

test('both routes that serve a design screen call the one implementation', () => {
  /*
   * This is the assertion the fault needed. `design-screen` serves the calendar, the dashboards and the rest;
   * `[slug]` serves the article. Both render the deliverable, so both must point its scripts at `/design/`.
   */
  const files = [
    join(ROUTES, 'design-screen', '[screen]', 'route.ts'),
    join(ROUTES, '[slug]', 'route.ts'),
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.match(
      source,
      /designScriptPaths\(/,
      `${file} does not call designScriptPaths, so the scripts it serves will 404`,
    );
  }
});
