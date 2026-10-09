/*
 * analytics.test.ts — THE OWNER'S TAG, AND THE FOUR THINGS ABOUT IT THAT MUST NOT DRIFT.
 *
 * This file exists because the tag is the one piece of this change whose failure is **silent**: a page served
 * without it returns 200, renders perfectly and is simply not counted, and nothing in the report says so. The
 * four claims below are the ones a future edit is most likely to break without noticing:
 *
 *   1. the tag is the owner's — the measurement id, the loader address and both of his `gtag` calls, exactly;
 *   2. it lands in `<head>` and nowhere else;
 *   3. a document with no `</head>` is returned **byte for byte**, so a fill that cannot find its anchor is a
 *      missing measurement rather than a mangled page;
 *   4. calling it twice leaves ONE tag — see the function's own note on why a doubled pageview is the worse
 *      fault than a missing one.
 *
 * ⚠️ **WHAT THIS FILE CANNOT PROVE, STATED SO IT IS NOT MISTAKEN FOR A GUARANTEE.** It proves the anchor and
 * the splice on documents built here. It cannot prove them on a *served* page, because that needs the record
 * route, a session and PGlite, and it cannot prove that Chrome executed the loader under the served CSP,
 * because that is the browser's answer and not a string comparison. **Both of those are in this round's
 * report as measurements from the review server rather than as assertions in this file.**
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GA_INLINE, GA_LOADER_SRC, GA_MEASUREMENT_ID, withAnalyticsTag } from './analytics.ts';

/** A record page shaped like the served one: an ad in the body, a citation, a closing `</head>`. */
const RECORD = [
  '<!doctype html><html lang="en"><head>',
  '<title>Egwu Amala — Ozikoro</title>',
  '<link rel="stylesheet" href="/design/styles/main.css">',
  '</head><body class="sx-reading-body">',
  '<main id="article"><article class="sx-book-reader"><div class="prose">',
  '<p>One. The opening paragraph of the history.</p>',
  '<p>Two. The second paragraph of the history.</p>',
  '<p>Three. The third paragraph of the history.</p>',
  '</div></article></main>',
  '</body></html>',
].join('');

test('the id is the owner\'s, and there is exactly one', () => {
  assert.equal(GA_MEASUREMENT_ID, 'G-RKRGY9QCSH');
  // The loader is built from the constant rather than typed again, so the two cannot disagree.
  assert.equal(GA_LOADER_SRC, 'https://www.googletagmanager.com/gtag/js?id=G-RKRGY9QCSH');
  // And both of the owner's calls are present, in his own spelling.
  assert.match(GA_INLINE, /window\.dataLayer = window\.dataLayer \|\| \[\];/);
  assert.match(GA_INLINE, /function gtag\(\)\{dataLayer\.push\(arguments\);\}/);
  assert.match(GA_INLINE, /gtag\('js', new Date\(\)\);/);
  assert.match(GA_INLINE, /gtag\('config', 'G-RKRGY9QCSH', \{ anonymize_ip: true \}\);/);
  // No second vendor and no second property: the measurement id occurs exactly once in the tag.
  assert.equal(GA_INLINE.split('G-RKRGY9QCSH').length - 1, 1);
  assert.equal(GA_LOADER_SRC.split('G-RKRGY9QCSH').length - 1, 1);
});

test('the tag lands in <head>, immediately before its closing tag', () => {
  const out = withAnalyticsTag(RECORD);
  const headClose = out.lastIndexOf('</head>');
  const tagAt = out.indexOf(GA_LOADER_SRC);
  assert.notEqual(tagAt, -1, 'the loader address is not in the document');
  assert.ok(tagAt < headClose, 'the tag is not before </head>');
  // Nothing after the spliced tag moved: the body is byte-identical.
  assert.equal(out.slice(headClose), RECORD.slice(RECORD.lastIndexOf('</head>')));
  assert.equal(out.startsWith(RECORD.slice(0, RECORD.indexOf('</head>'))), true);
});

test('the loader is async, so the tag cannot block the page', () => {
  const out = withAnalyticsTag(RECORD);
  assert.match(out, /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-RKRGY9QCSH"><\/script>/);
});

test('a document with no </head> is returned byte for byte unchanged', () => {
  const fragment = '<main><p>A document with no head at all.</p></main>';
  assert.equal(withAnalyticsTag(fragment), fragment);
});

test('calling it twice leaves exactly one tag', () => {
  const once = withAnalyticsTag(RECORD);
  const twice = withAnalyticsTag(once);
  assert.equal(twice, once);
  assert.equal(twice.split(GA_LOADER_SRC).length - 1, 1);
});

test('the tag does not disturb the ad code already in the document', () => {
  const withAd = RECORD.replace(
    '</head>',
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7838607083592256"></script></head>'
  ).replace('</main>', '<ins class="adsbygoogle" data-ad-slot="5756976639"></ins></main>');
  const out = withAnalyticsTag(withAd);
  assert.equal(out.split('5756976639').length - 1, 1);
  assert.equal(out.split('ca-pub-7838607083592256').length - 1, 1);
  assert.equal(out.split(GA_LOADER_SRC).length - 1, 1);
  assert.ok(out.indexOf('ca-pub-7838607083592256') < out.indexOf('</head>'));
});
