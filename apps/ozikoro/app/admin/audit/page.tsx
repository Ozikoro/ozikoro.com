/**
 * /admin/audit — the audit trail: what changed, who changed it, and when.
 *
 * WHY THIS EXISTS
 *
 * `ozikoro_audit` has been written by every privileged write path since the editorial desk was built —
 * `updateArticleFacets` records a status change, `decideContributorClaim` records a byline being granted, and
 * the migration's own repair passes recorded what they did. **Nothing read it back.** The one question the
 * table was created to answer could only be answered by opening a database client, and a record nobody can
 * read holds nobody to anything. The administrator's own dashboard has listed "Audit logs" as
 * `Not built yet` since the dashboard links were made honest; this is that screen.
 *
 * WHY IT IS GATED ON `manage_users`
 *
 * The trail names accounts — every actor's email — and it reports suspension, role grants and byline
 * decisions. That is the same class of information as the user table, which is gated on the same capability
 * for the same reason. **An editor who can work the queues is not automatically entitled to a list of
 * everybody's account addresses**, so the page asks for its own capability and redirects with a reason
 * rather than relying on the layout's door. Editors still reach everything the trail is about; they are
 * refused the list of who did it.
 *
 * WHAT IT SHOWS, AND THE ONE THING IT REFUSES TO GUESS
 *
 * The rows are reported as they were written. `before` and `after` are JSONB whose shape is decided by the
 * caller, so the screen prints them rather than pretending to know what every field means — **except** a
 * status change, which is the commonest row and the one fact an editor is looking for, and which is read
 * only when both sides actually carry a `status`.
 *
 * A row that records no actor says so. It is not hidden, not grouped away and not shown as "system":
 * **the unattributed changes are the ones an audit trail exists to surface**, and the overview counts them
 * separately so the number is visible without opening the table.
 */
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import { getAuditOverview, listAuditTrail } from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { AtAGlance, Card, Head } from '../ui';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

/*
 * THE RECORDED CHANGE, IN WORDS A PERSON READS RATHER THAN THE COLUMN'S OWN NAME.
 *
 * **THE MAP HAD DRIFTED, AND THE DRIFT WAS VISIBLE ON THE SCREEN THE OWNER OPENS TO ASK WHAT CHANGED.**
 * It labelled eleven actions, of which five — `suspend_account`, `reactivate_account`, `set_password`,
 * `save_rights`, `restrict_media` — are not written by any code path any more (the account and rights
 * writers were renamed), while the actions that ARE written fell through to `?? action`. So the filter
 * listed `reassign_byline`, `merge_contributor`, `set`, `update`, `reset`, `set_account_status`,
 * `record_rights`, `attach_source`, `follow_researcher` and a dozen more as raw identifiers.
 *
 * Every entry below was taken from the string the writing code actually passes (`grep "action: '"` across
 * `packages/ozikoro/src` and `apps/ozikoro`, plus the two SQL-literal writers in
 * `packages/ozikoro/src/ops/merge-contributor.ts` and the `design_override` writer in
 * `packages/ozikoro/src/design-override-store.ts`). **The five that nothing writes are kept rather than
 * deleted**, because historical `ozikoro_audit` rows carrying them are real records and removing the label
 * would turn a sentence back into a column value in the history it describes.
 *
 * THE RAW NAME IS STILL PRINTED, in `.history__when.mono` beneath the label in the table. So this is a
 * translation layer and not a replacement: an action nobody has labelled yet shows its own name rather than
 * an empty cell, and somebody checking the table against the database can still read the identifier.
 */
const ACTION_LABEL: Record<string, string> = {
  // Byline claims
  approve_claim: 'Byline claim approved',
  reject_claim: 'Byline claim declined',
  // Roles and accounts
  grant_role: 'Role granted',
  revoke_role: 'Role revoked',
  set_account_status: 'Account status changed',
  suspend_account: 'Account suspended',
  reactivate_account: 'Account reactivated',
  set_password: 'Password set',
  update_profile: 'Profile changed',
  // The archive records
  create: 'Record created',
  set_status: 'Status changed',
  update_facets: 'Record changed',
  attach_entity: 'Linked to a clan, town or person',
  detach_entity: 'Link to a clan, town or person removed',
  link_entity_from_title: 'Linked to an entity by its title',
  build_from_dictionary: 'Entity built from the dictionary',
  create_from_dictionary: 'Entity created from the dictionary',
  attach_source: 'Source attached',
  detach_source: 'Source detached',
  attach_file: 'Manuscript attached',
  // Rights
  record_rights: 'Rights recorded',
  update_rights: 'Rights changed',
  save_rights: 'Rights recorded',
  restrict: 'Restriction applied',
  restrict_media: 'Media restricted',
  lift_restriction: 'Restriction lifted',
  // Following
  follow_researcher: 'Researcher followed',
  unfollow_researcher: 'Researcher unfollowed',
  follow_topic: 'Subject followed',
  unfollow_topic: 'Subject unfollowed',
  follow_institution: 'Institution followed',
  unfollow_institution: 'Institution unfollowed',
  // Pronunciation
  record_pronunciation: 'Pronunciation recorded',
  approve_pronunciation: 'Pronunciation approved',
  reject_pronunciation: 'Pronunciation declined',
  waive_pronunciation_gaps: 'Missing pronunciations waived',
  // A contributor merged into another, and the bylines it moved
  merge_contributor: 'Contributor merged',
  reassign_byline: 'Byline reassigned',
  // The design overrides. The subject column reads "Design edit", which is what makes these three
  // readable: alone, `set` and `update` would say nothing about what was set.
  set: 'Design edit made',
  update: 'Design edit changed',
  reset: 'Design edit reset',
};

/** `3 Oct 2026, 14:05 UTC`, or the raw value when it will not parse. */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  })} UTC`;
}

/**
 * `ozikoro_contributor_claim` reads as `Byline claim`, so the subject is legible without a lookup.
 *
 * THE FALLBACK IS HONEST BUT IT IS NOT READABLE, and the map was missing nine of the entity types the
 * writers actually use, so the subject column read `entity graph`, `media rights`, `publication file`,
 * `pronunciation` and `follow` — a slug with its underscores straightened. Every key below is a value a
 * writer passes; the fallback is kept for the next one, because showing the column's own value is better
 * than showing nothing.
 */
function subjectName(entityType: string): string {
  const map: Record<string, string> = {
    ozikoro_contributor_claim: 'Byline claim',
    ozikoro_article: 'Record',
    ozikoro_media: 'Media item',
    ozikoro_media_rights: 'Media rights',
    ozikoro_member: 'Member',
    ozikoro_member_role: 'Member role',
    ozikoro_publication: 'Publication',
    ozikoro_publication_file: 'Manuscript',
    ozikoro_entity: 'Entity',
    ozikoro_entity_graph: 'Entity graph',
    ozikoro_source: 'Source',
    ozikoro_contributor: 'Contributor',
    ozikoro_pronunciation: 'Pronunciation',
    ozikoro_follow: 'Follow',
    // The design overrides record under a bare name rather than an `ozikoro_`-prefixed one.
    design_override: 'Design edit',
    account: 'Account',
  };
  return map[entityType] ?? entityType.replace(/^ozikoro_/, '').replace(/_/g, ' ');
}

/** The recorded change, in as few words as are true. */
function change(entry: { statusChange: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }): string | null {
  if (entry.statusChange) return `status ${entry.statusChange}`;
  const fields = new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]);
  if (fields.size === 0) return null;
  return [...fields].sort().join(', ');
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; page?: string }>;
}) {
  // The gate. Editors and moderators never reach the queries below.
  await requireCapabilityOrRedirect('manage_users', '/admin/audit');

  const params = await searchParams;
  const action = params.action?.trim() || null;
  const entityType = params.entity?.trim() || null;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const db = await getDb();
  const [overview, trail] = await Promise.all([
    getAuditOverview(db),
    listAuditTrail(db, { action, entityType, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);

  const lastPage = Math.max(1, Math.ceil(trail.total / PAGE_SIZE));

  const query = (extra: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries({ action: action ?? undefined, entity: entityType ?? undefined, ...extra })) {
      if (value) usp.set(key, value);
    }
    const text = usp.toString();
    return `/admin/audit${text ? `?${text}` : ''}`;
  };

  const filtered = Boolean(action || entityType);

  return (
    <>
      <Head title="Audit trail">
        <Link className="btn btn--sm" href="/admin">
          Overview
        </Link>
      </Head>

      <Card title="What the trail holds">
        {overview.records === 0 ? (
          <p className="help">
            The archive has recorded no audit entry at all. That is the real state of
            <span className="mono"> ozikoro_audit</span>: it is written by the privileged write paths — an
            editorial status change, a role grant, a byline decision, a rights record — and a row appears here
            the first time one of them is used. An empty trail therefore means none of those has happened yet,
            not that the log was lost.
          </p>
        ) : (
          <>
            <AtAGlance
              rows={[
                ['Entries', overview.records.toLocaleString('en-GB')],
                ['Kinds of change', overview.actions.toLocaleString('en-GB')],
                ['Kinds of subject', overview.entityTypes.toLocaleString('en-GB')],
                ['Accounts that acted', overview.actors.toLocaleString('en-GB')],
                ['Entries with no actor recorded', overview.unattributed.toLocaleString('en-GB')],
                ['First entry', overview.earliest ? when(overview.earliest) : 'not recorded'],
                ['Most recent', overview.latest ? when(overview.latest) : 'not recorded'],
              ]}
            />
            <p className="help">
              <strong>An entry that names no actor is shown rather than hidden.</strong> Some writes were made
              by scripts that had no signed-in account to attribute them to, and a trail that quietly dropped
              those rows would look complete while the least accountable changes were the ones missing from it.
            </p>
          </>
        )}
      </Card>

      {overview.records > 0 ? (
        <Card title="The trail">
          <form method="get" action="/admin/audit" className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
            <label className="visually-hidden" htmlFor="action">Kind of change</label>
            <select id="action" name="action" defaultValue={action ?? ''}>
              <option value="">Every kind of change</option>
              {overview.byAction.map((a) => (
                <option key={a.action} value={a.action}>
                  {ACTION_LABEL[a.action] ?? a.action} ({a.n})
                </option>
              ))}
            </select>
            <label className="visually-hidden" htmlFor="entity">Subject</label>
            <select id="entity" name="entity" defaultValue={entityType ?? ''}>
              <option value="">Every subject</option>
              {overview.byEntityType.map((e) => (
                <option key={e.entityType} value={e.entityType}>
                  {subjectName(e.entityType)} ({e.n})
                </option>
              ))}
            </select>
            <button className="btn btn--sm btn--primary" type="submit">Apply</button>
          </form>

          {trail.entries.length === 0 ? (
            <p className="help" style={{ marginTop: '1rem' }}>
              Nothing matches that filter. The trail holds {overview.records.toLocaleString('en-GB')} entries
              and none of them is this combination.
            </p>
          ) : (
            <>
              <p className="small muted" style={{ marginTop: '0.75rem' }}>
                {trail.total.toLocaleString('en-GB')} {trail.total === 1 ? 'entry' : 'entries'}
                {trail.total > PAGE_SIZE ? `, showing ${trail.entries.length} on page ${page} of ${lastPage}` : ''}
              </p>

              <table className="record" style={{ marginTop: '0.5rem' }}>
                <thead>
                  <tr>
                    <th scope="col">When (UTC)</th>
                    <th scope="col">What changed</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Who</th>
                  </tr>
                </thead>
                <tbody>
                  {trail.entries.map((entry) => {
                    const summary = change(entry);
                    return (
                      <tr key={entry.id}>
                        <td className="small">{when(entry.createdAt)}</td>
                        <td className="small">
                          {ACTION_LABEL[entry.action] ?? entry.action}
                          <div className="history__when mono">{entry.action}</div>
                          {summary ? <div className="history__when">{summary}</div> : null}
                          {entry.note ? <div className="history__when">{entry.note}</div> : null}
                        </td>
                        <td className="small">
                          {subjectName(entry.entityType)}
                          <div className="history__when mono">
                            {entry.entityType} #{entry.entityId}
                          </div>
                        </td>
                        <td className="small">
                          {entry.actorEmail ? (
                            <>
                              {entry.actorName ?? entry.actorEmail}
                              <div className="history__when">{entry.actorEmail}</div>
                            </>
                          ) : (
                            <>
                              no actor recorded
                              <div className="history__when">
                                written by a script or a migration, which had no account to attribute it to
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <nav className="row" style={{ marginTop: '1rem' }} aria-label="Pagination">
                {page > 1 ? (
                  <Link className="btn btn--sm" href={query({ page: String(page - 1) })}>← Previous</Link>
                ) : <span />}
                <span className="small muted">page {page} of {lastPage}</span>
                {page < lastPage ? (
                  <Link className="btn btn--sm" href={query({ page: String(page + 1) })}>Next →</Link>
                ) : <span />}
              </nav>
            </>
          )}

          {filtered ? (
            <p className="help">
              <Link href="/admin/audit">Clear the filter</Link> to see the whole trail.
            </p>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
