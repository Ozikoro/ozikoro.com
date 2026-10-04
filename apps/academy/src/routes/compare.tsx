import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AcademyShell } from "@/components/academy-shell";
import { PageIntro } from "@/components/academy-ui";
import { Button } from "@/components/ui/button";
import { cultures } from "@/data/academy";
import { meta } from "@/lib/meta";
export const Route = createFileRoute("/compare")({ head: () => meta("Compare African peoples", "Select and compare African peoples by geography, political organisation, worldview, archaeology, art and historical experience."), component: Page });
const rows = ["Geography and regions", "Political organisation", "Religion and worldview", "Archaeology", "Art, architecture and technology", "Colonial and modern history"];

function Page() {
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(["igbo", "yoruba"]);
  const selectedCultures = selectedSlugs.map((slug) => cultures.find((culture) => culture.slug === slug)).filter((culture) => culture !== undefined);

  const toggleCulture = (slug: string) => {
    setSelectedSlugs((current) => {
      if (current.includes(slug)) return current.length > 2 ? current.filter((item) => item !== slug) : current;
      return current.length < 3 ? [...current, slug] : current;
    });
  };

  return <AcademyShell>
    <PageIntro eyebrow="Compare African peoples" title="Study difference without flattening it." description="Choose two or three peoples to compare how place, institutions, belief, material culture and historical change shaped distinct African societies." />
    <section className="compare-workspace section-pad">
      <div className="site-wrap">
        <div className="compare-purpose">
          <div>
            <p className="eyebrow text-primary">Build your comparison</p>
            <h2>Select two or three peoples</h2>
            <p>This is a study aid, not a ranking. It places the same questions beside one another so similarities, differences and gaps in evidence are easier to examine.</p>
          </div>
          <p className="compare-count" aria-live="polite">{selectedSlugs.length} of 3 selected</p>
        </div>
        <div className="culture-picker" role="group" aria-label="Choose African peoples to compare">
          {cultures.map((culture) => {
            const isSelected = selectedSlugs.includes(culture.slug);
            const isDisabled = !isSelected && selectedSlugs.length === 3;
            return <Button key={culture.slug} type="button" variant={isSelected ? "default" : "outline"} aria-pressed={isSelected} disabled={isDisabled} onClick={() => toggleCulture(culture.slug)}>
              {culture.name}<span aria-hidden="true">{isSelected ? "✓" : "+"}</span>
            </Button>;
          })}
        </div>
        <p className="compare-guidance">To change your comparison, deselect one people and choose another. At least two remain selected.</p>
        <div className="compare-scroll" tabIndex={0} aria-label="Comparison table; scroll horizontally on smaller screens">
          <table className="compare-table">
            <thead><tr><th scope="col">Question</th>{selectedCultures.map((culture) => <th key={culture.slug} scope="col"><Link to="/cultures/$slug" params={{ slug: culture.slug }}>{culture.name}</Link><small>{culture.language}</small></th>)}</tr></thead>
            <tbody>{rows.map((row) => <tr key={row}><th scope="row">{row}</th>{selectedCultures.map((culture) => <td key={culture.slug}>{culture.facts[row] ?? <span className="text-muted-foreground">Evidence under review</span>}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>
  </AcademyShell>;
}
