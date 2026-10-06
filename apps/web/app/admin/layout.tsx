import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@ozituma/db/client';
import { listSections } from '@ozituma/db/admin';
import { readSettings } from '@ozituma/db/settings';
import { getCurrentAccount } from '@/lib/session';
import { DashboardNav, type NavGroup } from '@/components/dashboard-nav';
import '../dashboards.css';
import './admin.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ozituma admin',
  robots: { index: false },
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  owner: 'Owner',
  editor: 'Editor',
  contributor: 'Contributor',
};

/**
 * Dashboard B — the administrator's.
 *
 * The design: the same vocabulary as Dashboard A at higher density and lower temperature. Same
 * sidenav, same badges, same panels, smaller padding, full width, tabular figures. The counts on
 * the menu entries come from the live tables.
 *
 * Only administrators and the owner get in. An editor is a contributor who can edit and review,
 * and the review queue is theirs; this is not.
 *
 * ⚠️ AND THE REFUSAL IS A `redirect()`, NOT A RENDERED PAGE. **This was a disclosure, not a
 * cosmetic choice.** The refusal used to `return` a "Not your door" page — and **a Next.js layout
 * and its child page render CONCURRENTLY**, so returning from the layout does not stop the child:
 * `GET /admin/users` answered 200 with the refusal *visible* and, **in the same response body, the
 * serialized RSC payload of the users table — every account's name, email and role.** Measured with
 * a contributor session; `GET /admin/words` carried its rows the same way. Any signed-in
 * contributor could read the whole account list out of the page they were told they could not see.
 *
 * `redirect()` throws, and Next aborts the render with it — so the child never runs and nothing of
 * it reaches the response. The destination is the one the refusal already named, which keeps the
 * design's intent (send them to the dashboard that IS theirs) while removing the leak.
 *
 * ⚠️ THE SAME SHAPE MUST NOT BE REINTRODUCED. **A guard in a layout that `return`s instead of
 * throwing does not guard anything** — it only changes what the page looks like while the data it
 * was meant to hide is still serialized behind it.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentAccount();
  if (!current) redirect('/signin?error=Sign+in+to+reach+the+admin.');
  const { account } = current;
  const role = account.role;
  if (role !== 'admin' && role !== 'owner') {
    // Throws, so the child page is never rendered and never serialized. See the note above.
    redirect('/contribute?notice=admins-only');
  }

  const db = await getDb();
  const [settings, sections] = await Promise.all([readSettings(db), listSections(db)]);
  const count = (key: string) => sections.find((s) => s.key === key)?.live.toLocaleString();

  const label = account.displayName ?? account.email;
  const initials = label
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  const groups: NavGroup[] = [
    { title: 'Dashboard', href: '/admin' },
    {
      title: 'The record',
      items: [
        { href: '/admin/words', label: 'Words', count: count('words') },
        { href: '/admin/names', label: 'Names', count: count('names') },
        { href: '/admin/clans', label: 'Clans', count: count('clans') },
        { href: '/admin/proverbs', label: 'Proverbs', count: count('proverbs') },
        { href: '/admin/recordings', label: 'Recordings', count: count('recordings') },
        { href: '/admin/submissions', label: 'Submissions', count: count('submissions') },
      ],
    },
    {
      title: 'People',
      items: [
        { href: '/admin/users', label: 'Users' },
        { href: '/admin/users/new', label: 'Add account' },
        { href: '/review', label: 'Review queue', review: true },
      ],
    },
    {
      title: 'The site',
      items: [
        { href: '/admin/appearance', label: 'Appearance' },
        { href: '/admin/layout', label: 'Front page layout' },
        { href: '/admin/ads', label: 'Advertisements' },
        { href: '/admin/analytics', label: 'Analytics' },
        { href: '/admin/settings', label: 'Settings' },
        /*
         * `{ href: '/admin/learn', label: 'Learn subdomain' }` WAS HERE AND IS GONE WITH ITS PAGE.
         *
         * That screen described `learn.ozituma.com` — which container served it, which database it used,
         * and that a change deployed here was deployed there. **The host is being retired, so the page
         * went with it**: an administrator screen about a subdomain that is going away is an instruction
         * to maintain something that no longer exists. `academy.ozikoro.com` will be a separate
         * application with its own deployment and its own admin, so it is not administered from this
         * menu either.
         */
        { href: '/admin/record', label: 'Record settings' },
      ],
    },
  ];

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell shell--admin">
        <DashboardNav
          label="Administration"
          brandMark={settings['identity.siteName']}
          brandContext="Admin"
          person={{ name: label, role: ROLE_LABEL[role] ?? role, initials }}
          groups={groups}
        />
        <div className="shell__main">
          <div className="topbar">
            <span className="topbar__title">Administration</span>
            <span className="u-sm u-faint">ozituma.com</span>
            <div className="topbar__spacer" />
            <form className="topbar__search" method="get" action="/admin/words" role="search">
              <label className="visually-hidden" htmlFor="admin-q">Search the record</label>
              <input id="admin-q" name="q" type="text" placeholder="Search the record…" />
              <button className="btn btn--sm" type="submit">Search</button>
            </form>
            <Link className="btn btn--sm" href="/contribute">Contributor view</Link>
          </div>
          <main className="shell__content" id="main">{children}</main>
        </div>
      </div>
    </>
  );
}
