'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * The site navigation, which folds away on a narrow screen.
 *
 * THE OWNER'S REPORT
 *
 * "on the mobile, please there should be a way to make the menu look better. it is
 * scattered as it loaded all the menus there, thereby taking huge space in the
 * begining."
 *
 * He is describing exactly what the CSS did. `.site-nav` is a flex row of ten links with
 * `flex-wrap: wrap`, and the only narrow-screen rule shrank the font and the gap — so on
 * a phone the ten links wrapped into four or five ragged rows inside the sticky header,
 * filling the first screenful of every page with navigation before any content appeared.
 * Ten items is not too many for a menu; it is too many to lay out as a row when the row
 * cannot fit.
 *
 * WHAT THIS DOES INSTEAD
 *
 * On a narrow screen the links go behind one "Menu" button and the header is a single
 * row again. Above 640px the button is hidden and the links are laid out exactly as they
 * were, so nothing changes on a desktop.
 *
 * WHY IT IS A CLIENT COMPONENT AND NOT `<details>`
 *
 * `<details>` is the obvious no-JavaScript answer and it was the first attempt, but it
 * cannot be closed on a wide screen and open-by-default on a narrow one without relying
 * on the browser honouring an author rule that overrides its own `details:not([open])`
 * styling — which browsers do not all do. That would have put a stray summary line in the
 * desktop header or hidden the whole navigation on a desktop, depending on the browser.
 * A button with `aria-expanded` does the job deterministically, and it is the pattern the
 * reader already knows.
 */
export function NavMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);

  /*
   * Close on navigation.
   *
   * The menu is opened to reach a page, so leaving it open would cover the page it just
   * delivered. Watching the path is more reliable than a click handler on each link:
   * following the same-link case, or a link that redirects, still closes it.
   */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it, which is what a reader expects of anything that overlays content.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="nav-toggle-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        Menu
      </button>
      {/*
        `data-open` rather than a class: the panel's open state is a fact about this
        element, and the stylesheet reads it as one.
      */}
      <nav
        id={id}
        ref={nav}
        className="site-nav"
        data-open={open ? 'true' : 'false'}
        aria-label="Main"
      >
        {children}
      </nav>
    </>
  );
}
