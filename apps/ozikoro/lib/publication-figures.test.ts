/**
 * THE FIGURES THAT ARE ONLY IN THE OBJECT STORE — the container's case, as a test.
 *
 * WHY THIS TEST EXISTS
 *
 * `apps/ozikoro/lib/publication.ts` read figure bytes with `existsSync`/`readFileSync` against the local media
 * root, and in production that root does not exist at all: `.dockerignore` excludes `data/media`, the image
 * copies no `.data`, and the service mounts no volume for it. So every lookup answered `null`, every figure
 * was dropped, and `/<slug>/pdf` served a valid, typeset document with its photographs missing — while
 * `x-ozikoro-publication` said `built` on every request, because `publication-cache.ts` refuses to keep a
 * render that lost a figure.
 *
 * **A missing figure and a record that has no figure render the same page, so nothing on the site could show
 * this.** That is exactly the shape of fault a unit test has to carry, and it is why the three assertions
 * below are about the *number of drops* rather than about the PDF looking plausible.
 *
 * The two shapes of reference production can hold are both covered, because they resolve by different layers:
 * a served path (`/media/ozikoro/<id>-<file>`) and the old site's address, which needs the archive's own URL
 * map.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setStorageForTest, resetStorage, type Storage, type StoredObjectBody } from '@ozituma/db/storage';
import { toBlocks } from './publication.ts';

/*
 * A REAL PNG, SO `decodePng` IS EXERCISED RATHER THAN STUBBED.
 *
 * The brand icon is read from the repository rather than a byte string typed into the test: a hand-made
 * header would pass `isPng` and then fail the decoder, and the assertion would be measuring the fixture.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ICON = readFileSync(join(HERE, '..', '..', '..', 'packages', 'ozikoro', 'assets', 'official', 'ozikoro-icon-yellow.png'));

/** A driver that answers for chosen keys and nothing else, and records what it was asked for. */
function fakeStorage(held: Record<string, Buffer>): Storage & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    driver: 's3',
    async put() {
      throw new Error('not used');
    },
    async get(key: string): Promise<StoredObjectBody | null> {
      asked.push(key);
      const body = held[key];
      return body ? { body, contentType: 'image/png' } : null;
    },
    async head() {
      return null;
    },
    async remove() {
      /* not used */
    },
    publicUrl(key: string) {
      return `/media/${key}`;
    },
  };
}

const FIGURE = (src: string) => `<figure><img src="${src}" alt="" /><figcaption>An animal</figcaption></figure>`;

test('a figure that is in the object store is placed, and one that is nowhere is a counted drop', async () => {
  const objectKey = 'ozikoro/999999-a-figure-that-is-not-on-this-disk.png';
  const storage = fakeStorage({ [objectKey]: ICON });
  setStorageForTest(storage);

  const drops: string[] = [];
  const blocks = await toBlocks(
    FIGURE('/media/ozikoro/999999-a-figure-that-is-not-on-this-disk.png'),
    (reference) => drops.push(reference),
    null
  );

  assert.equal(drops.length, 0, 'the figure was in storage, so nothing should have been dropped');
  assert.equal(blocks.length, 1, 'the figure should have become one image block');
  assert.equal(blocks[0]!.kind, 'image');
  assert.deepEqual(storage.asked, [objectKey], 'the key asked for should be the archive key, not a path');

  // And the same reference with an empty store: served, still not cached by the caller.
  setStorageForTest(fakeStorage({}));
  const dropped: string[] = [];
  const none = await toBlocks(
    FIGURE('/media/ozikoro/999999-a-figure-that-is-not-on-this-disk.png'),
    (reference) => dropped.push(reference),
    null
  );
  assert.equal(none.length, 0);
  assert.equal(dropped.length, 1, 'a figure in neither place must be reported as a drop');
});

test("a body quoting the old site's address resolves through the archive's own URL map", async () => {
  const objectKey = 'ozikoro/999998-proof-figure.png';
  const storage = fakeStorage({ [objectKey]: ICON });
  setStorageForTest(storage);

  /*
   * The map is the one `mediaUrlResolver` builds from `ozikoro_media`, keyed on the old site's address. **The
   * local media directory is never consulted for this key**, because the name in the map is not the name in
   * the URL — which is the whole reason a directory listing could not answer it.
   */
  const resolve = (url: string) =>
    url === 'https://ozikoro.com/wp-content/uploads/2026/09/proof-figure.png' ? `/media/${objectKey}` : null;

  const drops: string[] = [];
  const blocks = await toBlocks(
    FIGURE('https://ozikoro.com/wp-content/uploads/2026/09/proof-figure.png'),
    (reference) => drops.push(reference),
    resolve
  );

  assert.equal(drops.length, 0);
  assert.equal(blocks.length, 1);
  assert.deepEqual(storage.asked, [objectKey]);

  resetStorage();
});

test('a reference with no last path segment is still a drop rather than a guess', async () => {
  setStorageForTest(fakeStorage({}));
  const dropped: string[] = [];
  const blocks = await toBlocks('<figure><img src="/media/" alt="" /></figure>', (r) => dropped.push(r), null);
  assert.equal(blocks.length, 0);
  assert.equal(dropped.length, 1);
  resetStorage();
});
