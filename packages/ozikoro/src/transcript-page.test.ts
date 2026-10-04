/**
 * THE TRANSCRIPT PAGE — `/podcast/<slug>/transcript/`.
 *
 * WHY THIS TEST READS THE REAL SCREEN
 *
 * `fillTranscript` matches the design's article frame by its own ids and classes — `div.prose`, `aside`,
 * `nav.sx-page-turn`, `p.sx-article-byline`. **A pattern that stops matching does not throw: it leaves the
 * design's demonstration text on the page, or leaves a panel whose links point at sections this page no longer
 * carries, and the page still answers 200.** That is the fault class this change exists to remove, so every
 * assertion below runs against `public/design/screens/article.html` as handed over.
 *
 * WHAT IS ASSERTED, AND WHY EACH ONE MATTERS
 *
 *   1. the design's chrome survives — masthead, reader nav, `.prose` — because the whole point of the page is
 *      that a reader who follows a designed button lands on a designed page;
 *   2. the record's own furniture does not — the photograph, the player, the references, the citation and the
 *      related reading are the record's, at the record's address, and a second copy here would be two
 *      addresses for the same material;
 *   3. **every fragment link on the page resolves to an element the page carries**, which is the round-338
 *      fault (a `#listen` left pointing at a removed player) and the one a link inventory cannot see;
 *   4. the two destinations the brief requires are both present and are the design's own page-turn control;
 *   5. **the transcript's own first and last blocks survive byte for byte**, entity-decoding aside, which is
 *      what makes the page the same words as the `.txt` rather than a paraphrase of them;
 *   6. the example-flag banner and the design's walkthrough wording are gone, since a real transcript page
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

const ENTRY: RealTranscript = {
  title: 'How Tortoise Got His Bumpy Shell',
  recordPath: '/how-tortoise-got-his-bumpy-shell/',
  path: '/podcast/how-tortoise-got-his-bumpy-shell/transcript/',
  header: 'Transcript of the spoken record. The words are the article’s own.',
  text: TEXT,
};

/** The blocks the page must hold, as the `.txt` holds them: blank-line separated, nothing re-wrapped. */
const BLOCKS = TEXT.split(/\n{2,}/).map((b) => b.replace(/\n+$/, ''));

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

test('the transcript page is the design’s reading frame with the episode’s own words in it', () => {
  const out = fillTranscript(ARTICLE, ENTRY);

  // 1. The design's chrome, which is the whole reason the page exists.
  assert.match(out, /<header class="sx-reader-header">/);
  assert.match(out, /<nav aria-label="Reader navigation">/);
  assert.match(out, /<main id="article" data-reader>/);
  assert.match(out, /<article class="sx-book-reader">/);
  assert.match(out, /<div class="prose" id="transcript"/);

  // The h1 is the episode's title, not the design's "Nwagu Aneke". The design's `<head>` still carries the
  // walkthrough's title at this point — the route replaces it with `withSeoHead` — so the body is what is read.
  assert.match(out, /<div class="sx-article-title">[\s\S]*?<h1>How Tortoise Got His Bumpy Shell<\/h1>/);
  const body = out.slice(out.indexOf('<body'));
  assert.doesNotMatch(body, /Nwagu Aneke/);
  // The header sentence sits under the title; no byline is claimed for a transcript.
  assert.match(out, /<p class="sx-article-byline">Transcript of the spoken record/);
  assert.doesNotMatch(out, /sx-article-byline">By <strong>/);
  assert.match(out, /<p class="eyebrow">Transcript<\/p>/);
});

test('the record’s photograph, player, references, citation and related reading are not on this page', () => {
  const out = fillTranscript(ARTICLE, ENTRY);
  assert.doesNotMatch(out, /sx-article-image/, 'the record’s photograph belongs to the record');
  assert.doesNotMatch(out, /data-listen-toggle/, 'no second player is built here');
  assert.doesNotMatch(out, /data-listen-audio/);
  assert.doesNotMatch(out, /id="sources"/);
  assert.doesNotMatch(out, /id="citation"/);
  assert.doesNotMatch(out, /id="related"/);
  assert.doesNotMatch(out, /Cite this article/);
  // And the design's walkthrough wording, banner included.
  assert.doesNotMatch(out, /example-flag/);
  assert.doesNotMatch(out, /Reading demonstration/);
});

test('no fragment link survives that the page cannot resolve', () => {
  const out = fillTranscript(ARTICLE, ENTRY);
  const ids = new Set([...out.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] ?? ''));
  const fragments = [...out.matchAll(/href="#([^"]+)"/g)].map((m) => m[1] ?? '');
  for (const fragment of fragments) {
    assert.ok(ids.has(fragment), `#${fragment} is linked but no element on this page carries it`);
  }
  // The design's own chapter list and reading tools, whose four anchors were the risk.
  assert.doesNotMatch(out, /In this history/);
  assert.doesNotMatch(out, /Reading tools/);
  assert.match(out, /<details open><summary>This transcript<\/summary>/);
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
  // And the design's own opening treatment is doing its job on the first block.
  assert.match(out, /<p id="opening" class="dropcap">/);
});

test('nothing is added to the record’s words', () => {
  const out = fillTranscript(ARTICLE, ENTRY);
  const prose = proseParagraphs(out).join('\n\n');
  assert.equal(prose, TEXT, 'the prose is the transcript and nothing else');
  // No speaker, timestamp or language is invented anywhere on the page.
  assert.doesNotMatch(out, /\d{1,2}:\d{2}/, 'no timestamp is written');
  assert.doesNotMatch(out, /Speaker\s*\d/i);
  assert.doesNotMatch(out, /Language:\s/i);
});
