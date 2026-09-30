import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import { listCourses, nextUnfinishedLesson } from '@ozituma/db/learn';
import { getLearnerProgress } from '@ozituma/db/learn-gamification';
import { getReviewSummary } from '@ozituma/db/learn-srs';
import { getCurrentAccount } from '@/lib/session';
import { learnerTimeZone } from '@/lib/timezone';
import { LearnDashboard, type CourseCard, type JourneyItem } from '@/components/design/learn-dashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ozituma Learn Igbo — Your daily learning journey',
  description:
    'Build confidence in Igbo through short lessons, listening, review, and culturally grounded practice.',
};

/** The design's daily goal. §F6 makes the plan adapt to a goal in minutes; 15 is the prototype's. */
const DAILY_GOAL_MINUTES = 15;

/**
 * The Learn home page.
 *
 * A data-loading shell around `LearnDashboard`, which holds the design. The split exists so the
 * design's component stays a faithful port: it takes plain props, knows nothing about the database,
 * and can be read side by side with the original.
 *
 * WHAT THE DATABASE SUPPLIES, AND WHAT IT CANNOT
 *
 * Level, XP, streak and badges come from `getLearnerProgress`; the resume point from
 * `nextUnfinishedLesson`; the courses from `listCourses`; the review count from `getReviewSummary`.
 * All real, all per-request.
 *
 * What it cannot supply is teaching content, because §18 #4's linguist and native reviewers are not
 * named and §2.1 forbids inventing it. So the journey's four activities are the design's four, but
 * they point at the surfaces that DO have real material — practice, review, the Ndebe course — and
 * the panels that would carry lesson text are labelled placeholder, as the design already does.
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

  const displayName = session?.account.displayName?.trim() || null;
  const firstName = displayName ? displayName.split(/\s+/)[0]! : null;
  const dueWords = review?.dueNow ?? 0;

  const journey: JourneyItem[] = [
    {
      id: 'continue',
      title: 'Continue your lesson',
      detail: resume ? resume.title : firstCourse ? firstCourse.title : 'No course published yet',
      action: 'Continue',
      icon: 'book',
      tone: 'green',
      href:
        resume && firstCourse
          ? `/${firstCourse.slug}/${resume.slug}`
          : firstCourse
            ? `/${firstCourse.slug}`
            : '/practice',
    },
    {
      id: 'review',
      title: dueWords > 0 ? `Review ${dueWords} word${dueWords === 1 ? '' : 's'}` : 'Review your words',
      detail: accountId
        ? dueWords > 0
          ? 'Due today'
          : 'Nothing due — practise anyway'
        : 'Sign in to keep a schedule',
      action: 'Review',
      icon: 'shapes',
      tone: 'coral',
      href: '/plan',
    },
    {
      id: 'listen',
      title: 'Quick practice',
      detail: 'Meanings, listening and spelling · from the dictionary',
      action: 'Practise',
      icon: 'headphones',
      tone: 'gold',
      href: '/practice',
    },
    {
      id: 'practice',
      title: 'Write Ndebe',
      detail: 'Build a character in three steps · body, vowel, tone',
      action: 'Open',
      icon: 'messages',
      tone: 'ink',
      href: '/ndebe',
    },
  ];

  const courseCards: CourseCard[] = courses.map((course, index) => ({
    number: String(index + 1),
    title: course.title,
    detail:
      course.lessonCount === 0
        ? 'No lessons published yet'
        : `${course.completedCount} of ${course.lessonCount} lessons`,
    progress:
      course.lessonCount > 0 ? Math.round((course.completedCount / course.lessonCount) * 100) : 0,
    // The design shows a grid of lesson buttons per unit. `listCourses` does not expand a course's
    // units, so the list is empty until the course page supplies it — better than inventing rows.
    lessons: [],
  }));

  return (
    <LearnDashboard
      learner={{
        name: firstName,
        level: progress?.level.level ?? 1,
        xp: progress?.totalXp ?? 0,
        streak: progress?.streak.current ?? 0,
        // The design tracks minutes against a goal. A real figure needs per-attempt timing, which
        // exists in `learn_attempt` but is not summed anywhere yet, so this is an honest zero.
        minutes: 0,
        goal: DAILY_GOAL_MINUTES,
      }}
      journey={journey}
      courses={courseCards}
      continueTitle={
        resume ? `Continue: ${resume.title}` : firstCourse ? firstCourse.title : 'Find your first words'
      }
      continueDetail={
        resume
          ? 'Pick up where you left off with a short listening and recognition exercise.'
          : 'Every word in this course comes from the Ozituma dictionary, with its meaning and its recording.'
      }
      continueHref={
        resume && firstCourse
          ? `/${firstCourse.slug}/${resume.slug}`
          : firstCourse
            ? `/${firstCourse.slug}`
            : '/practice'
      }
      badges={(progress?.badges ?? []).map((badge) => ({
        id: badge.id,
        name: badge.name,
        description: badge.description,
      }))}
    />
  );
}
