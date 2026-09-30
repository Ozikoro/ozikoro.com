import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import {
  getCultureOverview,
  listClansForLearning,
  listCultureNotes,
  listNamesForLearning,
} from '@ozituma/db/learn-culture';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Igbo culture · Ozituma Learn',
  description:
    'The names, clans and cultural notes behind the language — from the Ozituma archives.',
};

/**
 * Culture, in two parts that are never conflated.
 *
 * §3 makes this a "language-and-culture platform" rather than a vocabulary trainer, and §1.1 says
 * that positioning suits Ozituma and Ozikoro far better than a generic flashcard app. So this page
 * exists to put the culture next to the language rather than behind it.
 *
 * The two parts are:
 *
 *   1. CULTURE NOTES — §F9's authored records: who says something, to whom, where, at what register.
 *      These are a cultural CLAIM, which §2.1 forbids an AI from making, so the table is empty until
 *      §18 #4's linguist and native reviewers are named. The page says that plainly rather than
 *      hiding an empty section.
 *
 *   2. THE ARCHIVES — 2,889 personal names with their meanings and origins, 228 clans, 995 clan
 *      towns. These are the owner's own published records, and §11.4 calls the name dictionary "the
 *      first seed data set". They are shown as what they are: dictionary entries, not the platform's
 *      editorial voice.
 *
 * That distinction is the point. Calling a dictionary record a "culture note" would attach the
 * platform's authority to material that came from somewhere else, with its own sources and its own
 * provenance — which is exactly what §11.4 exists to prevent.
 */
export default async function CulturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.slice(0, 80).trim() : '';

  const db = await getDb();

  const [overview, notes, names, clans] = await Promise.all([
    getCultureOverview(db),
    listCultureNotes(db, { limit: 10 }),
    // A search narrows to the names; otherwise the first page is shown, so the section is never
    // empty on arrival.
    listNamesForLearning(db, { query: query || undefined, limit: 24 }),
    listClansForLearning(db, { limit: 12 }),
  ]);

  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Culture</p>
        <h1 className="learn-hero-title">The language has a place</h1>
        <p className="hero-lede">
          Igbo carries where a name comes from, which clan a family belongs to, and who may say what
          to whom. These are the Ozituma archives: the verified name dictionary, the clan record, and
          the cultural notes written for the lessons.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The archives — real, published, owned                               */}
      {/* ------------------------------------------------------------------ */}
      <section className="learn-section">
        <h2 className="learn-section-title">In the archives</h2>
        <ul className="learn-review-list">
          <li className="learn-review-item">
            <span className="learn-review-prompt">Personal names</span>
            <span className="learn-review-answer">
              <strong>{overview.names.toLocaleString()}</strong> verified names, with their meanings
              and the places they are borne
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">Clans and towns</span>
            <span className="learn-review-answer">
              <strong>{overview.clans.toLocaleString()}</strong> clan records, with origin summaries
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">Cultural notes</span>
            <span className="learn-review-answer">
              <strong>{overview.notes.toLocaleString()}</strong> written for the lessons
            </span>
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Names                                                               */}
      {/* ------------------------------------------------------------------ */}
      <section className="learn-section">
        <h2 className="learn-section-title">Names</h2>

        <form className="learn-recall" method="get" role="search">
          <label className="learn-recall-label" htmlFor="culture-names">
            Find a name
          </label>
          <input
            id="culture-names"
            name="q"
            className="learn-recall-input"
            defaultValue={query}
            placeholder="e.g. Ada — tone marks optional"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            lang="ig"
          />
          <button className="button" type="submit">
            Search
          </button>
        </form>

        {names.names.length === 0 ? (
          <div className="notice" style={{ marginTop: '1rem' }}>
            <strong>No names matched {query ? `“${query}”` : 'that'}.</strong>
            <p style={{ margin: '0.4rem 0 0' }}>
              The dictionary holds published Igbo names only.{' '}
              {query ? <Link href="/culture">Show all names</Link> : null}
            </p>
          </div>
        ) : (
          <>
            <p className="muted" style={{ fontSize: '0.86rem', margin: '1rem 0 0.5rem' }}>
              {names.total.toLocaleString()} {names.total === 1 ? 'name' : 'names'}
              {names.total > names.names.length
                ? `, showing the first ${names.names.length}`
                : ''}
            </p>
            <ul className="learn-review-list">
              {names.names.map((entry) => (
                <li key={entry.slug} className="learn-review-item">
                  <span className="learn-review-prompt">
                    <a href={`${process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/names/${entry.slug}`}>
                      {entry.name}
                    </a>
                  </span>
                  <span className="learn-review-answer">
                    {entry.meaning ?? <span className="muted">no meaning recorded</span>}
                    {entry.gender && entry.gender !== 'unisex' ? (
                      <span className="muted"> · {entry.gender}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Clans                                                               */}
      {/* ------------------------------------------------------------------ */}
      <section className="learn-section">
        <h2 className="learn-section-title">Clans and towns</h2>
        <p className="muted" style={{ fontSize: '0.86rem', marginBottom: '0.5rem' }}>
          {clans.total.toLocaleString()} records. Each carries where it is, which ethnic group it
          belongs to, and the sources it came from.
        </p>
        <ul className="learn-review-list">
          {clans.clans.map((clan) => (
            <li key={clan.slug} className="learn-review-item">
              <span className="learn-review-prompt">
                <a href={`${process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/clans/${clan.slug}`}>
                  {clan.name}
                </a>
              </span>
              <span className="learn-review-answer">
                <span className="muted">
                  {clan.kind} · {clan.ethnicGroup}
                  {clan.region ? ` · ${clan.region}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: '0.86rem' }}>
          The full archive is at{' '}
          <a href={`${process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/clans`}>ozituma.com/clans</a>.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Culture notes — the authored kind, and why it is empty              */}
      {/* ------------------------------------------------------------------ */}
      <section className="learn-section">
        <h2 className="learn-section-title">Cultural notes</h2>

        {notes.notes.length === 0 ? (
          <div className="notice">
            <strong>None are published yet.</strong>
            <p style={{ margin: '0.4rem 0 0.8rem' }}>
              A culture note says who says something, to whom, where, and at what register. That is a
              claim about how people live, and the specification is explicit that a machine must not
              invent it — so these are written by a linguist and checked by native speakers before
              they appear. The names and clans above are unaffected: those are the dictionary&rsquo;s
              own published records, and they are here already.
            </p>
            <Link className="button button-secondary" href="/lookup">
              Look up a word instead
            </Link>
          </div>
        ) : (
          <ul className="learn-review-list">
            {notes.notes.map((note) => (
              <li key={note.id} className="learn-review-item">
                <span className="learn-review-prompt">{note.title}</span>
                <span className="learn-review-answer" style={{ whiteSpace: 'pre-wrap' }}>
                  {note.body}
                </span>
                {/*
                  §F9's fields, shown as the attribution they are. A note that does not say who says
                  it and to whom is a note a learner cannot use — it is the difference between "this
                  is a greeting" and "this is how you greet an elder".
                */}
                {note.whoSaysIt || note.saidTo || note.setting || note.register ? (
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {note.whoSaysIt ? `Said by ${note.whoSaysIt}` : null}
                    {note.saidTo ? ` to ${note.saidTo}` : null}
                    {note.setting ? ` · ${note.setting}` : null}
                    {note.register ? ` · ${note.register}` : null}
                    {note.region ? ` · ${note.region}` : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
