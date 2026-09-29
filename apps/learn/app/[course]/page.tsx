import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getCourse, nextUnfinishedLesson } from '@ozituma/db/learn';
import { getCurrentAccount } from '@/lib/session';
import { learnHost, learnHref } from '@/lib/learn-request';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ course: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { course: slug } = await params;
  const db = await getDb();
  const course = await getCourse(db, slug);
  if (!course) return { title: 'Course not found' };

  const info = await learnHost();
  return {
    title: `${course.title} for beginners`,
    description:
      course.description ??
      `A ${course.level} course in ${course.languageName}, with vocabulary, audio and practice.`,
    alternates: { canonical: `${info.origin}/${course.slug}` },
  };
}

export default async function CoursePage({ params }: Params) {
  const { course: slug } = await params;
  const info = await learnHost();
  const db = await getDb();
  const session = await getCurrentAccount();
  const accountId = session?.account.id ?? null;

  const course = await getCourse(db, slug, accountId);
  if (!course) notFound();

  const next = await nextUnfinishedLesson(db, slug, accountId);
  const percent =
    course.lessonCount === 0
      ? 0
      : Math.round((course.completedCount / course.lessonCount) * 100);

  return (
    <div className="wrap">
      <nav className="learn-breadcrumb" aria-label="Breadcrumb">
        <Link href={learnHref(info, '/')}>Courses</Link>
        <span aria-hidden="true"> / </span>
        <span>{course.title}</span>
      </nav>

      <header className="learn-course-head">
        <p className="learn-eyebrow">
          {course.languageName} · {course.nativeName} · {course.level}
        </p>
        <h1>{course.title}</h1>
        {course.subtitle ? <p className="hero-lede">{course.subtitle}</p> : null}
        {course.description ? <p className="learn-prose">{course.description}</p> : null}

        <p className="learn-course-meta">
          {course.units.length} unit{course.units.length === 1 ? '' : 's'} ·{' '}
          {course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'} ·{' '}
          {course.vocabCount.toLocaleString()} words
        </p>

        <div className="learn-hero-actions">
          {next ? (
            <Link className="button" href={learnHref(info, `/${course.slug}/${next.slug}`)}>
              {course.completedCount > 0 ? `Continue: ${next.title}` : 'Start the course'}
            </Link>
          ) : (
            <span className="learn-complete-note">
              You have finished every lesson in this course.
            </span>
          )}
        </div>

        {session ? (
          <div className="learn-course-progress">
            <div className="learn-progress-track" role="img" aria-label={`${percent}% complete`}>
              <div className="learn-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="muted" style={{ fontSize: '0.86rem' }}>
              {course.completedCount} of {course.lessonCount} lessons complete
            </span>
          </div>
        ) : (
          <p className="learn-progress-note">
            <Link href={`${process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/signin`}>
              Sign in
            </Link>{' '}
            to have your progress saved. Every lesson works without an account.
          </p>
        )}
      </header>

      {course.units.map((unit, unitIndex) => (
        <section key={unit.id} className="learn-unit">
          <div className="learn-unit-head">
            <span className="learn-unit-number">Unit {unitIndex + 1}</span>
            <h2 className="learn-unit-title">{unit.title}</h2>
            {unit.summary ? <p className="learn-unit-summary">{unit.summary}</p> : null}
          </div>

          <ol className="learn-lesson-list">
            {unit.lessons.map((lesson, lessonIndex) => {
              const done = lesson.progress?.state === 'completed';
              const started = lesson.progress?.state === 'started';
              return (
                <li key={lesson.id} className="learn-lesson-row">
                  <Link
                    href={learnHref(info, `/${course.slug}/${lesson.slug}`)}
                    className="learn-lesson-link"
                  >
                    <span className={`learn-lesson-mark ${done ? 'is-done' : started ? 'is-started' : ''}`}>
                      {done ? '✓' : unitIndex + 1}.{lessonIndex + 1}
                    </span>
                    <span className="learn-lesson-body">
                      <span className="learn-lesson-title">{lesson.title}</span>
                      {lesson.objective ? (
                        <span className="learn-lesson-objective">{lesson.objective}</span>
                      ) : null}
                      <span className="learn-lesson-meta">
                        {lesson.estMinutes} min · {lesson.vocabCount} words
                        {lesson.exerciseCount > 0
                          ? ` · ${lesson.exerciseCount} exercises`
                          : ' · no exercises yet'}
                        {lesson.progress?.bestScore != null
                          ? ` · best ${lesson.progress.bestScore}%`
                          : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <section className="learn-section learn-course-foot">
        <h2 className="learn-section-title">Where this course goes next</h2>
        <p className="learn-prose">
          More units are being written: numbers and counting, family, food and the market, and the
          verb patterns that carry them. New lessons appear here as they are finished, and you can
          pick up from wherever you stopped.
        </p>
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Every word in this course is also an entry in the{' '}
          <a href={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}>Ozituma dictionary</a>,
          with its dialect spellings and recordings.
        </p>
      </section>
    </div>
  );
}
