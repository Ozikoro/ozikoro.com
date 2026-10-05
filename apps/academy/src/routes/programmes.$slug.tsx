import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { courses, programmes } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/programmes/$slug")({
  loader: ({ params }) => { const t = programmes.find((x) => x.slug === params.slug); if (!t) throw notFound(); return t; },
  head: ({ loaderData }) => loaderData ? meta(loaderData.title, loaderData.summary) : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  component: Page,
});
function Page() { const t = Route.useLoaderData(); return <AcademyShell><PageIntro eyebrow="Programme" title={t.title} description={t.summary} /><section className="section-pad"><div className="site-wrap max-w-4xl"><p className="note-box mb-8">Complete every course and its final assessment to earn the Ozikoro programme certificate.</p><ol className="border-t border-border">{t.steps.map((s, i) => { const c = courses.find((x) => x.slug === s)!; return <li key={s + i} className="syllabus-row"><span>0{i + 1}</span><strong><Link to="/courses/$slug" params={{ slug: c.slug }}>{c.title}</Link></strong><small className="inline-flex items-center gap-1">{i === 0 ? <><CheckCircle2 className="size-4 text-primary" /> In progress</> : c.duration}</small></li>; })}</ol></div></section></AcademyShell>; }
