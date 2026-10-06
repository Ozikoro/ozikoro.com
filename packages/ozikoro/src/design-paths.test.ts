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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { designScriptPaths, designScreenLinks, withSiteFooter } from './design-paths.ts';

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
  /*
   * AND THE FRAGMENT CASE ENDS IN A REMOVAL RATHER THAN IN A SERVED LINK, WHICH PROVES BOTH RULES RAN, IN
   * ORDER. `about.html#terms` is made absolute to `/about/#terms` — the rule this test is about — and the
   * removal rule then takes it off, because the owner deleted the `<section id="terms">` block it named.
   * **The removal can only fire on the absolute address**: if the fragment rule had not run, the link would
   * still be sitting here as `about.html#terms`. So this is the same claim as before, asserted on the
   * outcome. (The message this replaced said "the fragment is dropped", which was never what happened —
   * the fragment is preserved by design.)
   */
  assert.doesNotMatch(out, /#terms/, 'a link into the block the owner deleted survived the serve');
  assert.doesNotMatch(out, /about\.html/, 'the design\'s about.html link was not made absolute before removal');
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

test('an in-page anchor is made an address on THIS page, because the base would send it to the root', () => {
  /*
   * THE FAULT THE BASE ITSELF CAUSES, MEASURED IN CHROME RATHER THAN REASONED. A `<base href="/">` decides
   * what a fragment-only address means, and the answer is the site root:
   *
   *     /documents/  #library  ->  http://127.0.0.1:3110/#library     NOT /documents/#library
   *     /about/      #main     ->  http://127.0.0.1:3110/#main
   *
   * So every skip link, every table of contents and every filter row on every served screen left the page.
   * The base stays — `mobile-nav.js` injects `<a href="igbo-calendar.html">` at run time and the base is what
   * resolves it — and the fragment is made absolute instead.
   */
  const screen = '<html><head></head><body><a href="#library">Skip to the library</a>'
    + '<a href="#research">Research</a><a href="#">A placeholder, not an anchor</a></body></html>';

  const out = designScreenLinks(screen, '/documents/');
  assert.match(out, /href="\/documents\/#library"/, 'the skip link still leaves the page for the site root');
  assert.match(out, /href="\/documents\/#research"/);
  // A bare `#` is a placeholder rather than an anchor, and dressing it up as a link is the fault, not the fix.
  assert.match(out, /href="#"/);
  assert.doesNotMatch(out, /href="\/documents\/#"/);

  /*
   * THE QUERY IS PART OF THE ADDRESS, and this is the case that makes it so: on the second page of an index,
   * `#series` must stay on page 2. A rule that used the path alone would send the reader back to page 1 —
   * the round-330 fault in miniature.
   */
  assert.match(
    designScreenLinks('<html><head></head><body><a href="#series">Series</a></body></html>', '/watch/?page=2'),
    /href="\/watch\/\?page=2#series"/,
    'the pager lost its page, so a fragment link is a link back to page 1'
  );

  /*
   * AND WITH NO ADDRESS IT IS LEFT ALONE, WHICH IS LOAD-BEARING RATHER THAN TIDY: `fillWatch` looks for
   * `href="#series"` in order to move an anchor to the page that really draws that section, and a first pass
   * that had already made it absolute would leave it pointing at whichever page the reader was on.
   */
  assert.match(designScreenLinks('<html><head></head><body><a href="#series">Series</a></body></html>'),
    /href="#series"/);

  // Idempotent with an address too, because the rewritten form no longer matches the rule.
  const once = designScreenLinks(screen, '/documents/');
  assert.equal(designScreenLinks(once, '/documents/'), once);
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

test('the retired academy host is rewritten in the design, which cannot be edited to stop naming it', () => {
  /*
   * THE OWNER'S INSTRUCTION, AS AN ASSERTION: *"everything about learn.ozituma.com should be removed entire.
   * we have a new academy coming up which is academy.ozikoro.com, which will replace learn.ozituma.com."*
   *
   * The design deliverable under `public/design/` is INVIOLABLE — byte-identical to
   * `design/calm-comfort-construct/public/design` — and seventeen of its fifty-two screens name the retiring
   * host. So the rewrite has to happen at serve time, and this is the test that says it does.
   *
   * THE THREE SHAPES ARE ASSERTED ONE AT A TIME, because they need three different answers and collapsing
   * them into one would get two of them wrong:
   *
   *   * an ADDRESS becomes `https://academy.ozikoro.com/` — the Academy itself, absolute, because it is a
   *     separate application on its own host. **It used to become `/academy/`, this archive's interim page
   *     about the Academy, and the owner retired that page** (*"delete this page
   *     https://ozikoro.com/academy/"*), so the assertion below is the one that would have caught a link
   *     left pointing at an address the middleware no longer serves.
   *   * the platform bar's LABEL stops naming the host, because "academy.ozikoro.com — Learn Igbo" would
   *     name a place the link does not go
   *   * a bare HOST in prose becomes `academy.ozikoro.com` — the announced replacement, named but not
   *     linked, which cannot 404
   */
  const fixture = [
    '<html><head><meta name="description" content="taught at learn.ozituma.com"></head><body>',
    '<li><a href="https://learn.ozituma.com/" class="here">learn.ozituma.com — Learn Igbo</a></li>',
    '<li><a href="https://ozituma.com/">ozituma.com — dictionary</a></li>',
    '<div><a href="https://learn.ozituma.com/">Learn Igbo</a></div>',
    '<tr><th scope="row">learn.ozituma.com</th><td>Courses</td></tr>',
    '<span>ozikoro.com · ozituma.com · learn.ozituma.com</span>',
    /*
     * AND THE MENU'S OWN ACADEMY ITEM, WHICH IS A DIFFERENT RULE FROM THE HOST REWRITE ABOVE.
     *
     * Six of the deliverable's screens carry `<a href="academy.html">Academy</a>` in the masthead, and
     * `academy.html` is a relative file name — so it is caught by the SCREEN-LINK rule, not by the
     * `learn.ozituma.com` rule. It used to fall through to the generic `/academy/`; this asserts it is the
     * Academy's absolute address instead. `academy.html` is the only screen that marks it current.
     */
    '<li><a href="academy.html" aria-current="page">Academy</a></li>',
    '</body></html>',
  ].join('');

  const out = designScreenLinks(fixture);

  assert.doesNotMatch(out, /href="https:\/\/learn\.ozituma\.com/, 'an address still sends a reader to the retiring host');
  assert.match(out, /<a href="https:\/\/academy\.ozikoro\.com\/" class="here">Academy — Learn Igbo<\/a>/,
    'the platform bar label must stop naming the host, and must point at the Academy itself');
  assert.match(out, /<a href="https:\/\/academy\.ozikoro\.com\/">Learn Igbo<\/a>/, 'the footer link must reach the Academy');
  assert.doesNotMatch(out, /href="\/academy\/"/, 'a link still points at the retired interim page on this host');
  assert.match(out, /<li><a href="https:\/\/academy\.ozikoro\.com\/">Academy<\/a><\/li>/,
    "the menu's Academy item does not reach the Academy");
  assert.doesNotMatch(out, /aria-current="page">Academy/,
    'the menu still claims the Academy item is the page the reader is on, though it leaves the site');
  assert.match(out, /taught at academy\.ozikoro\.com/, 'the meta description still names the retiring host');
  assert.match(out, /<th scope="row">academy\.ozikoro\.com<\/th>/, 'the comparison table still names the retiring host');
  assert.match(out, /ozikoro\.com · ozituma\.com · academy\.ozikoro\.com/, 'the footer domain list still names the retiring host');
  // `ozituma.com` is untouched: this rule is about one host, not about absolute addresses in general.
  assert.match(out, /href="https:\/\/ozituma\.com\/"/, 'the rule reached a host it does not own');
  // Idempotent, because the route calls this twice in a request.
  assert.equal(designScreenLinks(out), out);
});

test('no design screen names the retiring host once it has been served', () => {
  /*
   * AND THE SAME CLAIM OVER THE REAL DELIVERABLE RATHER THAN A FIXTURE.
   *
   * A fixture asserts the rule; this asserts the FILES. Seventeen of the fifty-two screens named the host
   * when this was written, so a count of zero after the rewrite is the whole of the claim — and if a future
   * design handoff adds an eighteenth screen naming it, this test is where that is noticed rather than on
   * the served page.
   */
  const screens = join(here, '..', '..', '..', 'apps', 'ozikoro', 'public', 'design', 'screens');
  const files = readdirSync(screens).filter((f: string) => f.endsWith('.html'));
  assert.ok(files.length >= 52, `expected the deliverable's screens; found ${files.length} files`);

  const before: string[] = [];
  const after: string[] = [];
  for (const file of files) {
    const raw = readFileSync(join(screens, file), 'utf8');
    if (raw.includes('learn.ozituma.com')) before.push(file);
    if (designScreenLinks(raw).includes('learn.ozituma.com')) after.push(file);
  }

  assert.ok(before.length > 0, 'no design screen names learn.ozituma.com — this test has stopped testing anything');
  assert.deepEqual(after, [], `these screens still name the retiring host after the rewrite: ${after.join(', ')}`);
});

test('the wordmark leaves the serve as Ozikoro and its strap as Archive, on the real deliverable', () => {
  /*
   * ── THE OWNER'S TWO ANSWERS, ASSERTED RATHER THAN DESCRIBED ──────────────────────────────────────
   *
   * *"the Ozi Ikoro limited you do put on the top menu should be removed everywhere. ozikoro is enough"*,
   * and, asked what the wordmark should be: **"Ozikoro Archive"**. `article.html` is the record route's own
   * template and `folklore.html` is `/folklore/`, so the two screens carrying a bare `OZI IKORO` are the
   * header of every record and of the folklores library — the bar that disagreed with the front page.
   *
   * THIS TEST READS THE DELIVERABLE'S OWN FILES, because that is where the strings are; the rewrite happens
   * to a copy in memory and the files are never written. `before` is asserted non-empty for the reason the
   * host test above asserts it: a design handoff that had already fixed these words would leave this test
   * passing while testing nothing.
   */
  const screens = join(here, '..', '..', '..', 'apps', 'ozikoro', 'public', 'design', 'screens');
  const files = readdirSync(screens).filter((f: string) => f.endsWith('.html'));

  let namedOziIkoro = 0;
  const strapsLeftHistoric: string[] = [];
  const strapsAfter = new Set<string>();

  for (const file of files) {
    const raw = readFileSync(join(screens, file), 'utf8');
    if (raw.includes('OZI IKORO')) namedOziIkoro += 1;

    const served = designScreenLinks(raw);
    assert.doesNotMatch(served, /OZI IKORO/, `${file} still writes OZI IKORO once served`);

    for (const strap of served.matchAll(/<a class="wordmark"[^>]*>[\s\S]*?<span>([^<]*)<\/span>/g)) {
      strapsAfter.add(strap[1]!);
    }
    if (/<a class="wordmark"[^>]*>[\s\S]*?<span>History &amp; Archive<\/span>/.test(served)) {
      strapsLeftHistoric.push(file);
    }

    // Idempotent, because the route calls this twice in one request.
    assert.equal(designScreenLinks(served), served, `${file} was changed by a second pass`);
  }

  assert.ok(namedOziIkoro >= 3, `only ${namedOziIkoro} screen(s) wrote OZI IKORO — this test has stopped testing anything`);
  assert.deepEqual(strapsLeftHistoric, [], `these screens keep the old strap after the serve: ${strapsLeftHistoric.join(', ')}`);
  // The front page's bar and the record template's bar now carry the same second word.
  assert.ok(strapsAfter.has('Archive'), 'no wordmark is served with the strap the owner chose');

  /*
   * AND THE REWRITE IS BOUNDED TO THE WORDMARK. `account.html` writes the same phrase three times outside
   * one — the platform bar's label, the brand's `<small>` and a line of prose — and **this function is not
   * the one that serves that screen**: the brand's `<small>` is changed where it IS served
   * (`apps/ozikoro/lib/account-screen.ts`, asserted in `account-screen.test.ts`), and the other two are not
   * brands at all. **A page-wide replace of the words would have edited a label and a sentence**, which is
   * what this asserts did not happen.
   */
  const account = readFileSync(join(screens, 'account.html'), 'utf8');
  const accountServed = designScreenLinks(account);
  assert.match(accountServed, /<small>History &amp; Archive<\/small>/, 'the account screen lost a label that is not a brand');
  assert.match(accountServed, /<strong>Ozikoro<\/strong>/, 'the account brand word changed under the wrong function');

  // A fixture, so the rule is asserted and not only the deliverable's current wording.
  const fixture = '<html><head></head><body><header class="sx-reader-header"><div class="wrap">'
    + '<a class="wordmark" href="home.html">OZI IKORO <span>Archive</span></a></div></header>'
    + '<header class="masthead"><div class="wrap">'
    + '<a class="wordmark" href="home.html"><b>Ozikoro</b> <span>History &amp; Archive</span></a>'
    + '<p>Ozikoro · History &amp; Archive is the archive&rsquo;s strapline in prose.</p>'
    + '</div></header></body></html>';
  const servedFixture = designScreenLinks(fixture);
  // The two headers, served: the same brand and the same second word.
  assert.match(
    servedFixture,
    /<a class="wordmark" href="\/"><img src="\/media\/ozikoro\/486-cropped-Ozi-Ikoro-Icon-Yellow-1\.png" alt="">Ozikoro <span>Archive<\/span><\/a>/,
    'the reader header did not serve as Ozikoro Archive'
  );
  assert.match(
    servedFixture,
    /<a class="wordmark" href="\/"><img src="\/media\/ozikoro\/486-cropped-Ozi-Ikoro-Icon-Yellow-1\.png" alt=""><b>Ozikoro<\/b> <span>Archive<\/span><\/a>/,
    'the masthead did not serve as Ozikoro Archive'
  );
  // And the phrase outside a wordmark is prose, and stays prose.
  assert.match(
    servedFixture,
    /<p>Ozikoro · History &amp; Archive is the archive&rsquo;s strapline in prose\.<\/p>/,
    'a sentence containing the phrase was rewritten as if it were a brand'
  );
});

test('the owner\u2019s mark is served in every brand slot, exactly once per screen, on the real deliverable', () => {
  /*
   * ── A CHANGE TO THE DESIGN HE AUTHORISED, ASSERTED THE WAY A FIX WOULD BE ────────────────────────
   *
   * An agent measured the logo question and put three options to the owner. He chose **the mark on all 53
   * screens**, and the option he accepted said *"Literal 'every single page', but 52 screens gain an image
   * your design never gave them."* So the change below is his decision about his own design, and this test
   * exists to hold it to the two things that make it safe rather than to pretend it is a defect repaired:
   *
   *   1. **EXACTLY ONE MARK PER SCREEN.** The one screen that already drew it — `home.html` — must not gain
   *      a second, and a screen with two brand anchors must not gain two. This is the assertion that fails
   *      if the insertion ever stops checking for an existing `<img>`.
   *   2. **THE ADDRESS IS ABSOLUTE.** `src="/media/…"`. The same element is served at `/`, at `/<slug>/`,
   *      at `/folklore/` and at `/dashboard-reader/` — four different depths — and a relative address that
   *      works on `/` and 404s on a record is the fault this change would otherwise have produced. The
   *      literal in the regex is the assertion; `startsWith` is asserted separately so the failure says so.
   *
   * AND THE COUNT IS ASSERTED, for the reason the host test asserts its own: a deliverable that had already
   * gained the mark everywhere would leave this passing while testing nothing.
   */
  const screens = join(here, '..', '..', '..', 'apps', 'ozikoro', 'public', 'design', 'screens');
  const files = readdirSync(screens).filter((f: string) => f.endsWith('.html'));
  assert.equal(files.length, 53, 'the deliverable is no longer 53 screens');

  const MARK = /<img src="(\/media\/ozikoro\/486-cropped-Ozi-Ikoro-Icon-Yellow-1\.png)" alt="">/;
  const MARK_ALL = /<img src="\/media\/ozikoro\/486-cropped-Ozi-Ikoro-Icon-Yellow-1\.png" alt="">/g;
  /* The seven files with no brand element anywhere. Their names and why are at `WORDMARK_MARK_SRC`. */
  const noBrandSlot = new Set([
    'dashboard-account.html',
    'dashboard-moderation.html',
    'dashboard-review.html',
    'dashboard-states.html',
    'dashboard-workflow.html',
    'oral-recordings.html',
    'type-test.html',
  ]);

  let inserted = 0;
  for (const file of files) {
    const raw = readFileSync(join(screens, file), 'utf8');
    const served = designScreenLinks(raw);

    if (file === 'account.html' || noBrandSlot.has(file)) {
      /* Neither is this function's screen: the account page is served by `account-screen.ts`, asserted
       * there, and the seven above have no brand slot for a mark to go into. */
      assert.equal(
        [...served.matchAll(MARK_ALL)].length,
        0,
        `${file} is not served through this function, so a mark here is unexpected`
      );
      continue;
    }

    /* EXACTLY ONE IMAGE IN THE BRAND ANCHOR — the whole of the "no second mark" rule. `home.html` already
     * drew one (the deliverable's own WordPress address, which the home fill resolves) and the other 44 are
     * given the archive's media address below. Two would mean the insertion stopped checking. */
    const anchors = [...served.matchAll(/<a class="(?:wordmark|sx-dash-brand)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
    assert.equal(anchors.length, 1, `${file} serves ${anchors.length} brand anchors and the measurement is one`);
    const images = anchors[0]![1]!.match(/<img\b/g) ?? [];
    assert.equal(images.length, 1, `${file} serves ${images.length} images in its brand anchor, not one`);

    if (file === 'home.html') {
      assert.doesNotMatch(served, MARK, 'the front page gained a second mark beside the one it already had');
    } else {
      assert.match(served, MARK, `${file} was not given the owner's mark`);
      inserted += 1;
    }

    const src = served.match(MARK)?.[1];
    if (src) assert.ok(src.startsWith('/'), `${file} serves the mark at a relative address: ${src}`);
    assert.equal(designScreenLinks(served), served, `${file} gained a second mark on the second pass`);
  }

  /* 35 screens write `a.wordmark` without an image and 9 write `a.sx-dash-brand`; `home.html` is the
   * fifty-third and already had one. `account.html`'s mark is the forty-fifth and is asserted in
   * `apps/ozikoro/lib/account-screen.test.ts`, which is where that screen is served. */
  assert.equal(inserted, 44, `${inserted} screens were given the mark, and the number measured is 44`);

  /*
   * THE DASHBOARD RAIL IS SIZED BY THE DESIGN'S OWN RULE, AND THIS IS WHAT MAKES THAT TRUE. The design's
   * mark is sized by a DESCENDANT rule — `showcase.css:20 .wordmark img` — so the rail's anchor, which does
   * not carry that class in the deliverable, is given it at serve time. Without it the image is
   * `display:block; max-width:100%` (`main.css:11`) and renders at the width of the whole rail.
   */
  const dash = designScreenLinks(
    readFileSync(join(screens, 'dashboard-reader.html'), 'utf8')
  );
  assert.match(
    dash,
    /<a class="sx-dash-brand wordmark" href="\/"><img src="\/media\/ozikoro\/486-cropped-Ozi-Ikoro-Icon-Yellow-1\.png" alt="">Ozikoro<\/a>/,
    'the dashboard brand is not served in the design\u2019s own wordmark slot'
  );

  /*
   * AND THE WORDS SURVIVE. He wants a logo, not a replacement for the name: `<b>` for the gold and the
   * `<span>` strap are still there, on the same anchors, and the anchor still points at `/`.
   */
  const about = designScreenLinks(readFileSync(join(screens, 'about.html'), 'utf8'));
  assert.match(
    about,
    /<a class="wordmark" href="\/"><img src="[^"]+" alt=""><b>Ozikoro<\/b><span>Archive<\/span><\/a>/,
    'the mark displaced the design\u2019s own name or its gold'
  );
});

test('the four fragments that name a section no page draws come off, whole item and all', () => {
  /*
   * ── THE DESIGN'S SIX `about.html` FRAGMENTS, AND WHICH OF THEM COME OFF HERE ────────────────────
   *
   * Fourteen of the deliverable's screens link `about.html#entrust`, `#privacy`, `#access`, `#partners`,
   * `#licensing` and `#contact`, and the deliverable's `about.html` carries three ids — `main`, `faq`,
   * `terms`. **Two of the six name a section the page really draws** ("How a record earns its place" and
   * `<h3>Partnerships</h3>`, with the contact section's "Talk to Ozi Ikoro Limited"), so the missing thing is
   * the id and `fillAbout` writes it — see the test in `design-fill.test.ts`.
   *
   * **`#access` was the first of the four that name nothing, and it is a different answer: the page draws
   * nothing of the kind under any id.** The deliverable's `about.html` has no institutional-access section,
   * and neither has the served page; its only sentences about access describe a RECORD's terms and a
   * publication's availability. **So the item is wrong and the page is not** — and a rewrite onto `#faq` or
   * `#terms` would be naming a section by a label it does not carry: a reader pressing "Request access"
   * would land on a privacy notice.
   *
   * ⚠️ **`#terms`, `#privacy` AND `#licensing` JOINED IT WHEN THE OWNER ASKED FOR THE BLOCK THEY NAMED TO BE
   * DELETED.** *"on the about page … before footer, delete this part they wrote these: Terms — Binding terms
   * must be supplied by Ozi Ikoro Limited. Privacy — The complete data-controller notice must be supplied.
   * Licensing — Each record displays its own access and reuse terms."* Those three `<h2>`s were the whole of
   * `<section id="terms">`, `fillAbout` removes it, and no section of the served page is headed Terms,
   * Privacy or Licensing any more. **So all four links go — and the assertion that the Terms and Privacy
   * items survive would now be an assertion of the fault.**
   *
   * THE WHOLE LIST ITEM GOES, which is asserted rather than assumed: leaving `<li></li>` behind would leave
   * a gap in the footer column where the item used to be. **AND A COLUMN LEFT WITH NOTHING IN IT GOES WITH
   * ITS ITEMS**, because the deliverable's shorter footers carry a Terms column of only `#terms` and
   * `#privacy` (or `#terms` and `#licensing`) — stripping those would leave `<h4>Terms</h4>` over an empty
   * `<ul>`, which is the same gap one level up.
   */
  const footer = '<html><head></head><body><footer><div class="grid-4">'
    + '<div><h4>Research</h4><ul><li><a href="about.html#access">Institutional access</a></li>'
    + '<li><a href="about.html#entrust">Entrusting material</a></li></ul></div>'
    + '<div><h4>Terms</h4><ul>'
    + '<li><a href="about.html#terms">Terms of use</a></li>'
    + '<li><a href="about.html#privacy">Privacy</a></li>'
    + '<li><a href="about.html#licensing">Licensing &amp; reuse</a></li>'
    + '</ul></div>'
    + '</div></footer>'
    + '<a class="btn btn-quiet" href="about.html#access">Request access</a></body></html>';
  const out = designScreenLinks(footer);
  assert.doesNotMatch(out, /#access/, 'a link to a section no page draws survived the serve');
  assert.doesNotMatch(out, /#terms/, 'a link into the block the owner deleted survived the serve');
  assert.doesNotMatch(out, /#privacy/, 'a link into the block the owner deleted survived the serve');
  assert.doesNotMatch(out, /#licensing/, 'a link into the block the owner deleted survived the serve');
  assert.doesNotMatch(out, /<li>\s*<\/li>/, 'the footer keeps an empty list item where the link was');
  assert.doesNotMatch(out, /<ul>\s*<\/ul>/, 'an empty list was left where the removed items were');
  assert.doesNotMatch(out, /<h4>Terms<\/h4>/, 'the Terms column survived with nothing under its heading');
  // AND THE LINK THAT NAMES A SECTION THE PAGE REALLY DRAWS IS UNTOUCHED.
  assert.match(out, /href="\/about\/#entrust"/, 'the Entrusting item, which really exists, was removed with them');
  // Idempotent, because the route calls this twice in a request.
  assert.equal(designScreenLinks(out), out);
});

test('no design screen still writes an `about.html#access` link once it has been served', () => {
  /*
   * THE SAME CLAIM OVER THE REAL DELIVERABLE RATHER THAN A FIXTURE, and the count is asserted on both sides
   * so the test cannot pass by there being nothing to remove. `home.html` alone writes it twice — once in the
   * footer's Research column and once as the front page's door — and `/documents/` writes it as the control
   * on a locked record, which is why a fixture would not have been enough.
   */
  const screens = join(here, '..', '..', '..', 'apps', 'ozikoro', 'public', 'design', 'screens');
  const files = readdirSync(screens).filter((f: string) => f.endsWith('.html'));

  let before = 0;
  const after: string[] = [];
  for (const file of files) {
    const raw = readFileSync(join(screens, file), 'utf8');
    before += (raw.match(/href="about\.html#access"/g) ?? []).length;
    if (/#access/.test(designScreenLinks(raw))) after.push(file);
  }

  assert.ok(before > 0, 'no design screen links about.html#access — this test has stopped testing anything');
  assert.deepEqual(after, [], `these screens still write an #access link after the rewrite: ${after.join(', ')}`);
});

test('no design screen still writes a link into the block the owner deleted', () => {
  /*
   * THE SAME CLAIM AS THE TEST ABOVE, OVER THE REAL DELIVERABLE RATHER THAN A FIXTURE, and for the three
   * fragments the owner's deletion took the target away from. Measured across the deliverable when this was
   * written: `about.html#terms` thirteen times (twelve footers plus `about.html`'s own), `about.html#privacy`
   * six, `about.html#licensing` twice — **twenty-one links on thirteen screens**, which is why a fixture
   * would not have been enough.
   *
   * THE COUNT IS ASSERTED ON THE SOURCE SIDE, so the test cannot pass by there being nothing left to remove:
   * if the deliverable ever stops writing these links the floor below fails and the reason is reported,
   * rather than the whole thing going quietly vacuous. It is a floor and not an equality because a screen
   * added to the deliverable may legitimately add more.
   */
  const screens = join(here, '..', '..', '..', 'apps', 'ozikoro', 'public', 'design', 'screens');
  const files = readdirSync(screens).filter((f: string) => f.endsWith('.html'));

  let before = 0;
  const after: string[] = [];
  for (const file of files) {
    const raw = readFileSync(join(screens, file), 'utf8');
    before += (raw.match(/href="about\.html#(?:terms|privacy|licensing)"/g) ?? []).length;
    if (/href="\/about\/#(?:terms|privacy|licensing)"/.test(designScreenLinks(raw))) after.push(file);
  }

  assert.ok(before >= 21,
    `the deliverable writes ${before} links into the deleted block, where 21 were measured — this test has stopped testing what it was written for`);
  assert.deepEqual(after, [], `these screens still write a link into the deleted block after the rewrite: ${after.join(', ')}`);
});

/* ------------------------------------------------------------------------------------------------
 * THE FOOT OF THE SITE, ON THE SCREENS THE DELIVERABLE DREW WITHOUT ONE
 * ---------------------------------------------------------------------------------------------- */

const SCREENS = join(here, '..', '..', '..', 'apps', 'ozikoro', 'public', 'design', 'screens');

/** The calendar's footer exactly as the deliverable writes it — the owner's report, as a fixture. */
const THIN_FOOTER = '<footer class="site-foot"><div class="wrap"><div class="legal">'
  + '<span>© 2026 Ozi Ikoro Limited.</span>'
  + '<span><a href="careers.html">Careers</a> · <a href="cite.html">Citation guide</a></span>'
  + '</div></div></footer>';

test('a screen whose footer is the legal strip gains the site\'s own columns', () => {
  const out = withSiteFooter(`<html><body>${THIN_FOOTER}</body></html>`);
  assert.match(out, /class="grid-4"/, 'the calendar still ends in one line of small print');
  assert.match(out, /<h4>Archive<\/h4>/, 'the Archive column is missing');
  assert.match(out, /<h4>Research<\/h4>/);
  assert.match(out, /<h4>Platform<\/h4>/);
  assert.match(out, /<h4>Terms<\/h4>/);
  /*
   * THE SCREEN'S OWN STRIP STAYS, CHARACTER FOR CHARACTER. It is where the deliverable says what *this*
   * page's foot holds — "Collections · Citation guide" on the library, "All projects · Public ledger" on a
   * project — and four columns of the site's links are not a reason to take it away.
   */
  assert.match(out, /<span><a href="careers\.html">Careers<\/a> · <a href="cite\.html">Citation guide<\/a><\/span>/,
    'the screen\'s own legal line was replaced rather than added to');
  // Idempotent: the second pass sees the columns and does nothing.
  assert.equal(withSiteFooter(out), out);
});

test('a screen that already has the columns, or has no footer, is left exactly as it was', () => {
  const full = `<html><body><footer class="site-foot"><div class="wrap"><div class="grid-4">`
    + '<div><h4>Archive</h4></div></div><div class="legal"><span>© 2026</span></div>'
    + '</div></footer></body></html>';
  assert.equal(withSiteFooter(full), full, 'a second set of columns was added to a screen that has one');

  /*
   * `article.html`, the nineteen dashboards and the readers have no footer at all, and an article record is
   * not the page to grow the site's directory. The rule asks the document what its footer IS, so these are
   * reached by the same call and changed by it in no way.
   */
  const none = '<html><body><p>An article</p></body></html>';
  assert.equal(withSiteFooter(none), none);

  // A `site-foot` with no legal strip is neither of the two shapes the deliverable draws.
  const odd = '<footer class="site-foot"><div class="wrap"><p>Something else</p></div></footer>';
  assert.equal(withSiteFooter(odd), odd);

  /*
   * AND `folklore.html`'s INLINE `margin-top:0` COMES OFF, because it was written for a footer that had
   * nothing above the strip and would otherwise collapse the separation the other sixteen screens keep.
   */
  const folklore = '<footer class="site-foot"><div class="wrap"><div class="legal" style="margin-top:0">'
    + '<span>© 2026 Ozi Ikoro Limited.</span></div></div></footer>';
  const fixed = withSiteFooter(folklore);
  assert.match(fixed, /<div class="legal">/, 'the collapsed strip kept its margin-top:0 under four columns');
  assert.doesNotMatch(fixed, /margin-top:0/);
});

test('the columns are the front page\'s own, taken from the file rather than retyped', () => {
  /*
   * A CONSTANT COPIED OUT OF AN INVIOLABLE FILE IS A CONSTANT THAT WILL ONE DAY DISAGREE WITH IT. This reads
   * `screens/home.html`, extracts its `<div class="grid-4">`, and asserts that what the transform injects is
   * that block and not a paraphrase of it — the same arrangement `design-fill.test.ts` uses for the design's
   * own calendar script.
   *
   * `home.html` is the footer taken, and the test says WHY it is the one: `/` is served from this same
   * deliverable (the middleware rewrites it to `/design-screen/home`), so these columns are already what the
   * front page shows, and they are the only set that names the sections these thin screens belong to.
   */
  const home = readFileSync(join(SCREENS, 'home.html'), 'utf8');
  const footer = /<footer class="site-foot">[\s\S]*?<\/footer>/.exec(home)?.[0];
  assert.ok(footer, 'home.html has no `site-foot` — the footer this transform copies has gone');
  const columns = /<div class="grid-4">[\s\S]*?\n    <\/div>\n/.exec(footer)?.[0];
  assert.ok(columns, 'home.html no longer draws a `grid-4` block for this transform to copy');

  const out = withSiteFooter(`<html><body>${THIN_FOOTER}</body></html>`);
  assert.ok(
    out.includes(columns),
    'the injected columns have drifted from home.html\'s own — copy them again rather than editing the constant'
  );
});

test('every screen the deliverable drew thin is served with the columns, and the count is asserted', () => {
  /*
   * THE CLAIM OVER THE REAL DELIVERABLE RATHER THAN A FIXTURE. Re-measured on 2026-10-06, when this read:
   * **of the 53 screens, 18 carry `site-foot` with only the legal strip, 13 carry the four columns, and 22
   * have no footer element at all** (plus `account.html`, whose foot is a `.footer` line of its own). Both
   * sides are asserted so the test cannot pass by there being nothing to do.
   *
   * ⚠️ THE CONSTANT MOVED FROM 17 TO 18 AND THE SCREEN IS NAMED RATHER THAN THE NUMBER EXPLAINED AWAY. It
   * was 17 when the deliverable held 52 screens; upstream's `document-viewer.html` — merged with the
   * middleware entry that serves it — is the eighteenth. **It was already 18 before the change this
   * comment sits in**: `thin` below is computed from the raw design files and nothing else, so no
   * serve-time rule can move it. Corrected here because a test whose whole point is that the count is
   * asserted has to be re-measured when the count moves, or the assertion is decoration.
   */
  const files = readdirSync(SCREENS).filter((f: string) => f.endsWith('.html'));
  assert.ok(files.length >= 53, `expected the deliverable's screens; found ${files.length} files`);

  const thin: string[] = [];
  const withColumns: string[] = [];
  const noFooter: string[] = [];
  const stillThin: string[] = [];

  for (const file of files) {
    const raw = readFileSync(join(SCREENS, file), 'utf8');
    const footer = /<footer class="site-foot">[\s\S]*?<\/footer>/.exec(raw)?.[0];
    if (!footer) {
      noFooter.push(file);
      continue;
    }
    if (footer.includes('class="grid-4"')) withColumns.push(file);
    else thin.push(file);
    if (!withSiteFooter(raw).includes('class="grid-4"')) stillThin.push(file);
  }

  assert.equal(thin.length, 18, `the deliverable's thin-footer screens have changed: ${thin.join(', ')}`);
  assert.equal(withColumns.length, 13, `the deliverable's four-column screens have changed: ${withColumns.join(', ')}`);
  assert.ok(noFooter.length > 0, 'no screen is without a footer — this test has stopped testing anything');
  assert.deepEqual(stillThin, [], `these screens are still served without the columns: ${stillThin.join(', ')}`);
});

test('the injected columns are resolved by the same rule as every other address on the page', () => {
  /*
   * THE ORDERING IS THE WHOLE OF HOW THE LINKS WORK, and this is the assertion that keeps it. The constant
   * carries the design's own relative addresses — `archive-index.html`, `towns.html`, `learn.ozituma.com` —
   * and the route calls `withSiteFooter` BEFORE `designScreenLinks`, which is the one place those resolve.
   * Called the other way round, twenty-two footer links would sit on a served page as `archive-index.html`,
   * resolving one segment too deep, in markup that reads as correct.
   */
  const out = designScreenLinks(withSiteFooter(`<html><head></head><body>${THIN_FOOTER}</body></html>`));

  assert.doesNotMatch(out, /href="[a-z0-9-]+\.html/, 'a relative footer address reached the served page');
  assert.match(out, /href="\/archive\/">All histories</, 'archive-index.html did not resolve to the archive');
  assert.match(out, /href="\/clan-towns\/">Clans and towns</, 'towns.html did not resolve to the register');
  assert.match(out, /href="https:\/\/academy\.ozikoro\.com\/">Learn Igbo</, 'the retired host did not resolve to the Academy');
  assert.match(out, /href="https:\/\/ozituma\.com\/"/, 'the dictionary is an address, not a screen, and was rewritten');
  /*
   * THE FOOTER ITEMS THAT NAME A SECTION NO PAGE DRAWS ARE REMOVED, EXACTLY AS THEY ARE ON THE FRONT PAGE:
   * `#access` never had a section at all, and `#terms`, `#privacy` and `#licensing` named the three-column
   * block the owner asked to be deleted. **AND THE ONE THAT DOES NAME A SECTION STAYS** — `#entrust` — which
   * is what stops this test passing because the whole Terms column was taken away.
   */
  for (const fragment of ['access', 'terms', 'privacy', 'licensing']) {
    assert.doesNotMatch(out, new RegExp(`#${fragment}`),
      `the footer kept a link to a section no page draws (#${fragment})`);
  }
  assert.match(out, /href="\/about\/#entrust"/, 'a real fragment was removed with them');
});

