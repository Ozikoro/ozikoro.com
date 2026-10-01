/**
 * The daily review screen.
 *
 * WHAT THIS IS
 *
 * The front end for `srs.ts`. Everything it shows comes from `loadDueCards` — a published Central
 * Igbo word, its meaning, its recording, and a recorded sentence. This file decides presentation and
 * nothing else: it does not choose words, rank them, or write any Igbo.
 *
 * WHY THE ANSWER IS HIDDEN FIRST
 *
 * Recollection has to happen before the answer appears, or the learner is recognising rather than
 * recalling and the grade they give is meaningless. The schedule is only as good as the grade, so
 * the card shows the word, waits, then reveals meaning and audio together.
 *
 * WHY THERE IS NO SCORE
 *
 * A running "8/10" would be a lie: the grades are a self-report, not a test. The four buttons map
 * onto SM-2 quality, and telling a learner they "scored" 75% because they pressed `hard` would
 * misrepresent what the number is for.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/button";
import { playAudio } from "@/lib/use-card-audio";
import { loadDueCards, recordReview, type Grade, type ReviewCard } from "@/lib/srs";

const GRADES: { grade: Grade; label: string; hint: string }[] = [
  { grade: "again", label: "Again", hint: "I had forgotten this" },
  { grade: "hard", label: "Hard", hint: "I got there, slowly" },
  { grade: "good", label: "Good", hint: "I remembered it" },
  { grade: "easy", label: "Easy", hint: "It came immediately" },
];

export function ReviewView() {
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(0);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!userId) {
      // Signed out: nothing to schedule. Say so rather than showing an empty card.
      setLoading(false);
      return;
    }
    void loadDueCards(userId, 20).then((loaded) => {
      setCards(loaded);
      setLoading(false);
    });
  }, [userId]);

  const card = cards[index];

  /*
   * Grade the card and move on.
   *
   * The write is awaited before advancing, and the button is disabled meanwhile, so a double tap
   * cannot record two reviews for one card — which would push the interval out twice and corrupt
   * exactly the number the schedule depends on.
   */
  const grade = useCallback(
    async (g: Grade) => {
      if (!card || !userId || saving) return;
      setSaving(true);
      await recordReview(userId, card.lexemeId, g);
      setReviewed((n) => n + 1);
      setRevealed(false);
      setIndex((i) => i + 1);
      setSaving(false);
    },
    [card, userId, saving]
  );

  // Keyboard grading, so a session can be run without the mouse.
  useEffect(() => {
    if (!revealed || !card) return;
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Grade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      const g = map[e.key];
      if (g) void grade(g);
      if (e.key === " ") { e.preventDefault(); playAudio(card.exampleAudioUrl ?? card.audioUrl); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, card, grade]);

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading your reviews…</p>;
  }

  if (!userId) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-dashed border-border bg-card p-8 text-center">
        <p className="font-display text-xl font-semibold">Sign in to review</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your review schedule follows your account, so it is the same on every device.
        </p>
        <Button asChild className="mt-5"><a href="/auth">Sign in</a></Button>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-dashed border-border bg-card p-8 text-center">
        <p className="font-display text-xl font-semibold">
          {reviewed > 0 ? "That is everything for now" : "Nothing is due"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {reviewed > 0
            ? `${reviewed} word${reviewed === 1 ? "" : "s"} reviewed. The next ones come back when they are due — that is what makes this work.`
            : "Words you learn appear here when they are due. Come back later, or learn a lesson first."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-3 text-sm font-bold text-muted-foreground">
        Card {index + 1} of {cards.length}
        {reviewed > 0 && <> · {reviewed} reviewed</>}
      </p>

      <div className="rounded-lg border-2 border-b-8 border-border bg-card p-8 text-center shadow-sm">
        <p className="font-display text-4xl font-semibold" lang="ig">
          {card.toneMarked || card.headword}
        </p>

        {revealed ? (
          <>
            <p className="mt-5 text-lg">{card.meaning}</p>

            {card.exampleIg && (
              <div className="mt-6 rounded-md bg-muted p-4 text-left">
                <p className="text-xs font-extrabold uppercase text-muted-foreground">In a sentence</p>
                <p className="mt-2 font-semibold" lang="ig">{card.exampleIg}</p>
                {card.exampleEn && <p className="mt-1 text-sm text-muted-foreground">{card.exampleEn}</p>}
              </div>
            )}

            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {card.audioUrl && (
                <Button variant="secondary" onClick={() => playAudio(card.audioUrl)}>
                  Hear the word
                </Button>
              )}
              {card.exampleAudioUrl && (
                <Button variant="secondary" onClick={() => playAudio(card.exampleAudioUrl)}>
                  Hear the sentence
                </Button>
              )}
            </div>

            {card.schedule && (
              <p className="mt-5 text-xs text-muted-foreground">
                Seen {card.schedule.reviews} time{card.schedule.reviews === 1 ? "" : "s"} · every{" "}
                {card.schedule.interval_days} day{card.schedule.interval_days === 1 ? "" : "s"}
                {card.schedule.lapses > 0 && <> · forgotten {card.schedule.lapses}×</>}
              </p>
            )}
          </>
        ) : (
          <Button className="mt-8" onClick={() => setRevealed(true)}>
            Show the meaning
          </Button>
        )}
      </div>

      {revealed && (
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GRADES.map(({ grade: g, label, hint }) => (
            <Button
              key={g}
              variant={g === "good" ? "primary" : "secondary"}
              disabled={saving}
              onClick={() => void grade(g)}
              title={hint}
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      {revealed && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Be honest — the schedule only works if the grade is true. Keys 1–4 grade, space plays the audio.
        </p>
      )}
    </div>
  );
}
