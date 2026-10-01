/**
 * Spaced repetition — the daily review plan.
 *
 * WHAT THIS IS
 *
 * SuperMemo-2, the original algorithm, with nothing added. It is small, well understood, and every
 * number it needs is already stored: `ease`, `interval_days`, `streak`, `due_at`. The value of using
 * a published algorithm rather than an invented curve is that its behaviour is predictable and its
 * failures are documented — an ad-hoc schedule is one nobody can reason about or debug.
 *
 * WHY IT LIVES ON THE SERVER
 *
 * The schedule is in `review_schedule`, keyed by (user, word), so it is the same on every device. A
 * queue kept in the browser is not one schedule, it is one per browser, and they disagree.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not decide WHICH words to teach, and it does not invent example sentences or meanings. It
 * schedules words that already exist in `lexemes` and are already `published` — a linguist approved
 * them. The algorithm decides *when* to show a word, never *what* a word is.
 */

import { supabase } from "@/integrations/supabase/client";

/**
 * How well the learner recalled a word.
 *
 * Four buttons rather than a 0–5 scale, because five options is more than a learner can answer
 * consistently and inconsistency is what breaks an SRS. Mapped onto the SM-2 quality scale:
 *
 *   again -> 2   forgot it; the interval resets and ease drops
 *   hard  -> 3   recalled, but with effort
 *   good  -> 4   recalled correctly
 *   easy  -> 5   immediate
 */
export type Grade = "again" | "hard" | "good" | "easy";

const QUALITY: Record<Grade, number> = { again: 2, hard: 3, good: 4, easy: 5 };

/** SM-2's own constants. Named so the numbers are not mysterious. */
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
/** First two successful intervals, in days, as the algorithm specifies. */
const FIRST_INTERVAL = 1;
const SECOND_INTERVAL = 6;
/** A word is not shown twice in one sitting, however easy it was. */
const MIN_INTERVAL_DAYS = 1;
/**
 * A ceiling, because SM-2 grows without bound and would eventually schedule a word years out.
 * One year is past the point where the schedule is still useful to a learner.
 */
const MAX_INTERVAL_DAYS = 365;

export interface ScheduleState {
  ease: number;
  interval_days: number;
  streak: number;
  reviews: number;
  lapses: number;
}

export interface ScheduleResult extends ScheduleState {
  dueAt: Date;
}

/**
 * Apply one review to a schedule — the whole algorithm.
 *
 * Pure, and takes the previous state rather than reading it, so it can be reasoned about and tested
 * without a database. The caller decides when to write the result.
 */
export function applyReview(prev: Partial<ScheduleState>, grade: Grade, now = new Date()): ScheduleResult {
  const ease = prev.ease ?? DEFAULT_EASE;
  const interval = prev.interval_days ?? 0;
  const streak = prev.streak ?? 0;
  const reviews = prev.reviews ?? 0;
  const lapses = prev.lapses ?? 0;

  const q = QUALITY[grade];
  const passed = q >= 3;

  let nextEase = ease;
  let nextStreak: number;
  let nextInterval: number;
  let nextLapses = lapses;

  if (!passed) {
    /*
     * A lapse. The interval resets to a single day and the streak breaks, but `lapses` is recorded
     * rather than the schedule being discarded: a word the learner keeps forgetting is information,
     * and deleting it would lose that.
     */
    nextStreak = 0;
    nextInterval = MIN_INTERVAL_DAYS;
    nextLapses = lapses + 1;
  } else {
    nextStreak = streak + 1;
    if (nextStreak === 1) nextInterval = FIRST_INTERVAL;
    else if (nextStreak === 2) nextInterval = SECOND_INTERVAL;
    else nextInterval = Math.round(interval * ease);
  }

  /*
   * SM-2's ease adjustment: EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)).
   * It applies on every review, including lapses, which is what makes a repeatedly-failed word
   * come back sooner each time.
   */
  nextEase = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  nextEase = Math.min(5, Math.max(MIN_EASE, Math.round(nextEase * 100) / 100));

  nextInterval = Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, nextInterval));

  const dueAt = new Date(now.getTime() + nextInterval * 86_400_000);

  return {
    ease: nextEase,
    interval_days: nextInterval,
    streak: nextStreak,
    reviews: reviews + 1,
    lapses: nextLapses,
    dueAt,
  };
}

export interface ReviewCard {
  lexemeId: string;
  headword: string;
  toneMarked: string | null;
  meaning: string;
  audioUrl: string | null;
  /** The sentence recording, when the word has one — hearing it used is the point of the example. */
  exampleIg: string | null;
  exampleEn: string | null;
  exampleAudioUrl: string | null;
  /** Null for a word that has never been reviewed — this is its first appearance. */
  schedule: ScheduleState | null;
}

/**
 * The words due for review, soonest first.
 *
 * A word enters the queue the first time it is asked for, which is why this returns NEW words as
 * well as DUE ones: `review_schedule` only has a row once a learner has reviewed something, so
 * without this the first day would always be empty.
 */
export async function loadDueCards(userId: string, limit = 20): Promise<ReviewCard[]> {
  const { data: due } = await supabase
    .from("review_schedule")
    .select("lexeme_id,ease,interval_days,streak,reviews,lapses,due_at")
    .eq("user_id", userId)
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(limit);

  const scheduled = due ?? [];
  const scheduledIds = scheduled.map((r) => r.lexeme_id as string);

  /*
   * Fill the rest of the queue with words the learner has never seen. Only published Central Igbo
   * words are eligible — the algorithm chooses the order, never the content.
   */
  /** Ids only — these cards have no schedule yet, so there is no row shape to carry. */
  let freshIds: string[] = [];
  if (scheduled.length < limit) {
    const { data: candidates } = await supabase
      .from("lexemes")
      .select("id")
      .eq("status", "published")
      .is("dialect", null)
      .order("headword")
      .limit(limit * 3);

    /*
     * Every word the learner already has a schedule for is excluded, not just today's due ones —
     * otherwise a word scheduled for next week would reappear as "new" today.
     */
    const known = new Set(scheduledIds);
    const { data: existing } = await supabase
      .from("review_schedule")
      .select("lexeme_id")
      .eq("user_id", userId);
    for (const r of existing ?? []) known.add(r.lexeme_id as string);

    freshIds = (candidates ?? [])
      .map((c) => c.id as string)
      .filter((id) => !known.has(id))
      .slice(0, limit - scheduled.length);
  }

  const allIds = [...scheduledIds, ...freshIds];
  if (allIds.length === 0) return [];

  // One query for the word data and one for its recorded sentences, rather than one per card.
  const [{ data: words }, { data: examples }] = await Promise.all([
    supabase
      .from("lexemes")
      .select("id,headword,tone_marked,meaning,audio_url,example_ig,example_en")
      .in("id", allIds),
    supabase
      .from("lexeme_examples")
      .select("lexeme_id,text_ig,text_en,audio_url")
      .in("lexeme_id", allIds)
      .eq("status", "published")
      .order("position"),
  ]);

  const scheduleByLexeme = new Map(scheduled.map((r) => [r.lexeme_id as string, r]));
  const exampleByLexeme = new Map<string, { text_ig: string; text_en: string | null; audio_url: string | null }>();
  for (const e of examples ?? []) {
    const key = e.lexeme_id as string;
    if (!exampleByLexeme.has(key)) exampleByLexeme.set(key, e as never);
  }

  return (words ?? []).map((w): ReviewCard => {
    const s = scheduleByLexeme.get(w.id as string);
    const ex = exampleByLexeme.get(w.id as string);
    return {
      lexemeId: w.id as string,
      headword: w.headword as string,
      toneMarked: (w.tone_marked as string | null) ?? null,
      meaning: (w.meaning as string | null) ?? "",
      audioUrl: (w.audio_url as string | null) ?? null,
      exampleIg: ex?.text_ig ?? (w.example_ig as string | null) ?? null,
      exampleEn: ex?.text_en ?? (w.example_en as string | null) ?? null,
      exampleAudioUrl: ex?.audio_url ?? null,
      schedule: s
        ? {
            ease: Number(s.ease),
            interval_days: Number(s.interval_days),
            streak: Number(s.streak),
            reviews: Number(s.reviews),
            lapses: Number(s.lapses),
          }
        : null,
    };
  });
}

/** Record one review and advance the schedule. Upserts, so a first review creates the row. */
export async function recordReview(userId: string, lexemeId: string, grade: Grade): Promise<boolean> {
  const { data: existing } = await supabase
    .from("review_schedule")
    .select("ease,interval_days,streak,reviews,lapses")
    .eq("user_id", userId)
    .eq("lexeme_id", lexemeId)
    .maybeSingle();

  const next = applyReview((existing ?? {}) as Partial<ScheduleState>, grade);

  const { error } = await supabase.from("review_schedule").upsert(
    {
      user_id: userId,
      lexeme_id: lexemeId,
      ease: next.ease,
      interval_days: next.interval_days,
      streak: next.streak,
      reviews: next.reviews,
      lapses: next.lapses,
      due_at: next.dueAt.toISOString(),
      last_reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,lexeme_id" }
  );

  return !error;
}

/** How many words are waiting, for the daily plan. */
export async function countDue(userId: string): Promise<number> {
  const { count } = await supabase
    .from("review_schedule")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lte("due_at", new Date().toISOString());
  return count ?? 0;
}
