/**
 * Which storage keys `/media/<key>` will address.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT
 *
 * The pattern is a **census of the archive** written by hand, and it has been wrong twice — both times in
 * the direction that matters least visibly. A key the pattern refuses is a 404 on a file that is present,
 * catalogued and correctly named, and the bucket cannot fix it: the bytes can be there and the page still
 * shows an empty box. The two faults were found by fetching real keys, one at a time, because **a regex
 * nobody executes looks correct**.
 *
 * So the cases below are not invented. Each one is a real filename out of the 3,443 keys in `ozikoro_media`,
 * and the three that were refused before this module existed are marked.
 *
 * WHAT IT ALSO ASSERTS, WHICH MATTERS MORE THAN THE CHARACTERS
 *
 * That the traversal guard still holds. Widening a character class is safe; admitting a path separator is
 * not, and the two live one line apart in the same regex. If a later change admits `/`, `..`, an absolute
 * path or a backslash, the last block here fails loudly rather than in a browser.
 *
 * Run with: node --test src/media-key.test.ts   (or: npm -w @ozikoro/platform run test)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPISODE_KEY_PATTERN, MEDIA_KEY_PATTERN, isAddressableMediaKey } from './media-key.ts';

test('the ordinary image keys are addressed', () => {
  for (const key of [
    'ozikoro/10076-Igbo_Cultural_Masquerades_-_008.jpg',
    'ozikoro/713-Ezemu.jpeg',
    'ozikoro/305-Ikoro-Drum-Amongst-the-Igbos-G.T-Basden-1921.webp',
    'ozikoro/11237-Igbo Folk Idioms in Caribbean Phrase.pdf',
    'ozikoro/10862-spade-_-tool_implement-_-British-Museum.html',
  ]) {
    assert.ok(isAddressableMediaKey(key), `refused: ${key}`);
  }
});

test('the punctuation WordPress leaves in a name is admitted, because real files carry it', () => {
  // Parentheses, brackets, a comma, an apostrophe and an ampersand all appear in keys this archive holds.
  for (const key of [
    'ozikoro/9274-osm-intl8aa250x200 (1).png',
    "ozikoro/8601-Ozizoro's Dance.jpg",
    'ozikoro/8611-Okwa [Osokwa], Awka.jpg',
    'ozikoro/8622-Ohafia & Abiriba.jpg',
    'ozikoro/8633-Ohafia (Ibe) + Nkporo.jpg',
  ]) {
    assert.ok(isAddressableMediaKey(key), `refused: ${key}`);
  }
});

test('REGRESSION: a retina variant whose name carries @2x is addressed', () => {
  /*
   * Seven real keys were refused by the class `[A-Za-z0-9._\- ()[\],'&+]`, which omitted `@`. WordPress
   * writes a retina variant as `name@2x`, so every one of them was in the table, on disk, and a 404.
   * `ozikoro/9274-osm-intl8aa250x200@2x.png` is one of the seven.
   */
  for (const key of [
    'ozikoro/9274-osm-intl8aa250x200@2x.png',
    'ozikoro/9278-osm-intl8aa250x200@2x-1.png',
    'ozikoro/9046-osm-intl13aa250x200@2x.png',
    'ozikoro/10415-1_bAWgKmiJ25nOkXCMF94nCg@2x.webp',
    'ozikoro/10391-aEzFzbNJEFaPX9ff_Artboard158@2x-100.jpg',
    'ozikoro/8054-1_X3GvmCmPEIR9Nn0d7PikVA@2x.jpg',
    'ozikoro/10324-aEzHPbNJEFaPX9fp_Artboard131@2x-100.jpg',
  ]) {
    assert.ok(isAddressableMediaKey(key), `refused: ${key}`);
  }
});

test('REGRESSION: a 212-character filename is addressed, and 255 is the cap', () => {
  /*
   * The cap was 180 and this real file name is 212 characters — a WordPress title truncated into a name.
   * The longest in the archive is asserted exactly, and the character after it is asserted to still be
   * refused, so the cap cannot drift upwards unnoticed.
   *
   * The cap counts the characters AFTER the `\d{1,8}-` attachment id, because that is the part the class
   * matches: 206 of the 212 belong to the name.
   */
  const longest =
    'ozikoro/10853-this-1935-photograph-captures-an-ulakwo-priest-alongside-george-thomas-basden-an-' +
    'ethnographer-and-missionary-the-image-offers-a-historical-glimpse-into-the-cultural-interactions-' +
    'between-european-mission.jpg';
  assert.equal(longest.length - 'ozikoro/'.length, 212);
  assert.equal(longest.length - 'ozikoro/10853-'.length, 206);
  assert.ok(MEDIA_KEY_PATTERN.test(longest), 'the longest real filename must be addressed');

  const id = 'ozikoro/10853-';
  assert.ok(MEDIA_KEY_PATTERN.test(`${id}${'a'.repeat(255)}`), '255 characters after the id is allowed');
  assert.ok(!MEDIA_KEY_PATTERN.test(`${id}${'a'.repeat(256)}`), '256 characters after the id must be refused');
});

test('the four spoken-record keys are addressed by the episode pattern and not the media one', () => {
  const episodes = [
    'ozikoro/episodes/how-tortoise-got-his-bumpy-shell.mp3',
    'ozikoro/episodes/igbo-folklore-twelve-timeless-tales-of-wisdom-wonder-and-moral-heritage.mp3',
    'ozikoro/episodes/ute-okpu-an-ika-igbo-clan-and-its-nri-roots.mp3',
    'ozikoro/episodes/ute-okpu-an-ika-igbo-clan-and-its-nri-roots.owner-recording.mp3',
  ];
  for (const key of episodes) {
    assert.ok(isAddressableMediaKey(key), `refused: ${key}`);
    assert.ok(EPISODE_KEY_PATTERN.test(key), `episode pattern refused: ${key}`);
    // The media pattern requires a numeric id prefix and forbids the slash, so it must NOT match.
    assert.ok(!MEDIA_KEY_PATTERN.test(key), `the media pattern must not admit an episode: ${key}`);
  }
});

test('THE TRAVERSAL GUARD: no separator, no dot-dot, no absolute path, ever', () => {
  for (const key of [
    'ozikoro/../ozikoro/10076-x.jpg',
    'ozikoro/10076-../../etc/passwd',
    'ozikoro/10076-a/b.jpg',
    'ozikoro/episodes/../../10076-x.jpg',
    'ozikoro/episodes/a/b.mp3',
    'ozikoro/episodes/..',
    'ozikoro/10076-a\\b.jpg',
    '/etc/passwd',
    '../etc/passwd',
    '/ozikoro/10076-x.jpg',
    'ozikoro/10076-x.jpg/../../y',
    'audio/ibo/corpus/deadbeef.mp3',
  ]) {
    assert.ok(!isAddressableMediaKey(key), `MUST be refused and was not: ${key}`);
  }
});
