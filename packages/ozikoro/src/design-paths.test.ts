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
import { designScriptPaths, designScreenLinks } from './design-paths.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(here, '..', '..', '..', 'apps', 'ozikoro', 'app');

const ARTICLE = '<script src="../reader.js"></script><script src="../mobile-nav.js" defer></script>';

/* The design's own listen screen, as much of it as the link rule needs: a head, the menu it writes with
 * sibling filenames, the two transcript-flavoured controls, and the stylesheets it asks for two levels up. */
const SCREEN = [
  '<html><head><title>Listen — Ozikoro audio library</title>',
  '<link rel="stylesheet" href="../styles/main.css"></head><body>',
  '<a href="home.html">Home</a><a href="archive-index.html">Read</a><a href="listen.html">Listen</a>',
  '<a class="btn btn-ghost" href="article.html">Read the transcript</a>',
  '<a href="about.html#terms">Terms</a><a href="https://ozikoro.com/x/">External</a>',
  '<a href="#episodes">Skip</a></body></html>',
].join('');

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
    /*
     * AND THE SAME FOR THE LINKS, for the same reason one section apart: **a sibling `listen.html` is
     * exactly as relative as `../reader.js`**, and the route that is added next is the one that will have
     * neither.
     */
    assert.match(
      source,
      /designScreenLinks\(/,
      `${file} does not call designScreenLinks, so the menu it serves will 404`,
    );
  }
});

test('the design\'s sibling links are made absolute, and its transcript control with them', () => {
  const out = designScreenLinks(SCREEN);
  assert.match(out, /<base href="\/">/, 'without a base every relative link still resolves one level too deep');
  assert.match(out, /href="\/listen\/"/, 'listen.html still resolves to /<screen>/listen.html');
  assert.match(out, /href="\/article\/"/, 'the transcript control still points at a relative article.html');
  assert.match(out, /href="\/archive\/"/, 'the design\'s archive-index.html is not an address this site serves');
  assert.match(out, /href="\/about\/#terms"/, 'the fragment is dropped, so the link lands at the top of the page');
  assert.match(out, /href="\/styles\/main\.css"/, 'the stylesheet stays two levels up');
  assert.doesNotMatch(out, /href="[a-z0-9-]+\.html/, 'a relative sibling link survived');
  // Rooted, external and in-page addresses are not the deliverable's sibling grammar and are left alone.
  assert.match(out, /href="https:\/\/ozikoro\.com\/x\/"/);
  assert.match(out, /href="#episodes"/);
});

test('a `../` that is not a stylesheet is a file beside the screens, under /design/', () => {
  /*
   * Measured on `/documents/`: `../downloads/research-download-demonstration.pdf` is the design's own
   * download, and the file answers 200 at `/design/downloads/…` and 404 at `/downloads/…`. A `<base>`
   * alone moves the 404 rather than removing it. `../index.html` is the walkthrough's own index, which
   * this site no longer serves, so it points at the home that is the same screen filled.
   */
  const out = designScreenLinks(
    '<html><head></head><body><a href="../downloads/guide.pdf">Download</a>'
    + '<a href="../index.html">The walkthrough</a>'
    + '<form action="archive-index.html" method="get"><input name="q"></form></body></html>'
  );
  assert.match(out, /href="\/design\/downloads\/guide\.pdf"/);
  assert.match(out, /action="\/archive\/"/, 'the search form still posts to a file name');
  assert.doesNotMatch(out, /\.\.\//, 'a relative address reached the served page');
  assert.doesNotMatch(out, /(?:href|action)="[a-z0-9-]+\.html/, 'a relative address reached the served page');
  assert.match(out, /href="\/">The walkthrough/, 'the walkthrough index is not an address this site serves');
});

test('the one meta refresh carries an absolute address too', () => {
  /*
   * `screens/oral-recordings.html` is a notice whose whole job is to move the reader to `/listen/`, and it
   * does it with `<meta http-equiv="refresh" content="0;url=listen.html">`. A `<base>` makes a browser
   * resolve that correctly, and relying on it would leave the class fix with one exception in it.
   */
  const out = designScreenLinks(
    '<html><head><meta http-equiv="refresh" content="0;url=listen.html"><title>x</title></head>'
    + '<body><p>moved</p></body></html>'
  );
  assert.match(out, /content="0;url=\/listen\/"/);
  assert.doesNotMatch(out, /url=listen\.html/);
  // An absolute or in-page refresh target is not the deliverable's sibling grammar and is left alone.
  const kept = '<meta http-equiv="refresh" content="0;url=/listen/">';
  assert.equal(designScreenLinks(`<html><head>${kept}</head><body></body></html>`).includes(kept), true);
});

test('the address rule is idempotent, because one request calls it twice', () => {
  /*
   * It runs once beside `designScriptPaths` and again after the fills — the second call is what reaches an
   * address a FILL wrote. **A second `<base>` would not be harmless**: the last base element wins, so the
   * page would resolve every relative address against a base nobody reading the source would see.
   */
  const once = designScreenLinks(SCREEN);
  const twice = designScreenLinks(once);
  assert.equal(twice, once);
  assert.equal((twice.match(/<base\b/g) ?? []).length, 1, 'the document got a second base');
});

test('an address a fill wrote is reached, and the design\'s own are not touched twice', () => {
  /*
   * Measured on the served pages: `/publication/` carried `cite.html`, `publications.html` and
   * `upload.html`, all written by `fillPublicationRecord` and all resolving one segment too deep. This is
   * the case the second call exists for.
   */
  const afterAFill = '<html><head></head><body><a href="cite.html">Citation guide</a>'
    + '<a href="publications.html">All publications</a></body></html>';
  const out = designScreenLinks(afterAFill);
  assert.match(out, /href="\/cite\/"/);
  assert.match(out, /href="\/publications\/"/);
  assert.doesNotMatch(out, /href="[a-z0-9-]+\.html/);
});
