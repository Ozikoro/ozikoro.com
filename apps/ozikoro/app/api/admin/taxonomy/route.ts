/**
 * POST /api/admin/taxonomy — every write the Categories and Tags screens make.
 *
 * ── WHY ONE ENDPOINT FOR TWO SCREENS ───────────────────────────────────────────────────────────────
 *
 * The same reason `/api/admin/posts` is one for posts and pages: each action is "an editor filled in a
 * form and pressed a button", and two endpoints would be two places for the permission check and the
 * refusal wording to drift. **The capability check is the first thing that happens and nothing below
 * it runs without it** — a hidden button is not authorisation.
 *
 * ── WHAT THIS SCREEN WAS, AND WHAT THE OWNER ASKED FOR ─────────────────────────────────────────────
 *
 *   *"on the admin that shows categories … why can't one edit the categories like it is on wordpress?
 *    same as tags? i could edit the posts, even their permalinks, and even do quick edit, so i should
 *   be able to do same for categories and tags."*
 *
 * Both screens were read-only: a table and, on Categories, a paragraph saying in as many words that
 * adding, renaming and removing were "not offered here". Every action below is one WordPress offers on
 * `edit-tags.php`, and the two refusals (`delete` on a term something is filed under) are the ones
 * this archive's own rule requires rather than an omission — see the block comment in
 * `packages/ozikoro/src/archive.ts` above the taxonomy writes.
 *
 * ── WHY THE FORM BODY IS READ AFTER THE GUARD ──────────────────────────────────────────────────────
 *
 * `request.formData()` throws a `TypeError` when there is no body and no content type, and an uncaught
 * throw out of a route handler is a 500 — so a bare `curl -X POST` would answer "Internal Server
 * Error" before any permission had been asked for. Origin, then capability, then `formBody`, which
 * answers 415 for a request that genuinely did not arrive as a form. This is `/api/admin/posts`'s
 * order, kept identical on purpose.
 */
import { getDb } from '@ozituma/db/client';
import {
  MemberError,
  createLabel,
  createTopic,
  deleteLabel,
  deleteTopic,
  updateLabel,
  updateTopic,
} from '@ozikoro/platform';
import { formBody, jsonError, redirectTo, requireCapability, sameOrigin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The two screens this endpoint writes, and the address each returns to. */
const SCREENS = {
  category: '/admin/posts/categories',
  tag: '/admin/posts/tags',
} as const;

type Screen = keyof typeof SCREENS;

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  // First, always. Nothing below runs for an account without the capability.
  const guard = await requireCapability('edit_entity', { returnTo: SCREENS.category });
  if (!guard.ok) return guard.response;
  const actorId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const text = (name: string, max = 400) => String(form.get(name) ?? '').trim().slice(0, max);
  const num = (name: string): number | null => {
    const raw = form.get(name);
    if (raw === null || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  /*
   * THE SCREEN IS READ FROM THE FORM AND VALIDATED, NEVER GUESSED. A form that named neither — or one
   * that named something else — is answered rather than defaulted to "category", because defaulting is
   * how a request aimed at a tag edits a category.
   */
  const rawScreen = text('screen', 20);
  const screen: Screen | null = rawScreen === 'category' || rawScreen === 'tag' ? rawScreen : null;
  const listPath = screen === null ? SCREENS.category : SCREENS[screen];

  /** Where a refusal goes: back to the list this form came from, keeping its filters. */
  const backTo = (): string => {
    const returnTo = text('returnTo', 300);
    return returnTo.startsWith('/admin/') ? returnTo : listPath;
  };

  if (screen === null) {
    return redirectTo(SCREENS.category, {
      error: 'That form did not say whether it was writing a category or a tag, so nothing was written.',
    });
  }

  const db = await getDb();
  const action = text('action', 40);
  const id = num('id');
  const where = backTo();

  try {
    if (screen === 'category') {
      if (action === 'create-topic') {
        const created = await createTopic(db, {
          name: String(form.get('name') ?? ''),
          slug: text('slug', 200) || null,
          description: String(form.get('description') ?? '') || null,
          parentId: num('parentId'),
          actorId,
        });
        return redirectTo(where, {
          saved: `Category “${created.name}” added at /topics/${created.slug}/. It holds nothing yet, and the rail on /archive/ counts it 0 until it does.`,
        });
      }

      /*
       * QUICK EDIT IS NAME, SLUG AND PARENT — WORDPRESS'S OWN SET — AND IT MUST NOT CLEAR THE
       * DESCRIPTION. The box is not on the quick-edit row, so an absent field is not a request to
       * erase what is there; the current description is read and passed through unchanged. Treating
       * absence as a value is how a quick edit silently wipes a description nobody was shown.
       */
      if (action === 'quick-edit-topic') {
        if (id === null || id <= 0) {
          return redirectTo(where, { error: 'That form did not name a category, so nothing was written.' });
        }
        const current = await db.one<{ description: string | null }>(
          `select description from ozikoro_topic where id = $1`,
          [id]
        );
        if (!current) return redirectTo(where, { error: 'That category does not exist.' });
        const result = await updateTopic(db, {
          id,
          name: String(form.get('name') ?? ''),
          slug: text('slug', 200) || null,
          description: current.description,
          parentId: num('parentId'),
          actorId,
        });
        return redirectTo(where, {
          saved: result.previousSlug
            ? `Saved. The address moved from /topics/${result.previousSlug}/ to /topics/${result.slug}/, so the old one no longer resolves.`
            : `Saved. “${result.name}” is still at /topics/${result.slug}/.`,
        });
      }

      if (action === 'update-topic') {
        if (id === null || id <= 0) {
          return redirectTo(where, { error: 'That form did not name a category, so nothing was written.' });
        }
        const result = await updateTopic(db, {
          id,
          name: String(form.get('name') ?? ''),
          slug: text('slug', 200) || null,
          description: String(form.get('description') ?? '') || null,
          parentId: num('parentId'),
          actorId,
        });
        return redirectTo(where, {
          saved: result.previousSlug
            ? `Saved. The address moved from /topics/${result.previousSlug}/ to /topics/${result.slug}/, so the old one no longer resolves.`
            : `Saved. “${result.name}” is still at /topics/${result.slug}/.`,
        });
      }

      if (action === 'delete-topic') {
        if (id === null || id <= 0) {
          return redirectTo(where, { error: 'That form did not name a category, so nothing was written.' });
        }
        const gone = await deleteTopic(db, { id, actorId });
        return redirectTo(where, {
          saved: `Category “${gone.name}” deleted. Nothing was filed under it, so no record changed.`,
        });
      }

      if (action === 'bulk-topic') {
        return bulk(db, {
          ids: bulkIds(String(form.get('ids') ?? '')),
          screen,
          where,
          actorId,
        });
      }

      return redirectTo(where, { error: 'That action is not one the Categories screen offers.' });
    }

    // ---- tags -------------------------------------------------------------------------------------
    if (action === 'create-label') {
      const created = await createLabel(db, {
        name: String(form.get('name') ?? ''),
        slug: text('slug', 200) || null,
        actorId,
      });
      return redirectTo(where, { saved: `Tag “${created.name}” added at /labels/${created.slug}/.` });
    }

    if (action === 'quick-edit-label') {
      if (id === null || id <= 0) {
        return redirectTo(where, { error: 'That form did not name a tag, so nothing was written.' });
      }
      const result = await updateLabel(db, {
        id,
        name: String(form.get('name') ?? ''),
        slug: text('slug', 200) || null,
        actorId,
      });
      return redirectTo(where, {
        saved: result.previousSlug
          ? `Saved. The address moved from /labels/${result.previousSlug}/ to /labels/${result.slug}/, so the old one no longer resolves.`
          : `Saved. “${result.name}” is still at /labels/${result.slug}/.`,
      });
    }

    if (action === 'update-label') {
      if (id === null || id <= 0) {
        return redirectTo(where, { error: 'That form did not name a tag, so nothing was written.' });
      }
      const result = await updateLabel(db, {
        id,
        name: String(form.get('name') ?? ''),
        slug: text('slug', 200) || null,
        actorId,
      });
      return redirectTo(where, {
        saved: result.previousSlug
          ? `Saved. The address moved from /labels/${result.previousSlug}/ to /labels/${result.slug}/, so the old one no longer resolves.`
          : `Saved. “${result.name}” is still at /labels/${result.slug}/.`,
      });
    }

    if (action === 'delete-label') {
      if (id === null || id <= 0) {
        return redirectTo(where, { error: 'That form did not name a tag, so nothing was written.' });
      }
      const gone = await deleteLabel(db, { id, actorId });
      return redirectTo(where, {
        saved: `Tag “${gone.name}” deleted. No record carried it, so no record changed.`,
      });
    }

    if (action === 'bulk-label') {
      return bulk(db, {
        ids: bulkIds(String(form.get('ids') ?? '')),
        screen,
        where,
        actorId,
      });
    }

    return redirectTo(where, { error: 'That action is not one the Tags screen offers.' });
  } catch (error) {
    /*
     * A `MemberError` is a refusal the editor caused and can act on — a term in use, a name already
     * taken, a slug already an address — so its message is shown verbatim, **including the count and
     * the way out** for the two delete refusals. Anything else is a fault, and the editor is told
     * something went wrong rather than shown an internal message.
     */
    if (error instanceof MemberError) return redirectTo(where, { error: error.message });
    console.error('[admin/taxonomy]', String(error).slice(0, 300));
    return redirectTo(where, { error: 'That could not be saved. Nothing was changed.' });
  }
}

/** `ids=12,13` — the shape the bulk form submits, and nothing else is accepted. */
function bulkIds(raw: string): number[] {
  return raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

/**
 * WordPress's bulk action on both screens is one word: Delete.
 *
 * ⚠️ **A REFUSAL IN THE MIDDLE DOES NOT ABORT THE REST, AND THE NOTICE SAYS BOTH NUMBERS.** Each row
 * goes through the same audited `deleteTopic`/`deleteLabel` the single-row button uses, so a term in
 * use is refused for the same reason and with the same sentence. Reporting "3 deleted" over a run in
 * which two were refused would be the count-hides-the-truth fault this project keeps producing, so
 * the refusals are counted and the first reason is shown.
 */
async function bulk(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { ids: number[]; screen: Screen; where: string; actorId: number }
): Promise<Response> {
  if (input.ids.length === 0) {
    return redirectTo(input.where, { error: 'No rows were ticked, so nothing was changed.' });
  }
  let deleted = 0;
  const refusals: string[] = [];
  for (const rowId of input.ids) {
    try {
      if (input.screen === 'category') await deleteTopic(db, { id: rowId, actorId: input.actorId });
      else await deleteLabel(db, { id: rowId, actorId: input.actorId });
      deleted += 1;
    } catch (error) {
      if (error instanceof MemberError) refusals.push(error.message);
      else throw error;
    }
  }
  const noun = input.screen === 'category' ? 'categories' : 'tags';
  if (refusals.length === 0) {
    return redirectTo(input.where, { saved: `${deleted} ${noun} deleted.` });
  }
  const saved = deleted > 0 ? `${deleted} ${noun} deleted. ` : '';
  return redirectTo(input.where, {
    error: `${saved}${refusals.length} could not be deleted. ${refusals[0]}`,
  });
}
