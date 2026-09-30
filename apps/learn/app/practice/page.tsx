import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { countPracticeWords } from '@ozituma/db/learn-practice';
import { getCurrentAccount } from '@/lib/session';
import { PracticeRunner } from '@/components/learn/practice-runner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Practise Igbo vocabulary · Ozituma Learn',
  description:
    'Practise real Igbo words from the Ozituma dictionary, with native recordings, until you can recall them.',
};

/**
 * Practise vocabulary from the dictionary.
 *
 * WHY THIS PAGE EXISTS AT ALL
 *
 * The courses at /igbo are authored curriculum, and §18 #4 — a named lead linguist and two native
 * reviewers — has no default. Until that team exists, no lesson can publish, and a learner arriving
 * at Ozituma Learn would find a site with nothing to do on it.
 *
 * That is a content problem, not a software one, and it has a legitimate answer. §2.1 allows Igbo
 * that comes from the approved content database or from the owner's own files, and §11.4 names the
 * verified dictionary as the first seed data set. The dictionary holds 12,229 published Igbo words
 * with definitions, 4,257 of them with native recordings. So this page practises THOSE.
 *
 * It is not a curriculum and does not claim to be one. It sequences by the corpus's own frequency
 * ordering, which is an honest ordering and not a pedagogical one — the ordering is the linguist's
 * job and this page does not pre-empt it. What it gives a learner today is real words, real audio,
 * real recall practice, and a reason to come back.
 */
export default async function PracticePage() {
  const db = await getDb();
  const session = await getCurrentAccount();

  // Counted on the server so the page can state the real size of what is on offer rather than a
  // number written into the copy that goes stale as the dictionary grows.
  const counts = await countPracticeWords(db);

  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Practice</p>
        <h1 className="learn-hero-title">Practise what the dictionary knows</h1>
        <p className="hero-lede">
          These are real Igbo words from Ozituma, in the order the corpus says they are most common.
          Every one has an entry you can open, and{' '}
          {counts.withAudio.toLocaleString()} of them have a native recording you can hear. Nothing
          here was written by a machine — the words and the audio are the dictionary&rsquo;s own,
          reviewed records.
        </p>
        <p className="muted" style={{ marginTop: '0.4rem' }}>
          This is vocabulary practice, not a lesson. The Level 0 and Level 1 courses are separate:
          they are authored by a linguist, and they publish when that work is done.
        </p>
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">Your set</h2>
        {
          /* Passed from the server: the dictionary is a different origin, and a client component
              cannot read a non-NEXT_PUBLIC variable. */
        }
        <PracticeRunner
          signedIn={session !== null}
          dictionaryUrl={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}
        />
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">What is available</h2>
        <ul className="learn-review-list">
          <li className="learn-review-item">
            <span className="learn-review-prompt">Words to practise</span>
            <span className="learn-review-answer">
              <strong>{counts.total.toLocaleString()}</strong> published Igbo words with a definition
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">With a recording</span>
            <span className="learn-review-answer">
              <strong>{counts.withAudio.toLocaleString()}</strong> words you can hear before you say
              them
            </span>
          </li>
        </ul>
        <p className="muted" style={{ fontSize: '0.86rem' }}>
          A full dictionary entry — every definition, every dialect, every recording — lives at{' '}
          <a href={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}>ozituma.com</a>.
        </p>
      </section>
    </div>
  );
}
