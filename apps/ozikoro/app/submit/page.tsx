/**
 * Submitting a work.
 *
 * The design draws this as an upload and publish flow. What it is underneath is the first two states
 * of the workflow: a draft is private and a submission is not, and they are separate buttons rather
 * than one, because collapsing them would mean every half-finished form had been "submitted".
 *
 * The list below the form is the author's own work at every state, including the drafts nobody else
 * can see. That is the point of signing in here: a researcher needs to see what they have in flight
 * before they need to see anybody else's.
 *
 * File upload is not wired to object storage yet, and the page says so rather than showing a control
 * that would silently discard the file.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';
import {
  ACCEPTED_FILE_LABEL,
  MAX_MANUSCRIPT_BYTES,
  STATE_LABEL,
  getMember,
  humanSize,
  listByAccount,
  listPublicationFiles,
} from '@ozikoro/platform';
import { requireCapabilityOrRedirect } from '@/lib/access';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Submit research',
  robots: { index: false, follow: false },
};

const KINDS = ['journal_article','conference_paper','chapter','book','thesis','dissertation','preprint','working_paper','report','research_note','dataset','review','other'];

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const notices = await searchParams;
  // Pages render or redirect; they never return a Response. See `requireCapabilityOrRedirect`.
  const guard = await requireCapabilityOrRedirect('submit_work', '/submit/');

  const db = await getDb();
  const [member, works] = await Promise.all([
    getMember(db, guard.account.account.id),
    listByAccount(db, guard.account.account.id, { includePrivate: true }),
  ]);

  /*
   * EACH WORK'S FILES, READ ONCE FOR THE WHOLE PAGE.
   *
   * A query per row would be N+1 on a list that grows with how much somebody has published, and the
   * page needs the files twice: to show what is attached, and to decide whether the upload control
   * should offer to replace or add. One query per work is fine at this size and the loop is here
   * rather than in the markup so the page component stays a rendering of facts it was given.
   */
  const filesByWork = new Map<number, Awaited<ReturnType<typeof listPublicationFiles>>>();
  for (const work of works) {
    filesByWork.set(work.id, await listPublicationFiles(db, work.id));
  }

  const hasProfile = Boolean(member?.institution || member?.headline || member?.researchInterests.length);

  return (
    <div className="wrap-narrow section">
      <header>
        <p className="eyebrow">Researchers Network</p>
        <h1>Publish your work</h1>
        <p className="lede">
          A paper is findable here by topic, by author and by institution. Describing it well is
          most of the work. It does not have to be published elsewhere first, and it does not have to
          come from a university.
        </p>
        <ol className="steps">
          <li>The file</li>
          <li>Describe it</li>
          <li>Terms &amp; access</li>
          <li>Review &amp; publish</li>
        </ol>
      </header>

      {notices.saved ? <div className="notice notice--success" role="status"><div><p className="notice__body">{notices.saved}</p></div></div> : null}
      {notices.error ? <div className="notice notice--error" role="alert"><div><p className="notice__body">{notices.error}</p></div></div> : null}

      {!hasProfile ? (
        <div className="partial-note section">
          <p className="eyebrow">Your profile</p>
          <p>
            You have no public profile yet, so a published work would credit a name with nothing
            behind it. That is allowed — but a profile is what makes you findable, which is the point
            of the network.
          </p>
        </div>
      ) : null}

      <form method="post" action="/api/research">
        <input type="hidden" name="action" value="create" />
        <input type="hidden" name="returnTo" value="/submit/" />

        <section>
          <h2>1 · The file</h2>
          {/*
            THE UPLOAD IS ATTACHED TO A WORK, AND IT SAYS SO.
            A manuscript with no work behind it would be a file with no record, no authors and no
            licence — so the form below saves the description first and this section explains that.
            The upload control itself is on each work, further down, where the work it belongs to is
            named rather than chosen from a list.
          */}
          <div className="dropzone">
            <p>
              <strong>A manuscript is attached to a work.</strong> Describe it below and save it as a
              draft — the metadata is the record, and it is what makes the file findable. You can then
              attach the PDF or document to that work from the list at the foot of this page, at any
              point before or after you submit it.
            </p>
          </div>
          <div className="card">
            <p className="small muted">
              Accepted: {ACCEPTED_FILE_LABEL}. Up to{' '}
              {Math.round(MAX_MANUSCRIPT_BYTES / (1024 * 1024))} MB. A document, photograph, map or
              recording that is not part of a paper goes through a different route, because those carry
              different rights.
            </p>
          </div>
        </section>

        <section>
          <h2>2 · Describe it</h2>
          <p className="small muted">
            Fields marked with an asterisk are required. These are the fields search runs on.
          </p>
          <div className="wpgrid">
          <div className="wpfield">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" type="text" required maxLength={400} />
          </div>
          <div className="wpfield">
            <label htmlFor="authors">Authors, comma separated, in order</label>
            <input id="authors" name="authors" type="text" required maxLength={1000} placeholder="Your name first, then co-authors" />
            <p className="wphelp">A co-author without an account here is fine and normal.</p>
          </div>
          <div className="wpfield">
            <label htmlFor="kind">Type</label>
            <select id="kind" name="kind" defaultValue="journal_article">
              {KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="wpfield">
            <label htmlFor="disciplines">Disciplines, comma separated</label>
            <input id="disciplines" name="disciplines" type="text" maxLength={400} placeholder="History, Archaeology" />
          </div>
          <div className="wpfield">
            <label htmlFor="keywords">Keywords, comma separated</label>
            <input id="keywords" name="keywords" type="text" maxLength={400} />
          </div>
          <div className="wpfield">
            <label htmlFor="doi">DOI, if you have one</label>
            <input id="doi" name="doi" type="text" maxLength={120} placeholder="10.1234/abcde" />
            <p className="wphelp">Leave it empty rather than pasting a URL. A wrong DOI in a citation is worse than none.</p>
          </div>
          <div className="wpfield">
            <label htmlFor="journal">Journal or venue</label>
            <input id="journal" name="journal" type="text" maxLength={200} />
          </div>
          <div className="wpfield">
            <label htmlFor="volume">Volume / issue / pages</label>
            <div className="row">
              <input id="volume" name="volume" type="text" maxLength={20} placeholder="vol" />
              <input id="issue" name="issue" type="text" maxLength={20} placeholder="no" />
              <input id="pages" name="pages" type="text" maxLength={40} placeholder="pp" />
            </div>
          </div>
        </div>

        <div className="wpfield">
          <label htmlFor="abstract">Abstract</label>
          <textarea id="abstract" name="abstract" rows={8} maxLength={5000} />
        </div>
        </section>

        <section>
          <h2>3 · Terms and access</h2>
          <fieldset className="field">
            <legend>Licence and access</legend>
            <div className="wpfield">
              <label htmlFor="licence">Licence</label>
              <input id="licence" name="licence" type="text" maxLength={200} placeholder="e.g. CC BY 4.0" />
              <p className="wphelp">
                Leave it empty if you have not chosen one. The archive will not apply a licence on your behalf,
                and a licence you did not choose is worse than none.
              </p>
            </div>
          </fieldset>
          <div className="provenance">
            <p className="small muted">
              You keep the copyright in your work. Depositing it here grants the archive permission to hold and
              display it, not ownership of it, and you may withdraw it.
            </p>
          </div>
        </section>

        <section>
          <h2>4 · Review and publish</h2>
          <div className="card">
            <p className="small muted">
              A draft is private and a submission is not. They are separate buttons because collapsing them
              would mean every half-finished form had been submitted.
            </p>
          </div>
          <div className="row">
            <button className="btn" type="submit">Save as a draft</button>
            <button className="btn btn-gold" type="submit" name="submit" value="1">Submit for review</button>
          </div>
        </section>
      </form>

      <section className="sx-correction">
        <div>
          <p className="eyebrow">Correct or add community knowledge</p>
          <h2>Help complete an existing record</h2>
          <p>
            Point to the page, explain what should be added or corrected, and state how you know. A correction
            carries its author and its reason; changes are logged, never hidden.
          </p>
          <div className="row">
            <Link className="btn" href="/claims">Start a correction</Link>
            <Link className="btn btn-quiet" href="/search">Find the record</Link>
          </div>
        </div>
      </section>

      <section className="empty">
        <h3>Depositing archive material instead?</h3>
        <p>
          Documents, photographs, maps and recordings go through a different route, because they carry
          different rights and often a different holder. Access, reuse and consent are agreed before anything
          is published.
        </p>
        <div className="row">
          <Link className="btn" href="/about">How material is held</Link>
          <Link className="btn btn-quiet" href="/about">Talk to the archive</Link>
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Your work, and its files</p>
        {works.length === 0 ? (
          <p className="help">Nothing yet. A draft you save here is private until you submit it.</p>
        ) : (
          <ul className="stack-lg">
            {works.map((w) => {
              const files = filesByWork.get(w.id) ?? [];
              /*
               * AN ARCHIVED WORK CANNOT TAKE A FILE.
               *
               * `attachPublicationFile` refuses it, because an archived version is the record of what
               * was published and changing it would change what a citation resolves to. **The form is
               * not rendered for that case rather than rendered and refused** — a control whose only
               * outcome is an error teaches the reader nothing and wastes their upload.
               */
              const mayAttach = w.status !== 'archived';
              return (
                <li key={w.id}>
                  <table className="record">
                    <thead>
                      <tr>
                        <th scope="col">Work</th>
                        <th scope="col">State</th>
                        <th scope="col">Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          {w.status === 'published' && w.isPublic
                            ? <Link href={w.url}>{w.title}</Link>
                            : <span>{w.title}</span>}
                          <div className="history__when">
                            version {w.currentVersion} · {w.kind.replace(/_/g, ' ')}
                          </div>
                        </td>
                        <td className="small">{STATE_LABEL[w.status]}</td>
                        <td className="small">
                          {w.status === 'published' || w.status === 'archived'
                            ? (w.peerReviewed ? 'peer-reviewed' : 'not peer-reviewed')
                            : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {files.length > 0 ? (
                    <ul className="history">
                      {files.map((f) => (
                        <li key={f.id}>
                          <p className="history__what">
                            <a href={`/publication-file/${f.id}`}>{f.filename}</a>
                          </p>
                          <p className="history__detail">
                            {f.role.replace(/_/g, ' ')} · {f.typeLabel} · {humanSize(f.sizeBytes)}
                            {f.checksum ? ` · sha256 ${f.checksum.slice(0, 12)}…` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="help">No file attached to this work yet.</p>
                  )}

                  {mayAttach ? (
                    /*
                     * A PLAIN multipart FORM, AS THE DASHBOARD BRIEF REQUIRES — it works with
                     * JavaScript disabled, which is the same constraint every other form on this site
                     * carries. `enctype` is the only attribute that matters here.
                     */
                    <form method="post" action="/api/research/files" encType="multipart/form-data">
                      <input type="hidden" name="publicationId" value={w.id} />
                      <input type="hidden" name="returnTo" value="/submit/" />
                      <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div className="field">
                          <label className="small" htmlFor={`manuscript-${w.id}`}>
                            Attach a file to this work
                          </label>
                          <input
                            id={`manuscript-${w.id}`}
                            name="manuscript"
                            type="file"
                            accept=".pdf,.docx,.odt,.rtf,.txt,.md,.png,.jpg,.jpeg"
                            required
                          />
                        </div>
                        <div className="field">
                          <label className="small" htmlFor={`role-${w.id}`}>What it is</label>
                          <select id={`role-${w.id}`} name="role" defaultValue="manuscript">
                            <option value="manuscript">The manuscript</option>
                            <option value="supplementary">A supplement</option>
                            <option value="figure">A figure</option>
                            <option value="dataset">A dataset</option>
                            <option value="cover">A cover image</option>
                          </select>
                        </div>
                        <button className="btn" type="submit">Upload</button>
                      </div>
                    </form>
                  ) : (
                    <p className="help">
                      This work is archived. Its files are part of the published record and cannot be
                      added to — a revision is what changes a work, and it keeps the earlier version.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
