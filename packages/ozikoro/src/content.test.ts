/**
 * Tests for the archive HTML pipeline.
 *
 * The sanitiser is the one piece of this codebase that faces material it did not write, and it is
 * the only thing standing between a migrated WordPress body (or, later, a contributor's) and a
 * reader's browser. So it is tested against the things that actually go wrong rather than against
 * a happy path: a script tag, an event handler, a `javascript:` URL, a `data:` payload, an
 * unbalanced tag, and the Elementor inline styles that would otherwise fight the design.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READ_MORE_TAG,
  prepareArchiveHtml,
  readingMinutes,
  sanitiseArchiveHtml,
  stripShortcodes,
  summarise,
  citationFor,
  normaliseHeadingLevels,
} from './content.ts';

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

test('a script tag is removed, and so is its contents', () => {
  const out = sanitiseArchiveHtml('<p>before</p><script>alert("xss")</script><p>after</p>');
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('alert'));
  assert.ok(out.includes('before') && out.includes('after'));
});

test('an event handler attribute never survives, on any tag', () => {
  const out = sanitiseArchiveHtml('<p onclick="steal()">text</p><img src="/a.jpg" onerror="steal()">');
  assert.ok(!out.includes('onclick'));
  assert.ok(!out.includes('onerror'));
  assert.ok(out.includes('text'));
});

test('a javascript: URL is refused in href and in src', () => {
  assert.ok(!sanitiseArchiveHtml('<a href="javascript:alert(1)">x</a>').includes('javascript:'));
  assert.ok(!sanitiseArchiveHtml('<img src="javascript:alert(1)">').includes('javascript:'));
  // Obfuscation with control characters or newlines must not slip past either.
  assert.ok(!sanitiseArchiveHtml('<a href="java\nscript:alert(1)">x</a>').includes('script:'));
  assert.ok(!sanitiseArchiveHtml('<a href="JaVaScRiPt:alert(1)">x</a>').includes('cript:'));
});

test('a data: URL is refused, because archived media belongs in storage', () => {
  const out = sanitiseArchiveHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">');
  assert.ok(!out.includes('data:'));
});

test('style, class and id are stripped so Elementor cannot override the design', () => {
  // Measured on the live archive: 1,629 inline style attributes across 200 articles. Left in
  // place a hard-coded font-size beats the design token, which is the "generic blog" failure.
  const out = sanitiseArchiveHtml('<p style="font-size:11px;color:red" class="elementor-widget" id="x">t</p>');
  assert.equal(out, '<p>t</p>');
});

test('a fragment target written as `<a name>` survives, and `id` still does not', () => {
  /*
   * ── ONE RECORD'S FOOTNOTES, AND WHY THE ATTRIBUTE IS THE DESTINATION ────────────────────────────────
   *
   * `/beyond-wrestling-sport-in-pre-colonial-west-africa/` is the only one of the archive's 1,051 published
   * records with an in-page link anywhere in its body, and its footnote plugin marks both ends of every note
   * with `name` on an `<a>` rather than an `id`:
   *
   *     the text:   <a href="#_ftn1" name="_ftnref1">[1]</a>
   *     the note:   <a href="#_ftnref1" name="_ftn1">[1]</a>
   *
   * **So each anchor is the other's destination.** Before this allowance the served page kept all seventeen
   * links — `designScreenLinks` made them `/<slug>/#_ftn1` — and had a target for none of them: a control that
   * returns 200 and moves nothing, in both directions. The WordPress dump settles which half was missing:
   * 17 `href="#_ftn…"`, 17 `name="_ftn…"`, **0 `id="_ftn…"`**.
   *
   * AND THE ADJACENT DECISION IS ASSERTED IN THE SAME TEST, because the two are one judgement: **`id` stays
   * dropped.** 955 of the 1,051 bodies carry one (5,198 occurrences) and no body links to any of them, so
   * keeping them would put five thousand inert attributes into the served documents to fix nothing — and the
   * design's own frame already uses `opening`, `record`, `context`, `sources`, `citation`, `listen` and
   * `related`, so a body `id` is the one that can shadow the page's own navigation.
   */
  const marker = '<p>x <a href="#_ftn1" name="_ftnref1">[1]</a></p>';
  assert.equal(sanitiseArchiveHtml(marker), marker, 'the footnote target must survive the sanitiser');
  // The attribute is kept only on `a`, which is the only element the browser's fragment rule looks at.
  assert.equal(sanitiseArchiveHtml('<p name="_ftn1">t</p>'), '<p>t</p>', '`name` elsewhere is not a target');
  assert.ok(!sanitiseArchiveHtml('<a name="x" id="y" class="z" style="color:red">t</a>').includes('id='));
  // And it is escaped like every other attribute rather than trusted: a quote inside the value must not
  // become a second attribute. (The word `onmouseover` survives as escaped TEXT inside the value, which is
  // what the allowlist is for — it is not an event handler, it is a string a reader could see.)
  const escaped = sanitiseArchiveHtml('<a name=\'x" onmouseover="steal()\'>t</a>');
  assert.ok(!/ onmouseover="/.test(escaped), 'a quote in the value must not create a second attribute');
  assert.ok(escaped.includes('&quot;'), 'the quote is escaped rather than emitted raw');
  assert.equal(escaped, '<a name="x&quot; onmouseover=&quot;steal()">t</a>');
});

test('a dangerous element is dropped whole, not unwrapped', () => {
  const out = sanitiseArchiveHtml('<p>a</p><iframe src="https://evil.example">fallback</iframe><p>b</p>');
  assert.ok(!out.includes('iframe'));
  assert.ok(!out.includes('fallback'));
  assert.ok(out.includes('a') && out.includes('b'));
});

test('an unbalanced tag is tolerated rather than repaired', () => {
  // WordPress content is frequently unbalanced. A sanitiser that guesses at structure does more
  // damage to a historical document than one that leaves it alone.
  const out = sanitiseArchiveHtml('<p>one<p>two</p>');
  assert.equal(out, '<p>one<p>two</p>');
});

test('a comment is removed, including a conditional one', () => {
  const out = sanitiseArchiveHtml('<p>a</p><!--[if IE]><script>x</script><![endif]--><p>b</p>');
  assert.ok(!out.includes('IE'));
  assert.ok(!out.includes('<script'));
});

test('the Read More tag is the one comment that survives, and it survives exactly', () => {
  /*
   * The editor's More button is WordPress's `wp_more`, whose whole behaviour is writing this tag into the
   * post. It is kept rather than stripped because the rule above it is about comments that can HIDE
   * markup — a conditional comment's contents are not parsed but they are not gone — and this one hides
   * nothing and contains nothing. Everything else about a comment is still true of this one: it runs no
   * script, applies no style and fetches nothing.
   */
  assert.equal(sanitiseArchiveHtml(`<p>a</p>${READ_MORE_TAG}<p>b</p>`), `<p>a</p>${READ_MORE_TAG}<p>b</p>`);
  assert.equal(READ_MORE_TAG, '<!--more-->');
  // It does not smuggle anything in with it: a comment that merely STARTS with the tag is still removed.
  assert.ok(!sanitiseArchiveHtml('<p>a</p><!--more--><script>alert(1)</script>').includes('alert'));
  // And the pass that removes the others still removes them, either side of a kept one.
  const mixed = sanitiseArchiveHtml(`<!-- wp:paragraph --><p>a</p>${READ_MORE_TAG}<!--[if IE]>x<![endif]--><p>b</p>`);
  assert.equal(mixed.split(READ_MORE_TAG).length, 2, 'the tag was duplicated or lost');
  assert.ok(!mixed.includes('wp:paragraph') && !mixed.includes('IE'));
});

test('a summary ends at the Read More tag, as WordPress’s own excerpt does', () => {
  const body = `<p>${'one '.repeat(30)}</p><!--more--><p>${'two '.repeat(30)}</p>`;
  const summary = summarise(body, 400);
  assert.ok(summary.startsWith('one'), 'the summary did not start at the beginning');
  assert.ok(!summary.includes('two'), 'the summary ran past the Read More tag');
  // A body with no tag is summarised from the beginning as before.
  assert.ok(summarise('<p>alpha</p><p>beta</p>').includes('alpha'));
});

test('an image with no usable source is dropped rather than shown broken', () => {
  // The design draws its own deliberate empty plate for a record with no picture; a broken image
  // icon is not that.
  assert.equal(sanitiseArchiveHtml('<p>a</p><img alt="nothing">'), '<p>a</p>');
});

test('text content is escaped, so a stray angle bracket cannot open a tag', () => {
  const out = sanitiseArchiveHtml('<p>5 &lt; 7 and 9 &gt; 2</p>');
  assert.ok(out.includes('&lt;') && out.includes('&gt;'));
});

// ---------------------------------------------------------------------------
// Fidelity
// ---------------------------------------------------------------------------

test('the tags prose actually needs all survive', () => {
  const html =
    '<h2>H</h2><p><strong>b</strong><em>i</em><a href="/x">l</a></p>' +
    '<blockquote cite="https://e.example"><p>q</p></blockquote>' +
    '<ul><li>one</li></ul><ol start="3"><li>three</li></ol>' +
    '<figure><img src="/a.jpg" alt="a"><figcaption>c</figcaption></figure>' +
    '<table><thead><tr><th scope="col">h</th></tr></thead><tbody><tr><td colspan="2">d</td></tr></tbody></table>';
  const out = sanitiseArchiveHtml(html);
  for (const tag of ['<h2>', '<strong>', '<em>', '<a ', '<blockquote', '<ul>', '<li>', '<ol ', '<figure>', '<figcaption>', '<table>', '<th ', '<td ', '<img ']) {
    assert.ok(out.includes(tag), `lost ${tag}`);
  }
});

test('an internal link becomes a path on this site, so it keeps working after the move', () => {
  // Otherwise every cross-reference in 1,051 articles would send the reader back to the old
  // WordPress address for a page that now lives here.
  const out = sanitiseArchiveHtml('<a href="https://ozikoro.com/other-record/">see</a>');
  assert.ok(out.includes('href="/other-record/"'), out);
  assert.ok(!out.includes('ozikoro.com'));
});

test('an external link is kept, and gains rel', () => {
  const out = sanitiseArchiveHtml('<a href="https://example.org/paper.pdf">paper</a>');
  assert.ok(out.includes('href="https://example.org/paper.pdf"'));
  assert.ok(out.includes('rel="noopener noreferrer"'));
});

test('the srcset of every image is checked, not just the src', () => {
  const out = sanitiseArchiveHtml('<img src="/ok.jpg" srcset="javascript:x 1x, /ok-2.jpg 2x">');
  assert.ok(!out.includes('javascript:'));
  assert.ok(out.includes('/ok-2.jpg'));
});

test('a plugin shortcode is removed rather than left as literal text', () => {
  // Rendered literally, `[vc_row]` appears mid-sentence in a clan history, which is exactly the
  // kind of thing that makes a reader stop trusting the page.
  assert.equal(stripShortcodes('<p>a</p>[vc_row][vc_column]b[/vc_column][/vc_row]'), '<p>a</p>b');
  assert.equal(stripShortcodes('[caption id="x"]A photo[/caption]'), 'A photo');
});

test('the full pipeline strips the builder and keeps the prose', () => {
  const wordpress =
    '<div class="elementor-section" style="padding:40px"><p style="margin:0">Real text</p>' +
    '[vc_row]<script>bad()</script><p>More</p></div>';
  const out = prepareArchiveHtml(wordpress);
  assert.ok(out.includes('Real text') && out.includes('More'));
  assert.ok(!out.includes('elementor') && !out.includes('style=') && !out.includes('script'));
});

test('an empty body yields an empty string rather than a stray wrapper', () => {
  assert.equal(prepareArchiveHtml(''), '');
  assert.equal(sanitiseArchiveHtml(''), '');
});

// ---------------------------------------------------------------------------
// Derived fields
// ---------------------------------------------------------------------------

test('a summary is plain text, and is cut at a word', () => {
  const summary = summarise('<p><strong>Ute-Okpu</strong> is an Ika-Igbo clan &amp; its roots are Nri.</p>');
  assert.equal(summary, 'Ute-Okpu is an Ika-Igbo clan & its roots are Nri.');
  const long = summarise(`<p>${'word '.repeat(100)}</p>`, 60);
  assert.ok(long.length <= 62, String(long.length));
  assert.ok(long.endsWith('…'));
  assert.ok(!long.includes('  '));
});

test('reading time is at least one minute, and grows with the text', () => {
  assert.equal(readingMinutes('<p>short</p>'), 1);
  assert.equal(readingMinutes(`<p>${'word '.repeat(400)}</p>`), 2);
  assert.equal(readingMinutes(''), 1);
});

test('a citation names the author, the title and the address', () => {
  const citation = citationFor({
    authorName: 'Idenze Ezeme',
    title: 'Ute-Okpu',
    publishedAt: '2026-09-29T17:57:53.000Z',
    url: 'https://ozikoro.com/ute-okpu/',
  });
  assert.ok(citation.includes('Idenze Ezeme'));
  assert.ok(citation.includes('Ute-Okpu'));
  assert.ok(citation.includes('2026'));
  assert.ok(citation.includes('https://ozikoro.com/ute-okpu/'));
});

test('a citation without an author falls back to the institution, not to "undefined"', () => {
  const citation = citationFor({ authorName: null, title: 'T', publishedAt: null, url: 'https://ozikoro.com/t/' });
  assert.ok(citation.startsWith('Ozikoro.'));
  assert.ok(!citation.includes('undefined'));
  assert.ok(!citation.includes('null'));
});

/*
 * Heading order.
 *
 * Measured on the live archive before this existed: 5 of 8 sampled article pages skipped a heading
 * level, because the migrated WordPress content uses <h4> for its authored section headings and the
 * page's own <h1> therefore runs straight to <h4>. These cases pin the rule that fixed it, including
 * the case the first version got wrong.
 */

test('a record whose headings all start at h4 is moved to h2', () => {
  assert.equal(
    normaliseHeadingLevels('<h4>One</h4><p>x</p><h4>Two</h4>'),
    '<h2>One</h2><p>x</p><h2>Two</h2>'
  );
});

/*
 * The rule the first implementation got wrong: it returned early whenever the shallowest heading was
 * h2 or deeper, on the reasoning that only a heading ABOVE h2 was a problem. A record of all-h4
 * headings still skips — depth in the source is not the question, the question is whether the
 * content's top level sits directly beneath the page title.
 */
test('depth in the source does not exempt a record from being normalised', () => {
  assert.equal(normaliseHeadingLevels('<h3>a</h3><h4>b</h4>'), '<h2>a</h2><h3>b</h3>');
  assert.equal(normaliseHeadingLevels('<h5>a</h5><h6>b</h6>'), '<h2>a</h2><h3>b</h3>');
});

test('a record already starting at h2 is left exactly as it is', () => {
  const html = '<h2>One</h2><p>x</p><h4>Two</h4>';
  assert.equal(normaliseHeadingLevels(html), html);
});

test("the author's relative structure survives the move", () => {
  // Three levels in, three levels out, same gaps.
  assert.equal(
    normaliseHeadingLevels('<h4>A</h4><h5>B</h5><h6>C</h6>'),
    '<h2>A</h2><h3>B</h3><h4>C</h4>'
  );
});

test('an h1 inside a record is treated as content, not as the page title', () => {
  assert.equal(normaliseHeadingLevels('<h1>One</h1>'), '<h2>One</h2>');
});

test('heading attributes are preserved', () => {
  assert.equal(
    normaliseHeadingLevels('<h4 class="x" id="y">T</h4>'),
    '<h2 class="x" id="y">T</h2>'
  );
});

test('a record with no headings is untouched', () => {
  const html = '<p>just text</p><p>more</p>';
  assert.equal(normaliseHeadingLevels(html), html);
  assert.equal(normaliseHeadingLevels(''), '');
});

test('the sanitiser normalises headings as part of preparing a record', () => {
  const out = prepareArchiveHtml('<h4>Section</h4><p>Body</p>');
  assert.ok(out.includes('<h2>Section</h2>'), `expected an h2, got: ${out}`);
  assert.ok(!out.includes('<h4>'), `an h4 survived: ${out}`);
});
