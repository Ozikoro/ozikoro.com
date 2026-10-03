/**
 * POST /api/admin/entities — the knowledge graph, built from the dictionary.
 *
 * WHY THIS IS AN ACTION AND NOT A SCRIPT
 *
 * `scripts/build-town-entities.ts` can do this from a terminal, and the same work is offered here
 * because of who owns the record. Building the graph moves 188 dictionary clans and towns into the
 * archive's entity table and links the 146 records whose titles name them; it is a change to the
 * archive that an editor should be able to make, see the result of, and be answerable for. **A
 * capability granted to editors that only works from an administrator's laptop is not granted.**
 *
 * ONE FUNCTION, TWO DOORS. The work lives in `buildEntityGraph` in `@ozikoro/platform` and both
 * callers run it, so the back office and the command line cannot disagree about what it does.
 *
 * THE ACTOR ALWAYS COMES FROM THE SESSION
 *
 * `buildEntityGraph` needs an account to attribute the run to, and this route passes the signed-in
 * account rather than anything from the form. A form field naming the actor would let the one thing
 * an audit trail exists to prevent — a change attributed to somebody who did not make it —
 * be done by editing a hidden input.
 */
import { getDb } from '@ozituma/db/client';
import { MemberError, buildEntityGraph } from '@ozikoro/platform';
import { redirectTo, requireCapability, sameOrigin, jsonError, formBody } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  /*
   * THE ORDER OF THESE FOUR LINES IS THE POINT.
   *
   * The origin check, the content-type check and the capability check all happen BEFORE the body is
   * read, and the capability check is the first thing that can refuse. That matters twice over:
   *
   *   * **`request.formData()` throws a `TypeError` when there is no body and no content type**, and an
   *     uncaught throw is a 500 — so an anonymous bare `POST` used to answer "Internal Server Error"
   *     rather than sending the reader to sign in. Measured on all seven of this app's state-changing
   *     routes, including the four that predate this one: **a 500 where a 307 belongs**, which is the
   *     kind of fault that gets read as a broken server when nothing is broken.
   *   * The plan's rule is that the permission check is first. It is now first in the request as well as
   *     first in the function.
   */
  if (!sameOrigin(request)) return jsonError(403, 'cross_origin', 'That request did not come from this site.');

  const backTo = '/admin/entities';

  // First, always. Nothing below runs for an account without the capability.
  const guard = await requireCapability('edit_entity', { returnTo: backTo });
  if (!guard.ok) return guard.response;
  const actorId = guard.account.account.id;

  const form = await formBody(request);
  if (!form) return jsonError(415, 'unsupported_body', 'That form did not arrive as a form.');

  const action = String(form.get('action') ?? '').trim();

  try {
    const db = await getDb();

    if (action === 'build-graph') {
      const report = await buildEntityGraph(db, { actorId, dryRun: false });

      /*
       * THE NOTICE REPORTS WHAT HAPPENED, INCLUDING NOTHING.
       *
       * A second press creates no entity and relinks nothing, and a message that only ever says
       * "Done" would make the two runs indistinguishable — which is exactly how a screen ends up
       * being pressed repeatedly because nobody can tell whether it worked. So the sentence is
       * assembled from the report.
       */
      const parts: string[] = [];
      if (report.entitiesCreated > 0) parts.push(`${report.entitiesCreated} entities created`);
      if (report.entitiesAlreadyPresent > 0) parts.push(`${report.entitiesAlreadyPresent} already in the graph`);
      if (report.linksCreated > 0) parts.push(`${report.linksCreated} records linked to a place across ${report.articlesLinked} records`);
      if (report.skipped.length > 0) parts.push(`${report.skipped.length} dictionary rows left alone because they are sections or administrative groupings, not places`);
      parts.push('no coordinates written, because the dictionary holds none and the brief forbids inventing them');

      return redirectTo(backTo, {
        saved:
          (report.entitiesCreated === 0 && report.linksCreated === 0
            ? 'Nothing changed — the graph already holds every published clan and town, and every record whose title names one is linked. '
            : '') + parts.join('; ') + '.',
      });
    }

    return redirectTo(backTo, { error: 'That action is not one this screen offers.' });
  } catch (error) {
    /*
     * A `MemberError` is a refusal the editor caused and can act on, so its message is shown.
     * Anything else is a fault and the editor is told something went wrong rather than shown an
     * internal message.
     */
    if (error instanceof MemberError) return redirectTo(backTo, { error: error.message });
    console.error('[admin/entities]', String(error).slice(0, 300));
    return redirectTo(backTo, { error: 'The graph could not be built. Nothing was changed.' });
  }
}
