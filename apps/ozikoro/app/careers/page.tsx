/**
 * Careers — Ozi Ikoro Limited.
 *
 * Reproduced from the approved design's `screens/careers.html`: the same sections, the same classes
 * (`sx-careers-hero`, `sx-career-values`, `sx-jobs`, `sx-correction`), the same order and the same
 * structure. Only the inline `style` attributes the design uses to keep each screen one file are dropped,
 * because the design's own stylesheets are served as delivered and carry the decisions.
 *
 * THE ONE PLACE THIS DEPARTS FROM THE SCREEN'S WORDING, AND WHY
 *
 * The screen says *"No verified vacancies are listed in this demonstration."* That sentence is correct on a
 * design demonstration and false on a live site — ozikoro.com is not a demonstration. The brief's rule is to
 * keep the honest no-vacancies state and never invent jobs, benefits or employment claims, so the state is
 * kept and the word "demonstration" is not, because on the live site it would be a claim about the page
 * rather than about the vacancies.
 *
 * Everything else is the design's own text, including its explanation of what a listing will show when one
 * exists. Nothing here promises a role, a salary, a benefit or a date.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Careers',
  description:
    'Work with Ozi Ikoro Limited on the research, archives and technology behind Ozikoro. No verified vacancies are listed at present.',
  alternates: { canonical: 'https://ozikoro.com/careers' },
  openGraph: {
    title: 'Careers — Ozikoro',
    description:
      'Work with Ozi Ikoro Limited on the research, archives and technology behind Ozikoro. No verified vacancies are listed at present.',
    type: 'website',
  },
};

/** The three work areas the design draws, in its order and its words. */
const VALUES: Array<{ number: string; title: string; body: string }> = [
  {
    number: '01',
    title: 'Editorial & research',
    body: 'Historical writing, source review, fact-checking and community collaboration.',
  },
  {
    number: '02',
    title: 'Archive & collections',
    body: 'Cataloguing, rights, digitisation, preservation and access.',
  },
  {
    number: '03',
    title: 'Design & technology',
    body: 'Accessible reading, discovery, language tools and digital infrastructure.',
  },
];

/** The design's three steps, unchanged. */
const PROCESS: Array<{ marker: string; body: string }> = [
  { marker: '1.', body: 'Read the complete role and selection criteria.' },
  { marker: '2.', body: 'Submit only through the official application link.' },
  { marker: '3.', body: 'Shortlisted applicants receive the interview process and timeline.' },
];

export default function CareersPage() {
  return (
    <>
      <section className="sx-careers-hero">
        <div className="wrap">
          <p className="eyebrow">Work with Ozi Ikoro Limited</p>
          <h1>Build tools that keep memory within reach.</h1>
          <p className="lede">
            Ozikoro brings research, archives, community knowledge and thoughtful technology together
            for readers across generations.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="sx-career-values">
          {VALUES.map((value) => (
            <article key={value.number}>
              <span>{value.number}</span>
              <h2>{value.title}</h2>
              <p>{value.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="sx-jobs">
        <div className="wrap">
          <div>
            <p className="eyebrow">Open roles</p>
            <h2>No vacancies are listed at present.</h2>
            <p>
              Nothing is open and nothing is being advertised. When roles do open, each listing will
              show responsibilities, location or remote status, working arrangement, salary range
              where approved, and the closing date.
            </p>
          </div>
          <aside>
            <h3>Application process</h3>
            <ol>
              {PROCESS.map((step) => (
                <li key={step.marker}>
                  <b>{step.marker}</b> {step.body}
                </li>
              ))}
            </ol>
            <Link className="btn btn-gold" href="/about">
              Meet the institution
            </Link>
          </aside>
        </div>
      </section>

      <section className="wrap section">
        <div className="sx-correction">
          <div>
            <p className="eyebrow">General interest</p>
            <h2>Want to work with us later?</h2>
            <p>
              No talent or contact form is connected here yet, and this page will say so until one
              is. Ozikoro should never request payment from an applicant, and neither should anyone
              claiming to represent it.
            </p>
          </div>
          <div className="row">
            <Link className="btn" href="/about">
              About Ozi Ikoro
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
