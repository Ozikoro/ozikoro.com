import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Circle, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CourseCard, Eyebrow } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { concepts, courses, cultures, masteryLevels, type Mastery, type Topic } from "@/data/academy";
import { submitAttempt } from "@/backend/functions";

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

/**
 * Turn a question's concept label into the slug of the concept it belongs to.
 *
 * The questions name their concept in prose ("Dating Igbo-Ukwu") and the routes are keyed by slug
 * ("chronology-igbo-ukwu"). Every "Review this" link used to point at the same hardcoded slug
 * regardless of which concept the learner actually missed, so a missed question about Nri sent them
 * to a page about archaeology. Matching on the title is what makes the link mean something.
 */
export function conceptSlug(title: string): string | null {
  const match = concepts.find((c) => c.title.toLowerCase() === title.trim().toLowerCase());
  return match?.slug ?? null;
}
export const sampleQuestions: Question[] = [
  { kind: "Source interpretation", prompt: "The Igbo-Ukwu bronzes were made using the lost-wax method. What does this most reasonably suggest?", options: ["Specialist metalworkers with advanced technical knowledge", "The objects were imported from Europe", "Bronze was common household material", "The site dates from the 19th century"], answer: 0, hint: "Consider what the technique requires of the maker.", concept: "Archaeological interpretation" },
  { kind: "Chronology", prompt: "Which came first?", options: ["The 1897 Benin expedition", "Igbo-Ukwu bronze casting", "Suppression of Nri ritual journeys", "Oba Ewuare's expansion"], answer: 1, hint: "Look for the earliest radiocarbon-dated event on the timeline.", concept: "Dating Igbo-Ukwu" },
  { kind: "Compare and contrast", prompt: "Nri authority differed from Benin kingship chiefly because it was…", options: ["Ritual and moral rather than military", "Hereditary through women", "Imposed by colonial rule", "Limited to trade"], answer: 0, hint: "Think about how Eze Nri exercised influence beyond Nri itself.", concept: "Nri political organisation" },
];

/**
 * A question set that records what happened.
 *
 * IT USED TO KEEP THE SCORE IN COMPONENT STATE AND NOTHING ELSE, so a result vanished the moment the
 * learner navigated or reloaded — and "results update concept mastery" (the spec's own words on the
 * challenge page) described something that did not happen anywhere. It now writes the attempt, with
 * a per-concept breakdown, so mastery can be computed from evidence rather than asserted.
 *
 * The per-concept detail is the reason the score alone was not enough: an aggregate of 3/5 says
 * nothing about WHICH concept a learner should revisit, and the whole useful output of an assessment
 * is that answer.
 */
export function Quiz({
  questions = sampleQuestions,
  title,
  mode,
  courseSlug,
  activitySlug,
}: {
  questions?: Question[];
  title: string;
  mode: "practice" | "diagnostic" | "challenge" | "assessment";
  courseSlug: string;
  activitySlug?: string;
}) {
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [hint, setHint] = useState(false);
  const [score, setScore] = useState<boolean[]>([]);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "signed-out" | "error">("idle");
  const done = score.length === questions.length;

  // A ref rather than the `save` state as the guard: the effect must not re-fire when the state it
  // sets causes a re-render, or one attempt would be recorded several times.
  const recorded = useRef(false);

  useEffect(() => {
    if (!done || recorded.current) return;
    recorded.current = true;

    const correct = score.filter(Boolean).length;
    const concepts = questions.map((q, k) => ({
      concept: q.concept,
      slug: conceptSlug(q.concept),
      kind: q.kind,
      correct: Boolean(score[k]),
    }));

    setSave("saving");
    submitAttempt({
      data: {
        courseSlug,
        activitySlug: activitySlug ?? `${mode}-${courseSlug}`,
        kind: mode,
        score: correct,
        maxScore: questions.length,
        // Stored as evidence, not as a display value: mastery is derived from this, and a score with
        // no per-concept detail cannot say which concept to revisit.
        answers: { concepts },
      },
    })
      .then((result) => {
        if (result.ok) setSave("saved");
        else setSave(result.code === "not_signed_in" ? "signed-out" : "error");
      })
      .catch(() => setSave("error"));
  }, [done, score, questions, courseSlug, activitySlug, mode]);

  if (done) {
    const right = score.filter(Boolean).length;
    const missed = questions.filter((_, k) => !score[k]);
    return (
      <div className="assessment-card">
        <Eyebrow>{mode === "diagnostic" ? "Diagnostic result" : "Result"}</Eyebrow>
        <h2 className="mt-2">{right} of {questions.length} correct</h2>
        <p className="mt-3 text-muted-foreground">
          {mode === "diagnostic"
            ? right >= 2
              ? "Recommended start: Unit 2 · Voices and Records."
              : "Recommended start: Unit 1 · Early Igbo Civilisation."
            : missed.length
              ? "Review this before moving on:"
              : "Every concept in this set is now at Proficient or above."}
        </p>

        {/* The learner is told what happened to their result. Silently discarding it — or silently
            saving it — is how somebody comes to distrust the progress page. */}
        <p className="mt-3 text-xs font-semibold">
          {save === "saving" && <span className="text-muted-foreground">Saving your result…</span>}
          {save === "saved" && <span className="text-primary">Saved to your learning record.</span>}
          {save === "signed-out" && (
            <span className="text-muted-foreground">
              <Link to="/account" className="text-primary underline">Sign in</Link> to save this result
              and track mastery.
            </span>
          )}
          {save === "error" && (
            <span className="text-destructive">Could not save that result. Your answers are still
              shown above.</span>
          )}
        </p>

        {missed.length > 0 && mode !== "diagnostic" && (
          <ul className="mt-4 grid gap-2">
            {missed.map((q) => {
              const slug = conceptSlug(q.concept);
              return (
                <li key={q.prompt} className="saved-row">
                  <Circle />
                  <div>
                    <strong>{q.concept}</strong>
                    <p>{q.kind}</p>
                  </div>
                  {slug ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/concepts/$slug" params={{ slug }}>Review this</Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/mastery">Open mastery</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/units/$slug" params={{ slug: "early-igbo-civilisation" }}>
              {mode === "diagnostic" ? "Begin recommended unit" : "Continue studying"}
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              // Reset the record guard too, or a second run of the same set would not be saved —
              // which is exactly the "try again, then wonder why nothing changed" bug.
              recorded.current = false;
              setI(0);
              setScore([]);
              setPick(null);
              setChecked(false);
              setSave("idle");
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const q = questions[i]!;
  const correct = pick === q.answer;
  return (
    <div className="assessment-card">
      <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-caps text-muted-foreground">
        <span>{title}</span>
        <span>Question {i + 1} of {questions.length}</span>
      </div>
      <p className="mt-6 text-xs font-bold uppercase tracking-caps text-primary">{q.kind}</p>
      <h2 className="mt-2 text-2xl">{q.prompt}</h2>
      <div className="mt-6 grid gap-3" role="radiogroup">
        {q.options.map((o, k) => (
          <label key={o} className={`answer-option ${pick === k ? "selected" : ""}`}>
            <input
              type="radio"
              name={`q${i}`}
              checked={pick === k}
              disabled={checked}
              onChange={() => setPick(k)}
            />
            <span className="font-bold">{String.fromCharCode(65 + k)}</span>
            <p>{o}</p>
          </label>
        ))}
      </div>
      {hint && !checked && <p className="note-box mt-5">Hint: {q.hint}</p>}
      {checked && (
        <p className={`note-box mt-5 flex gap-2 ${correct ? "" : "text-destructive"}`}>
          {correct ? <CheckCircle2 /> : <XCircle />}
          {correct
            ? "Correct. This strengthens your mastery of " + q.concept + "."
            : "Not quite. " + q.hint}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        {!checked ? (
          <>
            <Button disabled={pick === null} onClick={() => setChecked(true)}>Check answer</Button>
            {mode !== "challenge" && (
              <Button variant="outline" onClick={() => setHint(true)}>Show a hint</Button>
            )}
          </>
        ) : (
          <Button
            onClick={() => {
              setScore([...score, correct]);
              setI(i + 1);
              setPick(null);
              setChecked(false);
              setHint(false);
            }}
          >
            {i + 1 === questions.length ? "See result" : "Next question"}
          </Button>
        )}
      </div>
    </div>
  );
}
