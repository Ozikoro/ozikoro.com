import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Home,
  Keyboard,
  ShieldCheck,
  GraduationCap,
  LockKeyhole,
  MessageCircle,
  Search,
  Sparkles,
  SquarePen,
  Trophy,
  UserRound,
  Volume2,
} from "lucide-react";
import { useState } from "react";
import { OnboardingView } from "@/components/onboarding-view";
import { Button } from "@/components/button";
import { NdebeStudio } from "@/components/ndebe-studio";
import { OzitumaMark } from "@/components/ozituma-mark";
import { LessonFlow } from "@/components/lesson-flow";
import { useStickyState } from "@/lib/use-sticky-state";
import { PracticeView } from "@/components/practice-view";
import { TutorView } from "@/components/tutor-view";
import { journey, learner, MINUTES_PER_LESSON } from "@/lib/learning-data";
import { LEVELS, loadStanding, type LearnerStanding } from "@/lib/learner-standing";
import { lessonStatus, type Unit } from "@/lib/lesson-data";
import { useCourse } from "@/lib/use-course";
import { useAuth } from "@/lib/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { ProfileView } from "@/components/profile-view";
import { StaffView } from "@/components/staff-view";
import { KeyboardView } from "@/components/keyboard-view";
import { TeachersView } from "@/components/teachers-view";
import { applySettings, defaultSettings, type LearnerSettings } from "@/lib/settings";
import { Eyebrow, StatusBadge } from "@/components/product-ui";


type Tab = "Home" | "Learn" | "Practise" | "Tutor" | "Ndebe" | "Keyboard" | "Teachers" | "Profile" | "Staff";

const navItems: { label: string; icon: typeof Home; href?: string }[] = [
  { label: "Home", icon: Home },
  { label: "Learn", icon: BookOpen },
  { label: "Practise", icon: Sparkles },
  { label: "Tutor", icon: MessageCircle },
  { label: "Ndebe", icon: SquarePen },
  { label: "Teachers", icon: GraduationCap },
  { label: "Keyboard", icon: Keyboard },
  /*
   * Dictionary is not a tab in this app any more.
   *
   * The dictionary lives at ozituma.com, which holds all 16,594 entries, names, clans and proverbs.
   * Keeping a second, smaller copy inside the courses meant two dictionaries and a learner unable to
   * tell which was authoritative — and the in-app one held 2,382 of 16,594 words, so searching it
   * could quietly fail on a word that exists.
   *
   * `href` marks it as leaving the app. The render below turns anything with an href into a real
   * anchor rather than a tab button, so this is one navigation system, not two.
   */
  { label: "Dictionary", icon: Search, href: "https://ozituma.com/" },
  ];

/** The URL for each tab. One map, so a tab cannot drift from its route. */
export const TAB_PATH: Record<Tab, string> = {
  "Home": "/", "Learn": "/learn", "Practise": "/practise", "Tutor": "/tutor", "Ndebe": "/ndebe", "Keyboard": "/keyboard", "Teachers": "/teachers", "Profile": "/profile", "Staff": "/staff",
};

export function LearnApp({ tab }: { tab: Tab }) {
  /*
   * Which lesson is open is TRANSIENT — plain React state, never persisted.
   *
   * This was `useStickyState`, which writes to localStorage. Opening a lesson therefore recorded it
   * permanently, and because every navigation is now a real page load, that record was restored on
   * every page. The result was the lesson overlay following the learner everywhere: click any menu
   * item and the lesson reopened on top of it, with no way out but closing it again.
   *
   * Opening a lesson is a momentary thing you do on the course page, like opening a drawer. It has
   * no business surviving a page change. `lessonsDone` below stays sticky, because COMPLETION is
   * real progress and should persist.
   */
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  /** Set when the URL named a lesson that does not exist. */
  const [missingLesson, setMissingLesson] = useState<string | null>(null);
  /*
   * Opening a lesson is a REAL PAGE LOAD.
   *
   * It used to be a state change that swapped the view in place, which made
   * the lesson feel like it opened from cache: the URL never changed, the
   * browser back button did not close it, and a link to a lesson could not
   * be shared or bookmarked. The lesson id now travels in the query string, so
   * opening one navigates, Back closes it, and the address bar says which
   * lesson is open.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("lesson");
    if (wanted) setOpenLessonId(wanted);
    if (params.get("missing") === "1") setMissingLesson(wanted);
  }, []);
  const [lessonsDone, setLessonsDone] = useStickyState<string[]>("lesson:done", ["welcome"]);
  const { units, allLessons, isDemo } = useCourse();
  const auth = useAuth();
  const [settings] = useStickyState<LearnerSettings>("settings", defaultSettings);
  useEffect(() => { applySettings(settings); }, [settings]);
  // Signed-in learners: merge progress saved to their account, and save new completions.
  useEffect(() => {
    if (!auth.user) return;
    supabase.from("lesson_progress").select("lesson_key,completed_at").eq("user_id", auth.user.id).then(({ data }) => {
      const remote = (data ?? []).filter((r) => r.completed_at).map((r) => r.lesson_key);
      if (remote.length) setLessonsDone((d) => Array.from(new Set([...d, ...remote])));
    });
  }, [auth.user, setLessonsDone]);
  const saveCompletion = (key: string) => {
    if (auth.user) supabase.from("lesson_progress").upsert({ user_id: auth.user.id, lesson_key: key, completed_at: new Date().toISOString() }).then(() => {});
  };
  // Switching pages leaves the open lesson; its place is still saved and resumes on return.
  /*
   * Navigation is real now.
   *
   * This used to be `setActiveTab(t)`, which changed React state and a localStorage key but left the
   * URL at "/". The consequences were exactly the bugs reported: every menu item returned 404 on a
   * direct hit, refreshing dropped you back on whatever tab was stored, the back button did nothing,
   * and a link could not be shared. `navigate` changes the URL, so the route owns the state and the
   * stored tab is no longer needed as a second source of truth.
   */
  /*
   * A link to a lesson that does not exist says so.
   *
   * `/learn?lesson=greetings` matches no lesson — the real slugs are `level1-1-1-people`
   * and its siblings. Before this, the page simply rendered the course with nothing open
   * and no explanation, so a stale or mistyped link looked like a broken button. The course
   * loads asynchronously, which is why the check is here and not in the mount effect: at
   * mount there are no lessons to compare against yet.
   */
  useEffect(() => {
    /*
     * ONLY check once the REAL course has loaded.
     *
     * `useCourse` starts from the demo units, so at mount `allLessons` is non-empty and
     * holds demo ids like `welcome`. The first version of this check ran against that
     * list, failed to find a real slug such as `level1-1-1-people`, and reported a valid
     * lesson as missing before the database had answered. A wrong "does not exist" is
     * worse than none: it tells a learner their link is broken when the app is.
     */
    if (!openLessonId || isDemo || allLessons.length === 0) return;
    if (allLessons.some((l) => l.id === openLessonId)) return;
    setMissingLesson(openLessonId);
    setOpenLessonId(null);
  }, [openLessonId, allLessons]);

  const openLesson = allLessons.find((l) => l.id === openLessonId) ?? null;
  const lessonOpen = openLesson !== null;
  /*
   * XP, streak and level, counted from lesson_progress rather than stored.
   *
   * Deriving them means a missed write cannot put the number out of step with what the learner
   * actually finished. It waits for both the user and the published lesson count: the level depends
   * on total XP, and the course bonus depends on how many lessons exist.
   */
  /*
   * Whether to run onboarding, asked once per session.
   *
   * `null` means "not known yet" and is distinct from `false`. Rendering before the answer arrives
   * would flash the form at every existing learner on every page load, which is the worst possible
   * first impression of a feature meant to feel like a welcome.
   */
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (!auth.user) { setNeedsOnboarding(false); return; }
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("onboarded")
      .eq("id", auth.user.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setNeedsOnboarding(data?.onboarded === false || data === null); });
    return () => { cancelled = true; };
  }, [auth.user]);

  const [standing, setStanding] = useState<LearnerStanding | null>(null);
  useEffect(() => {
    if (!auth.user) { setStanding(null); return; }
    let cancelled = false;
    void loadStanding(auth.user.id, allLessons.length).then((s) => { if (!cancelled) setStanding(s); });
    return () => { cancelled = true; };
  }, [auth.user, allLessons.length]);

  const currentLesson = allLessons.find((l) => !lessonsDone.includes(l.id)) ?? allLessons[0];
  const completedLessonCount = allLessons.filter((lesson) => lessonsDone.includes(lesson.id)).length;
  const courseProgress = allLessons.length ? Math.round((completedLessonCount / allLessons.length) * 100) : 0;
  const displayName = auth.user?.user_metadata?.["full_name"] || auth.user?.email?.split("@")[0] || "Learner";
  const setLessonOpen = (v: boolean) => setOpenLessonId(v ? currentLesson?.id ?? null : null);
  const [completed, setCompleted] = useStickyState<string[]>("lesson:completed", []);

  const markDone = (id: string) => {
    setCompleted((items) => (items.includes(id) ? items : [...items, id]));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          {/*
            The mark is a link home.

            It rendered as bare markup, so the one element every user tries first
            did nothing. A real anchor rather than a router link, because navigation in
            this app is a full page load throughout.
          */}
          <a href="/" aria-label="Ozituma Learn home" className="shrink-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            <OzitumaMark />
          </a>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
            {navItems.map(({ label, icon: Icon, href }) =>
              href ? (
                /*
                  An item that leaves the app renders as a real anchor, so middle-click,
                  open-in-new-tab and the status-bar preview all behave the way a link should.
                  A tab button that called `window.open` would break all three.
                */
                <Button key={label} variant="ghost" asChild>
                  <a href={href} className="inline-flex items-center gap-2">
                    <Icon className="size-4" /> {label}
                  </a>
                </Button>
              ) : (
                <Button key={label} variant="ghost" asChild>
                  <a href={TAB_PATH[label as Tab]} aria-current={tab === label ? "page" : undefined} className={tab === label ? "bg-secondary text-secondary-foreground" : ""}>
                    <Icon className="size-4" /> {label}
                  </a>
                </Button>
              ),
            )}
          </nav>
          <div className="flex items-center gap-3">
            {auth.isStaff && <Button variant="ghost" asChild><a href={TAB_PATH.Staff} className={tab === "Staff" ? "bg-secondary" : ""}><ShieldCheck className="size-4" /><span className="hidden sm:inline">Staff</span></a></Button>}
            {auth.user ? (
              <a href={TAB_PATH.Profile} className="grid size-10 place-items-center rounded-full bg-ink text-sm font-black uppercase text-primary-foreground" aria-label="Profile and settings">{(auth.user.email ?? "?").slice(0, 2)}</a>
            ) : (
              <div className="flex items-center gap-1">
                <Button variant="icon" asChild><a href={TAB_PATH.Profile} aria-label="Settings"><UserRound className="size-5" /></a></Button>
                <Button asChild className="whitespace-nowrap"><a href="/auth">Sign in</a></Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-28 pt-7 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        {(tab === "Home" || tab === "Learn") && !lessonOpen && (
          <section className="rise-in mb-7 flex flex-col justify-between gap-4 border-b border-border pb-6 md:flex-row md:items-end">
            <div>
              <Eyebrow>{tab === "Home" ? "Today’s learning" : "Your course"}</Eyebrow>
              <h1 className="mt-2 font-display text-4xl font-semibold leading-tight sm:text-5xl">Nnọọ, {displayName}.</h1>
              <p className="mt-2 max-w-xl text-base leading-7 text-muted-foreground">Continue from where you stopped, one clear step at a time.</p>
            </div>
            <div className="min-w-64">
              <div className="flex items-end justify-between gap-5 text-sm"><span className="font-bold">Course progress</span><span className="font-black text-primary">{courseProgress}%</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${courseProgress}% of available lessons completed`}><div className="h-full rounded-full bg-highlight transition-all" style={{ width: `${courseProgress}%` }} /></div>
              <p className="mt-2 text-xs text-muted-foreground">{completedLessonCount} of {allLessons.length} available lessons completed</p>
            </div>
          </section>
        )}

        {/*
          The lesson renders on the two pages that show course content, and only while one is open.

          It used to render on EVERY route, so navigating anywhere reopened the lesson on top of the
          page you asked for — the trap reported earlier. Gating it to Learn alone then broke the
          opposite way: the Continue button lives on Home, so pressing it set state that nothing
          rendered and the button appeared dead. Home and Learn both show the course, so both may
          open a lesson; every other page may not.
        */}
        {needsOnboarding && tab === "Home" ? (
          <OnboardingView onDone={() => setNeedsOnboarding(false)} />
        ) : openLesson && (tab === "Learn" || tab === "Home") ? (
          <LessonFlow key={openLesson.id} lesson={openLesson} sample={isDemo} onClose={() => setOpenLessonId(null)}
            onComplete={() => { markDone("continue"); setLessonsDone((d) => d.includes(openLesson.id) ? d : [...d, openLesson.id]); saveCompletion(openLesson.id); }}
            onNext={(() => { const i = allLessons.findIndex((l) => l.id === openLesson.id); const nx = allLessons[i + 1]; return nx ? () => setOpenLessonId(nx.id) : undefined; })()} />
        ) : tab === "Tutor" ? (
          <TutorView />
        ) : tab === "Practise" ? (
          <PracticeView />
        ) : tab === "Ndebe" ? (
          <NdebeStudio />
        ) : tab === "Keyboard" ? (
          <KeyboardView />
        ) : tab === "Teachers" ? (
          <TeachersView />

        ) : tab === "Profile" ? (
          <ProfileView />
        ) : tab === "Staff" ? (
          <StaffView />
        ) : (
          <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-8">
              {tab === "Home" && (
                <>
                  <section className="rise-in-delay overflow-hidden rounded-lg bg-brand text-brand-foreground shadow-lg">
                    <div className="grid md:grid-cols-[1fr_220px]">
                      <div className="p-6 sm:p-8">
                        <div className="flex flex-wrap items-center gap-2"><StatusBadge tone="warning">Next lesson</StatusBadge>{isDemo && <StatusBadge>Demo course</StatusBadge>}</div>
                        <h2 className="mt-5 font-display text-3xl font-semibold sm:text-4xl">{currentLesson?.title ?? "Continue learning"}</h2>
                        <p className="mt-3 max-w-lg text-sm leading-6 text-brand-foreground/80">Resume your guided lesson and keep your place across activities.</p>
                        <div className="mt-6 flex items-center gap-3"><div className="h-1 flex-1 overflow-hidden rounded-full bg-brand-foreground/20"><div className="h-full w-1/4 rounded-full bg-highlight" /></div><span className="text-xs font-bold">Ready</span></div>
                        <Button className="mt-6 w-full bg-highlight text-highlight-foreground hover:bg-highlight/90 sm:w-auto" onClick={() => window.location.assign(`/learn?lesson=${currentLesson?.id ?? ""}`)}>
                          Continue lesson <ArrowRight className="size-4" />
                        </Button>
                      </div>
                      <div className="relative hidden overflow-hidden border-l border-brand-foreground/15 md:block" aria-hidden="true">
                        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(30deg,transparent_35%,currentColor_36%,currentColor_38%,transparent_39%),linear-gradient(-30deg,transparent_35%,currentColor_36%,currentColor_38%,transparent_39%)] [background-size:42px_72px]" />
                        <div className="absolute bottom-6 left-6 right-6 border-l-4 border-highlight pl-4 font-display text-2xl leading-tight">One lesson.<br />One step.<br />Keep going.</div>
                      </div>
                    </div>
                  </section>

                  <section aria-labelledby="journey-heading">
                    <div className="mb-4 flex items-end justify-between">
                      <div><p className="text-xs font-bold uppercase text-muted-foreground">Your plan</p><h2 id="journey-heading" className="mt-1 font-display text-2xl font-semibold">Today’s journey</h2></div>
                      <span className="text-sm font-bold text-primary">{completed.length * MINUTES_PER_LESSON} / {learner.dailyGoalMinutes} min</span>
                    </div>
                    {isDemo && <p className="mb-3 text-xs text-muted-foreground">Preview plan · activity details are demonstration content until approved curriculum is published.</p>}
                    <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card shadow-sm">
                      {journey.map(({ id, title, detail, action, icon: Icon, tone }) => {
                        const isDone = completed.includes(id);
                        return (
                          <article key={id} className="group flex min-h-24 items-center gap-4 p-4 transition hover:bg-muted/45 sm:px-5">
                            <div className={`grid size-12 shrink-0 place-items-center rounded-md ${tone === "green" ? "bg-primary text-primary-foreground" : tone === "coral" ? "bg-accent text-accent-foreground" : tone === "gold" ? "bg-secondary text-secondary-foreground" : "bg-ink text-primary-foreground"}`}><Icon className="size-5" /></div>
                            <div className="min-w-0 flex-1"><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>
                            <Button variant={isDone ? "ghost" : "icon"} aria-label={`${action}: ${title}`} onClick={() => {
                                /*
                                 * Each action goes where it says it goes.
                                 *
                                 * Three of these previously called `markDone(id)`, which ticked the
                                 * row and did nothing else — a button that looked like it started
                                 * something and only changed its own icon. "continue" opened a
                                 * lesson, but only on a tab that could not render it.
                                 */
                                if (id === "continue") { window.location.assign(`/learn?lesson=${currentLesson?.id ?? ""}`); return; }
                                window.location.assign(id === "review" || id === "practice" || id === "listen" ? "/practise" : "/learn");
                              }}>
                              {isDone ? <Check className="size-5 text-primary" /> : <ChevronRight className="size-5" />}
                            </Button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}

{tab === "Learn" && (
                /*
                 * The course page says what it IS.
                 *
                 * It opened straight into a list of units, so a learner arriving from the menu saw
                 * "Your learning path" and two unit names with no statement of what the page is for or
                 * what to do first. This is the one screen that should need no interpretation.
                 */
                <section className="rise-in overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                  <div className="p-6 sm:p-8">
                    <p className="text-xs font-extrabold uppercase text-primary">Your Igbo course</p>
                    <h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">Learn Igbo, one short lesson at a time.</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                      Work through the lessons in order. Each one teaches a few words from the Ozituma
                      dictionary, shows you how they are used in a sentence, and gives you the recording so
                      you hear it rather than only read it.
                    </p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-md border border-border bg-secondary/50 p-3">
                        <p className="text-xs font-extrabold uppercase text-muted-foreground">Every word</p>
                        <p className="mt-1 text-sm">Comes from the published Central Igbo dictionary, with its meaning and recording.</p>
                      </div>
                      <div className="rounded-md border border-border bg-secondary/50 p-3">
                        <p className="text-xs font-extrabold uppercase text-muted-foreground">Your progress</p>
                        <p className="mt-1 text-sm">Lessons unlock in order. Sign in and your place is kept across devices.</p>
                      </div>
                      <div className="rounded-md border border-border bg-secondary/50 p-3">
                        <p className="text-xs font-extrabold uppercase text-muted-foreground">No account needed</p>
                        <p className="mt-1 text-sm">You can read every lesson without signing in. An account only saves your progress.</p>
                      </div>
                    </div>
                    {isDemo && <p className="mt-5 text-xs text-muted-foreground">Showing the demo course until approved units are published.</p>}
                  </div>
                </section>
              )}

              {missingLesson && (
                <div className="rounded-md border-2 border-highlight/40 bg-highlight/10 p-4 text-sm">
                  <strong>That lesson does not exist.</strong> There is nothing at <code className="rounded-sm bg-card px-1">{`lesson=${missingLesson}`}</code>.
                  {" "}The available lessons are below — pick one to begin.
                </div>
              )}
              <CoursePath units={units} isDemo={isDemo} completed={lessonsDone} onOpen={(id) => setOpenLessonId(id)} expanded={tab === "Learn"} />
            </div>

            <aside className="space-y-5 xl:sticky xl:top-26">
              <section className="rounded-md border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between"><h2 className="font-display text-xl font-semibold">Learning record</h2><StatusBadge tone="positive">On this device</StatusBadge></div>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div><p className="text-2xl font-black">{completedLessonCount}</p><p className="text-xs text-muted-foreground">Lessons completed</p></div>
                  {/*
                    Live values when signed in, an honest dash when not.

                    XP, streak and level are DERIVED from lesson_progress, never stored, so they
                    cannot drift from what the learner actually finished. A dash while signed out is
                    deliberate: "0" would read as "you have done nothing" rather than "there is no
                    account to count against yet".
                  */}
                  <div><p className="text-2xl font-black">{standing ? standing.xp : "—"}</p><p className="text-xs text-muted-foreground">XP</p></div>
                  <div><p className="text-2xl font-black">{standing ? standing.streak : "—"}</p><p className="text-xs text-muted-foreground">Day streak</p></div>
                  <div><p className="text-2xl font-black">{standing?.level.level ?? "—"}</p><p className="text-xs text-muted-foreground">{standing?.level.name ?? "Sign in to track"}</p></div>
                </div>
                {standing && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground">
                      {standing.xpToNext === null
                        ? "Top level reached."
                        : `${standing.xpToNext} XP to ${LEVELS[LEVELS.indexOf(standing.level) + 1]?.name ?? "the next level"}.`}
                      {standing.longestStreak > standing.streak && ` Best run: ${standing.longestStreak} days.`}
                    </p>
                    {/* The same bar the course uses, so the two read as one system. */}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={standing.level.name}>
                      <div className="h-full rounded-full bg-highlight transition-all" style={{ width: `${standing.xpToNext === null ? 100 : Math.round((standing.xp / (standing.xp + standing.xpToNext)) * 100)}%` }} />
                    </div>
                  </div>
                )}
                {standing && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-xs font-extrabold uppercase text-muted-foreground">Badges</p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {standing.badges.map((b) => (
                        <li
                          key={b.id}
                          /*
                           * Earned badges are solid, unearned are outlined. The distinction is carried
                           * by BORDER AND TEXT COLOUR as well as opacity, so it does not depend on
                           * seeing a subtle shade difference — and the title says what it takes, so a
                           * locked badge is a goal rather than a mystery.
                           */
                          title={b.detail}
                          className={
                            b.earned
                              ? "rounded-sm bg-primary px-2 py-1 text-[10px] font-black uppercase text-primary-foreground"
                              : "rounded-sm border border-dashed border-border px-2 py-1 text-[10px] font-black uppercase text-muted-foreground"
                          }
                        >
                          {b.earned ? b.label : `· ${b.detail}`}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {standing.badges.filter((b) => b.earned).length} of {standing.badges.length} earned.
                    </p>
                  </div>
                )}
                {!auth.user && <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">Sign in to keep completed lessons, XP and your streak across your devices.</p>}
              </section>

              <section className="rounded-md border border-border bg-secondary p-5">
                <div className="flex items-start gap-3"><Trophy className="mt-0.5 size-5 text-highlight-foreground" /><div><p className="text-xs font-extrabold uppercase text-muted-foreground">Next milestone</p><h2 className="mt-1 font-display text-xl font-semibold">Complete this unit</h2></div></div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">Finish the available lessons in order to unlock the next part of your path.</p>
              </section>

              <section className="rounded-md border border-border bg-card p-5">
                <div className="flex items-center gap-2"><Volume2 className="size-4 text-primary" /><h2 className="text-sm font-extrabold uppercase">Content promise</h2></div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">Language content will carry a clear review label. Demonstration text is never presented as verified teaching material.</p>
                {/* This badge is an EXAMPLE of the review label, not a claim about this page. Labelled as such. */}
                  <span className="mt-4 inline-flex rounded-sm bg-muted px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">Example label: Placeholder content</span>
              </section>
            </aside>
          </div>
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex gap-1 overflow-x-auto border-t border-border bg-card px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-lg lg:hidden" aria-label="Mobile navigation">
        {navItems.map(({ label, icon: Icon, href }) =>
          href ? (
            /* Leaves the app — same treatment as the desktop nav, so mobile matches. */
            <a key={label} href={href} className="flex min-h-14 min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 text-[10px] font-bold text-muted-foreground"><Icon className="size-5" />{label}</a>
          ) : (
            <a key={label} href={TAB_PATH[label as Tab]} className={`flex min-h-14 min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 text-[10px] font-bold ${tab === label ? "bg-secondary text-primary" : "text-muted-foreground"}`}><Icon className="size-5" />{label}</a>
          )
        )}
      </nav>

    </div>
  );
}

function CoursePath({ units, isDemo, completed, onOpen, expanded }: { units: readonly Unit[]; isDemo: boolean; completed: string[]; onOpen: (id: string) => void; expanded: boolean }) {
  return (
    <section aria-labelledby="path-heading" className={expanded ? "pt-1" : ""}>
      <div className="mb-4"><p className="text-xs font-bold uppercase text-muted-foreground">Level 0 · Foundations{isDemo ? " · Demo course" : ""}</p><h2 id="path-heading" className="mt-1 font-display text-2xl font-semibold">Your learning path</h2></div>
      <div className="space-y-3">
        {units.map((unit) => {
          const done = unit.lessons.filter((l) => completed.includes(l.id)).length;
          const progress = Math.round((done / unit.lessons.length) * 100);
          const unitOpen = unit.lessons.some((l) => lessonStatus(l.id, completed, units.flatMap((u) => u.lessons)) !== "locked");
          return <article key={unit.number} className="rounded-md border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className={`grid size-11 shrink-0 place-items-center rounded-md font-black ${unitOpen ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{unit.number}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-display text-xl font-semibold">{unit.title}</h3><p className="text-sm text-muted-foreground">{done} of {unit.lessons.length} lessons</p></div><span className="text-xs font-bold text-muted-foreground">{progress}%</span></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
              {(expanded || unitOpen) && <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {unit.lessons.map((lesson) => { const status = lessonStatus(lesson.id, completed, units.flatMap((u) => u.lessons)); return <button key={lesson.id} disabled={status === "locked"} onClick={() => onOpen(lesson.id)} className={`flex min-h-12 items-center gap-3 rounded-md border px-3 text-left text-sm font-bold transition ${status === "current" ? "border-primary bg-secondary text-secondary-foreground" : "border-border bg-background hover:border-primary disabled:opacity-55 disabled:hover:border-border"}`}>
                  <span className={`grid size-7 shrink-0 place-items-center rounded-full ${status === "done" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{status === "done" ? <Check className="size-3.5" /> : status === "locked" ? <LockKeyhole className="size-3.5" /> : <BookOpen className="size-3.5" />}</span><span className="flex-1">{lesson.title}</span>{status === "done" && <span className="text-xs font-bold text-muted-foreground">Replay</span>}
                </button>; })}
              </div>}
            </div>
          </div>
        </article>; })}
      </div>
    </section>
  );
}
