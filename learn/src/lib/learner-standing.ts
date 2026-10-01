/**
 * XP, streaks and level — all derived, none invented.
 *
 * WHY THIS EXISTS AS A DERIVATION AND NOT COLUMNS
 *
 * `learning-data.ts` used to carry `xp: 1240, streak: 7, level: 3` as constants. They are gone.
 * The temptation now is to add three columns and increment them on completion — which is how
 * gamification normally rots: a missed write, a double-submit, an offline completion, and the stored
 * number no longer matches what the learner did. There is then no way to tell which is right.
 *
 * `lesson_progress` already records one row per completed lesson with `completed_at`. Everything
 * here is COUNTED from that, so it cannot drift: the number is a function of the record, not a
 * second record that has to be kept in step.
 *
 * WHAT EACH THING MEANS, SO IT CANNOT BE MISREAD
 *
 *   XP       a fixed sum per completed lesson. Deliberately flat: weighting lessons by difficulty
 *            would need a difficulty rating that does not exist, and inventing one is the fault
 *            this file replaces.
 *   streak   consecutive CALENDAR DAYS with at least one completion, ending today or yesterday.
 *            Yesterday counts, because a streak that breaks at midnight while somebody is asleep
 *            is punishing the wrong thing.
 *   level    a band over total XP. Named, because "Level 3" alone tells a learner nothing.
 *
 * TIME ZONE
 *
 * Days are counted in the learner's local time, not UTC. A lesson finished at 9pm in Lagos is that
 * day's lesson, and `toISOString()` would file it under the previous UTC day.
 */

import { supabase } from "@/integrations/supabase/client";

/** Flat XP per completed lesson. Not a difficulty rating — the lessons do not carry one. */
export const XP_PER_LESSON = 20;

/** Bonus for finishing every lesson in the published course. */
export const XP_PER_COURSE_COMPLETE = 100;

/**
 * Level bands.
 *
 * `min` is inclusive XP. The names describe the learner's actual position in the course rather than
 * awarding a medal, because there is no assessment to justify anything grander.
 */
export const LEVELS = [
  { level: 1, min: 0, name: "Just started" },
  { level: 2, min: 100, name: "Finding your feet" },
  { level: 3, min: 300, name: "Getting comfortable" },
  { level: 4, min: 600, name: "Holding a conversation" },
  { level: 5, min: 1000, name: "Speaking with confidence" },
] as const;

export type Level = (typeof LEVELS)[number];

/** The learner's local calendar day, as YYYY-MM-DD. */
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A badge.
 *
 * Earned by a COUNTED fact, never awarded by a timer or a feel. Every condition below reads
 * `lesson_progress`, which is the only record of what the learner actually did — so a badge cannot
 * be granted for something that did not happen, and cannot be lost by a failed write either.
 */
export interface Badge {
  id: string;
  label: string;
  /** What it took to earn it, in the learner's terms. */
  detail: string;
  earned: boolean;
}

export interface LearnerStanding {
  xp: number;
  level: Level;
  /** XP still needed for the next level, or null at the top. */
  xpToNext: number | null;
  /** Consecutive days with a completion, counting back from today or yesterday. */
  streak: number;
  /** The longest run this learner has ever had, so a broken streak is not the whole story. */
  longestStreak: number;
  lessonsCompleted: number;
  /** True when at least one lesson was completed today. */
  activeToday: boolean;
  badges: Badge[];
}

/**
 * The badges, and what earns each.
 *
 * Deliberately few and all reachable. A badge nobody can get is decoration, and a long list of them
 * devalues the ones that mean something — so each of these marks a real change in what the learner
 * can do, and the first is earned by finishing a single lesson.
 */
export function badgesFrom(input: {
  lessonsCompleted: number;
  streak: number;
  longestStreak: number;
  xp: number;
  daysActive: number;
}): Badge[] {
  const { lessonsCompleted, streak, longestStreak, xp, daysActive } = input;
  return [
    {
      id: "first-lesson",
      label: "First step",
      detail: "Finish your first lesson",
      earned: lessonsCompleted >= 1,
    },
    {
      id: "five-lessons",
      label: "Getting going",
      detail: "Finish 5 lessons",
      earned: lessonsCompleted >= 5,
    },
    {
      id: "two-day-streak",
      label: "Two in a row",
      detail: "Practise on 2 days running",
      earned: longestStreak >= 2,
    },
    {
      id: "week-streak",
      label: "A full week",
      detail: "Practise on 7 days running",
      earned: longestStreak >= 7,
    },
    {
      id: "ten-days",
      label: "Ten days in",
      detail: "Study on 10 separate days",
      earned: daysActive >= 10,
    },
    {
      id: "level-three",
      label: "Getting comfortable",
      detail: "Reach level 3",
      earned: xp >= 300,
    },
  ];
}

/**
 * Compute a learner's standing from their completions.
 *
 * Takes the rows rather than fetching them, so the caller decides how to load and the function stays
 * pure and testable. `totalPublishedLessons` is only used for the course bonus.
 */
export function standingFrom(
  completions: readonly { completed_at: string | null }[],
  totalPublishedLessons: number
): LearnerStanding {
  const days = [
    ...new Set(
      completions
        .filter((c) => c.completed_at)
        .map((c) => localDay(new Date(String(c.completed_at))))
    ),
  ].sort();

  const lessonsCompleted = completions.filter((c) => c.completed_at).length;
  const xp =
    lessonsCompleted * XP_PER_LESSON +
    (totalPublishedLessons > 0 && lessonsCompleted >= totalPublishedLessons ? XP_PER_COURSE_COMPLETE : 0);

  const level = [...LEVELS].reverse().find((l) => xp >= l.min) ?? LEVELS[0];
  const next = LEVELS.find((l) => l.min > xp);
  const xpToNext = next ? next.min - xp : null;

  const today = localDay(new Date());
  const yesterday = localDay(new Date(Date.now() - 86_400_000));

  /*
   * The current streak walks backwards from today. It starts at yesterday if today has nothing yet,
   * so a learner who has not studied YET today has not lost their streak — losing it at midnight
   * would be counting the wrong thing.
   */
  const daySet = new Set(days);
  let streak = 0;
  if (daySet.has(today) || daySet.has(yesterday)) {
    let cursor = daySet.has(today) ? new Date() : new Date(Date.now() - 86_400_000);
    while (daySet.has(localDay(cursor))) {
      streak += 1;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
  }

  // Longest run ever, so one bad week does not erase what the learner has done.
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of days) {
    if (prev && new Date(day).getTime() - new Date(prev).getTime() === 86_400_000) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = day;
  }

  return {
    xp,
    level,
    xpToNext,
    streak,
    longestStreak: longest,
    lessonsCompleted,
    activeToday: daySet.has(today),
    badges: badgesFrom({ lessonsCompleted, streak, longestStreak: longest, xp, daysActive: days.length }),
  };
}

/** Load a learner's completions and compute their standing. */
export async function loadStanding(
  userId: string,
  totalPublishedLessons: number
): Promise<LearnerStanding> {
  const { data } = await supabase
    .from("lesson_progress")
    .select("completed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null);

  return standingFrom((data ?? []) as { completed_at: string | null }[], totalPublishedLessons);
}
