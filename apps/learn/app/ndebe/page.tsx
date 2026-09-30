import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Write Ndebe · Ozituma Learn',
  description:
    'Learn to read and type Ndebe (Ńdébé), the Igbo syllabary — an on-screen keyboard, drills built from the dictionary, and a font check that tells you when your device cannot draw the script.',
};

/**
 * The Ndebe course hub.
 *
 * §5 of the plan asks for exactly this: a guided track, plus standalone tools, plus a reference. The
 * hub is the place those three are told apart, because they are used differently — a learner follows
 * the track, but comes back to the keyboard the way they come back to a pen.
 *
 * WHY THE MODULES ARE LISTED EVEN WHEN THEY ARE NOT BUILT
 *
 * §6 defines ten modules and §14 puts them across four phases. A page that showed only what exists
 * today would show Module 0 and a keyboard, and a learner would reasonably conclude the course is
 * that. Listing the track and marking what is not ready is the honest version, and it is also what
 * §16 asks for: "Exclude them from drills; be open about it."
 *
 * WHAT THIS SECTION IS NOT
 *
 * §2: "It is not a second dictionary, not a full Ndebe encyclopaedia and not a rebuild of
 * Typendebe." So this page links to ozituma.com/ndebe for what the script IS, and to ndebe.org for
 * the script's own project. It teaches using the script, which is the one job §2 gives it.
 *
 * Credit: §13 requires crediting the script's creator and linking to ndebe.org wherever the script
 * is taught. That is the line at the foot of this page, and it is not decoration.
 */

interface ModuleEntry {
  number: string;
  title: string;
  goal: string;
  /** Built already, or named so a learner can see where the track goes. */
  state: 'ready' | 'next' | 'later';
  href?: string;
  /** §6's own "done when", so the learner knows what finishing means. */
  done: string;
}

const MODULES: ModuleEntry[] = [
  {
    number: '0',
    title: 'Start here: check and setup',
    goal: 'Get your device drawing the script, and type your first syllables.',
    state: 'ready',
    href: '/ndebe/start',
    done: 'The font check passes and you have typed three syllables.',
  },
  {
    number: '1',
    title: 'Thinking in syllables',
    goal: 'Shift from letters to syllables — the unit the script writes.',
    state: 'next',
    done: 'Split 8 of 10 words correctly and find 5 syllables on the grid.',
  },
  {
    number: '2',
    title: 'How a character is built',
    goal: 'Every character is consonant body + vowel + tone.',
    state: 'later',
    done: 'Identify body and vowel correctly for 15 of 20 characters.',
  },
  {
    number: '3',
    title: 'Tone lives in the character',
    goal: 'Tone is part of the character, not a mark added on top.',
    state: 'later',
    done: 'Pass a 10-item tone-choice drill at 80%.',
  },
  {
    number: '4',
    title: 'The spelling rules',
    goal: 'The three rules that decide whether a spelling is correct.',
    state: 'later',
    done: 'Identify the broken rule in 8 of 10 examples.',
  },
  {
    number: '5',
    title: 'Typing basics',
    goal: 'Produce single characters quickly and confidently.',
    state: 'later',
    done: 'Type 30 syllables at 90% accuracy.',
  },
  {
    number: '6',
    title: 'Typing words',
    goal: 'Type whole words, including tone, from dictionary data.',
    state: 'later',
    done: 'Type 20 words at 85% accuracy.',
  },
  {
    number: '7',
    title: 'Your name and proverbs',
    goal: 'A personal win and a cultural payoff.',
    state: 'later',
    done: 'Type your name or a chosen name and one proverb.',
  },
  {
    number: '8',
    title: 'Sentences and free writing',
    goal: 'Write short connected text.',
    state: 'later',
    done: 'Five dictation sentences and one free-write.',
  },
  {
    number: '9',
    title: 'Numbers and punctuation',
    goal: 'Numerals and common punctuation. Optional.',
    state: 'later',
    done: 'Type 10 numerals and 5 short expressions.',
  },
];

export default function NdebeHubPage() {
  const ready = MODULES.filter((entry) => entry.state === 'ready');

  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Ndebe</p>
        <h1 className="learn-hero-title">Learn to write Ndebe</h1>
        <p className="hero-lede">
          Ndebe (Ńdébé) writes Igbo one syllable per character. This is a course for people who
          already read and write Igbo in Latin — it teaches the script, not the language, so there
          are no lessons on what a vowel is.
        </p>
        <div className="learn-actions">
          <Link className="button" href="/ndebe/start">
            Start with Module 0
          </Link>
          <Link className="button button-secondary" href="/ndebe/keyboard">
            Open the keyboard
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The tools, kept apart from the track                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="learn-section">
        <h2 className="learn-section-title">Tools</h2>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          These stand on their own. The keyboard needs nothing installed, which is why it comes
          first — setup is where most people learning a new script give up.
        </p>
        <ul className="learn-review-list">
          <li className="learn-review-item">
            <span className="learn-review-prompt">
              <Link href="/ndebe/keyboard">On-screen keyboard</Link>
            </span>
            <span className="learn-review-answer">
              Build a character in three steps — body, vowel, tone — with no font or keyboard
              installed. Copy what you write.
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">
              <Link href="/ndebe/start">Font check</Link>
            </span>
            <span className="learn-review-answer">
              Find out whether your device can draw the script, and what to do if it cannot.
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">
              <a href="https://ozituma.com/ndebe">The full chart</a>
            </span>
            <span className="learn-review-answer">
              Every syllable, with its three tone forms and the words that use it. The course sends
              you here rather than rebuilding it.
            </span>
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The track                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="learn-section">
        <h2 className="learn-section-title">The course</h2>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Ten short modules, about ten to twenty minutes each, ending in a typing or reading
          activity. {ready.length === 1 ? 'One is' : `${ready.length} are`} ready so far.
        </p>

        <ul className="ndebe-modules">
          {MODULES.map((entry) => {
            const inner = (
              <>
                <span className="ndebe-module-num">{entry.number}</span>
                <span className="ndebe-module-body">
                  <span className="ndebe-module-title">{entry.title}</span>
                  <p className="ndebe-module-goal">{entry.goal}</p>
                  <span className="ndebe-module-meta">
                    {entry.state === 'ready'
                      ? `Done when: ${entry.done}`
                      : entry.state === 'next'
                        ? 'Next to be built'
                        : `Done when: ${entry.done}`}
                  </span>
                </span>
              </>
            );

            return (
              <li
                key={entry.number}
                className={entry.state === 'ready' ? 'ndebe-module' : 'ndebe-module ndebe-module-pending'}
              >
                {entry.href ? (
                  <Link href={entry.href} className="ndebe-module-link" style={{ display: 'contents' }}>
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Where the answers come from                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="learn-section">
        <h2 className="learn-section-title">Where the answers come from</h2>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Every spelling, example and answer key in this course comes from the Ozituma dictionary,
          which already carries Ndebe spellings on 99% of its Igbo entries. Nothing is typed into a
          lesson by hand, so a correction in the dictionary corrects the course too.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Where a word cannot be written correctly, the course says so rather than approximating it.
        </p>
      </section>

      {/*
        §13: "Credit the script's creator, Lotanna Igwe-Odunze, and link to ndebe.org wherever the
        script is taught." This is that credit.
      */}
      <section className="learn-section">
        <p className="muted" style={{ fontSize: '0.84rem' }}>
          Ndebe (Ńdébé) was created by <strong>Lotanna Igwe-Odunze</strong>. The script&rsquo;s own
          project is at <a href="https://ndebe.org">ndebe.org</a>. Ozituma writes and teaches it with
          the Ndebe Project&rsquo;s permission.
        </p>
      </section>
    </div>
  );
}
