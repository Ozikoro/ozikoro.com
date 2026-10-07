/**
 * The publication cache's addressing rule.
 *
 * WHY THIS IS TESTED AND NOT ASSUMED
 *
 * The cache has no table. **The key IS the index**, so a key that changes shape silently is a cache that
 * silently stops hitting — the archive would go on serving correct documents and go on re-rendering every
 * one of them, and nothing in the site would look wrong. The same silence has the opposite failure: a key
 * that stops depending on the record's revision serves yesterday's PDF with a year-long `immutable` header
 * on it.
 *
 * So the three properties that matter are asserted here, and the first one is asserted against a **fixed
 * digest** rather than a re-computation. A re-computed digest would agree with whatever the function does;
 * this one fails the moment the hash's input changes, which is the moment a cached file would go stale.
 *
 * Run with: npm -w @ozikoro/site run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLICATION_KEY_PREFIX,
  PUBLICATION_RENDERER_VERSION,
  publicationCacheKey,
} from './publication-key.ts';
import { figureReferences } from './publication.ts';

const REVISION = '2025-05-07T00:00:00.000Z';

test('the key is a fixed, content-addressed name', () => {
  const key = publicationCacheKey({ id: 670, slug: 'aya-adesuwa-the-ubulu-uku-bini-war', revision: REVISION });
  assert.equal(key, `${PUBLICATION_KEY_PREFIX}670-c0986a8017d3.pdf`);
});

test('the key is stable for one record at one revision', () => {
  const input = { id: 12, slug: 'ute-okpu-an-ika-igbo-clan-and-its-nri-roots', revision: REVISION };
  assert.equal(publicationCacheKey(input), publicationCacheKey({ ...input }));
});

test('an edit to the record moves the key, so the edit reaches the page', () => {
  const base = { id: 12, slug: 'ute-okpu', revision: REVISION };
  assert.notEqual(
    publicationCacheKey(base),
    publicationCacheKey({ ...base, revision: '2025-05-08T00:00:00.000Z' })
  );
});

test('a renamed record moves the key', () => {
  const base = { id: 12, slug: 'ute-okpu', revision: REVISION };
  assert.notEqual(publicationCacheKey(base), publicationCacheKey({ ...base, slug: 'ute-okpu-renamed' }));
});

test('a Date and its ISO string address the same document', () => {
  const base = { id: 12, slug: 'ute-okpu' };
  assert.equal(publicationCacheKey({ ...base, revision: new Date(REVISION) }), publicationCacheKey({ ...base, revision: REVISION }));
});

test('a record with no revision still gets a key rather than an error', () => {
  const key = publicationCacheKey({ id: 12, slug: 'ute-okpu', revision: null });
  assert.match(key, /^ozikoro\/publications\/12-[0-9a-f]{12}\.pdf$/);
  assert.notEqual(key, publicationCacheKey({ id: 12, slug: 'ute-okpu', revision: REVISION }));
});

test('the key names the renderer, so a layout change is a new document', () => {
  const key = publicationCacheKey({ id: 1, slug: 'a', revision: REVISION });
  assert.match(key, /^ozikoro\/publications\/1-[0-9a-f]{12}\.pdf$/);
  // The version is part of the hash's input, so a different version is a different digest. The value is
  // asserted here so that bumping it is a deliberate edit to a test as well as to the constant.
  //
  // `magazine-2` because `publication.ts` began reading figure bytes through `getStorage()`: the same record
  // renders a different document now — the one with its pictures in it — so every key has to move or the
  // old, pictureless file keeps being served under the new rule.
  assert.equal(PUBLICATION_RENDERER_VERSION, 'magazine-2');
});

/*
 * THE FIGURE COUNT, WHICH IS WHAT STOPS THE CACHE FREEZING A DOCUMENT WITH NO PICTURES.
 *
 * A render can still lose a figure — a WebP without `sips`, a key in neither the media root nor the object
 * store — and the route still returns a valid A4 document when it does. `publicationFor` refuses to store
 * such a render — see the long note there — and the decision turns entirely on this count. **It is counted from the record's markup, not from the render**,
 * because the render is the thing that is wrong: a block-count would report zero figures for a record with
 * twenty-four of them.
 */
test('figures are counted from the markup, and the unit is the figure', () => {
  assert.equal(figureReferences(''), 0);
  assert.equal(figureReferences('<p>no pictures here</p>'), 0);
  // A bare <img> has no caption and no measured size and the layout has never drawn one, so it is not a
  // figure — the two sides agree by construction rather than by accident.
  assert.equal(figureReferences('<p><img src="/media/ozikoro/1-a.jpg"></p>'), 0);
  assert.equal(figureReferences('<figure><img src="/media/ozikoro/1-a.jpg"><figcaption>A</figcaption></figure>'), 1);
  assert.equal(
    figureReferences(
      '<figure><img src="/media/ozikoro/1-a.jpg"></figure><p>x</p><figure><img src="/media/ozikoro/2-b.jpg"></figure>'
    ),
    2
  );
});
