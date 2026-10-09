/**
 * The discussion box, wired to the session — the app's half of the comment feature.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `comments.ts`
 *
 * `@ozikoro/platform` owns the store, the states, the validation and the markup, and it deliberately knows
 * nothing about cookies: `comments.ts` takes an `accountId` and a `DiscussionViewer` and never asks who is
 * calling. **Who is looking is the app's question** — the cookie, the session row and the capability check
 * all live here — and this is the same split the archive already uses for the Spotify connection and for the
 * library. It also means the store can be tested without a request.
 *
 * ── ONE HELPER, FIVE PLACES, AND THE SUBJECT IS ALWAYS THE PAGE'S OWN ADDRESS ───────────────────────
 *
 * The owner asked for the box on six kinds of page. **Only one of those placements is a React page**: the
 * record route returns a whole HTML document, the design screens do too, and the publication page is the
 * only one rendered by React. So the box is one HTML string and there are two ways in — `discussionHtml` to
 * get it, and `withDiscussion` to have it inserted into a document that is already built. A React component
 * would have been a second renderer of the same box, and the two would drift.
 *
 * ⚠️ **THE PATH IS THE PAGE'S, NOT THE BROWSER'S.** Every caller passes the address the archive itself
 * serves the page at: the record route builds `/<stored slug>/` from the row it just read, the publication
 * page passes `work.url`, and the design screens map their own screen name. Nothing is taken from the request
 * line, so a page cannot grow a discussion at an address the archive does not serve.
 */
import { getDb } from '@ozituma/db/client';
import {
  countApproved,
  discussionScreenPath,
  insertDiscussion,
  listComments,
  renderDiscussion,
  resolveSubject,
  type CommentSubject,
  type DiscussionViewer,
} from '@ozikoro/platform';
import { getCurrentAccount } from './session';
import { hasCapability } from './access';
import { insertAfterElementId } from './html-anchor.ts';

/**
 * The three design screens that are discussion pages, and the address each one is served at.
 *
 * ⚠️ **THE MAP LIVES IN `@ozikoro/platform` NOW, NOT HERE.** It was here first, and it was moved for one
 * reason: `withDiscussion` runs on all 53 design screens and the deliverable is inviolable, so the question
 * *"is this screen a discussion page?"* has to be answerable by a test rather than by reading this file. See
 * `discussionScreenPath` in `comments.ts` — `comments.test.ts` asserts over every screen name the
 * deliverable ships that exactly three of them answer yes.
 */
export { discussionScreenPath, DISCUSSION_SCREEN_NAMES } from '@ozikoro/platform';
/* The map's own names, re-exported so a reviewer can see the three without opening the platform module. */

/** The page's own word for itself, which the box's heading uses. */
const SCREEN_KINDS: Record<string, string> = {
  watch: 'the video library',
  projects: 'the projects page',
  'cultural-calendar': 'the cultural calendar',
};

/** What the app knows about the person asking, and what the box needs from it. */
async function viewerFor(path: string): Promise<{ viewer: DiscussionViewer; accountId: number | null }> {
  const current = await getCurrentAccount().catch(() => null);
  if (!current) {
    return { viewer: { signedIn: false, name: null, canModerate: false }, accountId: null };
  }
  /*
   * The moderation flag is asked of the database through the same capability the moderation screen and the
   * write path ask for, so the two cannot disagree about who may see the queue.
   */
  const canModerate = await hasCapability(current.account.id, 'moderate').catch(() => false);
  return {
    viewer: { signedIn: true, name: current.account.displayName, canModerate },
    accountId: current.account.id,
  };
}

/**
 * Whether the one viewer allowed to see the two design shapes asked for them.
 *
 * ⚠️ **THIS IS THE ONLY DOOR TO THE EXAMPLES, AND IT IS GATED TWICE.** The query flag names the request and
 * the `moderate` capability names the person; without both, `examples` is false and the reader gets real
 * comments or the honest empty state. The owner's instruction was *"Design examples — do not put them on live
 * pages"*, and this is what makes that true of a served page rather than merely intended.
 */
function wantsExamples(search: URLSearchParams | null, viewer: DiscussionViewer): boolean {
  return Boolean(viewer.canModerate && search && search.get('ozcommentstates') === '1');
}

/** The message a POST carried back in the address, as plain text. */
function noticeFrom(search: URLSearchParams | null): { kind: 'ok' | 'error'; text: string } | null {
  if (!search) return null;
  const error = (search.get('error') ?? '').trim();
  if (error) return { kind: 'error', text: error.slice(0, 300) };
  const done = (search.get('comment') ?? '').trim();
  if (done === 'awaiting') {
    return { kind: 'ok', text: 'Your comment is with an editor. It appears here once it has been checked.' };
  }
  return null;
}

/**
 * The box for one page, as HTML, or the empty string when the page is not one the archive discusses on.
 *
 * `subject` is passed rather than derived where the caller already knows it — the record route has just read
 * the row, and resolving the address a second time would be a second query and a second chance to disagree
 * with the page that was served.
 */
export async function discussionHtml(input: {
  path: string;
  subject?: CommentSubject;
  kindLabel?: string;
  search?: URLSearchParams | null;
}): Promise<string> {
  const db = await getDb();
  const subject = input.subject ?? (await resolveSubjectSafe(db, input.path));
  if (!subject) return '';

  const { viewer, accountId } = await viewerFor(input.path);
  const comments = await listComments(db, subject, accountId);

  return renderDiscussion({
    path: subject.path,
    ...(input.kindLabel ? { kindLabel: input.kindLabel } : {}),
    viewer,
    comments,
    notice: noticeFrom(input.search ?? null),
    examples: wantsExamples(input.search ?? null, viewer),
  });
}

/** `resolveSubject` with a refusal rather than a throw, for a page that is simply not discussable. */
async function resolveSubjectSafe(
  db: Awaited<ReturnType<typeof getDb>>,
  path: string
): Promise<CommentSubject | null> {
  try {
    return await resolveSubject(db, path);
  } catch {
    return null;
  }
}

/**
 * The same box, inserted into a document that is already built, **immediately after `Cite this article`**.
 *
 * ── THE OWNER'S REQUEST, AND THE MEASUREMENT THAT EXPLAINS IT ────────────────────────────────────────
 *
 * > *"comment section should be immediately after 'Cite this article' and be part of the article width, not
 * > be at the footer where it is now."*
 *
 * The box was never literally in the footer — `insertDiscussion` has always put it before the closing
 * `</main>`. **What the measurement showed is why it reads as the footer to him.** Measured on the review
 * server's own copy of this record (**20402 bytes**): `Cite this article` closed at byte 17398, the related
 * cards followed at 17416, the page-turn at 18721 — **and the box did not begin until 19248. Between the
 * citation and the box sat 1850 bytes of OTHER things**, so the thread was the last object on the page after
 * two blocks that are not the article.
 *
 * ── WHAT THE ANCHOR IS NOW, AND WHY IT IS NOT `lastIndexOf` ──────────────────────────────────────────
 *
 * The insertion point is the offset just after the `</section>` that closes the document's `id="citation"`
 * element — computed by walking that element's own tags (`insertAfterElementId` in `./html-anchor.ts`), not
 * searched for. **A `</section>` is not unique in a record page either**, and `</div>` is worse, so neither
 * is used as a needle.
 *
 * ⚠️ **THE FALLBACK IS THE OLD ANCHOR, AND IT IS THE REASON NO PAGE LOSES ITS BOX.** A document with no
 * `id="citation"` — which is every design screen that carries a discussion — falls through to
 * `insertDiscussion`, i.e. before the last `</main>`, which is byte-for-byte what those pages served before
 * this change. `withDiscussion` on all 53 design screens therefore behaves exactly as it did.
 */
export function insertDiscussionAfterCitation(html: string, block: string): string {
  if (!block) return html;
  const placed = insertAfterElementId(html, 'citation', block);
  return placed ?? insertDiscussion(html, block);
}

/**
 * The same box, inserted into a document that is already built.
 *
 * ⚠️ **A SCREEN THIS DOES NOT HANDLE IS RETURNED UNCHANGED, BYTE FOR BYTE.** The design deliverable is
 * inviolable and this runs on all 52 screens; the identity is asserted rather than asserted-in-a-comment.
 */
export async function withDiscussion(
  html: string,
  screen: string,
  search?: URLSearchParams | null
): Promise<string> {
  const path = discussionScreenPath(screen);
  if (!path) return html;

  const block = await discussionHtml({
    path,
    kindLabel: SCREEN_KINDS[screen] ?? 'this page',
    ...(search ? { search } : {}),
  });
  if (!block) return html;

  /*
   * The same anchor rule as the record page, so the two cannot diverge: after `Cite this article` when the
   * document has one, and before the closing `</main>` when it does not. Of the three design screens that
   * carry a discussion — `watch`, `projects`, `cultural-calendar` — none has a citation, so all three take
   * the fallback and serve exactly the markup they served before.
   */
  const out = insertDiscussionAfterCitation(html, block);
  if (out === html) {
    console.error(`[discussion] ${screen} has no </main>, so the discussion box was not inserted`);
  }
  return out;
}

/** How many approved comments a page holds, for a screen that wants to say so without rendering them. */
export async function approvedCommentCount(path: string): Promise<number> {
  const db = await getDb();
  const subject = await resolveSubjectSafe(db, path);
  if (!subject) return 0;
  return countApproved(db, subject);
}
