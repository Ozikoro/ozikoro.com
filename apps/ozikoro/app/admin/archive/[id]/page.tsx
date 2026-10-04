/**
 * One record, and the four things the archive still needs to say about it.
 *
 * The screen is a form per facet rather than one large form, because they are separate decisions an
 * editor makes at different moments and sometimes minutes apart: which clan this history is about,
 * what period it covers, what kind of source it rests on, and which sources it cites. Splitting them
 * means a partial answer is still saved, which matters across 1,051 records.
 *
 * The dictionary's clans are offered as a pick-list rather than a text box. Ozituma already holds
 * 228 clans and their towns, and the plan is explicit that this must not be duplicated — so the
 * common case is choosing the record that already exists, and free text is the exception.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import {
  ROLE_LABEL_ENTITY,
  SOURCE_TYPE_LABEL,
  getArticleFacets,
  getArticleHistory,
  listTopics,
  searchDictionaryPlaces,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head, Notices } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function EditRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const notices = await searchParams;
  const articleId = Number.parseInt(id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();

  // The page's own guard, FIRST and before the record is read: this screen holds one record's body, its
  // sources and its edit history, and the layout's guard does not stop it rendering. See
  // `requireCapabilityOrRedirect`.
  await requireCapabilityOrRedirect('edit_entity', `/admin/archive/${articleId}`);

  const db = await getDb();
  const facets = await getArticleFacets(db, articleId);
  if (!facets) notFound();

  const [topics, history, places] = await Promise.all([
    listTopics(db),
    getArticleHistory(db, articleId, 20),
    searchDictionaryPlaces(db, '', 300),
  ]);

  return (
    <>
      <Head title={facets.title}>
        <Link className="btn btn--sm" href="/admin/archive">Back to the queue</Link>
        <Link className="btn btn--sm" href={`/${facets.slug}/`}>View the record</Link>
      </Head>

      <Notices saved={notices.saved} error={notices.error} />

      <Card title="What this record is">
        <p className="small muted">
          {facets.slug} · {facets.entities.length} entities · {facets.sources.length} sources · status {facets.status}
        </p>

        <form method="post" action="/api/admin/archive">
          <input type="hidden" name="action" value="save-facets" />
          <input type="hidden" name="articleId" value={facets.id} />

          <div className="wpgrid">
            <div className="wpfield">
              <label htmlFor="topicId">Series</label>
              <select id="topicId" name="topicId" defaultValue={facets.topicId ?? ''}>
                <option value="">— none —</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="wpfield">
              <label htmlFor="sourceType">Source type</label>
              <select id="sourceType" name="sourceType" defaultValue={facets.sourceType ?? ''}>
                <option value="">— not recorded —</option>
                {Object.entries(SOURCE_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <p className="wphelp">
                What the record rests on. Oral history carries the same standing as the others; this
                states which kind it is, it does not rank it.
              </p>
            </div>

            <div className="wpfield">
              <label htmlFor="periodLabel">Period</label>
              <input id="periodLabel" name="periodLabel" type="text" defaultValue={facets.periodLabel ?? ''} placeholder="e.g. Pre-colonial, 19th century" maxLength={120} />
            </div>

            <div className="wpfield">
              <label htmlFor="periodStart">Period start (year)</label>
              <input id="periodStart" name="periodStart" type="number" defaultValue={facets.periodStart ?? ''} min={-5000} max={2100} />
            </div>

            <div className="wpfield">
              <label htmlFor="periodEnd">Period end (year)</label>
              <input id="periodEnd" name="periodEnd" type="number" defaultValue={facets.periodEnd ?? ''} min={-5000} max={2100} />
              <p className="wphelp">Leave both years empty when the record only has a period name.</p>
            </div>

            <div className="wpfield">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={facets.status}>
                <option value="draft">Draft</option>
                <option value="review">In review</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
            <button className="btn btn--primary" type="submit">Save what this record is</button>
          </p>
        </form>
      </Card>

      <Card title={`Clan, town and place (${facets.entities.length})`}>
        {facets.entities.length > 0 ? (
          <ul className="history">
            {facets.entities.map((e) => (
              <li key={`${e.id}-${e.role}`} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span>
                  <strong>{e.name}</strong> <span className="small muted">{e.kind} · {ROLE_LABEL_ENTITY[e.role]}</span>
                </span>
                <form method="post" action="/api/admin/archive" style={{ marginLeft: 'auto' }}>
                  <input type="hidden" name="action" value="detach-entity" />
                  <input type="hidden" name="articleId" value={facets.id} />
                  <input type="hidden" name="entityId" value={e.id} />
                  <input type="hidden" name="role" value={e.role} />
                  <button className="btn btn--sm btn--danger" type="submit">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">
            Nothing links this record to a people, a clan or a place yet. The brief requires it: a
            reader should be able to move from a history to the clan and the town it belongs to.
          </p>
        )}

        <form method="post" action="/api/admin/archive" style={{ marginTop: '1.25rem' }}>
          <input type="hidden" name="action" value="attach-place" />
          <input type="hidden" name="articleId" value={facets.id} />
          <div className="wpgrid">
            <div className="wpfield">
              <label htmlFor="clanId">From the dictionary (recommended)</label>
              <select id="clanId" name="clanId" defaultValue="">
                <option value="">— choose a clan —</option>
                {places.map((p) => (
                  <option key={p.clanId} value={p.clanId}>
                    {p.clanName}{p.tribe ? ` · ${p.tribe}` : ''}{p.states.length > 0 ? ` · ${p.states.join(', ')}` : ''}
                  </option>
                ))}
              </select>
              <p className="wphelp">
                These are Ozituma&apos;s own {places.length} clans. Choosing one links this record to
                the dictionary rather than creating a second copy of the same place.
              </p>
            </div>
            <div className="wpfield">
              <label htmlFor="townName">…or a town inside that clan</label>
              <input id="townName" name="townName" type="text" placeholder="optional town" maxLength={120} />
            </div>
            <div className="wpfield">
              <label htmlFor="entityRole">Role in this record</label>
              <select id="entityRole" name="role" defaultValue="clan">
                {Object.entries(ROLE_LABEL_ENTITY).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
            <button className="btn btn--primary" type="submit">Link it</button>
          </p>
        </form>
      </Card>

      <Card title={`Sources (${facets.sources.length})`}>
        {facets.sources.length > 0 ? (
          <ul className="history">
            {facets.sources.map((s) => (
              <li key={s.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span>
                  <strong>{s.title}</strong>{' '}
                  <span className="small muted">
                    {s.kind.replace(/_/g, ' ')}
                    {s.evidenceType ? ` · ${s.evidenceType.replace(/_/g, ' ')}` : ''} · {s.stance}
                  </span>
                </span>
                <form method="post" action="/api/admin/archive" style={{ marginLeft: 'auto' }}>
                  <input type="hidden" name="action" value="detach-source" />
                  <input type="hidden" name="articleId" value={facets.id} />
                  <input type="hidden" name="sourceId" value={s.id} />
                  <button className="btn btn--sm btn--danger" type="submit">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="help">
            No source is attached, so the record renders the archive&apos;s &ldquo;no sources
            attached yet&rdquo; note on its own page. That is the honest state, and attaching one is
            what clears it.
          </p>
        )}

        <form method="post" action="/api/admin/archive" style={{ marginTop: '1.25rem' }}>
          <input type="hidden" name="action" value="attach-source" />
          <input type="hidden" name="articleId" value={facets.id} />
          <div className="wpgrid">
            <div className="wpfield">
              <label htmlFor="title">Title</label>
              <input id="title" name="title" type="text" required maxLength={400} placeholder="The work being cited" />
            </div>
            <div className="wpfield">
              <label htmlFor="kind">Kind</label>
              <select id="kind" name="kind" defaultValue="book">
                {['book','journal_article','chapter','thesis','dissertation','report','archive_document','colonial_record','oral_history','interview','newspaper','website','dataset','photograph','audio','video','manuscript','catalogue','other'].map((k) => (
                  <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="wpfield">
              <label htmlFor="authors">Author(s), comma separated</label>
              <input id="authors" name="authors" type="text" maxLength={400} />
            </div>
            <div className="wpfield">
              <label htmlFor="year">Year</label>
              <input id="year" name="year" type="number" min={-5000} max={2100} />
            </div>
            <div className="wpfield">
              <label htmlFor="publisher">Publisher or holding archive</label>
              <input id="publisher" name="publisher" type="text" maxLength={200} />
            </div>
            <div className="wpfield">
              <label htmlFor="evidenceType">Evidence type</label>
              <select id="evidenceType" name="evidenceType" defaultValue="scholarly_interpretation">
                {['archaeological','primary_source','oral_history','linguistic','anthropological','genetic','historical_document','scholarly_interpretation','traditional_account','disputed','unverified'].map((e) => (
                  <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="wpfield">
              <label htmlFor="licence">Licence or rights</label>
              <input id="licence" name="licence" type="text" maxLength={200} placeholder="leave empty if not established" />
              <p className="wphelp">Leave empty rather than guessing. An unrecorded right is not an absent one.</p>
            </div>
            <div className="wpfield">
              <label htmlFor="stance">How the record uses it</label>
              <select id="stance" name="stance" defaultValue="supports">
                <option value="supports">Supports</option>
                <option value="contradicts">Contradicts</option>
                <option value="qualifies">Qualifies</option>
                <option value="context">Context</option>
              </select>
            </div>
          </div>
          <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
            <button className="btn btn--primary" type="submit">Attach the source</button>
          </p>
        </form>
      </Card>

      <Card title="What has been changed, and by whom">
        {history.length === 0 ? (
          <p className="help">Nothing has been changed on this record since it was migrated.</p>
        ) : (
          <ul className="history">
            {history.map((h, i) => (
              <li key={`${h.createdAt}-${i}`}>
                <div className="history__when">{new Date(h.createdAt).toISOString()} · {h.actorEmail ?? 'system'}</div>
                <p className="history__what">{h.action.replace(/_/g, ' ')}</p>
                {h.after ? <p className="history__detail">{JSON.stringify(h.after)}</p> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="help">
          Every change to a record is recorded with the person who made it. Nothing in the archive is
          overwritten silently.
        </p>
      </Card>

      {/*
        THE EARLIER WORDING OF THIS RECORD, WHICH IS A DIFFERENT THING FROM WHO CHANGED IT.
        The card above is `ozikoro_audit` — this archive's own record of its own edits. This link leads
        to the WordPress versions of the same article, imported in round 341 because the archive had no
        table for them and the superseded editorial text of the histories was being lost. They are two
        cards because they answer two questions: "who changed this?" and "what did it say before?"
      */}
      <Card title="What this record said before">
        <p className="help">
          WordPress kept every version of this article as its editors worked, and those versions are now
          held in the archive. The revisions carrying text that appears in no other record are marked in
          the list.
        </p>
        <p>
          <Link className="btn btn--sm" href={`/admin/archive/${articleId}/revisions`}>
            Read the revision history
          </Link>
        </p>
      </Card>
    </>
  );
}
