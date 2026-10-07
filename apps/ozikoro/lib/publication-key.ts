/**
 * THE ADDRESS ONE RECORD'S PUBLICATION IS CACHED AT — AND NOTHING ELSE.
 *
 * This file has no database, no storage and no layout in it, and that is the point: **the key rule is the
 * cache's whole index** (there is no table — see `publication-cache.ts` for why), so it is the one part
 * that must be provable without a cluster, a bucket or a browser. `publication-cache.test.ts` imports this
 * file, and `publication-cache.ts` imports it too, so the tested rule and the used rule cannot drift.
 *
 * A key must name one document and that document must never change, or a reader gets yesterday's file with
 * a year-long `immutable` header on it. So the digest is taken over **the record's slug, the record's
 * `updated_at` and the renderer's own version**:
 *
 *   * an edit to the record produces a different key, and the edit reaches the page;
 *   * a change to the layout produces a different key, because `PUBLICATION_RENDERER_VERSION` is bumped in
 *     the same commit as the layout change;
 *   * the same record at the same revision produces the same key, so the document is built once.
 *
 * ── `magazine-2`: FIGURES ARE FOUND IN THE OBJECT STORE, SO EACH DOCUMENT IS REBUILT ONCE ─────────────
 *
 * Bumped when `apps/ozikoro/lib/publication.ts` stopped reading figure bytes from the local filesystem and
 * started reading them through `getStorage()`. **The same record now renders a different document** — the
 * one with its pictures in it — so a key that did not move would keep serving a file produced by the old
 * rule. The bump costs one re-render per record, once, on the first click after this deploys, and nothing
 * is lost: a pictureless render was never stored (the guard in `publication-cache.ts` refuses it), so what
 * is invalidated is a *complete* render, which the new rule reproduces.
 */
import { createHash } from 'node:crypto';

/**
 * THE LAYOUT'S VERSION, AND THE ONE LINE A LAYOUT CHANGE MUST ALSO CHANGE.
 *
 * `packages/ozikoro/src/pdf/publication.ts` draws the owner's academic magazine. **Bump this string in the
 * same commit as any change to that drawing**, or every cached file keeps serving the old design and
 * nothing on the site looks wrong.
 */
export const PUBLICATION_RENDERER_VERSION = 'magazine-2';

/** The one directory cached publications live in. Mirrors `ozikoro/episodes/` for the spoken records. */
export const PUBLICATION_KEY_PREFIX = 'ozikoro/publications/';

/** How much of the digest is kept. 48 bits, which cannot collide over the archive's 1,051 records. */
const DIGEST_LENGTH = 12;

/** The key one record's publication is cached under. */
export function publicationCacheKey(input: {
  id: number;
  slug: string;
  revision: string | Date | null;
}): string {
  const revision = input.revision ? new Date(input.revision).toISOString() : 'never';
  const digest = createHash('sha256')
    .update(`${input.slug}|${revision}|${PUBLICATION_RENDERER_VERSION}`)
    .digest('hex')
    .slice(0, DIGEST_LENGTH);
  return `${PUBLICATION_KEY_PREFIX}${input.id}-${digest}.pdf`;
}
