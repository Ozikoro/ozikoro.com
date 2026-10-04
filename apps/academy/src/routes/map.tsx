import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { mapSites } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/map")({ head: () => meta("African learning map", "Explore selected African historical cities, states, archaeological sites and cultural centres."), component: Page });

function Page() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedSite = mapSites[selectedIndex] ?? mapSites[0];

  if (!selectedSite) return null;

  return <AcademyShell>
    <PageIntro eyebrow="African learning map" title="Places that open wider histories" description="Select any labelled point to see why the place matters. Positions are schematic, and historical boundaries are not presented as fixed." />
    <section className="section-pad">
      <div className="site-wrap map-layout">
        <div className="map-canvas" role="group" aria-label="Schematic map of selected African historical places">
          <div className="africa-silhouette" aria-hidden="true" />
          {mapSites.map((site, index) => (
            <Button
              key={site.name}
              variant="ghost"
              className="map-marker"
              style={{ left: `${site.x}%`, top: `${site.y}%` }}
              aria-pressed={selectedIndex === index}
              aria-label={`Show ${site.name}, ${site.kind}`}
              onClick={() => setSelectedIndex(index)}
            >
              <span className="map-marker-dot" />
              <span className="map-marker-name">{site.name}</span>
            </Button>
          ))}
        </div>
        <aside className="details-aside map-details" aria-live="polite">
          <p className="eyebrow text-primary">{selectedSite.region} · {selectedSite.kind}</p>
          <h2>{selectedSite.name}</h2>
          <p>{selectedSite.description}</p>
          <Link className="text-link" to="/cultures/$slug" params={{ slug: selectedSite.culture }}>Explore the related people</Link>
          <h3>All mapped places</h3>
          <ul className="map-site-list">
            {mapSites.map((site, index) => <li key={site.name}>
              <Button variant={selectedIndex === index ? "default" : "ghost"} onClick={() => setSelectedIndex(index)} aria-pressed={selectedIndex === index}>
                <span>{site.name}</span><small>{site.region}</small>
              </Button>
            </li>)}
          </ul>
        </aside>
      </div>
    </section>
  </AcademyShell>;
}
