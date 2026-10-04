import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro } from "@/components/academy-ui";
import { collections, cultures, paths, regions, subjects } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/explore")({ head: () => meta("Knowledge Atlas", "Explore African cultures, histories, peoples, languages and civilisations by subject, region, people and collection."), component: Page });
function Group({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) { return <div><Eyebrow>{eyebrow}</Eyebrow><h2 className="mt-2 mb-6">{title}</h2><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{children}</div></div>; }
function Page() { return <AcademyShell><PageIntro eyebrow="Explore · Knowledge Atlas" title="Begin anywhere. Study with structure." description="Every subject, region, people and collection leads into courses, lessons, sources and archive items." />
<section className="section-pad"><div className="site-wrap grid gap-16">
<Group eyebrow="Broad domains" title="Subjects">{subjects.map((s) => <Link key={s.slug} to="/subjects/$slug" params={{ slug: s.slug }} className="atlas-card"><small>Subject</small><strong>{s.title}</strong><p>{s.summary}</p><ArrowRight /></Link>)}</Group>
<Group eyebrow="Geographic context" title="Regions">{regions.map((s) => <Link key={s.slug} to="/regions/$slug" params={{ slug: s.slug }} className="atlas-card"><small>Region</small><strong>{s.title}</strong><p>{s.summary}</p><ArrowRight /></Link>)}</Group>
<Group eyebrow="Cultural focus" title="Cultures and peoples">{cultures.map((c) => <Link key={c.slug} to="/cultures/$slug" params={{ slug: c.slug }} className="atlas-card"><small>Culture / People</small><strong>{c.name}</strong><p>{c.summary}</p><ArrowRight /></Link>)}</Group>
<Group eyebrow="Guided sequences" title="Learning paths">{paths.slice(0, 6).map((p) => <Link key={p.slug} to="/paths/$slug" params={{ slug: p.slug }} className="atlas-card"><small>Learning path</small><strong>{p.title}</strong><p>{p.steps.length} courses</p><ArrowRight /></Link>)}</Group>
<Group eyebrow="Curated study" title="Collections">{collections.map((c) => <Link key={c.slug} to="/collections/$slug" params={{ slug: c.slug }} className="atlas-card"><small>Collection</small><strong>{c.title}</strong><ArrowRight /></Link>)}</Group>
<div className="flex flex-wrap gap-3"><Link className="text-link" to="/timeline">Interactive timeline <ArrowRight /></Link><Link className="text-link" to="/map">Interactive map <ArrowRight /></Link><Link className="text-link" to="/compare">Compare cultures <ArrowRight /></Link></div>
</div></section></AcademyShell>; }
