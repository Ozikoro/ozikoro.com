import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { Award, Check, Clock3, FileCheck2, PlayCircle } from "lucide-react";
import { useState } from "react";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { courses, syllabus } from "@/data/academy";
import { courseProgress, currentUser, enrolInCourse } from "@/backend/functions";

export const Route = createFileRoute("/courses/$slug")({
  loader: async ({ params }) => {
    const course = courses.find((c) => c.slug === params.slug);
    if (!course) throw notFound();

    // THE COURSE IS PUBLIC; THE LEARNER'S POSITION IN IT IS NOT.
    //
    // Both are resolved in the loader so the page renders in one pass — a visitor gets the syllabus
    // and an enrol button, a signed-in learner gets their own progress, and neither sees a spinner
    // or a flash of the wrong state. `courseProgress` answers with an empty list when nobody is
    // signed in rather than failing, which is what lets one loader serve both cases.
    const [account, progress] = await Promise.all([
      currentUser(),
      courseProgress({ data: { courseSlug: params.slug } }),
    ]);

    return { course, account, progress: progress.ok ? progress.data : [] };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.course.title ?? "Course"} — Ozikoro Academy` },
      { name: "description", content: loaderData?.course.description ?? "Ozikoro Academy course." },
      { property: "og:title", content: `${loaderData?.course.title ?? "Course"} — Ozikoro Academy` },
      {
        property: "og:description",
        content: loaderData?.course.description ?? "Ozikoro Academy course.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Detail,
});

function Detail() {
  const { course, account, progress } = Route.useLoaderData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completed = progress.filter((p) => p.state === "completed").length;
  const enrolled = progress.length > 0;
  const percent = course.lessons > 0 ? Math.round((completed / course.lessons) * 100) : 0;

  async function enrolAndBegin() {
    setError(null);
    setBusy(true);
    try {
      const result = await enrolInCourse({ data: { courseSlug: course.slug } });

      if (!result.ok) {
        // The only refusal a signed-out visitor meets. They go to the sign-in page rather than
        // seeing an error, and return to this course afterwards.
        if (result.code === "not_signed_in") {
          navigate({ to: "/account" });
          return;
        }
        setError(result.message);
        return;
      }

      // Full navigation, not a router transition: the enrolment is a new row the lesson page's
      // loader has to read, and a client-side transition would reuse this page's cached loaders.
      window.location.assign(`/learn/${course.slug}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AcademyShell>
      <section className="course-hero">
        <div className="site-wrap grid gap-10 lg:grid-cols-[1fr_22rem]">
          <div>
            <Eyebrow>
              {course.code} · {course.subject}
            </Eyebrow>
            <h1>{course.title}</h1>
            <p>{course.description}</p>
            <div className="mt-7 flex flex-wrap gap-5 text-sm text-on-night-muted">
              <span>
                <Clock3 /> {course.duration}
              </span>
              <span>
                <PlayCircle /> {course.lessons} lessons
              </span>
              <span>
                <FileCheck2 /> 6 assessments
              </span>
            </div>
          </div>

          <aside className="enrol-panel">
            {enrolled ? (
              <>
                <p className="text-xs font-bold uppercase tracking-caps text-muted-foreground">
                  Your progress
                </p>
                <p className="mt-3 font-serif text-2xl font-semibold">{percent}% complete</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {completed} of {course.lessons} lessons recorded.
                </p>
                <Button asChild size="lg" className="mt-6 w-full">
                  <Link to="/learn/$slug" params={{ slug: course.slug }}>
                    Continue course
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <p className="text-xs font-bold uppercase tracking-caps text-muted-foreground">
                  Course enrolment
                </p>
                <p className="mt-3 font-serif text-2xl font-semibold">Begin at your own pace</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Full access to lessons, practice, assessment and certificate.
                </p>
                <Button
                  size="lg"
                  className="mt-6 w-full"
                  onClick={enrolAndBegin}
                  disabled={busy}
                  type="button"
                >
                  {busy ? "Enrolling…" : "Enrol and begin"}
                </Button>
                <Button asChild variant="outline" className="mt-3 w-full">
                  <Link to="/diagnostic/$slug" params={{ slug: course.slug }}>
                    What do you already know?
                  </Link>
                </Button>
              </>
            )}

            {error && (
              <p role="alert" className="mt-3 text-center text-xs font-semibold text-primary">
                {error}
              </p>
            )}

            <Link
              to="/units/$slug"
              params={{ slug: "early-igbo-civilisation" }}
              className="mt-3 block text-center text-xs font-semibold text-primary"
            >
              View units and mastery
            </Link>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {account ? `Signed in as ${account.email}` : "Sign in required to save progress"}
            </p>
          </aside>
        </div>
      </section>

      <section className="section-pad">
        <div className="site-wrap article-grid">
          <article>
            <Eyebrow>What you will learn</Eyebrow>
            <h2 className="mt-2">Course outcomes</h2>
            <ul className="outcome-list">
              <li>
                <Check />
                Recognise and produce the core sound and tonal patterns of standard Igbo.
              </li>
              <li>
                <Check />
                Build vocabulary for identity, family, place and daily communication.
              </li>
              <li>
                <Check />
                Read and write complete sentences with growing confidence.
              </li>
              <li>
                <Check />
                Listen critically across common regional variation.
              </li>
            </ul>
            <div className="mt-14">
              <Eyebrow>Course structure</Eyebrow>
              <h2 className="mt-2">Syllabus</h2>
              <div className="mt-6 border-t border-border">
                {syllabus.map((x, i) => (
                  <div className="syllabus-row" key={x}>
                    <span>0{i + 1}</span>
                    <strong>{x}</strong>
                    <small>{i === 5 ? "Assessment" : "3–5 lessons"}</small>
                  </div>
                ))}
              </div>
            </div>
          </article>
          <aside className="details-aside">
            <h3>Course details</h3>
            <dl>
              <dt>Level</dt>
              <dd>{course.level}</dd>
              <dt>Language</dt>
              <dd>English &amp; Igbo</dd>
              <dt>Prerequisites</dt>
              <dd>None</dd>
              <dt>Assessment</dt>
              <dd>Quizzes, writing and listening</dd>
            </dl>
            <div className="certificate-note">
              <Award />
              <div>
                <strong>Certificate included</strong>
                <p>
                  Earn an Ozikoro course certificate after completing all modules and the final
                  assessment.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </AcademyShell>
  );
}
