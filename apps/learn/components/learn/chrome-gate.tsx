'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Hides the site chrome on pages that bring their own.
 *
 * The dashboard at `/` IS the design, and the design includes its own sticky header and its own
 * mobile bottom navigation. Rendering the app's chrome as well would stack two headers and two
 * bottom bars on one screen.
 *
 * A client component because the decision is a route, and reading the route is a browser concern.
 * The alternative — two route groups with two layouts — would mean the session and host resolution
 * in `layout.tsx` duplicated, for one page.
 *
 * WHY ONLY `/` IS EXEMPT
 *
 * Every other page (practice, plan, progress, tutor, review, ndebe) was built before the design
 * arrived and relies on this chrome. They are due the same treatment, and as each one is rebuilt to
 * the design it moves into this list. Until then they keep working rather than losing their
 * navigation.
 */
export function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/') return null;
  return <>{children}</>;
}
