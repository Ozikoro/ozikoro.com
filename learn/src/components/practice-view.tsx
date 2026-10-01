import { ArrowRight, Check, Clock, Flame, Layers, Shuffle } from "lucide-react";
import { ReviewView } from "@/components/review-view";
import { useState } from "react";
import { Button } from "@/components/button";
import { PracticeGame } from "@/components/practice-game";
import { mixedRounds, practiceFocuses, type PracticeRound } from "@/lib/practice-data";
import { useLexemePractice } from "@/lib/use-lexeme-practice";
import { useStickyState } from "@/lib/use-sticky-state";

type Session = { title: string; rounds: readonly PracticeRound[] };

export function PracticeView() {
  /*
   * `lastSession` is REMEMBERED, not reopened.
   *
   * This was `sessionTitle`, and because it persisted, picking a focus once meant every later visit
   * dropped straight back into that same drill without being asked. The learner never reached the
   * picker again, so the choice appeared to have been taken away from them.
   *
   * The stored value is now only used to OFFER a resume. Which session is actually running is
   * `running`, plain state, so a fresh visit always starts at the picker.
   */
  const [lastSession, setLastSession] = useStickyState<string | null>("practise:last", null);
  const [running, setRunning] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [history, setHistory] = useStickyState<string[]>("practise:history", []);

  /*
   * The real words, from the published dictionary.
   *
   * `practice-data.ts` holds invented words marked PLACEHOLDER. Where the dictionary can supply
   * rounds, they win — those are Central Igbo entries a linguist has approved, with the meanings the
   * dictionary gives them. The demo set is used only while this is loading or if the database
   * returns nothing, so a learner never sees invented Igbo presented as real.
   */
  const live = useLexemePractice(24);

  const buildSession = (title: string | null): Session | null => {
    if (!title) return null;
    if (title === "Mixed run") {
      return { title: "Mixed run", rounds: live.rounds.length > 0 ? live.rounds : mixedRounds };
    }
    const f = practiceFocuses.find((x) => x.name === title);
    return f ? { title: f.name, rounds: f.rounds } : null;
  };

  const session = buildSession(running);

  // Starting a session is what REMEMBERS it — not the other way round.
  const start = (title: string) => {
    setLastSession(title);
    setAsked(false);
    setRunning(title);
  };
  const stop = () => setRunning(null);

  const finish = (title: string) => setHistory((items) => [title, ...items.filter((item) => item !== title)].slice(0, 3));

  if (session) {
    return <PracticeGame rounds={session.rounds} mode="free" heading={session.title} storageKey={`practise:${session.title}`} sample={!live.fromDictionary} onClose={stop} onComplete={() => finish(session.title)} />;
  }

  /*
   * The resume prompt.
   *
   * Shown only when there IS a previous session and the learner has not answered yet. Two explicit
   * buttons rather than a silent resume: "where you stopped" and "a new one" are different
   * intentions, and only the learner knows which they have.
   */
  const offerResume = lastSession !== null && !asked && buildSession(lastSession) !== null;

  return (
    <div className="rise-in">
      {offerResume && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-primary/30 bg-card p-5">
          <div>
            <p className="text-xs font-extrabold uppercase text-muted-foreground">Pick up where you stopped</p>
            <p className="mt-1 font-display text-xl font-semibold">Continue “{lastSession}”?</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => start(lastSession!)}>Continue</Button>
            <Button variant="secondary" onClick={() => { setAsked(true); setLastSession(null); }}>Start a new one</Button>
          </div>
        </div>
      )}
      <section className="overflow-hidden rounded-lg bg-ink text-primary-foreground shadow-lg">
        <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="mb-2 text-xs font-extrabold uppercase text-primary-foreground/60">Practise · your choice</p>
            <h1 className="font-display text-4xl font-semibold sm:text-5xl">Sharpen the ears.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-primary-foreground/75">
              Short sessions you pick yourself, any time. These drills sit apart from your lessons — finishing one never
              unlocks a unit, it just keeps the sounds warm.
              Free to use without an account — signing in only saves your history.
              No account is needed to practise, and nothing here is saved until you sign in.
            </p>
          </div>
          <Button
            className="border-b-4 border-highlight bg-highlight text-highlight-foreground hover:bg-highlight/90 active:translate-y-0.5 active:border-b-2"
            onClick={() => start("Mixed run")}
          >
            <Shuffle className="size-4" /> Mixed run <ArrowRight className="size-4" />
          </Button>
        </div>
      </section>

      <div className="mt-7 grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/*
          The spaced-repetition queue, above the drills.

          It sits first because it is the only part of this page that is TIME-SENSITIVE: the drills
          can be done any time, but a review scheduled for today is most effective today. `srs.ts`
          decides which words and when; this renders whatever it returns.
        */}
        <section aria-labelledby="review-heading" className="mt-8">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase text-muted-foreground">Due today</p>
            <h2 id="review-heading" className="mt-1 font-display text-2xl font-semibold">Review</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Words you have already met, shown again just before you would forget them. Each
              answer sets when you see that word next: <strong>Again</strong> brings it back shortly,
              <strong>Easy</strong> pushes it further away. Answer honestly — a word you guess at now
              is one you will be shown again soon anyway.
            </p>
          </div>
          <ReviewView />
        </section>

        <section aria-labelledby="focus-heading">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase text-muted-foreground">Warm-ups · pick one</p>
            <h2 id="focus-heading" className="mt-1 font-display text-2xl font-semibold">Five ways to warm up</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {practiceFocuses.map(({ id, name, detail, minutes, icon: Icon, rounds }) => {
              const played = history.includes(name);
              return (
                <article key={id} className="flex flex-col justify-between rounded-md border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid size-11 place-items-center rounded-md bg-secondary text-secondary-foreground"><Icon className="size-5" /></div>
                      {played ? <span className="inline-flex items-center gap-1 rounded-sm bg-secondary px-2 py-1 text-[10px] font-black uppercase text-secondary-foreground"><Check className="size-3" /> Done today</span> : null}
                    </div>
                    <h3 className="mt-4 font-display text-xl font-semibold">{name}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground"><Clock className="size-3.5" /> {rounds.length} activities · ~{minutes} min</span>
                    <Button className="min-h-10 bg-highlight px-5 font-bold text-highlight-foreground hover:bg-highlight/90" onClick={() => start(name)}>
                      {played ? "Again" : "Start"}
                      Start
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          {/*
              The focus cards above are demonstration groupings, but the ROUNDS they start come from
              the published dictionary. So this note is shown only while the demo rounds are in use —
              it used to appear permanently, which labelled verified Central Igbo as unverified.
            */}
            {!live.fromDictionary && <p className="mt-4 inline-flex rounded-sm bg-muted px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">Placeholder content — sample lines, not verified teaching material</p>}
        </section>

        <aside className="space-y-5 xl:sticky xl:top-26">
          <section className="rounded-md border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2"><Flame className="size-4 text-highlight" fill="currentColor" /><h2 className="text-sm font-extrabold uppercase">This week</h2></div>
            <p className="mt-3 font-display text-3xl font-semibold">{history.length ? history.length : 0} <span className="text-base font-bold text-muted-foreground">sessions practised</span></p>
            <ul className="mt-4 space-y-2 text-sm">
              {history.length ? history.map((item) => <li key={item} className="flex items-center gap-2 font-bold"><Check className="size-4 text-primary" /> {item}</li>) : <li className="text-muted-foreground">Nothing yet — pick a focus and run one.</li>}
            </ul>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-highlight" style={{ width: `${Math.min(100, history.length * 20)}%` }} /></div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">{history.length} of 5 sessions on your goal</p>
          </section>

          <section className="rounded-md border border-border bg-secondary p-5">
            <div className="flex items-start gap-3"><Layers className="mt-0.5 size-5 text-highlight-foreground" /><div><p className="text-xs font-extrabold uppercase text-muted-foreground">How this differs</p><h2 className="mt-1 font-display text-xl font-semibold">Drills, not lessons</h2></div></div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Lessons move you along the path and are marked done. Practise sessions repeat forever, in no particular order, and reshuffle the tiles each time.</p>
          </section>

          <section className="rounded-md border border-border bg-card p-5">
            <h2 className="text-sm font-extrabold uppercase">Sound promise</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Audio samples and tile labels are placeholders until recorded, reviewed material is connected. Nothing here is presented as verified.</p>
          </section>
        </aside>
      </div>

    </div>
  );
}
