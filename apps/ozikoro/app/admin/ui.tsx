/**
 * The shared pieces of the Ozikoro administrator's area.
 *
 * ── THESE ARE THE DESIGN'S OWN PRIMITIVES, WHICH THEY WERE NOT ───────────────────────────────────────────
 *
 * The owner: *"i clicked on it to see the admin, and it was completely scattred. this is not exactly as it was
 * in the demo."* The demo is `public/design/screens/dashboard-admin.html`, and where it draws a card it draws
 *
 *     section.sx-panel > div.sx-panel-head > h2
 *                      > div.sx-panel-body
 *
 * — `showcase.css:276`, from the same `.sx-` vocabulary as the rest of the dashboard. This file was written
 * against a private set of `.panel__head` / `.panel__body` names in the application's own `globals.css`
 * instead, so **every card in the back office was drawn by a stylesheet the design has never seen** and none of
 * them matched the screen the owner was comparing against.
 *
 * The three primitives below are that same markup, one for one. `sx-panel` is the design's; the only class this
 * file adds is `sx-panel--quiet`, for the one card that is an aside rather than a work item, and it is defined
 * in `globals.css` beside the rest of the administration's own additions.
 *
 * Kept to the same vocabulary as the dictionary's admin (`apps/web/app/admin/ui.tsx`): a page header, a panel
 * with a head and body, notices, and a label/value list. The design brief says the public site and the working
 * back office are two designs for one institution and should share a foundation, and reusing these primitives
 * is the cheapest way to keep that true.
 */

export function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="sx-dash-title">
      <div>
        <h1>{title}</h1>
      </div>
      {children ? <div className="row">{children}</div> : null}
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
  quiet?: boolean;
}) {
  const id = title ? `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}` : undefined;
  return (
    <section className={`sx-panel${quiet ? ' sx-panel--quiet' : ''}`} aria-labelledby={id}>
      {title ? (
        <div className="sx-panel-head">
          <h2 id={id}>{title}</h2>
        </div>
      ) : null}
      <div className="sx-panel-body">{children}</div>
      {foot ? <div className="sx-panel-foot">{foot}</div> : null}
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

/** A definition list of label and value: the connection facts. */
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
 */
export function Tabs({ tabs, active }: { tabs: { href: string; label: string }[]; active: string }) {
  return (
    <nav className="admin-nav" aria-label="Sections">
      <div className="admin-nav__inner">
        {tabs.map((tab) => (
          <a key={tab.href} href={tab.href} aria-current={tab.href === active ? 'page' : undefined}>
            {tab.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
