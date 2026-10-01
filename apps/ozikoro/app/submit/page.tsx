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
import { STATE_LABEL, getMember, listByAccount } from '@ozikoro/platform';
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

  const hasProfile = Boolean(member?.institution || member?.headline || member?.researchInterests.length);

  return (
    <div className="wrap section">
      <header>
        <p className="eyebrow">The research network</p>
        <h1>Submit research</h1>
        <p className="lede">
          A working paper, a conference paper, a thesis chapter or a journal article. It does not have
          to be published elsewhere first, and it does not have to come from a university.
        </p>
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

      <form method="post" action="/api/research" className="section">
        <input type="hidden" name="action" value="create" />
        <input type="hidden" name="returnTo" value="/submit/" />

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
          <div className="wpfield">
            <label htmlFor="licence">Licence</label>
            <input id="licence" name="licence" type="text" maxLength={200} placeholder="e.g. CC BY 4.0" />
          </div>
        </div>

        <div className="wpfield">
          <label htmlFor="abstract">Abstract</label>
          <textarea id="abstract" name="abstract" rows={8} maxLength={5000} />
        </div>

        <p className="wpcard-foot" style={{ border: '1px solid #c3c4c7', borderRadius: 4 }}>
          <button className="btn" type="submit">Save as a draft</button>{' '}
          <button className="btn btn--primary" type="submit" name="submit" value="1">Submit for review</button>
        </p>
      </form>

      <div className="partial-note section">
        <p className="eyebrow">Manuscript files</p>
        <p>
          Uploading a PDF is not open yet — the storage for it is not connected, and a control that
          quietly discarded your file would be worse than not offering one. Until it is, the abstract
          and the metadata are the record, and you can link to the manuscript where it already lives.
        </p>
      </div>

      <section className="section">
        <p className="eyebrow">Your work</p>
        {works.length === 0 ? (
          <p className="help">Nothing yet. A draft you save here is private until you submit it.</p>
        ) : (
          <table className="record">
            <thead>
              <tr><th scope="col">Title</th><th scope="col">State</th><th scope="col">Review</th></tr>
            </thead>
            <tbody>
              {works.map((w) => (
                <tr key={w.id}>
                  <td>
                    {w.status === 'published' && w.isPublic
                      ? <Link href={w.url}>{w.title}</Link>
                      : <span>{w.title}</span>}
                    <div className="history__when">version {w.currentVersion} · {w.kind.replace(/_/g, ' ')}</div>
                  </td>
                  <td className="small">{STATE_LABEL[w.status]}</td>
                  <td className="small">
                    {w.status === 'published' || w.status === 'archived'
                      ? (w.peerReviewed ? 'peer-reviewed' : 'not peer-reviewed')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
