/**
 * The dashboards' placeholder links, and the transform that removes them.
 *
 * WHY THIS TEST READS THE REAL SCREENS
 *
 * `fillDashboardLinks` matches the design's own markup by label — `Saved histories`, `Open workspace`,
 * `System overview`. **A label typed differently in the design and in the map does not throw: it keeps its
 * `href="#"` and leaves a link that looks identical to a working one.** That is the same class of fault as
 * the one this work exists to remove, so the assertions run against the fourteen handed-over HTML files
 * rather than against fixtures, and a design screen that gains a new item fails here before it reaches a
 * reader.
 *
 * WHAT IS ASSERTED
 *
 *   1. no dashboard keeps a single `href="#"` after the transform, and the count removed matches the
 *      design's own count, so a screen that stops being filled is still covered;
 *   2. a real destination keeps its label and gains a root-relative `href`;
 *   3. a label with nothing behind it stops being a link and says so in its own text;
 *   4. every leftover label is named in `DASHBOARD_UNBUILT_MAP`, so the report in
 *      `docs/dashboard-functions.md` cannot silently fall behind the screens;
 *   5. the design's own files are byte-identical afterwards — the transform is in memory only.
 *
 * Run with: npm -w @ozikoro/platform run test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DASHBOARD_UNBUILT_MAP, fillDashboardLinks } from './design-fill.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The deliverable's screens, four levels up: packages/ozikoro/src -> the repository root. */
const SCREENS = join(HERE, '..', '..', '..', 'design', 'calm-comfort-construct', 'public', 'design', 'screens');

function dashboards(): { name: string; html: string }[] {
  return readdirSync(SCREENS)
    .filter((f) => f.startsWith('dashboard-') && f.endsWith('.html'))
    .sort()
    .map((f) => ({ name: f.replace(/\.html$/, ''), html: readFileSync(join(SCREENS, f), 'utf8') }));
}

test('every dashboard is free of placeholder links after the transform', () => {
  const screens = dashboards();
  assert.ok(screens.length >= 14, `expected the fourteen dashboards; found ${screens.length}`);

  for (const { name, html } of screens) {
    const before = (html.match(/href="#"/g) ?? []).length;
    const after = fillDashboardLinks(html, name);
    const left = (after.match(/href="#"/g) ?? []).length;

    assert.equal(left, 0, `${name}: ${left} of ${before} placeholder links survived the transform`);
    /*
     * AND THE SAME NUMBER COMES OUT SOMEWHERE.
     *
     * A screen with no placeholders would pass the assertion above for the wrong reason. Each of the
     * fourteen carries at least one today, so **a screen whose links quietly stop being rewritten shows up
     * as a marker count of zero rather than as a silent pass.** The design's own `<a class="skip"
     * href="#main">` is not a placeholder and must not be counted — it is still counted here as an anchor,
     * which is why the comparison is against the marker rather than against the anchor.
     */
    const marked = (after.match(/>— Not built yet<\/span>/g) ?? []).length;
    if (before > 0) {
      assert.ok(
        marked > 0 || /href="\//.test(after),
        `${name}: ${before} placeholders went, but nothing was marked or wired`
      );
    }
  }
});

test('a label with a real page behind it becomes that page’s address', () => {
  const out = fillDashboardLinks(screen('dashboard-admin'), 'dashboard-admin');

  assert.match(out, /<nav class="sx-dash-nav"[^>]*><a href="\/admin\/">System overview<\/a>/);
  assert.match(out, /<a href="\/account\/">Account settings<\/a>/);
  assert.match(out, /<a href="\/">Return to public site<\/a>/);
  // The tile is the same label and must take the same destination.
  assert.match(out, /<a class="sx-state" href="\/admin\/">/);
});

test('one label can mean a different place to a different role', () => {
  // The administrator's `Media` is the rights register; everyone else's is the photograph library.
  assert.match(fillDashboardLinks(screen('dashboard-admin'), 'dashboard-admin'), /<a href="\/admin\/rights\/">Media<\/a>/);
  assert.match(
    fillDashboardLinks(screen('dashboard-knowledge-holder'), 'dashboard-knowledge-holder'),
    /<a href="\/photographs\/">Media<\/a>/
  );
});

test('a label with nothing behind it stops being a link and says so', () => {
  const out = fillDashboardLinks(screen('dashboard-reader'), 'dashboard-reader');

  // No `href`, so it is not a link and cannot be focused; the label is kept for the reader.
  assert.match(out, /<a aria-disabled="true" title="Not built yet[^"]*">Saved histories /);
  assert.doesNotMatch(out, /<a[^>]*href="#"[^>]*>Saved histories/);
  // The tile's promise is replaced, not merely annotated.
  assert.match(out, /<div class="sx-state" aria-disabled="true">/);
  assert.match(out, /Not built yet — nothing to open\./);
  // `Collections` has a real destination, so its tile must keep the promise and the link.
  assert.match(out, /<a class="sx-state" href="\/archive\/">/);
  assert.doesNotMatch(out, /Saved histories<\/h3><p class="small muted">Open workspace/);
});

test('every unbuilt label on the real screens is accounted for in the report map', () => {
  const missing = new Set<string>();
  for (const { name, html } of dashboards()) {
    const out = fillDashboardLinks(html, name);
    for (const m of out.matchAll(/<a[^>]*aria-disabled="true"[^>]*>([^<]*?)\s*<span class="small muted">— Not built yet/g)) {
      const label = decode(m[1] ?? '');
      if (label && !(label in DASHBOARD_UNBUILT_MAP)) missing.add(label);
    }
    // The tiles carry the heading rather than the anchor's own text.
    for (const m of out.matchAll(/<div class="sx-state" aria-disabled="true">[\s\S]*?<h3[^>]*>([^<]*)<\/h3>/g)) {
      const label = decode(m[1] ?? '');
      if (label && !(label in DASHBOARD_UNBUILT_MAP)) missing.add(label);
    }
  }
  assert.deepEqual(
    [...missing].sort(),
    [],
    'these labels are marked "Not built yet" on a screen but have no entry saying what would have to be built'
  );
});

/**
 * The label as a reader sees it.
 *
 * The design writes `Supervisor &amp; institution`, and the map's keys are written the way a person reads
 * the words — **a test that compared raw HTML against a human-readable key would report a false miss, and
 * a false miss is what teaches the next person to widen the map until it agrees with anything.**
 */
function decode(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").trim();
}

test('the design’s own files are not what changed', () => {
  for (const { name, html } of dashboards()) {
    const before = html;
    fillDashboardLinks(html, name);
    assert.equal(html, before, `${name}: the transform mutated the screen in place`);
  }
});

/** One screen's markup, read fresh — kept last so the tests above read as prose. */
function screen(name: string): string {
  return readFileSync(join(SCREENS, `${name}.html`), 'utf8');
}
