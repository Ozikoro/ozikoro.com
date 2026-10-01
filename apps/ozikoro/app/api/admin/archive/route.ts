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
  attachEntity,
  attachSource,
  createSource,
  detachEntity,
  detachSource,
  findOrCreateEntity,
  updateArticleFacets,
  type EntityKind,
  type EntityRole,
  type EvidenceType,
  type SourceKind,
  type SourceType,
} from '@ozikoro/platform';
import { redirectTo, requireCapability, sameOrigin, jsonError } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();

  /*
   * Cross-site form submissions are refused.
   *
   * The session cookie is `SameSite=Lax`, which already stops a browser sending it on a cross-site
   * POST — so this is defence in depth rather than the only protection. It is added because the four
   * Spotify and auth endpoints already do exactly this, and a state-changing route that omits it
   * relies entirely on a cookie attribute continuing to be set correctly in every environment.
   */
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const articleId = Number(form.get('articleId'));
  const backTo = Number.isInteger(articleId) && articleId > 0 ? `/admin/archive/${articleId}` : '/admin/archive';

  // First, always. Nothing below runs for an account without the capability.
  const guard = await requireCapability('edit_entity', { returnTo: backTo });
  if (!guard.ok) return guard.response;
  const actorId = guard.account.account.id;

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
      await updateArticleFacets(db, {
        articleId,
        topicId: num('topicId'),
        sourceType: sourceType === '' ? null : sourceType,
        periodLabel: text('periodLabel', 120) || null,
        periodStart: num('periodStart'),
        periodEnd: num('periodEnd'),
        ...(text('status', 20) ? { status: text('status', 20) as 'draft' | 'review' | 'published' | 'archived' } : {}),
        actorId,
      });
      return redirectTo(backTo, { saved: 'Saved. The record now says this about itself.' });
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
