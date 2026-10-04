import { createFileRoute } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { Quiz } from "@/components/academy-learn";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/challenge/$slug")({ head: () => meta("Course challenge", "Test across the whole course. No hints; results update concept mastery."), component: Page });
function Page() { return <AcademyShell><PageIntro eyebrow="Course challenge" title="Course challenge" description="Test across the whole course. No hints; results update concept mastery." /><section className="section-pad"><div className="site-wrap max-w-3xl"><Quiz title="Course challenge" mode="challenge" /></div></section></AcademyShell>; }
