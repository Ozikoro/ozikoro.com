import { createFileRoute, Link } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { courses } from "@/data/academy";
import { myLearning, myMastery } from "@/backend/functions";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/transcript")({
  head: () => meta("Learning transcript", "Your long-term record of courses, assessments, paths and certificates."),
  loader: async () => {
    const [learning, mastery] = await Promise.all([myLearning(), myMastery()]);
    return {
      learning: learning.ok ? learning.data : null,
      mastery,
    };
  },
  component: Page,
});

/**
 * THE TRANSCRIPT USED TO BE A FIXED TABLE.
 *
 * It reported "IGB 101 · 4 of 24 lessons", "11 attempts · 9 passed · average 78%" and a certificate
 * number to every visitor, including one who had never opened a lesson. A transcript is precisely
 * the page where an invented figure is least acceptable, because its whole purpose is to be the
 * record.
 *
 * Everything below is now counted from the learner's own rows, and the page says plainly when there
 * is nothing to show.
 */
function Page() {
  const { learning, mastery } = Route.useLoaderData();

  const courseTitle = (slug: string) => courses.find((c) => c.slug === slug)?.title ?? slug;
  const courseCode = (slug: string) => courses.find((c) => c.slug === slug)?.code ?? "—";

  if (!learning) {
    return (
      <AcademyShell>
        <PageIntro
          eyebrow="Learning transcript"
          title="Your academic record."
          description="A long-term history of study at Ozikoro Academy."
        />
        <section className="section-pad">
          <div className="site-wrap max-w-4xl">
            <p className="note-box">
              Sign in to see your transcript. It is generated from your own enrolments, answers and
              completions, so there is nothing to show until you have some.
            </p>
            <Button asChild className="mt-6"><Link to="/account">Sign in</Link></Button>
          </div>
        </section>
      </AcademyShell>
    );
  }

  const { enrolments, progress, attempts } = learning;
  const completedCourses = enrolments.filter((e) => e.status === "completed");
  const completedLessons = progress.filter((p) => p.state === "completed").length;

  const scored = attempts.filter((a) => a.score !== null && a.maxScore !== null && a.maxScore > 0);
  const average =
    scored.length > 0
      ? Math.round(
          (scored.reduce((sum, a) => sum + (a.score ?? 0) / (a.maxScore ?? 1), 0) / scored.length) * 100
        )
      : null;

  // Count the concepts at each level from the learner's own answers.
  const levelCounts = new Map<string, number>();
  for (const entry of Object.values(mastery.concepts)) {
    levelCounts.set(entry.level, (levelCounts.get(entry.level) ?? 0) + 1);
  }
  const masterySummary =
    levelCounts.size === 0
      ? "No concepts measured yet"
      : ["Mastered", "Proficient", "Familiar", "Attempted"]
          .filter((level) => levelCounts.has(level))
          .map((level) => `${levelCounts.get(level)} ${level.toLowerCase()}`)
          .join(" · ");

  const record: [string, string][] = [
    [
      "Course progress",
      enrolments.length === 0
        ? "No courses enrolled"
        : `${enrolments.length} enrolled · ${completedCourses.length} completed · ${completedLessons} lessons recorded`,
    ],
    ["Concept mastery", masterySummary],
    [
      "Assessment history",
      attempts.length === 0
        ? "No assessments recorded"
        : `${attempts.length} recorded${average !== null ? ` · average ${average}%` : ""}`,
    ],
    ["Courses completed", completedCourses.length === 0 ? "None yet" : completedCourses.map((e) => courseTitle(e.courseSlug)).join(", ")],
    ["Certificates", completedCourses.length === 0 ? "None yet" : `${completedCourses.length} available to view`],
  ];

  return (
    <AcademyShell>
      <PageIntro
        eyebrow="Learning transcript"
        title="Your academic record."
        description="A long-term history of study at Ozikoro Academy."
      />
      <section className="section-pad">
        <div className="site-wrap max-w-4xl">
          <dl className="source-meta">
            {record.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <h2 className="mt-12 mb-4">History</h2>
          {attempts.length === 0 ? (
            <p className="text-muted-foreground">
              No activity yet. Practice, assessment and challenge results appear here as you record
              them.
            </p>
          ) : (
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Activity</th>
                  <th>Course</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.createdAt).toLocaleDateString()}</td>
                    <td>{a.kind}</td>
                    <td>{courseCode(a.courseSlug)}</td>
                    <td>{a.score !== null && a.maxScore !== null ? `${a.score} of ${a.maxScore}` : "recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <Link className="text-link mt-8" to="/certificates">View certificates</Link>
        </div>
      </section>
    </AcademyShell>
  );
}
