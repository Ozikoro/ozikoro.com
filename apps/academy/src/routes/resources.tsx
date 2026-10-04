import { createFileRoute } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, BookOpenText, LibraryBig, Languages } from "lucide-react";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";

export const Route = createFileRoute("/resources")({
  head: () => ({ meta: [
    { title: "Resources — Ozikoro Academy" },
    { name: "description", content: "Academic tools and the Ozikoro archive." },
    { property: "og:title", content: "Resources — Ozikoro Academy" },
    { property: "og:description", content: "Dictionary, script and archive resources." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ResourcesPage,
});

function ResourcesPage() {
  // THE SHOP ENTRY WAS REMOVED BECAUSE THE SHOP DOES NOT RESOLVE.
  //
  // `https://shop.ozikoro.com` is NXDOMAIN — it has no record in the ozikoro.com zone, so the card
  // was a link to nothing on a page whose whole job is to hand a learner a working destination. It
  // was added on the owner's instruction while the store was still being built; restore the entry
  // (and the `ShoppingBag` import) when the hostname answers.
  const resources: { icon: LucideIcon; title: string; description: string; url: string }[] = [
    { icon: Languages, title: "Ozituma Dictionary", description: "Search Igbo words, meanings, usage and related entries.", url: "https://ozituma.com" },
    { icon: BookOpenText, title: "Ńdébé Script", description: "Study the independent reference for the Ńdébé writing system.", url: "https://ndebe.org" },
    { icon: LibraryBig, title: "Ozikoro Archive", description: "Explore histories, documents, photographs and cultural research.", url: "https://ozikoro.com" },
  ];

  return <AcademyShell>
    <PageIntro eyebrow="Specialist resources" title="The right tool for deeper study." description="Academy connects you to Ozikoro’s independent reference projects without duplicating them." />
    <section className="section-pad"><div className="site-wrap grid gap-5 md:grid-cols-2">
      {resources.map(({ icon: Icon, title, description, url }) => <a href={url} className="resource-card" key={title}>
        <Icon /><div><h2>{title}</h2><p>{description}</p><span>Open resource <ArrowUpRight /></span></div>
      </a>)}
    </div></section>
  </AcademyShell>;
}
