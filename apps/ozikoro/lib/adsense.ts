/*
 * adsense.ts — WHERE THE OWNER'S ADS GO, AND WHERE THEY DELIBERATELY DO NOT.
 *
 * The owner: *"i did not see where to place the google adsense ads, so please add it yourself."* So the
 * placement is a decision this file makes and defends, and the ids in it are his — they are copied from the
 * snippet his own AdSense account issued and **not one character of them is invented**:
 *
 *     client  ca-pub-7838607083592256
 *     slot    5756976639        (responsive, auto format, full width)
 *
 * ── WHY THIS IS APP-LOCAL AND NOT IN `@ozikoro/platform` ─────────────────────────────────────────────
 *
 * It sits beside `discussion.ts`, `publication-cache.ts` and the other app-local helpers, and it is imported
 * through the `@/lib/…` alias the call sites already use. An ad unit is a property of THIS site's product
 * surface and of no other application that depends on the platform package — the dictionary and the Academy
 * must never inherit an ad policy from the archive by importing a barrel.
 *
 * ── 🔴 THE ROUND THAT NARROWED THIS TO ONE PAGE KIND, AND THE OWNER'S OWN WORDS ──────────────────────
 *
 * The owner, twice, in the same report:
 *
 *     *"the ads i put on the website was never meant to be on anywhere else apart from articles and
 *      researches, which is exactly three in a page. now why is it showing everywhere on my website?"*
 *     *"i meant not just three, and could be more if the content is long, but not to be showing everywhere
 *      else on the website like i am seeing now"*
 *
 * Two jobs, and they are separate jobs:
 *
 *   1. **NARROW IT.** A unit belongs on an article or a research reading page and nowhere else.
 *   2. **SCALE IT WITH THE CONTENT.** A short record gets one; a long one may get more. *"three" was never
 *      the rule* — the rule is that a long page may carry more and a short one must not be padded.
 *
 * ── AND THIS FILE NOW HAS EXACTLY ONE CALLER, WHICH IS THE WHOLE OF JOB 1 ─────────────────────────────
 *
 * Before this round there were three document producers and three call sites, and the archive served **one
 * unit on 24 of the 25 page kinds** a reader could reach — measured on the live site, in the served HTML:
 *
 *     app/layout.tsx                       the React public routes    `/researchers/`, `/clan-towns/`,
 *                                                                     `/town/<slug>/`, `/author/<slug>/`,
 *                                                                     `/entities/`, `/projects/`, `/clans/`
 *     app/design-screen/[screen]/route.ts  53 design screens          `/`, `/archive/`, `/documents/`,
 *                                                                     `/photographs/`, `/publications/`,
 *                                                                     `/listen/`, `/watch/`, the calendars,
 *                                                                     `/about/`, `/cite/`, `/ledger/`, …
 *     app/[slug]/route.ts                  every published record     `/<slug>/` — **this is the article**
 *
 * **None of the first two is an article or a research reading page, and the allow-lists that admitted them
 * are deleted rather than narrowed** — see the block at the bottom of this file for why a deny-list would
 * have been the wrong shape. What is left is one call, in one route, for the 1,051 published records, and
 * the unit count on a record is decided by the ladder below.
 *
 * ── WHAT "RESEARCHES" TURNED OUT TO BE, MEASURED RATHER THAN GUESSED ─────────────────────────────────
 *
 * The repository does not use the word, so the candidates were opened and read:
 *
 *     /documents/                the archive's own index — "Documents, photographs and recordings". A LISTING.
 *     /documents/<slug>/         one catalogued item: the object, then what is known about it. **This is a
 *                                record page, not long-form reading matter** — measured: the two items the
 *                                index lists carry a caption and a metadata table, and their `.prose` block
 *                                holds the descriptive text.
 *     /publications/             the research repository index. A LISTING.
 *     /publications/<slug>/      one published work — the abstract, the metadata table and the citation
 *                                block. **This is the archive's research reading page**, and it carries the
 *                                discussion box already (`discussionHtml` is called on that page).
 *     /researchers/              the people directory. A LISTING.
 *     /researchers/<slug>/       a research PROFILE — an institution, interests and a publication list. A CV.
 *
 * 🔴 **AND NONE OF THE RESEARCH PAGES CARRIED A UNIT BEFORE THIS ROUND, WHICH IS THE DISTINCTION THE BRIEF
 * ASKED TO BE ESTABLISHED FIRST.** Measured on the review server, in the served HTML:
 *
 *     /documents/igbo-folk-idioms-in-caribbean-phrase/    200   units 0   loader 0
 *     /documents/introduction-to-igbo-mythology-…/        200   units 0   loader 0
 *     /publications/                                      200   units 1   loader 1   (a LISTING)
 *     /researchers/199/                                   200   units 1   loader 1   (a PROFILE)
 *     /publications/<slug>/                               404 — `ozikoro_publication` holds no row today
 *
 * **So the owner is asking for a REMOVAL, not an addition.** The research reading pages are already ad-free;
 * the ads he can see on a research address are on the *listing* and the *profile*, which are the ones that go.
 *
 * ⚠️ **THIS FILE DOES NOT ADD A UNIT TO `/documents/<slug>/` OR `/publications/<slug>/`, AND THE REASON IS
 * THE LADDER RATHER THAN AN OVERSIGHT.** Both pages are React routes with no `.prose` long enough to place a
 * unit honestly, and the owner's own rule is that a short page must not be padded. `withAdsenseUnits` is not
 * called from either route, so a unit there would have to be added by hand at a `</main>` anchor — which is
 * the exact placement he reported as wrong ("*the unit was the LAST thing in `<main>`*"). If he wants the
 * research reading pages to carry a unit, that is a placement decision on a page whose reading matter is an
 * abstract, and it is his to make; the measurement above is what he needs to make it.
 */

import { findOpenTagByClass, scanElement } from './html-anchor.ts';

/**
 * The owner's AdSense client id, exactly as his account issued it.
 *
 * ⚠️ ONE CLIENT, ONE SLOT, WRITTEN ONCE. There is no second slot in this repository and none may be added
 * without the owner issuing one: a slot id is an account fact, and an invented one is an ad request for
 * inventory that does not exist.
 */
export const ADSENSE_CLIENT = 'ca-pub-7838607083592256';

/** The owner's responsive unit in that account. See `ADSENSE_CLIENT`. */
export const ADSENSE_SLOT = '5756976639';

/**
 * THE LOADER, WHICH GOES IN `<head>` ONCE PER DOCUMENT.
 *
 * `crossorigin="anonymous"` is the snippet's own attribute and it is load-bearing rather than decorative:
 * the loader reports errors through `window.onerror`, and a cross-origin script without it would give the
 * page the opaque `"Script error."` instead of the real message.
 */
export const ADSENSE_LOADER_SRC =
  `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

/** The queue push, written into the unit below. */
export const ADSENSE_PUSH = '(adsbygoogle = window.adsbygoogle || []).push({});';

/** The loader as markup. There is one string producer left — the record route — and this is its loader. */
export const ADSENSE_LOADER =
  `<script async src="${ADSENSE_LOADER_SRC}" crossorigin="anonymous"></script>`;

/**
 * THE UNIT, WHICH IS ONE RESPONSIVE BLOCK PLACED IN THE READING MATTER.
 *
 * ── WHY THE FORMAT IS `auto` ────────────────────────────────────────────────────────────────────────
 *
 * The owner asked for responsive/auto, and an auto unit sizes itself from the width it is given — inside
 * `.prose` that is the article's own measure, so it lines up with the sentences above and below it.
 *
 * ⚠️ **A UNIT IS NEVER PLACED MID-SENTENCE AND NEVER AFTER EVERY PARAGRAPH.** The offset is computed from
 * the document's own structure by `scanElement` in `./html-anchor`, and the paragraphs are counted rather
 * than matched: `</p>` occurs 14 times in one published record, so `.replaceAll('</p>', unit)` would put a
 * unit after every paragraph in the archive and a plain `.replace` would put one after the first. Both are
 * the fault this file exists to make impossible, and both are asserted against in `placement.test.ts`.
 *
 * The `<!-- Resp -->` label is the owner's own comment from the snippet he issued, kept verbatim so the
 * served markup can be compared against his account's copy line for line.
 */
export const ADSENSE_UNIT = `<!-- Resp -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="${ADSENSE_CLIENT}"
     data-ad-slot="${ADSENSE_SLOT}"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     ${ADSENSE_PUSH}
</script>`;

/**
 * ── THE LADDER: HOW MANY UNITS A RECORD EARNS, DECIDED BY THE RECORD'S OWN LENGTH ────────────────────
 *
 * Each number is **the paragraph of the reading matter that a unit follows**, and the array is the whole
 * rule. It is read as a ladder rather than as a list of independent thresholds: a record that has the Nth
 * paragraph gets the units up to it, so the units always come out in document order and there is never a
 * gap with a unit on either side of it.
 *
 * ── THE MEASUREMENT IT CAME FROM, WHICH IS THE CORPUS'S OWN ──────────────────────────────────────────
 *
 * Every published record was fetched from the review server and its reading matter walked the way
 * `scanElement` walks it — the direct-child `<p>` of `.prose`. **1,042 of the 1,051 published records were
 * measured** (the archive listing's own links were followed to exhaustion; `npm`-style paging ends there):
 *
 *     paragraphs per record    min 1 · p10 4 · p25 9 · MEDIAN 15 · p75 23 · p90 32 · p95 38 · p99 58 · max 86
 *     words per record         min 80 · p10 320 · p25 604 · MEDIAN 965 · p75 1,185 · p90 1,406 · p99 2,249 · max 3,672
 *
 *     82 records (7.9%) have fewer than 3 paragraphs — a single photograph with its caption, measured
 *     (`/oputa-ii-the-obi-of-aboh/`, 1 paragraph, 82 words). **They get NO unit**, and that is the rule
 *     working rather than a gap in it: there is no third paragraph to sit after, and padding a one-line
 *     caption with a paid rectangle is the fault the owner named from the other direction.
 *
 * ── THE LADDER, AND WHY THESE THREE NUMBERS ──────────────────────────────────────────────────────────
 *
 *     3   after the third paragraph   — the placement that already shipped, on 92.1% of records (960)
 *     18  after the eighteenth        — the median record has 15 paragraphs, so this is *longer than most*;
 *                                       it fires on 39.3% of records (409)
 *     40  after the fortieth          — the top of the corpus: 4.4% of records (46), and the longest of
 *                                       them has 86 paragraphs
 *
 * Measured effect of the ladder on the 1,042 records:
 *
 *     3 units   46 records (4.4%)     a long record, and it is the longest ones that get it
 *     2 units  363 records (34.8%)
 *     1 unit   551 records (52.9%)
 *     0 units   82 records (7.9%)
 *     mean 1.36 units per record
 *
 * **A record of 1,127 words and 86 paragraphs gets three; a record of 782 words and 11 paragraphs gets one.**
 * That is the shape the owner asked for and it is not a shape that gives every long record six.
 *
 * ── ⚠️ THE POLICIES, AND WHAT COULD AND COULD NOT BE CITED ───────────────────────────────────────────
 *
 * **The gap is the enforceable rule and it is this file's own, not a quotation.** AdSense's *Ad placement
 * policies* state that ads must not be mistaken for content, must not be placed "under a misleading heading",
 * and must not draw "unnatural attention"; `ADSENSE_UNIT`'s own note records the first of those and it still
 * holds. ⚠️ **THERE IS NO AD-DENSITY NUMBER IN THAT POLICY AND NONE IS INVENTED HERE.** Read on 2026-10-15 at
 * <https://support.google.com/adsense/answer/1346295>: the page's fourteen sections have no per-page ad count,
 * no ad-to-content ratio, and no screenful rule. The density language this repository has used — *"penalise
 * high ad density on a page"* — is not a quotation from it, and the honest report says so.
 *
 * **So the constraints that are actually applied are stated rather than borrowed:**
 *
 *   1. **NEVER TWO UNITS WITHIN ONE SCREENFUL** (the brief's own rule). The closest rungs are 3 and 18: 15
 *      paragraphs apart, and 18 and 40: 22 apart. Measured against this site's own type scale — `.prose`
 *      is `--t-read: 1.125rem` at `--lh-body: 1.72` and `.prose > * + *` adds `--s-5: 1.5rem`, so a
 *      paragraph costs at least 24px of margin + 31px per line (`tokens.css`) — fifteen paragraphs cannot
 *      be inside 900px unless every one of them is blank, and a unit plus its own spacing is ~300px.
 *   2. **AT MOST THREE UNITS, WHATEVER THE LENGTH.** `ADSENSE_MAX_UNITS` is the cap and it is a constant
 *      rather than the length of the ladder, so a fourth rung cannot be added by accident. The corpus's
 *      own worst case is 46 records out of 1,042 carrying three.
 *   3. **A UNIT ONLY WHERE THERE IS READING MATTER.** `inContentAnchors` refuses a document with no
 *      `.prose`, and there is no `</main>` fallback any more (see the bottom of this file). A record whose
 *      reading matter is one paragraph serves no unit at all rather than a unit at the foot of the page.
 */
export const ADSENSE_IN_CONTENT_PARAGRAPHS: readonly number[] = [3, 18, 40];

/**
 * The first rung, kept by name because it is the placement that shipped and because a reader of the code
 * should be able to find "after the third paragraph" without counting array elements.
 *
 * ⚠️ **IT IS A CONSEQUENCE OF THE LADDER RATHER THAN A SECOND RULE.** If `ADSENSE_IN_CONTENT_PARAGRAPHS`
 * ever stops beginning with 3, this constant and the ladder disagree — so `placement.test.ts` asserts that
 * the two are the same number, and the assertion is the reason it is safe to keep both.
 */
export const ADSENSE_IN_CONTENT_PARAGRAPH = ADSENSE_IN_CONTENT_PARAGRAPHS[0]!;

/** The ceiling on units per page. See the ladder's note 2. */
export const ADSENSE_MAX_UNITS = 3;

/**
 * The offsets just after the Nth direct-child paragraphs of the document's first `.prose`.
 *
 * The ladder is applied in order and stops at `ADSENSE_MAX_UNITS`, so the returned array's length is the
 * record's own answer to "how many units has this earned?" — **`[]` for a document with no `.prose`, or
 * with fewer paragraphs than the first rung.** Every caller must treat `[]` as "no unit here" and never as
 * "put one at the end".
 *
 * ⚠️ **THE WALK IS ONE PASS AND IS NOT REPEATED.** The paragraphs are collected first and the anchors are
 * read out of that one list, which is what makes the multiple insertions safe: the offsets are all measured
 * against the same original string, and `withAdsenseUnits` splices them from the last to the first so an
 * earlier offset cannot be moved by a later insertion.
 */
export function inContentAnchors(html: string): number[] {
  const prose = findOpenTagByClass(html, 'prose');
  if (prose === null) return [];
  const { children, closeEnd } = scanElement(html, prose);
  /*
   * `closed` is required and not cosmetic: an element the document never closed is recorded with `end` at
   * the end of the file, so an anchor taken from one would put a unit after `</html>`. `closeEnd` is the
   * reading matter's own last byte, and it is carried through the closure below for the same reason.
   */
  const paragraphs = children.filter((child) => child.name === 'p' && child.closed);
  const readingMatterEnds = closeEnd ?? html.length;
  const anchors: number[] = [];
  for (const rung of ADSENSE_IN_CONTENT_PARAGRAPHS) {
    if (anchors.length >= ADSENSE_MAX_UNITS) break;
    /*
     * ⚠️ **`continue`, NOT `break`, AND THAT IS THE LADDER WORKING.** A rung whose paragraph cannot supply an
     * honest anchor is skipped and the NEXT rung is tried, so a record with one awkward paragraph still gets
     * its later units. `break` here would silently cap such a record at the units it had already earned.
     */
    const at = paragraphAnchor(html, paragraphs[rung - 1], anchors[anchors.length - 1] ?? prose, readingMatterEnds);
    if (at === null) continue;
    anchors.push(at);
  }
  return anchors;
}

/**
 * The offset to insert a unit at, for one paragraph of the reading matter — or `null` for a paragraph that has
 * no honest anchor, which is a missing unit rather than a wrong one.
 *
 * ⚠️ **THE ANCHOR IS THE PARAGRAPH'S OWN `</p>`, AND THE CLAMP IS THE WHOLE OF THIS FUNCTION.** A paragraph's
 * span can end on something other than its own end tag: the scanner's IMPLIED-CLOSE rule closes an element
 * when the *next* `<p>`/`<li>` opens inside it, so a body carrying a stray inline tag — measured, one record
 * of the 1,042 in the corpus, on `/igu-aro-the-sacred-proclamation-of-the-igbo-lunar-year-from-nri/`, whose
 * body holds `<p><em></p>` and then `<p></em>` — has a `<p>` that closes on that stray `</em>`. Inserting at
 * the span's `end` then splits the author's own markup pair and the unit lands between `</em>` and `</p>`.
 *
 * So the anchor is the last `</p>` **inside the paragraph's own span**, which for every ordinary paragraph in
 * the corpus is the span's `end` itself and changes nothing — asserted rather than assumed in
 * `placement.test.ts`.
 *
 * **AND A PARAGRAPH THAT CANNOT SUPPLY ONE IS SKIPPED.** An unterminated paragraph is recorded with `end` at
 * the end of the document, so its only `</p>` is somebody else's or none at all; a paragraph whose own `</p>`
 * is not later than the previous anchor is refused as well. Both return `null` and the caller tries the next
 * rung. **A record can therefore end up with fewer units than its paragraph count suggests, and that is the
 * intended direction of the failure: a reader can be missing an ad, and cannot be shown a broken page.**
 */
function paragraphAnchor(
  html: string,
  paragraph: { start: number; end: number } | undefined,
  previous: number,
  readingMatterEnds: number
): number | null {
  if (!paragraph) return null;
  /* An unterminated paragraph has no span of its own to measure, so it is refused outright. */
  if (paragraph.end > readingMatterEnds) return null;
  /*
   * ⚠️ **THE SEARCH IS BOUNDED BY THE SPAN'S OWN END, AND THE ONE-OFF `end - 1` WAS A MEASURED BUG.** The
   * paragraph's `</p>` lies INSIDE its span and can finish exactly at `end`: on the malformed record below the
   * span is `[86, 98)` and its `</p>` occupies 94–97, so a search stopping at `end - 1` (97) could not see it,
   * fell back to the PREVIOUS paragraph's `</p>` at 49, and the `close < paragraph.start` guard then refused a
   * unit the record had earned — measured on the review server as **a unit count of 0 where the ladder says
   * 1**. Searching to `end` inclusive finds the paragraph's own end tag and cannot reach past it.
   */
  const close = html.lastIndexOf('</p>', paragraph.end);
  if (close < paragraph.start) return null;
  const at = close + '</p>'.length;
  return at > previous ? at : null;
}

/**
 * Put the units in the reading matter — one per rung of the ladder the record reaches.
 *
 * Returns the document **byte for byte unchanged** when there is no `.prose` or no rung is reached, which
 * is the same contract `insertDiscussion` and `withDiscussion` hold and the reason a record that cannot
 * find its anchor is a record without an ad rather than a mangled page.
 *
 * ⚠️ **THERE IS NO FALLBACK ANCHOR, AND ITS REMOVAL IS THE SECOND JOB.** The old chain was
 * *in-content paragraph → the discussion box's own marker → the closing `</main>`*, and the last of those
 * is what put a unit at the foot of a listing, under the related cards and after the page-turn — the
 * placement the owner reported. The two callers that relied on it (the React layout and the design-screen
 * route) no longer call this at all, so the fallback has no user; keeping it would leave a paid rectangle
 * one deleted line away from every page kind this round is removing it from.
 */
export function withAdsenseUnits(html: string): string {
  const anchors = inContentAnchors(html);
  if (anchors.length === 0) return html;
  /* LAST FIRST, so each splice leaves the offsets of the ones not yet applied untouched. */
  let out = html;
  for (const at of [...anchors].reverse()) {
    out = `${out.slice(0, at)}${ADSENSE_UNIT}\n${out.slice(at)}`;
  }
  return out;
}

/**
 * Put **one** unit in the reading matter, at the ladder's first rung, and return the document **byte for byte
 * unchanged** if the record does not reach that rung or reaches further ones.
 *
 * ⚠️ **THIS IS NOT THE PLACEMENT THE SITE USES AND IT IS NOT A SECOND PLACEMENT EITHER — IT IS THE LADDER'S
 * FIRST RUNG, ALONE.** `withAdsenseUnits` above is what the record route calls; this exists so that the
 * single-unit case can be stated and asserted on its own (`placement.test.ts`), which is the case the owner's
 * first sentence described (*"a short record gets one"*). **It refuses rather than truncating**: a document long
 * enough for two units is returned untouched, because a caller that wanted one unit out of three is a caller
 * that has asked the wrong question, and quietly taking the first would hide that.
 *
 * The refusal is why this can never become a legacy fallback by accident: the old `withAdsenseUnit` fell back
 * to the closing `</main>` when there was no `.prose`, which is the placement this round removed. There is no
 * fallback here — `[]` means no unit.
 */
export function withOneAdsenseUnit(html: string): string {
  const anchors = inContentAnchors(html);
  if (anchors.length !== 1) return html;
  const [at] = anchors;
  return `${html.slice(0, at)}${ADSENSE_UNIT}\n${html.slice(at)}`;
}

/**
 * Is every unit above the thread on the document that is about to be served?
 *
 * ⚠️ **THIS IS THE ORDER PROVEN RATHER THAN INTENDED, AND IT NOW HOLDS FOR EVERY UNIT.** The two insertions
 * used to be ordered by which call ran first, which is a fact about the code rather than about the page;
 * the anchors are disjoint, and this asks the served bytes directly so that a future change to either anchor
 * fails loudly instead of silently serving a paid block under a comment thread.
 *
 * **The check is the LAST unit against the thread**, because the units are in document order and a document
 * whose last unit is above the thread has all of them above it. A page with no unit or no discussion is not
 * a fault — most pages have neither — so it returns `true`.
 */
export function warnIfAdBelowDiscussion(html: string, where: string): boolean {
  const ad = html.lastIndexOf(`data-ad-slot="${ADSENSE_SLOT}"`);
  const discussion = html.indexOf('id="discussion"');
  if (ad === -1 || discussion === -1 || ad < discussion) return true;
  console.error(`[adsense] ${where}: a unit landed BELOW the discussion thread`);
  return false;
}

/**
 * Both halves of the ad code, for a document that is served with no framework around it.
 *
 * ⚠️ **THE OWNER'S ANALYTICS TAG DELIBERATELY DOES NOT RIDE ON THIS CALL.** It was the obvious place to put
 * it — one call, one producer — and it is wrong for a measured reason: this function is called by exactly
 * one route, for the article kind, while the analytics tag belongs on **all 53 screens and every record**.
 * Appending the tag here would measure the pages that carry an ad and silently miss the dashboards, the 404
 * and the 27 other screens — **and it would have made the two policies look like one policy**, which is the
 * drift this repository keeps paying for. `withAnalyticsTag` from `./analytics` is called at each producer's
 * own call site, beside this one, and the two lists cannot be confused.
 *
 * **THE ORDER BETWEEN THE TWO IS INDIFFERENT AND THAT IS ANCHORED RATHER THAN TRUSTED:** the tag is spliced
 * at the document's last `</head>` and the units inside the reading matter, so neither can move the other.
 */
export function withAdsense(html: string): string {
  /*
   * ⚠️ **THE ANCHORS ARE COMPUTED FIRST, BECAUSE A RECORD THAT EARNS NO UNIT MUST NOT CARRY THE LOADER.**
   * Calling `withAdsenseLoader` unconditionally would put `pagead2.googlesyndication.com` in the `<head>` of
   * every record — including the 82 measured short ones that get no unit — and a third-party script the archive
   * pays to download in order to fill nothing is not "no ad". **Measured on `/oputa-ii-the-obi-of-aboh/` (one
   * paragraph, 82 words): the loader was in the head and there was nothing on the page for it to fill.**
   */
  const anchors = inContentAnchors(html);
  if (anchors.length === 0) return html;
  return withAdsenseLoader(withAdsenseUnits(html));
}

/**
 * Put the loader in a document's `<head>`.
 *
 * Returns the document **byte for byte unchanged** when it has no `</head>`, which is the same contract
 * `insertDiscussion` and `withDiscussion` hold and the reason a fill that cannot find its anchor is a
 * missing ad rather than a mangled page.
 *
 * ⚠️ **IT IS NOT EXPORTED, AND THAT IS THE POINT.** A loader with no unit is a third-party script the
 * archive pays to download and asks nothing of; a unit with no loader is a rectangle that is never filled.
 * The two travel together through `withAdsense` above, so there is no call that can leave one behind.
 */
function withAdsenseLoader(html: string): string {
  const at = html.lastIndexOf('</head>');
  if (at === -1) return html;
  return `${html.slice(0, at)}${ADSENSE_LOADER}\n${html.slice(at)}`;
}

/*
 * ── WHY THE TWO ALLOW-LISTS THAT USED TO BE HERE ARE DELETED RATHER THAN NARROWED ────────────────────
 *
 * This file used to hold `ADSENSE_READER_SCREENS` (26 of the 53 design screens) and `ADSENSE_READER_SEGMENTS`
 * (the first path segment of seven React routes), each with a long note saying why it was an allow-list and
 * not a deny-list. **The note was right and the lists were the wrong shape**, which is a distinction worth
 * keeping because it is the reason they are gone:
 *
 *   · An allow-list is the right guard when the pages that must NOT have a unit are a minority that a new
 *     page could join silently. That was true while the reading surface was the majority of the site.
 *   · **It is the wrong guard when the pages that MUST have a unit are the minority** — one route, for one
 *     kind of page. A list of 26 screens and 7 segments that must all be kept out of a set is a deny-list
 *     wearing an allow-list's clothes, and its failure mode is the one the owner reported: a page that was
 *     never meant to carry an ad is served one because somebody added its name to a list that reads like a
 *     list of pages that read well.
 *
 * **So the guard is now the structure rather than the name.** A unit is only ever produced by
 * `withAdsense`, which only ever places units inside `.prose` reading matter; the React layout and the
 * design-screen route do not call it at all, and the one route that does calls it unconditionally because
 * every page it serves is an article or a folktale. A page kind cannot acquire a unit by being added to a
 * deliverable, a route, or a list — it would have to call this function.
 *
 * ⚠️ **AND THE TWO NAMES ARE NOT THE ROUTES, WHICH IS THE OTHER REASON THE LISTS WERE REMOVABLE.** `documents`
 * in the old screen list was the `/documents/` LISTING screen; a single document is a React route served by
 * `app/documents/[slug]/page.tsx` and was never in the list at all. A name in a list and a page on the site
 * are two different things, and the lists could not be read by anybody who did not already know that.
 */
