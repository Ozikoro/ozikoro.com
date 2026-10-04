/**
 * THE ALLOW-LIST BEHIND THE WORKSPACE SWITCH, ASSERTED RATHER THAN DESCRIBED.
 *
 * The design shipped a `<details class="sx-role-switch">` that offered all nine of its workspaces to
 * everybody, and it had to be removed because it told the owner he held roles he does not. This file is the
 * replacement's own test, and it is written to fail on the two faults that made the first one wrong:
 *
 *   the same control appearing for an account with nothing elevated to offer — the brief's first rule
 *   a workspace being offered, or an address being served, to an account whose capabilities do not cover it
 *
 * The table is also checked against the directory it describes. **A workspace added to the deliverable and
 * forgotten here would be a screen nobody could switch to**, and a name in the table that no screen carries
 * would be a switch item that 404s — neither is visible by reading the table.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fillMasthead } from './design-fill.ts';
import {
  DASHBOARD_MODES,
  DASHBOARD_MODE_COOKIE,
  OPEN_DASHBOARD_MODES,
  dashboardModeForScreen,
  dashboardModeForSlug,
  dashboardModeHref,
  dashboardModesFor,
  decideDashboardMode,
  decideRequestedMode,
  describeRoles,
  escapeHtml,
  fillModeSwitcher,
  hasElevatedDashboardModes,
  mayEnterDashboardMode,
  primaryDashboardHref,
  rememberedDashboardMode,
  renderModeSwitcher,
  type DashboardViewer,
} from './dashboard-modes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SCREENS = join(here, '..', '..', '..', 'apps', 'ozikoro', 'public', 'design', 'screens');

/** A viewer with exactly the capabilities named. */
function viewer(platformRole: string | null, capabilities: string[]): DashboardViewer {
  return { platformRole, capabilities: new Set(capabilities) };
}

/** The three capabilities `ozikoro_capabilities` gives every account, and nothing else. */
const READER = viewer('contributor', ['read', 'bookmark', 'collection']);
/** An editor's own set, from `ozikoro_role_capability` in migration 0037. */
const EDITOR = viewer('contributor', ['read', 'edit_entity', 'manage_source', 'manage_claim', 'publish', 'review_queue']);
/** A moderator's own set. */
const MODERATOR = viewer('contributor', ['read', 'moderate', 'review_reports']);
const OWNER = viewer('owner', []);

const identity = { signedIn: true, name: 'Idenze Ezeme', roleLabel: 'Owner' };

test('the table is the deliverable\'s own list of dashboards, both ways round', () => {
  const onDisk = readdirSync(SCREENS)
    .filter((file) => file.startsWith('dashboard-') && file.endsWith('.html'))
    .map((file) => file.replace(/\.html$/, ''))
    .sort();
  const inTable = DASHBOARD_MODES.map((mode) => mode.screen).sort();
  assert.deepEqual(inTable, onDisk, 'the switch and the deliverable disagree about which dashboards exist');
  // One slug per screen and one screen per slug, or an address could name two workspaces.
  assert.equal(new Set(DASHBOARD_MODES.map((m) => m.mode)).size, DASHBOARD_MODES.length);
  assert.equal(new Set(DASHBOARD_MODES.map((m) => m.screen)).size, DASHBOARD_MODES.length);
});

test('every gating capability is a real one, and the floor is exactly three workspaces', () => {
  assert.deepEqual(OPEN_DASHBOARD_MODES, ['reader', 'account', 'states']);
  // Named so a typo cannot silently make a workspace ungated: each of these is in migration 0037/0044.
  const known = new Set([
    'submit_work', 'research_profile', 'contribute_oral_history', 'edit_entity',
    'expert_review', 'moderate', 'publish', 'manage_users',
  ]);
  for (const mode of DASHBOARD_MODES) {
    if (mode.capability === null) continue;
    assert.ok(known.has(mode.capability), `${mode.mode} is gated by an unknown capability ${mode.capability}`);
  }
});

test('a reader with nothing elevated is offered nothing at all', () => {
  const modes = dashboardModesFor(READER);
  assert.deepEqual(modes.map((m) => m.mode), ['reader', 'account', 'states']);
  assert.equal(hasElevatedDashboardModes(modes), false);
  const markup = renderModeSwitcher({
    signedIn: true, name: 'Nnamdi Reader', roleLabel: 'Reader', modes, currentMode: 'reader', adminHref: null,
  });
  assert.equal(markup, '', 'a plain reader was given a control the brief says they must not see');
  // And the page itself is untouched, including the design's own switch if it were somehow present.
  const page = '<main id="main" class="wrap sx-section"><h1>Account</h1></main>';
  assert.equal(
    fillModeSwitcher(page, { viewer: { signedIn: true, name: 'Nnamdi Reader', roleLabel: 'Reader', modes, currentMode: 'account', adminHref: null }, primaryHref: '/dashboard-reader?mode=reader', allowedScreens: new Set(['dashboard-reader']) }),
    page
  );
});

test('an editor is offered the editorial work and nothing above it', () => {
  const modes = dashboardModesFor(EDITOR).map((m) => m.mode).sort();
  assert.deepEqual(modes, ['account', 'editor', 'reader', 'states', 'workflow'].sort());
  assert.equal(mayEnterDashboardMode(dashboardModeForSlug('admin')!, EDITOR), false);
  assert.equal(mayEnterDashboardMode(dashboardModeForSlug('reviewer')!, EDITOR), false);
});

test('a moderator reaches the moderation queue and not the administration', () => {
  const modes = dashboardModesFor(MODERATOR).map((m) => m.mode);
  assert.ok(modes.includes('moderation'));
  assert.ok(!modes.includes('admin'));
  assert.ok(!modes.includes('editor'));
});

test('the owner may look at every workspace the archive has', () => {
  assert.equal(dashboardModesFor(OWNER).length, DASHBOARD_MODES.length);
  // And without a granted archive role row, which is the case migration 0044 warns about.
  assert.equal(mayEnterDashboardMode(dashboardModeForSlug('reviewer')!, OWNER), true);
});

test('a hand-typed mode the account may not enter is refused with a sentence', () => {
  const decision = decideDashboardMode({
    screenMode: dashboardModeForScreen('dashboard-reader')!,
    requested: 'admin',
    viewer: READER,
    identity: { signedIn: true, name: 'Nnamdi Reader', roleLabel: 'Reader' },
  });
  assert.equal(decision.kind, 'refuse');
  assert.equal(decision.kind === 'refuse' && decision.reason, 'forbidden');
  assert.match(
    decision.kind === 'refuse' ? decision.sentence : '',
    /not one your account may open/
  );
  assert.match(decision.kind === 'refuse' ? decision.sentence : '', /Nnamdi Reader \(Reader\)/);
});

test('a name that is not a workspace is refused, and the refusal says what is', () => {
  const decision = decideDashboardMode({
    screenMode: dashboardModeForScreen('dashboard-reader')!,
    requested: 'superuser',
    viewer: READER,
    identity: { signedIn: true, name: 'Nnamdi Reader', roleLabel: 'Reader' },
  });
  assert.equal(decision.kind, 'refuse');
  assert.equal(decision.kind === 'refuse' && decision.reason, 'unknown');
  assert.match(decision.kind === 'refuse' ? decision.sentence : '', /reader, account, states/);
  // And it does not advertise the workspaces this account could not enter anyway.
  assert.doesNotMatch(decision.kind === 'refuse' ? decision.sentence : '', /dashboard-admin|admin/);
});

test('the right workspace at the wrong address moves instead of being refused', () => {
  const decision = decideDashboardMode({
    screenMode: dashboardModeForScreen('dashboard-reader')!,
    requested: 'editor',
    viewer: EDITOR,
    identity,
  });
  assert.deepEqual(decision, { kind: 'redirect', to: '/dashboard-editor?mode=editor' });
});

test('a gated screen with no parameter is refused rather than quietly served', () => {
  const decision = decideDashboardMode({
    screenMode: dashboardModeForScreen('dashboard-admin')!,
    requested: null,
    viewer: READER,
    identity: { signedIn: true, name: 'Nnamdi Reader', roleLabel: 'Reader' },
  });
  assert.equal(decision.kind, 'refuse');
  assert.match(decision.kind === 'refuse' ? decision.sentence : '', /Administration workspace is for an Administrator/);
});

test('the parameter and the address agree, so the parameter is served', () => {
  const decision = decideDashboardMode({
    screenMode: dashboardModeForScreen('dashboard-editor')!,
    requested: 'editor',
    viewer: EDITOR,
    identity,
  });
  assert.equal(decision.kind, 'show');
  assert.equal(decision.kind === 'show' && decision.mode.mode, 'editor');
});

test('the parameter is honoured on a screen that is not a dashboard, and refused there too', () => {
  // `/about?mode=editor` is a shortcut to a workspace the account may open…
  assert.deepEqual(decideRequestedMode({ requested: 'editor', viewer: EDITOR, identity }), {
    kind: 'redirect',
    to: '/dashboard-editor?mode=editor',
  });
  // …and the same name typed by a reader is refused rather than obeyed.
  const refused = decideRequestedMode({ requested: 'admin', viewer: READER, identity: { signedIn: true, name: 'Nnamdi Reader', roleLabel: 'Reader' } });
  assert.equal(refused.kind, 'refuse');
  assert.match(refused.kind === 'refuse' ? refused.sentence : '', /not one your account may open/);
});

test('the escape used for the refusal page and the switch is one function', () => {
  assert.equal(escapeHtml('<b>"Ada" & \'Nnamdi\'</b>'), '&lt;b&gt;&quot;Ada&quot; &amp; &#39;Nnamdi&#39;&lt;/b&gt;');
});

test('a refused address tells a visitor nobody is signed in, rather than naming them', () => {
  const decision = decideDashboardMode({
    screenMode: dashboardModeForScreen('dashboard-admin')!,
    requested: 'admin',
    viewer: viewer('contributor', []),
    identity: { signedIn: false, name: null, roleLabel: null },
  });
  assert.equal(decision.kind, 'refuse');
  const sentence = decision.kind === 'refuse' ? decision.sentence : '';
  assert.match(sentence, /nobody is signed in on this browser/);
  assert.doesNotMatch(sentence, /signed in as/);
});

test('a cookie is never trusted: a revoked workspace is ignored', () => {
  assert.equal(rememberedDashboardMode('admin', READER), null);
  assert.equal(rememberedDashboardMode('editor', EDITOR)?.screen, 'dashboard-editor');
  assert.equal(rememberedDashboardMode('', EDITOR), null);
  assert.equal(rememberedDashboardMode('not-a-mode', EDITOR), null);
  assert.equal(DASHBOARD_MODE_COOKIE, 'ozikoro_dashboard_mode');
});

test('the fallback workspace is the first open one, so a link always resolves', () => {
  assert.equal(primaryDashboardHref(null, READER), '/dashboard-reader?mode=reader');
  assert.equal(primaryDashboardHref(rememberedDashboardMode('workflow', EDITOR), EDITOR), '/dashboard-workflow?mode=workflow');
});

test('the switch names the person, the role, the current workspace, and only reachable addresses', () => {
  const modes = dashboardModesFor(OWNER);
  const markup = renderModeSwitcher(
    { signedIn: true, name: 'Idenze Ezeme', roleLabel: 'Owner', modes, currentMode: 'editor', adminHref: '/admin/' },
    'rail'
  );
  assert.match(markup, /Signed in as <b>Idenze Ezeme<\/b> · Owner/, 'the control must name the person');
  assert.match(markup, /you are viewing the <b>Editorial desk<\/b>/, 'the summary must say which mode, unopened');
  assert.match(markup, /href="\/dashboard-editor\?mode=editor" aria-current="page"/);
  assert.match(markup, /href="\/admin\/"/, 'the back office must be one click from every dashboard');
  assert.doesNotMatch(markup, /href="#"/, 'a placeholder left in the control is the fault this replaces');
  // Every workspace this owner may open is offered, and the label is the workspace's own name.
  for (const mode of modes) assert.match(markup, new RegExp(`href="${dashboardModeHref(mode).replace(/[/?=]/g, '\\$&')}"`));
  assert.match(markup, /Editorial desk — you are here/);
});

test('the control is not offered to an account that is not signed in', () => {
  const markup = renderModeSwitcher(
    { signedIn: false, name: null, roleLabel: null, modes: dashboardModesFor(OWNER), currentMode: null, adminHref: null }
  );
  assert.equal(markup, '');
});

test('a workspace the viewer may not open is not in the switch at all', () => {
  const markup = renderModeSwitcher(
    { signedIn: true, name: 'Ada', roleLabel: 'Editor', modes: dashboardModesFor(EDITOR), currentMode: 'editor', adminHref: null }
  );
  assert.doesNotMatch(markup, /dashboard-admin/, 'the switch offered a workspace the account cannot open');
  assert.doesNotMatch(markup, /Administration workspace/);
});

test('the switch is spliced into all three of the deliverable\'s shapes', () => {
  const rail = '<aside class="sx-dash-side"><a class="sx-dash-brand" href="/">Ozikoro</a><nav class="sx-dash-nav"><a href="#">Content</a></nav></aside>';
  const plain = '<main id="main" class="wrap sx-section"><h1>Publishing workflow</h1></main>';
  const masthead = '<header class="masthead"><nav class="nav"><ul><li><a href="/about">About</a></li><li class="nav-account"><a href="/dashboard-reader">My account</a></li></ul></nav></header>';
  const page = {
    viewer: { signedIn: true, name: 'Idenze Ezeme', roleLabel: 'Owner', modes: dashboardModesFor(OWNER), currentMode: 'admin', adminHref: '/admin/' },
    primaryHref: '/dashboard-admin?mode=admin',
    allowedScreens: new Set(DASHBOARD_MODES.map((m) => m.screen)),
  };
  const inRail = fillModeSwitcher(rail, page);
  assert.ok(inRail.indexOf('sx-mode-switch') > 0 && inRail.indexOf('sx-mode-switch') < inRail.indexOf('sx-dash-nav'));
  assert.match(fillModeSwitcher(plain, page), /<main id="main" class="wrap sx-section">\n<details/);
  const inNav = fillModeSwitcher(masthead, page);
  assert.match(inNav, /<li class="nav-modes-item">/);
  assert.match(inNav, /My workspace<\/a><\/li>/, 'a masthead link to a workspace must not still say My account');
  // The design's own links inside the page are untouched: this function adds, it does not rewrite.
  assert.match(inRail, /<a href="#">Content<\/a>/);
});

test('a back link the viewer cannot follow is repointed, and one they can is left alone', () => {
  const back = '<main id="main" class="wrap sx-section"><a href="dashboard-admin.html">← Back to workspace</a></main>';
  const editorPage = {
    viewer: { signedIn: true, name: 'Ada', roleLabel: 'Editor', modes: dashboardModesFor(EDITOR), currentMode: 'editor', adminHref: null },
    primaryHref: '/dashboard-editor?mode=editor',
    allowedScreens: new Set(dashboardModesFor(EDITOR).map((m) => m.screen)),
  };
  assert.match(fillModeSwitcher(back, editorPage), /href="\/dashboard-editor\?mode=editor">← Back to workspace/);
  const ownerPage = { ...editorPage, viewer: { ...editorPage.viewer, name: 'Idenze Ezeme', roleLabel: 'Owner', modes: dashboardModesFor(OWNER), currentMode: 'admin' }, allowedScreens: new Set(DASHBOARD_MODES.map((m) => m.screen)) };
  assert.match(fillModeSwitcher(back, ownerPage), /href="dashboard-admin\.html">← Back to workspace/);
});

test('every real dashboard composes: the design\'s switch goes, and this one takes its place', () => {
  /*
   * THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL FAULT.
   *
   * It runs the two serve-time steps over the DELIVERABLE'S OWN FILES, in the order the route runs them —
   * `fillMasthead` removes the design's `<details class="sx-role-switch">`, then `fillModeSwitcher` puts the
   * truthful one where it was. Read from disk rather than from a fixture, because a fixture would agree with
   * this file about a markup shape the real screens do not have.
   */
  const screens = readdirSync(SCREENS).filter((f) => f.startsWith('dashboard-') && f.endsWith('.html'));
  assert.equal(screens.length, 14);
  /*
   * NINE, NOT FOURTEEN, AND THE COUNT IS ASSERTED RATHER THAN ASSUMED.
   *
   * The design put its switch on the nine rail dashboards; the five it drew without a rail (`account`,
   * `moderation`, `review`, `states`, `workflow`) never had one. **That is why the splice has three
   * placements rather than one**, and a change to either number should fail here rather than be discovered
   * by a screen that renders no switch at all.
   */
  let withDesignSwitch = 0;
  for (const file of screens) {
    const raw = readFileSync(join(SCREENS, file), 'utf8');
    const hadDesignSwitch = /<details class="sx-role-switch">/.test(raw);
    if (hadDesignSwitch) withDesignSwitch += 1;
    const screen = file.replace(/\.html$/, '');
    const mode = dashboardModeForScreen(screen)!;
    const served = fillMasthead(raw, { signedIn: true });

    const ownerPage = fillModeSwitcher(served, {
      viewer: { signedIn: true, name: 'Idenze Ezeme', roleLabel: 'Owner', modes: dashboardModesFor(OWNER), currentMode: mode.mode, adminHref: '/admin/' },
      primaryHref: dashboardModeHref(mode),
      allowedScreens: new Set(DASHBOARD_MODES.map((m) => m.screen)),
    });
    if (hadDesignSwitch) {
      assert.doesNotMatch(ownerPage, /<details class="sx-role-switch">/, `${screen} still carries the design's switch`);
    }
    assert.equal((ownerPage.match(/sx-mode-switch/g) ?? []).length, 1, `${screen} carries no switch, or two`);
    assert.match(ownerPage, /aria-current="page"/, `${screen} does not mark the workspace it is showing`);
    assert.match(ownerPage, /href="\/admin\/"/, `${screen} gives the owner no way back to the back office`);

    const readerPage = fillModeSwitcher(served, {
      viewer: { signedIn: true, name: 'Nnamdi Reader', roleLabel: 'Reader', modes: dashboardModesFor(READER), currentMode: mode.mode, adminHref: null },
      primaryHref: '/dashboard-reader?mode=reader',
      allowedScreens: new Set(dashboardModesFor(READER).map((m) => m.screen)),
    });
    assert.doesNotMatch(readerPage, /sx-mode-switch/, `${screen} offered a plain reader a control it must not see`);
    /*
     * AND NO LINK LEFT ON A SCREEN A READER MAY OPEN POINTS AT ONE THEY MAY NOT. Five of the screens carry
     * the design's `← Back to workspace` at `dashboard-admin.html`, which would refuse the reader who
     * followed it — the exact "click and be told no" this round is removing.
     */
    if (readerPage.includes('href="dashboard-admin.html"')) {
      assert.fail(`${screen} still points a back link at the administration workspace`);
    }
  }
  assert.equal(withDesignSwitch, 9, 'the deliverable no longer puts its own switch on nine dashboards');
});

test('roles are described from what the account holds, and the floor is the reader', () => {
  assert.equal(describeRoles('owner', []), 'Owner');
  assert.equal(describeRoles('contributor', []), 'Reader');
  assert.equal(describeRoles('contributor', ['teacher', 'editor']), 'Editor, Teacher');
  assert.equal(describeRoles('admin', ['editor']), 'Administrator');
});
