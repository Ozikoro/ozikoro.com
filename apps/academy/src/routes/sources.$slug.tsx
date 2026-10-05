import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Bookmark } from "lucide-react";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { sources } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/sources/$slug")({
  loader: ({ params }) => { const s = sources.find((x) => x.slug === params.slug); if (!s) throw notFound(); return s; },
  head: ({ loaderData }) => loaderData ? meta(`Source: ${loaderData.title}`, `${loaderData.kind}, ${loaderData.date}. Provenance, limitations and citation.`) : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  component: Page,
});
function Page() { const s = Route.useLoaderData();
return <AcademyShell><PageIntro eyebrow={`Source viewer · ${s.kind}`} title={s.title} description="How do we know? Read the evidence with its provenance and its limits." /><section className="section-pad"><div className="site-wrap article-grid"><div>
<div className="source-frame" role="img" aria-label={`Placeholder for ${s.title}`}><span>{s.kind}</span></div>
<dl className="source-meta">{([["Date", s.date], ["Creator / context", s.creator], ["Provenance", s.provenance], ["Limitations", s.limitations], ["Citation", s.citation]] as const).map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
</div><aside className="details-aside"><h3>Use this source</h3><Button variant="outline" className="mt-4 w-full"><Bookmark /> Save to reading list</Button><Eyebrow>Related sources</Eyebrow><ul className="mt-3 grid gap-2 text-sm">{sources.filter((x) => x.slug !== s.slug).map((x) => <li key={x.slug}><Link to="/sources/$slug" params={{ slug: x.slug }}>{x.title}</Link></li>)}</ul></aside></div></section></AcademyShell>; }
