import { createFileRoute, notFound } from "@tanstack/react-router";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { TopicBody } from "@/components/academy-learn";
import { collections } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/collections/$slug")({
  loader: ({ params }) => { const t = collections.find((x) => x.slug === params.slug); if (!t) throw notFound(); return t; },
  head: ({ loaderData }) => loaderData ? meta(loaderData.title, loaderData.summary) : { meta: [{ title: "Not found" }, { name: "robots", content: "noindex" }] },
  component: Page,
});
function Page() { const t = Route.useLoaderData(); return <AcademyShell><PageIntro eyebrow="Collection" title={t.title} description={t.summary} /><TopicBody topic={t} kind="Collection" /></AcademyShell>; }
