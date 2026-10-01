import { ArrowLeft, Check, CornerDownLeft, RotateCcw, Volume2, X } from "lucide-react";
import { playAudio, useCardAudio } from "@/lib/use-card-audio";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { foldIgboText, normalizeIgboText } from "@/lib/igbo-text";
import type { PracticeRound } from "@/lib/practice-data";
import { useStickyState } from "@/lib/use-sticky-state";

type PracticeGameProps = {
  rounds: readonly PracticeRound[];
  /** "lesson" is the guided path activity, "free" is a repeatable practise session. */
  mode: "lesson" | "free";
  heading?: string;
  onClose: () => void;
  onComplete: () => void;
  /** Saves place on this device so learners resume where they stopped. */
  storageKey?: string;
  /** True when these rounds are the demonstration set rather than published dictionary words. */
  sample?: boolean;
};

type Verdict = "correct" | "tones" | "wrong";

// Igbo letters and combining tone marks that are hard to reach on most keyboards.
const specialKeys = [
  { label: "ị", insert: "ị" }, { label: "ọ", insert: "ọ" }, { label: "ụ", insert: "ụ" }, { label: "ṅ", insert: "ṅ" },
  { label: "´ high", insert: "\u0301" }, { label: "` low", insert: "\u0300" }, { label: "¯ mid", insert: "\u0304" },
];

export function checkTyped(input: string, answer: string): Verdict {
  const a = normalizeIgboText(input.trim()).toLocaleLowerCase("en");
  const b = normalizeIgboText(answer.trim()).toLocaleLowerCase("en");
  if (a === b) return "correct";
  // Diacritic-insensitive match is only a helpful hint, never counted as fully correct.
  if (foldIgboText(a) === foldIgboText(b)) return "tones";
  return "wrong";
}

export function PracticeGame({ rounds, mode, heading, onClose, onComplete, storageKey, sample = false }: PracticeGameProps) {
  const [round, setRound] = useStickyState(storageKey ? `${storageKey}:round` : null, 0);
  const [selected, setSelected] = useState<number | null>(null);
  /** Words placed so far in an order round. */
  const [placed, setPlaced] = useState<string[]>([]);
  /** Right-hand meaning chosen per left-hand pair, in pair order. */
  const [matchPicks, setMatchPicks] = useState<(number | null)[]>([]);
  /** The left-hand word awaiting a meaning. */
  /** Right-hand choice per left-hand pair, in pair order. */
  /** The right column, shuffled once per round so it is not already paired up. */
  /** Which left-hand word is selected, waiting for a meaning. */

  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [audioPlayed, setAudioPlayed] = useState(false);
  const [finished, setFinished] = useStickyState(storageKey ? `${storageKey}:finished` : null, false);
  const [score, setScore] = useStickyState(storageKey ? `${storageKey}:score` : null, 0);
  const [spin, setSpin] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFree = mode === "free";

  /*
   * Real recordings for every word this session can show, fetched once.
   *
   * The Listen button carried `aria-label="Play placeholder audio"` and `onClick={() => setAudioPlayed(true)}`
   * — it toggled a label and played nothing. It now plays the dictionary's own recording.
   *
   * A choice round shows the Igbo in `prompt`; a typing round shows it in `answer`. Both are
   * collected here, so one query covers the whole session instead of one per card.
   */
  const { audio } = useCardAudio(
      rounds.flatMap((r) => (r.kind === "type" || r.kind === "listen" ? [r.answer] : r.kind === "order" ? [...r.answer] : r.kind === "match" ? r.pairs.map((x) => x.ig) : [r.prompt])).filter(Boolean) as string[],
  );

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); return () => { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); }; }, []);

  const views = useMemo(
    () => rounds.map((r, index) => {
        /*
         * Shuffling applies ONLY to rounds that carry options.
         *
         * This used to assume every non-typing round had `options`, which held while
         * there were two kinds. With six it does not: `listen` has no options, and
         * `order` is structural - shuffling its tiles would break the exercise rather than vary it.
         * the exercise rather than vary it.
         */
        /*
         * Only `choice` has options to shuffle. `type` and `listen` carry the answer itself, so
         * there is nothing to rotate.
         */
        if (r.kind !== "choice" && r.kind !== "translate") return r;
      const total = r.options.length;
      const shift = isFree ? (spin + index) % total : 0;
      return { ...r, options: r.options.slice(shift).concat(r.options.slice(0, shift)), correct: isFree ? (r.correct - shift + total) % total : r.correct };
    }),
    [rounds, spin, isFree],
  );

  const current = views[round] ?? views[0];

  const [matchLeft, setMatchLeft] = useState<number | null>(null);
  /** The right column, in a fixed order for the round so tiles cannot move under a finger. */
  const matchOrder = current && current.kind === "match"
    ? [...current.pairs.keys()].sort((a, b) => ((a * 7 + round) % current.pairs.length) - ((b * 7 + round) % current.pairs.length))
    : [];


  /* Resolved after `current` exists — it read `current` from above its own declaration. */
  /*
   * Narrow before reading. `current` can be undefined on an empty round list, and only a typing
   * round has `answer` — the choice member carries `prompt` instead. Reading either without the
   * guard is what the compiler was rejecting.
   */
  const currentWord = !current ? undefined : current.kind === "type" || current.kind === "listen" ? current.answer : current.kind === "order" ? current.answer[0] : current.kind === "match" ? current.pairs[0]?.ig : current.prompt;
  const clip = currentWord ? audio[currentWord] : undefined;
  const total = views.length;
  const checked = verdict !== null;

  const exit = () => onClose();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!current) return null;
  const isType = current.kind === "type" || current.kind === "listen";
  /*
   * Choosing, not typing. `translate` shows an attested sentence and four
   * meanings - it is a choice round with a longer prompt, so it shares the
   * branch rather than adding a third interaction.
   */
  const isChoice = current.kind === "choice" || current.kind === "translate";
  const canCheck = isType
    ? typed.trim().length > 0
    : current.kind === "order"
      ? placed.length === current.answer.length
      : current.kind === "match"
        ? matchPicks.filter((v) => v != null).length === current.pairs.length
        : selected !== null;

  const check = () => {
    if (!canCheck) return;
    const v: Verdict = isType
      ? checkTyped(typed, current.answer)
      : current.kind === "order"
        // Word order is exact: a sentence in the wrong order is a different sentence.
        ? placed.join(" ") === current.answer.join(" ") ? "correct" : "wrong"
        : current.kind === "match"
          // Every pair must be right: a pairing exercise has no partial credit.
          ? matchPicks.every((v, k) => v === k) ? "correct" : "wrong"
        : isChoice && selected === current.correct
        ? "correct"
        : "wrong";
    setVerdict(v);
    if (v === "correct") setScore((s) => s + 1);
  };

  const next = () => {
    if (round === total - 1) { setFinished(true); onComplete(); return; }
    setRound((v) => v + 1); setSelected(null); setTyped(""); setVerdict(null); setAudioPlayed(false); setPlaced([]); setMatchPicks([]); setMatchLeft(null);
  };

  const restart = () => {
    setRound(0); setSelected(null); setTyped(""); setVerdict(null); setAudioPlayed(false); setFinished(false); setScore(0); setSpin((v) => v + 1);
  };

  const insertKey = (text: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? typed.length;
    const end = el?.selectionEnd ?? typed.length;
    const value = normalizeIgboText(typed.slice(0, start) + text + typed.slice(end));
    setTyped(value);
    requestAnimationFrame(() => { el?.focus(); const pos = Math.min(value.length, start + 1); el?.setSelectionRange(pos, pos); });
  };

  const backLabel = isFree ? "Back to practise" : "Back to journey";
  const feedback = verdict === "correct" ? "Correct — well done."
    : verdict === "tones" ? "Almost. The letters are right, but check the tone marks."
    : isType ? "Not quite." : current.kind === "order" ? "Not quite - the words go in a different order." : "Not this time. The matching tile is highlighted.";

  return (
    <section ref={rootRef} className="rise-in mx-auto max-w-3xl scroll-mt-24" aria-labelledby="practice-title">
      {/* Always-visible top bar with a labelled way out */}
      <div className="sticky top-16 z-30 -mx-1 mb-4 flex items-center gap-3 rounded-md border border-border bg-card/95 px-2 py-2 shadow-sm backdrop-blur sm:top-20">
        <Button variant="ghost" onClick={exit} className="shrink-0"><ArrowLeft className="size-4" /> {backLabel}</Button>
        <div className="flex flex-1 gap-1" aria-label={`Question ${Math.min(round + 1, total)} of ${total}`}>
          {views.map((_, i) => <span key={i} className={`h-2 flex-1 rounded-full ${i < round || finished || (i === round && checked) ? "bg-primary" : i === round ? "bg-primary/40" : "bg-muted"}`} />)}
        </div>
        <span className="shrink-0 px-2 text-xs font-extrabold text-muted-foreground">{finished ? total : round + 1} / {total}</span>
      </div>

      {confirmExit && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-accent bg-accent/10 p-4" role="alertdialog" aria-label="Leave this session?">
          <p className="flex-1 text-sm font-bold">Leave now? Your place is saved — you’ll pick up from this question next time.</p>
          <Button variant="secondary" onClick={() => setConfirmExit(false)}>Keep going</Button>
          <Button onClick={onClose}><X className="size-4" /> Leave</Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {finished ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto grid size-20 place-items-center rounded-full bg-secondary text-primary"><Check className="size-10" strokeWidth={3} /></span>
            <h2 id="practice-title" className="mt-5 font-display text-3xl font-semibold">{isFree ? "Session complete" : "Round complete"}</h2>
            <p className="mt-2 text-lg font-bold">{score} of {total} correct</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{isFree ? "Nothing here moves your path — it just keeps the words warm." : "You worked through sound, context, response and typing."}</p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button variant="secondary" onClick={restart}><RotateCcw className="size-4" /> {isFree ? "Practise again" : "Play again"}</Button>
              <Button onClick={onClose}>{backLabel}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-7">
              <div className="flex-1">
                <div className="flex flex-wrap gap-2">
                  {/*
                  Only claim sample content when the rounds really are the demonstration set. These
                  words now come from the published dictionary, and labelling verified Central Igbo
                  as a placeholder is its own kind of wrong.
                */}
                {sample && <span className="rounded-sm bg-muted px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">Sample content</span>}
                  {heading && <span className="rounded-sm bg-secondary px-2 py-1 text-[10px] font-black uppercase text-secondary-foreground">{heading}</span>}
                </div>
                <h2 id="practice-title" className="mt-3 font-display text-2xl font-semibold sm:text-3xl">{current.prompt}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{current.hint}</p>
              </div>
              {(!isType || Boolean(clip)) && (
                <Button
                  variant="secondary"
                  disabled={!clip}
                  className={`shrink-0 gap-2 self-start sm:self-center ${audioPlayed ? "border-primary text-primary" : ""}`}
                  onClick={() => { playAudio(clip); setAudioPlayed(true); }}
                  aria-label={clip ? "Play the recording" : "No recording yet for this word"}
                >
                  <Volume2 className="size-5" /> {clip ? (audioPlayed ? "Play again" : "Listen") : "No audio"}
                </Button>
              )}
            </div>

            <div className="border-t border-border bg-muted/50 p-5 sm:p-7">
              {isType ? (
                <form onSubmit={(e) => { e.preventDefault(); if (checked) next(); else check(); }}>
                  {current.kind === "type" ? (
                    <p className="rounded-md border border-border bg-card p-4 text-base font-semibold leading-7">{current.meaning}</p>
                  ) : (
                    <p className="rounded-md border border-border bg-card p-4 text-base font-semibold leading-7">{current.prompt}</p>
                  )}
                  <label htmlFor="type-answer" className="mt-4 block text-xs font-extrabold uppercase text-muted-foreground">Type the Igbo</label>
                  <input
                    id="type-answer" ref={inputRef} value={typed} disabled={checked} autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} lang="ig"
                    onChange={(e) => setTyped(normalizeIgboText(e.target.value))}
                    className={`mt-1 min-h-14 w-full rounded-md border-2 bg-card px-4 text-xl font-semibold outline-none focus:border-primary ${verdict === "correct" ? "border-primary" : verdict ? "border-accent" : "border-input"}`}
                  />
                  {!checked && (
                    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Igbo letters and tone marks">
                      {specialKeys.map((k) => <button key={k.label} type="button" onClick={() => insertKey(k.insert)} className="min-h-10 min-w-10 rounded-sm border border-border bg-card px-2.5 text-sm font-bold hover:border-primary">{k.label}</button>)}
                    </div>
                  )}
                  {checked && verdict !== "correct" && <p className="mt-3 text-sm">Answer: <b className="text-lg">{current.answer}</b></p>}
                  <button type="submit" hidden />
                </form>
              ) : current.kind === "order" ? (
                /*
                 * The sentence being built, then the words still to place.
                 *
                 * Tapping a placed word sends it back, so a wrong start costs a tap rather than a restart -
                 * the whole exercise is about noticing order and correcting it.
                 */
                <div lang="ig">
                  <div className="min-h-14 rounded-md border-2 border-dashed border-border bg-card p-3">
                    {placed.length === 0
                      ? <p className="text-sm text-muted-foreground">Tap the words below in order.</p>
                      : <div className="flex flex-wrap gap-1.5">
                          {placed.map((word, k) => (
                            <button key={`${word}-${k}`} type="button" disabled={checked}
                              onClick={() => setPlaced((x) => x.filter((_, idx) => idx !== k))}
                              className="rounded-sm border border-border bg-secondary px-2.5 py-1.5 text-base font-semibold">{word}</button>
                          ))}
                        </div>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {current.tiles.map((word, k) => {
                      const used = placed.filter((x) => x === word).length >= current.tiles.filter((x) => x === word).length;
                      return (
                        <button key={`${word}-${k}`} type="button" disabled={checked || used}
                          onClick={() => setPlaced((x) => [...x, word])}
                          className={`rounded-sm border px-2.5 py-1.5 text-base font-semibold transition ${used ? "border-border bg-muted text-muted-foreground" : "border-border bg-card hover:border-primary"}`}>{word}</button>
                      );
                    })}
                  </div>
                  {current.meaning && checked && verdict === "wrong" && (
                    <p className="mt-3 text-sm text-muted-foreground">It means: {current.meaning}</p>
                  )}
                </div>
              ) : current.kind === "match" ? (
                <div>
                  <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                    <div className="space-y-2" lang="ig">
                      {current.pairs.map((pair, k) => {
                        const paired = matchPicks[k] != null;
                        return (
                          <button
                            key={pair.ig}
                            type="button"
                            disabled={checked || paired}
                            onClick={() => setMatchLeft(matchLeft === k ? null : k)}
                            className={"w-full rounded-md border-2 p-3 text-left text-base font-semibold transition " + (matchLeft === k ? "border-primary bg-secondary" : paired ? "border-primary/40 bg-muted" : "border-border bg-card hover:border-primary")}
                          >
                            {pair.ig}
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      {matchOrder.map((target) => {
                        const taken = matchPicks.includes(target);
                        return (
                          <button
                            key={target}
                            type="button"
                            disabled={checked || taken}
                            onClick={() => {
                              // Assign the waiting word to this meaning, then clear the selection.
                              if (matchLeft == null) return;
                              setMatchPicks((x) => x.map((v, k) => (k === matchLeft ? target : v)));
                              setMatchLeft(null);
                            }}
                            className={"w-full rounded-md border-2 p-3 text-left text-sm transition " + (taken ? "border-primary/40 bg-muted" : "border-border bg-card hover:border-primary")}
                          >
                            {current.pairs[target]?.en}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {matchPicks.filter((v) => v != null).length} of {current.pairs.length} matched.
                    {matchLeft != null && " Now tap the meaning on the right."}
                  </p>
                </div>
              ) : isChoice ? (
                <div className="grid grid-cols-2 gap-3">
                  {current.options.map((option, index) => {
                    const chosen = selected === index;
                    const right = checked && index === current.correct;
                    const wrong = checked && chosen && verdict === "wrong";
                    return (
                      <button key={`${option.label}-${index}`} type="button" disabled={checked} onClick={() => setSelected(index)} aria-pressed={chosen}
                        className={`flex min-h-24 items-center gap-3 rounded-md border-2 bg-card p-3 text-left transition ${chosen ? "border-primary" : "border-border hover:border-primary/50"} ${right ? "border-primary bg-secondary" : ""} ${wrong ? "border-accent bg-accent/10" : ""}`}>
                        <span className="text-3xl" aria-hidden="true">{option.icon}</span>
                        <span className="text-sm font-extrabold leading-5">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className={`mt-5 flex flex-col gap-3 sm:flex-row sm:items-center ${checked ? "rounded-md border p-3 " + (verdict === "correct" ? "border-primary bg-secondary" : "border-accent bg-accent/10") : ""}`}>
                {checked && <p className="flex-1 text-sm font-bold" role="status">{feedback}</p>}
                {!checked && <p className="hidden flex-1 text-xs text-muted-foreground sm:block">{isType ? <>Press <CornerDownLeft className="inline size-3" /> Enter to check · Esc to leave</> : "Esc to leave"}</p>}
                <Button className="sm:min-w-44" disabled={!checked && !canCheck} onClick={checked ? next : check}>
                  {checked ? (round === total - 1 ? "See results" : "Next") : "Check"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
