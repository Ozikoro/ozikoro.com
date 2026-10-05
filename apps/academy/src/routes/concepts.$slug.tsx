import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro } from "@/components/academy-ui";
import { MasteryTag } from "@/components/academy-learn";
import { Button } from "@/components/ui/button";
import { concepts, sources, units } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/concepts/$slug")({
  loader: ({ params }) => { const k = concepts.find((x) => x.slug === params.slug); if (!k) throw notFound(); return k; },
  head: ({ loaderData }) => loaderData ? meta(`Concept: ${loaderData.title}`, loaderData.skill) : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  component: Page,
});
function Page() { const k = Route.useLoaderData(); const u = units.find((x) => x.concepts.includes(k.slug));
return <AcademyShell><PageIntro eyebrow="Concept / Skill" title={k.title} description={k.skill} /><section className="section-pad"><div className="site-wrap article-grid"><div>
<Eyebrow>Your current state</Eyebrow><div className="mt-3"><MasteryTag level={k.mastery} /></div>
<h2 className="mt-10">How do we know?</h2><p className="mt-3 text-muted-foreground">This skill is demonstrated by working with evidence. Study these sources, then practise interpreting them.</p>
<ul className="mt-5 grid gap-3">{sources.map((s) => <li key={s.slug} className="saved-row"><span className="course-code">{s.kind.split(" ")[0]}</span><div><strong>{s.title}</strong><p>{s.kind} · {s.date}</p></div><Button asChild size="sm" variant="outline"><Link to="/sources/$slug" params={{ slug: s.slug }}>Open</Link></Button></li>)}</ul>
</div><aside className="details-aside"><h3>Next steps</h3>{u && <><p className="mt-3 text-sm">Taught in unit <Link className="font-semibold" to="/units/$slug" params={{ slug: u.slug }}>{u.title}</Link></p><Button asChild className="mt-5 w-full"><Link to="/practice/$slug" params={{ slug: u.slug }}>Practise this concept</Link></Button></>}<Button asChild variant="outline" className="mt-3 w-full"><Link to="/onye-ozi">Ask Onye Ozi for a hint</Link></Button></aside></div></section></AcademyShell>; }
