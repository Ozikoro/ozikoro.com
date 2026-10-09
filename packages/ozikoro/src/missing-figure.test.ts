/**
 * Tests for the missing-figure treatment.
 *
 * The rule this module exists for is a NEGATIVE one — an `<img>` pointing where this archive holds nothing
 * must not reach a reader as a broken frame — so most of what follows asserts what the page must NOT contain,
 * and then asserts what it must contain instead, because "removed" on its own is the other wrong answer.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figureIsLoadable, nameUnheldFigures } from './missing-figure.ts';

const DEAD = 'https://ozikoro.com/wp-content/uploads/2025/05/Otamiri-River-showing-the-drainage-system.jpg';
const HELD = '/media/ozikoro/1541-Otamiri-River-showing-the-drainage-system.jpg';

test('a picture the archive does not hold is replaced by a statement, not deleted', () => {
  const body = `<p>The river ran west.</p><img src="${DEAD}" alt="The Otamiri at Owerri" style="max-width:100%;height:auto;"><p>It still does.</p>`;
  const out = nameUnheldFigures(body);

  assert.equal(out.includes('<img'), false, 'no <img> may survive: the policy would refuse it');
  assert.equal(out.includes(DEAD), true, 'the address is kept as the record of where the picture stood');
  assert.equal(out.includes('The archive does not hold this image'), true, 'it says so in the archive\'s own voice');
  assert.equal(out.includes('will not pretend to'), true, 'the documents page\'s sentence, reused');
  assert.equal(out.includes('Recorded description: The Otamiri at Owerri'), true, 'the body\'s own alt text is kept');
  assert.equal(out.includes('<figure class="unsourced">'), true, 'the design\'s existing class, so no stylesheet moves');
  assert.equal(out.includes('The river ran west.'), true, 'the sentence around it is untouched');
});

test('it never claims the file is gone, because that is not knowable for every caller', () => {
  const out = nameUnheldFigures(`<img src="https://example.org/a/photo.jpg" alt="A photograph">`);
  for (const forbidden of ['no longer exists', 'has been deleted', 'is gone', 'no longer available']) {
    assert.equal(out.includes(forbidden), false, `the plate must not assert "${forbidden}"`);
  }
  assert.equal(out.includes('does not hold the file'), true);
});

test('a picture this archive serves is left exactly as it is', () => {
  const tag = `<img src="${HELD}" alt="The Otamiri at Owerri" style="max-width:100%;height:auto;">`;
  assert.equal(nameUnheldFigures(tag), tag);
});

test('the absolute spelling of a served file is held too', () => {
  const tag = `<img src="https://ozikoro.com${HELD}" alt="x">`;
  assert.equal(nameUnheldFigures(tag), tag, 'a hand-written body may carry the absolute address');
});

test('an inline image is left alone: nothing about it can 404', () => {
  const tag = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="a pixel">';
  assert.equal(nameUnheldFigures(tag), tag);
});

test('the one off-site host the policy admits is left alone', () => {
  const tag = '<img src="https://i.ytimg.com/vi/abc/hqdefault.jpg" alt="a video still">';
  assert.equal(nameUnheldFigures(tag), tag, 'img-src admits i.ytimg.com, so this picture really loads');
});

test('an unheld srcset entry is dropped, so the picture cannot 404 on one screen only', () => {
  const tag = `<img src="${HELD}" srcset="${HELD.replace('.jpg', '-300x200.jpg')} 300w, ${DEAD} 1024w" alt="x">`;
  const out = nameUnheldFigures(tag);
  assert.equal(out.includes('<img'), true, 'the element is held and stays');
  assert.equal(out.includes(DEAD), false, 'the unheld variant is gone from the list');
  assert.equal(out.includes('-300x200.jpg'), true, 'the held variant is kept');
});

test('a srcset with nothing loadable in it is removed rather than left to 404', () => {
  const tag = `<img src="${HELD}" srcset="${DEAD} 1024w" alt="x">`;
  const out = nameUnheldFigures(tag);
  assert.equal(out.includes('srcset='), false);
  assert.equal(out.includes(`src="${HELD}"`), true);
});

test('a recording is plated as a whole element, so no stray closing tag is left behind', () => {
  const body = `<p>Listen.</p><video controls preload="metadata" src="${DEAD}"></video><p>Then read on.</p>`;
  const out = nameUnheldFigures(body);
  assert.equal(out.includes('<video'), false);
  assert.equal(out.includes('</video>'), false, 'the closing tag must go with the opening one');
  assert.equal(out.includes('The archive does not hold this recording'), true);
  assert.equal(out.includes('</figure>'), true);
});

test('a video whose own src is unheld but whose source is held stays, without the dead child', () => {
  const body = `<video controls src="${DEAD}"><source src="/media/ozikoro/2236-agbeji.mp4" type="video/mp4"></video>`;
  const out = nameUnheldFigures(body);
  assert.equal(out.includes('<video'), true);
  assert.equal(out.includes(DEAD), false, 'the unplayable child is dropped');
  assert.equal(out.includes('/media/ozikoro/2236-agbeji.mp4'), true, 'the playable one is kept');
});

test('an image with no address at all is named rather than left as an empty frame', () => {
  const out = nameUnheldFigures('<img alt="an unnamed photograph">');
  assert.equal(out.includes('<img'), false);
  assert.equal(out.includes('an unnamed file'), true);
});

test('the plate does not repeat the file name as the description', () => {
  const out = nameUnheldFigures('<img src="https://example.org/a/river.jpg" alt="river.jpg">');
  assert.equal(out.includes('Recorded description'), false, 'the same string twice is not a description');
});
