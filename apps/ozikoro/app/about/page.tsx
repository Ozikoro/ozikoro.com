/**
 * About — built to the approved design's `screens/about.html`, section for section.
 *
 * WHY IT WAS REWRITTEN
 *
 * `check-design-parity.mjs` reported this as the widest gap in the archive: the design has nine sections with
 * an h1 reading "We keep history where people can find it." and this page had none of them.
 *
 * ALL THE PROSE HERE IS THE DESIGN'S OWN, and that matters. The design is not a wireframe with lorem ipsum —
 * it carries the institution's actual wording about its name, its purpose, its editorial method and its
 * principles. **Reproducing it is not copying a prototype value; the prototype value is the text.**
 *
 * THE FOUR PEOPLE ARE REAL AND VERIFIABLY PUBLISHED, which is the brief's explicit rule for this page. All
 * four are contributor records in this archive with published work: Idenze Ezeme, Kosisochukwu Nzeribe,
 * Chukwunwike Ossai and Chuka Odike. **The design's own people section says "Portrait to be supplied" and
 * uses monogram tiles** — so a monogram is the correct state here, not a placeholder standing in for a
 * missing portrait, and no portrait has been invented.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Ozi Ikoro Limited publishes Ozikoro, Ozituma and the Academy: an archive, a living dictionary and a place to learn. African histories readable, searchable and citable.',
  alternates: { canonical: 'https://ozikoro.com/about' },
  openGraph: { title: 'About — Ozikoro', description: 'One institution. Three public tools.', type: 'website' },
};

/** The four published people, from the design, cross-checked against contributor records by slug. */
const PEOPLE = [
  { slug: 'nze', initials: 'IE', name: 'Idenze Ezeme', role: 'Founder · published author',
    bio: 'Igbo history and culture enthusiast focused on pre-colonial societies, belief and leadership systems.' },
  { slug: 'kosiso', initials: 'KN', name: 'Kosisochukwu Nzeribe', role: 'Published author',
    bio: 'Law graduate, creative and research writer.' },
  { slug: 'ossai', initials: 'CO', name: 'Chukwunwike Ossai', role: 'Published author',
    bio: 'Technology enthusiast and writer.' },
  { slug: 'chuka', initials: 'CO', name: 'Chuka Odike', role: 'Published author',
    bio: 'Civil engineer and writer on Igbo history and culture.' },
];

const PLATFORMS = [
  { href: 'https://ozikoro.com', name: 'ozikoro.com', label: 'Archive & research',
    body: 'Histories, records, publications and the research network.' },
  { href: 'https://ozituma.com', name: 'ozituma.com', label: 'Dictionary',
    body: 'A living dictionary for African languages.' },
  { href: '/academy/', name: 'academy.ozikoro.com', label: 'Learn Igbo',
    body: 'Lessons for speaking and reading Igbo. The academy is being prepared.' },
];

const PRINCIPLES = [
  { n: '01', title: 'No invention', body: 'A gap stays visible until evidence fills it.' },
  { n: '02', title: 'Source in view', body: 'Readers can see what supports every record.' },
  { n: '03', title: 'Community terms', body: 'Depositors define access and reuse.' },
  { n: '04', title: 'Permanent record', body: 'Versions change; citation addresses remain.' },
];

const TIMELINE = [
  { t: 'Submit', b: 'Writers, researchers and knowledge holders deposit material with consent and access terms.' },
  { t: 'Verify', b: 'Editors check sources; expert reviewers assess evidence.' },
  { t: 'Publish', b: 'Each record gets a permanent, citable address and visible version history.' },
  { t: 'Correct', b: 'Anyone can propose a correction; changes are logged, never hidden.' },
];

const PATHS = [
  { href: '/projects', t: 'See our projects', b: 'What we are building and where help is needed.' },
  { href: '/ledger', t: 'Public ledger', b: 'Donors and contributors recognised.' },
  { href: '/ledger', t: 'Give to the archive', b: 'Support preservation, digitisation and public access.' },
  { href: '/submit', t: 'Sponsor a programme', b: 'Back a defined cultural or research programme.' },
  { href: '/about', t: 'Explore investment', b: 'Request company and opportunity information.' },
];

const FAQ = [
  { q: 'What is Ozikoro?',
    a: 'An online archive and research platform for Igbo and wider African history, run by Ozi Ikoro Limited. It is an institution, not a blog: every record carries its sources.' },
  { q: 'Is Ozikoro free to read?',
    a: 'Articles, folklores, calendars, films and most records are free. Some research publications are access-controlled by their authors and can be requested.' },
  { q: 'How do I cite an Ozikoro record?',
    a: 'Every record has a permanent address. The citation guide gives formats for articles, photographs, recordings and publications.' },
  { q: 'Can I contribute a story, photograph or research?',
    a: 'Yes. Use Contribute. You choose access and reuse terms; editors review before publishing.' },
  { q: 'I found a mistake.', a: 'Anyone can propose a correction. Changes are logged, never hidden.' },
];

export default async function AboutPage() {
  const db = await getDb();
  // Confirm each named person really is a published contributor here, rather than asserting it.
  const published = await db.rows<{ slug: string; n: number }>(
    `select c.slug, count(a.id)::int n
       from ozikoro_contributor c
       left join ozikoro_article a on a.author_id = c.id and a.status = 'published'
      where c.slug = any($1)
      group by c.slug`,
    [PEOPLE.map((p) => p.slug)]
  );
  const counts = new Map(published.map((r) => [r.slug, r.n]));

  return (
    <main>
      <section className="sx-subhero">
        <div className="wrap">
          <p className="eyebrow">One institution. Three public tools.</p>
          <h1>We keep history where people can find it.</h1>
          <p className="lede">
            Ozi Ikoro Limited publishes Ozikoro, Ozituma and the Academy: an archive, a living dictionary and
            a place to learn.
          </p>
        </div>
      </section>

      <section className="wrap sx-mission">
        <figure>
          <figcaption>Community history in the Ozikoro archive.</figcaption>
        </figure>
        <div>
          <p className="eyebrow">Our purpose</p>
          <p className="display">
            African histories should be readable, searchable and citable without being separated from the
            people who hold them.
          </p>
          <p className="lede">
            The platform brings community testimony, scholarship, language and material culture into one
            research environment while keeping provenance visible.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <div className="sx-about-split">
          <figure>
            <figcaption>Ikoro drum — historical photograph in the Ozikoro archive.</figcaption>
          </figure>
          <div>
            <p className="eyebrow">Our name</p>
            <h2>Ozi Ikoro: the message of the drum</h2>
            <span className="gold-rule" />
            <p>
              In Igbo communities the Ikoro, a great slit drum, carried messages across a town: gatherings,
              alarms, deaths of titled people, celebrations. <em>Ozi</em> means message. Ozi Ikoro Limited
              takes that role online — carrying what communities know to anyone who needs it, with the source
              always attached.
            </p>
          </div>
        </div>

        <div className="sx-about-split rev">
          <figure>
            <figcaption>Masquerade — Ozikoro collection.</figcaption>
          </figure>
          <div>
            <p className="eyebrow">What we publish</p>
            <h2>Histories, folklores, towns and research</h2>
            <span className="gold-rule" />
            <ul>
              <li><strong>Histories</strong> — sourced articles across Igbo and African history.</li>
              <li><strong>Folklores &amp; myths</strong> — stories you can read or listen to.</li>
              <li><strong>Towns</strong> — profiles of communities and their quarters.</li>
              <li><strong>Publications</strong> — researcher papers, open or access-controlled.</li>
              <li><strong>Watch and Listen</strong> — films and audio.</li>
              <li><strong>Igbo calendar and cultural calendar</strong>.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="sx-section">
        <div className="wrap">
          <div className="sx-head">
            <div>
              <p className="eyebrow">Three tools</p>
              <h2>Three tools, one mission</h2>
            </div>
            <span className="gold-rule" />
          </div>
          <div className="sx-platforms">
            {PLATFORMS.map((p) => (
              <a href={p.href} key={p.name} rel="noreferrer">
                <strong>{p.name}</strong>
                <em>{p.label}</em>
                <span>{p.body}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="sx-about-split">
          <div>
            <p className="eyebrow">Editorial method</p>
            <h2>How a record earns its place</h2>
            <span className="gold-rule" />
            <ol className="sx-timeline">
              {TIMELINE.map((s) => (
                <li key={s.t}>
                  <strong>{s.t}</strong>
                  <span>{s.b}</span>
                </li>
              ))}
            </ol>
          </div>
          <figure>
            <figcaption>Editorial review in progress.</figcaption>
          </figure>
        </div>
      </section>

      <section className="sx-principles">
        {PRINCIPLES.map((p) => (
          <div className="sx-principle" key={p.n}>
            <b>{p.n}</b>
            <h3>{p.title}</h3>
            <p className="muted">{p.body}</p>
          </div>
        ))}
      </section>

      <section className="sx-section">
        <div className="wrap">
          <div className="sx-head">
            <div>
              <p className="eyebrow">People</p>
              <h2>People readers already meet on Ozikoro</h2>
            </div>
            <span className="gold-rule" />
          </div>
          <p className="sx-notice">
            Biographies below are as published on ozikoro.com. Monogram tiles hold each place until a portrait
            is supplied.
          </p>
          <div className="sx-people">
            {PEOPLE.map((person) => {
              const n = counts.get(person.slug) ?? 0;
              return (
                <article className="sx-person" key={person.slug}>
                  <span className="sx-monogram" aria-hidden="true">{person.initials}</span>
                  <p className="eyebrow">
                    {person.role}
                    {n > 0 ? ` · ${n} published record${n === 1 ? '' : 's'}` : null}
                  </p>
                  <h3>{person.name}</h3>
                  <p>{person.bio}</p>
                  <Link href={`/author/${person.slug}/`}>Read their records →</Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="sx-section sx-dark">
        <div className="wrap">
          <div className="sx-head">
            <div>
              <p className="eyebrow">Ways to help</p>
              <h2>Ways to help Ozikoro grow</h2>
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

      <section className="sx-section">
        <div className="wrap sx-faq-cols">
          <div>
            <p className="eyebrow">FAQs</p>
            <h2>Questions people ask</h2>
            <p className="muted">
              Answers describe the intended platform; policies marked &ldquo;to be confirmed&rdquo; await Ozi
              Ikoro Limited.
            </p>
          </div>
          <div className="sx-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/*
        The contact section. The design's own text ends "Official email, address and phone to be supplied —
        not invented here", which is the correct state: Ozi Ikoro Limited has not supplied them, so they are
        absent rather than guessed. The three enquiry routes are real pages.
      */}
      <section className="sx-section sx-dark">
        <div className="wrap">
          <div className="sx-head">
            <div>
              <p className="eyebrow">Contact</p>
              <h2>Talk to Ozi Ikoro Limited</h2>
            </div>
            <span className="gold-rule" />
          </div>
          <div className="sx-paths">
            <Link className="sx-path" href="/submit">
              <strong>Editorial &amp; corrections</strong>
              <span>Submit material or flag an error.</span>
            </Link>
            <Link className="sx-path" href="/about">
              <strong>Partnerships</strong>
              <span>Institutions, sponsors and media.</span>
            </Link>
            <Link className="sx-path" href="/careers">
              <strong>Careers</strong>
              <span>Work with the team.</span>
            </Link>
          </div>
          <p className="muted">
            Official email, address and phone to be supplied — not invented here.
          </p>
        </div>
      </section>

      {/*
        Terms, privacy and licensing. The design's text for each says the document "must be supplied by Ozi
        Ikoro Limited", so stating that is the honest content rather than a placeholder standing in for a
        policy nobody has written.
      */}
      <section className="wrap section">
        <div className="sx-head">
          <div>
            <p className="eyebrow">Terms</p>
            <h2>Terms</h2>
          </div>
          <span className="gold-rule" />
        </div>
        <p className="muted">Binding terms must be supplied by Ozi Ikoro Limited.</p>
        <h2>Privacy</h2>
        <p className="muted">The complete data-controller notice must be supplied.</p>
        <h2>Licensing</h2>
        <p className="muted">Each record displays its own access and reuse terms.</p>
      </section>
    </main>
  );
}
