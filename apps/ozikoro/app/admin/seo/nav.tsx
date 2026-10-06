import { Tabs } from '../ui';
import { SEO_SECTIONS, seoSectionHref } from './sections';

/**
 * The search-engine area's own nav, drawn by every section screen.
 *
 * ── WHY IT IS A COMPONENT RATHER THAN SIX COPIES OF THE SAME MAP ─────────────────────────────────────
 *
 * The owner's second request was *"everything must not show on same page"*, and the thing that makes six
 * screens a section rather than six orphans is that each one shows where the others are. Six copies of that
 * list is six places to forget a rename — so the list is `SEO_SECTIONS` and this is the one place it is drawn.
 *
 * It uses the `Tabs` primitive the rest of the back office already uses (`app/admin/ui.tsx`), which renders
 * `nav.admin-nav` with `aria-current="page"` on the active entry — so the current section is announced to a
 * screen reader rather than only coloured.
 */
export function SeoNav({ active }: { active: string }) {
  return (
    <Tabs
      active={seoSectionHref(active)}
      tabs={SEO_SECTIONS.map((section) => ({ href: seoSectionHref(section.slug), label: section.label }))}
    />
  );
}
