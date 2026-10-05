import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { timeline } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/timeline")({ head: () => meta("Interactive timeline", "West African history from Igbo-Ukwu to the colonial period, linked to lessons and sources."), component: Page });
function Page() { const [sel, setSel] = useState(0); const e = timeline[sel]!;
return <AcademyShell><PageIntro eyebrow="Interactive timeline" title="West Africa, c. 900–1911" description="Dates marked “c.” are approximate. Each event notes how it is dated." />
<section className="section-pad"><div className="site-wrap"><ol className="timeline" aria-label="Timeline events">{timeline.map((t, i) => <li key={t.title}><button aria-pressed={sel === i} onClick={() => setSel(i)}><span>{t.year}</span><strong>{t.title}</strong></button></li>)}</ol>
<div className="v2-panel mt-10 max-w-2xl" aria-live="polite"><p className="eyebrow text-primary">{e.year}</p><h2>{e.title}</h2><p className="mt-3 text-muted-foreground">Evidence: {e.note}</p>{e.source && <Link className="text-link mt-4" to="/sources/$slug" params={{ slug: e.source }}>Open the source</Link>}</div></div></section></AcademyShell>; }
