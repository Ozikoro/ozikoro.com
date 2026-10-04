/*
 * probe-overflow.mjs — measure ONE page's layout in real Chrome, and photograph it.
 *
 * A fetch cannot see any of this. Whether an element leaves the page, or sits outside the design's
 * content column, is a question only a layout engine can answer, so this drives Chrome over the
 * DevTools Protocol and reads `getBoundingClientRect()` and `scrollWidth` from the document itself.
 *
 * The measurement and its four fault classes live in `scripts/lib/overflow-probe.mjs`, shared with
 * `scripts/sweep-overflow.mjs` so the two can never disagree about the same page.
 *
 * Usage:
 *   node scripts/probe-overflow.mjs --url http://127.0.0.1:3110/about/ --width 390
 *   node scripts/probe-overflow.mjs --url ... --width 390 --find "largest open problem"
 *   node scripts/probe-overflow.mjs --url ... --width 390 --find "..." --shot /tmp/a.png --viewport-shot
 *   node scripts/probe-overflow.mjs --url ... --width 390 --json      (one JSON object, for a caller)
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { openBrowser, navigate, settlePage, measure, sleep } from './lib/overflow-probe.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(name);

const url = arg('--url');
const width = Number(arg('--width', '1440'));
const height = Number(arg('--height', '900'));
const shot = arg('--shot', null);
const clipSel = arg('--clip', null);
const findText = arg('--find', null);
const settle = Number(arg('--settle', '3'));

if (!url) {
  console.error('usage: node scripts/probe-overflow.mjs --url <url> --width <px> [--shot out.png] [--find text] [--json]');
  process.exit(2);
}

const browser = await openBrowser({ width, height, tag: 'probe' });
if (!(await navigate(browser.send, url, settle))) {
  console.error(`probe: could not load ${url}`);
  await browser.close();
  process.exit(1);
}
await settlePage(browser.send);

let data;
try {
  data = await measure(browser.send, findText);
} catch (e) {
  console.error(`probe: ${e.message} for ${url}`);
  await browser.close();
  process.exit(1);
}

if (shot) {
  const scrollTo = arg('--scroll-to', clipSel || findText);
  if (scrollTo) {
    await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const needle = ${JSON.stringify(scrollTo)};
        const all = [...document.body.querySelectorAll('*')];
        /* querySelector THROWS on a string that is not a valid selector — and the strings this tool is
         * given are usually prose, not selectors. Left unguarded the throw is swallowed by the protocol
         * call and the page silently never scrolls, which is how a "before" and an "after" screenshot both
         * end up showing the top of the page. */
        let el = null;
        try { el = document.querySelector(needle); } catch {}
        if (!el) {
          const hits = all.filter((n) => (n.textContent || '').includes(needle));
          el = hits.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
        }
        if (el) window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + scrollY - 120));
        return el ? el.tagName : 'NOT FOUND';
      })()`,
      returnByValue: true,
    });
    await sleep(700);
  }
  const params = { format: 'png', captureBeyondViewport: !flag('--viewport-shot') };
  if (clipSel) {
    const r = await browser.send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(clipSel)}); if (!el) return 'null';
        const b = el.getBoundingClientRect();
        return JSON.stringify({ x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }); })()`,
      returnByValue: true,
    });
    const raw = r?.result?.result?.value;
    if (raw && raw !== 'null') {
      const c = JSON.parse(raw);
      params.clip = { x: Math.max(0, c.x - 8), y: Math.max(0, c.y - 8), width: c.width + 16, height: Math.min(c.height + 16, 6000), scale: 1 };
    }
  }
  const cap = await browser.send('Page.captureScreenshot', params);
  const b64 = cap?.result?.data;
  if (b64) {
    await mkdir(dirname(shot), { recursive: true }).catch(() => {});
    await writeFile(shot, Buffer.from(b64, 'base64'));
    data.screenshot = shot;
  } else {
    data.screenshotError = 'captureScreenshot returned no data';
  }
}

await browser.close();

if (flag('--json')) {
  console.log(JSON.stringify(data));
} else {
  const { leaksRight, leaksLeft, selfOverflow, outsideWrap, found, ...head } = data;
  console.log(JSON.stringify(head, null, 1));
  if (found) console.log('\nFOUND:\n' + JSON.stringify(found, null, 1));
  console.log(`\nleak-right (${leaksRight.length}):`);
  for (const o of leaksRight) console.log(`  +${o.over}  ${o.sel}  rect=${JSON.stringify(o.rect)}  parent=${o.parent ? o.parent.sel + ' ' + JSON.stringify(o.parent.rect) : 'none'}  maxW=${o.style.maxWidth} minW=${o.style.minWidth} ws=${o.style.whiteSpace}`);
  console.log(`\nleak-left (${leaksLeft.length}):`);
  for (const o of leaksLeft) console.log(`  -${o.over}  ${o.sel}  rect=${JSON.stringify(o.rect)}`);
  console.log(`\nself-overflow (${selfOverflow.length}):`);
  for (const o of selfOverflow) console.log(`  ${o.over}  ${o.sel}  scrollW=${o.scrollW} clientW=${o.clientW}`);
  console.log(`\noutside-the-content-column (${outsideWrap.length}):`);
  for (const o of outsideWrap) console.log(`  ${o.sel}  rect=${JSON.stringify(o.rect)}  anchor=${o.anchor}@${o.anchorX}  "${o.text}"`);
}

process.exit(0);
