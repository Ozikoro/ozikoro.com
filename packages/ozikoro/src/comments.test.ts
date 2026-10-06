/**
 * The comment box's own tests — the markup, the escape, and the two states.
 *
 * WHAT THESE CAN AND CANNOT PROVE
 *
 * They are pure rendering tests: no database, no request, no session. **What they prove is that the served
 * markup is what the owner asked for** — the exact words on the tick box, both signed-out buttons pointing at
 * the routes that really exist, a real `<form>` with a real `action`, and an example that says it is one. What
 * they cannot prove is that a POST writes a row; that is proved against the running site, and the report says
 * which proof is which.
 *
 * ⚠️ **THE ESCAPE TEST IS THE ONE THAT MATTERS MOST.** A comment body is a stranger's text and it is rendered
 * into a page by string concatenation. A `<script>` in a comment that reached a reader would be the worst
 * thing this feature could ship, so the escape is tested with the payloads that would do it rather than with a
 * polite ampersand.
 */
import { strict as assert } from 'node:assert';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import {
  COMMENT_MAX_LENGTH,
  DISCUSSION_SCREEN_NAMES,
  discussionScreenPath,
  insertDiscussion,
  renderDiscussion,
  SECTION_DISCUSSION_PATHS,
  type Comment,
  type DiscussionView,
} from './comments.ts';

/** One real comment, as the store would return it. */
function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    path: '/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/',
    articleId: 42,
    accountId: 7,
    author: 'Ada Nwosu',
    body: 'The Nri connection is also recorded in the 1931 intelligence report.',
    isSourceOrCorrection: true,
    state: 'approved',
    createdAt: '2026-10-07T09:15:00.000Z',
    moderatedAt: null,
    ...over,
  };
}

/** A view with the two required halves named, so a test states only what it is about. */
function view(over: Partial<DiscussionView> = {}): DiscussionView {
  return {
    path: '/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/',
    viewer: { signedIn: false, name: null, canModerate: false },
    comments: [],
    ...over,
  };
}

test('signed out, the box says exactly what the owner asked for and offers both real doors', () => {
  const html = renderDiscussion(view());

  assert.match(html, /Sign in to join the discussion/);
  // The two real routes. `/signin` and `/join` are the same account screen in its two modes.
  assert.match(html, /<a class="btn btn-gold" href="\/signin\?next=/);
  assert.match(html, /<a class="btn" href="\/join">Create an account<\/a>/);
  // And no form at all: a signed-out reader must not be offered a box that cannot post.
  assert.ok(!html.includes('<form'), 'a signed-out reader was given a form');
  assert.ok(!html.includes('<textarea'), 'a signed-out reader was given a textarea');
});

test('signed in, the box is a real form with the owner\'s exact tick box label and a Post comment button', () => {
  const html = renderDiscussion(
    view({ viewer: { signedIn: true, name: 'Ada Nwosu', canModerate: false } })
  );

  assert.match(html, /<form class="oz-comment-form" method="post" action="\/api\/comments">/);
  assert.match(html, /<textarea[^>]*name="body"[^>]*>/);
  assert.match(html, /name="sourceOrCorrection"/);
  // EXACTLY his words, and this is the assertion that would fail if somebody paraphrased them.
  assert.match(html, /<span>This includes a source or correction<\/span>/);
  assert.match(html, /<button class="btn btn-gold" type="submit">Post comment<\/button>/);
  // The page's own address travels with the form, escaped for an attribute.
  assert.match(html, /name="path" value="\/ute-okpu-an-ika-igbo-clan-and-its-nri-roots\/"/);
});

test('a comment body cannot escape into the page', () => {
  const html = renderDiscussion(
    view({
      comments: [
        comment({
          body: '<script>alert(1)</script> & "quoted" <img src=x onerror=alert(2)>',
        }),
      ],
    })
  );

  assert.ok(!html.includes('<script>alert(1)</script>'), 'a comment executed as markup');
  assert.ok(!html.includes('onerror=alert(2)>'), 'an attribute in a comment reached the page');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // The apostrophe and the ampersand are escaped too, so an attribute cannot be broken out of either.
  assert.match(html, /&amp; &quot;quoted&quot;/);
});

test('a comment with no display name is "A member" and never an email address', () => {
  const html = renderDiscussion(view({ comments: [comment({ author: 'A member' })] }));
  assert.match(html, /<strong>A member<\/strong>/);
  assert.ok(!html.includes('@'), 'an email address reached the comment list');
});

test('the reader\'s own comment awaiting review is labelled, and a rejected one is not drawn', () => {
  const html = renderDiscussion(
    view({
      viewer: { signedIn: true, name: 'Ada Nwosu', canModerate: false },
      comments: [
        comment({ id: 1, state: 'approved' }),
        comment({ id: 2, state: 'pending', body: 'One more source for this.' }),
        comment({ id: 3, state: 'rejected', body: 'This must not be drawn.' }),
      ],
    })
  );

  assert.match(html, /Pending review/);
  assert.match(html, /Only you and the editors can see this/);
  assert.ok(!html.includes('This must not be drawn'), 'a rejected comment was rendered');
});

test('no comment approved yet shows the honest empty state, not an invented one', () => {
  const html = renderDiscussion(view({ kindLabel: 'this folktale' }));
  assert.match(html, /No comments yet/);
  assert.match(html, /Nothing has been approved on this folktale yet/);
  // ⚠️ THE OWNER'S RULE: examples are never on a live page, so no example block is here.
  assert.ok(!html.includes('Design examples'), 'the design examples were drawn without being asked for');
});

test('the two design shapes are drawn only when asked for, and every line says it is an example', () => {
  const html = renderDiscussion(view({ examples: true }));

  assert.match(html, /Design examples — not comments anybody wrote, and shown on no public page/);
  assert.match(html, /Approved — shown to every reader/);
  assert.match(html, /Pending review — not on the page for anyone else/);
  // No name of any kind, invented or borrowed: an example claims no author.
  assert.ok(!/<strong>/.test(html), 'an example block named an author');
});

test('the box is inside the design\'s own .wrap, which is what gives it the page\'s container', () => {
  /*
   * ⚠️ THIS IS A MEASURED CORRECTION, NOT A PREFERENCE. The first version put the section directly inside
   * `<main>`; the served phone screenshot then showed every line of it against the glass, running the full
   * width of the screen, because `.wrap` is what carries `max-width: var(--container)` and
   * `padding-inline: var(--s-5)` on every other section of these pages.
   */
  const html = renderDiscussion(view());
  assert.match(html, /<section class="oz-discussion"[^>]*>\s*<div class="wrap">/);
  assert.match(html, /<div class="oz-discussion-inner">/);
});

test('the box is inside the page\'s own main element, at the last one', () => {
  const placed = insertDiscussion('<body><main>text</main><footer>f</footer></body>', '<section>BOX</section>');
  assert.equal(placed, '<body><main>text<section>BOX</section>\n</main><footer>f</footer></body>');
});

test('a document with no main element is returned unchanged rather than grown a stray section', () => {
  const html = '<body><div>no main here</div></body>';
  assert.equal(insertDiscussion(html, '<section>BOX</section>'), html);
  // And an empty block is a no-op whatever the document is.
  assert.equal(insertDiscussion('<body><main>x</main></body>', ''), '<body><main>x</main></body>');
});

test('the three section pages the owner named are the three the archive opens for discussion', () => {
  assert.deepEqual([...SECTION_DISCUSSION_PATHS], ['/watch/', '/projects/', '/cultural-calendar/']);
});

test('EXACTLY THREE of the deliverable\'s own screens are discussion pages, and they are named', () => {
  /*
   * ⚠️ **THIS IS THE TEST THAT PROTECTS THE INVIOLABLE DIRECTORY.**
   *
   * `withDiscussion` runs on every design screen and the 65-file deliverable under `public/design/` is
   * byte-compared against the handover copy. So the question "does this screen carry a discussion?" must be
   * answerable mechanically rather than by reading a comment — **if somebody adds a fourth name to the map,
   * this test fails before the screen changes.**
   *
   * The screen names are read from the deliverable itself rather than typed here, because a list typed into a
   * test is a second copy of the directory and would drift from it.
   */
  const screensDir = new URL('../../../apps/ozikoro/public/design/screens/', import.meta.url);
  const names = readdirSync(screensDir)
    .filter((file) => file.endsWith('.html'))
    .map((file) => file.replace(/\.html$/, ''))
    .sort();

  assert.ok(names.length >= 50, `expected the deliverable's screens, found ${names.length}`);

  const discussing = names.filter((name) => discussionScreenPath(name) !== null);
  assert.deepEqual(discussing, ['cultural-calendar', 'projects', 'watch']);
  assert.deepEqual([...DISCUSSION_SCREEN_NAMES].sort(), ['cultural-calendar', 'projects', 'watch']);

  /*
   * And every other screen answers `null`, which is the value a caller must return its document unchanged
   * for. Named here individually as well, because these are the ones a reader would most expect to be
   * caught out: `article` is the reading screen the record route fills, `watch-video`/`project`/
   * `cultural-event` are the per-record screens of the three section pages, and `publication` is the design's
   * own publication screen.
   */
  for (const name of [
    'about', 'article', 'home', 'donate', 'towns', 'account', 'folios', 'publication', 'publications',
    'watch-video', 'project', 'cultural-event', 'folklore', 'folklore-reader', 'dashboard-moderation',
  ]) {
    assert.equal(discussionScreenPath(name), null, `${name} was treated as a discussion page`);
  }
  // A name that is not a design screen at all, and the empty string, are refusals rather than accidents.
  assert.equal(discussionScreenPath('nonsense'), null);
  assert.equal(discussionScreenPath(''), null);
  // `hasOwnProperty` rather than a truthy lookup: a screen named after an Object prototype member must not
  // pass. `toString` is the classic version of that mistake.
  assert.equal(discussionScreenPath('toString'), null);
  assert.equal(discussionScreenPath('constructor'), null);
});

test('the length the form advertises is the length the store accepts', () => {
  assert.equal(COMMENT_MAX_LENGTH, 4000);
  const html = renderDiscussion(view({ viewer: { signedIn: true, name: 'Ada', canModerate: false } }));
  assert.match(html, new RegExp(`maxlength="${COMMENT_MAX_LENGTH}"`));
});
