/**
 * THE TWO PLACEMENTS, AND THE ORDER BETWEEN THEM — as a test, because the anchors are structural.
 *
 * WHY THIS EXISTS
 *
 * Three things moved in the same round and each one is a claim about a served document rather than about the
 * code that produces it:
 *
 *   1. the discussion box now goes **immediately after `Cite this article`** instead of at the closing
 *      `</main>` (the owner: *"not be at the footer where it is now"*);
 *   2. the AdSense unit now goes **inside the reading column, after the third paragraph**, instead of at the
 *      closing `</main>` (the owner: *"make sure the google adsense is placed well in the articles"*);
 *   3. the ad must still be **above** the comment thread — which used to be guaranteed by the order in which
 *      two splice calls ran, and is now guaranteed by the anchors themselves.
 *
 * **A `lastIndexOf` anchor cannot express (1) or (2)**, so both are computed by walking the document with a
 * tag stack. That walking is the thing most likely to be got subtly wrong — an eyebrow paragraph inside
 * `#sources` is not a paragraph of the reading matter, a `<p>` the document never closes has no insertion
 * point at all, a `<` in text is not a tag — and every one of those cases is asserted below rather than
 * hoped for.
 *
 * ⚠️ **WHAT THE END-TO-END PROOF IS AND IS NOT.** This file proves the anchors and the splices on documents
 * built here. It cannot prove them on a *served* page, because that needs the record route, a session and
 * PGlite; **the served byte offsets are in this round's report instead**, taken from
 * `/egwu-amala-the-paddle-dance-of-nigerias-river-communities/` on the review server.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  elementEndAnchorById,
  findOpenTagByClass,
  findOpenTagById,
  insertAfterElementId,
  scanElement,
} from './html-anchor.ts';
import { ADSENSE_IN_CONTENT_PARAGRAPH, warnIfAdBelowDiscussion, withAdsenseUnit } from './adsense.ts';

/** The discussion box's own markup, as `packages/ozikoro/src/comments.ts` renders it. */
const DISCUSSION =
  '<section class="oz-discussion" id="discussion" aria-labelledby="oz-discussion-title">' +
  '<div class="wrap"><div class="oz-discussion-inner"><h2 id="oz-discussion-title">Join the discussion</h2>' +
  '</div></div></section>';

/**
 * A record page with the shapes the real one has, and with the four traps in it:
 *
 *   · two `<p class="eyebrow">` elements, one inside `#sources` and one inside `#citation` — **nested, so
 *     neither is a paragraph of the reading matter**;
 *   · a `<figure><figcaption>` and a `<div>` wrapping a `<video><source>`, so the direct-child walk has to
 *     descend through elements that contain paragraphs-shaped things;
 *   · a `<ul><li>` list, which is where an implied end tag would show up as a miscount;
 *   · the related cards and the page-turn nav AFTER `.prose` closes, which is the 1,836 bytes of other
 *     things the box used to sit behind.
 */
const RECORD = [
  '<!doctype html><html lang="en"><head><title>Egwu Amala — Ozikoro</title></head><body class="sx-reading-body">',
  '<main id="article"><article class="sx-book-reader">',
  '<div class="sx-reading-columns"><aside><details><summary>In this history</summary></details></aside>',
  '<div class="sx-page">',
  '<div class="prose">',
  '<p id="opening" class="dropcap">One. This is the opening paragraph of the history.</p>',
  '<h2 id="record">The written record</h2>',
  '<figure><img src="/media/ozikoro/a.jpg" alt="A photograph"><figcaption>A caption</figcaption></figure>',
  '<p>Two. This is the second paragraph of the history.</p>',
  '<div><video controls preload="metadata"><source src="/media/ozikoro/a.mp4"></video></div>',
  '<p>Three. This is the third paragraph of the history.</p>',
  '<p>Four. This is the fourth paragraph of the history.</p>',
  '<ul><li>a listed item</li><li>another listed item</li></ul>',
  '<section class="provenance" id="sources"><p class="eyebrow">Sources and references</p><ol><li>a source</li></ol></section>',
  '<section id="citation"><p class="eyebrow">Cite this article</p><div class="cite-block">Nzeribe, K. “…” Ozikoro.</div></section>',
  '</div></div></div>',
  '<section class="sx-related" id="related"><div class="sx-related-list">cards</div></section>',
  '<nav class="sx-page-turn"><a href="/archive/">← All histories</a><span>End of article</span></nav>',
  '</article></main>',
  '</body></html>',
].join('');

const at = (haystack: string, needle: string) => {
  const index = haystack.indexOf(needle);
  assert.notEqual(index, -1, `fixture is missing ${needle}`);
  return index;
};

/** The offset just after `needle` in `haystack` — written out so the assertions read as offsets. */
const after = (haystack: string, needle: string) => at(haystack, needle) + needle.length;

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 1 · THE SCANNER: the paragraph of the reading matter, and the things that are not one.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

test('the reading matter has four paragraphs, and the two eyebrow paragraphs are not among them', () => {
  const prose = findOpenTagByClass(RECORD, 'prose');
  assert.notEqual(prose, null);
  const { children, closeEnd } = scanElement(RECORD, prose!);

  const paragraphs = children.filter((child) => child.name === 'p');
  assert.equal(paragraphs.length, 4, 'the four body paragraphs, and neither `p.eyebrow`');

  /* `</p>` occurs six times in the document — four in the prose, two inside the sections. */
  assert.equal((RECORD.match(/<\/p>/g) ?? []).length, 6);

  /* And the prose really does contain the sections, so excluding their paragraphs is the point. */
  assert.ok(RECORD.indexOf('id="sources"') < closeEnd!);
  assert.ok(RECORD.indexOf('id="citation"') < closeEnd!);
});

test('a `<p>` the document never closes has no insertion point, rather than the end of the file', () => {
  const broken = '<div class="prose"><p>one</p><p>two</p><p>three';
  const prose = findOpenTagByClass(broken, 'prose')!;
  const { children } = scanElement(broken, prose);
  const paragraphs = children.filter((child) => child.name === 'p' && child.closed);
  assert.equal(paragraphs.length, 2, 'the unterminated third paragraph is refused');
  assert.ok(children.some((child) => child.name === 'p' && !child.closed));
});

test('an implied end tag is two paragraphs, not one nested in the other', () => {
  const implied = '<div class="prose"><p>one<p>two<p>three<p>four</div>';
  const prose = findOpenTagByClass(implied, 'prose')!;
  const { children } = scanElement(implied, prose);
  assert.equal(children.filter((child) => child.name === 'p').length, 4);
});

test('a tag-shaped string inside a comment is not an element', () => {
  const commented = '<div class="prose"><!-- <p>not a paragraph</p> --><p>one</p><p>two</p></div>';
  const prose = findOpenTagByClass(commented, 'prose')!;
  const { children } = scanElement(commented, prose);
  assert.equal(children.filter((child) => child.name === 'p').length, 2);
});

test('a `<script>` body is skipped whole', () => {
  const scripted = '<div class="prose"><p>one</p><script>var s = "</p><p>fake</p>";</script><p>two</p></div>';
  const prose = findOpenTagByClass(scripted, 'prose')!;
  const { children } = scanElement(scripted, prose);
  assert.equal(children.filter((child) => child.name === 'p').length, 2);
  assert.equal(children.filter((child) => child.name === 'script').length, 1);
});

test('a class that is not there, and an id that is not there, are both `null`', () => {
  assert.equal(findOpenTagByClass(RECORD, 'prose-that-is-not-there'), null);
  assert.equal(findOpenTagById(RECORD, 'citation-that-is-not-there'), null);
  assert.equal(scanElement(RECORD, 4).closeEnd, null, 'an offset that is not a tag is not an element');
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 2 · THE TWO ANCHORS ON A RECORD PAGE.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

test('the discussion anchor is the byte just after the citation’s own `</section>`', () => {
  const anchor = elementEndAnchorById(RECORD, 'citation');
  assert.equal(anchor, after(RECORD, '<div class="cite-block">Nzeribe, K. “…” Ozikoro.</div></section>'));

  const discussion = insertAfterElementId(RECORD, 'citation', DISCUSSION);
  assert.notEqual(discussion, null);

  /* The whole box begins at the anchor, and the thread is what the page then calls `id="discussion"`. */
  const thread = discussion!.indexOf(DISCUSSION);
  assert.equal(thread, anchor);
  assert.equal(discussion!.indexOf('id="discussion"'), anchor + DISCUSSION.indexOf('id="discussion"'));

  /* Immediately after the citation AND before the related cards and the page-turn — the owner's request. */
  assert.ok(thread > discussion!.indexOf('Cite this article'));
  assert.ok(thread < discussion!.indexOf('<section class="sx-related"'));
  assert.ok(thread < discussion!.indexOf('<nav class="sx-page-turn"'));

  /* And inside the reading column, which is what "part of the article width" is about. */
  const proseOpen = findOpenTagByClass(discussion!, 'prose')!;
  assert.ok(thread < scanElement(discussion!, proseOpen).closeEnd!);
  assert.ok(thread > proseOpen);
});

test('a document with no citation has no discussion anchor, and says so with `null`', () => {
  const designScreen = '<main><section>a screen with no citation</section></main>';
  assert.equal(elementEndAnchorById(designScreen, 'citation'), null);
  assert.equal(insertAfterElementId(designScreen, 'citation', DISCUSSION), null);
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 3 · THE AD'S THREE ANCHORS.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

test(`the unit goes after paragraph ${ADSENSE_IN_CONTENT_PARAGRAPH}, and there is exactly one of it`, () => {
  const placed = withAdsenseUnit(RECORD);
  const unit = placed.indexOf('<!-- Resp -->');

  assert.equal(ADSENSE_IN_CONTENT_PARAGRAPH, 3, 'the placement this test is written against');
  /* The anchor itself does not move, so this offset is the same in both documents. */
  assert.equal(unit, after(RECORD, '<p>Three. This is the third paragraph of the history.</p>'));
  assert.ok(unit > placed.indexOf('<p>Two. This is the second paragraph of the history.</p>'));
  assert.ok(unit < placed.indexOf('<p>Four. This is the fourth paragraph of the history.</p>'));

  /* ONE unit — the fault a `replaceAll('</p>', …)` would produce is sixteen of them. */
  assert.equal((placed.match(/<!-- Resp -->/g) ?? []).length, 1);
  assert.equal((placed.match(/class="adsbygoogle"/g) ?? []).length, 1);

  /* And it is inside the reading column, not beside it. */
  const proseOpen = findOpenTagByClass(placed, 'prose')!;
  assert.ok(unit < scanElement(placed, proseOpen).closeEnd!, 'the unit is inside `.prose`');
  assert.ok(unit > proseOpen);
});

test('a document with no `.prose` puts the unit immediately above an existing discussion', () => {
  const screen = '<main><h1>A listing</h1><p>Some words.</p>' + DISCUSSION + '</main>';
  const placed = withAdsenseUnit(screen);
  assert.ok(placed.indexOf('<!-- Resp -->') < placed.indexOf('id="discussion"'), 'the unit is above the thread');
  assert.equal(placed.indexOf('<!-- Resp -->') + '<!-- Resp -->'.length + 1, placed.indexOf('<ins'));
  /* Directly above — nothing between the unit and the box. */
  assert.equal(placed.indexOf('<section class="oz-discussion"'), placed.indexOf('</script>') + '</script>'.length + 1);
});

test('a document with neither a `.prose` nor a discussion keeps the historical `</main>` anchor', () => {
  const screen = '<main><h1>A listing</h1><p>Some words.</p></main><footer>notice</footer>';
  const placed = withAdsenseUnit(screen);
  assert.equal(placed.indexOf('<!-- Resp -->'), at(screen, '</main>'));
  assert.ok(placed.indexOf('<!-- Resp -->') < placed.indexOf('<footer>'));
});

test('a document with none of the three anchors is returned byte for byte unchanged', () => {
  const nothing = '<html><body><p>no main, no prose</p></body></html>';
  assert.equal(withAdsenseUnit(nothing), nothing);
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 4 · THE ORDER, WHICH IS THE THING THE OLD CODE GOT FROM CALL ORDER.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

test('the unit is above the thread, and both call orders produce the same document', () => {
  const unitThenBox = insertAfterElementId(withAdsenseUnit(RECORD), 'citation', DISCUSSION);
  const boxThenUnit = withAdsenseUnit(insertAfterElementId(RECORD, 'citation', DISCUSSION)!);

  assert.notEqual(unitThenBox, null);
  assert.equal(
    unitThenBox,
    boxThenUnit,
    'the ad and the discussion no longer contend for one anchor, so the order they are spliced in cannot matter'
  );

  const placed = unitThenBox!;
  const unit = placed.indexOf('<!-- Resp -->');
  const thread = placed.indexOf('id="discussion"');
  assert.ok(unit < thread, 'reading matter, then the ad, then the thread');
  assert.ok(placed.indexOf('id="citation"') < thread, 'and the thread is after `Cite this article`');

  /* The old order — `withAdsense` first — is what the routes still do. */
  assert.ok(thread > at(placed, '<p>Four.'));
});

test('the design screens keep the order through the fallback, in the order the route calls it', () => {
  /* No `.prose` and no citation: the unit falls to `</main>` first, then the box follows it there. */
  const screen = '<main><h1>Watch</h1><p>Some words.</p></main>';
  const adFirst = withAdsenseUnit(screen);
  const boxSecond = adFirst.replace('</main>', DISCUSSION + '</main>');
  assert.ok(boxSecond.indexOf('<!-- Resp -->') < boxSecond.indexOf('id="discussion"'));

  /* And in the other order, the unit anchors on the box's own marker and lands above it anyway. */
  const boxFirst = screen.replace('</main>', DISCUSSION + '</main>');
  const adSecond = withAdsenseUnit(boxFirst);
  assert.ok(adSecond.indexOf('<!-- Resp -->') < adSecond.indexOf('id="discussion"'));

  /* Not merely the same order — the same bytes, which is the stronger claim. */
  assert.equal(boxSecond, adSecond);
});

test('the served-order guard says `true` for the shipped order and `false` for its reversal', () => {
  const placed = insertAfterElementId(withAdsenseUnit(RECORD), 'citation', DISCUSSION)!;
  assert.equal(warnIfAdBelowDiscussion(placed, 'test'), true);

  /*
   * The reversed document is the fault the guard exists to catch, and the guard says so on the console. The
   * message is the assertion, so it is captured here rather than printed into the suite's own output.
   */
  const logged: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(' ')); };
  try {
    assert.equal(warnIfAdBelowDiscussion(DISCUSSION + withAdsenseUnit(RECORD), 'reversed'), false);
  } finally {
    console.error = real;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0] ?? '', /the unit landed BELOW the discussion thread/);

  assert.equal(warnIfAdBelowDiscussion('<main><p>a page with neither</p></main>', 'neither'), true);
});
