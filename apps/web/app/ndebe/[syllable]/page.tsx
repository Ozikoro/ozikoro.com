import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import {
  NDEBE_BODIES,
  NDEBE_MARKER_BASE,
  NDEBE_TONES,
  NDEBE_VOWELS,
  syllableCodepoint,
} from '@ozituma/core';
import '../ndebe.css';

export const dynamic = 'force-dynamic';

/**
 * One syllable of the Ndebe syllabary.
 *
 * A syllabary is learned a character at a time, and the way to learn a character is to look
 * at it, see what it says, and meet words that use it. So each page here does those three
 * things, and the third is what this site can do that no chart can: the dictionary holds
 * 12,056 Igbo words already transliterated into Ndebe, and every word containing this
 * syllable is found by looking for the character itself rather than by guessing at
 * spellings.
 *
 * THE LOOKUP IS ON THE GLYPH
 *
 * A word written in Ndebe contains the syllable's character, whichever tone that syllable
 * carries in that word — so the search asks for any of the three tone forms. That is exact:
 * it cannot return a word that merely looks like it might contain the syllable. Searching
 * the romanisation instead would match across syllable boundaries and produce words that do
 * not contain it at all, which for a page whose whole purpose is teaching the mapping would
 * be worse than showing nothing.
 */

interface SyllablePageProps {
  params: Promise<{ syllable: string }>;
}

/**
 * The syllable as the chart names it: a body's primary form plus a vowel, or a vowel on its
 * own.
 *
 * A vowel standing alone is a separate case: A is not the A of GA with the consonant taken
 * away, it is its own character. The one used here is the marker form, because that is what
 * the transliteration writes — a chart that showed the script's other standalone run would
 * be showing a character the reader will not meet in any entry.
 */
function parseSyllable(raw: string) {
  const value = decodeURIComponent(raw);
  const loneVowel = NDEBE_VOWELS.indexOf(value as (typeof NDEBE_VOWELS)[number]);
  if (loneVowel >= 0) {
    return { body: -1, vowelIndex: loneVowel, roman: value, alternatives: ['—'] };
  }
  for (let body = 0; body < NDEBE_BODIES.length; body += 1) {
    const alternatives = NDEBE_BODIES[body]!;
    for (const spelling of alternatives) {
      if (!value.startsWith(spelling)) continue;
      const rest = value.slice(spelling.length);
      const vowelIndex = NDEBE_VOWELS.indexOf(rest as (typeof NDEBE_VOWELS)[number]);
      if (vowelIndex >= 0) {
        return { body, vowelIndex, roman: value, alternatives };
      }
    }
  }
  return null;
}

export async function generateMetadata({ params }: SyllablePageProps): Promise<Metadata> {
  const { syllable } = await params;
  const parsed = parseSyllable(syllable);
  if (!parsed) return { title: 'Not a syllable' };
  return {
    title: `${parsed.roman} — Ndebe`,
    description: `The Ndebe characters for ${parsed.roman} in all three tones, and the Igbo words in this dictionary that use the syllable.`,
  };
}

export default async function SyllablePage({ params }: SyllablePageProps) {
  const { syllable } = await params;
  const parsed = parseSyllable(syllable);
  if (!parsed) notFound();

  const { body, vowelIndex, roman, alternatives } = parsed;
  const standalone = body < 0;
  const tones = NDEBE_TONES.map((tone, toneIndex) => {
    const codepoint = standalone
      ? NDEBE_MARKER_BASE + vowelIndex * 3 + toneIndex
      : syllableCodepoint(body, vowelIndex, toneIndex);
    return { tone, codepoint, character: String.fromCodePoint(codepoint) };
  });

  /*
   * The words. `word_script.value` is the whole transliterated headword, so a word contains
   * this syllable when its Ndebe text contains any of the three characters.
   */
  const db = await getDb();
  const characters = tones.map((t) => t.character);
  const words = await db.rows<{ headword: string; slug: string; language_code: string; ndebe: string }>(
    `select w.headword, w.slug, w.language_code, ws.value as ndebe
       from word_script ws
       join word w on w.id = ws.word_id
      where ws.script_code = 'Ndebe'
        and w.status = 'published'
        and (ws.value like '%' || $1 || '%'
             or ws.value like '%' || $2 || '%'
             or ws.value like '%' || $3 || '%')
      order by length(w.headword), w.headword
      limit 60`,
    characters
  );

  return (
    <div className="wrap wrap-narrow">
      <p className="muted" style={{ marginBottom: '0.5rem' }}>
        <Link href="/ndebe">← The Ndebe chart</Link>
      </p>

      <h1 style={{ marginBottom: '0.25rem' }}>
        <span lang="und-Ndebe" style={{ fontFamily: "'Ndebe Rounded', serif" }}>
          {tones[1]!.character}
        </span>{' '}
        <span style={{ fontFamily: 'var(--font-serif)' }}>{roman}</span>
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {standalone ? (
          <>
            The vowel <strong>{NDEBE_VOWELS[vowelIndex]}</strong> on its own — a syllable of the
            Ndebe syllabary with no consonant body, which the script writes with its own
            character rather than as a body with the consonant left off.
          </>
        ) : (
          <>
            A syllable of the Ndebe syllabary: the body <strong>{alternatives.join(' / ')}</strong>{' '}
            with the vowel <strong>{NDEBE_VOWELS[vowelIndex]}</strong>.
          </>
        )}
      </p>

      <section className="section">
        <h2>The three tones</h2>
        <p>
          Tone is part of the character in Ndebe, not a mark added to it, so one syllable is
          written three different ways. These are the same shape family — the character on the
          left in each box is the one to learn first, and it is the form the chart shows.
        </p>
        <ul className="ndebe-tone-row">
          {tones.map((tone) => (
            <li className="ndebe-tone" key={tone.tone}>
              <span className="ndebe-glyph" lang="und-Ndebe">
                {tone.character}
              </span>
              <p className="ndebe-tone-name">{tone.tone} tone</p>
              <p className="ndebe-tone-roman">{roman}</p>
              <p className="muted" style={{ fontSize: '0.75rem', marginBottom: 0 }}>
                U+{tone.codepoint.toString(16).toUpperCase()}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2>Words that use it</h2>
        {words.length > 0 ? (
          <>
            <p className="muted" style={{ fontSize: '0.92rem' }}>
              {words.length === 60 ? 'Sixty' : words.length} of the Igbo entries here carry this
              syllable, shortest first. The Ndebe spelling is written under each word, and the
              syllable you are looking for is in it.
            </p>
            <ul className="ndebe-word-list">
              {words.map((word) => (
                <li key={`${word.language_code}-${word.slug}`}>
                  <Link href={`/word/${word.language_code}/${word.slug}`} className="ndebe-word">
                    <span className="ndebe-word-head">{word.headword}</span>
                    <span className="ndebe-word-script" lang="und-Ndebe">
                      {word.ndebe}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            No published entry in this dictionary uses this syllable yet. The chart still shows
            it, because a syllabary is the whole set of its characters rather than the ones that
            happen to appear in a word list — but there is nothing here to read it in.
          </p>
        )}
      </section>

      <section className="section">
        <h2>{standalone ? 'The other vowels on their own' : 'The same body, other vowels'}</h2>
        <ul className="ndebe-sibling-row">
          {NDEBE_VOWELS.map((vowel, index) => {
            const other = standalone ? vowel : alternatives[0]! + vowel;
            const character = String.fromCodePoint(
              standalone
                ? NDEBE_MARKER_BASE + index * 3 + 1
                : syllableCodepoint(body, index, 1)
            );
            return (
              <li key={vowel}>
                <Link
                  className={`ndebe-sibling${index === vowelIndex ? ' ndebe-sibling-on' : ''}`}
                  href={`/ndebe/${encodeURIComponent(other)}`}
                >
                  <span className="ndebe-glyph" lang="und-Ndebe">
                    {character}
                  </span>
                  <span className="ndebe-cell-roman">{other}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
