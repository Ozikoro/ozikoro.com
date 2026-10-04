/**
 * WHICH WORKSPACES AN ACCOUNT MAY LOOK AT, AND THE ONE CONTROL THAT SAYS SO TRUTHFULLY.
 *
 * THE FAULT THIS REPLACES
 *
 * EVERY RAIL DASHBOARD IN THE DELIVERABLE CARRIED A `<details class="sx-role-switch">` offering nine
 * workspaces — Reader, Student, Teacher, Researcher, Independent Researcher, Community Knowledge Holder,
 * Editor, Expert Reviewer, Admin. It was a walkthrough control for a reviewer of the design, and there was
 * never a product feature behind it. Served as the live site it told the owner something untrue: measured,
 * `/dashboard-admin/` showed his own name under the word *Administrator*, and `/dashboard-reader/` showed
 * the same name under *Reader*. **A recorded role is a fact, and a control that appears to change it is a
 * lie about who is signed in** — which is why the round that removed it did so.
 *
 * Measured against the deliverable rather than remembered: the switch is on **nine** of the fourteen
 * dashboards — the nine drawn with a rail — and the five it drew without one (`account`, `moderation`,
 * `review`, `states`, `workflow`) never had it. `dashboard-modes.test.ts` asserts that count, because the
 * number is what the splice's three placements exist for.
 *
 * THE TRUTH THIS TELLS INSTEAD
 *
 * The control this module builds says three things, and all three are checkable:
 *
 *   who is signed in        "Signed in as Idenze Ezeme · Owner" — the person AND their role
 *   which workspace         "you are viewing the Editorial desk" — the workspace, named as a workspace
 *   what may be entered     only the workspaces this account's own capabilities open, and nothing else
 *
 * The distinction that matters is between `Editor` (a role a person holds) and `Editorial desk` (a screen
 * they are looking at). The design's switch used the first; every label here is the second, and the
 * person's roles are printed separately.
 *
 * WHERE THE ALLOW-LIST COMES FROM
 *
 * A workspace is offered when the account holds the capability the archive already associates with that
 * work — `edit_entity` for the editorial desk, `moderate` for the moderation queue, `publish` for the
 * publishing workflow. **No capability is invented, granted or widened to make a menu item appear**; the
 * capability vocabulary and the resolution both stay in the database (`ozikoro_capabilities`, migration
 * 0043), and `can`/`capabilitiesFor` remain the house test. A workspace whose capability the account lacks
 * is simply not offered, and an address that names it is refused with a sentence rather than served.
 *
 * The three workspaces every signed-in person may open — the reader's, the account page and the state
 * reference — are marked with `capability: null`. They are the archive's floor, not a permission.
 */

import { OZIKORO_ROLES, isOzikoroRole, roleLabel } from './members.ts';

/** What a workspace is, where it lives, and the capability that opens it. */
export type DashboardMode = {
  /** The name the workspace has in an address: `?mode=editor`. */
  mode: string;
  /** The design screen it is served from, and therefore its address: `/dashboard-editor/`. */
  screen: string;
  /**
   * The workspace's own name.
   *
   * A SCREEN, NOT A ROLE. Every one of these is the design's own name for the workspace, and none of them
   * is a claim about the person reading it — which is exactly what `roleLabel` below is for.
   */
  label: string;
  /** The archive role this workspace was drawn for, used only to explain a refusal. */
  roleLabel: string;
  /** The capability that opens it, or null for the three every account holds. */
  capability: string | null;
};

/**
 * THE FOURTEEN WORKSPACES THE DELIVERABLE DRAWS.
 *
 * The list is the directory's own: `apps/ozikoro/public/design/screens/dashboard-*.html`, counted rather
 * than remembered. Eleven of them answer a role, one is the account page, one is the publishing workflow
 * and one is the design's state reference.
 *
 * `dashboard-moderation` and `dashboard-review` are not among the twelve screens the owner originally
 * listed, and `dashboard-account` is not a role workspace at all; they are here because the owner asked to
 * be able to see *any* part of the profile, and because leaving three dashboards out of the switch would
 * put the reader back where this round started — able to reach a screen and unable to move from it.
 */
export const DASHBOARD_MODES: DashboardMode[] = [
  { mode: 'reader', screen: 'dashboard-reader', label: 'Reader workspace', roleLabel: 'Reader', capability: null },
  { mode: 'student', screen: 'dashboard-student', label: 'Student workspace', roleLabel: 'Student', capability: 'submit_work' },
  { mode: 'teacher', screen: 'dashboard-teacher', label: 'Teacher workspace', roleLabel: 'Teacher', capability: 'submit_work' },
  { mode: 'researcher', screen: 'dashboard-researcher', label: 'Research workspace', roleLabel: 'Researcher', capability: 'research_profile' },
  {
    mode: 'independent-researcher',
    screen: 'dashboard-independent-researcher',
    label: 'Independent research workspace',
    roleLabel: 'Independent researcher',
    capability: 'research_profile',
  },
  {
    mode: 'knowledge-holder',
    screen: 'dashboard-knowledge-holder',
    label: 'Community archive workspace',
    roleLabel: 'Community knowledge holder',
    capability: 'contribute_oral_history',
  },
  { mode: 'editor', screen: 'dashboard-editor', label: 'Editorial desk', roleLabel: 'Editor', capability: 'edit_entity' },
  { mode: 'reviewer', screen: 'dashboard-reviewer', label: 'Review workspace', roleLabel: 'Expert reviewer', capability: 'expert_review' },
  { mode: 'moderation', screen: 'dashboard-moderation', label: 'Moderation queue', roleLabel: 'Moderator', capability: 'moderate' },
  { mode: 'review', screen: 'dashboard-review', label: 'Evidence review', roleLabel: 'Expert reviewer', capability: 'expert_review' },
  { mode: 'workflow', screen: 'dashboard-workflow', label: 'Publishing workflow', roleLabel: 'Editor', capability: 'publish' },
  { mode: 'admin', screen: 'dashboard-admin', label: 'Administration workspace', roleLabel: 'Administrator', capability: 'manage_users' },
  { mode: 'account', screen: 'dashboard-account', label: 'Account & profile', roleLabel: 'Reader', capability: null },
  { mode: 'states', screen: 'dashboard-states', label: 'Workspace states', roleLabel: 'Reader', capability: null },
];

/** The three workspaces with no capability above them: the floor every signed-in person stands on. */
export const OPEN_DASHBOARD_MODES: string[] = DASHBOARD_MODES.filter((m) => m.capability === null).map((m) => m.mode);

/**
 * WHERE THE CHOSEN WORKSPACE IS REMEMBERED BETWEEN PAGES.
 *
 * A cookie, and not only the query parameter, because the parameter lives in one address: a link inside a
 * dashboard goes to `/account/`, to `/admin/archive/` or to `/`, and **the workspace would silently reset
 * to the reader's the moment the reader followed one.** The cookie is what makes the masthead's account
 * link and the administration's workspace links return a person to the dashboard they were actually in.
 *
 * IT IS NEVER TRUSTED. Every read is validated against the same allow-list the parameter is, so a cookie
 * naming a workspace the account may no longer open is ignored rather than obeyed — a revoked role must
 * not leave somebody standing in a screen the revocation removed.
 */
export const DASHBOARD_MODE_COOKIE = 'ozikoro_dashboard_mode';

/** How long the chosen workspace is remembered. Long enough to survive a session, not a year. */
export const DASHBOARD_MODE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** A viewer, as every rule in this module needs them. */
export type DashboardViewer = {
  /** The account's platform role: `contributor`, `editor`, `admin`, `owner`. */
  platformRole?: string | null;
  /** The capabilities the database resolved for them. */
  capabilities: ReadonlySet<string>;
};

/** The workspace a design screen is, or undefined for a screen that is not one. */
export function dashboardModeForScreen(screen: string): DashboardMode | undefined {
  return DASHBOARD_MODES.find((m) => m.screen === screen);
}

/** The workspace an address's `?mode=` names, or undefined when it names nothing this archive has. */
export function dashboardModeForSlug(slug: string): DashboardMode | undefined {
  return DASHBOARD_MODES.find((m) => m.mode === slug);
}

/**
 * Whether `viewer` may look at `mode`.
 *
 * THE OWNER SEES THE WHOLE ARCHIVE, AND THAT IS NOT A CAPABILITY BEING GRANTED.
 *
 * The proprietor of the record may open any of its workspaces. This is a statement about a *view* — which
 * screen is drawn — and it adds nothing to what anybody may do: it cannot publish a record, grant a role
 * or read a private table entry. It is written here rather than left to the capability table because
 * migration 0044 gives the owner role every capability in the vocabulary **as a list, deliberately, so
 * that adding a capability does not silently hand it to one person** — and the owner's platform role can
 * therefore be the one source of "sees everything" that cannot drift when the vocabulary grows.
 *
 * The platform administrator deliberately does NOT get this. The owner asked for *an admin sees what their
 * capabilities cover*, and an administrator does not hold `expert_review` — so the review workspaces are
 * not offered to them, which is the correct answer rather than a gap.
 */
export function mayEnterDashboardMode(mode: DashboardMode, viewer: DashboardViewer): boolean {
  if (String(viewer.platformRole ?? '').toLowerCase() === 'owner') return true;
  if (mode.capability === null) return true;
  return viewer.capabilities.has(mode.capability);
}

/** Every workspace this viewer may open, in the deliverable's own order. */
export function dashboardModesFor(viewer: DashboardViewer): DashboardMode[] {
  return DASHBOARD_MODES.filter((mode) => mayEnterDashboardMode(mode, viewer));
}

/**
 * Whether the viewer has anything the switch is for.
 *
 * A reader holding nothing but the floor sees **nothing** — not a disabled control, not an empty menu.
 * That is the brief's own rule, and it is the same page they had before this module existed.
 */
export function hasElevatedDashboardModes(modes: readonly DashboardMode[]): boolean {
  return modes.some((mode) => mode.capability !== null);
}

/** What a request for a workspace resolves to. */
export type DashboardModeDecision =
  | { kind: 'show'; mode: DashboardMode }
  | { kind: 'redirect'; to: string }
  | { kind: 'refuse'; reason: 'unknown' | 'forbidden'; sentence: string };

/** Who the refusal should name. */
export type ViewerIdentity = {
  /**
   * Whether anybody is signed in.
   *
   * REQUIRED, AND NOT DEFAULTED, because the refusal sentence is built from it: **a signed-out visitor was
   * being told "you are signed in as this account"**, which is the same family of untruth this round exists
   * to remove. Nobody signed in gets told that instead.
   */
  signedIn: boolean;
  name: string | null;
  /** The roles they actually hold, already rendered: `Owner`, `Editor, Moderator`. */
  roleLabel: string | null;
};

/** `Idenze Ezeme (Owner)`, or as much of it as is known. */
function describe(identity: ViewerIdentity): string {
  const who = identity.name?.trim();
  const role = identity.roleLabel?.trim();
  if (who && role) return `${who} (${role})`;
  return who ?? role ?? 'this account';
}

/** Who is looking, for the half-sentence that ends a refusal. */
function whoIsLooking(identity: ViewerIdentity): string {
  return identity.signedIn
    ? `and you are signed in as ${describe(identity)}.`
    : 'and nobody is signed in on this browser.';
}

/**
 * THE DECISION, IN ONE PLACE, SO THE ROUTE AND THE TESTS CANNOT DISAGREE.
 *
 * Three outcomes and no fourth: show this workspace, move to the workspace's own address, or refuse with a
 * sentence. **There is deliberately no outcome that quietly serves a different workspace** — the fault this
 * whole feature exists to remove is a control that appears to work and shows somebody something else.
 *
 * The `requested` parameter is an allow-list read, never a passthrough: it is looked up in
 * `DASHBOARD_MODES` and then tested against the account's capabilities. A hand-typed `?mode=admin` from a
 * reader is refused, and so is a name that is not a workspace at all.
 */
export function decideDashboardMode(input: {
  /** The workspace of the screen being served. */
  screenMode: DashboardMode;
  /** The `?mode=` value, or null when the address did not carry one. */
  requested: string | null;
  viewer: DashboardViewer;
  identity: ViewerIdentity;
}): DashboardModeDecision {
  const { screenMode, requested, viewer, identity } = input;

  if (requested !== null) {
    const authorised = authoriseRequested(requested, viewer, identity);
    if (authorised.kind !== 'show') return authorised;
    /*
     * THE RIGHT WORKSPACE AT THE WRONG ADDRESS MOVES RATHER THAN BEING REFUSED.
     *
     * `/dashboard-reader?mode=editor` names a workspace this account may open, and the page under that
     * address is not it. Serving the editorial desk at the reader's address would make the address a lie,
     * and refusing an address that the switch itself hands out would be a control that does not work. So
     * the request is sent to the workspace's own address, with the parameter intact — a real HTTP
     * redirect, which needs no JavaScript and keeps the address and the page in agreement.
     */
    if (authorised.mode.screen !== screenMode.screen) {
      return { kind: 'redirect', to: dashboardModeHref(authorised.mode) };
    }
    return { kind: 'show', mode: authorised.mode };
  }

  if (!mayEnterDashboardMode(screenMode, viewer)) {
    return {
      kind: 'refuse',
      reason: 'forbidden',
      sentence:
        `That address is not one your account may open. The ${screenMode.label} is for ${article(screenMode.roleLabel)}, ` +
        whoIsLooking(identity),
    };
  }

  return { kind: 'show', mode: screenMode };
}

/**
 * The same rule for a `?mode=` on a screen that is not a dashboard itself.
 *
 * The parameter is honoured on every screen this route serves, not only on the dashboards, because it is
 * how a person gets from an article or the public home to a workspace: `/about?mode=editor` is a shortcut
 * the owner asked for, and `/about?mode=admin` typed by a reader has to be refused for exactly the same
 * reason it is refused on `/dashboard-reader`. A screen with no workspace of its own can only ever
 * redirect or refuse — there is nothing for it to "show".
 */
export function decideRequestedMode(input: {
  requested: string;
  viewer: DashboardViewer;
  identity: ViewerIdentity;
}): DashboardModeDecision {
  const authorised = authoriseRequested(input.requested, input.viewer, input.identity);
  if (authorised.kind !== 'show') return authorised;
  return { kind: 'redirect', to: dashboardModeHref(authorised.mode) };
}

/** Look the name up in the allow-list, then test it against the account. The one place both do it. */
function authoriseRequested(
  requested: string,
  viewer: DashboardViewer,
  identity: ViewerIdentity
): DashboardModeDecision {
  const named = dashboardModeForSlug(requested);
  if (!named) {
    const open = dashboardModesFor(viewer).map((m) => m.mode).join(', ');
    return {
      kind: 'refuse',
      reason: 'unknown',
      sentence:
        `There is no workspace called “${requested}” in this archive, so nothing was served for it. ` +
        `The workspaces this account may open are: ${open}.`,
    };
  }
  if (!mayEnterDashboardMode(named, viewer)) {
    return {
      kind: 'refuse',
      reason: 'forbidden',
      sentence:
        `That address is not one your account may open. The ${named.label} is for ${article(named.roleLabel)}, ` +
        whoIsLooking(identity),
    };
  }
  return { kind: 'show', mode: named };
}

/** `an Editor` / `a Moderator`, so the refusal reads as English rather than as a template. */
function article(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

/** The workspace's address, with its parameter — the form the switch and the cookie both use. */
export function dashboardModeHref(mode: DashboardMode): string {
  return `/${mode.screen}?mode=${mode.mode}`;
}

/**
 * THE WORKSPACE THE REMEMBERED COOKIE NAMES, IF THE ACCOUNT MAY STILL OPEN IT.
 *
 * A cookie is a value a browser sends, so it is treated as one: an unknown name, or a workspace the
 * account may no longer enter, resolves to null and the caller falls back to the reader's own workspace
 * rather than honouring it.
 */
export function rememberedDashboardMode(
  cookieValue: string | null | undefined,
  viewer: DashboardViewer
): DashboardMode | null {
  const slug = (cookieValue ?? '').trim();
  if (slug.length === 0) return null;
  const named = dashboardModeForSlug(slug);
  if (!named || !mayEnterDashboardMode(named, viewer)) return null;
  return named;
}

/** Where a generic "your workspace" link should go for this viewer. */
export function primaryDashboardHref(
  remembered: DashboardMode | null,
  viewer: DashboardViewer
): string {
  if (remembered) return dashboardModeHref(remembered);
  const first = dashboardModesFor(viewer)[0] ?? dashboardModeForScreen('dashboard-reader')!;
  return dashboardModeHref(first);
}

// ---------------------------------------------------------------------------
// The control itself
// ---------------------------------------------------------------------------

/** Everything the switch needs to state the truth about one viewer. */
export type ModeSwitcherViewer = {
  signedIn: boolean;
  /** The person's name. The requirement is that the control names them, not only their role. */
  name: string | null;
  /** The roles they hold, as prose: `Owner`, `Editor, Moderator`, `Reader`. */
  roleLabel: string | null;
  /** Every workspace they may open. */
  modes: DashboardMode[];
  /** The workspace being viewed, or null when this page is not a dashboard. */
  currentMode: string | null;
  /** The back office, offered only to an account that may enter it. */
  adminHref: string | null;
};

/**
 * A NAMED ROLES LIST, WITHOUT INVENTING ONE.
 *
 * The floor is the reader, and that is the database's rule rather than a convenience: `ozikoro_capabilities`
 * adds `read` for every account, and the `reader` role is universal. So an account with no granted archive
 * role is described as a Reader, which is what it is.
 *
 * A platform administrator or owner is named as such even with no granted archive row, because that is what
 * `ozikoro_capabilities` already decides about them.
 */
export function describeRoles(platformRole: string | null | undefined, archiveRoles: readonly string[]): string {
  const platform = String(platformRole ?? '').toLowerCase();
  if (platform === 'owner') return 'Owner';
  if (platform === 'admin') return 'Administrator';
  const labels = archiveRoles
    .filter(isOzikoroRole)
    // Highest first, so the first word is the strongest thing a person holds.
    .sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a))
    .map((role) => roleLabel(role));
  return labels.length > 0 ? labels.join(', ') : 'Reader';
}

/**
 * The archive's own order, weakest first.
 *
 * Read from `OZIKORO_ROLES` rather than written again: it already puts the owner last, and a second copy
 * here would keep the owner out of the ordering the day a role is added above them.
 */
const ROLE_ORDER: readonly string[] = OZIKORO_ROLES;

/**
 * The minimum a page needs to escape HTML in a name or a label.
 *
 * Exported because the serve-time route builds the refusal page around the same sentence this module
 * writes, and **a sentence carrying a person's display name is a sentence that must be escaped in the one
 * place it is written rather than in each of the places it is printed.**
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The short name for it, inside this file. */
const esc = escapeHtml;

/** How the switch is wrapped where it is inserted. */
export type ModeSwitcherVariant =
  /** The dashboard's own rail — the deliverable's `<details class="sx-role-switch">` styling. */
  | 'rail'
  /** An application navigation bar, which carries its own classes. */
  | 'nav';

/**
 * THE SWITCH, AS MARKUP THAT WORKS WITH THE SCRIPTING TURNED OFF.
 *
 * `<details>`/`<summary>` is the browser's own disclosure control: no JavaScript opens it, no JavaScript
 * keeps the links inside it real, and a mode is an ordinary address a person can bookmark and reload.
 * **That is the whole mechanism** — this project has already paid for a control that returned 200 and went
 * somewhere else, and a control built out of anchors and a disclosure element cannot do that.
 *
 * THE SUMMARY CARRIES THE CURRENT WORKSPACE, because a closed `<details>` shows only its summary. A control
 * whose statement of where you are is hidden until you open it would repeat the original fault in a
 * quieter way.
 */
export function renderModeSwitcher(viewer: ModeSwitcherViewer, variant: ModeSwitcherVariant = 'rail'): string {
  if (!viewer.signedIn) return '';
  /*
   * A READER WITH NOTHING ELEVATED SEES NOTHING. Not a disabled control, not an empty menu — the page is
   * exactly the page they had before. `hasElevatedDashboardModes` is the test, so this is one rule rather
   * than a second copy of "which modes are baseline".
   */
  if (!hasElevatedDashboardModes(viewer.modes)) return '';

  const who = esc(viewer.name?.trim() || 'your account');
  const role = esc(viewer.roleLabel?.trim() || 'Reader');
  const current = viewer.currentMode ? dashboardModeForSlug(viewer.currentMode) : undefined;

  const summary =
    `Signed in as <b>${who}</b> · ${role}` + (current ? ` — you are viewing the <b>${esc(current.label)}</b>` : '');

  const links = viewer.modes
    .map((mode) => {
      const here = current?.mode === mode.mode;
      return (
        `<a href="${esc(dashboardModeHref(mode))}"${here ? ' aria-current="page"' : ''}>` +
        `${esc(mode.label)}${here ? ' — you are here' : ''}</a>`
      );
    })
    .join('\n      ');

  const admin =
    viewer.adminHref && variant === 'nav'
      ? `\n      <a href="${esc(viewer.adminHref)}">The administration — the archive's back office</a>`
      : '';

  /*
   * BOTH PLACEMENTS REUSE THE DELIVERABLE'S OWN CONTROL STYLING.
   *
   * The design dressed its switch with `.sx-role-switch`, and the masthead it sat beside is the night bar
   * `showcase.css` draws — on the design screens AND on the application's own layout, which links the same
   * stylesheets. So one class fits both places, and no stylesheet under `public/design/` is added to or
   * changed. `nav-modes` is carried alongside for the application's own layout to key off, and
   * `sx-mode-switch` distinguishes this control from the one the design shipped and `fillMasthead` removes.
   */
  const list = `<details class="sx-role-switch sx-mode-switch${variant === 'nav' ? ' nav-modes' : ''}">
    <summary>${summary}</summary>
    <div>
      <p class="small" style="margin:0 0 var(--s-2)">This chooses which workspace you are shown. It does not change your roles.</p>
      ${links}${admin}
    </div>
  </details>`;

  /*
   * THE WAY BACK IS A VISIBLE LINK, NOT A MENU ITEM.
   *
   * The owner's words are *"and to admin mode anytime they want"*, and a destination that needs a
   * disclosure opened first is two clicks on every dashboard. So in the rail the back office sits beside
   * the switch as its own anchor, and the switch carries the workspaces.
   */
  if (variant === 'rail' && viewer.adminHref) {
    return (
      `${list}\n    ` +
      `<p class="sx-mode-admin" style="margin-top:var(--s-3)">` +
      `<a class="btn btn-quiet btn-sm" href="${esc(viewer.adminHref)}">The administration — the archive's back office</a></p>`
    );
  }

  return list;
}

/** Everything the serve-time splice needs. */
export type ModeSwitcherPage = {
  /** The control's own statement of who is signed in and what they may open. */
  viewer: ModeSwitcherViewer;
  /** Where this viewer's own workspace is, for the masthead's account item and a back link. */
  primaryHref: string;
  /** The design screens this viewer may open, so an existing back link is only kept when it still works. */
  allowedScreens: ReadonlySet<string>;
};

/**
 * PUT THE SWITCH IN THE PAGE, AT WHICHEVER OF THE DELIVERABLE'S THREE SHAPES IT HAS.
 *
 * The fifty-two screens are not one template. Measured against the deliverable:
 *
 *   nine dashboards      carry `aside.sx-dash-side` with a `nav.sx-dash-nav` — which is where the design
 *                        kept its own switch, so the truthful one goes in the same place
 *   five dashboards      have no rail at all (`account`, `moderation`, `review`, `states`, `workflow`);
 *                        they are a `<main class="wrap sx-section">` and a back link, so the switch goes at
 *                        the head of that main, where a reader arriving from a workspace looks first
 *   the other screens    carry the public masthead, `nav.nav`, and the switch becomes an item in it beside
 *                        `My account` — which is what makes it reachable from anywhere on the site rather
 *                        than only from a dashboard
 *
 * THE TWO LINKS THAT ALREADY POINT AT A WORKSPACE ARE RECONCILED FIRST.
 *
 * `fillMasthead` writes the masthead's `My account` item pointing at the reader's dashboard, and the five
 * rail-less screens carry a `← Back to workspace` written by the design at `dashboard-admin.html`. Neither
 * is wrong today and both will be wrong the moment a workspace is gated: a reader on `/dashboard-account/`
 * pressing *Back to workspace* would reach `/dashboard-admin/` and be refused, and a person who chose the
 * editorial desk would be dropped back to the reader's the moment they touched the masthead. So the
 * remembered workspace is substituted when the design's own target is not one this account may open, and
 * the label is only changed when the destination stops being an account.
 *
 * The design's own markup is otherwise left exactly as it is; this function adds and re-points, and edits
 * nothing under `public/design/`.
 */
export function fillModeSwitcher(html: string, page: ModeSwitcherPage): string {
  let out = html;

  if (page.viewer.signedIn) {
    /*
     * THE MASTHEAD'S ACCOUNT ITEM FOLLOWS THE CHOSEN WORKSPACE. The label is changed only when the
     * destination is no longer the account, because "My account" over a link to the editorial desk is the
     * same small untruth this round exists to remove — and "My workspace" is what the link actually is.
     */
    const wantsWorkspace = !page.primaryHref.startsWith('/dashboard-reader');
    out = out.replace(
      /<li class="nav-account"><a href="[^"]*">My account<\/a><\/li>/,
      `<li class="nav-account"><a href="${esc(page.primaryHref)}">${wantsWorkspace ? 'My workspace' : 'My account'}</a></li>`
    );
  }

  /*
   * A BACK LINK THE VIEWER CANNOT FOLLOW IS REPOINTED RATHER THAN LEFT TO REFUSE.
   *
   * Only the design's own `← Back to workspace`, matched with its text as well as its address, so a link
   * that merely shares a file name is not redirected to somebody's own workspace.
   */
  out = out.replace(
    /<a href="(dashboard-[a-z-]+)\.html">([^<]*Back to workspace[^<]*)<\/a>/g,
    (all, screen: string, label: string) =>
      page.allowedScreens.has(screen) ? all : `<a href="${esc(page.primaryHref)}">${label}</a>`
  );

  /*
   * NOTHING TO OFFER, NOTHING ADDED. The reader with no elevated workspace keeps the page they had, which
   * is the brief's first rule and the reason `renderModeSwitcher` returns the empty string.
   */
  const rail = renderModeSwitcher(page.viewer, 'rail');
  if (rail.length === 0) return out;

  if (/<nav class="sx-dash-nav"/.test(out)) {
    return out.replace(
      /(\n?)(\s*)(<nav class="sx-dash-nav")/,
      (_all, _nl, indent: string, nav: string) => `\n${indent}${rail}\n${indent}${nav}`
    );
  }

  if (/<main id="main" class="wrap sx-section">/.test(out)) {
    return out.replace(/(<main id="main" class="wrap sx-section">)/, (_all, tag: string) => `${tag}\n${rail}`);
  }

  const item = `<li class="nav-modes-item">${renderModeSwitcher(page.viewer, 'nav')}</li>`;
  if (/<li class="nav-account">/.test(out)) {
    return out.replace(/(<li class="nav-account">)/, `${item}$1`);
  }
  return out.replace(/(<nav class="nav"[^>]*>\s*<ul>)/, (_all, tag: string) => `${tag}\n${item}`);
}
