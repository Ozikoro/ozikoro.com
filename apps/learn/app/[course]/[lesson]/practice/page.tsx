import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getLesson } from '@ozituma/db/learn';
import { ExerciseRunner } from '@/components/learn/exercise-runner';
import { getCurrentAccount } from '@/lib/session';
import { learnHost, learnHref } from '@/lib/learn-request';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ course: string; lesson: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { course, lesson } = await params;
  const db = await getDb();
  const found = await getLesson(db, course, lesson);
  return {
    title: found ? `Practice: ${found.title}` : 'Practice',
    // Practice is a tool, not a destination. It should not compete with the
    // lesson in a search result, so it is kept out of the index entirely.
    robots: { index: false, follow: true },
  };
}

export default async function PracticePage({ params }: Params) {
  const { course, lesson } = await params;
  const info = await learnHost();
  const db = await getDb();
  const session = await getCurrentAccount();

  const found = await getLesson(db, course, lesson, session?.account.id ?? null);
  if (!found) notFound();

  const lessonUrl = learnHref(info, `/${course}/${found.slug}`);

  return (
    <div className="wrap wrap-narrow">
      <nav className="learn-breadcrumb" aria-label="Breadcrumb">
        <Link href={learnHref(info, `/${course}`)}>{found.courseTitle}</Link>
        <span aria-hidden="true"> / </span>
        <Link href={lessonUrl}>{found.title}</Link>
        <span aria-hidden="true"> / </span>
        <span>Practice</span>
      </nav>

      <header className="learn-lesson-head">
        <h1>Practice: {found.title}</h1>
        {found.objective ? <p className="hero-lede">{found.objective}</p> : null}
      </header>

      {found.exerciseCount > 0 ? (
        <ExerciseRunner
          course={course}
          lesson={found.slug}
          exerciseCount={found.exerciseCount}
          signedIn={session !== null}
          base={info.base}
          nextLesson={found.next}
        />
      ) : (
        <div className="notice notice-warn">
          <strong>This lesson has no exercises yet.</strong>
          <p style={{ margin: '0.4rem 0 0' }}>
            A lesson needs at least four words before a set of questions can be built whose wrong
            answers are worth choosing between.{' '}
            <Link href={lessonUrl}>Back to the lesson</Link>.
          </p>
        </div>
      )}

      {session === null && found.exerciseCount > 0 ? (
        <p className="learn-progress-note" style={{ marginTop: '2rem' }}>
          Your score is not saved unless you are signed in.{' '}
          <Link href={`${process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}/signin`}>Sign in</Link>{' '}
          to keep your progress across lessons.
        </p>
      ) : null}
    </div>
  );
}
