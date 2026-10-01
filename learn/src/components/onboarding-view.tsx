/**
 * Onboarding — four questions, once.
 *
 * WHY IT EXISTS
 *
 * `profiles` has carried `native_language`, `learning_reason`, `starting_level`, `daily_goal_minutes`
 * and `onboarded` since the first migration, and nothing ever wrote to them. Every learner arrived at
 * the same course with the same daily goal and no idea where they were starting from, so the daily
 * plan had nothing to plan against and the level could not be placed.
 *
 * WHY FOUR QUESTIONS AND NOT A WIZARD
 *
 * Each one changes something the app actually does:
 *
 *   starting level  -> which lesson the course offers first
 *   daily goal      -> the minutes the home screen measures against
 *   reason          -> the wording of the plan, and which focus is suggested
 *   native language -> whether to explain in English or assume more
 *
 * A question that changed nothing would be a toll, not onboarding. Anything that did not meet that
 * bar was left out — including a name, which comes from the account and does not need asking.
 *
 * WHY IT CAN BE SKIPPED
 *
 * Every field has a working default and the course runs without them. Blocking a learner behind a
 * form before they have seen anything is the fastest way to lose them, so Skip writes the defaults
 * and marks the profile onboarded. It is offered once, and only once.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/button";
import { useAuth } from "@/lib/use-auth";

const LEVELS = [
  { id: "beginner", label: "Complete beginner", detail: "I have never studied Igbo." },
  { id: "some", label: "I know some words", detail: "I understand a little but cannot speak it." },
  { id: "heritage", label: "I grew up hearing it", detail: "I understand more than I can say." },
  { id: "returning", label: "Returning to it", detail: "I studied before and want to continue." },
] as const;

const REASONS = [
  { id: "family", label: "Family and heritage" },
  { id: "travel", label: "Travel or living in Nigeria" },
  { id: "work", label: "Work or study" },
  { id: "interest", label: "Personal interest" },
] as const;

const GOALS = [5, 10, 15, 30] as const;

export function OnboardingView({ onDone }: { onDone: () => void }) {
  const { user, ready } = useAuth();
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState<string>("beginner");
  const [reason, setReason] = useState<string>("family");
  const [goal, setGoal] = useState<number>(15);
  const [native, setNative] = useState<string>("English");
  const [saving, setSaving] = useState(false);

  /*
   * A signed-in learner whose profile says `onboarded` should never see this, and the check belongs
   * here rather than in the parent so the component cannot be rendered into a finished profile by a
   * mistake elsewhere.
   */
  useEffect(() => {
    if (!ready || !user) return;
    void supabase
      .from("profiles")
      .select("onboarded")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.onboarded) onDone();
      });
  }, [user, ready, onDone]);

  const save = async (skip: boolean) => {
    if (!user || saving) return;
    setSaving(true);
    /*
     * `onboarded: true` is written even on Skip. The point of the flag is "do not ask again", and a
     * skipped profile has still answered that question — leaving it false would show the form on
     * every visit, which is the opposite of what Skip means.
     */
    const { error } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        starting_level: skip ? "beginner" : level,
        learning_reason: skip ? null : reason,
        daily_goal_minutes: skip ? 15 : goal,
        native_language: skip ? null : native,
        onboarded: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    setSaving(false);
    // `onDone` either way: a failed write must not trap the learner in a form. The defaults apply
    // and the next visit offers it again, which is the recoverable direction to fail.
    if (error) console.error("[onboarding]", error);
    onDone();
  };

  const steps = [
    {
      title: "Where are you starting from?",
      note: "This decides which lesson the course offers you first.",
      body: (
        <div className="space-y-3">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLevel(l.id)}
              className={`w-full rounded-md border-2 p-4 text-left transition ${level === l.id ? "border-primary bg-secondary" : "border-border bg-card hover:border-primary/40"}`}
            >
              <span className="block font-bold">{l.label}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{l.detail}</span>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Why are you learning Igbo?",
      note: "It shapes which vocabulary the plan reaches for first.",
      body: (
        <div className="grid gap-3 sm:grid-cols-2">
          {REASONS.map((r) => (
            <button
              key={r.id}
              onClick={() => setReason(r.id)}
              className={`rounded-md border-2 p-4 text-left font-bold transition ${reason === r.id ? "border-primary bg-secondary" : "border-border bg-card hover:border-primary/40"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "How much time each day?",
      note: "You can change this later. A small goal you keep beats a large one you do not.",
      body: (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {GOALS.map((g) => (
            <button
              key={g}
              onClick={() => setGoal(g)}
              className={`rounded-md border-2 p-4 text-center transition ${goal === g ? "border-primary bg-secondary" : "border-border bg-card hover:border-primary/40"}`}
            >
              <span className="block font-display text-2xl font-semibold">{g}</span>
              <span className="text-xs text-muted-foreground">minutes</span>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "What is your first language?",
      note: "Used only to decide how much to explain. It is never shared.",
      body: (
        <input
          value={native}
          onChange={(e) => setNative(e.target.value)}
          maxLength={60}
          className="w-full rounded-md border-2 border-border bg-card px-4 py-3 outline-none focus:border-primary"
          placeholder="e.g. English"
        />
      ),
    },
  ];

  const isLast = step === steps.length - 1;

  return (
    <div className="rise-in mx-auto max-w-2xl">
      <div className="rounded-lg border-2 border-b-8 border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-xs font-extrabold uppercase text-muted-foreground">
          Step {step + 1} of {steps.length}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">{steps[step]!.title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{steps[step]!.note}</p>

        <div className="mt-6">{steps[step]!.body}</div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <Button variant="ghost" disabled={saving} onClick={() => void save(true)}>
            Skip for now
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="secondary" disabled={saving} onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            <Button
              disabled={saving}
              onClick={() => (isLast ? void save(false) : setStep((s) => s + 1))}
            >
              {saving ? "Saving…" : isLast ? "Start learning" : "Next"}
            </Button>
          </div>
        </div>
      </div>

      {/*
        Said plainly, because a learner who does not want to answer should know the cost is nothing
        rather than assume the course is locked behind the form.
      */}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Every question is optional. Skipping uses sensible defaults and you can change them in your profile.
      </p>
    </div>
  );
}
