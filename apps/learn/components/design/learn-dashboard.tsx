'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Flame,
  Home,
  LockKeyhole,
  MessageCircle,
  Search,
  Shapes,
  Sparkles,
  Trophy,
  UserRound,
  Volume2,
  X,
} from 'lucide-react';
import { Button, buttonClasses } from '@/components/design/button';
import { OzitumaMark } from '@/components/design/ozituma-mark';
import { cn } from '@/lib/cn';

/**
 * The Learn dashboard, in the design.
 *
 * EVERY CLASS STRING HERE IS THE DESIGN'S. That is the point of this file and the reason Tailwind is
 * now a dependency: the first attempt translated these utilities into hand-written CSS, and a
 * translation is an approximation. The shell is 1440px here, not 68rem; the icon tiles are `size-12`;
 * the gaps are `gap-3`, `gap-4`, `gap-7`. "Same width, same length, everything" is only achievable by
 * running the same utilities through the same engine.
 *
 * WHAT IS REAL AND WHAT THE DESIGN LEFT AS PLACEHOLDER
 *
 * The design is a prototype, so its numbers are literals: Chidi at level 3, a 7-day streak, 1,240 XP,
 * four named activities. Here they come from the database. Where the database has nothing — no
 * courses published, no account — the screen says so instead of showing the prototype's figures,
 * because a learner reading "1,240 XP" that is not theirs has been lied to by the interface.
 *
 * The design's own "Placeholder content" tag and "Content promise" card are KEPT, because §2.1
 * requires exactly that labelling and the design had already solved it well.
 *
 * CLIENT, NOT SERVER
 *
 * Because of the tabs and the lesson dialog, which are state. Data arrives as props already read on
 * the server, so the database is not reachable from here at all.
 */

export interface JourneyItem {
  id: string;
  title: string;
  detail: string;
  action: string;
  icon: 'book' | 'shapes' | 'headphones' | 'messages';
  tone: 'green' | 'coral' | 'gold' | 'ink';
  href: string;
}

export interface CourseCard {
  number: string;
  title: string;
  detail: string;
  progress: number;
  lessons: { title: string; status: 'done' | 'current' | 'open' | 'locked' }[];
}

export interface DashboardProps {
  learner: { name: string | null; level: number; xp: number; streak: number; minutes: number; goal: number };
  journey: JourneyItem[];
  courses: CourseCard[];
  continueTitle: string;
  continueDetail: string;
  continueHref: string;
  badges: { id: string; name: string; description: string }[];
}

const ICONS = {
  book: BookOpen,
  shapes: Shapes,
  headphones: Volume2,
  messages: MessageCircle,
} as const;

const TONES = {
  green: 'bg-primary text-primary-foreground',
  coral: 'bg-accent text-accent-foreground',
  gold: 'bg-secondary text-secondary-foreground',
  ink: 'bg-[var(--dash-ink)] text-primary-foreground',
} as const;

type Tab = 'Home' | 'Learn' | 'Tutor' | 'Profile';

export function LearnDashboard({
  learner,
  journey,
  courses,
  continueTitle,
  continueDetail,
  continueHref,
  badges,
}: DashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Home');
  const [lessonOpen, setLessonOpen] = useState(false);
  const [answer, setAnswer] = useState<number | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);

  const markDone = (id: string) =>
    setCompleted((items) => (items.includes(id) ? items : [...items, id]));

  const navItems = [
    { label: 'Home', icon: Home },
    { label: 'Learn', icon: BookOpen },
    { label: 'Practise', icon: Sparkles, href: '/practice' },
    { label: 'Tutor', icon: MessageCircle },
    { label: 'Dictionary', icon: Search, href: process.env.NEXT_PUBLIC_OZITUMA_SITE_URL ?? 'https://ozituma.com' },
    { label: 'Profile', icon: UserRound },
  ] as const;

  const minutes = learner.minutes + completed.length * 2;
  const goalPercent = learner.goal > 0 ? Math.min(100, Math.round((minutes / learner.goal) * 100)) : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <OzitumaMark />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
            {navItems.map(({ label, icon: Icon, ...item }) =>
              'href' in item ? (
                <a key={label} href={item.href} target="_blank" rel="noopener noreferrer" className={buttonClasses('ghost')}>
                  <Icon className="size-4" /> {label}
                </a>
              ) : (
                <Button
                  key={label}
                  variant="ghost"
                  onClick={() => setActiveTab(label as Tab)}
                  aria-current={activeTab === label ? 'page' : undefined}
                  className={activeTab === label ? 'bg-secondary text-secondary-foreground' : ''}
                >
                  <Icon className="size-4" /> {label}
                </Button>
              )
            )}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-2 sm:flex">
              <Flame className="size-4 text-highlight" fill="currentColor" />
              <span className="text-sm font-extrabold">{learner.streak}</span>
              <span className="text-xs text-muted-foreground">day streak</span>
            </div>
            <Link href="/progress" className="grid size-10 place-items-center rounded-full bg-[var(--dash-ink)] text-sm font-black text-primary-foreground" aria-label="Open profile">
              {(learner.name ?? 'Guest').slice(0, 2).toUpperCase()}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-28 pt-7 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        <section className="rise-in mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase text-primary">{learner.name ? 'Today’s journey' : 'Welcome'}</p>
            <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
              {learner.name ? `Nnọọ, ${learner.name}.` : 'Nnọọ.'}
            </h1>
            <p className="mt-2 max-w-xl text-base text-muted-foreground">
              A little every day goes a long way. Here is where you left off.
            </p>
          </div>
          <div className="flex min-w-64 items-center gap-4 rounded-md border border-border bg-card px-4 py-3 shadow-sm">
            <div className="grid size-12 place-items-center rounded-full bg-secondary text-sm font-black text-secondary-foreground">
              L{learner.level}
            </div>
            <div className="flex-1">
              <div className="flex justify-between text-xs font-bold">
                <span>Level {learner.level}</span>
                <span>{learner.xp.toLocaleString()} XP</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-highlight" style={{ width: `${goalPercent}%` }} />
              </div>
            </div>
          </div>
        </section>

        {activeTab !== 'Home' && activeTab !== 'Learn' ? (
          <ComingSoon tab={activeTab} onBack={() => setActiveTab('Home')} />
        ) : (
          <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-8">
              {activeTab === 'Home' && (
                <>
                  <section className="rise-in-delay overflow-hidden rounded-lg bg-brand text-brand-foreground shadow-lg">
                    <div className="grid md:grid-cols-[1fr_240px]">
                      <div className="p-6 sm:p-8">
                        <div className="mb-8 flex items-center gap-2 text-xs font-extrabold uppercase text-brand-foreground/75">
                          <span className="h-px w-8 bg-highlight" />
                          {courses[0] ? courses[0].title : 'Start here'}
                        </div>
                        <h2 className="font-display text-3xl font-semibold sm:text-4xl">
                          {continueTitle}
                        </h2>
                        <p className="mt-3 max-w-lg text-sm leading-6 text-brand-foreground/80">
                          {continueDetail}
                        </p>
                        <Link
                          href={continueHref}
                          className={buttonClasses('primary', 'mt-7 bg-highlight text-highlight-foreground hover:bg-highlight/90')}
                        >
                          Continue lesson <ArrowRight className="size-4" />
                        </Link>
                      </div>
                      <div className="relative hidden overflow-hidden border-l border-brand-foreground/15 md:block" aria-hidden="true">
                        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(30deg,transparent_35%,currentColor_36%,currentColor_38%,transparent_39%),linear-gradient(-30deg,transparent_35%,currentColor_36%,currentColor_38%,transparent_39%)] [background-size:42px_72px]" />
                        <div className="absolute bottom-6 left-6 right-6 border-l-4 border-highlight pl-4 font-display text-2xl leading-tight">
                          Learn it.
                          <br />
                          Live it.
                          <br />
                          Pass it on.
                        </div>
                      </div>
                    </div>
                  </section>

                  <section aria-labelledby="journey-heading">
                    <div className="mb-4 flex items-end justify-between">
                      <div>
                        <p className="text-xs font-bold uppercase text-muted-foreground">Your plan</p>
                        <h2 id="journey-heading" className="mt-1 font-display text-2xl font-semibold">
                          Today’s journey
                        </h2>
                      </div>
                      <span className="text-sm font-bold text-primary">
                        {minutes} / {learner.goal} min
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {journey.map(({ id, title, detail, action, icon, tone, href }) => {
                        const Icon = ICONS[icon];
                        const isDone = completed.includes(id);
                        return (
                          <article
                            key={id}
                            className="group flex min-h-32 items-center gap-4 rounded-md border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                          >
                            <div className={cn('grid size-12 shrink-0 place-items-center rounded-md', TONES[tone])}>
                              <Icon className="size-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="font-bold">{title}</h3>
                              <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
                            </div>
                            {isDone ? (
                              <span className={buttonClasses('ghost', 'size-11 p-0')} aria-label={`${action}: ${title} — done`}>
                                <Check className="size-5 text-primary" />
                              </span>
                            ) : (
                              <Link
                                href={href}
                                className={buttonClasses('icon')}
                                aria-label={`${action}: ${title}`}
                                onClick={() => markDone(id)}
                              >
                                <ChevronRight className="size-5" />
                              </Link>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}

              <CoursePath courses={courses} expanded={activeTab === 'Learn'} onStart={() => { setLessonOpen(true); setAnswer(null); }} />
            </div>

            <aside className="space-y-5 xl:sticky xl:top-26">
              <section className="rounded-md border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-semibold">Daily goal</h2>
                  <span className="text-xs font-extrabold text-primary">{goalPercent}%</span>
                </div>
                <div className="mt-5 flex items-center gap-5">
                  <div
                    className="relative grid size-24 place-items-center rounded-full"
                    style={{ background: `conic-gradient(var(--color-primary) ${goalPercent}%, var(--color-muted) 0)` }}
                  >
                    <div className="grid size-[74px] place-items-center rounded-full bg-card text-center">
                      <span>
                        <b className="block text-xl">{minutes}</b>
                        <small className="text-muted-foreground">minutes</small>
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="font-bold">
                      {minutes >= learner.goal ? 'Goal reached' : `${learner.goal - minutes} minutes to go`}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      {minutes >= learner.goal
                        ? 'Anything more today is a bonus.'
                        : 'Finish one more activity to reach today’s goal.'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-border bg-secondary p-5">
                <div className="flex items-start gap-3">
                  <Trophy className="mt-0.5 size-5 text-highlight-foreground" />
                  <div>
                    <p className="text-xs font-extrabold uppercase text-muted-foreground">Weekly rhythm</p>
                    <h2 className="mt-1 font-display text-xl font-semibold">
                      {learner.streak >= 7 ? 'A full week' : `${learner.streak} active day${learner.streak === 1 ? '' : 's'}`}
                    </h2>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold text-muted-foreground">
                  {'MTWTFSS'.split('').map((day, index) => (
                    <div key={`${day}-${index}`}>
                      <span
                        className={cn(
                          'mx-auto mb-2 grid size-7 place-items-center rounded-full',
                          index < learner.streak ? 'bg-primary text-primary-foreground' : 'bg-card'
                        )}
                      >
                        {index < learner.streak ? <Check className="size-3" /> : day}
                      </span>
                      {day}
                    </div>
                  ))}
                </div>
              </section>

              {badges.length > 0 ? (
                <section className="rounded-md border border-border bg-card p-5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-primary" />
                    <h2 className="text-sm font-extrabold uppercase">Badges</h2>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {badges.slice(0, 4).map((badge) => (
                      <li key={badge.id} className="text-sm">
                        <strong>{badge.name}</strong>{' '}
                        <span className="text-muted-foreground">{badge.description}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="rounded-md border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <Volume2 className="size-4 text-primary" />
                  <h2 className="text-sm font-extrabold uppercase">Content promise</h2>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Language content will carry a clear review label. Demonstration text is never
                  presented as verified teaching material.
                </p>
                <span className="mt-4 inline-flex rounded-sm bg-muted px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">
                  Placeholder content
                </span>
              </section>
            </aside>
          </div>
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-lg lg:hidden" aria-label="Mobile navigation">
        {navItems.slice(0, 5).map(({ label, icon: Icon, ...item }) =>
          'href' in item ? (
            <a key={label} href={item.href} target="_blank" rel="noopener noreferrer" className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-bold text-muted-foreground">
              <Icon className="size-5" />
              {label}
            </a>
          ) : (
            <button
              key={label}
              onClick={() => setActiveTab(label as Tab)}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-bold',
                activeTab === label ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          )
        )}
      </nav>

      {lessonOpen && (
        <LessonDialog
          answer={answer}
          setAnswer={setAnswer}
          onClose={() => setLessonOpen(false)}
          onComplete={() => {
            markDone('continue');
            setLessonOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CoursePath({
  courses,
  expanded,
  onStart,
}: {
  courses: CourseCard[];
  expanded: boolean;
  onStart: () => void;
}) {
  return (
    <section aria-labelledby="path-heading" className={expanded ? 'pt-1' : ''}>
      <div className="mb-4">
        <p className="text-xs font-bold uppercase text-muted-foreground">Your learning path</p>
        <h2 id="path-heading" className="mt-1 font-display text-2xl font-semibold">
          Courses
        </h2>
      </div>

      {courses.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-5 shadow-sm">
          <p className="font-bold">No course is published yet.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Every lesson is authored by a linguist and checked by native speakers before a learner
            sees it, and that has not happened yet. Practice, the dictionary and the Ndebe course are
            not affected — they run on material that is already published and reviewed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <article key={course.number} className="rounded-md border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    'grid size-11 shrink-0 place-items-center rounded-md font-black',
                    course.progress > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {course.number}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-xl font-semibold">{course.title}</h3>
                      <p className="text-sm text-muted-foreground">{course.detail}</p>
                    </div>
                    <span className="text-xs font-bold text-muted-foreground">{course.progress}%</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${course.progress}%` }} />
                  </div>
                  {(expanded || course.number === '1') && course.lessons.length > 0 && (
                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                      {course.lessons.map((lesson) => (
                        <button
                          key={lesson.title}
                          disabled={lesson.status === 'locked'}
                          onClick={lesson.status === 'current' ? onStart : undefined}
                          className={cn(
                            'flex min-h-12 items-center gap-3 rounded-md border px-3 text-left text-sm font-bold transition',
                            lesson.status === 'current'
                              ? 'border-primary bg-secondary text-secondary-foreground'
                              : 'border-border bg-background disabled:opacity-55'
                          )}
                        >
                          <span
                            className={cn(
                              'grid size-7 shrink-0 place-items-center rounded-full',
                              lesson.status === 'done'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {lesson.status === 'done' ? (
                              <Check className="size-3.5" />
                            ) : lesson.status === 'locked' ? (
                              <LockKeyhole className="size-3.5" />
                            ) : (
                              <BookOpen className="size-3.5" />
                            )}
                          </span>
                          {lesson.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ComingSoon({ tab, onBack }: { tab: Exclude<Tab, 'Home' | 'Learn'>; onBack: () => void }) {
  return (
    <section className="mx-auto max-w-2xl py-24 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-md bg-secondary text-secondary-foreground">
        <Sparkles className="size-6" />
      </span>
      <p className="mt-6 text-xs font-bold uppercase text-primary">First milestone</p>
      <h1 className="mt-2 font-display text-4xl font-semibold">{tab} is taking shape.</h1>
      <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
        This area is reserved in the learning experience and will be connected when approved content
        and services are ready.
      </p>
      <Button className="mt-7" onClick={onBack}>
        Return home
      </Button>
    </section>
  );
}

function LessonDialog({
  answer,
  setAnswer,
  onClose,
  onComplete,
}: {
  answer: number | null;
  setAnswer: (value: number) => void;
  onClose: () => void;
  onComplete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-foreground/35 p-0 sm:place-items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lesson-title"
    >
      <div className="w-full max-w-xl rounded-t-lg bg-card p-5 shadow-2xl sm:rounded-lg sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-flex rounded-sm bg-muted px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">
              Placeholder content
            </span>
            <h2 id="lesson-title" className="mt-3 font-display text-3xl font-semibold">
              Listening check
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A structure preview. Approved recordings and language will replace this demonstration.
            </p>
          </div>
          <Button variant="icon" onClick={onClose} aria-label="Close lesson">
            <X className="size-5" />
          </Button>
        </div>
        <button
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-md bg-brand px-4 py-6 font-bold text-brand-foreground"
          aria-label="Play placeholder audio"
        >
          <Volume2 className="size-5" /> Play sample audio
        </button>
        <fieldset className="mt-6">
          <legend className="mb-3 text-sm font-extrabold">Choose the matching meaning</legend>
          <div className="grid gap-2">
            {['PLACEHOLDER option A', 'PLACEHOLDER option B', 'PLACEHOLDER option C'].map((option, index) => (
              <button
                key={option}
                onClick={() => setAnswer(index)}
                className={cn(
                  'min-h-12 rounded-md border px-4 text-left text-sm font-semibold',
                  answer === index ? 'border-primary bg-secondary' : 'border-border bg-background'
                )}
              >
                {String.fromCharCode(65 + index)}. {option}
              </button>
            ))}
          </div>
        </fieldset>
        <Button className="mt-6 w-full" disabled={answer === null} onClick={onComplete}>
          Check and continue <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
