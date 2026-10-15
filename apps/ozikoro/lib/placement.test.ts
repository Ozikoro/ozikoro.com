/**
 * THE TWO PLACEMENTS, THE ORDER BETWEEN THEM, AND THE LADDER — as a test, because the anchors are structural.
 *
 * WHY THIS EXISTS
 *
 * Three things moved in an earlier round and each one is a claim about a served document rather than about the
 * code that produces it:
 *
 *   1. the discussion box now goes **immediately after `Cite this article`** instead of at the closing
 *      `</main>` (the owner: *"not be at the footer where it is now"*);
 *   2. the AdSense unit now goes **inside the reading column, after a paragraph**, instead of at the closing
 *      `</main>` (the owner: *"make sure the google adsense is placed well in the articles"*);
 *   3. the ad must still be **above** the comment thread.
 *
 * **A `lastIndexOf` anchor cannot express (1) or (2)**, so both are computed by walking the document with a
 * tag stack. That walking is the thing most likely to be got subtly wrong — an eyebrow paragraph inside
 * `#sources` is not a paragraph of the reading matter, a `<p>` the document never closes has no insertion
 * point at all, a `<` in text is not a tag — and every one of those cases is asserted below rather than hoped
 * for.
 *
 * ── 🔴 AND THIS ROUND ADDED THE LADDER, WHICH IS THE SECOND THING THE OWNER ASKED FOR ────────────────
 *
 * *"i meant not just three, and could be more if the content is long, but not to be showing everywhere else on
 * the website like i am seeing now."* So the placement is now a **set** of anchors rather than one, and the
 * test has to hold four properties the old single-unit test had no way to state:
 *
 *   · **THE UNITS KEEP DOCUMENT ORDER.** A record that reaches the second and third rungs gets units after
 *     paragraph 3, 18 and 40 — in that order, never sorted by insertion, never reversed. (The splice runs last
 *     anchor first, so the ordering is a property of the assembly and not of the loop.)
 *   · **THEY ARE NEVER WITHIN ONE SCREENFUL.** The rungs are 15 and 22 paragraphs apart, and this fixture's own
 *     paragraph lengths are asserted so that the claim is about the document rather than about the numbers.
 *   · **THE CAP IS THE CAP.** A record with a paragraph for every rung plus ten more gets exactly three units.
 *   · **NOTHING IS PADDED.** A record with fewer paragraphs than the first rung gets **no** unit — and, unlike
 *     the old behaviour, **no unit at the foot of the page either**: the `</main>` fallback is gone, and the
 *     test that used to assert it now asserts its absence.
 *
 * ⚠️ **WHAT THE END-TO-END PROOF IS AND IS NOT.** This file proves the anchors and the splices on documents
 * built here. It cannot prove them on a *served* page, because that needs the record route, a session and
 * PGlite; **the served byte offsets and the unit counts per page kind are in this round's report instead.**
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
import {
  ADSENSE_IN_CONTENT_PARAGRAPH,
  ADSENSE_IN_CONTENT_PARAGRAPHS,
  ADSENSE_MAX_UNITS,
  ADSENSE_SLOT,
  inContentAnchors,
  warnIfAdBelowDiscussion,
  withAdsense,
  withAdsenseUnits,
  withOneAdsenseUnit,
} from './adsense.ts';

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

/**
 * A record long enough for every rung of the ladder, built from the same document so that the sections, the
 * cards and the page-turn sit exactly where they do on a real one. Paragraph 1 is the opening and paragraphs
 * 2..N are numbered bodies, which is what makes an assertion about "paragraph 18" readable.
 */
const LONG_RECORD = (n: number) =>
  RECORD.replace(
    '<ul><li>a listed item</li><li>another listed item</li></ul>',
    Array.from({ length: n - 4 }, (_, i) => `<p>Body paragraph ${i + 5} of the history.</p>`).join('') +
      '<ul><li>a listed item</li><li>another listed item</li></ul>'
  );

const at = (haystack: string, needle: string) => {
  const index = haystack.indexOf(needle);
  assert.notEqual(index, -1, `fixture is missing ${needle}`);
  return index;
};

/** The offset just after `needle` in `haystack` — written out so the assertions read as offsets. */
const after = (haystack: string, needle: string) => at(haystack, needle) + needle.length;

/** How many units a served document carries. One marker per unit, asserted against `class="adsbygoogle"`. */
const units = (html: string) => (html.match(/<!-- Resp -->/g) ?? []).length;

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
 * 3 · THE LADDER: THE FIRST RUNG, WHICH IS THE PLACEMENT THAT SHIPPED.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

test(`the unit goes after paragraph ${ADSENSE_IN_CONTENT_PARAGRAPH}, and there is exactly one of it`, () => {
  const placed = withOneAdsenseUnit(RECORD);
  const unit = placed.indexOf('<!-- Resp -->');

  assert.equal(ADSENSE_IN_CONTENT_PARAGRAPH, 3, 'the placement this test is written against');
  /* The anchor itself does not move, so this offset is the same in both documents. */
  assert.equal(unit, after(RECORD, '<p>Three. This is the third paragraph of the history.</p>'));
  assert.ok(unit > placed.indexOf('<p>Two. This is the second paragraph of the history.</p>'));
  assert.ok(unit < placed.indexOf('<p>Four. This is the fourth paragraph of the history.</p>'));

  /* ONE unit — the fault a `replaceAll('</p>', …)` would produce is sixteen of them. */
  assert.equal(units(placed), 1);
  assert.equal((placed.match(/class="adsbygoogle"/g) ?? []).length, 1);

  /* And it is inside the reading column, not beside it. */
  const proseOpen = findOpenTagByClass(placed, 'prose')!;
  assert.ok(unit < scanElement(placed, proseOpen).closeEnd!, 'the unit is inside `.prose`');
  assert.ok(unit > proseOpen);
});

/**
 * ⚠️ **THE CONSTANT AND THE LADDER ARE THE SAME NUMBER, WHICH IS WHY IT IS SAFE TO KEEP BOTH.**
 *
 * `ADSENSE_IN_CONTENT_PARAGRAPH` is the ladder's first rung under its old name, kept so the placement that
 * shipped can be found by name. **If a later change reorders the ladder, these two disagree and this test
 * fails** — which is the whole reason a derived constant is allowed to exist here.
 */
test('the named first-rung constant is the ladder’s own first rung', () => {
  assert.equal(ADSENSE_IN_CONTENT_PARAGRAPH, ADSENSE_IN_CONTENT_PARAGRAPHS[0]);
  assert.equal(ADSENSE_IN_CONTENT_PARAGRAPHS.length, ADSENSE_MAX_UNITS);
});

test('the rungs are strict ascending order, each one a paragraph that exists', () => {
  for (let i = 1; i < ADSENSE_IN_CONTENT_PARAGRAPHS.length; i += 1) {
    assert.ok(
      ADSENSE_IN_CONTENT_PARAGRAPHS[i]! > ADSENSE_IN_CONTENT_PARAGRAPHS[i - 1]!,
      'a rung must be later in the document than the one before it, or the units come out reversed'
    );
  }
  /* The spacing is the screenful rule: no two units closer than the narrowest gap in the ladder. */
  const gaps = ADSENSE_IN_CONTENT_PARAGRAPHS.slice(1).map((r, i) => r - ADSENSE_IN_CONTENT_PARAGRAPHS[i]!);
  assert.equal(Math.min(...gaps), 15, 'the narrowest gap between two units, in paragraphs');
});

test('a document with no `.prose` is returned byte for byte unchanged — there is no `</main>` fallback', () => {
  /*
   * 🔴 THIS IS THE ASSERTION THAT REPLACED THE OLD ONE. It used to read *"a document with neither a `.prose`
   * nor a discussion keeps the historical `</main>` anchor"* — and that anchor is exactly what put a unit at
   * the foot of every listing, town page and byline on the site, which is the fault the owner reported.
   */
  const listing = '<main><h1>A listing</h1><p>Some words.</p></main><footer>notice</footer>';
  assert.equal(inContentAnchors(listing).length, 0);
  assert.equal(withAdsenseUnits(listing), listing);
  assert.equal(withOneAdsenseUnit(listing), listing);
  assert.equal(listing.includes('adsbygoogle'), false);
});

test('a document with none of the anchors is returned byte for byte unchanged', () => {
  const nothing = '<html><body><p>no main, no prose</p></body></html>';
  assert.equal(withAdsenseUnits(nothing), nothing);
});

test('a record too short for the first rung gets no unit rather than a padded one', () => {
  /* The measured shape of the archive's shortest records: one photograph and its caption. */
  const shortest = '<main><div class="prose"><p>A photograph, and what is known about it.</p></div></main>';
  assert.equal(inContentAnchors(shortest).length, 0);
  assert.equal(withAdsenseUnits(shortest), shortest);
  assert.equal(units(withAdsenseUnits(shortest)), 0);
});

test('a stray inline tag does not put a unit in the middle of the author’s own markup', () => {
  /*
   * ⚠️ **MEASURED ON A REAL RECORD, WHICH IS WHY THIS TEST EXISTS.** One of the 1,042 published records —
   * `/igu-aro-the-sacred-proclamation-of-the-igbo-lunar-year-from-nri/` — carries the malformed text
   * `<p><em></p>` then `<p></em>` in its body, with a newline between them. **The `<em>` it opens is never
   * closed inside that paragraph, so the scanner's IMPLIED-CLOSE rule closes the `<p>` on the NEXT `<p>`
   * rather than on the `</p>`:** the span's `end` is one byte PAST the paragraph's own `</p>` and its only
   * `</p>` lies one byte short of the end. **An anchor found with a search that stops at `end - 1` therefore
   * cannot see it at all** — it falls back to the PREVIOUS paragraph's `</p>`, which the guard refuses, and the
   * record silently loses a unit the ladder says it earned. Measured on the review server: 0 units where the
   * ladder says 1.
   *
   * The anchor is the last `</p>` inside the span, found with the search bounded by the span's `end`.
   *
   * The anchor is the paragraph's own `</p>` instead, so the unit follows it and the stray pair is left as the
   * author wrote it.
   */
  const stray =
    '<div class="prose"><p>one. the opening paragraph.</p><p>two. the second paragraph.</p>' +
    '<p><em></p>\n<p></em><p>five. the paragraph after the malformed pair.</p></div>';

  /* What the un-clamped anchor would have been, computed here so the fault is stated rather than described. */
  const naive = scanElement(stray, findOpenTagByClass(stray, 'prose')!)
    .children.filter((c) => c.name === 'p' && c.closed)[2]!.end;
  assert.equal(stray.slice(naive - 5, naive), '</p>\n', 'the span runs one byte past its own `</p>`');

  const anchors = inContentAnchors(stray);
  assert.equal(anchors.length, 1, 'three paragraphs, so the first rung is reached');
  assert.equal(
    anchors[0],
    at(stray, '<p><em></p>') + '<p><em>'.length + '</p>'.length,
    'the anchor is just after the paragraph’s own `</p>`, not after the stray `</em>`'
  );
  assert.ok(anchors[0]! < naive, 'and it is strictly before the span the scanner reported');

  const placed = withOneAdsenseUnit(stray);
  const unit = placed.indexOf('<!-- Resp -->');
  assert.equal(unit, anchors[0]);
  assert.ok(unit < naive, 'the anchor is at the span’s own `</p>`, not at the span’s end');
  assert.equal(placed.slice(unit - 4, unit), '</p>', 'the unit follows the author’s own `</p>`');
  assert.ok(unit < placed.indexOf('<p></em>'), 'the unit is ahead of the stray `</em>` pair, not inside it');
  /*
   * The author's own bytes are untouched. Cutting the unit back out of the served document returns the fixture
   * exactly, once the splice's own newline is normalised — which is the strongest available statement that the
   * unit was inserted between the author's elements rather than inside one of them.
   */
  const unitText = placed.slice(unit, placed.indexOf('</script>', unit) + '</script>'.length);
  const restored = (placed.slice(0, unit) + placed.slice(unit + unitText.length)).replace(/\n{2,}/g, '\n');
  assert.equal(restored, stray);
  assert.equal(placed.slice(unit - 4, unit), '</p>', 'the unit follows the author’s own `</p>`');
  assert.ok(unit < placed.indexOf('<p></em>'), 'the unit is ahead of the stray `</em>` pair, not inside it');
});

test('a paragraph with no `</p>` of its own is skipped rather than borrowed', () => {
  /* The third paragraph is unterminated, so the scanner records it with `end` at the end of the file. */
  const broken = '<div class="prose"><p>one</p><p>two</p><p>three';
  assert.deepEqual(inContentAnchors(broken), []);
  assert.equal(withAdsenseUnits(broken), broken);
});

test('a record that earns no unit does not carry the loader either', () => {
  /*
   * ⚠️ **THIS WAS A REAL FAULT AND THE MEASUREMENT IS THE REASON IT IS A TEST.** `withAdsense` used to splice
   * the loader into `<head>` before asking whether the record earned a unit, so the 82 measured short records —
   * one paragraph and a caption — served `pagead2.googlesyndication.com` in the head with nothing for it to
   * fill. Measured on `/oputa-ii-the-obi-of-aboh/` (1 paragraph, 82 words): loader 1, units 0.
   *
   * A record WITH a unit still gets exactly one loader, and one unit means one loader however many units there
   * are — a second would be a second copy of the script.
   */
  const shortest = '<head><title>t</title></head><body><div class="prose"><p>one line</p></div></body>';
  assert.equal(withAdsense(shortest), shortest);
  assert.equal(shortest.includes('pagead2.googlesyndication.com'), false);

  const oneUnit = withAdsense(RECORD);
  assert.equal((oneUnit.match(/pagead2\.googlesyndication\.com/g) ?? []).length, 1, 'one loader, not one per unit');
  assert.equal((oneUnit.match(new RegExp(`data-ad-slot="${ADSENSE_SLOT}"`, 'g')) ?? []).length, 1);

  const threeUnits = withAdsense(LONG_RECORD(60));
  assert.equal((threeUnits.match(/pagead2\.googlesyndication\.com/g) ?? []).length, 1);
  assert.equal((threeUnits.match(new RegExp(`data-ad-slot="${ADSENSE_SLOT}"`, 'g')) ?? []).length, 3);

  /* And a document with no `</head>` is returned unchanged rather than broken. */
  const headless = '<div class="prose"><p>one</p><p>two</p><p>three</p></div>';
  assert.equal(withAdsense(headless), withAdsenseUnits(headless));
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 4 · THE LADDER: MORE UNITS AS THE READING MATTER GETS LONGER.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

test('a record long enough for every rung gets three units, in document order', () => {
  const long = LONG_RECORD(60);
  const anchors = inContentAnchors(long);
  assert.deepEqual(anchors, [
    after(long, '<p>Three. This is the third paragraph of the history.</p>'),
    after(long, '<p>Body paragraph 18 of the history.</p>'),
    after(long, '<p>Body paragraph 40 of the history.</p>'),
  ]);

  const placed = withAdsenseUnits(long);
  assert.equal(units(placed), 3);
  assert.equal((placed.match(/class="adsbygoogle"/g) ?? []).length, 3);

  /*
   * ⚠️ **DOCUMENT ORDER, WHICH IS THE PROPERTY THE REVERSE SPLICE EXISTS FOR.** The three markers must appear
   * in the same order as the paragraphs they follow. A loop that spliced first-to-last would push the second
   * unit's offset out by the length of the first unit and the markers would come out in the wrong places.
   */
  const markers = [...placed.matchAll(/<!-- Resp -->/g)].map((m) => m.index!);
  assert.equal(markers.length, 3);
  assert.ok(markers[0]! < markers[1]! && markers[1]! < markers[2]!);

  assert.ok(markers[0]! > placed.indexOf('<p>Three. This is the third paragraph of the history.</p>'));
  assert.ok(markers[0]! < placed.indexOf('<p>Body paragraph 5 of the history.</p>'));
  assert.ok(markers[1]! > placed.indexOf('<p>Body paragraph 18 of the history.</p>'));
  assert.ok(markers[1]! < placed.indexOf('<p>Body paragraph 19 of the history.</p>'));
  assert.ok(markers[2]! > placed.indexOf('<p>Body paragraph 40 of the history.</p>'));
  assert.ok(markers[2]! < placed.indexOf('<p>Body paragraph 41 of the history.</p>'));

  /* Every one of them is inside the reading column, not beside it and not after the cards. */
  const proseOpen = findOpenTagByClass(placed, 'prose')!;
  const proseClose = scanElement(placed, proseOpen).closeEnd!;
  for (const marker of markers) {
    assert.ok(marker > proseOpen, 'a unit is inside `.prose`');
    assert.ok(marker < proseClose, 'a unit is inside `.prose`');
  }
  assert.ok(markers[2]! < placed.indexOf('<section class="sx-related"'), 'no unit after the related cards');
});

test('the units are never within one screenful, measured in the fixture’s own paragraphs', () => {
  const long = LONG_RECORD(60);
  const anchors = inContentAnchors(long);
  assert.equal(anchors.length, 3);

  /*
   * ⚠️ **THE GAP IS MEASURED ON THE ANCHORS OF THE ORIGINAL DOCUMENT, NOT ON THE SERVED ONE, AND THAT IS THE
   * POINT.** A marker inserted into the document is a comment the scanner skips, so it cannot move an anchor —
   * but it DOES lengthen the bytes between two anchors, which would make a byte-gap assertion pass for a
   * reason that has nothing to do with the record. Measuring both anchors in the same string is what makes the
   * assertion about the reading matter.
   */
  const proseOpen = findOpenTagByClass(long, 'prose')!;
  const paragraphs = scanElement(long, proseOpen).children.filter((c) => c.name === 'p' && c.closed);

  /* Which paragraph each anchor follows, counted in the record itself. */
  const follows = anchors.map((a) => paragraphs.findIndex((p) => p.end === a) + 1);
  assert.deepEqual(follows, ADSENSE_IN_CONTENT_PARAGRAPHS, 'the anchors are the ladder’s own rungs');

  /* Every paragraph between two anchors carries words, so a paragraph gap is a height and not a count. */
  const [first, second, third] = anchors;
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  const between = paragraphs
    .slice(follows[0], follows[1]! - 1)
    .concat(paragraphs.slice(follows[1], follows[2]! - 1));
  const empty = between.filter((p) => long.slice(p.start, p.end).replace(/<[^>]+>/g, '').trim() === '');
  assert.equal(empty.length, 0, 'every paragraph between two units carries words');

  /*
   * The narrower of the two gaps is fifteen paragraph elements and their own words. The design's own type
   * scale — `.prose` at `--t-read: 1.125rem` / `--lh-body: 1.72`, plus `--s-5: 1.5rem` between children
   * (`apps/ozikoro/public/design/tokens.css`) — makes that far more than one screen.
   */
  assert.ok(second! - first! > 0 && third! - second! > 0);
  assert.equal(
    Math.min(follows[1]! - follows[0]!, follows[2]! - follows[1]!),
    15,
    'the narrowest gap between two units, in paragraphs'
  );
});

test('the cap holds: a very long record still gets exactly the ladder’s own number of units', () => {
  const veryLong = LONG_RECORD(200);
  const placed = withAdsenseUnits(veryLong);
  assert.equal(units(placed), ADSENSE_MAX_UNITS);
  assert.equal(ADSENSE_IN_CONTENT_PARAGRAPHS.length, ADSENSE_MAX_UNITS);

  /* And the anchors themselves stop at the cap rather than at the paragraph count. */
  const anchors = inContentAnchors(veryLong);
  assert.equal(anchors.length, ADSENSE_MAX_UNITS);
  assert.ok(anchors[anchors.length - 1]! < after(veryLong, '<p>Body paragraph 41 of the history.</p>'));
});

test('a record that reaches only the second rung gets two units', () => {
  const middle = LONG_RECORD(20);
  const placed = withAdsenseUnits(middle);
  assert.equal(units(placed), 2);
  assert.equal(inContentAnchors(middle).length, 2);
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * 5 · THE ORDER, WHICH IS THE THING THE OLD CODE GOT FROM CALL ORDER.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

test('the units are above the thread, and both call orders produce the same document', () => {
  const unitThenBox = insertAfterElementId(withAdsenseUnits(RECORD), 'citation', DISCUSSION);
  const boxThenUnit = withAdsenseUnits(insertAfterElementId(RECORD, 'citation', DISCUSSION)!);

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

  /* The old order — `withAdsense` first — is what the route still does. */
  assert.ok(thread > at(placed, '<p>Four.'));
});

test('the order holds for every unit on a long record, in both call orders', () => {
  const long = LONG_RECORD(60);
  const unitThenBox = insertAfterElementId(withAdsenseUnits(long), 'citation', DISCUSSION)!;
  const boxThenUnit = withAdsenseUnits(insertAfterElementId(long, 'citation', DISCUSSION)!);
  assert.equal(unitThenBox, boxThenUnit, 'three units and a discussion box still commute');

  const thread = unitThenBox.indexOf('id="discussion"');
  const markers = [...unitThenBox.matchAll(/<!-- Resp -->/g)].map((m) => m.index!);
  assert.equal(markers.length, 3);
  for (const marker of markers) {
    assert.ok(marker < thread, 'every unit is above the thread, not merely the first');
  }
  /* And the thread is still after the citation and before the cards, with three units above it. */
  assert.ok(unitThenBox.indexOf('id="citation"') < thread);
  assert.ok(thread < unitThenBox.indexOf('<section class="sx-related"'));
});

test('the discussion box and the units never exchange order through the fallback', () => {
  /* A record with no `.prose`: the unit is refused, and the box still lands after the citation. */
  const screen = '<main><section id="citation">a citation</section></main>';
  const boxed = insertAfterElementId(screen, 'citation', DISCUSSION)!;
  assert.ok(boxed.includes('id="discussion"'));
  assert.equal(units(withAdsenseUnits(boxed)), 0, 'no unit is invented for a page with no reading matter');
  assert.equal(withAdsenseUnits(boxed), boxed);
});

test('the served-order guard says `true` for the shipped order and `false` for its reversal', () => {
  const placed = insertAfterElementId(withAdsenseUnits(RECORD), 'citation', DISCUSSION)!;
  assert.equal(warnIfAdBelowDiscussion(placed, 'test'), true);

  /*
   * The reversed document is the fault the guard exists to catch, and the guard says so on the console. The
   * message is the assertion, so it is captured here rather than printed into the suite's own output.
   */
  const logged: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(' ')); };
  try {
    assert.equal(warnIfAdBelowDiscussion(DISCUSSION + withAdsenseUnits(RECORD), 'reversed'), false);
  } finally {
    console.error = real;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0] ?? '', /a unit landed BELOW the discussion thread/);

  assert.equal(warnIfAdBelowDiscussion('<main><p>a page with neither</p></main>', 'neither'), true);
});

test('the guard reads the LAST unit, so two above and one below is a fault', () => {
  /*
   * The document order is what makes "the last unit" the right thing to ask about. This builds that fault on
   * purpose: two units in the reading matter, the thread, then the third unit moved below it.
   *
   * The unit's own text is taken FROM the served document rather than rebuilt from the module's constant, so
   * this test cannot pass because a copy of the markup happens to be up to date.
   */
  const long = LONG_RECORD(60);
  const withThread = insertAfterElementId(withAdsenseUnits(long), 'citation', DISCUSSION)!;
  const markers = [...withThread.matchAll(/<!-- Resp -->/g)];
  assert.equal(markers.length, 3);

  const start = markers[2]!.index!;
  /* The unit ends after its own `<script>` block, which is the last `</script>` before the next paragraph. */
  const end = withThread.indexOf('</script>', start) + '</script>'.length;
  assert.ok(end > start);
  const unit = withThread.slice(start, end);

  /* The removal leaves the document's own bytes around it; the unit is appended, so it is now below the box. */
  const moved = `${withThread.slice(0, start)}${withThread.slice(end)}${unit}`;
  assert.equal(moved.indexOf('id="discussion"') < moved.lastIndexOf('<!-- Resp -->'), true);

  const logged: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(' ')); };
  try {
    assert.equal(warnIfAdBelowDiscussion(moved, 'three-units'), false);
  } finally {
    console.error = real;
  }
  assert.equal(logged.length, 1);
});
