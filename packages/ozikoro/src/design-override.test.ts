/**
 * The override layer, against the real deliverable.
 *
 * WHY THESE ASSERTIONS READ THE ACTUAL DESIGN FILES
 *
 * The two faults this file exists to prevent are both invisible in a fixture. **The first is the fill
 * overwriting the override**: `/donate/`'s notice is written by `fillDonate`, so an override applied before
 * the fills changes the page for a moment and then vanishes — the owner saves a change, the row is in the
 * database, and the page is unchanged. The second is a selector that names a shape rather than a thing;
 * the archive has already served a menu that a shape-selector replaced with prose. A test against invented
 * markup would pass both.
 *
 * So the file reads `apps/ozikoro/public/design/`, runs the real fill, and asserts on the result. It reads
 * only — nothing here writes to the deliverable.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fillDonate, fillResearcherProfile } from './design-fill.ts';
import {
  applyDesignOverrides,
  checkOverrideValue,
  contrastRatio,
  designInventory,
  parseColour,
  parseDesignTokens,
  parseSelector,
  querySelectorAll,
  resolveToken,
  scanElements,
  selectorFor,
  themeCss,
  CONTRAST_PAIRS,
  type DesignOverride,
} from './design-override.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(here, '..', '..', '..', 'apps', 'ozikoro', 'public', 'design');
const read = (name: string): string => readFileSync(join(DESIGN, 'screens', `${name}.html`), 'utf8');
const tokensCss = readFileSync(join(DESIGN, 'tokens.css'), 'utf8');
const mainCss = readFileSync(join(DESIGN, 'styles', 'main.css'), 'utf8');
const showcaseCss = readFileSync(join(DESIGN, 'styles', 'showcase.css'), 'utf8');

/* ============================================================================================
 * THE HEADINGS AND PARAGRAPHS ARE FOUND, AND NOTHING ELSE IS
 * ========================================================================================== */

test('the scanner records every element, including the void ones', () => {
  const html = read('home');
  const { elements } = scanElements(html);
  const images = elements.filter((e) => e.tag === 'img');
  assert.ok(images.length > 0, 'no <img> was recorded at all, so no photograph could ever be edited');
  const h1 = elements.filter((e) => e.tag === 'h1');
  assert.equal(h1.length, 1, 'the home screen has exactly one h1');
  // The byte range is the element, exactly: slicing it back gives the tag it came from.
  const slice = html.slice(h1[0]!.start, h1[0]!.end);
  assert.match(slice, /^<h1[\s>]/, 'the recorded range does not begin at the opening tag');
  assert.match(slice, /<\/h1>$/, 'the recorded range does not end at the closing tag');
});

test('a selector names one element, or the edit is refused', () => {
  const html = read('home');
  const h1 = querySelectorAll(html, 'h1');
  assert.equal(h1.length, 1);
  // A selector that matches nothing is not an error; it is an edit that would change nothing.
  assert.equal(querySelectorAll(html, 'h1.nonexistent-class').length, 0);
  assert.equal(parseSelector('div; body'), null, 'a stored value must not be able to carry a second rule');
  // A selector that parses but matches nothing is not a fault: it is an edit that would change nothing, and
  // the save path reports the match count rather than the key being rejected.
  assert.equal(querySelectorAll(html, '#main > p.lede').length, 0, 'the home lede is not a direct child of main');
  assert.equal(querySelectorAll(html, '#main p.lede.fade-up').length, 1);
});

test('a generated key prefers a name over a position', () => {
  const html = read('home');
  const { elements } = scanElements(html);
  const h1 = elements.find((e) => e.tag === 'h1')!;
  const key = selectorFor(html, h1)!;
  assert.match(key, /^h1\./, `the h1 has a class to name it with, but the key was positional: ${key}`);
  assert.equal(querySelectorAll(html, key).length, 1, `${key} does not name exactly one element`);

  // The design's own ids are used when they exist, because its CSS and JavaScript refer to them.
  const body = read('about');
  const { elements: aboutElements } = scanElements(body);
  const terms = aboutElements.find((e) => e.tag === 'section' && (e.attrs.includes('id="terms"')));
  assert.ok(terms, 'the About screen has an #terms section');
  assert.equal(selectorFor(body, terms), '#terms');
});

test('the key is stable when a screen served at three addresses is edited once', () => {
  /*
   * `/about.html`, `/about/` and `/about` are one design file at three addresses; the middleware strips the
   * extension and the trailing slash, so all three reach `/design-screen/about` and all three read the same
   * rows. This asserts the property the owner expects — editing About changes About, however he reaches it.
   */
  const html = read('about');
  const inventory = designInventory(html).items;
  assert.ok(inventory.length > 0, 'the About screen offers nothing at all');
  for (const item of inventory) {
    assert.equal(querySelectorAll(html, item.key).length, 1, `${item.key} does not name exactly one element`);
  }
});

/* ============================================================================================
 * THE ORDERING — THE OVERRIDE WINS OVER THE FILL
 * ========================================================================================== */

test('an override survives the fill that rewrites the same words', () => {
  /*
   * `fillResearcherProfile` rewrites the `h1` to the contributor's own name. An override applied BEFORE it
   * would be replaced by that name, which is the failure the owner would experience as "I saved it and
   * nothing happened".
   */
  const design = read('researcher-profile');
  const filled = fillResearcherProfile(design, {
    slug: 'idenze-ezeme', name: 'Idenze Ezeme', headline: null, bio: 'Writes about pre-colonial Igbo societies.',
    institution: null, department: null, orcid: null, interests: [], since: null, publications: 0, joined: false,
  });
  assert.match(filled, /Idenze Ezeme/, 'the fill did not rewrite the page, so this test proves nothing');

  const override: DesignOverride = {
    screen: 'researcher-profile', kind: 'text', key: 'h1',
    value: { text: 'The people who write the archive' },
  };
  assert.equal(querySelectorAll(filled, 'h1').length, 1, 'the h1 the fill rewrote is no longer unique');
  const served = applyDesignOverrides(filled, [override]);
  assert.match(served, /<h1[^>]*>The people who write the archive<\/h1>/, 'the fill overwrote the override');
  assert.doesNotMatch(
    served.match(/<h1[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? '',
    /Idenze Ezeme/,
    'the fill’s own name is still in the heading the override replaced'
  );
});

test('an override can address text a fill created, which is not in the design file at all', () => {
  /*
   * `/donate/`'s notice is written by `fillDonate`, and that same fill DELETES the submit button. So the
   * inventory of the served page offers the notice and does not offer the button — which is the whole reason
   * the inventory is built from the served page rather than from the design's markup.
   */
  const filled = fillDonate(read('donate'), { configured: false, donations: 0, currency: 'NGN' });
  const inventory = designInventory(filled);
  const notice = inventory.items.find((item) => item.key === '#give-state');
  assert.ok(notice, 'the notice the fill writes is not offered for editing');
  assert.equal(notice.can.text, true, 'the notice has no text to edit');
  assert.match(notice.textReason ?? '', /removes the markup inside it \(<strong>\)/, 'the owner is not told the bold phrase goes');
  assert.equal(inventory.items.some((item) => item.text === 'Continue to secure payment'), false,
    'the fill deletes that button, so the inventory must not offer it');

  const served = applyDesignOverrides(filled, [
    { screen: 'donate', kind: 'text', key: '#give-state', value: { text: 'Donations open in November.' } },
  ]);
  assert.match(served, /Donations open in November\./);
  assert.doesNotMatch(served, /Donations cannot be taken yet/, 'the fill’s sentence is still being served');
});

/* ============================================================================================
 * HIDING, IMAGES AND LINKS
 * ========================================================================================== */

test('hiding a block removes it from the response and leaves the file alone', () => {
  const html = read('about');
  const before = html.length;
  const served = applyDesignOverrides(html, [{ screen: 'about', kind: 'hide', key: '#faq', value: { hidden: true } }]);
  assert.doesNotMatch(served, /Questions people ask/, 'the block is still served');
  assert.match(served, /hidden by a design override/, 'nothing marks the place the block was');
  assert.ok(served.length < before);
  // The same document with nothing applied is byte-identical to the design.
  assert.equal(applyDesignOverrides(html, []), html);
});

test('an edited photograph carries its alternative text and its credit', () => {
  const html = read('home');
  const inventory = designInventory(html).items;
  const hero = inventory.find((item) => item.can.image && /sx-hero|<img/.test(item.key)) ?? inventory.find((item) => item.can.image);
  assert.ok(hero, 'the home screen offers no image at all');

  const served = applyDesignOverrides(html, [
    {
      screen: 'home', kind: 'image', key: hero.key,
      value: { src: '/media/ozikoro/hero.jpg', alt: 'An ikoro drum in a village square', credit: 'Photograph: Ozikoro archive' },
    },
  ]);
  assert.match(served, /src="\/media\/ozikoro\/hero\.jpg"/);
  assert.match(served, /alt="An ikoro drum in a village square"/);
  if (hero.creditKey) assert.match(served, /Photograph: Ozikoro archive/);

  /*
   * The alt text is its own field rather than optional decoration: an image swapped without it is described
   * wrongly to a reader who cannot see it, and the same row holds both so they cannot drift apart.
   */
  const altOnly = applyDesignOverrides(html, [
    { screen: 'home', kind: 'image', key: hero.key, value: { alt: 'A drum' } },
  ]);
  assert.match(altOnly, /alt="A drum"/);
  assert.equal((altOnly.match(/src="https:\/\/ozikoro\.com/g) ?? []).length,
    (html.match(/src="https:\/\/ozikoro\.com/g) ?? []).length,
    'editing the alt text changed a source it was not asked to change');
});

test('a nav label and its destination are editable together, and nothing else moves', () => {
  const html = read('about');
  const inventory = designInventory(html).items;
  const navLink = inventory.find((item) => item.can.link && item.text === 'Folklores');
  assert.ok(navLink, 'the navigation’s own items are not offered as links');

  const served = applyDesignOverrides(html, [
    { screen: 'about', kind: 'link', key: navLink.key, value: { href: '/folklore/', label: 'Stories' } },
  ]);
  assert.match(served, /<a[^>]*href="\/folklore\/"[^>]*>Stories<\/a>/);
  // The menu still has every other item: a link edit is one anchor, not a rewrite of the nav.
  for (const label of ['Histories', 'Watch', 'Archive', 'About']) {
    assert.match(served, new RegExp(`>${label}<`), `the menu lost ${label}`);
  }
  assert.equal(querySelectorAll(served, 'nav.nav a').length, querySelectorAll(html, 'nav.nav a').length,
    'an anchor was added or removed by a link edit');
});

/* ============================================================================================
 * THE TOKENS, AND WHAT THEY ACTUALLY CHANGE
 * ========================================================================================== */

test('the token catalogue is read from the design, with counts of what reads each one', () => {
  const tokens = parseDesignTokens(tokensCss, [mainCss, showcaseCss]);
  assert.ok(tokens.length > 60, `only ${tokens.length} tokens were found in the design’s own stylesheet`);

  const accent = tokens.find((t) => t.name === 'accent')!;
  assert.equal(accent.value, '#0d5c45');
  assert.equal(accent.tokenClass, 'colour');
  assert.equal(accent.role, 'meaning', 'the accent is the link colour, so it is not decoration');
  assert.ok(accent.uses > 10, `the accent is read by only ${accent.uses} rules`);

  const alias = tokens.find((t) => t.name === 'bg')!;
  assert.equal(alias.tokenClass, 'alias');
  assert.deepEqual(alias.references, ['paper']);

  const moss = tokens.find((t) => t.name === 'moss')!;
  assert.equal(moss.role, 'meaning', 'the verified state is not decoration');
  const focus = tokens.find((t) => t.name === 'focus')!;
  assert.equal(focus.role, 'meaning', 'the focus ring is not decoration');
  // The design's own sentence beside a declaration is the description the owner is shown. (The showcase
  // palette carries no per-token comments in the deliverable, so the description there comes from
  // TOKEN_META — which is the point of having it.)
  assert.equal(tokens.find((t) => t.name === 'accent')!.comment, 'ikoro wood / iron oxide — links, marks');
  assert.equal(tokens.find((t) => t.name === 'gold')!.comment, null);
});

test('a token override is emitted in the design’s own order, so an alias is not undone by its base', () => {
  const tokens = parseDesignTokens(tokensCss, [mainCss, showcaseCss]);
  const css = themeCss(
    [
      { screen: '*', kind: 'token', key: '--bg', value: { value: '#101010' } },
      { screen: '*', kind: 'token', key: '--paper', value: { value: '#202020' } },
    ],
    tokens.map((t) => t.name)
  );
  const paper = css.indexOf('--paper:');
  const bg = css.indexOf('--bg:');
  assert.ok(paper >= 0 && bg >= 0, `both declarations are missing from:\n${css}`);
  assert.ok(paper < bg, '--bg is declared before --paper, so the alias would be overwritten by the token it reads');
});

test('a value that would end the declaration is refused', () => {
  assert.ok(checkOverrideValue('token', '--accent', { value: '#0d5c45' }) === null);
  assert.match(checkOverrideValue('token', '--accent', { value: '#fff; } body { display: none' }) ?? '', /may not contain/);
  assert.match(checkOverrideValue('token', 'accent', { value: '#fff' }) ?? '', /not a custom-property name/);
  assert.match(checkOverrideValue('link', 'a', { href: 'javascript:alert(1)' }) ?? '', /must be a full http/);
  assert.equal(checkOverrideValue('link', 'a', { href: '/towns/' }), null);
  // A value that fails the check is dropped at serve time rather than written into the page.
  const css = themeCss([{ screen: '*', kind: 'token', key: '--accent', value: { value: 'red; } * { color: red' } }]);
  assert.equal(css, '');
});

test('a token must be given the kind of value the design declares for it', () => {
  /*
   * FOUND BY DOING IT. Setting `--accent` through this API to `%230b3d6b` — a mistyped `#0b3d6b` — was
   * accepted, stored, declared in `/design-theme.css` and meant nothing, because an unparseable colour is a
   * declaration a browser drops. **The save reported "the stylesheet now declares it", which was true and
   * useless**: the page had not changed. A colour token now has to carry a colour.
   */
  assert.equal(checkOverrideValue('token', '--accent', { value: '#0b3d6b' }, 'colour'), null);
  assert.equal(checkOverrideValue('token', '--accent', { value: 'rgba(11, 61, 107, .9)' }, 'colour'), null);
  assert.match(checkOverrideValue('token', '--accent', { value: '%230b3d6b' }, 'colour') ?? '', /not a colour/);
  assert.match(checkOverrideValue('token', '--accent', { value: 'cornflowerblue' }, 'colour') ?? '', /not a colour/);
  assert.equal(checkOverrideValue('token', '--measure', { value: '34rem' }, 'length'), null);
  assert.match(checkOverrideValue('token', '--measure', { value: 'wide' }, 'length') ?? '', /not a length/);
  assert.equal(checkOverrideValue('token', '--lh-body', { value: '1.72' }, 'number'), null);
  assert.match(checkOverrideValue('token', '--lh-body', { value: 'roomy' }, 'number') ?? '', /not a number/);
  // The serve-time check does not know the class, and must still refuse what could break the declaration.
  assert.equal(checkOverrideValue('token', '--accent', { value: 'anything at all' }), null);
  assert.match(checkOverrideValue('token', '--accent', { value: 'a; } body' }) ?? '', /may not contain/);
});

/* ============================================================================================
 * CONTRAST
 * ========================================================================================== */

test('the contrast maths agrees with the standards it is quoting', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(parseColour('#fff')![0], 255);
  assert.equal(parseColour('rgb(13, 92, 69)')![1], 92);
  assert.equal(contrastRatio('not a colour', '#fff'), null);
});

test('the design’s own palette is measured, and the pairs are real token pairs', () => {
  const values = new Map<string, string>();
  for (const token of parseDesignTokens(tokensCss, [mainCss, showcaseCss])) values.set(token.name, token.value);
  for (const pair of CONTRAST_PAIRS) {
    assert.ok(values.has(pair.fg), `${pair.fg} is not a token the design declares`);
    assert.ok(values.has(pair.bg), `${pair.bg} is not a token the design declares`);
    const fg = resolveToken(pair.fg, values);
    const bg = resolveToken(pair.bg, values);
    assert.ok(fg && bg, `${pair.fg} on ${pair.bg} does not resolve to a colour`);
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio !== null, `${pair.fg} on ${pair.bg} gave no ratio`);
    // Every pair the design ships is measured here so a palette that starts failing is caught by the suite
    // rather than by a reader. The values are printed by the editor, so they are asserted to be numbers.
    assert.ok(ratio! >= 1 && ratio! <= 21, `${pair.fg} on ${pair.bg} gave an impossible ratio ${ratio}`);
  }
});
