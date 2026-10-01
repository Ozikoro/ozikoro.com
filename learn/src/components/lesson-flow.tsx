import { ArrowLeft, ArrowRight, Check, MessagesSquare, Puzzle, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import type { Lesson } from "@/lib/lesson-data";
import { playAudio, useCardAudio } from "@/lib/use-card-audio";
import { useStickyState } from "@/lib/use-sticky-state";

type Stage = "cards" | "story" | "match" | "done";
const stages: { id: Stage; label: string; icon: typeof Sparkles }[] = [
  { id: "cards", label: "Learn", icon: Sparkles },
  { id: "story", label: "Chat", icon: MessagesSquare },
  { id: "match", label: "Match", icon: Puzzle },
];

export function LessonFlow({ lesson, onClose, onComplete, onNext, sample = false }: { lesson: Lesson; onClose: () => void; onComplete: () => void; onNext?: (() => void) | undefined; sample?: boolean }) {
  const k = `lesson:${lesson.id}`;
  const [stage, setStage] = useStickyState<Stage>(`${k}:stage`, "cards");
  const [card, setCard] = useStickyState(`${k}:card`, 0);
  const [turn, setTurn] = useStickyState(`${k}:turn`, 0);
  const [matched, setMatched] = useStickyState<string[]>(`${k}:matched`, []);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); }, [stage]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stageIndex = stages.findIndex((s) => s.id === stage);
  const restart = () => { setStage("cards"); setCard(0); setTurn(0); setMatched([]); };

  return (
    <section className="rise-in mx-auto max-w-3xl" aria-labelledby="lesson-title">
      <div className="sticky top-16 z-30 mb-4 flex items-center gap-3 rounded-md border border-border bg-card/95 px-2 py-2 shadow-sm backdrop-blur sm:top-20">
        <Button variant="ghost" onClick={onClose} className="shrink-0"><ArrowLeft className="size-4" /> Back to journey</Button>
        <ol className="flex flex-1 items-center gap-1.5">
          {stages.map(({ id, label, icon: Icon }, i) => {
            const done = stage === "done" || i < stageIndex;
            return (
              <li key={id} className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-extrabold ${done ? "bg-primary text-primary-foreground" : i === stageIndex ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
                {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}<span className="hidden sm:inline">{label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/*
        The label is conditional now. These lessons come from `course_lessons`, built from published
        Central Igbo dictionary entries — calling those "Placeholder content" was telling learners
        that verified material was invented. It still shows for the demo course, which is what the
        label was for.
      */}
      <p className="mb-1 text-xs font-extrabold uppercase text-primary">{lesson.unit}{sample ? " · Placeholder content" : ""}</p>
      <h1 id="lesson-title" className="mb-5 font-display text-3xl font-semibold">{lesson.title}</h1>
      {stage !== "done" && <p className="-mt-3 mb-5 text-sm text-muted-foreground">{lesson.objective}</p>}

      {stage === "cards" && <Cards lesson={lesson} index={card} setIndex={setCard} onDone={() => setStage("story")} />}
      {stage === "story" && <Story lesson={lesson} turn={turn} setTurn={setTurn} onDone={() => setStage("match")} />}
      {stage === "match" && <Match lesson={lesson} matched={matched} setMatched={setMatched} onDone={() => { setStage("done"); onComplete(); }} />}
      {stage === "done" && (
        <div className="rounded-lg border border-border bg-card px-6 py-12 text-center shadow-sm">
          <span className="mx-auto grid size-20 place-items-center rounded-full bg-secondary text-primary"><Check className="size-10" strokeWidth={3} /></span>
          <h2 className="mt-5 font-display text-3xl font-semibold">Lesson complete</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">You learned {lesson.cards.length} phrases, used them in a chat, and matched them all.</p>
          <div className="mx-auto mt-6 max-w-md rounded-md border border-highlight bg-highlight/15 p-4 text-left"><p className="text-xs font-extrabold uppercase text-highlight-foreground">Culture note</p><p className="mt-1 text-sm leading-6">{lesson.cultureNote}</p></div>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button variant="secondary" onClick={restart}><RotateCcw className="size-4" /> Do it again</Button>
            {onNext ? <Button onClick={() => { restart(); onNext(); }}>Next lesson <ArrowRight className="size-4" /></Button> : <Button onClick={() => { restart(); onClose(); }}>Back to journey</Button>}
          </div>
        </div>
      )}
    </section>
  );
}

function Cards({ lesson, index, setIndex, onDone }: { lesson: Lesson; index: number; setIndex: (n: number) => void; onDone: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const w = lesson.cards[Math.min(index, lesson.cards.length - 1)];
  /*
   * Real recordings for this lesson's words, fetched once for the whole set rather than per card.
   *
   * The Listen button below used to carry `aria-label="Play placeholder audio"` and had no handler
   * at all — it did nothing. It now plays the dictionary's own recording of the word, falling back
   * to a recorded example sentence for the many words that have no word-level audio.
   */
  const { audio } = useCardAudio(lesson.cards.map((c) => c.igbo));
  if (!w) return null;
  const last = index >= lesson.cards.length - 1;
  const clip = audio[w.igbo];
  return (
    <div>
      <p className="mb-3 text-sm font-bold text-muted-foreground">Card {index + 1} of {lesson.cards.length} · tap the card to see the meaning</p>
      <button key={w.id} onClick={() => setFlipped((f) => !f)} className="rise-in flex min-h-72 w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-b-8 border-border bg-card p-8 text-center shadow-sm transition hover:border-primary">
        <span className="text-6xl" aria-hidden>{w.icon}</span>
        {flipped ? (
          <><p className="font-display text-2xl font-semibold">{w.meaning}</p><p className="max-w-sm text-sm text-muted-foreground">{w.note}</p></>
        ) : (
          <p className="font-display text-3xl font-semibold" lang="ig">{w.igbo}</p>
        )}
      </button>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Button variant="secondary" disabled={index === 0} onClick={() => { setFlipped(false); setIndex(index - 1); }}><ArrowLeft className="size-4" /> Previous</Button>
            /*
             * The recording is the most important control on a word card.
             *
             * It was `variant="ghost"` with the label "Listen" — the same visual weight as Back,
             * wedged between two navigation buttons. A learner scanning the card saw Back / Listen /
             * Next and read the middle one as navigation too. It now carries the word in its own
             * label, uses the primary colour, and is the widest control on the row, because hearing
             * the word is the thing this card exists to do.
             */
            <Button
              className={clip ? "min-h-12 flex-1 bg-highlight text-highlight-foreground hover:bg-highlight/90" : "min-h-12 flex-1"}
              disabled={!clip}
              onClick={() => playAudio(clip)}
              aria-label={clip ? `Play the recording of ${w.igbo}` : `No recording yet for ${w.igbo}`}
            >
              <Volume2 className="size-5" /> {clip ? `Hear “${w.igbo}”` : "No recording yet"}
            </Button>
        <Button onClick={() => { setFlipped(false); if (last) onDone(); else setIndex(index + 1); }}>{last ? "Start the chat" : "Next"} <ArrowRight className="size-4" /></Button>
      </div>
    </div>
  );
}

function Story({ lesson, turn, setTurn, onDone }: { lesson: Lesson; turn: number; setTurn: (n: number) => void; onDone: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  // Show all turns up to the current reply point.
  let upto = turn;
  while (lesson.story[upto]?.speaker === "them") upto++;
  const visible = lesson.story.slice(0, upto);
  const ask = lesson.story[upto];
  const finished = !ask;

  const choose = (i: number) => {
    if (!ask || ask.speaker !== "you" || picked !== null) return;
    setPicked(i);
    if (i === ask.correct) setTimeout(() => { setPicked(null); setTurn(upto + 1); }, 900);
  };

  return (
    <div>
      <p className="mb-3 text-sm font-bold text-muted-foreground">Scene: {lesson.scene}</p>
      <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4 sm:p-6">
        {visible.map((t, i) => t.speaker === "them" ? (
          <div key={i} className="rise-in flex items-end gap-2">
            <span className="grid size-10 place-items-center rounded-full bg-card text-2xl" aria-hidden>{t.avatar}</span>
            <div className="max-w-[75%] rounded-lg rounded-bl-none bg-card px-4 py-3 shadow-sm"><p className="font-bold" lang="ig">{t.line}</p><p className="text-xs text-muted-foreground">{t.meaning}</p></div>
          </div>
        ) : (
          <div key={i} className="rise-in flex justify-end">
            <div className="max-w-[75%] rounded-lg rounded-br-none bg-primary px-4 py-3 text-primary-foreground shadow-sm"><p className="font-bold" lang="ig">{t.options[t.correct]?.text}</p></div>
          </div>
        ))}
      </div>
      {ask && ask.speaker === "you" && (
        <div className="mt-4">
          <p className="mb-2 font-display text-xl font-semibold">{ask.prompt}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {ask.options.map((o, i) => {
              const state = picked === null ? "" : i === ask.correct && picked === i ? "border-primary bg-secondary" : picked === i ? "border-accent bg-accent/10" : "";
              return <button key={i} onClick={() => choose(i)} className={`rounded-md border-2 border-b-4 border-border bg-card p-3 text-left transition hover:border-primary ${state}`}><span className="block font-bold" lang="ig">{o.text}</span>{picked !== null && <span className="text-xs text-muted-foreground">{o.meaning}</span>}</button>;
            })}
          </div>
          {picked !== null && picked !== ask.correct && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-accent/10 p-3 text-sm"><span>Not quite — {ask.why}</span><Button variant="secondary" onClick={() => setPicked(null)}>Try again</Button></div>
          )}
        </div>
      )}
      {finished && <div className="mt-4 flex justify-end"><Button onClick={onDone}>Play matching pairs <ArrowRight className="size-4" /></Button></div>}
    </div>
  );
}

function Match({ lesson, matched, setMatched, onDone }: { lesson: Lesson; matched: string[]; setMatched: (v: string[]) => void; onDone: () => void }) {
  const [left, setLeft] = useState<string | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const right = useMemo(() => [...lesson.cards].sort((a, b) => a.meaning.localeCompare(b.meaning)), [lesson]);
  const all = matched.length === lesson.cards.length;

  const pickRight = (id: string) => {
    if (!left) return;
    if (id === left) { setMatched([...matched, id]); setLeft(null); }
    else { setMiss(id); setTimeout(() => setMiss(null), 600); }
  };
  const tile = "min-h-16 rounded-md border-2 border-b-4 p-3 text-left font-bold transition disabled:opacity-40";

  return (
    <div>
      <p className="mb-3 text-sm font-bold text-muted-foreground">Tap an Igbo phrase, then its meaning. {matched.length} of {lesson.cards.length} matched.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-3">
          {lesson.cards.map((w) => <button key={w.id} disabled={matched.includes(w.id)} onClick={() => setLeft(w.id)} className={`${tile} w-full bg-card ${left === w.id ? "border-primary bg-secondary" : "border-border hover:border-primary"}`} lang="ig">{w.icon} {w.igbo}</button>)}
        </div>
        <div className="space-y-3">
          {right.map((w) => <button key={w.id} disabled={matched.includes(w.id)} onClick={() => pickRight(w.id)} className={`${tile} w-full bg-card ${miss === w.id ? "border-accent bg-accent/10" : "border-border hover:border-primary"}`}>{w.meaning}</button>)}
        </div>
      </div>
      {all && <div className="mt-5 flex justify-end"><Button onClick={onDone}>Finish lesson <Check className="size-4" /></Button></div>}
    </div>
  );
}
