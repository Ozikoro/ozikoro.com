import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@ozituma/db/client';
import { readSettings } from '@ozituma/db/settings';
import { getCurrentAccount } from '@/lib/session';
import { DashboardNav, type NavGroup } from '@/components/dashboard-nav';
import '../dashboards.css';
import './contribute.css';

export const dynamic = 'force-dynamic';

/**
 * Dashboard A — the contributor's and the editor's, which is one dashboard.
 *
 * The design: a dark sidenav, a warm paper canvas, and the same shell an editor sees. The only
 * difference between the two is authority, so the only difference in here is whether the Review
 * queue entry exists and what the role line says.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentAccount();
  if (!current) redirect('/signin?error=Sign+in+to+contribute.');
  const { account } = current;
  const db = await getDb();
  const settings = await readSettings(db);

  const label = account.displayName ?? account.email;
  const initials = label
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  const role =
    account.role === 'owner'
      ? 'Owner'
      : account.role.charAt(0).toUpperCase() + account.role.slice(1);

  const groups: NavGroup[] = [
    {
      title: 'Overview',
      href: '/contribute',
    },
    {
      title: 'Your work',
      items: [
        { href: '/contribute/submissions', label: 'Your submissions' },
        { href: '/contribute/account', label: 'Account' },
        { href: '/contribute/profile', label: 'Public profile' },
      ],
    },
    {
      title: 'Add to the record',
      items: [
        { href: '/contribute/word', label: 'Word' },
        { href: '/contribute/name', label: 'Name' },
        { href: '/contribute/proverb', label: 'Proverb' },
        { href: '/contribute/clan', label: 'Clan or town' },
        { href: '/contribute/dialect', label: 'Dialect' },
        { href: '/contribute/recording', label: 'Recording' },
      ],
    },
    ...(current.canReview
      ? [
          {
            title: 'Editor',
            items: [{ href: '/review', label: 'Review queue', review: true }],
          } satisfies NavGroup,
        ]
      : []),
    ...(account.role === 'admin' || account.role === 'owner'
      ? [
          {
            title: 'Administration',
            items: [{ href: '/admin', label: 'Admin dashboard' }],
          } satisfies NavGroup,
        ]
      : []),
    {
      title: 'The site',
      items: [
        { href: '/', label: 'Dictionary' },
        { href: '/names', label: 'Names' },
        { href: '/clans', label: 'Clans' },
        { href: '/proverbs', label: 'Proverbs' },
      ],
    },
  ];

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        <DashboardNav
          label="Contributor dashboard"
          brandMark={settings['identity.siteName']}
          brandContext="Contribute"
          person={{ name: label, role, initials }}
          groups={groups}
        />
        <div className="shell__main">
          <main className="shell__content" id="main">{children}</main>
        </div>
      </div>
    </>
  );
}
