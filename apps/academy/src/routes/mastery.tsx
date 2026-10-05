import { createFileRoute, Link } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro } from "@/components/academy-ui";
import { MasteryLegend, MasteryTag } from "@/components/academy-learn";
import { Button } from "@/components/ui/button";
import { concepts } from "@/data/academy";
import { myMastery } from "@/backend/functions";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/mastery")({
  head: () => meta("Mastery", "Your understanding of each concept and skill, from Not started to Mastered."),
  // The learner's own state, resolved on the server so the page renders once and correct.
  loader: async () => myMastery(),
  component: Page,
});

/**
 * MASTERY IS NOW COMPUTED, NOT ASSERTED.
 *
 * Every concept used to carry a hardcoded label in `src/data/academy.ts`, so the dashboard showed the
 * same five states to everybody — including a brand-new visitor who had answered nothing, and for
 * whom "Mastered" on lexical tone was simply false. The levels now come from the learner's recorded
 * attempts, and each row says how many answers produced the state, because a badge with no evidence
 * behind it is a claim rather than a record.
 */
function Page() {
  const mastery = Route.useLoaderData();

  const levelOf = (slug: string, fallback: string) =>
    mastery.concepts[slug]?.level ?? (mastery.signedIn ? "Not started" : (fallback as never));

  const review = concepts.filter((c) => {
    const level = levelOf(c.slug, c.mastery);
    return level === "Attempted" || level === "Familiar";
  });

  const answered = Object.keys(mastery.concepts).length;

  return (
    <AcademyShell>
      <PageIntro
        eyebrow="Mastery dashboard"
        title="What you understand, and what to review."
        description="Mastery belongs to concepts and skills — it reflects demonstrated understanding, not time spent."
      />
      <section className="section-pad">
        <div className="site-wrap grid gap-10 lg:grid-cols-[1fr_20rem]">
          <div>
            <MasteryLegend />

            {!mastery.signedIn && (
              <p className="note-box mt-6">
                You are not signed in, so every concept reads <strong>Not started</strong>.{" "}
                <Link to="/account" className="text-primary underline">Sign in</Link> to see mastery
                earned from your own answers — or take a{" "}
                <Link to="/diagnostic/igbo-language-foundations" className="text-primary underline">
                  diagnostic
                </Link>{" "}
                to begin.
              </p>
            )}

            {mastery.signedIn && answered === 0 && (
              <p className="note-box mt-6">
                You have not answered any questions yet, so there is nothing to measure. Practice,
                assessment and challenge results all count towards mastery.
              </p>
            )}

            <ul className="mt-8 border-t border-border">
              {concepts.map((c) => {
                const level = levelOf(c.slug, c.mastery);
                const record = mastery.concepts[c.slug]?.record ?? null;
                return (
                  <li key={c.slug} className="syllabus-row">
                    <span />
                    <strong>
                      <Link to="/concepts/$slug" params={{ slug: c.slug }}>{c.title}</Link>
                      <small className="block font-normal text-muted-foreground">
                        {c.skill}
                        {record
                          ? ` · ${record.correct} of ${record.attempts} correct`
                          : mastery.signedIn
                            ? " · no answers yet"
                            : ""}
                      </small>
                    </strong>
                    <MasteryTag level={level} />
                  </li>
                );
              })}
            </ul>
          </div>

          <aside className="details-aside">
            <h3>Review this</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Periodic review strengthens what you have studied.
            </p>
            {review.length > 0 ? (
              <ul className="mt-4 grid gap-3">
                {review.map((c) => (
                  <li key={c.slug}>
                    <Link className="font-semibold" to="/concepts/$slug" params={{ slug: c.slug }}>
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Nothing is waiting for review. Concepts appear here once you have answered questions
                about them and not yet mastered them.
              </p>
            )}

            <Eyebrow>Practise</Eyebrow>
            <Button asChild variant="outline" className="w-full">
              <Link to="/practice/igbo-language-foundations">Practise a set</Link>
            </Button>

            <Eyebrow>Records</Eyebrow>
            <Link className="text-link" to="/transcript">Learning transcript</Link>
          </aside>
        </div>
      </section>
    </AcademyShell>
  );
}
