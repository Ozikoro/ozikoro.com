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
 *
 * ── WHY THIS SCREEN IS ONE SEGMENT DOWN, AT `/admin/archive/<id>/record` ────────────────────────────
 *
 * The owner asked for the WordPress Classic Editor and named the address he had opened: *"this is a
 * page https://ozikoro.com/admin/archive/2154 and it does not look like classic editor dashboard"*.
 * So `/admin/archive/<id>` now redirects to the piece's editing screen, and **this** screen — the
 * clan, the period, the source type and the citations — moved to `<id>/record`, where the editorial
 * queue and the editor's own sidebar link to it.
 *
 * They are two different questions about the same record and neither address is a fallback for the
 * other: the editor writes what the record SAYS, and this screen writes what it is ABOUT. The
 * sub-pages that were already below the record — `/revisions`, `/orphan-revisions` — are unmoved.
 */
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import {
  ARTICLE_DECISION_LABEL,
  ROLE_LABEL_ENTITY,
  SOURCE_TYPE_LABEL,
  decisionsAvailable,
  getArticleContent,
  getArticleFacets,
  getArticleHistory,
  listHumanRevisions,
  listTopics,
  sanitiseArchiveHtml,
  searchDictionaryPlaces,
  mediaUrlResolver,
  rewriteBodyImages,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';
import { Card, Head, Notices } from '../../../ui';

export const dynamic = 'force-dynamic';

export default async function EditRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; info?: string }>;
}) {
  const { id } = await params;
  const notices = await searchParams;
  const articleId = Number.parseInt(id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) notFound();

  // The page's own guard, FIRST and before the record is read: this screen holds one record's body, its
  // sources and its edit history, and the layout's guard does not stop it rendering. See
  // `requireCapabilityOrRedirect`.
  await requireCapabilityOrRedirect('edit_entity', `/admin/archive/${articleId}/record`);

  const db = await getDb();
  const facets = await getArticleFacets(db, articleId);
  if (!facets) notFound();

  const [topics, history, places, content, humanRevisions] = await Promise.all([
    listTopics(db),
    getArticleHistory(db, articleId, 20),
    searchDictionaryPlaces(db, '', 300),
    getArticleContent(db, articleId),
    listHumanRevisions(db, articleId, 10),
  ]);

  /*
   * WHAT THE READER GETS, RENDERED FROM WHAT IS STORED.
   *
   * The body is passed through `sanitiseArchiveHtml` here for the same reason the served article page does:
   * this is markup that becomes a live document, and a preview assembled by string concatenation would be a
   * second renderer with its own holes. **The preview is not a separate trust decision** — it is the
   * sanitiser's output, which is what a reader is shown.
   *
   * It is rendered inside `.prose` so it wears the design's reading measure and type scale, which is the
   * whole point of showing it: a body that looks right in a textarea and wrong on the page is the fault
   * class this screen exists to catch.
   */
  const preview = sanitiseArchiveHtml(rewriteBodyImages(content?.bodyHtml ?? '', await mediaUrlResolver(db)));
  const words = (html: string) => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  /*
   * The decisions offered are computed from the SAME table `decideArticleStatus` consults, so a button
   * cannot appear for a transition the write would refuse. Presentation and rule agree because they are one
   * function, not two copies of a list.
   */
  const decisions = decisionsAvailable(facets.status);
  const STATUS_LABEL: Record<string, string> = {
    draft: 'Draft', review: 'In review', published: 'Published', archived: 'Archived', trashed: 'In the trash',
  };

  return (
    <>
      <Head title={facets.title}>
        <a className="btn btn--sm" href="/admin/archive">Back to the queue</a>
        <a className="btn btn--sm" href={`/admin/archive/${articleId}`}>Edit the text</a>
        <a className="btn btn--sm" href={`/${facets.slug}/`}>View the record</a>
      </Head>

      <Notices saved={notices.saved} error={notices.error} info={notices.info} />

      {/*
        THE RECORD'S OWN WORDS — THE FIRST THING ON THE PAGE, BECAUSE IT IS WHAT THE RECORD IS.

        This card did not exist anywhere in the archive. `body_html` was import-only and the title and
        summary had no write path from the site at all, so a record whose text arrived mangled could be read
        and not corrected. The fields are the three the archive stores and a reader reads; everything else on
        this screen is what the record is ABOUT.

        `standfirst` CARRIES A WARNING RATHER THAN A LABEL. Round 352 measured that all thirteen
        film-holding records carry a truncated, tag-stripped window of the body in this field — the import
        filled it that way — so an editor meeting it needs to know that its current content is the archive's
        own text mangled by a migration, and that a summary is what it is FOR. The hint says so in the
        place where the decision is made.
      */}
      <Card title="What this record says">
        <form method="post" action="/api/admin/archive">
          <input type="hidden" name="action" value="save-content" />
          <input type="hidden" name="articleId" value={articleId} />

          <div className="wpfield">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              name="title"
              type="text"
              required
              maxLength={300}
              defaultValue={content?.title ?? facets.title}
            />
            <p className="wphelp">
              The record&apos;s name, and what a citation names it by. Changing it does not change the
              record&apos;s address: <span className="mono">/{facets.slug}/</span> stays as it is, because
              published addresses are kept.
            </p>
          </div>

          <div className="wpfield wpfield--wide">
            <label htmlFor="standfirst">Summary — the &ldquo;Historical context&rdquo; line</label>
            <textarea
              id="standfirst"
              name="standfirst"
              rows={4}
              maxLength={2000}
              defaultValue={content?.standfirst ?? ''}
            />
            <p className="wphelp">
              This is the record&apos;s own sentence about itself. It appears under the heading on the page
              as <strong>Historical context</strong>, and in a search result as the description.
              <br />
              <strong>If it currently holds a truncated copy of the body, that is the import&apos;s
              doing, not the author&apos;s.</strong> The thirteen records that hold a film carry a
              tag-stripped window cut out of their own text, and the reader-facing code has to branch on
              whether this field is a real summary or one of those. Writing a summary here removes the reason
              for that branch. Leave it empty rather than half-filling it.
            </p>
          </div>

          {/*
            THE BODY. A plain textarea, because the design draws no rich-text control for an existing
            record — its only drawn form is `upload.html`'s deposit flow, which serves here as
            `app/submit/page.tsx` and uses this same `.wpfield` shape.

            The hint states the two things an editor must know before typing: the text is HTML that renders,
            and the archive's own allowlist decides what survives.
          */}
          <div className="wpfield wpfield--wide">
            <label htmlFor="bodyHtml">
              The body — the record&apos;s own text
              {content ? <span className="mono"> · {content.wordCount.toLocaleString('en-GB')} words stored</span> : null}
            </label>
            <textarea
              id="bodyHtml"
              name="bodyHtml"
              rows={24}
              defaultValue={content?.bodyHtml ?? ''}
              spellCheck={false}
            />
            <p className="wphelp">
              This is HTML and it is rendered as HTML. Paragraphs are <span className="mono">&lt;p&gt;</span>,
              headings <span className="mono">&lt;h2&gt;</span> to <span className="mono">&lt;h4&gt;</span>,
              emphasis <span className="mono">&lt;strong&gt;</span> and <span className="mono">&lt;em&gt;</span>.
              <br />
              <strong>What is stripped before it is stored</strong>: script and style elements and everything
              inside them, embedded frames and objects, forms and inputs, every <span className="mono">on…</span>
              attribute, and any <span className="mono">javascript:</span> address. Inline{' '}
              <span className="mono">style</span>, <span className="mono">class</span> and{' '}
              <span className="mono">id</span> attributes are dropped as well, because the design&apos;s own
              stylesheet sets the reading measure and a saved page-builder width fights it. If a paste loses
              something, the save notice says so rather than reporting a clean save.
            </p>
          </div>

          <div className="wpfield">
            <label htmlFor="note">Why you changed it (optional)</label>
            <input id="note" name="note" type="text" maxLength={400} placeholder="e.g. fixed the caption the import truncated" />
            <p className="wphelp">
              Recorded with your account on the change. It is not required — a reason field that must be
              filled is answered with &ldquo;fix&rdquo;, which records less than an empty one.
            </p>
          </div>

          <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn--primary" type="submit">Save the record&apos;s own words</button>
            <span className="small muted">
              What it said before is copied into a revision first, in the same statement as this save.
            </span>
          </div>
        </form>
      </Card>

      {/*
        THE RECORD AS IT RENDERS, WHICH IS A DIFFERENT THING FROM THE RECORD AS IT STORES.

        A body that looks right in a textarea and wrong on the page is the fault class this project has
        produced all day, so the preview is on the same screen as the editor rather than one link away. It
        renders the STORED body through the same sanitiser the served page uses, so what is shown here is
        what a reader gets; the `<details>` keeps it out of the way until it is wanted.
      */}
      <Card title="How this record reads now">
        <details>
          <summary className="btn btn--sm" style={{ display: 'inline-block' }}>
            Show the stored body as a reader sees it
          </summary>
          {preview.trim() === '' ? (
            <p className="help">
              The stored body is empty. This record would render with no written record at all.
            </p>
          ) : (
            <>
              <p className="help">
                Rendered from the stored body through the archive&apos;s own sanitiser — not from the textarea
                above, which may hold unsaved edits. {words(preview).toLocaleString('en-GB')} words after
                sanitising.
              </p>
              <div className="prose" dangerouslySetInnerHTML={{ __html: preview }} />
            </>
          )}
        </details>
        <p className="help">
          The record&apos;s own page is where the design&apos;s frame is applied to this text:{' '}
          <a href={`/${facets.slug}/`}>open /{facets.slug}/</a>.
        </p>
      </Card>

      {humanRevisions.length > 0 ? (
        <Card title={`What people have changed here (${humanRevisions.length})`}>
          <ul className="history">
            {humanRevisions.map((r) => (
              <li key={r.id}>
                <div className="history__when">
                  {new Date(r.createdAt).toISOString()} · revision {r.id} · {r.actorEmail ?? 'account since deleted'}
                </div>
                <p className="history__what">
                  {r.title ?? '(no title)'} · {r.bodyBytes.toLocaleString('en-GB')} characters ·{' '}
                  {r.wordCount.toLocaleString('en-GB')} words
                </p>
                {r.note ? <p className="history__detail">{r.note}</p> : null}
              </li>
            ))}
          </ul>
          <p className="help">
            A revision holds the record as it stood BEFORE that save — its title, its summary and its whole
            body — and the account that made it. Nothing here was written by the WordPress import; those are
            listed separately under the revision history at the foot of this page.
          </p>
        </Card>
      ) : null}

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
          </div>

          <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
            <button className="btn btn--primary" type="submit">Save what this record is</button>
            <span className="small muted">
              The record&apos;s status is decided below, not here: publishing is an approval, not a facet.
            </span>
          </p>
        </form>
      </Card>

      {/*
        THE REVIEW DECISION — the one control the owner named as an editor's own.

        It replaces a `<select name="status">` that used to sit in the facets form above, where publishing was
        a side effect of changing a period, under an audit action called `update_facets`. The decision now has
        its own transition table, its own refusals and its own audit action; `updateArticleFacets` no longer
        accepts a status at all, so there is no second door.

        Every sentence below is a fact the code enforces rather than a reassurance: what is available is
        computed by `decisionsAvailable` from the same table the write consults, self-approval is a decision
        that is recorded rather than forbidden, and the absence of an un-publish control is stated where the
        person looking for it will read it.
      */}
      <Card title="The review decision">
        <p className="small muted">
          This record is <strong>{STATUS_LABEL[facets.status] ?? facets.status}</strong>.
        </p>

        {decisions.length === 0 ? (
          <p className="help">
            There is no decision available to a record that is {STATUS_LABEL[facets.status] ?? facets.status}.
            A record in the trash is recovered from <a href="/admin/trash">the trash</a> rather than
            decided here, and a trashed record is not published by a status change.
          </p>
        ) : (
          <form method="post" action="/api/admin/archive">
            <input type="hidden" name="action" value="decide-status" />
            <input type="hidden" name="articleId" value={articleId} />

            <div className="wpfield wpfield--wide">
              <label htmlFor="decisionNote">Reason (optional, and recorded with the decision)</label>
              <input id="decisionNote" name="decisionNote" type="text" maxLength={400} placeholder="e.g. sources checked against the district returns" />
            </div>

            <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
              {decisions.map((decision) => (
                <button
                  key={decision}
                  className={decision === 'approve' ? 'btn btn--primary' : 'btn'}
                  type="submit"
                  name="decision"
                  value={decision}
                >
                  {ARTICLE_DECISION_LABEL[decision]}
                </button>
              ))}
            </div>
          </form>
        )}

        <p className="wphelp">
          <strong>Approving publishes.</strong> `/[slug]/` serves a record only while its status is
          <span className="mono"> published</span>, so approving this one puts it in front of readers and gives
          it a publication date. <strong>An editor may approve their own edit</strong> — the archive holds one
          account, so a rule that required a second person to press the button would mean nothing could ever be
          published; instead the trail records that it was a self-approval, and the approval notice says so.
          <br />
          <strong>Unpublishing is here too</strong>, because it is the editor&apos;s: it returns a published
          record to draft, and the record&apos;s address stops resolving while it is out. That is the one act on
          this page that breaks a shared link, so it is a decision with a reason box rather than a toggle.
        </p>
      </Card>

      {/*
        THE DELETE, WHICH IS A MOVE.
        Shown only while the record is not already in the bin. Its wording is the mechanism stated truthfully:
        nothing is destroyed, the relations are left where they are, and the record's own address stops
        answering until it is restored. The destructive act — the purge — is deliberately NOT offered here:
        it lives on the trash screen, behind its own capability, with a confirmation that names the record.
      */}
      {facets.status === 'trashed' ? (
        <Card title="In the trash">
          <p>
            This record is in the trash. It is not served at its own address and it does not appear in the
            archive. Nothing about it was destroyed — its entities, its sources and its revision history are
            where they were — and restoring it returns it to the state it was in.
          </p>
          <p>
            <a className="btn btn--sm btn--primary" href="/admin/trash">Open the trash to restore it</a>
          </p>
        </Card>
      ) : (
        <Card title="Delete" quiet>
          <form method="post" action="/api/admin/archive">
            <input type="hidden" name="action" value="trash" />
            <input type="hidden" name="articleId" value={articleId} />
            <div className="wpfield">
              <label htmlFor="trashNote">Why you are deleting it (optional)</label>
              <input id="trashNote" name="note" type="text" maxLength={400} />
              <p className="wphelp">
                <strong>This moves the record to the trash; it does not destroy it.</strong> The record stops
                being served at its own address and leaves the archive, its entities, its sources and its whole
                revision history stay where they are, and anyone with the archive&apos;s permission can restore
                it. <strong>Destroying it for good is a separate act on the trash screen</strong> and needs a
                permission this screen does not.
              </p>
            </div>
            <button className="btn btn--danger" type="submit">Move this record to the trash</button>
          </form>
        </Card>
      )}

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
          <a className="btn btn--sm" href={`/admin/archive/${articleId}/revisions`}>
            Read the revision history
          </a>
        </p>
      </Card>
    </>
  );
}
