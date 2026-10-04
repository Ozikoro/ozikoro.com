import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro } from "@/components/academy-ui";
import { sources, units } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/research/$slug")({
  loader: ({ params }) => { const u = units.find((x) => x.slug === params.slug); if (!u) throw notFound(); return u; },
  head: ({ loaderData }) => loaderData ? meta(`Research Mode: ${loaderData.title}`, "Detailed academic version with primary and secondary sources, citations and competing interpretations.") : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  component: Page,
});
function Page() { const u = Route.useLoaderData();
return <AcademyShell><PageIntro eyebrow="Research Mode" title={u.lessons[0]!} description="Curiosity → Learning → Study → Research. The detailed academic version of this lesson." />
<section className="section-pad"><div className="site-wrap grid gap-10 lg:grid-cols-[1fr_20rem]"><article className="lesson-prose">
<p>The finds at Igbo-Ukwu, excavated by Thurstan Shaw between 1959 and 1964, comprise ritual vessels, regalia and over 100,000 glass and stone beads. Their radiocarbon dates place them in the ninth to tenth centuries CE.<sup>1</sup></p>
<h2>Competing interpretations</h2>
<div className="grid gap-4 md:grid-cols-2 not-prose"><div className="v2-panel"><Eyebrow>Interpretation A</Eyebrow><p>The burial is of an early holder of Nri-type ritual office, linking the site to later Nri authority.<sup>2</sup></p></div><div className="v2-panel"><Eyebrow>Interpretation B</Eyebrow><p>Continuity with Nri cannot be demonstrated; the evidence supports ritual specialisation without a named institution.<sup>3</sup></p></div></div>
<h2>References</h2><ol>{sources.map((s) => <li key={s.slug}>{s.citation}</li>)}</ol>
</article><aside className="details-aside"><h3>Source panels</h3><Eyebrow>Primary</Eyebrow><ul className="mb-5 grid gap-2 text-sm">{sources.filter((s) => s.kind.startsWith("Primary")).map((s) => <li key={s.slug}><Link to="/sources/$slug" params={{ slug: s.slug }}>{s.title}</Link></li>)}</ul><Eyebrow>Secondary</Eyebrow><ul className="grid gap-2 text-sm">{sources.filter((s) => s.kind.startsWith("Secondary")).map((s) => <li key={s.slug}><Link to="/sources/$slug" params={{ slug: s.slug }}>{s.title}</Link></li>)}</ul><Link className="text-link mt-6" to="/units/$slug" params={{ slug: u.slug }}>Back to unit</Link></aside></div></section></AcademyShell>; }
