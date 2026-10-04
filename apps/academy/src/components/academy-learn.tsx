import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Circle, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CourseCard, Eyebrow } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { courses, cultures, masteryLevels, type Mastery, type Topic } from "@/data/academy";

export function MasteryTag({ level }: { level: Mastery }) {
  const i = masteryLevels.indexOf(level);
  return (
    <span className="mastery-tag" data-level={i} title={`Mastery: ${level}`}>
      <span className="mastery-steps" aria-hidden>{[1, 2, 3, 4].map((s) => <i key={s} className={s <= i ? "on" : ""} />)}</span>
      {level}
    </span>
  );
}

export function MasteryLegend() {
  return <div className="flex flex-wrap gap-3">{masteryLevels.map((m) => <MasteryTag key={m} level={m} />)}</div>;
}

export function Panel({ title, children, eyebrow }: { title: string; eyebrow?: string; children: ReactNode }) {
  return <section className="v2-panel">{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}<h2>{title}</h2>{children}</section>;
}

export function CultureLinks({ slugs }: { slugs: string[] }) {
  const list = cultures.filter((c) => slugs.includes(c.slug));
  if (!list.length) return <p className="empty-state">Culture profiles for this area are in preparation.</p>;
  return <div className="grid gap-4 md:grid-cols-3">{list.map((c) => <Link key={c.slug} to="/cultures/$slug" params={{ slug: c.slug }} className="atlas-card"><small>Culture / People</small><strong>{c.name}</strong><p>{c.summary}</p><ArrowRight /></Link>)}</div>;
}

export function CourseGrid({ slugs }: { slugs: string[] }) {
  const list = courses.filter((c) => slugs.includes(c.slug));
  if (!list.length) return <p className="empty-state">Courses for this area are in preparation. Explore related collections in the meantime.</p>;
  return <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{list.map((c) => <CourseCard key={c.slug} course={c} />)}</div>;
}

export function TopicBody({ topic, kind }: { topic: Topic; kind: string }) {
  return (
    <section className="section-pad"><div className="site-wrap grid gap-14">
      <div><Eyebrow>{kind}</Eyebrow><h2 className="mt-2 mb-6">Courses</h2><CourseGrid slugs={topic.courses} /></div>
      <div><Eyebrow>Peoples and cultures</Eyebrow><h2 className="mt-2 mb-6">Culture profiles</h2><CultureLinks slugs={topic.cultures ?? []} /></div>
      <div className="flex flex-wrap gap-3"><Button asChild variant="outline"><Link to="/timeline">Open the timeline</Link></Button><Button asChild variant="outline"><Link to="/map">Open the map</Link></Button><Button asChild variant="outline"><Link to="/sources/$slug" params={{ slug: "igbo-ukwu-roped-pot" }}>View a source</Link></Button></div>
    </div></section>
  );
}

export type Question = { prompt: string; kind: string; options: string[]; answer: number; hint: string; concept: string };
export const sampleQuestions: Question[] = [
  { kind: "Source interpretation", prompt: "The Igbo-Ukwu bronzes were made using the lost-wax method. What does this most reasonably suggest?", options: ["Specialist metalworkers with advanced technical knowledge", "The objects were imported from Europe", "Bronze was common household material", "The site dates from the 19th century"], answer: 0, hint: "Consider what the technique requires of the maker.", concept: "Archaeological interpretation" },
  { kind: "Chronology", prompt: "Which came first?", options: ["The 1897 Benin expedition", "Igbo-Ukwu bronze casting", "Suppression of Nri ritual journeys", "Oba Ewuare's expansion"], answer: 1, hint: "Look for the earliest radiocarbon-dated event on the timeline.", concept: "Dating Igbo-Ukwu" },
  { kind: "Compare and contrast", prompt: "Nri authority differed from Benin kingship chiefly because it was…", options: ["Ritual and moral rather than military", "Hereditary through women", "Imposed by colonial rule", "Limited to trade"], answer: 0, hint: "Think about how Eze Nri exercised influence beyond Nri itself.", concept: "Nri political organisation" },
];

export function Quiz({ questions = sampleQuestions, title, mode }: { questions?: Question[]; title: string; mode: "practice" | "diagnostic" | "challenge" }) {
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [hint, setHint] = useState(false);
  const [score, setScore] = useState<boolean[]>([]);
  const done = score.length === questions.length;
  if (done) {
    const right = score.filter(Boolean).length;
    const missed = questions.filter((_, k) => !score[k]);
    return (
      <div className="assessment-card">
        <Eyebrow>{mode === "diagnostic" ? "Diagnostic result" : "Result"}</Eyebrow>
        <h2 className="mt-2">{right} of {questions.length} correct</h2>
        <p className="mt-3 text-muted-foreground">{mode === "diagnostic" ? (right >= 2 ? "Recommended start: Unit 2 · Voices and Records." : "Recommended start: Unit 1 · Early Igbo Civilisation.") : missed.length ? "Review this before moving on:" : "Every concept in this set is now at Proficient or above."}</p>
        {missed.length > 0 && mode !== "diagnostic" && <ul className="mt-4 grid gap-2">{missed.map((q) => <li key={q.prompt} className="saved-row"><Circle /><div><strong>{q.concept}</strong><p>{q.kind}</p></div><Button asChild size="sm" variant="outline"><Link to="/concepts/$slug" params={{ slug: "archaeological-interpretation" }}>Review this</Link></Button></li>)}</ul>}
        <div className="mt-6 flex flex-wrap gap-3"><Button asChild><Link to="/units/$slug" params={{ slug: "early-igbo-civilisation" }}>{mode === "diagnostic" ? "Begin recommended unit" : "Continue studying"}</Link></Button><Button variant="outline" onClick={() => { setI(0); setScore([]); setPick(null); setChecked(false); }}>Try again</Button></div>
      </div>
    );
  }
  const q = questions[i]!;
  const correct = pick === q.answer;
  return (
    <div className="assessment-card">
      <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-caps text-muted-foreground"><span>{title}</span><span>Question {i + 1} of {questions.length}</span></div>
      <p className="mt-6 text-xs font-bold uppercase tracking-caps text-primary">{q.kind}</p>
      <h2 className="mt-2 text-2xl">{q.prompt}</h2>
      <div className="mt-6 grid gap-3" role="radiogroup">{q.options.map((o, k) => (
        <label key={o} className={`answer-option ${pick === k ? "selected" : ""}`}><input type="radio" name={`q${i}`} checked={pick === k} disabled={checked} onChange={() => setPick(k)} /><span className="font-bold">{String.fromCharCode(65 + k)}</span><p>{o}</p></label>
      ))}</div>
      {hint && !checked && <p className="note-box mt-5">Hint: {q.hint}</p>}
      {checked && <p className={`note-box mt-5 flex gap-2 ${correct ? "" : "text-destructive"}`}>{correct ? <CheckCircle2 /> : <XCircle />}{correct ? "Correct. This strengthens your mastery of " + q.concept + "." : "Not quite. " + q.hint}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        {!checked ? <><Button disabled={pick === null} onClick={() => setChecked(true)}>Check answer</Button>{mode !== "challenge" && <Button variant="outline" onClick={() => setHint(true)}>Show a hint</Button>}</>
          : <Button onClick={() => { setScore([...score, correct]); setI(i + 1); setPick(null); setChecked(false); setHint(false); }}>{i + 1 === questions.length ? "See result" : "Next question"}</Button>}
      </div>
    </div>
  );
}
