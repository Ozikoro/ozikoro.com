/**
 * ONE PUBLICATION, BUILT ONCE AND THEN HELD.
 *
 * ── THE FAULT THIS FILE ANSWERS ─────────────────────────────────────────────────────────────────────
 *
 * The owner chose "generated on demand when clicked", and the honest cost of that choice is the reader's
 * time: `/<slug>/pdf` re-rendered the whole document on **every** click, from the record's body, its
 * figures, its references, its fonts and its logo. That is paid again by every reader, forever, for a
 * document that cannot change unless the record changes.
 *
 * So the middle path is taken, and it is still "on demand" from the owner's side: **the first click builds
 * it, and the document is kept**. Every later reader is served the bytes.
 *
 * ── WHERE IT IS KEPT, AND WHY NOT AS A ROW IN `ozikoro_media` ───────────────────────────────────────
 *
 * The bytes go into the archive's own object storage — `getStorage()`, which is S3 (or any S3-compatible
 * service) in production and `.data/media` in development. **That is the same store the archive's media is
 * served from**, so a cached publication is held exactly the way every other file this site serves is held,
 * and it costs no new infrastructure, no new dependency and no new process.
 *
 * **A ROW IN `ozikoro_media` WAS CONSIDERED AND DELIBERATELY NOT WRITTEN.** The reasoning is a measurement,
 * not a preference: every surface that lists a `kind='document'` PDF — `/documents/` and the design screens'
 * document list — prints, in its own words, *"Demonstration file held by the archive, not an approved
 * publication."* **That sentence is false about an article this archive published**, and a cached
 * publication listed there would make the site say it. Those files are held by other work tonight
 * (`apps/ozikoro/app/documents/` and the media route are explicitly not this work's to edit), so the label
 * cannot be corrected from here; filing the rows under a different `kind` would instead shift the media
 * register's own counters for no reader benefit.
 *
 * The index that makes a lookup possible is therefore the key itself, and it needs no table:
 *
 *     ozikoro/publications/<record id>-<digest of the record's revision>.pdf
 *
 * `publication-key.ts` holds that rule and the test that proves it.
 *
 * **A SUPERSEDED OBJECT IS LEFT WHERE IT IS**, and that is a decision: nothing records the old key, the
 * files are a few hundred kilobytes, and a delete that runs on the request path is a way to lose a document
 * a reader is halfway through downloading. A bucket lifecycle rule is the right tool if the archive ever
 * wants them gone.
 *
 * ── AND A RENDER THAT IS MISSING ITS FIGURES IS NOT KEPT ────────────────────────────────────────────
 *
 * **The container had no media on its filesystem**, and that was measured rather than suspected:
 * `https://ozikoro.com/animal-totems-…/pdf` served **18 pages carrying 2 image objects** where this checkout
 * rendered **33 pages carrying 26** for the same record. Serving that was the state the site was in;
 * **keeping it would have made it permanent**, because the key is the record's revision. So an incomplete
 * render is served and not stored, the numbers are logged with a greppable prefix, and the cache simply did
 * not hit on a host that could not reach its own media. That is the honest outcome: a cache that never hits
 * is a missing optimisation, and a cache that freezes a document with twenty-four absent photographs is a
 * defect.
 *
 * **THE FAULT ITSELF IS FIXED** — `apps/ozikoro/lib/publication.ts` reads figure bytes through
 * `getStorage()` now, so the container finds its pictures in the bucket and a complete render is stored. **The
 * guard is kept exactly as it was**, and it is not vestigial: a figure is still dropped when the object is in
 * neither store (a WebP with no `sips` on the host is the measured case), and the whole point of this file is
 * that such a render is served and never kept. Deleting the guard because the common cause went away would
 * re-open the failure the moment a new cause appeared.
 *
 * ── AND IT CANNOT COST A READER THE DOCUMENT ────────────────────────────────────────────────────────
 *
 * A cache is an optimisation. Every storage call here is inside a `try`, and a store that is unreachable,
 * unconfigured or out of space **falls through to building the document and serving it** — the behaviour
 * this route had before the cache existed. A reader never sees a 500 because a cache missed.
 */
import { getDb } from '@ozituma/db/client';
import { getStorage } from '@ozituma/db/storage';
import { buildPublication } from './publication.ts';
import { publicationCacheKey } from './publication-key.ts';

export type PublicationLookup = {
  pdf: Buffer;
  title: string;
  pages: number | null;
  /** The storage key this document is held under. */
  key: string;
  /** `cache` when it was already stored, `built` when this request rendered it. */
  source: 'cache' | 'built';
};

/**
 * HOW MANY PAGES A CACHED DOCUMENT HAS, READ FROM THE DOCUMENT.
 *
 * A cache hit is not a render, so the builder's own page count is not available — and `?' in a report about
 * a document that is sitting right there is a worse answer than reading it. This is the page tree's own
 * `/Count`, which the writer emits as object 2:
 *
 *     2 0 obj << /Type /Pages /Count 14 /Kids [31 0 R 33 0 R …] >> endobj
 *
 * It is a **report**, not a validation: nothing in the serving path depends on it, so a shape this does not
 * recognise costs a `null` and nothing else. `/Count` is a decimal so `toString('latin1')` is exact.
 */
function pageCountOf(pdf: Buffer): number | null {
  const match = /\/Type\s*\/Pages\s*\/Count\s+(\d+)/.exec(pdf.subarray(0, 4096).toString('latin1'));
  if (!match) return null;
  const pages = Number(match[1]);
  return Number.isFinite(pages) && pages > 0 ? pages : null;
}

/**
 * Builds in flight, so two readers who click at the same moment render one document rather than two.
 *
 * The window is real: a cold cache plus a shared link is exactly when two requests arrive together. Keyed
 * by the storage key, so a record whose revision changed does not join a stale build. The entry is removed
 * when the build settles, in `finally`, so a failed build cannot poison the entry.
 */
const inFlight = new Map<string, Promise<PublicationLookup | null>>();

/**
 * The publication for one published record: from the store when it is there, built when it is not.
 *
 * Returns `null` for a record that is not published, which the route turns into a 404 — **the same
 * predicate `buildPublication` uses**, deliberately, so the cache cannot change which addresses answer.
 */
export async function publicationFor(slug: string): Promise<PublicationLookup | null> {
  const db = await getDb();
  const record = await db.one<{ id: number; title: string; updated_at: Date | null }>(
    `select id, title, updated_at
       from ozikoro_article
      where slug = $1 and status = 'published'`,
    [slug]
  );
  if (!record) return null;

  const key = publicationCacheKey({ id: Number(record.id), slug, revision: record.updated_at });
  const storage = getStorage();

  /*
   * THE CACHE READ. A store that is not configured, not reachable or holding a zero-byte object is a miss
   * rather than a failure, and the reason is logged so an operator can see a cache that never hits.
   */
  try {
    const held = await storage.get(key);
    if (held && held.body.length > 0) {
      return {
        pdf: held.body,
        title: record.title,
        pages: pageCountOf(held.body),
        key,
        source: 'cache',
      };
    }
  } catch (error) {
    console.error(`publication cache: could not read ${key}: ${String(error).slice(0, 200)}`);
  }

  const running = inFlight.get(key);
  if (running) return running;

  const work = (async (): Promise<PublicationLookup | null> => {
    const built = await buildPublication(slug);
    if (!built) return null;
    /*
     * ── A RENDER THAT IS MISSING ITS FIGURES IS SERVED AND NOT KEPT ──────────────────────────────────
     *
     * This is the one place the cache could make something worse rather than faster, and it is a
     * measurement rather than a precaution. **In production there is no media on the container's
     * filesystem** — `.dockerignore` excludes `data/media`, the image copies no `.data`, and the service
     * mounts no volume — so `imageOf` finds nothing and
     * `https://ozikoro.com/animal-totems-in-igbo-culture-…/pdf` serves **18 pages carrying 2 image
     * objects** where this checkout renders **33 pages carrying 26** for the same record. The document is
     * valid, A4, and beautifully set; twenty-four of its twenty-five photographs are simply absent, which
     * is the failure that looks like success.
     *
     * **Serving that is the state the site is already in. Storing it would make it permanent**: the key
     * is derived from the record's revision, so a pictureless render kept today would still be the file
     * served after the media was fixed, until somebody edited the record. So an incomplete render is
     * served and NOT stored, the numbers are logged with a greppable prefix, and the moment the figures
     * are reachable the next click stores the complete document.
     *
     * **AND NOTHING ABOUT A COMPLETE RENDER CHANGES.** The test is `dropped`, not the difference between
     * `referenced` and `placed`: the layout suppresses a body figure whose bytes are identical to the
     * featured image, deliberately, so `aya-adesuwa-the-ubulu-uku-bini-war` legitimately renders 2
     * references as 1 placed figure with 0 dropped. **A drop is a failure; a suppression is a decision.**
     */
    if (built.figures.dropped > 0) {
      console.warn(
        `publication cache: NOT storing ${key} — ${built.figures.dropped} of ` +
          `${built.figures.referenced} figure(s) the record references could not be read, so the document ` +
          'is missing a picture. It is served; keeping it would make the missing figure permanent. ' +
          'Check the media root and the storage configuration.'
      );
      return { pdf: built.pdf, title: built.title, pages: built.pages, key, source: 'built' };
    }
    try {
      await storage.put(key, built.pdf, 'application/pdf');
    } catch (error) {
      // The document is still served; only the keeping of it failed.
      console.error(`publication cache: could not store ${key}: ${String(error).slice(0, 200)}`);
    }
    return { pdf: built.pdf, title: built.title, pages: built.pages, key, source: 'built' };
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}
