import './ui.css';

/**
 * The shared pieces of the Ozikoro administrator's area, in the owner's Design Studio vocabulary.
 *
 * ── THE DESIGN CHANGED, AND THIS FILE IS WHY THE WHOLE AREA CHANGED WITH IT ──────────────────────
 *
 * On 2026-10-06 the owner sent `ozikoro-design-studio-dashboard.html`:
 *
 *   *"replace the admin design we have with the one in this html, then make sure all the functions are
 *   working when done. copy the exact design here as it is far better than what you have as admin
 *   dashboard"*
 *
 * **Every one of the 39 screens in the back office draws its cards, its page header, its notices and
 * its sub-navigation through this file.** *So the design is applied here once, rather than in forty
 * pages — and a page that keeps using `Head`, `Card`, `Notices` and `Tabs` wears the new design without
 * knowing anything changed.*
 *
 * ── WHAT IT USED TO EMIT, KEPT HERE BECAUSE THE NEXT READER WILL WONDER ──────────────────────────
 *
 * It emitted the design deliverable's own dashboard classes — `sx-panel`, `sx-panel-head`,
 * `sx-panel-body` from `showcase.css`, and `admin-nav`, `pairs`, `notice` from the application's
 * `globals.css`. **That was right for the design it was written against, and it is the design the owner
 * has now replaced for the back office.** *The public archive still uses the handover's `sx-` vocabulary
 * and is untouched; only the working area changed.*
 *
 * ⚠️ **AND `Head` NOW DRAWS AN `<h2>` WHERE IT DREW AN `<h1>`, WHICH IS A CORRECTION.** The new shell's
 * top bar carries `<h1>Administration</h1>` — the owner's own markup, and the right outline for an area
 * whose pages are its subsections. `Head` was still emitting an `<h1>`, so **every admin page had two
 * first-level headings and a screen reader could not tell which named the page.** *The owner's design
 * puts the `<h1>` in the top bar and the page title in `.title-row h2`, so that is what this emits.*
 *
 * ⚠️ **AND A CARD IS AN `<h3>` NOW.** The owner's design draws `div.card-head > h3`; the heading level
 * moved with it. `Card` keeps its `aria-labelledby`, so the relationship a screen reader follows is the
 * same — only the level changed, which is what stops a page's outline from jumping from `<h2>` to a
 * body heading.
 */

export function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="title-row">
      <div>
        <h2>{title}</h2>
      </div>
      {children ? <div className="actions">{children}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  foot,
  quiet,
}: {
  title?: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
  /**
   * `quiet` marks the one card on a screen that is an aside rather than a work item.
   *
   * ⚠️ **IT IS KEPT RATHER THAN DROPPED, AND IT NO LONGER CHANGES ANYTHING.** *It used to select
   * `sx-panel--quiet` in `globals.css`; the owner's design has one card and no variant.* **Removing the
   * prop would have meant editing every call site for no visible gain, so it is accepted and ignored —
   * and that is said here rather than left for someone to discover by looking for a rule that is not
   * there.**
   */
  quiet?: boolean;
}) {
  void quiet;
  const id = title ? `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}` : undefined;
  return (
    <section className="card" aria-labelledby={id}>
      {title ? (
        <div className="card-head">
          <h3 id={id}>{title}</h3>
        </div>
      ) : null}
      <div className="card-body">{children}</div>
      {foot ? <div className="card-foot">{foot}</div> : null}
    </section>
  );
}

export function Notices({ saved, error, info }: { saved?: string; error?: string; info?: string }) {
  if (!saved && !error && !info) return null;
  return (
    <>
      {saved ? (
        <div className="notice notice--success" role="status">
          <div>
            <p className="notice__title">Done</p>
            <p className="notice__body">{saved}</p>
          </div>
        </div>
      ) : null}
      {info ? (
        <div className="notice notice--info">
          <div>
            <p className="notice__title">For information</p>
            <p className="notice__body">{info}</p>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="notice notice--error" role="alert">
          <div>
            <p className="notice__title">Not done</p>
            <p className="notice__body">{error}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A definition list of label and value: the connection facts, in the design's own two-column shape. */
export function AtAGlance({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="pairs">
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The sub-navigation a screen draws for its own sections.
 *
 * ⚠️ **PLAIN `<a>`, NOT `next/link`, AND THAT IS THE OWNER'S INSTRUCTION RATHER THAN AN OVERSIGHT.** *"i want
 * every page one clicks on the dashboards to be loading fully, instead of doing like it was cached already."*
 * The reason, the correctness argument behind it and the cost are written down once, above `railNav` in
 * `layout.tsx`; every link under `app/admin/` follows it. **The public archive does not** — these are the
 * back office's screens, which read what other back-office screens have just written.
 *
 * It wears the owner's `div.tabs > button.tab` shape, with an anchor in place of the button — `studio.css`
 * carries the one rule an anchor needs that a button does not, and the active entry is the design's own
 * bold-with-a-gold-rule state.
 */
export function Tabs({ tabs, active }: { tabs: { href: string; label: string }[]; active: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map((tab) => (
        <a
          key={tab.href}
          className={`tab${tab.href === active ? ' active' : ''}`}
          href={tab.href}
          aria-current={tab.href === active ? 'page' : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
