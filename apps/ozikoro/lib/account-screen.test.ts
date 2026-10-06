/**
 * The account screen's menu is the masthead's night bar, and the three tokens it needs are declared.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────────
 *
 * The owner's report was *"on the menu in the signup or sign in page, make it dark like the homepage menu.
 * make it same colour."* `/signin`, `/join`, `/forgot` and `/reset` are four routes serving ONE design screen,
 * `public/design/screens/account.html`, which is inviolable — so the change is a serve-time insertion in
 * `account-screen.ts` and this is the test that says it happens on every one of them.
 *
 * ── THE FAULT THE THIRD TEST IS WRITTEN AGAINST ──────────────────────────────────────────────────
 *
 * `account.html` is the one screen in the deliverable that never loads `tokens.css`: it carries its own
 * shortened `:root` where `--on` is `--on-night` and `--gold2` is `--gold-bright`. **So the masthead's own
 * declaration, applied here unguarded, is not a colour at all** — `var(--on-night)` with no declaration and
 * no fallback is invalid at computed-value time, and the link inherits the body's `--ink` and becomes black
 * on a near-black bar. Measured, that is **1.17:1**: invisible, and it would look like a styling accident
 * rather than the one thing the request was about.
 *
 * The test below therefore does not check that the style block EXISTS. It reads the served page, collects
 * every custom property the injected block USES, and fails if any of them is not declared somewhere in that
 * same document — and it reads the design's own `tokens.css` to assert the three values are the design's and
 * not a colour chosen by eye.
 *
 * Run with: npm -w @ozikoro/site run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { accountScreen, type AccountScreenOptions } from './account-screen.ts';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '..');

/*
 * `account-screen.ts` resolves the design screen from `process.cwd()` — "the app directory rather than the
 * process's", because a route is served from the app root. `npm -w @ozikoro/site run test` already runs here,
 * and the chdir makes the file work under any runner that does not. `node --test` gives each file its own
 * process, so nothing else in the suite is moved by it.
 */
process.chdir(APP);

const DESIGN = join(APP, 'public', 'design');

/** The style block the served page is meant to carry, found by the token only it declares. */
function injectedStyle(html: string): string {
  const block = html
    .split('<style>')
    .map((part) => (part.includes('</style>') ? part.slice(0, part.indexOf('</style>')) : ''))
    .find((part) => part.includes('--gold-bright:#e8c766'));
  assert.ok(block, 'the served account page carries no injected style block — the menu is still light');
  return block;
}

test('the served account page colours its header and menu with the masthead\'s own declarations', async () => {
  /*
   * NOT A DESCRIPTION OF THE COLOUR — THE DECLARATIONS, quoted from `styles/showcase.css`, where the
   * masthead resolves to night under its own heading *"platform bar + masthead: night with gold"*. The
   * request was "same colour", so what is asserted is that the same three lines are present, character for
   * character, rather than that some dark value is.
   */
  const html = await accountScreen();
  const style = injectedStyle(html);

  assert.ok(style.includes('.header{background:rgba(15,13,11,.92);border-bottom:1px solid rgba(201,168,76,.28)}'),
    'the light `--surface` bar is still the header\'s background');
  assert.ok(style.includes('.nav a{color:var(--on-night)}'),
    'the menu links are not the masthead\'s `--on-night`');
  assert.ok(style.includes('.nav a:hover{color:var(--gold-bright)}'),
    'the hover colour is not the masthead\'s `--gold-bright`');

  /*
   * AND THE TWO LINES THE LIGHT BAR WAS CARRYING. The brand is `--ink` and `.nav` is `--muted` today; both
   * are near-black, and a dark ground makes both unreadable. Their replacements are the masthead's own
   * equivalents — `.wordmark b` and `.wordmark span` in `showcase.css` — rather than new colours.
   */
  assert.ok(style.includes('.header .brand strong{color:var(--on-night)}'), 'the wordmark still inherits near-black ink');
  assert.ok(style.includes('.header .brand small{color:var(--on-night-muted)}'), 'the strap-line still inherits near-black ink');

  /*
   * THE DESIGN IS NOT EDITED, AND THIS IS THE ASSERTION THAT SAYS SO. The file on disk still draws its own
   * light header; if a later change "fixes" this by editing the deliverable, the parity check would catch it
   * and this test fails first and says why.
   */
  const onDisk = readFileSync(join(DESIGN, 'screens', 'account.html'), 'utf8');
  assert.ok(onDisk.includes('.header{background:var(--surface);border-bottom:1px solid var(--edge)}'),
    'the inviolable design screen was edited rather than the served copy');
});

test('every route that serves the account screen gets it, which is all four', async () => {
  /*
   * "He said signup or sign in", and a dark sign-in beside a light sign-up is the same fault one click away.
   * All four addresses pass through `accountScreen`, so the treatment is asserted on the shapes those routes
   * ask for: `/signin`'s `#signin` mode line, `/join`'s `#signup`, and the two recovery pages, which remove
   * fields and replace the heading.
   */
  const shapes: Array<{ what: string; options: AccountScreenOptions }> = [
    { what: '/signin', options: { replace: [['</head>', '<script>if(!location.hash)location.replace("#signin");</script></head>']] } },
    { what: '/join', options: { replace: [['</head>', '<script>if(!location.hash)location.replace("#signup");</script></head>']] } },
    { what: '/forgot', options: { replace: [['<span id="crumb">Sign in</span>', '<span id="crumb">Reset password</span>']] } },
    { what: '/reset', options: { notice: { text: '' }, replace: [['<span id="crumb">Sign in</span>', '<span id="crumb">Set a new password</span>']] } },
  ];

  for (const { what, options } of shapes) {
    const html = await accountScreen(options);
    const style = injectedStyle(html);
    assert.ok(style.includes('.nav a{color:var(--on-night)}'), `${what} would still serve a light menu`);
  }
});

test('every token the injected block uses is declared on the page, so no declaration is invalid', async () => {
  /*
   * THE 1.17:1 TRAP, ASSERTED RATHER THAN REMEMBERED. `account.html` declares `--on`, `--gold2` and neither
   * `--on-night` nor `--gold-bright`; an unguarded `var()` on this page is not a colour, it is `inherit`, and
   * `inherit` here is the body's near-black ink. So the tokens are collected from the block that uses them
   * and each is required to be declared in the same document.
   */
  const html = await accountScreen();
  const style = injectedStyle(html);

  const used = new Set([...style.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 0, 'the injected block uses no design token — this test has stopped testing anything');

  const declared = new Set([...html.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const undeclared = [...used].filter((token) => !declared.has(token));
  assert.deepEqual(
    undeclared,
    [],
    `these tokens are used by the served header and declared nowhere on the page, so the rule is invalid ` +
      `at computed-value time and the text inherits the body's ink: ${undeclared.join(', ')}`
  );
});

test('the three tokens are the design\'s own, read from tokens.css rather than chosen', async () => {
  /*
   * *"Do not pick a dark colour by eye and do not introduce a token the design does not declare."* The
   * tokens are the design's — they are declared in `public/design/tokens.css` — and these three assertions
   * are what stops the served bar drifting from the masthead's the next time the palette moves.
   */
  const tokens = readFileSync(join(DESIGN, 'tokens.css'), 'utf8');
  const declared = (name: string): string => {
    const value = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens)?.[1];
    if (!value) throw new Error(`tokens.css no longer declares ${name}`);
    return value.trim();
  };

  assert.equal(declared('--on-night'), '#f3ead6');
  assert.equal(declared('--gold-bright'), '#e8c766');
  assert.equal(declared('--on-night-muted'), '#b9ad94');

  const style = injectedStyle(await accountScreen());
  assert.ok(style.includes(`--on-night:${declared('--on-night')}`),
    'the served page declares a different --on-night from the design\'s');
  assert.ok(style.includes(`--gold-bright:${declared('--gold-bright')}`),
    'the served page declares a different --gold-bright from the design\'s');
  assert.ok(style.includes(`--on-night-muted:${declared('--on-night-muted')}`),
    'the served page declares a different --on-night-muted from the design\'s');
});

test('the served design directory is the deliverable\'s byte for byte, and the one screen it adds', () => {
  /*
   * ── THE OTHER HALF OF "THE DESIGN IS INVIOLABLE", AND A HOLE IN HOW IT IS CHECKED ───────────────
   *
   * The parity rule is a python one-liner that walks `design/calm-comfort-construct/public/design`,
   * hashes each file in the served copy and reports identical/differing/missing. It is a good check and it
   * has one blind spot: **it iterates the DELIVERABLE and asks about the served copy, so a file the served
   * copy carries and the deliverable does not is invisible to it.**
   *
   * Measured on 2026-10-05, there is exactly one, and it is the screen this whole change is about:
   *
   *     design/calm-comfort-construct/public/design/screens/   51 files
   *     apps/ozikoro/public/design/screens/                    52 files
   *     the difference:                                        screens/account.html
   *
   * It arrived in `2c1e77e` — *"Serve the owner's own account page instead of the plain pages built in its
   * absence"* — so it is the owner's design and it is treated as inviolable, but the deliverable tree was
   * never given a copy and the parity script therefore cannot notice it being edited. **This test closes
   * that hole for the whole tree rather than for the three files this change happens to read**, and asserts
   * both sides so a second added file, or a file the deliverable gains and the copy loses, is named here
   * rather than discovered on a served page.
   */
  const source = join(here, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design');
  const served = join(APP, 'public', 'design');

  const walk = (root: string): string[] => {
    const found: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else found.push(relative(root, full));
      }
    };
    visit(root);
    return found;
  };

  const delivered = walk(source).sort();
  const copied = new Set(walk(served));

  const missing = delivered.filter((file) => !copied.has(file));
  assert.deepEqual(missing, [], `the served design directory is missing deliverable files: ${missing.join(', ')}`);

  const added = [...copied].filter((file) => !delivered.includes(file)).sort();
  assert.deepEqual(
    added,
    [join('screens', 'account.html')],
    'the served copy carries a file the deliverable does not, and it is not the account screen — the parity ' +
      'check cannot see this, so it is recorded here'
  );

  for (const file of delivered) {
    const a = readFileSync(join(served, file));
    const b = readFileSync(join(source, file));
    assert.ok(a.equals(b), `${file} differs between the served copy and the deliverable`);
  }
});

test('the account screen serves the wordmark the owner chose, and the design file still has its own', async () => {
  /*
   * ── THE STRAP, ON THE ONE SCREEN `designScreenLinks` DOES NOT REACH ──────────────────────────────
   *
   * The owner's request was that the company name leave the top of the site — *"the Ozi Ikoro limited you do
   * put on the top menu should be removed everywhere. ozikoro is enough"* — and, asked what the wordmark
   * should be, he answered in two words: **"Ozikoro Archive"**. `account.html` is the eighteenth screen that
   * draws the brand and the only one served by this file, so the rule is stated here as well; without that,
   * `/signin`, `/join`, `/forgot` and `/account` would be the four pages showing the old wordmark.
   *
   * THE BOUND IS THE POINT OF THE ASSERTIONS BELOW. The design writes the phrase `History &amp; Archive`
   * three times on this screen: the platform bar's own right-hand label, the brand's `<small>`, and the
   * eyebrow above `#intro`. **Only the middle one is a brand** — the other two are a section label and a line
   * of prose — so a replace of the words rather than of the element would have rewritten all three, and the
   * two that must survive are asserted rather than assumed.
   */
  const served = await accountScreen();

  /*
   * ⚠️ AND THE MARK, WHICH IS A CHANGE TO THE OWNER'S OWN DESIGN RATHER THAN A FIX. He was shown three
   * options and chose **the mark on all 53 screens**; the one he accepted said *"Literal 'every single
   * page', but 52 screens gain an image your design never gave them."* `account.html` is the forty-fifth
   * brand-bearing screen and the only one `designScreenLinks` never sees, so the replacement is made here
   * and the whole reasoning is at `withBrandMark`.
   *
   * THE STAND-IN LETTER IS REPLACED, NOT JOINED. The design drew `<span class="brandmark">O</span>` — an
   * `O` in a gold ring — in the mark's own slot, so an insertion beside it would be a second mark. The
   * image keeps the design's own class and therefore its own 38 px / 34 px circle, and **the name
   * `<strong>Ozikoro</strong>` and its strap are untouched**, which is the half of the decision that
   * matters most: he asked for a logo, not for the name to go.
   */
  assert.match(
    served,
    /<a class="brand" href="\/"><img class="brandmark" src="\/media\/ozikoro\/486-cropped-Ozi-Ikoro-Icon-Yellow-1\.png" alt=""><span><strong>Ozikoro<\/strong><small>Archive<\/small><\/span><\/a>/,
    'the served account brand did not take the owner\u2019s mark and the strap he chose'
  );
  assert.equal(
    served.match(/<img class="brandmark"/g)?.length,
    1,
    'the account brand is served with more than one mark'
  );
  assert.match(served, /<a href="\/" class="active">History &amp; Archive<\/a>/, 'the platform bar lost its own label');
  assert.match(served, /<p class="eyebrow">Ozikoro · History &amp; Archive<\/p>/, 'a line of prose was rewritten as a brand');

  // The deliverable is not the file this changed, and this is where that is said.
  const onDisk = readFileSync(join(DESIGN, 'screens', 'account.html'), 'utf8');
  assert.ok(
    onDisk.includes('<strong>Ozikoro</strong><small>History &amp; Archive</small>'),
    'the inviolable design screen was edited rather than the served copy'
  );
  assert.ok(
    onDisk.includes('<span class="brandmark">O</span>'),
    'the design file lost the stand-in mark this replacement is written against'
  );
  assert.ok(
    onDisk.includes('<a href="#" class="active">History &amp; Archive</a>'),
    'the design file no longer carries the platform-bar label this test is written against'
  );
});
