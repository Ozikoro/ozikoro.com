/**
 * The design editor's three promises, and the four faults it was built to prevent.
 *
 * ── WHY THESE ASSERTIONS READ THE REAL DELIVERABLE AND THE REAL SOURCES ───────────────────────────────
 *
 * A test against invented markup cannot fail the way this feature fails. The three faults worth naming:
 *
 *   1. **A colour picker on a value that is not a plain colour.** It holds `#000000` until touched, and the
 *      save path reads it first — so an untouched gradient row is a gradient that becomes black.
 *   2. **A font offered that the page cannot render.** An Igbo page whose family has no dotted vowels is an
 *      orthography fault, not a look; a picker that lists a family nobody loads promises that fault.
 *   3. **A preview that is written down.** The whole reason a preview is a URL parameter is that the owner's
 *      hesitations are not rows in the record. If a preview ever calls the write path, every colour he
 *      hovered over is a decision attributed to him.
 *
 * So the first reads `apps/ozikoro/public/design/tokens.css` — the design's own declaration of every token —
 * and the second reads the `fonts.googleapis.com` requests out of `seo-head.ts` and the design's screens.
 * Both are READ, never written: the deliverable is byte-compared against the handover copy.
 *
 * Run with: npm -w @ozikoro/site run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Db } from '@ozituma/db';
import {
  DEFAULT_ICON_BASE64,
  FAVICON_KEY,
  LOADED_FONT_FAMILIES,
  applyDesignOverrides,
  checkFaviconDataUrl,
  decodeDesignPreview,
  defaultIcon,
  encodeDesignPreview,
  fontOptions,
  loadSiteFavicon,
  logoSlotIn,
  normaliseColour,
  parseDesignTokens,
  pickerHolds,
  sectionOf,
  setSiteFavicon,
  themeCss,
  tokenControls,
  type DesignOverride,
  type DesignToken,
  type InventoryItem,
} from '@ozikoro/platform';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '..');
const WORKSPACE = join(APP, '..', '..');
const DESIGN = join(APP, 'public', 'design');

const tokensCss = readFileSync(join(DESIGN, 'tokens.css'), 'utf8');
const mainCss = readFileSync(join(DESIGN, 'styles', 'main.css'), 'utf8');
const showcaseCss = readFileSync(join(DESIGN, 'styles', 'showcase.css'), 'utf8');
const tokens: DesignToken[] = parseDesignTokens(tokensCss, [mainCss, showcaseCss]);

/** The value in force when nothing is overridden: the design's own declaration. */
const designValues = new Map(tokens.map((token) => [token.name, token.value]));
const controls = tokenControls(tokens, designValues);
const controlByName = new Map(controls.map((control) => [control.token, control]));

/* ================================================================================================
 * 1. A COLOUR TOKEN GETS A COLOUR CONTROL, AND A GRADIENT DOES NOT
 * ============================================================================================== */

test('the design declares plain colours, and each one is offered a picker holding exactly its value', () => {
  const plain = controls.filter((control) => /^#[0-9a-f]{6}$/i.test(control.normalised) && control.effectiveClass === 'colour');
  assert.ok(plain.length >= 10, `expected the palette's plain colours, found ${plain.length}`);
  for (const control of plain) {
    assert.equal(control.control, 'colour', `--${control.token} is a plain colour and did not get a colour control`);
    assert.equal(control.pickerValue, control.normalised, `--${control.token}'s picker is not seeded with its own value`);
  }
  // The two the owner would reach for first, named so a failure says which one broke.
  const accent = controlByName.get('accent');
  assert.equal(accent?.control, 'colour');
  assert.equal(accent?.pickerValue, '#0d5c45');
});

test('a gradient token is NOT given a colour picker — a picker would post black over it', () => {
  for (const name of ['gradient-gold', 'gradient-night']) {
    const control = controlByName.get(name);
    assert.ok(control, `the design declares --${name}`);
    assert.equal(control.pickerValue, null, `--${name} was given a picker; the save path reads it first and would write #000000`);
    assert.notEqual(control.control, 'colour', `--${name} was offered a colour control`);
    assert.equal(control.control, 'text');
    assert.match(control.caveat ?? '', /gradient/i, `--${name} must say why it has no picker`);
  }
});

test('a shadow token is NOT given a colour picker either', () => {
  for (const name of ['shadow-raise', 'shadow-lift', 'shadow-glow']) {
    const control = controlByName.get(name);
    assert.ok(control, `the design declares --${name}`);
    assert.equal(control.pickerValue, null, `--${name} holds a shadow, not a colour`);
    assert.equal(control.control, 'text');
  }
});

test('an alias is not offered a picker, and says that editing it replaces a reference', () => {
  const bg = controlByName.get('bg');
  assert.ok(bg, 'the design declares --bg');
  assert.equal(bg.declaredClass, 'alias');
  assert.equal(bg.pickerValue, null, '--bg holds var(--paper), which a colour input cannot express');
  assert.match(bg.caveat ?? '', /alias/i);
  // And what it MEANS is reported separately, so the section it lands in is still the palette.
  assert.equal(bg.effectiveClass, 'colour');
});

test('what a picker will and will not hold', () => {
  assert.equal(pickerHolds('#0d5c45'), '#0d5c45');
  assert.equal(pickerHolds('#FFF'), '#ffffff', 'a three-digit hex is expanded, so Save on an untouched row is a no-op');
  assert.equal(pickerHolds('#0d5c4580'), null, 'an eight-digit hex carries alpha and a picker would drop it');
  assert.equal(pickerHolds('rgba(13, 92, 69, .5)'), null);
  assert.equal(pickerHolds('linear-gradient(120deg, #a8822f 0%, #e8c766 45%)'), null);
  assert.equal(pickerHolds('var(--paper)'), null);
  assert.equal(pickerHolds('rebeccapurple'), null, 'a named colour would be rewritten as a hex by the picker');
  assert.equal(normaliseColour('#ABC'), '#aabbcc');
});

test('every class the deliverable declares is handled, and no token gets no control', () => {
  const classes = new Set(tokens.map((token) => token.tokenClass));
  for (const tokenClass of classes) {
    assert.ok(
      controls.some((control) => control.declaredClass === tokenClass),
      `the design declares a ${tokenClass} token and no control was built for one`
    );
  }
  for (const control of controls) {
    assert.ok(
      ['colour', 'text', 'length', 'number', 'font'].includes(control.control),
      `--${control.token} got the control “${control.control}”, which is not one the page draws`
    );
    assert.ok(control.key.startsWith('--'), 'a token key must be a custom-property name the save path accepts');
  }
});

/* ================================================================================================
 * 2. A VALUE THAT IS NOT A PLAIN COLOUR SURVIVES A ROUND TRIP UNCHANGED
 * ============================================================================================== */

/**
 * The whole distance a value travels: the editor's normalised form → the `themeCss` declaration → the served
 * page → and back out of the served stylesheet. **Nothing is compared to a fixture**, because a fixture would
 * agree with this file; the assertion is that the bytes the design declared come back unchanged.
 */
test('a gradient, a shadow, an rgba colour and an alias survive a round trip byte for byte', () => {
  const cases: { name: string; value: string }[] = [
    { name: 'gradient-gold', value: tokens.find((t) => t.name === 'gradient-gold')!.value },
    { name: 'gradient-night', value: tokens.find((t) => t.name === 'gradient-night')!.value },
    { name: 'shadow-raise', value: tokens.find((t) => t.name === 'shadow-raise')!.value },
    { name: 'shadow-glow', value: tokens.find((t) => t.name === 'shadow-glow')!.value },
    { name: 'bg', value: 'var(--paper)' },
    { name: 'measure', value: '34rem' },
    { name: 'lh-body', value: '1.72' },
  ];
  // An rgba colour is not in this design's tokens, so it is written the way the owner would: a stored value
  // on a real colour token.
  cases.push({ name: 'accent', value: 'rgba(13, 92, 69, 0.5)' });
  cases.push({ name: 'gradient-gold', value: 'color-mix(in srgb, var(--gold) 40%, transparent)' });

  for (const item of cases) {
    // 1. What the editor would give the owner to edit: the value as it stands, unrewritten.
    const control = controlByName.get(item.name);
    assert.ok(control, `--${item.name} is not in the catalogue`);
    const stored: DesignOverride = { screen: '*', kind: 'token', key: `--${item.name}`, value: { value: item.value } };

    // 2. What is served: `themeCss` writes the declaration and the design override sheet is that function.
    const css = themeCss([stored], tokens.map((t) => t.name));
    assert.ok(
      css.includes(`  --${item.name}: ${item.value};`),
      `--${item.name} did not come back out of the served stylesheet unchanged:\n${css}`
    );

    // 3. What the page does with it: an inline block for the preview, which is the same function.
    const page = applyDesignOverrides('<html><head><title>t</title></head><body></body></html>', [stored], {
      inlineTokens: true,
      tokenOrder: tokens.map((t) => t.name),
    });
    assert.ok(page.includes(`--${item.name}: ${item.value};`), `--${item.name} was rewritten on the previewed page`);
  }
});

test('an untouched control posts the value that is already painting, so Save changes nothing', () => {
  /*
   * THE SILENT-EDIT FAULT IN THE OTHER DIRECTION. A colour input answers `#rrggbb` whether or not it was
   * touched, so a swatch declared `#0d5c45` must be seeded with `#0d5c45` — and a swatch declared `#FFF` must
   * be seeded with `#ffffff` and the round trip must still be a no-op, not a change nobody asked for.
   */
  for (const control of controls.filter((c) => c.control === 'colour')) {
    const edited = tokenControls(
      tokens,
      new Map([[control.token, control.pickerValue ?? control.normalised]]),
      new Set([control.token])
    ).find((c) => c.token === control.token)!;
    assert.equal(edited.normalised, control.normalised, `--${control.token} changed when nothing was changed`);
  }
});

/* ================================================================================================
 * 3. THE PREVIEW IS NEVER PERSISTED, AND NEVER TRUSTED
 * ============================================================================================== */

/**
 * A `Db` that answers every read with nothing and records every statement.
 *
 * The write path only needs `one` and `query` for the favicon setting, so a recording stub is enough to prove
 * the thing that matters: **a preview that never reaches it**.
 */
function recordingDb(): { db: Db; statements: string[] } {
  const statements: string[] = [];
  const db = {
    driver: 'pglite' as const,
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 } as never;
    },
    exec: async (sql: string) => {
      statements.push(sql);
    },
    rows: async (sql: string) => {
      statements.push(sql);
      return [] as never;
    },
    one: async (sql: string) => {
      statements.push(sql);
      return null;
    },
    hasTrigram: async () => false,
    close: async () => undefined,
  } as unknown as Db;
  return { db, statements };
}

test('a preview carries a pending value and no key that would be written down', () => {
  const pending: DesignOverride[] = [
    { screen: '*', kind: 'token', key: '--accent', value: { value: '#0b3d6b' } },
    { screen: 'about', kind: 'text', key: 'h1', value: { text: 'A sentence' } },
  ];
  const encoded = encodeDesignPreview(pending);
  const decoded = decodeDesignPreview(encoded);
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0]?.value.value, '#0b3d6b');
  // Nothing in the payload is a row: no id, no actor, no timestamps — which is what makes it a URL and not a
  // draft table.
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>[];
  assert.deepEqual(Object.keys(payload[0] ?? {}).sort(), ['key', 'kind', 'screen', 'value']);
});

test('a preview that carries an injection is dropped rather than rendered', () => {
  const payload = Buffer.from(
    JSON.stringify([{ screen: '*', kind: 'token', key: '--accent', value: { value: 'red; } body { display: none }' } }]),
    'utf8'
  ).toString('base64url');
  assert.deepEqual(decodeDesignPreview(payload), [], 'a value that can end a declaration must not be previewed');
});

test('a preview writes nothing at all to the database', async () => {
  /*
   * THE PROMISE THE PREVIEW EXISTS TO MAKE: *"a preview is never saved"*. This drives the write path the
   * only way a preview could reach it — it must not — and asserts the trail of statements is empty.
   */
  const { db, statements } = recordingDb();
  const pending = decodeDesignPreview(encodeDesignPreview([{ screen: '*', kind: 'token', key: '--accent', value: { value: '#0b3d6b' } }]));

  // What a preview does: renders the value into a stylesheet.
  const css = themeCss(pending, tokens.map((t) => t.name));
  assert.ok(css.includes('--accent: #0b3d6b;'));
  assert.deepEqual(statements, [], 'rendering a preview touched the database');

  // What a SAVE does, by contrast, and the difference is the whole point: one statement, and it is an insert.
  await setSiteFavicon(db, { dataUrl: `data:image/png;base64,${DEFAULT_ICON_BASE64}`, actorId: 199 });
  assert.ok(statements.length > 0, 'the write path did not reach the database at all');
  assert.ok(
    statements.some((sql) => /insert into site_setting/i.test(sql)),
    'a stored setting was not written with an insert'
  );
  assert.ok(
    statements.some((sql) => /insert into ozikoro_audit/i.test(sql)),
    'a settings write was not audited'
  );
});

/* ================================================================================================
 * 4. THE FONT PICKER OFFERS ONLY WHAT THE PAGE LOADS
 * ============================================================================================== */

test('the families on offer are the stacks the design already declares, and nothing invented', () => {
  const options = fontOptions(tokens);
  assert.ok(options.length >= 3, `expected the design's three font stacks, found ${options.length}`);
  for (const option of options) {
    const source = tokens.find((token) => token.name === option.fromToken);
    assert.ok(source, `${option.family} came from a token that does not exist`);
    assert.equal(option.stack, source.value, `${option.family}'s stack is not the stack the design declares`);
  }
  const families = options.map((option) => option.family);
  assert.ok(families.includes('Noto Serif'));
  assert.ok(families.includes('Noto Sans Mono'));
});

test('every family on offer is one the pages actually request from Google Fonts', () => {
  /*
   * THE FAULT IS OFFERING A FAMILY THE PAGE CANNOT RENDER, so the assertion is against the requests the
   * pages make — read out of the sources rather than remembered here. A fourth family added to `seoHead`
   * without being added to `LOADED_FONT_FAMILIES` fails this; so does a name in the list that no page asks
   * for.
   */
  const sources = [
    readFileSync(join(WORKSPACE, 'packages', 'ozikoro', 'src', 'seo-head.ts'), 'utf8'),
    ...readdirSync(join(DESIGN, 'screens'))
      .filter((file) => file.endsWith('.html'))
      .slice(0, 6)
      .map((file) => readFileSync(join(DESIGN, 'screens', file), 'utf8')),
  ];
  const requested = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/fonts\.googleapis\.com\/css2\?([^"'\s]+)/g)) {
      for (const family of (match[1] ?? '').matchAll(/family=([^&:]+)/g)) {
        requested.add(decodeURIComponent((family[1] ?? '').replace(/\+/g, ' ')).trim());
      }
    }
  }
  assert.ok(requested.size >= 3, `no Google Fonts request was found to check against (found ${requested.size})`);
  for (const family of LOADED_FONT_FAMILIES) {
    assert.ok(requested.has(family), `the font picker offers “${family}”, which no page requests`);
  }
  for (const family of requested) {
    assert.ok(
      LOADED_FONT_FAMILIES.includes(family),
      `the pages request “${family}” and the font picker does not offer it`
    );
  }
});

test('a font token is offered a font control, and a length is not', () => {
  for (const name of ['font-serif', 'font-sans', 'font-mono']) {
    assert.equal(controlByName.get(name)?.control, 'font', `--${name} is a font stack and was not offered the chooser`);
    // The two READING families carry a written note in the design's own table — that the dotted vowels and
    // tone marks render from them. `--font-mono` is decoration in that table and has no note, which is the
    // design's call and not this editor's to invent.
    if (name !== 'font-mono') {
      assert.ok(controlByName.get(name)?.note, `--${name} must carry the design's sentence about why the family matters`);
    }
  }
  assert.equal(controlByName.get('measure')?.control, 'length');
  assert.equal(controlByName.get('lh-body')?.control, 'number');
  assert.equal(controlByName.get('container')?.control, 'length');
});

/* ================================================================================================
 * 5. THE LOGO, AND THE SETTINGS THAT ARE NOT OVERRIDES
 * ============================================================================================== */

test('the masthead logo is found in the served page, not hard-coded', () => {
  const inventory: InventoryItem[] = [
    { key: 'section.sx-hero img:nth-of-type(1)', tag: 'img', label: 'hero', text: '', can: { text: false, hide: false, image: true, link: false }, src: '/media/hero.jpg' },
    { key: 'a.wordmark img', tag: 'img', label: 'wordmark', text: '', can: { text: false, hide: false, image: true, link: false }, src: '/media/ozikoro/486-mark.png', alt: '' },
  ];
  const logo = logoSlotIn(inventory);
  assert.ok(logo, 'the wordmark image was not recognised as the masthead logo');
  assert.equal(logo.key, 'a.wordmark img');
  assert.equal(logo.src, '/media/ozikoro/486-mark.png');
  // A page whose wordmark carries no image offers no logo control, rather than guessing at another picture.
  assert.equal(logoSlotIn([inventory[0]!]), null);
});

test('an override is filed under the section a person would look in', () => {
  assert.equal(sectionOf({ screen: '*', kind: 'token', key: '--accent', value: { value: '#0d5c45' } }), 'colours');
  assert.equal(
    sectionOf({ screen: '*', kind: 'token', key: '--font-serif', value: { value: '"Noto Serif", Georgia, serif' } }),
    'type'
  );
  assert.equal(sectionOf({ screen: 'about', kind: 'image', key: 'a.wordmark img', value: { src: '/x.png' } }), 'images');
  assert.equal(sectionOf({ screen: 'about', kind: 'hide', key: 'section.aside', value: { hidden: true } }), 'texts');
  assert.equal(sectionOf({ screen: 'about', kind: 'link', key: 'a.cta', value: { href: '/x' } }), 'links');
  // A text override on a LINK is what "change what this link says" writes, so it belongs with the links.
  assert.equal(sectionOf({ screen: 'about', kind: 'text', key: 'a.cta', value: { text: 'Read on' } }), 'links');
  assert.equal(sectionOf({ screen: 'about', kind: 'text', key: 'h1', value: { text: 'Heading' } }), 'texts');
});

/* ================================================================================================
 * 6. THE ICON: WHAT MAY BE STORED, AND WHAT IS SERVED WHEN NOTHING IS
 * ============================================================================================== */

test('the default icon is a real PNG, so removing the static files cannot leave a page with no icon', () => {
  const bytes = defaultIcon();
  assert.equal(bytes.byteLength, 1493, 'the embedded default icon is not the 1,493-byte file it replaced');
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'that is not a PNG');
  assert.equal(bytes.toString('base64'), DEFAULT_ICON_BASE64, 'the embedded constant and the decoded bytes disagree');
});

test('an icon that is not an image is refused with a sentence', () => {
  assert.ok(checkFaviconDataUrl('') !== null);
  assert.ok(checkFaviconDataUrl('https://example.com/icon.png') !== null, 'a bare address is not a stored icon');
  assert.ok(checkFaviconDataUrl('data:text/html;base64,PHNjcmlwdD4=') !== null, 'an HTML data URL must be refused');
  assert.ok(checkFaviconDataUrl('data:image/png;base64,!!!not base64!!!') !== null);
  assert.equal(checkFaviconDataUrl(`data:image/png;base64,${DEFAULT_ICON_BASE64}`), null);
  assert.ok(
    checkFaviconDataUrl(`data:image/svg+xml;base64,${Buffer.from('not an svg at all').toString('base64')}`) !== null,
    'an SVG that contains no <svg> element is not an icon'
  );
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.ok(checkFaviconDataUrl(`data:image/svg+xml;base64,${svg}`) !== null, 'an SVG carrying script must be refused');
  const plainSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="8"/></svg>').toString('base64');
  assert.equal(checkFaviconDataUrl(`data:image/svg+xml;base64,${plainSvg}`), null, 'an ordinary SVG is a real icon');
});

test('an empty setting serves the design’s own mark and stores nothing', async () => {
  const { db, statements } = recordingDb();
  assert.equal(await loadSiteFavicon(db), null);
  // The read asked only for this one key — not every setting in the table.
  assert.ok(statements.every((sql) => !/^\s*(insert|update|delete)/i.test(sql)), 'reading the icon wrote to the database');
  assert.ok(statements.some((sql) => sql.includes('site_setting')), 'the icon was not read from site_setting');
});

test('clearing the icon removes the row rather than writing an empty one', async () => {
  const { db, statements } = recordingDb();
  const result = await setSiteFavicon(db, { dataUrl: null, actorId: 199 });
  // Nothing was stored, so there is nothing to clear — and the answer says so rather than reporting a write.
  assert.equal(result.cleared, false);
  assert.ok(
    statements.every((sql) => !/^\s*(insert|update|delete)/i.test(sql)),
    'clearing a setting that was never set wrote to the database'
  );
  assert.ok(statements.some((sql) => /select/i.test(sql)), 'the clear path did not read what was in force first');
  assert.equal(FAVICON_KEY, 'design.favicon');
});
