import { createFileRoute } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { Quiz } from "@/components/academy-learn";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/assessment/$slug")({
  head: () => meta("Practice assessment", "Check your understanding with guided feedback — hints are available before you answer."),
  component: Page,
});

/**
 * THE ASSESSMENT IS NO LONGER A PAGE OF ITS OWN, AND THAT IS THE FIX.
 *
 * It used to render a single hardcoded multiple-choice question under a header reading "Question 1 of
 * 5", then announce "Your answer has been reviewed" — for an answer nothing had reviewed and a set
 * that had four more questions nowhere. It recorded nothing, and the count was simply untrue.
 *
 * It now runs the same questions, feedback and recording as practice, diagnostic and challenge,
 * which is also what makes "assessments work" a statement about the product rather than about one
 * screen.
 */
function Page() {
  const { slug } = Route.useParams();
  return (
    <AcademyShell>
      <PageIntro
        eyebrow="Practice assessment"
        title="Check your understanding"
        description="Guided feedback after each answer, and a result that is saved to your learning record."
      />
      <section className="section-pad">
        <div className="site-wrap max-w-3xl">
          <Quiz title="Practice assessment" mode="assessment" courseSlug={slug} />
        </div>
      </section>
    </AcademyShell>
  );
}
