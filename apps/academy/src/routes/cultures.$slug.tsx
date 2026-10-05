import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro } from "@/components/academy-ui";
import { CourseGrid } from "@/components/academy-learn";
import { courses, cultures, profileSections, regions } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/cultures/$slug")({
  loader: ({ params }) => { const c = cultures.find((x) => x.slug === params.slug); if (!c) throw notFound(); return c; },
  head: ({ loaderData }) => loaderData ? meta(`${loaderData.name} — Culture profile`, loaderData.summary) : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  component: Page,
});
function Page() { const c = Route.useLoaderData(); const region = regions.find((r) => r.slug === c.region);
return <AcademyShell><PageIntro eyebrow={`Culture / People · ${region?.title ?? ""}`} title={c.name} description={c.summary} />
<section className="section-pad"><div className="site-wrap article-grid"><div>
<nav aria-label="Profile sections" className="mb-10 flex flex-wrap gap-2">{profileSections.map((s) => <a key={s} href={`#${s.replace(/\W+/g, "-")}`} className="filter-pill">{s}</a>)}</nav>
<div className="border-t border-border">{profileSections.map((s) => <section id={s.replace(/\W+/g, "-")} key={s} className="profile-section"><h2>{s}</h2><p>{s === "Language" ? c.language : c.facts[s] ?? "This section is being prepared by Ozikoro editors with reviewed sources."}</p><div className="profile-links"><Link to="/courses/$slug" params={{ slug: courses[0].slug }}>Course</Link><Link to="/sources/$slug" params={{ slug: "igbo-ukwu-roped-pot" }}>Source</Link><Link to="/timeline">Timeline</Link><Link to="/map">Map</Link></div></section>)}</div>
</div><aside className="details-aside"><h3>At a glance</h3><dl><dt>Region</dt><dd>{region?.title}</dd><dt>Language</dt><dd>{c.language}</dd></dl><Link className="text-link mt-6" to="/compare">Compare with other cultures</Link></aside></div></section>
<section className="section-pad border-t border-border"><div className="site-wrap"><Eyebrow>Further study</Eyebrow><h2 className="mt-2 mb-6">Related courses</h2><CourseGrid slugs={region?.courses ?? []} /></div></section></AcademyShell>; }
