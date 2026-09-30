import Link from 'next/link';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import { listCourses, nextUnfinishedLesson } from '@ozituma/db/learn';
import { getLearnerProgress } from '@ozituma/db/learn-gamification';
import { getReviewSummary } from '@ozituma/db/learn-srs';
import { getCurrentAccount } from '@/lib/session';
import { learnerTimeZone } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ozituma Learn Igbo — Your daily learning journey',
  description:
    'Build confidence in Igbo through short lessons, listening, review, and culturally grounded practice.',
};

/**
 * The Learn home page — the daily journey.
 *
 * REBUILT FROM THE DESIGN at idenze/paper-whisperer-forge, which is a Lovable prototype of exactly
 * this screen. The previous version was a course index: a heading, a list of courses, a list of
 * modules. This is a dashboard, and the difference is the point — a course index tells you what
 * exists, a dashboard tells you what to do next.
 *
 * WHAT IS REAL AND WHAT IS MARKED
 *
 * Everything from the learner's own record is real: XP, level, streak, the resume point, courses,
 * progress, and the number of words due for review — all read from the database on every request.
 *
 * What is NOT real is teaching content, because §18 #4's linguist and native reviewers have not been
 * named and §2.1 forbids inventing it. So the panels that would carry it say so. The "Content
 * promise" card and the placeholder tag are the design's own device, kept because it is the honest
 * one: a learner should never be unsure whether what they are reading has been reviewed.
 *
 * WHY THE GREETING IS IN IGBO
 *
 * "Nnọọ" is welcome. The design opens with it and it is right to: a learner meeting one word of the
 * language before the first lesson costs nothing and sets the tone. It is a greeting, not teaching
 * material requiring review.
 */
export default async function LearnHome() {
  const db = await getDb();
  const session = await getCurrentAccount();
  const accountId = session?.account.id ?? null;
  const timeZone = learnerTimeZone(await headers());

  const courses = await listCourses(db, accountId);
  const firstCourse = courses[0] ?? null;

  const [resume, progress, review] = await Promise.all([
    firstCourse ? nextUnfinishedLesson(db, firstCourse.slug, accountId) : Promise.resolve(null),
    accountId ? getLearnerProgress(db, accountId, timeZone) : Promise.resolve(null),
    accountId ? getReviewSummary(db, accountId).catch(() => null) : Promise.resolve(null),
  ]);

  const name = session?.account.displayName?.trim() || null;
  const firstName = name ? name.split(/\s+/)[0]! : null;

  const level = progress?.level.level ?? 1;
  const totalXp = progress?.totalXp ?? 0;
  const streakDays = progress?.streak.current ?? 0;
  const dueWords = review?.dueNow ?? 0;

  // The greeting, in the learner's own day. A learner in Lagos at 00:30 is not still in yesterday.
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone }).format(new Date());

  const continueHref = resume
    ? `/${firstCourse!.slug}/${resume.slug}`
    : firstCourse
      ? `/${firstCourse.slug}`
      : '/practice';

  return (
    <div className="wrap">
      {/* ------------------------------------------------------------------ */}
      {/* The greeting                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="dash-hero rise-in">
        <div>
          <p className="dash-eyebrow">{today} · Today&rsquo;s journey</p>
          <h1 className="dash-greeting">{firstName ? `Nnọọ, ${firstName}.` : 'Nnọọ.'}</h1>
          <p className="dash-lede">
            {accountId
              ? 'A little every day goes a long way. Here is where you left off.'
              : 'A little every day goes a long way. Sign in to keep your place, or start with the dictionary’s own published words.'}
          </p>
        </div>

        {/* Real when signed in; the design's layout either way. */}
        <div className="dash-level">
          <div className="dash-level-badge">L{level}</div>
          <div className="dash-level-body">
            <div className="dash-level-row">
              <span>Level {level}</span>
              <span>{totalXp.toLocaleString()} XP</span>
            </div>
            <div className="dash-level-track">
              {/*
                The fill is the fraction into the current level. With no account there is no
                progress, so the bar is empty rather than showing an invented figure.
              */}
              <div
                className="dash-level-fill"
                style={{ width: `${accountId && progress ? Math.min(100, Math.round(progress.level.fraction * 100)) : 0}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="dash-shell">
        <div className="dash-main">
          {/* -------------------------------------------------------------- */}
          {/* Continue                                                       */}
          {/* -------------------------------------------------------------- */}
          <section className="dash-continue rise-in-delay">
            <div className="dash-continue-body">
              <div className="dash-continue-eyebrow">
                {firstCourse ? firstCourse.title : 'Start here'}
                {resume ? ` · ${resume.title}` : ''}
              </div>
              <h2 className="dash-continue-title">
                {resume
                  ? `Continue: ${resume.title}`
                  : firstCourse
                    ? firstCourse.title
                    : 'Find your first words'}
              </h2>
              <p className="dash-continue-text">
                {resume
                  ? 'Pick up where you left off.'
                  : 'Every word in this course comes from the Ozituma dictionary, with its meaning and its recording.'}
              </p>
              <div className="learn-actions" style={{ marginTop: '1.75rem' }}>
                <Link className="button" href={continueHref}>
                  {resume ? 'Continue lesson' : 'Start'} →
                </Link>
              </div>
            </div>
            <div className="dash-continue-art" aria-hidden="true">
              <div className="dash-continue-motto">
                Learn it.
                <br />
                Live it.
                <br />
                Pass it on.
              </div>
            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* Today's journey                                                */}
          {/* -------------------------------------------------------------- */}
          <section aria-labelledby="journey-heading">
            <div className="dash-section-head">
              <div>
                <p className="dash-section-kicker">Your plan</p>
                <h2 id="journey-heading" className="dash-section-title">
                  Today&rsquo;s journey
                </h2>
              </div>
            </div>

            <div className="dash-journey">
              <article className="dash-card">
                <div className="dash-card-icon dash-card-icon-green" aria-hidden="true">
                  ▶
                </div>
                <div className="dash-card-body">
                  <h3 className="dash-card-title">Continue your lesson</h3>
                  <p className="dash-card-detail">
                    {resume ? resume.title : firstCourse ? firstCourse.title : 'No course yet'}
                  </p>
                </div>
                <Link className="button button-secondary" href={continueHref} aria-label="Continue lesson">
                  →
                </Link>
              </article>

              <article className="dash-card">
                <div className="dash-card-icon dash-card-icon-coral" aria-hidden="true">
                  ◆
                </div>
                <div className="dash-card-body">
                  <h3 className="dash-card-title">
                    Review {dueWords > 0 ? `${dueWords} word${dueWords === 1 ? '' : 's'}` : 'your words'}
                  </h3>
                  <p className="dash-card-detail">
                    {accountId
                      ? dueWords > 0
                        ? 'Due today'
                        : 'Nothing due — practise anyway'
                      : 'Sign in to track what you are about to forget'}
                  </p>
                </div>
                <Link className="button button-secondary" href="/plan" aria-label="Review">
                  →
                </Link>
              </article>

              <article className="dash-card">
                <div className="dash-card-icon dash-card-icon-gold" aria-hidden="true">
                  ♪
                </div>
                <div className="dash-card-body">
                  <h3 className="dash-card-title">Quick practice</h3>
                  <p className="dash-card-detail">
                    Meanings, listening and spelling over the dictionary&rsquo;s published words
                  </p>
                </div>
                <Link className="button button-secondary" href="/practice" aria-label="Practise">
                  →
                </Link>
              </article>

              <article className="dash-card">
                <div className="dash-card-icon dash-card-icon-ink" aria-hidden="true">
                  ✎
                </div>
                <div className="dash-card-body">
                  <h3 className="dash-card-title">Write Ndebe</h3>
                  <p className="dash-card-detail">Build a character in three steps — body, vowel, tone</p>
                </div>
                <Link className="button button-secondary" href="/ndebe" aria-label="Ndebe">
                  →
                </Link>
              </article>
            </div>
          </section>

          {/* -------------------------------------------------------------- */}
          {/* The course path                                                 */}
          {/* -------------------------------------------------------------- */}
          <section aria-labelledby="path-heading">
            <div className="dash-section-head">
              <div>
                <p className="dash-section-kicker">Your learning path</p>
                <h2 id="path-heading" className="dash-section-title">
                  Courses
                </h2>
              </div>
            </div>

            {courses.length === 0 ? (
              <div className="notice">
                <strong>No course is published yet.</strong>
                <p style={{ margin: '0.4rem 0 0' }}>
                  Every lesson is authored by a linguist and checked by native speakers before a
                  learner sees it, and that has not happened yet. Practice, the dictionary and the
                  Ndebe course are not affected — they run on material that is already published and
                  reviewed.
                </p>
              </div>
            ) : (
              <div className="dash-units">
                {courses.map((course) => {
                  const percent =
                    course.lessonCount > 0
                      ? Math.round((course.completedCount / course.lessonCount) * 100)
                      : 0;
                  return (
                  <article key={course.slug} className="dash-unit">
                    <div className="dash-unit-head">
                      <div
                        className={course.completedCount > 0 ? 'dash-unit-num dash-unit-num-on' : 'dash-unit-num'}
                      >
                        {course.level.slice(0, 1).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 className="dash-unit-title">{course.title}</h3>
                        <p className="dash-card-detail">
                          {course.lessonCount === 0
                            ? 'No lessons published yet'
                            : `${course.completedCount} of ${course.lessonCount} lessons`}
                        </p>
                        <div className="dash-unit-track">
                          <div className="dash-unit-fill" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    </div>
                    <div className="learn-actions" style={{ marginTop: '1rem' }}>
                      <Link className="button button-secondary" href={`/${course.slug}`}>
                        Open course
                      </Link>
                    </div>
                  </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* The sidebar                                                         */}
        {/* ------------------------------------------------------------------ */}
        <aside className="dash-aside">
          <section className="dash-panel">
            <h2 className="dash-panel-title">Your week</h2>
            <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <div
                className="dash-ring"
                style={{
                  // The ring is the streak against seven days. With no account it is empty.
                  background: `conic-gradient(var(--green) ${Math.min(100, (streakDays / 7) * 100)}%, var(--line) 0)`,
                }}
              >
                <div className="dash-ring-inner">
                  <span>
                    <b className="dash-ring-value">{streakDays}</b>
                    <small className="dash-ring-unit">day{streakDays === 1 ? '' : 's'}</small>
                  </span>
                </div>
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 700 }}>
                  {streakDays >= 7
                    ? 'A full week.'
                    : streakDays > 0
                      ? `${7 - streakDays} to a full week`
                      : 'No streak yet'}
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--ink-soft)' }}>
                  {accountId
                    ? 'Days you have practised. A freeze protects one missed day a week.'
                    : 'Sign in and your streak starts today.'}
                </p>
              </div>
            </div>
          </section>

          <section className="dash-panel dash-panel-warm">
            <p className="dash-section-kicker">Badges</p>
            <h2 className="dash-panel-title" style={{ marginTop: '0.25rem' }}>
              {progress && progress.badges.length > 0 ? `${progress.badges.length} earned` : 'None yet'}
            </h2>
            {progress && progress.badges.length > 0 ? (
              <ul
                style={{
                  margin: '0.75rem 0 0',
                  padding: 0,
                  listStyle: 'none',
                  display: 'grid',
                  gap: '0.35rem',
                }}
              >
                {progress.badges.slice(0, 4).map((badge) => (
                  <li key={badge.id} style={{ fontSize: '0.875rem' }}>
                    <strong>{badge.name}</strong>{' '}
                    <span style={{ color: 'var(--ink-soft)' }}>{badge.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.875rem', color: 'var(--ink-soft)' }}>
                Finish a lesson or a review to start earning them.
              </p>
            )}
          </section>

          {/*
            §2.1: content that has not been through §5.3 must not be presented as teaching material.
            This card is the design's own device for saying so, and it is kept because it is right.
          */}
          <section className="dash-panel">
            <p className="dash-section-kicker">Content promise</p>
            <p
              style={{
                margin: '0.75rem 0 0',
                fontSize: '0.875rem',
                lineHeight: 1.6,
                color: 'var(--ink-soft)',
              }}
            >
              Language content carries a clear review label. Demonstration text is never presented as
              verified teaching material, and no word is invented.
            </p>
            <span className="dash-tag" style={{ marginTop: '1rem' }}>
              Placeholder content
            </span>
          </section>
        </aside>
      </div>
    </div>
  );
}
