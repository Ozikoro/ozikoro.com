/**
 * Projects — the work Ozi Ikoro Limited has embarked on, in the open.
 *
 * NO PROJECT RECORDS EXIST, AND THE DESIGN'S OWN NOTICE SAYS WHY THAT MATTERS
 *
 * `screens/projects.html` shows six example projects with figures under them, and carries this notice:
 * *"Project titles reflect work visible on ozikoro.com; progress figures, budgets and dates are example
 * material until Ozi Ikoro Limited supplies verified figures."*
 *
 * **The schema has no project table at all** — measured: no `%project%` table exists and
 * `ozikoro_publication` has no project column. So there is nowhere for a project record to live, and the
 * six example projects are not reproduced: their titles may describe real work, but their **figures are
 * declared example material**, and a project page whose only substance is its progress, dates and budget
 * would be example material wearing a real title.
 *
 * WHAT THE PAGE DOES INSTEAD
 *
 * It lists the fields a project record will carry, taken from the design's own detail screen — purpose, what
 * the work includes, outputs, status, and the figures — and states that none is recorded. The design's own
 * filter bar (ongoing, planned, completed) is shown as structure with nothing behind it.
 *
 * **This is the one route in Phase 2 whose absence is architectural rather than editorial**: the other empty
 * collections hold nothing because nothing has been accessioned, and this one holds nothing because there is
 * no table. Building the model is Phase 4's "project relationships" work, and until it exists a page of
 * project cards could only be invented.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Projects',
  description:
    'The research, preservation and public-history projects Ozi Ikoro Limited runs — their purpose, communities, progress and outputs. No project record has been created yet.',
  alternates: { canonical: 'https://ozikoro.com/projects' },
  openGraph: {
    title: 'Projects — Ozikoro',
    description: 'The work we have embarked on, in the open.',
    type: 'website',
  },
};

/** The statuses the design's filter bar offers. Shown as structure; none is populated. */
const STATUSES = ['All', 'Ongoing', 'Planned', 'Completed'] as const;

/** What the design's project detail screen says a project carries. None of it is recorded. */
const FIELDS: Array<{ label: string; meaning: string }> = [
  { label: 'Purpose', meaning: 'What the project is for, in one sentence someone can disagree with.' },
  { label: 'What the work includes', meaning: 'The stages, named rather than gestured at.' },
  { label: 'Communities', meaning: 'Who the work involves, and on what terms they took part.' },
  { label: 'Outputs', meaning: 'The records, publications and collections the project produced.' },
  { label: 'Status', meaning: 'Ongoing, planned or completed — and completed means finished.' },
  { label: 'Figures', meaning: 'Progress, dates and spend, published only when verified.' },
];

export default function ProjectsPage() {
  return (
    <>
      <section className="sx-pg-hero">
        <div className="wrap">
          <p className="eyebrow">Our projects</p>
          <h1>The work we have embarked on, in the open.</h1>
          <p className="lede">
            Every research, preservation and public-history project Ozi Ikoro Limited runs — its purpose,
            communities, progress and outputs. No project has been recorded yet, so nothing is listed.
          </p>
          <div className="sx-stats">
            <div>
              <b>—</b>
              <span>Projects recorded</span>
            </div>
            <div>
              <b>—</b>
              <span>Ongoing</span>
            </div>
            <div>
              <b>—</b>
              <span>Planned</span>
            </div>
            <div>
              <b>—</b>
              <span>Completed</span>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <p className="sx-notice">
          <b>No project record exists yet.</b> There is no table for one, so there is nothing to show and
          nothing has been shown in its place. Progress figures, budgets and dates are published only when
          they are verified — until then this page counts nothing.
        </p>

        <nav className="sx-filterbar" aria-label="Project status">
          {STATUSES.map((status) => (
            <Link key={status} href="/projects">
              {status}
            </Link>
          ))}
        </nav>

        <div className="empty section">
          <p className="eyebrow">Project register</p>
          <h2>Nothing is listed.</h2>
          <p>
            The archive&rsquo;s schema holds no project table, so no project can be recorded, filtered or
            completed. When one exists, each entry will carry the fields below — and a project with a title
            and no figures will say so rather than displaying sample ones.
          </p>
        </div>

        <section className="section">
          <h2>What a project record carries</h2>
          <table>
            <tbody>
              {FIELDS.map((field) => (
                <tr key={field.label}>
                  <th scope="row">{field.label}</th>
                  <td>{field.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <article className="sx-record-placeholder">
          <div>
            <small>Where the work is visible now</small>
            <h2>The records are the work</h2>
            <p>
              Until projects can be recorded, what the institution has actually produced is already in the
              archive — the histories, the photographs, the records and the dictionary. That is the evidence
              rather than a description of it.
            </p>
            <p>
              <Link className="btn" href="/archive">
                Browse the archive
              </Link>{' '}
              <Link className="btn" href="/about">
                About Ozi Ikoro
              </Link>
            </p>
          </div>
        </article>
      </section>
    </>
  );
}
