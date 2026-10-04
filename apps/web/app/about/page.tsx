import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getDictionaryStats } from '@ozituma/db/repository';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Ozituma is the dictionary of Ozikoro: African languages with meanings, dialect variants, pronunciation, example sentences and a free public API. Who founded it, how it is made, and how to contribute.',
};

/*
 * Who founded what, stated once as constants so the page cannot drift out of step with
 * itself. The owner, 2026-09-27: "Idenze Ezeme, and William Ezekiel Pepple are the founders
 * of Ozituma.com, while Idenze Ezeme founded the mother company, Ozikoro.com."
 */
const FOUNDERS = [
  {
    name: 'Idenze Ezeme',
    role: 'Founder of Ozikoro, co-founder of Ozituma',
    note:
      'Founded Ozikoro, the parent project, and co-founded Ozituma with William Ezekiel Pepple. Sets what the record covers and answers for what it says.',
  },
  {
    name: 'William Ezekiel Pepple',
    role: 'Co-founder of Ozituma',
    note:
      'Co-founded Ozituma and works on the languages beyond Igbo — this is not an Igbo-only project and it is not meant to become one.',
  },
];

export default async function AboutPage() {
  const db = await getDb();
  const stats = await getDictionaryStats(db);
  const [proverbRow, nameRow, clanRow] = await Promise.all([
    db.one<{ t: number }>(
      `select count(*) filter (where translation is not null)::int as t
         from example where style = 'proverb' and status = 'published'`
    ),
    db.one<{ n: number }>(`select count(*)::int as n from person_name where status = 'published'`),
    db.one<{ clans: number; tribes: number; towns: number }>(
      `select (select count(*) from clan)::int as clans,
              (select count(*) from tribe)::int as tribes,
              (select count(*) from clan_town)::int as towns`
    ),
  ]);
  const proverbCount = Number(proverbRow?.t ?? 0);
  const nameCount = Number(nameRow?.n ?? 0);
  const clans = Number(clanRow?.clans ?? 0);
  const tribes = Number(clanRow?.tribes ?? 0);
  const towns = Number(clanRow?.towns ?? 0);

  return (
    <div className="wrap wrap-narrow">
      <h1>About Ozituma</h1>

      {/*
        The first paragraph answers the question the reader arrived with, and that question
        is not "what is Igbo". Ozituma is a dictionary of African languages; Igbo is the
        deepest part of it today because that is where the work started, not because it is
        the boundary of the project.
      */}
      <p className="hero-lede">
        Ozituma is the dictionary of{' '}
        <a href="https://ozikoro.com" rel="noopener">
          Ozikoro
        </a>{' '}
        — meanings, dialect variants, pronunciation, example sentences and proverbs for the
        languages of Africa, free to read and free to build with.
      </p>

      <p>
        It is one half of a two-part project. <strong>Ozikoro</strong> keeps the history and the
        archive: the cultures, societies and indigenous knowledge systems of the continent, and the
        correcting of what has been said about them. <strong>Ozituma</strong> keeps the words. They
        are separate sites because they are separate jobs, and they belong to one project because
        neither stands without the other — a history cannot be told in a language that is being
        lost, and a language is not kept by a dictionary nobody reads.
      </p>

      <section className="section">
        <h2>The name</h2>
        <p>
          Ozituma is not a coined word. It is two words, from two languages, put together — and
          because of that it can be read two ways.
        </p>
        <p>
          <strong>Ozi</strong> is Igbo for <em>message</em>.
        </p>
        <p>
          <strong>Tuma</strong> is Ibani-nye, an Ijoid language spoken in Opobo and Bonny, where it
          means <em>true</em>, <em>correct</em>, or <em>legit</em>. The same language has{' '}
          <span className="mono">karakara</span> for true, <span className="mono">karakaranye</span>{' '}
          for truth, and <span className="mono">tumanye</span> for truth as well. Say{' '}
          <span className="mono">Tuma Minabo</span> and you are naming your correct relative — the
          one who is truly yours. In some contexts tuma carries the sense of <em>important</em>{' '}
          too, and that is the sense in this name: important work, or correct work.
        </p>
        <p>
          So the name says a true message, or work that is done right. Both readings are meant. It is
          read in two languages because that is what the dictionary does: it began with Igbo and it
          is built to carry the languages beside it, Ibani among them.
        </p>
      </section>

      <section className="section">
        <h2>How it started</h2>
        <p>
          Ozikoro was founded by <strong>Idenze Ezeme</strong>, out of a frustration worth naming
          plainly: the material about African history and languages that a curious reader can
          actually reach is thin, scattered, and often repeated from sources that were never
          trustworthy in the first place. There was no single place to go, and the places that
          existed kept running out.
        </p>
        <p>
          Ozituma answers the part of that problem a dictionary can answer.{' '}
          <strong>Idenze Ezeme</strong> and <strong>William Ezekiel Pepple</strong> founded it
          together. It began with Igbo, because Igbo is the language the founders speak and the one
          whose record most needed building. It was never meant to stop there.
        </p>
      </section>

      <section className="section">
        <h2>What we are trying to do</h2>
        <p>
          A dictionary is usually a list of translations, and that is the least useful thing a
          dictionary of an African language can be. The interesting facts are not the translations.
          They are which variety of the language a word belongs to, how it is pronounced, what it is
          used to say, and who still says it.
        </p>
        <p>
          So an entry here is built to carry all of that rather than the gloss alone: what the word
          means, where it is said that way, how it sounds, the sentences it lives in, the words it
          is built from, and the proverbs that use it. Where we do not know something, the entry
          says so instead of guessing.
        </p>
      </section>

      <section className="section">
        <h2>What one search gives you</h2>
        <ul>
          <li>
            <strong>Meanings</strong>, in order, each with its part of speech —{' '}
            {stats.definitions.toLocaleString()} recorded so far.
          </li>
          <li>
            <strong>Dialect and variants</strong> — which varieties use the word, how each of them
            spells it, and the spelling variants recorded beside it.{' '}
            {stats.dialects.toLocaleString()} varieties are registered.
          </li>
          <li>
            <strong>Voice recordings</strong> — {stats.audio.toLocaleString()} published, each
            attached either to the word itself or to the exact dialect spelling it is of, so a
            recording cannot be played against the wrong word.
          </li>
          <li>
            <strong>Example sentences</strong>, two per entry wherever the entry has them —{' '}
            {stats.examples.toLocaleString()} in total — so a word is seen in more than one
            construction.
          </li>
          <li>
            <strong>Ndebe</strong>, the Igbo syllabary, on every headword that can be written in it.{' '}
            <Link href="/ndebe">More about Ndebe</Link>.
          </li>
          <li>
            <strong>Related words</strong> — the root a word is built on, the words built on it,
            synonyms and antonyms.
          </li>
        </ul>
        <p>
          Three sections stand beside the dictionary:{' '}
          <Link href="/names">{nameCount.toLocaleString()} personal names</Link> with their
          meanings, gender and variants;{' '}
          <Link href="/proverbs">{proverbCount.toLocaleString()} proverbs</Link> with a literal line
          and the meaning; and <Link href="/clans">{clans.toLocaleString()} clans</Link> across{' '}
          the {tribes.toLocaleString()} divisions of Igboland, with {towns.toLocaleString()} towns
          recorded under them.
        </p>
      </section>

      <section className="section">
        <h2>The dictionary today</h2>
        <p>
          {stats.words.toLocaleString()} published entries across{' '}
          {stats.languagesWithContent.toLocaleString()} languages. Igbo is the deepest by a wide
          margin; Yoruba is next and is being built now. Further languages are registered and
          waiting for material — we would rather say that plainly than imply a breadth we have not
          earned.
        </p>
        <p>
          There is more here than reading, and the practice that turned entries into questions — a
          meaning to choose, a recording to identify a word by, a variety to place a spelling in — has
          moved with the courses to the Ozikoro Academy at <span className="mono">academy.ozikoro.com</span>,
          which is <Link href="/learn">being prepared</Link>. Meanwhile the <Link href="/docs">public API</Link> gives anyone a free
          key from their own <Link href="/contribute/account">account page</Link>, so a keyboard, a learning
          app or a translation tool does not have to begin by collecting a word list.
        </p>
      </section>

      <section className="section">
        <h2>How entries are made, and what we will not publish</h2>
        <p>
          Material is gathered from printed dictionaries, published papers and recorded speech, then
          checked against the language rather than copied from the first source that had it. Two
          rules do most of the work.
        </p>
        <ul>
          <li>
            <strong>A reading we are not sure of is not published.</strong> Where a proverb in the
            record is corrupt or fragmentary, the proverb is shown in the language alone and the
            English is left empty. A meaning labelled uncertain is still a meaning a reader will
            take, so we publish nothing rather than a guess with a warning on it.
          </li>
          <li>
            <strong>A recording is attached to the word it is of.</strong> A dialect recording
            belongs to the dialect spelling it was made for. An entry never plays another word's
            pronunciation in its own place — if there is no recording of the word itself, the entry
            shows none.
          </li>
        </ul>
        <p>
          Corrections are how the record improves. Anyone can propose an edit on any entry, and an
          editor reads every proposal before it is published.
        </p>
      </section>

      <section className="section">
        <h2>Who makes it</h2>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Founders
        </p>
        <ul>
          {FOUNDERS.map((person) => (
            <li key={person.name}>
              <strong>{person.name}</strong> — {person.role}. {person.note}
            </li>
          ))}
        </ul>
        {/*
          The writers are deliberately NOT here. The owner: "All the authors at the about us page must
          not be there. they are meant to be at ozikoro.com, so keep it aside for the time we will
          start work on it." They write the articles, and the articles live on the archive — crediting
          them on the dictionary would put the wrong people on the wrong site. The list is kept in
          work/ozikoro/writers-for-ozikoro.md for that page.
        */}
        <p>
          Around them is a wider group of contributors who send in words, recordings and
          corrections. Every recording is credited to the person who made it, and every accepted
          correction is recorded against the entry it changed.
        </p>
      </section>

      <section className="section">
        <h2>You can be part of it</h2>
        <p>
          The record grows in three ways and none of them needs permission first. You can{' '}
          <Link href="/contribute">add a word or a recording</Link>, propose a correction on any
          entry, or <Link href="/donate">support the work</Link> — donations pay for the time spent
          adding to the record and checking it, which is most of what this costs.
        </p>
        <p>
          If you are building something with the data, the <Link href="/docs">API is free</Link> and
          the key is yours to create. If you have material — a word list, a recording, a printed
          collection, a family history of names — that is the most valuable thing anyone can send
          us.
        </p>
      </section>

      <section className="section">
        <h2>Frequently asked questions</h2>
        {/*
          Drop-downs, which is what the owner asked for: "it has no faqs like it should be
          arranged. it should be a drop down". `<details>` rather than a scripted accordion — the
          browser already knows how to open and close one, it works from the keyboard, and it
          still works if the JavaScript never arrives.
        */}
          <details className="faq">
            <summary>Is Ozituma only for Igbo?</summary>
            <p>No. It is a dictionary of African languages. Igbo is where the work started and where it is deepest; Yoruba is being built now, and more languages are registered and waiting for material.</p>
          </details>
          <details className="faq">
            <summary>What is Igbo izugbe?</summary>
            <p>Igbo izugbe — <em>izugbe</em> on its own means <em>central</em> — is central Igbo: the variety the dictionary writes its Igbo headwords in, and the one a spelling is being compared with when an entry says a dialect has the same spelling as the Izugbe. It is the standard the other varieties are read against, not a claim that it is better than them.</p>
          </details>
          <details className="faq">
            <summary>Is it free?</summary>
            <p>Yes, to read and to use through the API. There is no paid tier.</p>
          </details>
          <details className="faq">
            <summary>How do I add a word?</summary>
            <p>Sign in, then use <Link href="/contribute">Contribute</Link>. An editor reviews every submission before it is published.</p>
          </details>
          <details className="faq">
            <summary>I found a mistake — what do I do?</summary>
            <p>Every entry, name and proverb has a proposal form on its own page. It goes to an editor, and if it is right it goes in.</p>
          </details>
          <details className="faq">
            <summary>Can I record my own pronunciation?</summary>
            <p>Yes. Any entry page will take one from a signed-in account, and your name is shown as the speaker. The recorder shows a waveform while you speak, so you can see it is hearing you.</p>
          </details>
          <details className="faq">
            <summary>Can I help if I have no title here?</summary>
            <p>Yes. Most of what is wanted is knowledge rather than a role — words, meanings, and above all recordings in varieties we have none of yet. Write to us and say what you know.</p>
          </details>
          <details className="faq">
            <summary>How do I delete my account?</summary>
            <p>Write to <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a> from the address on the account. What happens to contributions is set out in the <Link href="/privacy">privacy page</Link>.</p>
          </details>
          <details className="faq">
            <summary>What does it cost to run?</summary>
            <p>Time, mostly. That is what the <Link href="/donate">donation page</Link> is for.</p>
          </details>
      </section>

      {/*
        Support, with the amounts the donation page actually offers.
        
        The reference page this page was modelled on makes its ask concrete — a preset sum and a
        button — rather than leaving a reader to work out what to give. The figures here are read
        from the same list the donation form uses, in naira, so the two cannot disagree.
      */}
      <section className="section">
        <h2>Support the work</h2>
        <p>
          Ozituma runs on time: the hours spent adding entries and checking them, which is most of
          what this costs. A donation of ₦1,000, ₦2,500 or ₦5,000 pays for a few of those hours,
          and ₦10,000 or more pays for a working session on a language.
        </p>
        <p>
          <Link href="/donate">Donate to Ozikoro</Link> — every amount goes to the work of adding to
          the record and checking it.
        </p>
      </section>

      <section className="section">
        <h2>Reaching us</h2>
        <p>
          For corrections, material, partnerships, or anything the forms do not cover, write to{' '}
          <a href="mailto:hello@ozikoro.com">hello@ozikoro.com</a>. To have an account and its data
          deleted, write to the same address and say which account.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          See also: <Link href="/privacy">Privacy</Link> · <Link href="/ndebe">Ndebe</Link> ·{' '}
          <Link href="/docs">API</Link> ·{' '}
          <a href="https://ozikoro.com" rel="noopener">
            Ozikoro, the archive
          </a>
        </p>
      </section>
    </div>
  );
}
