/**
 * AUDIO HELD ELSEWHERE: the shape rules, the feed's decision, and what the reader is shown.
 *
 * WHY THESE RUN WITHOUT A DATABASE AND WITHOUT A NETWORK
 *
 * Every rule asserted here is one that decides what a reader sees or what the feed tells a subscriber, and
 * each is a pure function so it can be exercised on this machine **without spending a credit and without
 * touching the cluster**. The network half of the check lives in the route (a `Request` and a timeout belong
 * there) and the row half lives in `setEpisodeExternalAudio`; what is asserted here is the decision they both
 * depend on.
 *
 * THE ONE THAT MATTERS MOST IS THE PLAYER. A Spotify episode address is an HTML page. If it were written into
 * `<audio src="…">` the button would be pressed and answer with nothing — the dead-control fault this archive
 * has recorded four times — and if it were written into the feed's `<enclosure>` a subscriber's app would show
 * an unplayable item. Both are asserted against the design's REAL `article.html`, because the fault would be
 * in the relationship between the fill and that screen.
 *
 * Run with: npm -w @ozikoro/platform test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTERNAL_AUDIO_LABELS,
  externalAudioDisclosure,
  externalAudioShapeProblem,
  feedAudioChoice,
  isDirectAudioContentType,
  serviceFromUrl,
} from './external-audio.ts';
import { playableEpisodeSql } from './narration.ts';
import { fillArticle, type RealArticle } from './design-fill.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENS = join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'screens');
const ARTICLE = readFileSync(join(SCREENS, 'article.html'), 'utf8');

/* ------------------------------------------------------------------------------------------------ */
/* The condition every public surface composes                                                     */
/* ------------------------------------------------------------------------------------------------ */

test('the playable-episode condition requires the approval record, not only the status', () => {
  const sql = playableEpisodeSql();
  assert.match(sql, /status = 'published'/);
  assert.match(sql, /approved_at is not null/);
  assert.match(sql, /approved_by is not null/);
  // The alias is what the feed passes; a fragment that ignored it would produce invalid SQL there.
  assert.match(playableEpisodeSql('e'), /e\.status = 'published'/);
  assert.match(playableEpisodeSql('e'), /e\.approved_at is not null/);
  assert.doesNotMatch(playableEpisodeSql('e'), /[^.]\bstatus = 'published'/);
});

/* ------------------------------------------------------------------------------------------------ */
/* Which service an address belongs to, and when the pair is refused                                */
/* ------------------------------------------------------------------------------------------------ */

test('a Spotify episode address is recognised as Spotify', () => {
  assert.equal(serviceFromUrl('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk'), 'spotify');
  assert.equal(serviceFromUrl('https://spotify.link/abc'), 'spotify');
  assert.equal(serviceFromUrl('https://soundcloud.com/somebody/a-track'), null);
});

test('an unknown host cannot be recorded as a named service', () => {
  const problem = externalAudioShapeProblem('https://soundcloud.com/x/y', 'spotify');
  assert.ok(problem);
  assert.match(String(problem), /not on Spotify/);
});

test('a named service on the wrong host is refused, and says which host it is on', () => {
  const problem = externalAudioShapeProblem('https://podcasts.apple.com/gb/podcast/x/id1', 'spotify');
  assert.ok(problem);
  assert.match(String(problem), /Apple Podcasts/);
});

test('a non-https address is refused: a reader must not be sent somewhere downgradable', () => {
  const problem = externalAudioShapeProblem('http://open.spotify.com/episode/x', 'spotify');
  assert.ok(problem);
  assert.match(String(problem), /https/);
});

test('“another service” accepts any https host, and an unknown service value is refused', () => {
  assert.equal(externalAudioShapeProblem('https://example.org/audio.mp3', 'other'), null);
  assert.ok(externalAudioShapeProblem('https://example.org/audio.mp3', 'soundcloud'));
  assert.ok(externalAudioShapeProblem('   ', 'other'));
});

test('the service labels are the reader-facing names, not the column values', () => {
  assert.equal(EXTERNAL_AUDIO_LABELS.spotify, 'Spotify');
  assert.equal(EXTERNAL_AUDIO_LABELS.apple_podcasts, 'Apple Podcasts');
});

/* ------------------------------------------------------------------------------------------------ */
/* Is it a file, and what does the feed do with it                                                  */
/* ------------------------------------------------------------------------------------------------ */

test('a directly playable resource is audio, and a page is not', () => {
  assert.equal(isDirectAudioContentType('audio/mpeg'), true);
  assert.equal(isDirectAudioContentType('audio/mpeg; charset=binary'), true);
  assert.equal(isDirectAudioContentType('application/ogg'), true);
  assert.equal(isDirectAudioContentType('text/html; charset=utf-8'), false);
  // An octet-stream says nothing about what it is, and an enclosure whose type says nothing is one a client
  // may refuse — so it is deliberately not treated as audio.
  assert.equal(isDirectAudioContentType('application/octet-stream'), false);
  assert.equal(isDirectAudioContentType(null), false);
});

test('the feed uses a directly playable external file, and our own copy otherwise', () => {
  assert.deepEqual(
    feedAudioChoice({ external_url: 'https://cdn.example/a.mp3', external_direct_audio: true, external_service: 'other', storage_key: 'ozikoro/episodes/a.mp3' }),
    { kind: 'external', url: 'https://cdn.example/a.mp3' }
  );
  assert.deepEqual(
    feedAudioChoice({ external_url: 'https://open.spotify.com/episode/a', external_direct_audio: false, external_service: 'spotify', storage_key: 'ozikoro/episodes/a.mp3' }),
    { kind: 'ours', storageKey: 'ozikoro/episodes/a.mp3' }
  );
});

test('a Spotify page with no copy of ours is OMITTED from the feed, with the reason', () => {
  const choice = feedAudioChoice({
    external_url: 'https://open.spotify.com/episode/a',
    external_direct_audio: false,
    external_service: 'spotify',
    storage_key: null,
  });
  assert.equal(choice.kind, 'omitted');
  assert.match(choice.kind === 'omitted' ? choice.reason : '', /Spotify/);
  assert.match(choice.kind === 'omitted' ? choice.reason : '', /enclosure/);
});

test('an unchecked address is not treated as a file', () => {
  const choice = feedAudioChoice({ external_url: 'https://example.org/a', external_direct_audio: null, external_service: 'other', storage_key: null });
  assert.equal(choice.kind, 'omitted');
});

/* ------------------------------------------------------------------------------------------------ */
/* What the reader is told                                                                          */
/* ------------------------------------------------------------------------------------------------ */

test('the disclosure says the file is held elsewhere, and never that the words are ours', () => {
  const human = externalAudioDisclosure('human', 'spotify');
  assert.match(human, /Read by a person/);
  assert.match(human, /held on Spotify and is not stored by this archive/);
  assert.doesNotMatch(human, /words are the article’s own/);

  const synthetic = externalAudioDisclosure('synthetic_own_voice', 'spotify');
  assert.match(synthetic, /cloned from the author’s own recording/);
  assert.doesNotMatch(synthetic, /words are the article’s own/);
});

/* ------------------------------------------------------------------------------------------------ */
/* The served article: a player for a file, a named link for a page                                 */
/* ------------------------------------------------------------------------------------------------ */

function article(episode: RealArticle['episode'], body = '<p>Body.</p>'): string {
  return fillArticle(ARTICLE, {
    title: 'A record',
    topic: 'Historical Studies',
    author: 'Idenze Ezeme',
    published: '2026-10-01T00:00:00.000Z',
    updated: null,
    image: null,
    imageAlt: 'A record',
    caption: null,
    rights: 'No licence recorded · reuse not granted',
    body,
    path: '/a-record/',
    context: 'Context.',
    reference: 'OZ-H-0001',
    /*
     * THE HEAD'S OWN FIELDS, SO THE FIXTURE IS THE SHAPE THE ROUTE PASSES.
     *
     * `entities` is empty because this test is about the listen panel, and `archiveTotals` carries the
     * archive's real measurement at the time of writing. A fixture that omitted them would not compile,
     * and this file is where the article screen's own markup is asserted.
     */
    entities: [],
    archiveTotals: { published: 1051, withPeriod: 0, withSource: 0 },
    related: [],
    episode,
  });
}

const direct = {
  url: '/media/ozikoro/episodes/a-record.mp3',
  directAudio: true,
  service: null,
  seconds: 61,
  narratorKind: 'synthetic_own_voice',
  narratorName: 'Idenze Ezeme (synthetic)',
  disclosure: 'Generated using AI text-to-speech.',
  transcript: 'Words.',
};

const spotify = {
  url: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
  directAudio: false,
  service: 'spotify',
  seconds: null,
  narratorKind: 'human',
  narratorName: 'Idenze Ezeme',
  disclosure: 'Read by a person. The audio is held on Spotify and is not stored by this archive; the link opens there.',
  transcript: 'Words.',
};

test('a file this page can play becomes <audio data-listen-audio>', () => {
  const html = article(direct);
  assert.match(html, /<audio data-listen-audio[^>]*src="\/media\/ozikoro\/episodes\/a-record\.mp3"/);
  assert.match(html, /data-listen-toggle/);
  assert.doesNotMatch(html, /data-listen-external/);
});

test('a Spotify page becomes a named link, and NEVER an <audio src>', () => {
  const html = article(spotify);
  assert.doesNotMatch(html, /<audio[^>]*data-listen-audio/);
  assert.doesNotMatch(html, /<audio[^>]*open\.spotify\.com/);
  assert.match(html, /data-listen-external/);
  assert.match(html, /href="https:\/\/open\.spotify\.com\/episode\/4rOoJ6Egrf8K2IrywzwOMk"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  // The reader is told where they are being sent, in words.
  assert.match(html, /Listen on Spotify/);
  assert.match(html, /Audio held on Spotify — it opens there/);
});

test('the controls that would tune a file that is not here are removed', () => {
  const html = article(spotify);
  assert.doesNotMatch(html, /data-listen-speed/);
  assert.doesNotMatch(html, /<progress[^>]*data-listen-progress/);
  // The panel itself stays: it carries the disclosure and the transcript link.
  assert.match(html, /id="listen"/);
  assert.match(html, /Read the transcript/);
});

test('the design’s read-aloud script is kept out of a panel that is a link', () => {
  /*
   * MEASURED IN A REAL BROWSER, and this is why the assertion exists: with `data-listen-status` left in place
   * and no `[data-listen-toggle]` on the page, `design/reader.js` overwrote our sentence with *"Browser
   * narration is unavailable on this device."* — a panel describing a mechanism it does not offer.
   */
  const externalHtml = article(spotify);
  assert.doesNotMatch(externalHtml, /data-listen-status/);
  assert.match(externalHtml, /data-listen-external-status/);

  // The player page is untouched: `audio-listen.js` still drives that panel.
  const playerHtml = article(direct);
  assert.match(playerHtml, /data-listen-status/);
  assert.doesNotMatch(playerHtml, /data-listen-external-status/);
});

test('a record with no episode carries no listen panel at all', () => {
  const html = article(null);
  assert.doesNotMatch(html, /id="listen"/);
  /*
   * AND THE SIDEBAR'S OWN LINK TO IT GOES WITH THE PANEL, WHICH IS THE FAULT THIS ROUND IS FOR.
   *
   * The design's reading page draws the panel AND a `<a href="#listen">Listen</a>` in its "Reading tools"
   * list. The branch above removes the panel when the record has no approved episode, and until now it left
   * the link standing — so on **1,049 of the archive's 1,051 published records** the reader could press a nav
   * item and the page did not move. Measured on the served site: `/the-war-dance-festival-ila-oso-in-uzuakoli/`
   * carries no `id="listen"` and writes `/<slug>/#listen`; `/how-tortoise-got-his-bumpy-shell/`, which has an
   * approved episode, carries both.
   *
   * **The assertion is written as a pair on purpose** — see the test below. A removal on its own would pass
   * just as happily on a build that had deleted the nav item from every record, including the two whose
   * players work, which is the opposite fault and the one an unconditional removal would have introduced.
   */
  assert.doesNotMatch(html, /href="#listen"/, 'the nav must not link a section this page does not draw');
});

test('a record WITH an episode keeps both the panel and the nav item that points at it', () => {
  for (const episode of [direct, spotify]) {
    const html = article(episode);
    assert.match(html, /<section[^>]*\bid="listen"[^>]*>/, 'the panel the episode fills must be on the page');
    assert.match(html, /<a href="#listen">Listen<\/a>/, 'and the nav item that names it must still be there');
  }
});

test('the record’s own in-page targets keep their `name` AND get room above them', () => {
  /*
   * ── THE FOOTNOTE HALF OF THE SAME FAULT, ON THE ONE RECORD THAT HAS IT ──────────────────────────────
   *
   * `/beyond-wrestling-sport-in-pre-colonial-west-africa/` writes `<a href="#_ftn1" name="_ftnref1">[1]</a>`
   * in its text and `<a href="#_ftnref1" name="_ftn1">[1]</a>` at its foot: each anchor is the other's
   * destination, and the destination is a `name` attribute. The sanitiser's allowlist was dropping it — see the
   * test in `content.test.ts` for the dump-level evidence that no `id` was ever written.
   *
   * TWO THINGS ARE ASSERTED, AND THE SECOND IS THE ONE ROUND 352 TAUGHT.
   *
   *   1. the target survives into the served body, so `[1]` is a control that moves the reader;
   *   2. **it lands where the reader can see it.** `.sx-reader-header` is `position: sticky; top: 0`, so a
   *      fragment's target is scrolled to the very top of the viewport and sits underneath the header.
   *      Measured in Chrome with the `name` anchors restored by script: the target landed at `top = 0` under a
   *      53 px header, its whole 24 px box inside the covered band. `scroll-margin-top` is the property for it,
   *      exactly as `fillArticleProse` already does for the frame's own anchors.
   *
   * The offset goes only on the elements that are fragment targets: a body is a record's own words, and
   * nothing else in it is touched.
   */
  const html = article(null, '<p>x <a href="#_ftn1" name="_ftnref1">[1]</a></p>');
  // The address is still the design's own relative fragment here: `designScreenLinks` is the ROUTE's pass and
  // makes it `/<slug>/#_ftn1`, and `design-paths.test.ts` is where that half is asserted.
  assert.match(html, /<a href="#_ftn1" name="_ftnref1" style="scroll-margin-top:6rem">\[1\]<\/a>/,
    'the footnote target must survive, and must carry the offset that keeps it out from under the header');
  // Ordinary prose is left exactly as it was. (The frame's own anchors carry the same offset from
  // `fillArticleProse`, so the assertion is about the BODY's paragraph, not about the string's absence.)
  const plain = article(null, '<p>Just words.</p>');
  assert.match(plain, /<p>Just words\.<\/p>/, 'a paragraph that is not a fragment target is not touched');
});
