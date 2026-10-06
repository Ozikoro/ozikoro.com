/**
 * WHO IS LOOKING, WHICH WORKSPACES THEY MAY OPEN, AND WHICH ONE THEY CHOSE.
 *
 * WHY THIS IS ONE FUNCTION AND NOT THREE
 *
 * The same three answers are needed in three places that cannot share a React tree:
 *
 *   the design screens, at serve time     `app/design-screen/[screen]/route.ts` splices the switch into
 *                                         the deliverable's own markup
 *   the administration's navigation       `app/admin/layout.tsx` lists the workspaces its viewer may open
 *   the public masthead                   `app/layout.tsx`, so a signed-in person can reach a workspace
 *                                         from any page of the application rather than only from one
 *
 * **A second copy of "which modes may this account enter" is a copy that drifts**, and the drift would be a
 * link offered to somebody the screen then refuses. So the allow-list lives in `@ozikoro/platform`
 * (`dashboard-modes.ts`), the database supplies the capabilities through `capabilitiesFor` — which is
 * `ozikoro_capabilities`, the same authority every gated action asks — and this file is only the seam that
 * joins them to a session and a cookie.
 *
 * THE COOKIE IS READ, NEVER TRUSTED
 *
 * `ozikoro_dashboard_mode` records the workspace a person chose. It is a value a browser sends, so it goes
 * through `rememberedDashboardMode`, which resolves it against the allow-list and returns null when the name
 * is unknown or the account may no longer enter it. A revoked role therefore cannot leave somebody standing
 * in a screen the revocation removed, and the fallback is the reader's own workspace.
 */
import { cookies } from 'next/headers';
import { getDb } from '@ozituma/db/client';
import {
  accountItemFor,
  capabilitiesFor,
  dashboardModesFor,
  describeRoles,
  DASHBOARD_MODE_COOKIE,
  primaryDashboardHref,
  rememberedDashboardMode,
  type DashboardMode,
  type ModeSwitcherViewer,
  type ViewerIdentity,
} from '@ozikoro/platform';
import { getCurrentAccount } from './session';
import { mayEnterBackOffice } from './access';

/** A signed-in person's standing in the archive, as every page in this application needs it. */
export type WorkspaceViewer = {
  signedIn: boolean;
  /** What a refusal and the switch should call them. */
  identity: ViewerIdentity;
  /** Their platform role, which is what lets the proprietor see the whole archive. */
  platformRole: string | null;
  /** The capabilities the database resolved. */
  capabilities: Set<string>;
  /** Every workspace they may open, in the deliverable's order. */
  modes: DashboardMode[];
  /** The workspace their cookie names, when they may still open it. */
  remembered: DashboardMode | null;
  /** Where a generic "your workspace" link should go. */
  primaryHref: string;
  /** The back office, when they may enter it — and null when they may not, so no link is offered. */
  adminHref: string | null;
};

/** Somebody who is not signed in: no roles, no workspaces, and the two open addresses. */
function signedOut(): WorkspaceViewer {
  return {
    signedIn: false,
    identity: { signedIn: false, name: null, roleLabel: null },
    platformRole: null,
    capabilities: new Set<string>(),
    modes: [],
    remembered: null,
    primaryHref: '/dashboard-reader',
    adminHref: null,
  };
}

/**
 * The viewer, from the session cookie and the database.
 *
 * A failure to read the database is **not** allowed to take a page down: the same treatment the design
 * screens give a fill that throws applies here, and the viewer degrades to "signed in, holding nothing",
 * which shows no switch and offers no workspace. That is the safe direction — the alternative is a page
 * that 500s because it could not work out which menu to draw.
 */
export async function workspaceViewer(): Promise<WorkspaceViewer> {
  const current = await getCurrentAccount().catch(() => null);
  if (!current) return signedOut();

  const account = current.account;
  try {
    const db = await getDb();
    const capabilities = await capabilitiesFor(db, account.id);
    const rows = await db.rows<{ role: string }>(
      `select role from ozikoro_member_role where account_id = $1`,
      [account.id]
    );
    const dashboardViewer = { platformRole: account.role as string, capabilities };
    const remembered = rememberedDashboardMode((await cookies()).get(DASHBOARD_MODE_COOKIE)?.value, dashboardViewer);
    const roleLabel = describeRoles(account.role, rows.map((row) => row.role));
    const name = account.displayName ?? account.email ?? null;

    return {
      signedIn: true,
      identity: { signedIn: true, name, roleLabel },
      platformRole: account.role,
      capabilities,
      modes: dashboardModesFor(dashboardViewer),
      remembered,
      primaryHref: primaryDashboardHref(remembered, dashboardViewer),
      adminHref: mayEnterBackOffice(account.role, capabilities) ? '/admin/' : null,
    };
  } catch (error) {
    console.error('workspace-modes: could not resolve the viewer', error);
    return {
      ...signedOut(),
      signedIn: true,
      identity: { signedIn: true, name: account.displayName ?? account.email ?? null, roleLabel: 'Reader' },
      platformRole: account.role,
    };
  }
}

/** The switch's own view of a viewer, for the screen they are on. */
export function switcherFor(viewer: WorkspaceViewer, currentMode: string | null): ModeSwitcherViewer {
  /*
   * THE ACCOUNT LINK GOES INTO THE CONTROL, BECAUSE IN THE MASTHEAD THE CONTROL IS THE ACCOUNT ITEM.
   *
   * It used to be a separate `<li>` beside the switch, and a signed-in reader with an elevated workspace
   * therefore got one more item than a signed-out one — which is the row that wrapped. It is carried
   * here rather than assembled by each caller so the label rule ("My account" only when the destination
   * really is the account) exists once — `accountItemFor` in `@ozikoro/platform`, which is also where
   * the administrator's case is decided: **an account that may administer the site is offered the
   * account item and no workspace switch in the menu**, so for it this link is always `My account`.
   */
  const account = accountItemFor({
    signedIn: viewer.signedIn,
    platformRole: viewer.platformRole,
    primaryHref: viewer.primaryHref,
  });
  return {
    signedIn: viewer.signedIn,
    name: viewer.identity.name,
    roleLabel: viewer.identity.roleLabel,
    platformRole: viewer.platformRole,
    modes: viewer.modes,
    currentMode,
    adminHref: viewer.adminHref,
    accountHref: account?.href ?? null,
    accountLabel: account?.label,
  };
}
