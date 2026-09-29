import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import {
  NDEBE_BODIES,
  NDEBE_MARKER_BASE,
  NDEBE_VOWELS,
  syllableCodepoint,
} from '@ozituma/core';
import './ndebe.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ndebe',
  description:
    'Ndebe (Ńdébé) is a syllabary written for Igbo — one character per syllable. What it is, how it works, and how it appears on every entry in this dictionary.',
};

/*
 * A page about a writing system, which is a different kind of page from an entry: it is the
 * one place here that is an explanation rather than a record. So it has to be right about
 * the script.
 *
 * The facts below come from the module that implements the transliteration, which was
 * verified against the script's own syllable grid: 42 consonant bodies, 9 vowels, three
 * tones, and the spelling rules the script's author sets out. The rules are stated because
 * they are the reason a transliteration can be wrong — a reader who thinks a syllabary is
 * just a font will wonder why a word is written differently from how they would write it.
 */
export default async function NdebePage() {
  const db = await getDb();
  const row = await db.one<{ words: number; written: number; names: number }>(
    `select
       (select count(*)::int from word w
         where w.language_code = 'ibo' and w.status = 'published') as words,
       (select count(distinct ws.word_id)::int from word_script ws
          join word w on w.id = ws.word_id
         where ws.script_code = 'Ndebe' and w.language_code = 'ibo' and w.status = 'published')
         as written,
       (select count(*)::int from person_name_script) as names`
  );
  const words = Number(row?.words ?? 0);
  const written = Number(row?.written ?? 0);
  const names = Number(row?.names ?? 0);

  return (
    <div className="wrap wrap-narrow">
      <h1>Ndebe</h1>

      <p className="hero-lede">
        Ndebe — <span lang="und-Ndebe">Ńdébé</span> — is a writing system made for Igbo. It is a
        syllabary, not an alphabet: one character stands for one whole syllable, so a word written
        in Ndebe is read a syllable at a time rather than a letter at a time.
      </p>

      <p>
        It was created by <strong>Lotanna Igwe-Odunze</strong>, who designed it to fit Igbo rather
        than to fit Igbo into the Latin alphabet. That is the whole idea. Igbo is written today with
        letters borrowed from a language it is not related to, and the borrowing shows: the marks
        under the vowels, the tone marks above them, and the fact that a letter can mean several
        different sounds depending on the word. A syllabary starts from the syllable instead, which
        is the unit Igbo actually counts in.
      </p>

      <section className="section">
        <h2>How it works</h2>
        <p>
          The script is built from a grid. There are <strong>42 consonant bodies</strong> and{' '}
          <strong>9 vowels</strong> — <span className="mono">a ẹ ị ọ ụ</span> and{' '}
          <span className="mono">e i o u</span> — and every consonant-and-vowel pair has its own
          character. A character also carries its tone, of which Igbo has three: high, mid and low.
          The result is that a Ndebe spelling can say exactly how a word is pronounced, including
          the tone, without any marks added on top.
        </p>
        <p>
          There are <strong>1,134 syllables</strong> in the grid, and every one of them is mapped.
        </p>
      </section>


      <section className="section">
        <h2>The chart</h2>
        <p>
          Every syllable the script can write, as the script draws it. Read across for the vowel
          and down for the consonant, the way the script's own chart is set out: the row is the
          body — the consonant or consonant cluster the syllable begins with, and <em>a</em> when
          it stands alone — and the column is the vowel that follows it.
        </p>
        <p className="muted" style={{ fontSize: '0.92rem' }}>
          The forms below are the mid-tone ones, which are the shapes a reader meets most. Every
          syllable has a high form and a low form as well, and the tone is part of the character
          rather than a mark added to it. Press any syllable to see all three and the words here
          that use it.
        </p>

        <div className="ndebe-chart-wrap">
          <table className="ndebe-chart">
            <thead>
              <tr>
                <th scope="col" className="ndebe-chart-corner">
                  <span className="sr-only">Body</span>
                </th>
                {NDEBE_VOWELS.map((vowel) => (
                  <th scope="col" key={vowel} className="ndebe-chart-vowel">
                    {vowel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/*
                The vowels on their own. These are not body-plus-vowel like the rows below:
                a vowel standing alone has its own run of characters, which is why A, E and I
                as whole syllables look nothing like their shapes inside GA or BE. Without
                this row the chart is missing nine syllables a reader writing Igbo will meet in
                the first line they try.

                The characters here are the ones this dictionary writes, which are the script's
                marker forms — the same shape family as the syllable rows, marked rather than
                drawn afresh. The script also has a separate run of standalone vowel characters;
                where a chart shows those instead, the two differ for the same syllable, which is
                exactly the confusion a learner does not need.
              */}
              <tr>
                <th scope="row" className="ndebe-chart-body">
                  — alone
                </th>
                {NDEBE_VOWELS.map((vowel, vowelIndex) => (
                  <td key={vowel}>
                    <Link
                      className="ndebe-cell"
                      href={`/ndebe/${encodeURIComponent(vowel)}`}
                      title={`${vowel} on its own — all three tones`}
                    >
                      <span className="ndebe-glyph" lang="und-Ndebe">
                        {String.fromCodePoint(NDEBE_MARKER_BASE + vowelIndex * 3 + 1)}
                      </span>
                      <span className="ndebe-cell-roman">{vowel}</span>
                    </Link>
                  </td>
                ))}
              </tr>
              {NDEBE_BODIES.map((alternatives, body) => (
                <tr key={alternatives[0]}>
                  <th scope="row" className="ndebe-chart-body">
                    {alternatives.join(' / ')}
                  </th>
                  {NDEBE_VOWELS.map((vowel, vowelIndex) => {
                    const roman = alternatives[0]! + vowel;
                    // Tone 1 is the mid tone; see NDEBE_TONES.
                    const codepoint = syllableCodepoint(body, vowelIndex, 1);
                    return (
                      <td key={vowel}>
                        <Link
                          className="ndebe-cell"
                          href={`/ndebe/${encodeURIComponent(roman)}`}
                          title={`${roman} — all three tones`}
                        >
                          <span className="ndebe-glyph" lang="und-Ndebe">
                            {String.fromCodePoint(codepoint)}
                          </span>
                          <span className="ndebe-cell-roman">{roman}</span>
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          {NDEBE_BODIES.length} bodies × {NDEBE_VOWELS.length} vowels × 3 tones, plus the{' '}
          {NDEBE_VOWELS.length} vowels standing alone —{' '}
          {((NDEBE_BODIES.length + 1) * NDEBE_VOWELS.length * 3).toLocaleString()} syllables.
          Press any one to see its three forms and the words here that use it.
        </p>
      </section>

      <section className="section">
        <h2>The rules that make a spelling correct</h2>
        <p>
          A syllabary only works if the syllables are the right ones, so three rules decide how a
          word is written. They come from the script itself, not from this site:
        </p>
        <ul>
          <li>
            <strong>A word cannot end in a consonant</strong>, with one exception:{' '}
            <span className="mono">m</span>. So a final consonant has to resolve into a syllable that
            Igbo actually allows.
          </li>
          <li>
            <strong>A vowel that is elided in speech is elided in writing.</strong> Where two vowels
            meet and one is swallowed, the spelling keeps only the one that is said —{' '}
            <span className="mono">Nwaanyi</span> is written{' '}
            <span className="mono">Nw&rsquo;ayi</span>, the way it is spoken.
          </li>
          <li>
            <strong>The tone of the whole word has to be right.</strong> This is the rule that makes
            the writing system worth having and the one that is easiest to get wrong: replacing one
            character with another of the same sound but a different tone does not produce a
            misspelling, it produces a different word.
          </li>
        </ul>
      </section>

      <section className="section">
        <h2>Ndebe on Ozituma</h2>
        <p>
          Every Igbo entry that can be written in Ndebe carries the spelling on its page, under the
          headword and above the meanings. That is {written.toLocaleString()} of the{' '}
          {words.toLocaleString()} Igbo entries published here — {Math.round((written / words) * 100)}
          %. The rest are words the grid cannot write: a word that is not Igbo to begin with, or one
          whose spelling cannot be resolved into legal syllables without inventing something.
        </p>
        <p>
          Those entries show nothing rather than an approximation. A script line that is nearly
          right is worse than no script line, because a reader who cannot check it will take it as
          the spelling.
        </p>
        <p>
          Names carry it too: {names.toLocaleString()} spellings across the name dictionary, written
          the same way and by the same rules.
        </p>
        <p>
          <Link href="/">Look up a word</Link> · <Link href="/names">Read the names</Link>
        </p>
      </section>

      <section className="section">
        <h2>Reading it</h2>
        <p>
          If Ndebe is new to you, the entry pages are a reasonable place to start, because each one
          puts the spelling directly under the word it belongs to and the pronunciation is available
          as a recording beside it. Read the syllable, listen to the word, and the mapping between
          the two is what the script is for.
        </p>
        <p>
          To go further with it, the script's own project is at{' '}
          <a href="https://ndebe.org" target="_blank" rel="noopener noreferrer">
            ndebe.org
          </a>{' '}
          — the source for the grid, the rules and the character set used here. And if what you
          want is to write in it rather than read it,{' '}
          <a href="https://typendebe.com" target="_blank" rel="noopener noreferrer">
            typendebe.com
          </a>{' '}
          is a keyboard for it.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          See also: <Link href="/about">About Ozituma</Link> · <Link href="/privacy">Privacy</Link>
        </p>
      </section>
    </div>
  );
}
