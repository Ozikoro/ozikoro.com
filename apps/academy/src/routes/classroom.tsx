import { createFileRoute } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro, ProgressBar } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { classroom } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/classroom")({ head: () => meta("Classroom", "Assign courses and units, and see class progress and concept-level mastery."), component: Page });
function Page() { return <AcademyShell><PageIntro eyebrow="Classroom · Instructor view" title={classroom.name} description={`${classroom.students} learners · Currently assigned: ${classroom.assigned}`} />
<section className="section-pad"><div className="site-wrap grid gap-10 lg:grid-cols-[1fr_20rem]"><div><Eyebrow>Concept-level insights</Eyebrow><h2 className="mt-2 mb-6">Share of class at Proficient or above</h2><ul className="grid gap-6">{classroom.conceptInsights.map((c) => <li key={c.slug}><div className="mb-2 flex justify-between text-sm"><strong>{c.title}</strong><span>{c.proficientShare}%</span></div><ProgressBar value={c.proficientShare} />{c.proficientShare < 50 && <p className="mt-2 text-xs text-muted-foreground">Consider targeted support: assign the practice set for this concept.</p>}</li>)}</ul></div>
<aside className="details-aside"><h3>Assign work</h3><label className="mt-4 grid gap-2 text-sm">Content<select className="select-field"><option>Course</option><option>Unit</option><option>Activity</option><option>Learning path</option></select></label><label className="mt-3 grid gap-2 text-sm">Due date<input type="date" className="select-field" /></label><Button className="mt-5 w-full">Assign to class</Button><p className="mt-3 text-xs text-muted-foreground">For schools, universities, museums and cultural organisations.</p></aside></div></section></AcademyShell>; }
