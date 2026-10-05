import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { paths } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/paths/")({ head: () => meta("Learning paths", "Guided sequences that show what to study next across African history, languages, religions and art."), component: Page });
function Page() { return <AcademyShell><PageIntro eyebrow="Learning paths" title="What should I study next?" description="Paths combine courses into a recommended order without becoming rigid curricula." /><section className="section-pad"><div className="site-wrap grid gap-4 md:grid-cols-2">{paths.map((p) => <Link key={p.slug} to="/paths/$slug" params={{ slug: p.slug }} className="atlas-card"><small>{p.steps.length} courses · flexible order</small><strong>{p.title}</strong><p>{p.summary}</p><ArrowRight /></Link>)}</div></section></AcademyShell>; }
