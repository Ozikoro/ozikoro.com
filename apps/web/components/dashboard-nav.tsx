'use client';

/**
 * The dashboard menu, in the designer's markup.
 *
 * The design: static HTML and CSS with no JavaScript, a dark sidenav, groups as native
 * `<details>`, an `aria-current` on the page you are on, and the signed-in person's avatar and
 * role at the foot. It is a client component for one reason only — it has to know the current
 * path to mark the item and open its group — and everything it renders works without it.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  /** Shown at the right of the row. */
  count?: string | number;
  /** The review queue gets the designer's accent treatment. */
  review?: boolean;
}

export interface NavGroup {
  /** A group with no items is a single link; one with items is a disclosure. */
  title: string;
  href?: string;
  items?: NavItem[];
}

export function DashboardNav({
  groups,
  label,
  brandMark,
  brandContext,
  person,
}: {
  groups: NavGroup[];
  label: string;
  brandMark: string;
  brandContext: string;
  person: { name: string; role: string; initials: string };
}) {
  const path = usePathname() ?? '';
  const here = (href: string) =>
    href === '/' ? path === '/' : path === href || path.split('?')[0] === href;
  const groupOpen = (g: NavGroup) =>
    Boolean(g.href && here(g.href)) || Boolean(g.items?.some((i) => here(i.href)));

  const link = (item: NavItem) => (
    <li key={item.href}>
      <Link
        className={`sidenav__link${item.review ? ' sidenav__link--review' : ''}`}
        href={item.href}
        aria-current={here(item.href) ? 'page' : undefined}
      >
        {item.label}
        {item.count !== undefined && item.count !== '' ? (
          <span className="sidenav__count">{item.count}</span>
        ) : null}
      </Link>
    </li>
  );

  return (
    <nav className="sidenav" aria-label={label}>
      <Link className="sidenav__brand" href="/">
        <span className="sidenav__mark">{brandMark}</span>
        <span className="sidenav__context">{brandContext}</span>
      </Link>

      {groups.map((g) =>
        g.items && g.items.length > 0 ? (
          <details className="sidenav__group" open={groupOpen(g)} key={g.title}>
            <summary>{g.title}</summary>
            <ul className="sidenav__list">{g.items.map(link)}</ul>
          </details>
        ) : (
          <ul className="sidenav__list" key={g.title}>
            {link({ href: g.href ?? '#', label: g.title })}
          </ul>
        )
      )}

      <div className="sidenav__foot">
        <span className="avatar" aria-hidden="true">{person.initials}</span>
        <span className="sidenav__who">
          <span className="sidenav__name">{person.name}</span>
          <span className="sidenav__role">{person.role}</span>
        </span>
      </div>
    </nav>
  );
}
