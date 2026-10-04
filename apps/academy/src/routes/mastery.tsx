import { createFileRoute, Link } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { Eyebrow, PageIntro } from "@/components/academy-ui";
import { MasteryLegend, MasteryTag } from "@/components/academy-learn";
import { concepts } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/mastery")({ head: () => meta("Mastery", "Your understanding of each concept and skill, from Not started to Mastered."), component: Page });
function Page() { const review = concepts.filter((c) => c.mastery === "Attempted" || c.mastery === "Familiar");
return <AcademyShell><PageIntro eyebrow="Mastery dashboard" title="What you understand, and what to review." description="Mastery belongs to concepts and skills — it reflects demonstrated understanding, not time spent." />
<section className="section-pad"><div className="site-wrap grid gap-10 lg:grid-cols-[1fr_20rem]"><div><MasteryLegend /><ul className="mt-8 border-t border-border">{concepts.map((c) => <li key={c.slug} className="syllabus-row"><span /><strong><Link to="/concepts/$slug" params={{ slug: c.slug }}>{c.title}</Link><small className="block font-normal text-muted-foreground">{c.skill}</small></strong><MasteryTag level={c.mastery} /></li>)}</ul></div>
<aside className="details-aside"><h3>Review this</h3><p className="mt-2 text-sm text-muted-foreground">Periodic review strengthens what you have studied.</p><ul className="mt-4 grid gap-3">{review.map((c) => <li key={c.slug}><Link className="font-semibold" to="/concepts/$slug" params={{ slug: c.slug }}>{c.title}</Link></li>)}</ul><Eyebrow>Records</Eyebrow><Link className="text-link" to="/transcript">Learning transcript</Link></aside></div></section></AcademyShell>; }
