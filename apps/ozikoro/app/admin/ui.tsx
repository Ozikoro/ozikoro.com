import Link from 'next/link';

/**
 * The shared pieces of the Ozikoro administrator's area.
 *
 * Kept to the same vocabulary as the dictionary's admin (`apps/web/app/admin/ui.tsx`): a page
 * header, a panel with a head and body, notices, and a label/value list. The design brief says
 * the public site and the working back office are two designs for one institution and should
 * share a foundation, and reusing these primitives is the cheapest way to keep that true while
 * the public design is still being drawn.
 */

export function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1 className="page-header__title">{title}</h1>
      </div>
      {children ? <div className="page-header__actions">{children}</div> : null}
    </header>
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
    <section className={`panel${quiet ? ' panel--quiet' : ''}`} aria-labelledby={id}>
      {title ? (
        <div className="panel__head">
          <h2 className="panel__title" id={id}>
            {title}
          </h2>
        </div>
      ) : null}
      <div className="panel__body">{children}</div>
      {foot ? <div className="panel__foot">{foot}</div> : null}
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

export function Tabs({ tabs, active }: { tabs: { href: string; label: string }[]; active: string }) {
  return (
    <nav className="admin-nav" aria-label="Sections">
      <div className="admin-nav__inner">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} aria-current={tab.href === active ? 'page' : undefined}>
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
