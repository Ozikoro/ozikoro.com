import { createFileRoute, notFound } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { TopicBody } from "@/components/academy-learn";
import { subjects } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/subjects/$slug")({
  loader: ({ params }) => { const t = subjects.find((x) => x.slug === params.slug); if (!t) throw notFound(); return t; },
  head: ({ loaderData }) => loaderData ? meta(loaderData.title, loaderData.summary) : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  component: Page,
});
function Page() { const t = Route.useLoaderData(); return <AcademyShell><PageIntro eyebrow="Subject" title={t.title} description={t.summary} /><TopicBody topic={t} kind="Subject" /></AcademyShell>; }
