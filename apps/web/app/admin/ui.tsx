import Link from 'next/link';

/**
 * The shared pieces of the admin, in the design's markup.
 *
 * Every admin screen is built from these, so putting the design here puts it on all of them at
 * once rather than screen by screen: `.page-header`, `.panel` with its head and body, `.notice`,
 * and the `.pairs` definition list.
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
}: {
  title?: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  const id = title ? `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}` : undefined;
  return (
    <section className="panel" aria-labelledby={id}>
      {title ? (
        <div className="panel__head">
          <h2 className="panel__title" id={id}>{title}</h2>
        </div>
      ) : null}
      <div className="panel__body">{children}</div>
      {foot ? <div className="panel__foot">{foot}</div> : null}
    </section>
  );
}

export function Notices({ saved, error }: { saved?: string; error?: string }) {
  if (!saved && !error) return null;
  return (
    <>
      {saved ? (
        <div className="notice notice--success" role="status">
          <div>
            <p className="notice__title">Saved</p>
            <p className="notice__body">{saved}</p>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="notice notice--error" role="alert">
          <div>
            <p className="notice__title">Not saved</p>
            <p className="notice__body">{error}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** The design's `.pairs`: a definition list of label and figure. */
export function AtAGlance({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="pairs">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string }[]; active: string }) {
  return (
    <nav className="filters" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.href}
          className={`btn btn--sm${t.href === active ? ' btn--primary' : ''}`}
          href={t.href}
          aria-current={t.href === active ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
