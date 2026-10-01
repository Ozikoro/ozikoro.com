import { BookOpen, Headphones, MessagesSquare, Shapes } from "lucide-react";

/**
 * The learner's daily plan, with the invented values removed.
 *
 * WHAT WAS HERE
 *
 * This file held a fictional learner:
 *
 *     name: "Chidi", level: 3, xp: 1240, streak: 7, completedMinutes: 9
 *
 * `name`, `level`, `xp` and `streak` are referenced by zero components — decorative numbers sitting
 * in an exported object, one import away from being rendered as if they were the learner's real
 * standing.
 *
 * `completedMinutes: 9` WAS rendered, which is worse. The home screen computed:
 *
 *     {learner.completedMinutes + completed.length * 2} / {learner.dailyGoal} min
 *
 * so a brand-new account saw "9 / 15 min" before doing anything. Every learner started six minutes
 * into their day, from a constant.
 *
 * WHAT CHANGED
 *
 * The exported shape, the icons and the tones are untouched — this is a data change, not a design
 * one. Only the numbers that were invented are gone:
 *
 *   - `completedMinutes` is removed. Minutes are now earned from real completions in the shell.
 *   - `dailyGoal` stays, renamed `dailyGoalMinutes`. A goal is a target rather than a measurement,
 *     so it is the one arbitrary number here and it is named to say so.
 *   - `xp`, `streak` and `level` are NOT stubbed. Deriving them honestly means reading
 *     `lesson_progress.completed_at`; putting placeholders back is the exact fault being fixed.
 *
 * The "review" entry used to read "Review 8 words · Due today", which asserts a spaced-repetition
 * schedule that does not exist — there is no SRS engine, so no number of words is genuinely "due".
 * The wording now describes what the action does instead of how much of it is outstanding.
 */

export const learner = {
  dailyGoalMinutes: 15,
};

export const journey = [
  { id: "continue", title: "Continue your lesson", detail: "Pick up where you stopped", action: "Continue", icon: BookOpen, tone: "green" },
  { id: "review", title: "Review vocabulary", detail: "Practise published words", action: "Review", icon: Shapes, tone: "coral" },
  { id: "listen", title: "Listening practice", detail: "Sentences with native recordings", action: "Listen", icon: Headphones, tone: "gold" },
  { id: "practice", title: "Quick practice", detail: "Test yourself on real words", action: "Play", icon: MessagesSquare, tone: "ink" },
] as const;

/** Minutes earned per completed lesson. An approximation, and named as one. */
export const MINUTES_PER_LESSON = 2;

// Course units and lessons live in ./lesson-data.ts
