import { createFileRoute, Link } from "@tanstack/react-router";
import { Award, BookOpen } from "lucide-react";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { OzikoroMark } from "@/components/ozikoro-mark";
import { courses } from "@/data/academy";
import { currentUser, myLearning } from "@/backend/functions";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/certificates")({
  head: () => meta("Certificates", "Verified records of the work you have completed at Ozikoro Academy."),
  loader: async () => {
    const [learning, session] = await Promise.all([myLearning(), currentUser()]);
    return { learning, account: session.account };
  },
  component: Page,
});

/**
 * CERTIFICATES ARE DERIVED FROM COMPLETION, AND THE NUMBER IS NOT INVENTED.
 *
 * The page used to show one certificate — "OZK-2026-0142", issued 12 September 2026 — to everybody,
 * including a visitor with no account. A certificate number is the one piece of text on this page
 * that is supposed to be verifiable, so a fixed one is worse than none.
 *
 * A certificate now exists only for a course the learner has actually completed, and its reference is
 * derived from the account and the course rather than being issued from a counter. That makes it
 * stable — the same learner and course always produce the same reference — and honest, because it
 * cannot appear before the completion it names.
 *
 * IT IS NOT YET A VERIFIABLE CREDENTIAL. A real one needs a server-side record, a verification
 * endpoint, and a decision about what completion means before it is offered. Until then the page
 * says what it is, rather than implying an accreditation the platform does not have — which the
 * handoff brief explicitly rules out.
 */
function certificateReference(accountId: number, courseSlug: string): string {
  // A short, stable, human-readable reference. Not a security token, and not presented as one.
  const input = `${accountId}:${courseSlug}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  const code = hash.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
  return `OZK-${code}`;
}

function Page() {
  const { learning: result, account } = Route.useLoaderData();
  const learning = result.ok ? result.data : null;
  const completed = learning?.enrolments.filter((e) => e.status === "completed") ?? [];

  return (
    <AcademyShell>
      <PageIntro
        eyebrow="Academic records"
        title="Certificates"
        description="Records of the courses you have completed at Ozikoro Academy."
      />
      <section className="section-pad">
        <div className="site-wrap">
          {!learning && (
            <div className="account-card">
              <div className="brand-mark mx-auto"><OzikoroMark className="ozikoro-mark" /></div>
              <h2 className="mt-5 text-center">Sign in to see your certificates</h2>
              <p className="intro text-center">
                A certificate is issued against your Ozikoro account, so it follows you across
                devices.
              </p>
              <Button asChild className="w-full"><Link to="/account">Sign in</Link></Button>
            </div>
          )}

          {learning && completed.length === 0 && (
            <div className="saved-row">
              <BookOpen />
              <div>
                <strong>No certificates yet</strong>
                <p>
                  A course issues its certificate when every lesson is recorded as complete. You have{" "}
                  {learning.enrolments.length === 0
                    ? "not enrolled in a course"
                    : `${learning.enrolments.length} course${learning.enrolments.length === 1 ? "" : "s"} in progress`}
                  .
                </p>
              </div>
              <Button asChild variant="outline" size="sm"><Link to="/courses">Browse courses</Link></Button>
            </div>
          )}

          {completed.map((enrolment) => {
            const course = courses.find((c) => c.slug === enrolment.courseSlug);
            return (
              <article className="certificate-card" key={enrolment.courseSlug}>
                <div className="certificate-mark"><OzikoroMark className="ozikoro-mark" /></div>
                <div>
                  <p className="eyebrow text-primary">Certificate of completion</p>
                  <h2>{course?.title ?? enrolment.courseSlug}</h2>
                  <p>
                    Awarded for completing every recorded lesson in this course
                    {course ? ` (${course.code})` : ""}.
                  </p>
                  <small>
                    Completed{" "}
                    {enrolment.completedAt
                      ? new Date(enrolment.completedAt).toLocaleDateString()
                      : "—"}{" "}
                    · Reference {certificateReference(account?.id ?? 0, enrolment.courseSlug)}
                  </small>
                </div>
                <Award />
              </article>
            );
          })}

          {completed.length > 0 && (
            <p className="mt-8 text-sm text-muted-foreground">
              These are records of study at Ozikoro Academy. They are not accredited qualifications,
              and the reference identifies the record rather than verifying it to a third party.
            </p>
          )}
        </div>
      </section>
    </AcademyShell>
  );
}
