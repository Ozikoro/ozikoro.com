import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro } from "@/components/academy-ui";
import { MasteryLegend, MasteryTag } from "@/components/academy-learn";
import { Button } from "@/components/ui/button";
import { concepts, courses, units } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/units/$slug")({
  loader: ({ params }) => { const u = units.find((x) => x.slug === params.slug); if (!u) throw notFound(); return u; },
  head: ({ loaderData }) => loaderData ? meta(`Unit: ${loaderData.title}`, `Lessons, concepts and mastery for ${loaderData.title}.`) : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  component: Page,
});
function Page() { const u = Route.useLoaderData(); const c = courses.find((x) => x.slug === u.course)!; const cs = concepts.filter((k) => u.concepts.includes(k.slug));
return <AcademyShell><PageIntro eyebrow={`${c.code} · Unit`} title={u.title} description={`Part of ${c.title}. Mastery is measured by concepts and skills, not by time spent.`} />
<section className="section-pad"><div className="site-wrap grid gap-10 lg:grid-cols-[1fr_22rem]"><div>
<Eyebrow>Lessons</Eyebrow><ol className="mt-4 border-t border-border">{u.lessons.map((l, i) => <li key={l} className="syllabus-row"><span>0{i + 1}</span><strong><Link to="/learn/$slug" params={{ slug: c.slug }}>{l}</Link></strong><small>{i < 2 ? "Completed" : "Not started"}</small></li>)}</ol>
<div className="mt-8 flex flex-wrap gap-3"><Button asChild><Link to="/practice/$slug" params={{ slug: u.slug }}>Practise this unit</Link></Button><Button asChild variant="outline"><Link to="/assessment/$slug" params={{ slug: c.slug }}>Unit assessment</Link></Button><Button asChild variant="outline"><Link to="/challenge/$slug" params={{ slug: c.slug }}>Course challenge</Link></Button><Button asChild variant="ghost"><Link to="/research/$slug" params={{ slug: u.slug }}>Research Mode</Link></Button></div>
</div><aside className="details-aside"><h3>Concept mastery</h3><ul className="mt-4 grid gap-4">{cs.map((k) => <li key={k.slug}><Link to="/concepts/$slug" params={{ slug: k.slug }} className="font-semibold">{k.title}</Link><p className="text-xs text-muted-foreground">{k.skill}</p><div className="mt-2"><MasteryTag level={k.mastery} /></div></li>)}</ul><div className="mt-8 border-t border-border pt-5"><p className="mb-3 text-xs font-bold uppercase tracking-caps text-muted-foreground">Mastery states</p><MasteryLegend /></div></aside></div></section></AcademyShell>; }
