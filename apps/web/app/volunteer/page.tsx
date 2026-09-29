import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Volunteer',
  description:
    'The work that is open on Ozituma right now, and how to pick a piece of it up. No application, no interview — an account and a few minutes.',
  openGraph: {
    title: 'Volunteer — Ozituma',
    description: 'Open work on the Igbo dictionary, counted from the record itself.',
  },
};

/**
 * The volunteer board.
 *
 * The owner: "add another page for Volunteers or Contributors just like Nkowaokwu.com
 * has theirs". Theirs is a board with a mission, a sign-up, a list of open positions,
 * and a community around it, and the shape is a good one.
 *
 * WHAT THIS DOES DIFFERENTLY, AND WHY
 *
 * Their positions are listed by hand, and a reader has to take the number on trust.
 * Every count on this page is read from the live database at the moment the page is
 * served, so the board cannot drift from the work: when the last proverb gets its
 * English, the line saying how many are waiting stops being there. A board that says
 * "twelve proverbs need a meaning" when there are four is a board nobody believes twice.
 *
 * The other difference is the sign-up. They ask for a Google Form and an invitation to
 * Slack, which puts a person between a willing volunteer and the work. This site already
 * has the machinery to accept the work directly — an account, a recorder, an edit form on
 * every entry — so the page sends people straight into it. Nothing here needs permission
 * first, and nothing waits on anybody: a recording or a correction goes in the moment it
 * is made, and a reviewer sees it.
 */
export default async function VolunteerPage() {
  const db = await getDb();

  /*
   * The open work, counted rather than asserted. Each query is written to answer the
   * question the card asks, and nothing is estimated.
   */
  const [proverbs, clansWithoutTowns, clansWithoutState, namesWithoutAudio, wordsWithoutExamples, recordings] =
    await Promise.all([
      db.one<{ waiting: number; total: number }>(
        `select count(*) filter (where translation is null)::int as waiting,
                count(*)::int as total
           from example where style = 'proverb' and status = 'published'`
      ),
      db.one<{ n: number }>(
        `select count(*)::int as n from clan c
          where c.published and c.ethnic_group = 'Igbo'
            and not exists (select 1 from clan_town t where t.clan_id = c.id)`
      ),
      db.one<{ n: number }>(
        `select count(*)::int as n from clan c
          where c.published and coalesce(array_length(c.states, 1), 0) = 0`
      ),
      db.one<{ waiting: number; total: number }>(
        `select count(*) filter (where not exists (
                  select 1 from audio a where a.person_name_id = n.id and a.status = 'published'))::int as waiting,
                count(*)::int as total
           from person_name n where n.status = 'published'`
      ),
      db.one<{ waiting: number; total: number }>(
        // Examples reach a word through `example_word`; there is no word_id on the
        // example itself.
        `select count(*) filter (where not exists (
                  select 1 from example_word ew join example e on e.id = ew.example_id
                   where ew.word_id = w.id and e.style is distinct from 'proverb'))::int as waiting,
                count(*)::int as total
           from word w where w.status = 'published'`
      ),
      db.one<{ n: number }>(
        `select count(*)::int as n from audio where status = 'published'`
      ),
    ]);

  const n = (value: number | undefined) => (value ?? 0).toLocaleString('en-GB');

  /**
   * The work, as cards.
   *
   * Each one says what the job is, how much of it is open, and where to go — and the
   * count comes from the query above rather than from a sentence somebody wrote once and
   * never checked again. A card with nothing left to do is not shown at all.
   */
  const positions = [
    {
      title: 'Give a proverb its meaning in English',
      open: proverbs?.waiting ?? 0,
      of: proverbs?.total ?? 0,
      unit: 'proverbs',
      href: '/proverbs',
      link: 'Read the proverbs',
      body:
        'A proverb means more than its words, which is why a translation written by a machine is worth nothing here. These came from collections that printed the Igbo and no English. If you speak the language, you know what they mean — that is the whole qualification.',
      needs: 'Igbo and English',
    },
    {
      title: 'Add the towns and villages of a clan',
      open: clansWithoutTowns?.n ?? 0,
      of: null,
      unit: 'clans',
      href: '/clans',
      link: 'Find your clan',
      body:
        'A clan with no towns named under it cannot be checked by anybody. If it is your own clan you can settle it in a minute; if it is one you know, the same. This is the gap the clan registry closes last, and the people who close it are the ones who live there.',
      needs: 'local knowledge',
    },
    {
      title: 'Say where a clan is today',
      open: clansWithoutState?.n ?? 0,
      of: null,
      unit: 'entries',
      href: '/clans',
      link: 'Open the registry',
      body:
        'These entries say what group they are and nothing about where it is now — because the records they came from located people by a colonial division, and the reader is in Anambra or Delta or Ebonyi. A state and a local government area is all that is missing.',
      needs: 'knowing the place',
    },
    {
      title: 'Say a name out loud',
      open: namesWithoutAudio?.waiting ?? 0,
      of: namesWithoutAudio?.total ?? 0,
      unit: 'names',
      href: '/names',
      link: 'Browse the names',
      body:
        'Every name here has a meaning and a gender and the variety it belongs to, and most have no recording at all. Thirty seconds with a microphone settles one, and the recorder is on the page — nothing to install, nothing to send anywhere.',
      needs: 'a microphone',
    },
    {
      title: 'Illustrate a word with a sentence',
      open: wordsWithoutExamples?.waiting ?? 0,
      of: wordsWithoutExamples?.total ?? 0,
      unit: 'words',
      href: '/contribute',
      link: 'Add an example',
      body:
        'A dictionary entry teaches by example more than by definition. These entries have meanings and nothing showing the word in use. A sentence you would actually say is better than a grammatical one.',
      needs: 'Igbo',
    },
  ].filter((position) => position.open > 0);

  return (
    <div className="wrap wrap-narrow">
      <div className="name-page-head">
        <p className="name-eyebrow">Volunteer</p>
        <h1 className="name-title">The work that is open</h1>
        <p className="name-lede">
          Ozituma is built by people who speak Igbo, not by a company. Every number on this page
          is counted from the record itself when you load it — so this is what is actually
          outstanding, not a list somebody wrote once.
        </p>
      </div>

      <section className="section">
        <h2>How it works</h2>
        <p>
          There is no application and nobody to ask. <Link href="/join">Create an account</Link>{' '}
          and start: the recorder, the edit forms and the contribution pages are open, and what
          you send is recorded against you. A recording or a correction goes in as you make it —
          an editor looks at it afterwards, which is how the dictionary keeps its standard without
          keeping you waiting.
        </p>
        <p className="muted">
          If you would rather not have an account, you can still{' '}
          <Link href="/contribute">send a word in</Link> or write to{' '}
          <a href="mailto:hello@ozituma.com">hello@ozituma.com</a>. Nothing here is a membership.
        </p>
      </section>

      <section className="section">
        <h2>Open positions</h2>
        {positions.length > 0 ? (
          <div className="grid">
            {positions.map((position) => (
              <div className="card" key={position.title}>
                <div
                  style={{ fontSize: '1.5rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                >
                  {n(position.open)}
                </div>
                <div className="card-meta">
                  {position.unit}
                  {position.of ? ` of ${n(position.of)}` : ''} waiting
                </div>
                <h3 style={{ marginTop: '0.75rem', marginBottom: '0.35rem', fontSize: '1.05rem' }}>
                  {position.title}
                </h3>
                <p style={{ marginTop: 0 }}>{position.body}</p>
                <p className="card-meta" style={{ marginBottom: '0.5rem' }}>
                  What it needs: {position.needs}
                </p>
                <Link className="button button-secondary" href={position.href}>
                  {position.link}
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p>
            Every position on this board is filled — there is nothing outstanding that a
            volunteer can pick up right now. That has not happened before, and it will not last:
            the registry grows, and every new entry arrives without a voice or an example.
          </p>
        )}
      </section>

      <section className="section">
        <h2>What the work has already done</h2>
        <p>
          {n(recordings?.n)} recordings are published, {' '}
          {n((proverbs?.total ?? 0) - (proverbs?.waiting ?? 0))} proverbs carry an English that a
          speaker or a publication supplied, and {n(namesWithoutAudio?.total)} names are recorded
          with their meanings, gender and the varieties they belong to. None of it was bought: it
          came from people who wanted the record to exist.
        </p>
      </section>

      <section className="section">
        <h2>Other ways to help</h2>
        <ul>
          <li>
            <strong>Correct us.</strong> Every entry, every clan, every name has a correction form.
            Being told we are wrong about your town is the most useful message we get —{' '}
            <Link href="/clans">the registry</Link> is where it happens most.
          </li>
          <li>
            <strong>Build with the data.</strong> The <Link href="/docs">API is free</Link> and the
            key is yours to create in a minute. Apps, teaching tools and keyboards have all been
            built on it.
          </li>
          <li>
            <strong>Review what comes in.</strong> If you read Igbo well,{' '}
            <Link href="/contribute">tell us</Link> and an editor role follows. Checkers are scarcer
            than contributors, and a queue that is checked is what makes contribution worth doing.
          </li>
          <li>
            <strong>Support it.</strong> <Link href="/donate">Donations</Link> pay for the time
            spent checking, which is most of what this costs.
          </li>
          <li>
            <strong>Send material.</strong> A word list, a recording, a printed collection, a
            family history of names — a file you already have is worth more than a week of
            somebody&rsquo;s editing.
          </li>
        </ul>
      </section>
    </div>
  );
}
