/**
 * Projects — the work Ozi Ikoro Limited has embarked on, in the open.
 *
 * Built to the design's `screens/projects.html`, which has four sections: `sx-pg-hero` with a four-figure
 * statistics strip, a notice plus a featured project and a grid, an `sx-section` holding the process steps,
 * and an `sx-dark` block of ways to help.
 *
 * WHY THE FEATURE AND THE GRID ARE ABSENT, AND THE OTHER TWO SECTIONS ARE NOT
 *
 * **The schema has no project table.** There is nowhere for a project record to live, so the six example
 * projects, their thumbnails and the featured "Town histories series" cannot be reproduced. Their titles may
 * describe real work, but their **figures are declared example material** — the design's own notice says
 * *"progress figures, budgets and dates are example material until Ozi Ikoro Limited supplies verified
 * figures"* — and a project card whose only substance is progress, dates and budget would be example material
 * wearing a real title.
 *
 * **The process and the ways-to-help sections are drawn in full, because neither is a claim about a project.**
 * How a proposal becomes a public record is a description of how the institution works, and the three ways to
 * help are real pages. Drawing those while leaving the register empty is the honest shape: the route is
 * complete and the shelf is bare.
 *
 * The four statistics are em dashes rather than numbers, for the same reason — the archive has no project to
 * count.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Projects',
  description:
    'The research, preservation and public-history projects Ozi Ikoro Limited runs — how a proposal becomes a public record, and how to help.',
  alternates: { canonical: 'https://ozikoro.com/projects' },
  openGraph: { title: 'Projects — Ozikoro', description: 'The work we have embarked on, in the open.', type: 'website' },
};

const STATUSES = ['All', 'Ongoing', 'Planned', 'Completed', 'Research', 'Preservation'];

const STEPS = [
  { t: 'A community asks', b: 'A town, a family or an institution asks for a history to be recorded.' },
  { t: 'The scope is agreed', b: 'What will be covered, who will be credited, and who holds the rights.' },
  { t: 'The work is done', b: 'Interviews, archival work and photography, with consent recorded as it goes.' },
  { t: 'The record is published', b: 'Every output gets a permanent address, and the project is listed with it.' },
];

const PATHS = [
  { href: '/submit', t: 'Propose a project', b: 'Tell us what needs recording and why.' },
  { href: '/submit', t: 'Volunteer', b: 'Research, translation, transcription or photography.' },
  { href: '/ledger', t: 'Fund a project', b: 'Support preservation, digitisation and public access.' },
];

export default function ProjectsPage() {
  return (
    <main>
      <section className="sx-pg-hero">
        <div className="wrap">
          <p className="eyebrow">Our projects</p>
          <h1>The work we have embarked on, in the open.</h1>
          <p className="lede">
            Every research, preservation and public-history project Ozi Ikoro Limited runs — its purpose,
            communities, progress and outputs. No project is recorded yet, so nothing is listed.
          </p>
          <div className="sx-stats">
            <div><b>—</b><span>Projects recorded</span></div>
            <div><b>—</b><span>Ongoing</span></div>
            <div><b>—</b><span>Planned</span></div>
            <div><b>—</b><span>Completed</span></div>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <p className="sx-notice">
          <b>No project record exists yet, and no figure is shown in place of one.</b> The design&rsquo;s own
          notice is that project titles reflect work visible on ozikoro.com while progress figures, budgets and
          dates are <b>example material</b> until Ozi Ikoro Limited supplies verified figures. There is no table
          for a project here, so the register is empty rather than illustrative.
        </p>

        <h2>All projects</h2>
        <nav className="sx-filterbar" aria-label="Project status">
          {STATUSES.map((s) => (
            <Link href="/projects" key={s}>
              {s}
            </Link>
          ))}
        </nav>

        <div className="empty">
          <p>
            Nothing is listed, and nothing has been listed in its place. A project appears here when its
            purpose, communities, status and outputs can be recorded together — and a project with a title and
            no verified figures will say so rather than displaying sample ones.
          </p>
          <p>
            <Link className="btn" href="/archive">
              Browse the records instead
            </Link>
          </p>
        </div>
      </section>

      <section className="sx-section">
        <div className="wrap">
          <div className="sx-head">
            <div>
              <p className="eyebrow">How it works</p>
              <h2>From community request to public record</h2>
            </div>
            <span className="gold-rule" />
          </div>
          <ol className="sx-steps">
            {STEPS.map((s, i) => (
              <li key={s.t}>
                <b>{String(i + 1).padStart(2, '0')}</b>
                <strong>{s.t}</strong>
                <span>{s.b}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sx-section sx-dark">
        <div className="wrap">
          <div className="sx-head">
            <div>
              <p className="eyebrow">Take part</p>
              <h2>Back, propose or volunteer on a project</h2>
            </div>
            <span className="gold-rule" />
          </div>
          <div className="sx-paths">
            {PATHS.map((p) => (
              <Link className="sx-path" href={p.href} key={p.t}>
                <strong>{p.t}</strong>
                <span>{p.b}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
