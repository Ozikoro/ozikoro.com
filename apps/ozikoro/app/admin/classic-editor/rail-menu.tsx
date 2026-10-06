'use client';

/**
 * The Posts / Pages menu, drawn as a menu rather than as a list of every link at once.
 *
 * ── WHAT THE OWNER SAW, AND WHAT HE ASKED FOR ───────────────────────────────────────────────────────
 *
 * He pasted the section's own navigation as it rendered —
 *
 *     Posts · All Posts · Add New Post · Categories · Tags · Pages · All Pages ·
 *     The archive · Editorial queue · Trash
 *
 * — and asked for it to behave like the back office this screen is modelled on: *"the entire posts section
 * supposed to be opening like wordpress drop-down, instead of all plastered on the writing page like this."*
 * There, `Posts` and `Pages` are MENUS: the rail shows the top-level entries, a triangle toggles one open,
 * the submenu items are indented underneath it, and the section you are in is open when you arrive.
 *
 * ── WHERE THAT FLAT LIST ACTUALLY WAS, MEASURED RATHER THAN GUESSED ──────────────────────────────────
 *
 * It was **not** the archive's shared rail in `app/admin/layout.tsx` — that file's own section list does not
 * contain "All Posts", "Add New Post", "Categories" or "Tags" at all. It was `ClassicRail` in
 * `./screens.tsx`, which drew three `wprail__group` blocks that each printed their heading and their `<ul>`
 * unconditionally. This component replaces that markup one-for-one: **the same groups, the same links, the
 * same `aria-current` on the screen you are on** — the difference is that a group's list is now behind its
 * heading.
 *
 * ── WHY THE STATE IS IN THE BROWSER ─────────────────────────────────────────────────────────────────
 *
 * It is a preference about a menu, not a fact about a record, and it belongs where the menu is drawn.
 * `localStorage` is keyed by group (`ozikoro.rail.posts`, `ozikoro.rail.pages`, `ozikoro.rail.archive`), so
 * a group collapsed on one screen stays collapsed on the next — which is what a person expects of a menu they
 * have arranged. **The group holding the current screen opens by default when nothing is remembered**, which
 * is the part of this behaviour that matters most: arriving at Tags must show you Tags.
 */
import { useEffect, useState } from 'react';

const STORAGE_PREFIX = 'ozikoro.rail.';

export interface RailLink {
  href: string;
  label: string;
}

export interface RailGroup {
  /** Stable across visits, and the key this group's remembered state lives under. */
  key: string;
  heading: string;
  links: RailLink[];
}

export function RailMenu({ groups, active, label }: { groups: RailGroup[]; active: string; label: string }) {
  /**
   * Which groups are open.
   *
   * `null` means "nothing has been decided yet" and the answer is the active group — computed here rather
   * than in state so that a screen with no stored preference always opens on itself. A stored value, once
   * read in the effect below, wins over that default for every group it names.
   */
  const [openKeys, setOpenKeys] = useState<string[] | null>(null);
  const [stored, setStored] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const found: Record<string, boolean> = {};
    try {
      for (const group of groups) {
        const value = window.localStorage.getItem(STORAGE_PREFIX + group.key);
        if (value === 'open') found[group.key] = true;
        if (value === 'closed') found[group.key] = false;
      }
    } catch {
      /* A browser that refuses storage still gets a menu that opens; it just forgets. */
    }
    setStored(found);
  }, [groups]);

  const fallsBackToActive = groups.filter((group) => group.links.some((link) => link.href === active)).map((g) => g.key);
  const open = openKeys ?? fallsBackToActive;

  function isOpen(group: RailGroup): boolean {
    if (Object.prototype.hasOwnProperty.call(stored, group.key)) return stored[group.key]!;
    return open.includes(group.key);
  }

  function toggle(group: RailGroup) {
    const next = !isOpen(group);
    setStored((current) => ({ ...current, [group.key]: next }));
    // The click is the decision, so from here on the open set is explicit rather than the active fallback.
    setOpenKeys((current) => {
      const base = current ?? fallsBackToActive;
      return next ? [...new Set([...base, group.key])] : base.filter((key) => key !== group.key);
    });
    try {
      window.localStorage.setItem(STORAGE_PREFIX + group.key, next ? 'open' : 'closed');
    } catch {
      /* See above: the menu opens, the memory does not. */
    }
  }

  return (
    <nav className="wprail" aria-label={label}>
      <ul className="wprail__menu">
        {groups.map((group) => {
          const expanded = isOpen(group);
          const panelId = `wprail-panel-${group.key}`;
          // The design gives the parent of the CURRENT screen its own blue bar (`.parent-link.active`), so
          // the section you are in is visible even when its submenu is folded away.
          const holdsActive = group.links.some((link) => link.href === active);
          return (
            <li className={`wprail__group${expanded ? ' wprail__group--open' : ''}`} key={group.key}>
              {/*
                THE HEADING IS THE CONTROL AND IT KEEPS ITS PLACE. The bar does not change height when the menu
                folds, so the rail does not jump under the pointer — the same reason the boxes in the right
                column keep their title bars. The chevron is the design's own (`▾`, rotated a quarter turn
                while the submenu is closed).
              */}
              <button
                type="button"
                className={`wprail__heading${holdsActive ? ' is-active' : ''}`}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(group)}
              >
                <span>{group.heading}</span>
                <span className="wprail__arrow" aria-hidden="true">
                  ▾
                </span>
              </button>
              <ul className="wprail__submenu" id={panelId} hidden={!expanded}>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} aria-current={active === link.href ? 'page' : undefined}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
