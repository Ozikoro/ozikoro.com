/**
 * What a media record is called.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT
 *
 * The fault it guards is silent in both directions. A heading taken from the stored title looks right on
 * any page whose title happens to be a title, and the owner found the other case by reading one record:
 * `/documents/opta/` said `opta` in its `h1`, its `<title>` and its structured data while its caption named
 * King Oputa. **Nothing 500s, nothing is missing, and no link is broken** — which is why the rule is
 * asserted here rather than left to the next reader of the page.
 *
 * THE CASES ARE THE ONES THE MEASUREMENT FOUND, not invented ones: 2,852 of the 3,488 migrated records hold
 * a caption, 1,742 hold a title that is only their file's name, 306 hold no title at all, and 636 hold no
 * caption or description — of which 508 reach the fallback. Each of those numbers has a case below.
 *
 * Run with: node --test src/media-name.test.ts   (or: npm -w @ozikoro/platform run test)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaName, MEDIA_KIND_LABEL } from './media.ts';

const base = {
  kind: 'image',
  slug: 'opta',
  storedTitle: null as string | null,
  caption: null as string | null,
  description: null as string | null,
  altText: null as string | null,
};

test('the caption names the record, and the file name in the title does not', () => {
  const named = mediaName({
    ...base,
    storedTitle: 'opta',
    caption: 'An illustration of King Oputa of “Aboh”, an Igbo settlement noted to be near the Oshimiri',
  });
  assert.equal(named.from, 'caption');
  assert.equal(named.name, 'An illustration of King Oputa of “Aboh”, an Igbo settlement noted to be near the Oshimiri');
});

test('a record with no caption is named by its description, then by its alternative text', () => {
  assert.deepEqual(
    mediaName({ ...base, description: 'Obi Umenede, photographed at his palace', storedTitle: 'umunede king' }),
    { name: 'Obi Umenede, photographed at his palace', from: 'description' }
  );
  assert.deepEqual(
    mediaName({ ...base, altText: 'A traditional African tribal mask', storedTitle: 'IMG_3344' }),
    { name: 'A traditional African tribal mask', from: 'alt' }
  );
});

test('a title a person could have written is used, even with no caption', () => {
  // The two documents this archive holds as PDFs, whose names are the files' own names and are also the
  // titles the record carries. Refusing them would put "Untitled" on a record that is plainly titled.
  for (const title of ['Igbo Folk Idioms In Caribbean Phrase', 'Introduction To Igbo Mythology For Kids Chinelo Anyadiegwu']) {
    assert.deepEqual(mediaName({ ...base, kind: 'document', storedTitle: title }), { name: title, from: 'title' });
  }
  assert.equal(mediaName({ ...base, storedTitle: 'nde aboh' }).from, 'title');
});

test('a title that is only the file name is reported as a fallback, not as a title', () => {
  const named = mediaName({ ...base, storedTitle: 'opta' });
  assert.equal(named.from, 'fallback');
  assert.equal(named.name, 'Untitled photograph — opta');

  // The shapes a browser or WordPress writes rather than a person.
  assert.equal(mediaName({ ...base, storedTitle: 'download (20)' }).from, 'fallback');
  assert.equal(mediaName({ ...base, storedTitle: 'images (13)' }).from, 'fallback');
  assert.equal(mediaName({ ...base, storedTitle: 'Screenshot 2025-05-17 at 11.32.51' }).from, 'fallback');
  assert.equal(mediaName({ ...base, storedTitle: 'Iguaro-Nri-Festival-768 432' }).from, 'fallback');
  assert.equal(mediaName({ ...base, storedTitle: '64b6dfc8d0d66d1e4a8d149a ota omu' }).from, 'fallback');
  assert.equal(mediaName({ ...base, kind: 'document', storedTitle: 'SAMTDO-7v1' }).name, 'Untitled document — SAMTDO-7v1');
  assert.equal(mediaName({ ...base, kind: 'video', storedTitle: 'hqdefault' }).name, 'Untitled film — hqdefault');
});

test('a record with no title at all falls back to the name it is addressed by, and says so', () => {
  assert.deepEqual(mediaName({ ...base, slug: 'media-3391' }), { name: 'Untitled photograph — media-3391', from: 'fallback' });
});

test('a one-word caption is the file name, and the record falls back with the note', () => {
  // Two of the archive's twelve documents carry their own file name in the caption field, and both cards
  // on `/documents/` printed it as a title.
  assert.deepEqual(mediaName({ ...base, kind: 'document', caption: 'SAMTDO-7v1', storedTitle: 'SAMTDO-7v1' }), {
    name: 'Untitled document — SAMTDO-7v1',
    from: 'fallback',
  });
  assert.equal(mediaName({ ...base, caption: 'capacity_building_for_traditional' }).from, 'fallback');
  // A caption with a space in it is prose however short, so the caption still wins.
  assert.deepEqual(mediaName({ ...base, caption: 'Ika People', storedTitle: 'Ika_People_of_Nigeria' }), {
    name: 'Ika People',
    from: 'caption',
  });
});

test('a citation in parentheses is prose and is not mistaken for a file name', () => {
  // 374 of the archive's captions run past 200 characters and some end with a bracketed year. A caption is
  // text the record published, so it is read whatever it looks like; the file-name test is for titles.
  const cited =
    'Mystical spirits like this giant, segmented specimen usually perform during burial ceremonies (1978)';
  assert.deepEqual(mediaName({ ...base, caption: cited, storedTitle: cited }), { name: cited, from: 'caption' });
});

test('every kind has a noun, because a fallback names one', () => {
  for (const kind of ['image', 'video', 'audio', 'document', 'dataset', 'other']) {
    assert.ok(MEDIA_KIND_LABEL[kind], `${kind} has no label`);
    assert.ok(mediaName({ ...base, kind }).name.startsWith(`Untitled ${MEDIA_KIND_LABEL[kind].toLowerCase()} — `));
  }
});
