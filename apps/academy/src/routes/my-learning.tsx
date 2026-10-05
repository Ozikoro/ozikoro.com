import { createFileRoute, Link } from "@tanstack/react-router";
import { Award, BookOpen, Play } from "lucide-react";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro, ProgressBar } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { courses } from "@/data/academy";
import { myLearning } from "@/backend/functions";

export const Route = createFileRoute("/my-learning")({
  head: () => ({
    meta: [
      { title: "My Learning — Ozikoro Academy" },
      { name: "description", content: "Resume courses, review progress and access your certificates." },
      { property: "og:title", content: "My Learning — Ozikoro Academy" },
      { property: "og:description", content: "Your Ozikoro Academy study record." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // The learner's own record, read on the server. A signed-out visitor gets the refusal code and
  // the page renders the invitation to sign in — which is a real state, not an error.
  loader: async () => myLearning(),
  component: MyLearning,
});

function courseBySlug(slug: string) {
  return courses.find((c) => c.slug === slug);
}

function MyLearning() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return (
      <AcademyShell>
        <PageIntro
          eyebrow="My Learning"
          title="Continue where you left off."
          description="Your courses, assessments and academic records in one calm place."
        />
        <section className="section-pad">
          <div className="site-wrap">
            <div className="account-card">
              <h2>Sign in to see your learning</h2>
              <p className="intro">
                Your enrolments, progress and assessment record are kept against your Ozikoro account
                — the same one you use across Ozikoro.
              </p>
              <Button asChild size="lg" className="w-full">
                <Link to="/account">Sign in or create an account</Link>
              </Button>
              <Button asChild variant="ghost" className="mt-2 w-full">
                <Link to="/courses">Browse courses</Link>
              </Button>
            </div>
          </div>
        </section>
      </AcademyShell>
    );
  }

  const { enrolments, progress, attempts } = result.data;

  // Count completed lessons per course once, rather than rescanning the whole progress list for
  // every card. The progress rows carry their own course slug, which is why they can be grouped
  // here at all.
  const completedByCourse = new Map<string, number>();
  for (const row of progress) {
    if (row.state !== "completed") continue;
    completedByCourse.set(row.courseSlug, (completedByCourse.get(row.courseSlug) ?? 0) + 1);
  }

  const inProgress = enrolments.filter((e) => e.status !== "completed");
  const finished = enrolments.filter((e) => e.status === "completed");

  return (
    <AcademyShell>
      <PageIntro
        eyebrow="My Learning"
        title="Continue where you left off."
        description="Your courses, assessments and academic records in one calm place."
      />
      <section className="section-pad">
        <div className="site-wrap grid gap-8 lg:grid-cols-[1fr_19rem]">
          <div>
            <h2 className="text-2xl">In progress</h2>

            {enrolments.length === 0 && (
              <div className="saved-row">
                <BookOpen />
                <div>
                  <strong>You have not enrolled in a course yet</strong>
                  <p>Browse the catalogue and begin with any course that interests you.</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/courses">Browse courses</Link>
                </Button>
              </div>
            )}

            {inProgress.length === 0 && finished.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing in progress. Your completed courses are below.
              </p>
            )}

            {inProgress.map((enrolment) => {
              const course = courseBySlug(enrolment.courseSlug);
              const done = completedByCourse.get(enrolment.courseSlug) ?? 0;
              const total = course?.lessons ?? 0;
              const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

              return (
                <article className="learning-card" key={enrolment.courseSlug}>
                  <div className="course-code">{course?.code ?? "—"}</div>
                  <div>
                    <p className="eyebrow text-primary">{course?.title ?? enrolment.courseSlug}</p>
                    <h3 className="mt-2 text-xl">
                      Enrolled {new Date(enrolment.enrolledAt).toLocaleDateString()}
                    </h3>
                    <div className="mt-5">
                      <ProgressBar value={percent} />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {done} lessons recorded{total > 0 ? ` · ${percent}% complete` : ""}
                      </p>
                    </div>
                  </div>
                  <Button asChild>
                    <Link to="/learn/$slug" params={{ slug: enrolment.courseSlug }}>
                      <Play /> Resume
                    </Link>
                  </Button>
                </article>
              );
            })}

            {finished.length > 0 && (
              <>
                <h2 className="mt-12 text-2xl">Completed</h2>
                {finished.map((enrolment) => {
                  const course = courseBySlug(enrolment.courseSlug);
                  return (
                    <div className="saved-row" key={enrolment.courseSlug}>
                      <Award />
                      <div>
                        <strong>{course?.title ?? enrolment.courseSlug}</strong>
                        <p>
                          Completed{" "}
                          {enrolment.completedAt
                            ? new Date(enrolment.completedAt).toLocaleDateString()
                            : ""}
                        </p>
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link to="/courses/$slug" params={{ slug: enrolment.courseSlug }}>
                          View course
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </>
            )}

            {attempts.length > 0 && (
              <>
                <h2 className="mt-12 text-2xl">Recent assessments</h2>
                {attempts.slice(0, 6).map((attempt) => (
                  <div className="saved-row" key={attempt.id}>
                    <BookOpen />
                    <div>
                      <strong>{attempt.activitySlug.replace(/-/g, " ")}</strong>
                      <p>
                        {attempt.kind} ·{" "}
                        {attempt.score !== null && attempt.maxScore !== null
                          ? `${attempt.score} of ${attempt.maxScore}`
                          : "recorded"}{" "}
                        · {new Date(attempt.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <aside>
            <div className="record-card">
              <Award />
              <h3>Academic record</h3>
              <dl>
                <div>
                  <dt>Courses enrolled</dt>
                  <dd>{enrolments.length}</dd>
                </div>
                <div>
                  <dt>Courses completed</dt>
                  <dd>{finished.length}</dd>
                </div>
                <div>
                  <dt>Assessments recorded</dt>
                  <dd>{attempts.length}</dd>
                </div>
              </dl>
              <Button asChild variant="outline" className="w-full">
                <Link to="/courses">Browse courses</Link>
              </Button>
              <Button asChild variant="ghost" className="mt-2 w-full">
                <Link to="/mastery">Mastery dashboard</Link>
              </Button>
            </div>
          </aside>
        </div>
      </section>
    </AcademyShell>
  );
}
