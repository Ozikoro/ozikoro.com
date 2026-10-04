import { createFileRoute } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { Quiz } from "@/components/academy-learn";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/diagnostic/$slug")({ head: () => meta("Diagnostic", "What do you already know? This optional check recommends where to begin."), component: Page });
function Page() { return <AcademyShell><PageIntro eyebrow="Diagnostic" title="Diagnostic" description="What do you already know? This optional check recommends where to begin." /><section className="section-pad"><div className="site-wrap max-w-3xl"><Quiz title="Diagnostic" mode="diagnostic" /></div></section></AcademyShell>; }
