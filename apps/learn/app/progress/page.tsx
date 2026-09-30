import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getLearnerProgress } from '@ozituma/db/learn-gamification';
import { getCurrentAccount } from '@/lib/session';
import { learnerTimeZone } from '@/lib/timezone';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your progress · Ozituma Learn',
  description: 'What you have learned so far, and what is coming back.',
};

/**
 * Progress: level, streak and badges.
 *
 * ENTIRELY SERVER-RENDERED, on purpose. There is nothing interactive here — it is a summary — and a
 * page that needs a hydrated bundle to display numbers that were already known on the server is a
 * page that shows a spinner to someone on a slow connection for no reason. §13's performance budget
 * and §3's "works on a mid-range Android" both point the same way.
 *
 * THE STREAK SHOWN IS NOT "EXTENDED BY VIEWING"
 *
 * `getLearnerProgress` reads the streak; it never records activity. Opening this page cannot keep a
 * streak alive, which it must not — a streak that counts being looked at is not a measure of
 * practice.
 */
export default async function ProgressPage() {
  const session = await getCurrentAccount();

  if (!session) {
    return (
      <div className="wrap wrap-narrow">
        <section className="learn-hero">
          <p className="learn-eyebrow">Progress</p>
          <h1 className="learn-hero-title">Your progress</h1>
          <p className="hero-lede">
            Levels, streaks and badges all belong to an account, because they are a record of what you
            have done over time. Without one there is nothing to show — and nothing here is locked,
            you just cannot carry a score.
          </p>
        </section>
        <div className="learn-actions">
          <Link className="button" href="/signin?next=/progress">
            Sign in
          </Link>
          <Link className="button button-secondary" href="/join?next=/progress">
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  // The zone travels on the request; a server-side default would place a Lagos learner's day in UTC.
  const timeZone = learnerTimeZone({
    headers: await headers(),
  } as unknown as Request);

  const db = await getDb();
  const progress = await getLearnerProgress(db, session.account.id, timeZone);

  const { level, streak, badges, stats } = progress;
  const percent = Math.round(level.fraction * 100);

  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Progress</p>
        <h1 className="learn-hero-title">
          Level {level.level}
          {streak.alive && streak.current > 0 ? ` · ${streak.current} day streak` : ''}
        </h1>
        <p className="hero-lede">
          {progress.totalXp.toLocaleString()} XP so far. Levels come from the work you have finished,
          not the time you have spent — and the streak counts days you practised, in your own time
          zone.
        </p>
      </section>

      <section className="learn-section">
        <div className="learn-progress-track" aria-hidden="true">
          <div className="learn-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="muted" style={{ fontSize: '0.86rem', marginTop: '0.5rem' }}>
          {level.xpIntoLevel} of {level.xpForLevel} XP into level {level.level} ·{' '}
          {level.xpToNextLevel.toLocaleString()} to level {level.level + 1}
        </p>
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">The numbers</h2>
        <ul className="learn-review-list">
          <li className="learn-review-item">
            <span className="learn-review-prompt">Streak</span>
            <span className="learn-review-answer">
              <strong>{streak.current}</strong> day{streak.current === 1 ? '' : 's'}
              {streak.longest > streak.current ? ` · best ${streak.longest}` : ''}
              {streak.freezesAvailable > 0
                ? ` · ${streak.freezesAvailable} freeze${streak.freezesAvailable === 1 ? '' : 's'} in hand`
                : ''}
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">Words in your schedule</span>
            <span className="learn-review-answer">
              <strong>{stats.wordsTracked.toLocaleString()}</strong> · {stats.wordsLearned.toLocaleString()}{' '}
              past the first steps
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">Correct answers</span>
            <span className="learn-review-answer">
              <strong>{stats.correctAnswers.toLocaleString()}</strong>
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">Review sessions</span>
            <span className="learn-review-answer">
              <strong>{stats.reviewsCompleted.toLocaleString()}</strong>
            </span>
          </li>
          <li className="learn-review-item">
            <span className="learn-review-prompt">Lessons completed</span>
            <span className="learn-review-answer">
              <strong>{stats.lessonsCompleted.toLocaleString()}</strong>
              {stats.lessonsCompleted === 0 ? (
                <span className="muted"> — the courses publish once a linguist has approved them</span>
              ) : null}
            </span>
          </li>
        </ul>
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">Badges</h2>
        {badges.length === 0 ? (
          <div className="notice">
            <strong>No badges yet.</strong>
            <p style={{ margin: '0.4rem 0 0.8rem' }}>
              The first ones arrive quickly — completing a lesson, or a week of practice. You can see
              what is available below.
            </p>
          </div>
        ) : (
          <div className="grid learn-course-grid">
            {badges.map((badge) => (
              <div key={badge.id} className="card">
                <h3 className="learn-course-title">{badge.name}</h3>
                <p className="learn-course-subtitle">{badge.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {progress.totalXp === 0 ? (
        <section className="learn-section">
          <div className="notice">
            <strong>Nothing recorded yet.</strong>
            <p style={{ margin: '0.4rem 0 0.8rem' }}>
              Answer some vocabulary and your level, streak and schedule all start from there.
            </p>
            <Link className="button" href="/practice">
              Practise vocabulary
            </Link>
          </div>
        </section>
      ) : (
        <section className="learn-section">
          <h2 className="learn-section-title">Keep going</h2>
          <div className="learn-actions">
            <Link className="button" href="/plan">
              Today&rsquo;s review
            </Link>
            <Link className="button button-secondary" href="/practice">
              Practise new words
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
