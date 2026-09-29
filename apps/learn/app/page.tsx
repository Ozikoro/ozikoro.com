import Link from 'next/link';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listCourses, nextUnfinishedLesson } from '@ozituma/db/learn';
import { getCurrentAccount } from '@/lib/session';
import { learnHost, learnHref } from '@/lib/learn-request';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ozituma Learn — language courses',
  description:
    'Learn African languages from the first conversation. Beginner courses built on the Ozituma dictionary, starting with Igbo.',
};

export default async function LearnHome() {
  const info = await learnHost();
  const db = await getDb();
  const session = await getCurrentAccount();
  const courses = await listCourses(db, session?.account.id ?? null);

  // The second call to action is resolved from the database rather than written
  // as a literal path. A hard-coded '/igbo/<lesson>' both breaks the moment a
  // slug changes and cannot know that a returning learner should be sent to
  // where they stopped rather than to lesson one — which is what
  // nextUnfinishedLesson answers. (The first version of this page hard-coded a
  // path that included the UNIT slug, which is not part of the lesson route and
  // 404ed. Deriving it means the two cannot disagree.)
  const firstCourse = courses[0] ?? null;
  const resume = firstCourse
    ? await nextUnfinishedLesson(db, firstCourse.slug, session?.account.id ?? null)
    : null;

  return (
    <div className="wrap">
      <section className="learn-hero">
        <p className="learn-eyebrow">Ozituma Learn</p>
        <h1 className="learn-hero-title">Learn to speak it, not just look it up</h1>
        <p className="hero-lede">
          A dictionary tells you what a word means. A course tells you which word to learn first,
          what to say next, and whether you can still do it tomorrow. These are beginner courses in
          African languages, built on the same records behind{' '}
          <a href={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}>ozituma.com</a> — so every
          word you meet here has an entry you can read, hear and check.
        </p>
        <div className="learn-hero-actions">
          {firstCourse ? (
            <Link className="button" href={learnHref(info, `/${firstCourse.slug}`)}>
              Start with {firstCourse.title}
            </Link>
          ) : null}
          {firstCourse && resume ? (
            <Link
              className="button button-secondary"
              href={learnHref(info, `/${firstCourse.slug}/${resume.slug}`)}
            >
              {firstCourse.completedCount > 0
                ? `Continue: ${resume.title}`
                : 'Go straight to lesson one'}
            </Link>
          ) : null}
        </div>
      </section>

      <section className="learn-section">
        <h2 className="learn-section-title">Courses</h2>
        {courses.length === 0 ? (
          <div className="notice notice-warn">
            <strong>No courses are published yet.</strong>
            <p style={{ margin: '0.4rem 0 0' }}>
              The curriculum is being written. In the meantime, the{' '}
              <a href={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}>dictionary</a> is
              complete and open.
            </p>
          </div>
        ) : (
          <div className="grid learn-course-grid">
            {courses.map((course) => {
              const percent =
                course.lessonCount === 0
                  ? 0
                  : Math.round((course.completedCount / course.lessonCount) * 100);
              return (
                <Link
                  key={course.id}
                  href={learnHref(info, `/${course.slug}`)}
                  className="card learn-course-card"
                >
                  <span className="learn-course-native" aria-hidden="true">
                    {course.nativeName}
                  </span>
                  <h3 className="learn-course-title">{course.title}</h3>
                  <p className="learn-course-subtitle">
                    {course.subtitle ?? `A ${course.level} course in ${course.languageName}.`}
                  </p>
                  <p className="learn-course-meta">
                    {course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'} ·{' '}
                    {course.vocabCount.toLocaleString()} words
                  </p>

                  {session && course.completedCount > 0 ? (
                    <div className="learn-course-progress">
                      <div className="learn-progress-track">
                        <div className="learn-progress-fill" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="muted" style={{ fontSize: '0.82rem' }}>
                        {course.completedCount} of {course.lessonCount} done
                      </span>
                    </div>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="learn-section learn-about">
        <h2 className="learn-section-title">How these courses work</h2>
        <div className="learn-about-grid">
          <div>
            <h3 className="learn-about-heading">The order is the teaching</h3>
            <p>
              A dictionary is alphabetical and complete; a course is ordered and partial. The
              dictionary has twelve thousand Igbo words and will not tell you which one to learn
              first. That choice — what comes before what, and why — is written by hand, and it is
              the thing you are actually here for.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">Every lesson ends in practice</h3>
            <p>
              Each lesson has vocabulary, phrases, a grammar note and a dialogue, then a short set
              of exercises built from that lesson&rsquo;s own words: recognise the meaning, produce
              the Igbo, listen for it, and type it. You are told what you got right immediately,
              and what the answer was.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">Tone marks are taught, not demanded</h3>
            <p>
              Igbo marks tone, and tone changes meaning — but a learner typing on an English
              keyboard should not fail a lesson for the keyboard. When you type an answer, the tone
              marks and the dots under ị, ọ, ụ and ṅ are not counted against you. They are printed
              on every card, because you still need to see them.
            </p>
          </div>
          <div>
            <h3 className="learn-about-heading">Nothing is locked</h3>
            <p>
              Every lesson is readable and every exercise is runnable without an account. An
              account is only what saves your progress, so you can see how far you have come and
              pick up where you left off. Nothing is behind a paywall and nothing expires.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
