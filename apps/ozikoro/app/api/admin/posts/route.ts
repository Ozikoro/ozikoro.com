/**
 * POST /api/admin/posts — every write the Classic Editor screen and its list tables make.
 *
 * ── WHY ONE ENDPOINT ────────────────────────────────────────────────────────────────────────────────
 *
 * The same reason `/api/admin/archive` is one: each action is "an editor filled in a form and pressed a
 * button", and a dozen files would be a dozen places for the permission check to drift. **The capability
 * check is the first thing that happens and nothing below it runs without it** — the plan's rule is that
 * permissions are enforced on the server and a hidden button is not authorisation.
 *
 * ── AND WHY THE `publish` CAPABILITY IS ASKED FOR TWICE ─────────────────────────────────────────────
 *
 * `edit_entity` gets you through the door: creating a draft, saving it, tagging it, trashing it. Publishing
 * is a second question, and it is asked in two places on purpose — here, so the refusal names the
 * permission, and again inside `publishPiece`/`unpublishPiece`, so a second caller (a script, a job, a
 * route added next year) cannot publish without it. One extra Set lookup buys a rule that lives in the
 * write rather than in the UI.
 *
 * ── WHY THE FORM BODY IS READ AFTER THE GUARD ──────────────────────────────────────────────────────
 *
 * The order is the point and it was learned on the sibling route: `request.formData()` **throws a
 * `TypeError` when the request has no body and no content type**, and an uncaught throw out of a route
 * handler is a 500 — so a bare `curl -X POST` would answer "Internal Server Error" before any permission
 * had been asked for. Origin, then capability, then `formBody`, which answers 415 for a request that
 * genuinely did not arrive as a form.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError } from '@ozikoro/platform';
import {
  PIECE_KIND_LABEL,
  createPiece,
  getPieceForEditor,
  isPieceKind,
  publishPiece,
  quickEditPiece,
  restorePiece,
  savePieceText,
  setFeaturedImage,
  setPieceAuthor,
  setPieceStatus,
  setPieceTerms,
  trashPiece,
  unpublishPiece,
  type PieceKind,
} from '@ozikoro/platform';
import { formBody, jsonError, redirectTo, requireCapability, sameOrigin } from '@/lib/access';
import { bulkIdsFrom, bulkNotice, bulkWriteFor } from '@/lib/admin-posts-bulk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Where a list lives, per kind. One function, so a redirect cannot send a page to the posts list. */
function listPath(kind: PieceKind): string {
  return kind === 'page' ? '/admin/pages' : '/admin/posts';
}

/** Where one piece is edited, per kind. */
function editPath(kind: PieceKind, id: number): string {
  return `${listPath(kind)}/${id}`;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  // First, always. Nothing below runs for an account without the capability.
  const guard = await requireCapability('edit_entity', { returnTo: '/admin/posts' });
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
   * THE KIND IS READ FROM THE FORM AND VALIDATED, NEVER GUESSED. A form that named a kind this archive
   * does not have is refused rather than defaulted to "post", because defaulting is how a request aimed
   * at a page ends up writing a post.
   */
  const rawKind = text('kind', 10);
  const kind: PieceKind = isPieceKind(rawKind) ? rawKind : 'post';
  const id = num('id');
  const returnTo = text('returnTo', 200);

  /** Where a refusal goes: back to the piece when there is one, otherwise to the list. */
  const backTo = (): string => {
    if (returnTo.startsWith('/admin/')) return returnTo;
    if (id !== null && id > 0) return editPath(kind, id);
    return listPath(kind);
  };

  const db = await getDb();

  try {
    const action = text('action', 40);

    if (!isPieceKind(rawKind)) {
      return redirectTo('/admin/posts', {
        error: 'That form did not say whether it was writing a post or a page, so nothing was written.',
      });
    }

    /*
     * THE META BOXES ARE PART OF THE SAME FORM, WHICH IS WHAT WORDPRESS DOES.
     *
     * On the Classic Editor screen the Categories, Tags, Featured Image and Author boxes are all inside
     * `form#post`, and one press of Save Draft writes the post and all of them together. So the editor
     * posts them here, and this applies what actually changed.
     *
     * ONLY WHAT CHANGED IS WRITTEN, AND THAT IS NOT AN OPTIMISATION. Each of those writes an audit row of
     * its own; a save with an untouched Tags box that wrote "series and tags saved" anyway would put a
     * decision nobody made into the trail. So the piece is read once, compared, and only the differing
     * boxes are written — each still through its own audited function.
     */
    const applyMetaBoxes = async (pieceId: number): Promise<void> => {
      const current = await getPieceForEditor(db, pieceId, kind);
      if (!current) return;

      const topicId = num('topicId');
      const tags = String(form.get('tags') ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const currentTags = current.labels.map((l) => l.name);
      const tagsDiffer =
        tags.length !== currentTags.length ||
        [...tags].sort().join('\u0000') !== [...currentTags].sort().join('\u0000');
      /*
       * THE TERMS ARE ONLY TOUCHED WHEN THE FORM CARRIED THEM AT ALL. A page's form has no Categories or
       * Tags box — WordPress does not give a page either — so without this guard a page save would read
       * the absent fields as "no series and no tags" and quietly clear them.
       */
      if (form.get('topicId') !== null || form.get('tags') !== null) {
        if (topicId !== current.topicId || tagsDiffer) {
          await setPieceTerms(db, { id: pieceId, kind, topicId, labelNames: tags, actorId });
        }
      }

      /*
       * THE FEATURED IMAGE AND THE BYLINE ARE ONLY TOUCHED WHEN THE FORM CARRIED THOSE FIELDS AT ALL. A
       * form without an image picker on it is not a request to clear the image, and treating absence as a
       * value would delete a picture nobody asked to remove.
       */
      if (form.get('mediaId') !== null) {
        const mediaId = num('mediaId');
        if (mediaId !== current.featuredMediaId) await setFeaturedImage(db, { id: pieceId, kind, mediaId, actorId });
      }
      if (form.get('authorId') !== null) {
        const authorId = num('authorId');
        if (authorId !== current.authorId) await setPieceAuthor(db, { id: pieceId, kind, authorId, actorId });
      }
    };

    if (action === 'create') {
      const created = await createPiece(db, {
        kind,
        title: String(form.get('title') ?? ''),
        bodyHtml: String(form.get('bodyHtml') ?? ''),
        standfirst: String(form.get('standfirst') ?? '') || null,
        // The Slug box is on the Add New screen too, so an address typed there is honoured at creation.
        slug: text('slug', 200) || null,
        topicId: num('topicId'),
        authorId: num('authorId'),
        actorId,
      });
      return redirectTo(editPath(created.kind, created.id), {
        saved:
          `Draft created${created.slug.startsWith('draft-') ? '' : ` at /${created.slug}/`}. ` +
          'It is not served at any address while it is a draft.',
      });
    }

    /*
     * PUBLISH FROM THE ADD NEW SCREEN, WHICH IS ONE PRESS IN WORDPRESS TOO.
     *
     * "Add New Post" has a Publish button beside Save Draft, and pressing it creates the post and puts it
     * live in one go. So this creates the piece and then publishes it through `publishPiece` — the same
     * function the editor's Publish button calls, with the same capability check and the same audit row.
     * There is no second publication path here; there is one function called from two screens.
     */
    if (action === 'create-and-publish') {
      const created = await createPiece(db, {
        kind,
        title: String(form.get('title') ?? ''),
        bodyHtml: String(form.get('bodyHtml') ?? ''),
        standfirst: String(form.get('standfirst') ?? '') || null,
        slug: text('slug', 200) || null,
        topicId: num('topicId'),
        authorId: num('authorId'),
        actorId,
      });
      try {
        const published = await publishPiece(db, {
          id: created.id,
          kind,
          title: String(form.get('title') ?? ''),
          bodyHtml: String(form.get('bodyHtml') ?? ''),
          standfirst: String(form.get('standfirst') ?? '') || null,
          slug: text('slug', 200) || null,
          note: text('note', 400) || null,
          actorId,
          capabilities: guard.capabilities,
        });
        await applyMetaBoxes(created.id);
        return redirectTo(editPath(kind, created.id), {
          saved: `${PIECE_KIND_LABEL[kind]} published at /${published.slug}/. It is live now, and the trail records who did it.`,
        });
      } catch (error) {
        /*
         * THE PIECE NOW EXISTS AS A DRAFT, AND THAT IS SAID RATHER THAN HIDDEN. Publishing a new piece
         * writes it first — that is the order `publishPiece` guarantees — so a refusal (an empty title, a
         * missing permission) leaves a real draft behind rather than nothing. The editor is sent to it with
         * the reason, which is more useful than a redirect to the list and a deleted row.
         */
        const reason = error instanceof MemberError ? error.message : 'It could not be published.';
        return redirectTo(editPath(kind, created.id), {
          error: `${reason} It is saved as a draft at ${editPath(kind, created.id)}, so nothing you wrote is lost.`,
        });
      }
    }

    /*
     * THE ONE ACTION THAT NAMES MANY RECORDS AND NO SINGLE PIECE, AND WHY IT IS HANDLED FIRST.
     *
     * `bulk` is what the list table's "Move to Trash" / "Return to draft" / "Restore" dropdown posts: a list
     * of ids in one field (`ids=5206,5204`) and **no `id` at all**. Every action after this block writes
     * exactly one record, which is why the guard that follows it can require an `id`.
     *
     * IT USED TO COME AFTER THAT GUARD, AND THAT MADE IT UNREACHABLE. The guard answered every bulk action
     * with *"That form did not name a piece, so nothing was written."* — measured in a browser: two rows
     * ticked, "Move to Trash" chosen, Apply pressed, that error, and both rows still in the list with
     * Trash (0). The order below is the fix: this block runs, returns its own redirect, and never reaches
     * the per-record guard.
     */
    if (action === 'bulk') {
      const where = returnTo.startsWith('/admin/') ? returnTo : listPath(kind);
      const ids = bulkIdsFrom(String(form.get('ids') ?? ''));
      const bulkAction = bulkWriteFor(text('bulkAction', 20));
      /*
       * THE VALUE IS VALIDATED BEFORE THE LOOP, WHICH IS NOT PEDANTRY. It used to be three literal
       * comparisons inside the loop, so a value matching none of them ran the loop zero times and was then
       * answered with a success notice — *"0 moved to the trash."* over a request that did nothing.
       */
      if (bulkAction === null) {
        return redirectTo(where, { error: 'That is not a bulk action this list offers, so nothing was changed.' });
      }
      if (ids.length === 0) {
        return redirectTo(where, { error: 'No rows were ticked, so nothing was changed.' });
      }
      let changed = 0;
      for (const rowId of ids) {
        if (bulkAction === 'trash') {
          await trashPiece(db, { id: rowId, kind, actorId, note: 'Bulk action from the list table.' });
          changed += 1;
        } else if (bulkAction === 'restore') {
          await restorePiece(db, { id: rowId, kind, actorId });
          changed += 1;
        } else {
          await unpublishPiece(db, {
            id: rowId, kind, actorId, capabilities: guard.capabilities,
            note: 'Bulk action from the list table.',
          });
          changed += 1;
        }
      }
      return redirectTo(where, { saved: bulkNotice(bulkAction, changed) });
    }

    /*
     * EVERY ACTION BELOW WRITES ONE RECORD, SO THE FORM MUST NAME IT.
     *
     * This is the guard that used to catch `bulk` as well; `bulk` is answered above and returns, so what
     * reaches here is only an action whose record is named by `id`, and an absent id — or one of zero or
     * less, which is what a form that failed to render its hidden field sends — is a malformed form.
     */
    if (id === null || id <= 0) {
      return redirectTo(listPath(kind), { error: 'That form did not name a piece, so nothing was written.' });
    }

    /*
     * SAVE, AND THE TWO WAYS TO PUBLISH.
     *
     * `publish` is WordPress's Publish button: save the text and put it in front of readers in one press.
     * `update` is its Update button on an already-published piece: save the text and leave the status
     * alone. They are separate actions rather than one with a flag, because the audit row and the notice
     * say different things and a caller should not be able to reach a publication by accident.
     */
    if (action === 'save-draft' || action === 'update') {
      const result = await savePieceText(db, {
        id,
        kind,
        title: String(form.get('title') ?? ''),
        bodyHtml: String(form.get('bodyHtml') ?? ''),
        standfirst: String(form.get('standfirst') ?? '') || null,
        slug: text('slug', 200) || null,
        note: text('note', 400) || null,
        actorId,
      });
      await applyMetaBoxes(id);
      const kept = `Kept revision ${result.revisionId} of what it said before. ${result.wordCount.toLocaleString('en-GB')} words.`;
      /*
       * WHAT `sanitised` DOES AND DOES NOT MEAN, BECAUSE THE OLD SENTENCE CLAIMED MORE THAN IT KNEW.
       *
       * It is set when the stored body differs in any byte from the submitted one — which includes the
       * sanitiser dropping `class`, `style` and `id` from a WordPress body, and includes it re-serialising
       * attributes on the way through. It does NOT mean a script, a frame or an event handler was found.
       *
       * Measured on this cluster: a save whose body was 9,762 bytes and came back 9,846 — the 84 bytes of
       * text that were typed, and nothing else — was reported as *"Some markup a reader must not be shown was
       * removed: script and style elements, embedded frames and inline event handlers are not stored."* That
       * is a specific claim about a specific removal, and it was false. The sentence below says what the
       * sanitiser is and what it therefore did, and claims nothing it cannot see.
       */
      return redirectTo(editPath(kind, id), {
        saved: result.sanitised
          ? `Draft saved. The body was written through the archive's sanitiser, which stores no inline styles, ` +
            `classes or ids and no script, frame or event-handler markup — so a body carrying any of those is ` +
            `not stored byte for byte as it was typed. ${kept}`
          : `Draft saved, byte for byte as it was written. ${kept}`,
      });
    }

    if (action === 'publish') {
      const result = await publishPiece(db, {
        id,
        kind,
        title: String(form.get('title') ?? ''),
        bodyHtml: String(form.get('bodyHtml') ?? ''),
        standfirst: String(form.get('standfirst') ?? '') || null,
        slug: text('slug', 200) || null,
        note: text('note', 400) || null,
        actorId,
        capabilities: guard.capabilities,
      });
      await applyMetaBoxes(id);
      return redirectTo(editPath(kind, id), {
        saved:
          `${PIECE_KIND_LABEL[kind]} published at /${result.slug}/, moving from ${result.from} on ` +
          `${result.publishedAt.slice(0, 10)}. The trail records who did it, and publishing again will refuse ` +
          'rather than move that date.',
      });
    }

    /*
     * THE STATUS CONTROL IN THE PUBLISH BOX.
     *
     * It reaches Draft and Pending and nothing else. `published` is refused here BY NAME and told to use
     * the Publish button: a publication is one deliberate act with the title, the text and the date in
     * front of the person making it, and a dropdown beside them is not that. Taking a published piece down
     * is allowed — it is the safe direction and the editor screen has the same control — and it asks for
     * `publish` inside the write.
     */
    if (action === 'set-status') {
      const target = text('status', 20);
      if (target !== 'draft' && target !== 'review') {
        return redirectTo(editPath(kind, id), {
          error:
            target === 'published'
              ? 'Publishing is not the Status control’s. Use the Publish button, which saves the text and the status together and records who did it.'
              : 'The Status control sets a piece to Draft or Pending, and nothing else.',
        });
      }
      const result = await setPieceStatus(db, { id, kind, status: target, actorId, capabilities: guard.capabilities });
      return redirectTo(editPath(kind, id), {
        saved: result.from === result.to ? `It was already ${result.to}.` : `Status set from ${result.from} to ${result.to}.`,
      });
    }

    if (action === 'switch-to-draft') {
      const result = await unpublishPiece(db, {
        id,
        kind,
        actorId,
        capabilities: guard.capabilities,
        note: text('note', 400) || null,
      });
      return redirectTo(editPath(kind, id), {
        saved: `${result.from} → ${result.to}. The address no longer resolves, and the publication date is kept.`,
      });
    }

    if (action === 'trash') {
      const result = await trashPiece(db, { id, kind, actorId, note: text('note', 400) || null });
      return redirectTo(listPath(kind), {
        saved:
          `Moved to the trash from ${result.from}. Nothing was destroyed: it is not served at its address, its revisions are ` +
          'where they were, and it can be restored from the trash.',
      });
    }

    if (action === 'restore') {
      const result = await restorePiece(db, { id, kind, actorId });
      return redirectTo(listPath(kind), { saved: `Restored to ${result.to}, which is the state it was taken out of.` });
    }

    if (action === 'quick-edit') {
      const result = await quickEditPiece(db, {
        id,
        kind,
        title: String(form.get('title') ?? ''),
        slug: String(form.get('slug') ?? ''),
        authorId: num('authorId'),
        status: text('status', 20) || 'draft',
        publishedAt: text('publishedAt', 40) || null,
        actorId,
        capabilities: guard.capabilities,
      });
      /*
       * THE CATEGORY AND TAG SELECTS ARE IN WORDPRESS'S QUICK EDIT TOO, so they are in this one — and they
       * go through the same compared-write path the editor screen uses, so an untouched tag box writes
       * nothing. `applyMetaBoxes` is the one implementation of "write only what changed".
       */
      await applyMetaBoxes(id);
      return redirectTo(returnTo.startsWith('/admin/') ? returnTo : listPath(kind), {
        saved: `Saved. Now at /${result.slug}/ and ${result.status}.`,
      });
    }

    return redirectTo(backTo(), { error: 'That action is not one this screen offers.' });
  } catch (error) {
    /*
     * A `MemberError` is a refusal the editor caused and can act on — a missing title at publish, a piece
     * that is already published, a wrong kind — so its message is shown. Anything else is a fault and the
     * editor is told something went wrong rather than shown an internal message.
     */
    if (error instanceof MemberError) return redirectTo(backTo(), { error: error.message });
    console.error('[admin/posts]', String(error).slice(0, 300));
    return redirectTo(backTo(), { error: 'That could not be saved. Nothing was changed.' });
  }
}
