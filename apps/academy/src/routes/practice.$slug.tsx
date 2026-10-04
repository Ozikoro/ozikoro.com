import { createFileRoute } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { Quiz } from "@/components/academy-learn";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/practice/$slug")({ head: () => meta("Practice activity", "Interpretation, chronology and comparison — hints are available before answers."), component: Page });
function Page() { return <AcademyShell><PageIntro eyebrow="Practice activity" title="Practice activity" description="Interpretation, chronology and comparison — hints are available before answers." /><section className="section-pad"><div className="site-wrap max-w-3xl"><Quiz title="Practice activity" mode="practice" /></div></section></AcademyShell>; }
