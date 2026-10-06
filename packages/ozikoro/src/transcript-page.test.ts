/**
 * THE TRANSCRIPT PAGE — `/podcast/<slug>/transcript/`.
 *
 * WHY THIS TEST READS THE REAL SCREEN
 *
 * `fillTranscript` fills the design's article frame by its own ids and classes and calls `fillArticle` for every
 * piece of the record's furniture. **A pattern that stops matching does not throw: it leaves the design's
 * demonstration text on the page, or leaves a panel whose links point at sections this page no longer carries,
 * and the page still answers 200.** That is the fault class this change exists to remove, so every assertion
 * below runs against `public/design/calm-comfort-construct/public/design/screens/article.html` as handed over.
 *
 * WHAT IS ASSERTED, AND WHY EACH ONE MATTERS
 *
 *   1. the design's chrome survives — masthead, reader nav, `.prose` — because the whole point of the page is
 *      that a reader who follows a designed button lands on a designed page;
 *   2. **the record's own furniture IS on the page** — the photograph and its rights line, the player, the
 *      reading toolbar and its dates, the entity row and the related histories. This is the owner's report and
 *      the whole of the change: *"it should be exactly like the articles, with images, voice record as it is in
 *      the article"*. The previous version of this file asserted the opposite, which is what shipped;
 *   3. **and it is the RECORD'S OWN and never the design's demonstration content** — the featured image's
 *      `src` is the record's media path and the design's own placeholder filename appears nowhere, on a record
 *      with an image or on one without;
 *   4. the two things that are the record's alone stay off this page — its references and its citation, which
 *      have no transcript counterpart and would be a second address for the record's own material;
 *   5. **every fragment link on the page resolves to an element the page carries**, which is the round-338
 *      fault (a `#listen` left pointing at a removed player) and the one a link inventory cannot see. It runs
 *      on the full fixture AND on each of the three empty states, because those are where the anchors move;
 *   6. the two destinations the brief requires are both present and are the design's own page-turn control;
 *   7. **the transcript's own first and last blocks survive byte for byte**, entity-decoding aside, which is
 *      what makes the page the same words as the `.txt` rather than a paraphrase of them;
 *   8. **a transcript with no image, no audio or no related record renders without inventing any of them** —
 *      no borrowed photograph, no inert player, no demonstration histories;
 *   9. the example-flag banner and the design's walkthrough wording are gone, since a real transcript page
 *      announcing itself as a demonstration is the page telling the reader not to believe it.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fillTranscript, type RealTranscript } from './transcript-page.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENS = join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'screens');
const ARTICLE = readFileSync(join(SCREENS, 'article.html'), 'utf8');

/** The design's own demonstration photograph, which must never reach a served transcript page. */
const DESIGN_PLACEHOLDER = 'Northcote_Thomas_Igbo_photograph_album_vol_3_string_games';

/**
 * A transcript with the three things that break a renderer: a curly apostrophe, an ampersand and an angle
 * bracket. **Not invented content** — these are the characters the real column holds, and a page that mangles
 * one of them is a page that has altered the record.
 */
const TEXT = [
  'Among the Igbo people, stories are not merely told; they are lived, breathed, and remembered.',
  '',
  'Moral: Greed & deceit bring downfall — “Onye ji anya <okwu> ga-ahụ ihe.”',
  '',
  '— Enugu, C. (2023). Folktales and Moral Wisdom in Igbo Oral Tradition. Igbo Folklore Archive.',
].join('\n');

/** The blocks the page must hold, as the `.txt` holds them: blank-line separated, nothing re-wrapped. */
const BLOCKS = TEXT.split(/\n{2,}/).map((b) => b.replace(/\n+$/, ''));

/**
 * One episode's transcript and the record's own furniture, as the route reads both.
 *
 * The values are the shape the route passes rather than a record's real bytes: **this file measures the fill,
 * not the archive**, and the record's own figures are measured on the served page (see the route and the
 * round's report) rather than fixed here where they would go stale.
 */
const ENTRY: RealTranscript = {
  title: 'How Tortoise Got His Bumpy Shell',
  recordPath: '/how-tortoise-got-his-bumpy-shell/',
  path: '/podcast/how-tortoise-got-his-bumpy-shell/transcript/',
  header: 'Transcript of the spoken record. The words are the article’s own.',
  text: TEXT,
  image: '/media/ozikoro/4478-0B5CB4B2-ED39-11EF-A336-0E8014B02109.jpg',
  imageAlt: 'How Tortoise Got His Bumpy Shell',
  caption: 'No licence recorded · reuse not granted',
  rights: 'No licence recorded · reuse not granted',
  published: '2026-02-11T00:00:00.000Z',
  updated: '2026-02-12T00:00:00.000Z',
  reference: 'OZ-H-0644',
  entities: [{ kind: 'town', slug: 'umunede', name: 'Umunede', role: 'place' }],
  related: [
    { title: 'Sacred Groves', href: '/sacred-groves-ihu-ala-protection-and-modern-threats/', topic: 'Folklores', image: '/media/ozikoro/a.jpg' },
    { title: 'Mother Kite and Daughter Kite', href: '/mother-kite-and-daughter-kite-a-lesson-about-strength-and-patience/', topic: 'Folklores', image: null },
  ],
  episode: {
    url: '/media/ozikoro/episodes/how-tortoise-got-his-bumpy-shell.mp3',
    directAudio: true,
    service: null,
    seconds: 144,
    narratorKind: 'synthetic_own_voice',
    narratorName: 'Idenze Ezeme (synthetic)',
    disclosure: 'This episode was generated using AI text-to-speech from a voice cloned from the author’s own recording, with his permission. The words are the article’s own.',
    transcript: TEXT,
  },
};

/** The same transcript on a record that has none of the three optional things. */
const BARE: RealTranscript = {
  ...ENTRY,
  image: null,
  imageAlt: 'How Tortoise Got His Bumpy Shell',
  caption: null,
  entities: [],
  related: [],
  episode: null,
};

/** The text of an element run, with the entities `esc` writes decoded back to their characters. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Every `<p>` inside the design's own `.prose` container, in order. */
function proseParagraphs(html: string): string[] {
  const open = html.indexOf('<div class="prose"');
  assert.ok(open !== -1, 'the design’s prose container is on the page');
  const start = html.indexOf('>', open) + 1;
  // The filled container holds paragraphs and nothing nested, so its first closing `</div>` is its own.
  const end = html.indexOf('</div>', start);
  const body = html.slice(start, end === -1 ? html.length : end);
  return [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => textOf(m[1] ?? ''));
}

/** Every fragment on the page must have an element carrying that id. Returns the ids it checked. */
function assertFragmentsResolve(html: string, what: string): string[] {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] ?? ''));
  const fragments = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1] ?? '');
  for (const fragment of fragments) {
    assert.ok(ids.has(fragment), `${what}: #${fragment} is linked but no element on this page carries it`);
  }
  assert.ok(fragments.length > 0, `${what}: the sidebar’s own contents links are on the page`);
  return fragments;
}

test('the transcript page is the design’s reading frame with the episode’s own words in it', () => {
  const out = fillTranscript(ARTICLE, ENTRY);

  // 1. The design's chrome, which is the whole reason the page exists.
  assert.match(out, /<header class="sx-reader-header">/);
  assert.match(out, /<nav aria-label="Reader navigation">/);
  assert.match(out, /<main id="article" data-reader>/);
  assert.match(out, /<article class="sx-book-reader">/);
  assert.match(out, /<div class="prose" id="transcript"/);

  // The h1 is the episode's title, not the design's "Nwagu Aneke".
  assert.match(out, /<div class="sx-article-title">[\s\S]*?<h1>How Tortoise Got His Bumpy Shell<\/h1>/);
  const body = out.slice(out.indexOf('<body'));
  assert.doesNotMatch(body, /Nwagu Aneke/);

  // 2. And it still says what it is: the eyebrow, and the header sentence under the title where an article
  //    carries its byline. No authorship of a transcript is claimed.
  assert.match(out, /<p class="eyebrow">Transcript<\/p>/);
  assert.match(out, /<p class="sx-article-byline">Transcript of the spoken record/);
  assert.doesNotMatch(out, /sx-article-byline">By <strong>/);
});

test('the record’s own photograph, player, toolbar, entity row and related reading ARE on this page', () => {
  const out = fillTranscript(ARTICLE, ENTRY);

  // The photograph, in the design's own figure, with the record's own address and alternative text.
  assert.match(out, /<figure class="sx-article-image">/);
  assert.match(out, /<figure class="sx-article-image">\s*<img src="\/media\/ozikoro\/4478-0B5CB4B2-ED39-11EF-A336-0E8014B02109\.jpg" alt="How Tortoise Got His Bumpy Shell"/);
  // The caption is the record's own rights state, never the design's "rights must be verified".
  assert.match(out, /<figcaption>No licence recorded · reuse not granted<\/figcaption>/);
  assert.doesNotMatch(out, /final article image and rights must be verified/);

  // The reading toolbar the figure carries: the record's own dates and the three controls.
  assert.match(out, /<div class="sx-article-utility">/);
  assert.match(out, /<dt>Published<\/dt><dd>11 February 2026<\/dd>/);
  assert.match(out, /<dt>Last updated<\/dt><dd>12 February 2026<\/dd>/);
  assert.match(out, /class="sx-print-action"/);

  // The player, and the record's own file inside it.
  assert.match(out, /<section class="sx-listen-panel" id="listen"/);
  assert.match(out, /<audio data-listen-audio preload="none" src="\/media\/ozikoro\/episodes\/how-tortoise-got-his-bumpy-shell\.mp3"><\/audio>/);
  assert.match(out, /data-listen-toggle/);
  // The disclosure and the narrator, which the article's panel carries and this one now does too.
  assert.match(out, /This episode was generated using AI text-to-speech/);
  assert.match(out, /Idenze Ezeme \(synthetic\)/);

  // The entity row, from the record's own links.
  assert.match(out, /<div class="chips sx-article-entities">/);
  assert.match(out, /<a class="chip chip-place" href="\/entities\/umunede\/"><span class="k">Place<\/span> Umunede<\/a>/);

  // The related histories, from the record's own topic.
  assert.match(out, /<section class="sx-related" id="related"/);
  assert.match(out, /<div class="sx-related-list">/);
  assert.match(out, /<a href="\/sacred-groves-ihu-ala-protection-and-modern-threats\/">/);
  assert.match(out, /<a href="\/mother-kite-and-daughter-kite-a-lesson-about-strength-and-patience\/">/);
  assert.doesNotMatch(out, /Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots<\/strong>/);
});

test('the panel’s own “Read the transcript” link, which on this page leads to this page, is gone', () => {
  const out = fillTranscript(ARTICLE, ENTRY);
  // The link `fillArticle` writes for the article page: `/podcast/<record>/transcript/`.
  assert.doesNotMatch(out, /href="\/podcast\/how-tortoise-got-his-bumpy-shell\/transcript\/"/);
  // The line it was written into keeps the narrator, who is a fact about the recording these words speak.
  const narratorParagraph = /<p class="small muted">([^<]*)<\/p>\s*<\/section>/.exec(out);
  assert.ok(narratorParagraph, 'the panel’s last line survives');
  assert.equal(narratorParagraph[1], 'Idenze Ezeme (synthetic)');
  // And the disclosure paragraph above it was not eaten by that removal.
  assert.match(out, /<p class="small muted">This episode was generated[\s\S]*?<\/p><p class="small muted">Idenze Ezeme/);
});

test('the record’s references and its citation are not on this page', () => {
  const out = fillTranscript(ARTICLE, ENTRY);
  assert.doesNotMatch(out, /id="sources"/, 'the record’s references are the record’s');
  assert.doesNotMatch(out, /id="citation"/, 'the citation the design draws is the record’s');
  assert.doesNotMatch(out, /Cite this article/);
  assert.doesNotMatch(out, /Read or listen →.*Udara/, 'the design’s demonstration related card is gone');
});

test('the image is the record’s own, and a record without one gets no photograph rather than a borrowed one', () => {
  const withImage = fillTranscript(ARTICLE, ENTRY);
  assert.match(withImage, /<figure class="sx-article-image">/);
  assert.doesNotMatch(withImage, new RegExp(DESIGN_PLACEHOLDER), 'the design’s placeholder photograph never survives');

  const bare = fillTranscript(ARTICLE, BARE);
  assert.doesNotMatch(bare, /sx-article-image/, 'a record with no featured image carries no figure');
  assert.doesNotMatch(bare, new RegExp(DESIGN_PLACEHOLDER));
  assert.doesNotMatch(bare, /<img[^>]*wp-content/, 'no photograph is borrowed from another record');
  // And the design's own toolbars, which live inside that figure, go with it — exactly as they do on the
  // record's own page, where a record with no image loses the toolbar too.
  assert.doesNotMatch(bare, /sx-article-utility/);
});

test('an episode with no playable audio gets no player, and the sidebar is not left pointing at one', () => {
  const out = fillTranscript(ARTICLE, BARE);
  assert.doesNotMatch(out, /sx-listen-panel/);
  assert.doesNotMatch(out, /data-listen-toggle/);
  assert.doesNotMatch(out, /data-listen-audio/);
  assert.doesNotMatch(out, /id="listen"/);
  // The sidebar’s own "Listen" link went with the panel rather than scrolling nowhere.
  assertFragmentsResolve(out, 'no audio');
  assert.doesNotMatch(out, /href="#listen"/);
  // The entity fallback is the archive’s own statement of the absence, not an empty row.
  assert.match(out, /The archive holds no clan, town or place recorded for this entry/);
});

test('a record with no related histories gets no related section and no link to one', () => {
  const out = fillTranscript(ARTICLE, BARE);
  assert.doesNotMatch(out, /class="sx-related"/);
  assert.doesNotMatch(out, /id="related"/);
  assert.ok(!/href="#related"/.test(out));
  assert.doesNotMatch(out, /Ute-Okpu: An Ika-Igbo Clan and Its Nri Roots/, 'the design’s demonstration histories are gone');
  assert.doesNotMatch(out, /Udara: A Fruit Caught Between/);
});

test('no fragment link survives that the page cannot resolve', () => {
  for (const [what, entry] of [['full', ENTRY], ['bare', BARE]] as const) {
    assertFragmentsResolve(fillTranscript(ARTICLE, entry), what);
  }
  const out = fillTranscript(ARTICLE, ENTRY);
  // The design's own chapter list is replaced, because four of its anchors are the record's and not this
  // page's; the panel that replaces it is the design's own markup.
  assert.doesNotMatch(out, /In this history/);
  assert.match(out, /<details open><summary>This transcript<\/summary>/);
  assert.match(out, /<details><summary>Reading tools<\/summary><nav><a href="#listen">Listen<\/a><a href="#related">Related reading<\/a><\/nav><\/details>/);
});

test('the two ways out are the design’s own page-turn control', () => {
  const out = fillTranscript(ARTICLE, ENTRY);
  const turn = /<nav class="sx-page-turn"[^>]*>[\s\S]*?<\/nav>/.exec(out);
  assert.ok(turn, 'the design’s page-turn control is on the page');
  const body = turn[0];
  assert.match(body, /<a href="\/how-tortoise-got-his-bumpy-shell\/">← The record<\/a>/);
  assert.match(body, /<span>End of transcript<\/span>/);
  assert.match(body, /<a href="\/listen\/">All recordings →<\/a>/);
  // And the aside's own list, which the reader meets before the foot of the page.
  assert.match(out, /<a href="\/how-tortoise-got-his-bumpy-shell\/">The record and its audio<\/a>/);
  assert.match(out, /<a href="\/listen\/">All recordings<\/a>/);
});

test('the transcript’s own first and last blocks are on the page byte for byte', () => {
  const out = fillTranscript(ARTICLE, ENTRY);
  const paragraphs = proseParagraphs(out);
  assert.equal(paragraphs.length, BLOCKS.length, 'one paragraph per blank-line-separated block');
  assert.equal(paragraphs[0], BLOCKS[0], 'the first block is unchanged');
  assert.equal(paragraphs[paragraphs.length - 1], BLOCKS[BLOCKS.length - 1], 'the last block is unchanged');
  // Everything in between too, so a "first and last only" pass cannot hide a mangled middle.
  assert.deepEqual(paragraphs, BLOCKS);
  // And the design's own opening treatment is doing its job on the first block, with the scroll offset the
  // record's own frame carries so the sidebar's link does not land it under the sticky header.
  assert.match(out, /<p id="opening" class="dropcap" style="scroll-margin-top:6rem">/);
});

test('nothing is added to the record’s words', () => {
  const out = fillTranscript(ARTICLE, ENTRY);
  const prose = proseParagraphs(out).join('\n\n');
  assert.equal(prose, TEXT, 'the prose is the transcript and nothing else');
  // No speaker, timestamp or language is invented anywhere on the page.
  assert.doesNotMatch(out, /\d{1,2}:\d{2}/, 'no timestamp is written');
  assert.doesNotMatch(out, /Speaker\s*\d/i);
  assert.doesNotMatch(out, /Language:\s/i);
  // And the design's own walkthrough wording, banner included.
  assert.doesNotMatch(out, /example-flag/);
  assert.doesNotMatch(out, /Reading demonstration/);
});
