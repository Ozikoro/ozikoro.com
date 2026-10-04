/**
 * POST /api/admin/archive — every editorial change to a record.
 *
 * One endpoint for the same reason the site's settings endpoint is one: each action here is "an
 * editor filled in a form and pressed a button", and six files would be six places for the
 * permission check to drift. The capability check is the first thing that happens and nothing else
 * runs without it — the plan's rule is that permissions are enforced on the server and a hidden
 * button is not authorisation.
 *
 * Every action also carries the actor, because `ozikoro_audit` records who changed what, and a write
 * path that could omit the actor would make that record a lie.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError } from '@ozikoro/platform';
import {
  ARTICLE_DECISION_LABEL,
  attachEntity,
  attachSource,
  createSource,
  decideArticleStatus,
  detachEntity,
  detachSource,
  findOrCreateEntity,
  restoreArticle,
  trashArticle,
  updateArticleContent,
  updateArticleFacets,
  type ArticleDecision,
  type EntityKind,
  type EntityRole,
  type EvidenceType,
  type SourceKind,
  type SourceType,
} from '@ozikoro/platform';
import { redirectTo, requireCapability, sameOrigin, jsonError, formBody } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  /*
   * THE ORDER OF THESE THREE LINES IS THE POINT, AND IT WAS NOT THIS ORDER.
   *
   * This route read `request.formData()` FIRST. `formData()` **throws a `TypeError` when the request has no
   * body and no content type**, and an uncaught throw out of a route handler is a 500 — so a bare
   * `curl -X POST` to the one endpoint that edits every record in the archive answered "Internal Server
   * Error" instead of the refusal it should give, and before any permission had been asked for. Measured on
   * the sibling routes and recorded in `requireCapability`: **a 500 where a 307 belongs** reads as a broken
   * server when nothing is broken. `formBody` is the helper that exists for exactly this, and the origin and
   * capability checks now come first, as the plan requires: nothing reads a parameter before the guard.
   *
   * The guard's `returnTo` is the queue rather than the record, because the record's id has not been read
   * yet — reading it would mean reading the body first, which is the fault above. A refused caller is sent
   * to the editorial queue, which is where they can act on the refusal; the per-record redirects below are
   * for calls that PASSED the guard.
   */
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  // First, always. Nothing below runs for an account without the capability.
  const guard = await requireCapability('edit_entity', { returnTo: '/admin/archive' });
  if (!guard.ok) return guard.response;
  const actorId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const articleId = Number(form.get('articleId'));
  const backTo = Number.isInteger(articleId) && articleId > 0 ? `/admin/archive/${articleId}` : '/admin/archive';

  const text = (name: string, max = 400) => String(form.get(name) ?? '').trim().slice(0, max);
  const num = (name: string): number | null => {
    const raw = form.get(name);
    if (raw === null || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const db = await getDb();

  try {
    const action = text('action', 40);

    if (action === 'save-facets') {
      const sourceType = text('sourceType', 40) as SourceType | '';
      /*
       * NO `status`. The record's publication state is not part of this form any more — see
       * `updateArticleFacets`'s note and `decideArticleStatus`. The parameter is gone from the function, so
       * this route could not pass one if it tried.
       */
      await updateArticleFacets(db, {
        articleId,
        topicId: num('topicId'),
        sourceType: sourceType === '' ? null : sourceType,
        periodLabel: text('periodLabel', 120) || null,
        periodStart: num('periodStart'),
        periodEnd: num('periodEnd'),
        actorId,
      });
      return redirectTo(backTo, { saved: 'Saved. The record now says this about itself.' });
    }

    /**
     * THE REVIEW DECISION — the tick that publishes an article, and the three decisions that are not it.
     *
     * `guard.capabilities` is passed down rather than re-fetched, and `decideArticleStatus` re-checks
     * `publish` itself. **The rule is enforced in the write, not only at the door**, because a second caller
     * — a script, a future route — would otherwise be a way to publish without the capability, which is the
     * shape migration 0043 exists to prevent. One extra check costs a Set lookup.
     */
    if (action === 'decide-status') {
      const decision = text('decision', 20) as ArticleDecision;
      const result = await decideArticleStatus(db, {
        articleId,
        decision,
        note: text('decisionNote', 400) || null,
        actorId,
        capabilities: guard.capabilities,
      });

      const selfNote = result.selfApproved
        ? ' You approved a record carrying your own revision, and the trail says so.'
        : '';
      return redirectTo(backTo, {
        saved: `${ARTICLE_DECISION_LABEL[result.decision]}: ${result.from} → ${result.to}.${selfNote}`,
      });
    }

    if (action === 'save-content') {
      /*
       * THE RECORD'S OWN WORDS.
       *
       * `MAX_ARTICLE_BODY` is named in the refusal the editor gets, so it is imported from the module that
       * enforces it rather than repeated here — a second copy of a ceiling is a second ceiling.
       *
       * The body is read with its own ceiling check rather than through `text()`, because `text()` TRUNCATES
       * to its maximum and **a truncated body silently saved over a record is the worst outcome this route
       * can produce.** `updateArticleContent` refuses an over-long body and changes nothing; it must be given
       * the whole thing to be able to refuse it.
       */
      const bodyHtml = String(form.get('bodyHtml') ?? '');
      const standfirstRaw = String(form.get('standfirst') ?? '').trim();

      const result = await updateArticleContent(db, {
        articleId,
        // Untruncated, so `updateArticleContent`'s refusal can state the real length rather than a cut one.
        title: String(form.get('title') ?? ''),
        standfirst: standfirstRaw === '' ? null : standfirstRaw,
        bodyHtml,
        note: text('note', 400) || null,
        actorId,
      });

      /*
       * THE NOTICE SAYS WHAT HAPPENED, INCLUDING WHAT THE ARCHIVE DID TO THE TEXT.
       *
       * A save that quietly dropped a `<script>` and answered "Saved" would leave the editor believing the
       * record holds what they pasted. `sanitised` is returned by the write rather than recomputed here, so
       * the sentence cannot describe a comparison the write did not make.
       */
      const kept = `Kept revision ${result.revisionId} of what it said before. ${result.wordCount.toLocaleString('en-GB')} words.`;
      return redirectTo(backTo, {
        saved: result.sanitised
          ? `Saved. Some markup a reader must not be shown was removed: script tags, embedded frames and inline event handlers are not stored. ${kept}`
          : `Saved. ${kept}`,
      });
    }

    if (action === 'trash') {
      /*
       * A DELETE IS A MOVE. Gated on `edit_entity` like every other edit, because the owner has said an
       * editor deletes content — and `trashArticle` destroys nothing, so this is not the act that needed a
       * capability of its own. The purge, which does destroy, is `purge_trash` and lives on `/api/admin/trash`.
       */
      const result = await trashArticle(db, { articleId, actorId, note: text('note', 400) || null });
      return redirectTo(backTo, {
        saved:
          `Moved to the trash from ${result.from}. Nothing was destroyed: the record is not served at its own ` +
          'address, its entities, sources and revisions are where they were, and it can be restored from ' +
          'the trash.',
      });
    }

    if (action === 'restore') {
      const result = await restoreArticle(db, { articleId, actorId });
      return redirectTo(backTo, { saved: `Restored to ${result.to}, which is the state it was taken out of.` });
    }

    if (action === 'attach-place') {
      const clanId = num('clanId');
      const townName = text('townName', 120);
      const role = (text('role', 30) || 'clan') as EntityRole;

      /*
       * The dictionary first. An editor who picked a clan from Ozituma's 228 is linking to the
       * record that already exists; the entity row points at it rather than restating it, which is
       * what "do not duplicate the dictionary inside Ozikoro" means in code.
       */
      if (clanId !== null) {
        const clan = await db.one<{ id: string; name: string }>(`select id, name from clan where id = $1`, [clanId]);
        if (!clan) return redirectTo(backTo, { error: 'That clan is not in the dictionary.' });

        const entityId = await findOrCreateEntity(db, {
          name: String(clan.name),
          kind: (role === 'town' ? 'town' : role === 'place' ? 'place' : 'clan') as EntityKind,
          clanId,
          actorId,
        });

        // If a town was named, link the town to the clan so the graph knows where it sits.
        if (townName) {
          const town = await db.one<{ id: string }>(`select id from clan_town where clan_id = $1 and lower(name) = lower($2)`, [clanId, townName]);
          const townId = await findOrCreateEntity(db, {
            name: townName,
            kind: 'town',
            clanId,
            ...(town ? { clanTownId: Number(town.id) } : {}),
            actorId,
          });
          await db.query(
            `insert into ozikoro_entity_relation (from_entity_id, to_entity_id, relation) values ($1, $2, 'part_of') on conflict do nothing`,
            [townId, entityId]
          );
          await attachEntity(db, { articleId, entityId: townId, role: 'town', actorId });
        }

        await attachEntity(db, { articleId, entityId, role, actorId });
        return redirectTo(backTo, { saved: `Linked to ${clan.name}${townName ? ` and ${townName}` : ''}.` });
      }

      return redirectTo(backTo, { error: 'Choose a clan, or type a town and choose its clan.' });
    }

    if (action === 'detach-entity') {
      await detachEntity(db, {
        articleId,
        entityId: Number(form.get('entityId')),
        role: text('role', 30) as EntityRole,
        actorId,
      });
      return redirectTo(backTo, { saved: 'Removed.' });
    }

    if (action === 'attach-source') {
      const title = text('title', 400);
      if (!title) return redirectTo(backTo, { error: 'A source needs a title to be citable.' });

      const sourceId = await createSource(db, {
        title,
        kind: (text('kind', 40) || 'book') as SourceKind,
        authors: text('authors', 400).split(',').map((a) => a.trim()).filter(Boolean),
        year: num('year'),
        publisher: text('publisher', 200) || null,
        licence: text('licence', 200) || null,
        evidenceType: (text('evidenceType', 40) || null) as EvidenceType | null,
        actorId,
      });

      await attachSource(db, {
        articleId,
        sourceId,
        stance: (text('stance', 20) || 'supports') as 'supports' | 'contradicts' | 'qualifies' | 'context',
        actorId,
      });
      return redirectTo(backTo, { saved: 'Source attached. The record now cites it.' });
    }

    if (action === 'detach-source') {
      await detachSource(db, { articleId, sourceId: Number(form.get('sourceId')), actorId });
      return redirectTo(backTo, { saved: 'Source removed.' });
    }

    return redirectTo(backTo, { error: 'That action is not one this screen offers.' });
  } catch (error) {
    /*
     * A `MemberError` is a refusal the editor caused and can act on — a period that ends before it
     * starts, a title that is missing — so its message is shown. Anything else is a fault, and the
     * editor is told something went wrong rather than shown an internal message.
     */
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[admin/archive]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'That could not be saved. Nothing was changed.' });
  }
}
