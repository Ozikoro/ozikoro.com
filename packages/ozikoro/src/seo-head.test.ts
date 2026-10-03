/**
 * The generated head, and the one thing from the design's head that must survive it.
 *
 * WHY THIS FILE EXISTS
 *
 * `fillDashboardLinks` inserts `<base href="/">` so the design's own relative links resolve against the site
 * root. `withSeoHead` then replaced the whole `<head>` and **deleted it** — the mechanism was written down,
 * described in the report, and absent from every served page. Nothing tested the pair, so nothing noticed.
 *
 * Measured on the running site before the fix: `/dashboard-reader/`, `/dashboard-admin/` and `/archive/` each
 * served `base=0`, and `/archive-index/` served three `about.html#…` links that resolved to
 * `/archive-index/about.html#…` and 404'd. **A link that 404s looks identical in the source to one that
 * works**, which is why this is asserted rather than left to a reader of the code.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSeoHead } from './seo-head.ts';

const DESIGN = '<!doctype html><html><head><base href="/"><title>The design’s demonstration title</title><link rel="stylesheet" href="/styles/main.css"></head><body>x</body></html>';

test('a base the page already carries survives the generated head', () => {
  const out = withSeoHead(DESIGN, '<title>Histories — the Ozikoro archive</title>');
  assert.match(out, /<head>\s*<base href="\/">/, 'the base was dropped, so every relative link resolves wrong');
  assert.match(out, /<title>Histories — the Ozikoro archive<\/title>/);
});

test('the design’s own head is still discarded, and no base is invented', () => {
  const out = withSeoHead(DESIGN, '<title>Watch — Ozikoro</title>');
  assert.doesNotMatch(out, /demonstration title/, 'the design’s demonstration title was left in place');
  assert.equal((out.match(/<title>/g) ?? []).length, 1, 'a second title makes the document’s title the first one');

  const withoutBase = withSeoHead('<html><head><title>x</title></head><body></body></html>', '<title>y</title>');
  assert.doesNotMatch(withoutBase, /<base/, 'a base was added to a document that did not have one');
});
