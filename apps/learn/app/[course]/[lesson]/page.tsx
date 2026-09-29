import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { getLesson } from '@ozituma/db/learn';
import { LessonBody } from '@/components/learn/lesson-blocks';
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
  if (!found) return { title: 'Lesson not found' };

  const info = await learnHost();
  return {
    title: `${found.title} — ${found.courseTitle}`,
    description:
      found.objective ??
      `A lesson in ${found.courseTitle}: ${found.vocabCount} words with audio and practice.`,
    alternates: { canonical: `${info.origin}/${course}/${lesson}` },
  };
}

export default async function LessonPage({ params }: Params) {
  const { course, lesson } = await params;
  const info = await learnHost();
  const db = await getDb();
  const session = await getCurrentAccount();

  const found = await getLesson(db, course, lesson, session?.account.id ?? null);
  if (!found) notFound();

  const lessonUrl = learnHref(info, `/${course}/${found.slug}`);
  const done = found.progress?.state === 'completed';

  return (
    <div className="wrap wrap-reading">
      <nav className="learn-breadcrumb" aria-label="Breadcrumb">
        <Link href={learnHref(info, '/')}>Courses</Link>
        <span aria-hidden="true"> / </span>
        <Link href={learnHref(info, `/${course}`)}>{found.courseTitle}</Link>
        <span aria-hidden="true"> / </span>
        <span>{found.title}</span>
      </nav>

      <header className="learn-lesson-head">
        <p className="learn-eyebrow">
          {found.unitTitle}
          {done ? ' · completed' : ''}
        </p>
        <h1>{found.title}</h1>
        {found.objective ? <p className="hero-lede">{found.objective}</p> : null}
        <p className="learn-course-meta">
          About {found.estMinutes} minutes · {found.vocabCount} words ·{' '}
          {found.phraseCount} phrase{found.phraseCount === 1 ? '' : 's'}
          {found.progress?.bestScore != null ? ` · best score ${found.progress.bestScore}%` : ''}
        </p>
      </header>

      <article className="learn-lesson-content">
        <LessonBody blocks={found.body} vocab={found.vocab} phrases={found.phrases} />
      </article>

      {found.exerciseCount > 0 ? (
        <section className="learn-practice-cta">
          <div>
            <h2 className="learn-section-title">Practise this lesson</h2>
            <p className="learn-prose">
              {found.exerciseCount} questions built from the words above — meanings, listening,
              spelling and recall. You are told straight away whether you were right, and what the
              answer was. Takes a couple of minutes.
            </p>
          </div>
          <Link className="button" href={`${lessonUrl}/practice`}>
            {done ? 'Practise again' : 'Start practice'}
          </Link>
        </section>
      ) : (
        <section className="learn-practice-cta">
          <div>
            <h2 className="learn-section-title">Practice is not open yet</h2>
            <p className="learn-prose">
              This lesson needs at least four words before a set of exercises can be built with
              answers that are genuinely hard to choose between. Read the lesson for now.
            </p>
          </div>
        </section>
      )}

      <nav className="learn-lesson-nav" aria-label="Lesson navigation">
        {found.prev ? (
          <Link className="learn-lesson-nav-link" href={learnHref(info, `/${course}/${found.prev.slug}`)}>
            <span className="learn-lesson-nav-label">Previous</span>
            <span className="learn-lesson-nav-title">{found.prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {found.next ? (
          <Link
            className="learn-lesson-nav-link learn-lesson-nav-next"
            href={learnHref(info, `/${course}/${found.next.slug}`)}
          >
            <span className="learn-lesson-nav-label">Next</span>
            <span className="learn-lesson-nav-title">{found.next.title}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <section className="learn-section">
        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Every word above is also an entry in the{' '}
          <a href={process.env.OZITUMA_SITE_URL ?? 'https://ozituma.com'}>Ozituma dictionary</a> —
          with its dialect spellings, its recordings and its sources. Where an entry exists, it is
          linked from the word card.
        </p>
      </section>
    </div>
  );
}
