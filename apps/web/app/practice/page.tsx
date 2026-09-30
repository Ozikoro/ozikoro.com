import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listLanguages } from '@ozituma/db/repository';
import { MODE_DESCRIPTIONS, PRACTICE_MODES, practiceAvailability, type PracticeMode } from '@ozituma/db/practice';
import { Quiz } from '@/components/quiz';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Practice',
  description:
    'Practise Igbo with questions generated from the dictionary: meanings and listening, in Igbo Izugbe.',
};

const MODE_LABELS: Record<PracticeMode, string> = {
  meaning: 'Meanings',
  listening: 'Listening',
};

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; language?: string }>;
}) {
  const params = await searchParams;
  const db = await getDb();

  // Only languages with content are offered, so nobody starts a quiz that
  // cannot generate a question.
  const languages = (await listLanguages(db)).filter((language) => language.wordCount > 0);
  const language = params.language && languages.some((l) => l.code === params.language)
    ? params.language
    : (languages[0]?.code ?? 'ibo');

  const mode: PracticeMode = PRACTICE_MODES.includes(params.mode as PracticeMode)
    ? (params.mode as PracticeMode)
    : 'meaning';

  const availability = await practiceAvailability(db, language);
  const hasContent = availability[mode] >= 4;

  return (
    <div className="wrap wrap-narrow">
      <h1>Practice</h1>
      <p className="hero-lede">
        Questions generated from the dictionary itself — its definitions and its recordings, in
        Igbo Izugbe, the standard Igbo the dictionary is written in. No account needed, and nothing
        is stored: this is for learning, not for scoring.
      </p>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', margin: '1.5rem 0' }}>
        {PRACTICE_MODES.map((option) => {
          const disabled = availability[option] < 4;
          const active = option === mode;
          return (
            <Link
              key={option}
              href={`/practice?mode=${option}&language=${language}`}
              className={`button ${active ? '' : 'button-secondary'}`}
              style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
              aria-current={active ? 'page' : undefined}
            >
              {MODE_LABELS[option]}
              <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: '0.4rem' }}>
                {availability[option].toLocaleString()}
              </span>
            </Link>
          );
        })}
      </div>

      <p className="muted" style={{ fontSize: '0.92rem', marginTop: '-0.75rem' }}>
        {MODE_DESCRIPTIONS[mode]}
      </p>

      {languages.length > 1 ? (
        <p style={{ fontSize: '0.92rem' }}>
          Language:{' '}
          {languages.map((option, index) => (
            <span key={option.code}>
              {index > 0 ? ' · ' : ''}
              <Link
                href={`/practice?mode=${mode}&language=${option.urlSlug}`}
                style={{ fontWeight: option.code === language ? 700 : 400 }}
              >
                {option.name}
              </Link>
            </span>
          ))}
        </p>
      ) : null}

      <section style={{ marginTop: '1.5rem' }}>
        {hasContent ? (
          <Quiz mode={mode} language={language} />
        ) : (
          <div className="notice notice-warn">
            <strong>Not enough content for {MODE_LABELS[mode]} practice yet.</strong>
            <p style={{ margin: '0.4rem 0 0' }}>
              This mode needs at least four entries to build a question with plausible alternatives.
              Try another mode, or help by <Link href="/contribute">contributing words</Link>.
            </p>
          </div>
        )}
      </section>

      <section style={{ marginTop: '3rem' }}>
        <h2>Why the questions are generated, not written</h2>
        <p>
          Every question is built from the dictionary at the moment you ask for it, and the wrong
          answers are chosen to be genuinely hard: the same grammar category, a comparable definition
          length, and never a word that shares a meaning with the right answer. That is deliberate —
          a quiz whose wrong answers are obviously wrong teaches nothing.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Every question is built from the dictionary itself — the{' '}
          <Link href="/docs">same entries</Link> you can read, hear and check.
        </p>
      </section>
    </div>
  );
}
