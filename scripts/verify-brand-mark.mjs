/*
 * verify-brand-mark.mjs — the owner's mark, measured in a real browser at 390 px and 1280 px.
 *
 * WHY A BROWSER AND NOT `curl`
 *
 * The question is not "is the `<img>` in the HTML" — `design-paths.test.ts` already asserts that against the
 * real deliverable. It is four questions a served string cannot answer:
 *
 *   1. **DOES THE IMAGE LOAD.** `/media/ozikoro/486-cropped-Ozi-Ikoro-Icon-Yellow-1.png` is absolute, so it
 *      must resolve from `/`, from `/<slug>/`, from `/folklore/`, from `/about/`, from `/signin/` and from a
 *      three-segment address. `naturalWidth` is the only honest answer, and it is read from the page's own
 *      loaded image. A 404 leaves `naturalWidth === 0` while the markup still looks right.
 *   2. **IS IT THE DESIGN'S OWN 34×34 ROUND TREATMENT.** `showcase.css:20` is `.wordmark img`; the dashboard
 *      rail's anchor does not carry that class in the deliverable, so it is given it at serve time and this
 *      measures the cascade rather than trusting it. `getComputedStyle` + `getBoundingClientRect` are the
 *      measurement.
 *   3. **HOW MANY ARE THERE.** The rule is exactly one mark per header: the front page already drew one and
 *      must not have gained a second. Counted in the DOM, per page.
 *   4. **DID THE WORDS SURVIVE.** He asked for a logo, not for the name to go. The visible text of the brand
 *      and its anchor's `href` are read, not assumed.
 *
 * WHAT IT MEASURES, AND WHAT IT PHOTOGRAPHS
 *
 *   A. Six pages at 390 px and 1280 px — the mark inside the brand slot: `src`, `alt`, whether it LOADED, its
 *      rendered size and radius, the anchor it sits in, the words beside it, and the page-wide count.
 *   B. THE DASHBOARD RAIL'S OWN SLOT, in the same browser with the same stylesheets: the served dashboard
 *      brand markup is injected into a real page and the cascaded size of its image is read, because
 *      `/dashboard-reader/` answers 307 to a signed-out reader and cannot be photographed from here.
 *   C. A PHOTOGRAPH OF EACH HEADER at each width, written to `.shots/brand/`.
 *
 * USAGE
 *   node scripts/verify-brand-mark.mjs
 *   BASE=http://127.0.0.1:3110 node scripts/verify-brand-mark.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? `http://127.0.0.1:${process.env.PORT ?? '3110'}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MARK = '/media/ozikoro/486-cropped-Ozi-Ikoro-Icon-Yellow-1.png';
const SHOTS = '.shots/brand';

mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { base: BASE, pages: [], problems: [] };
const problem = (m) => { report.problems.push(m); console.log(`  PROBLEM  ${m}`); };
const note = (m) => console.log(`  ${m}`);

const PAGES = [
  ['front', '/', 'the front page — the one screen that already drew the mark'],
  ['record', '/why-a-hawk-kills-chickens/', 'a record at /<slug>/ — the reader header, which had none'],
  ['design', '/folklore/', 'a design screen'],
  ['app', '/about/', 'an application route — the app layout masthead'],
  ['account', '/signin/', 'the account screen — a.brand, served by account-screen.ts'],
  ['nested', '/podcast/how-tortoise-got-his-bumpy-shell/transcript/', 'three segments deep, to prove the src resolves there'],
  /*
   * AND ONE MORE, BECAUSE A RAW `grep` OF THIS PAGE COUNTS THE MARK TWICE. `/town/<slug>/` is a React route
   * and its HTML carries the server-rendered masthead AND the same markup again inside the RSC flight
   * payload — inert text in a `self.__next_f.push(…)` call, not a second element. **Counting DOM elements is
   * how the difference is told apart**, which is the whole reason this probe reads the document.
   */
  ['town', '/town/igbodo-northern-ika/', 'a React route with an RSC payload that repeats the markup as text'],
];
const WIDTHS = [390, 1280];

const debugPort = 9700 + Math.floor(Math.random() * 90);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/oz-brand-mark-${debugPort}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* Chrome is still starting. */ }
  }
  if (!target) throw new Error('Chrome did not expose a page target on the debugging port');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); resolve({ timedOut: true, method }); } }, 20000);
  });

  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r?.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'evaluate failed');
    return r?.result?.result?.value;
  };

  /*
   * BELOW 500 px THIS IS THE ONLY WAY, and the repository has the measurement recorded: `--window-size` will
   * not go below about 500, so a "390" shot from it is really a 500 px layout.
   */
  async function open(url, width, height = 900) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 640 });
    await send('Page.navigate', { url });
    for (let i = 0; i < 80; i += 1) {
      await sleep(150);
      if (await evaluate('document.readyState') === 'complete') break;
    }
    for (let i = 0; i < 40; i += 1) {
      await sleep(120);
      const done = await evaluate(`[...document.images].every((i) => i.complete)`);
      if (done) break;
    }
    await evaluate('window.scrollTo(0, 0)');
    await sleep(500);
  }

  const shot = async (out, width) => {
    const cap = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width, height: 150, scale: 2 },
      captureBeyondViewport: false,
    });
    const data = cap?.result?.data;
    if (data) { writeFileSync(out, Buffer.from(data, 'base64')); note(`shot ${out}`); }
    else problem(`captureScreenshot returned nothing for ${out}`);
  };

  /* The brand slot on every page: the design's own `.wordmark`, the dashboard's `.sx-dash-brand`, the
   * account screen's `a.brand`. Exactly one is expected. */
  const READ_BRAND = `(() => {
    const slots = [...document.querySelectorAll('a.wordmark, a.sx-dash-brand, a.brand')]
      .filter((a) => a.closest('header, .masthead, .headin, .sx-dash-side, .sx-reader-header') || a.classList.contains('brand'));
    return slots.map((a) => {
      const imgs = [...a.querySelectorAll('img')];
      const mine = imgs.filter((i) => i.getAttribute('src') === ${JSON.stringify(MARK)});
      const i = mine[0];
      const cs = i ? getComputedStyle(i) : null;
      const r = i ? i.getBoundingClientRect() : null;
      return {
        html: a.outerHTML.slice(0, 260),
        href: a.getAttribute('href'),
        classes: a.className,
        text: (a.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        imgs: imgs.length,
        marks: mine.length,
        mark: i ? {
          src: i.getAttribute('src'),
          alt: i.getAttribute('alt'),
          complete: i.complete,
          naturalWidth: i.naturalWidth,
          naturalHeight: i.naturalHeight,
          w: r ? +r.width.toFixed(2) : null,
          h: r ? +r.height.toFixed(2) : null,
          radius: cs.borderRadius,
          display: cs.display,
        } : null,
      };
    });
  })()`;

  /* Every mark of this kind anywhere in the document, so a second one outside the header is caught too. */
  const PAGE_MARKS = `[...document.querySelectorAll('img')]
    .filter((i) => (i.getAttribute('src') ?? '').includes('486-cropped-Ozi-Ikoro-Icon-Yellow-1'))
    .map((i) => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt'), loaded: i.naturalWidth > 0 }))`;

  for (const width of WIDTHS) {
    console.log(`\n${'═'.repeat(100)}\nAT ${width} px\n${'═'.repeat(100)}`);
    for (const [label, path, why] of PAGES) {
      await open(`${BASE}${path}`, width);
      const slots = await evaluate(READ_BRAND);
      const pageMarks = await evaluate(PAGE_MARKS);
      const row = { label, path, width, slots, pageMarks };
      report.pages.push(row);

      console.log(`\n── ${label}  ${path}  (${why})`);
      note(`brand slots: ${slots.length}   marks of ours on the whole page: ${pageMarks.length}`);
      if (slots.length !== 1) problem(`${path} at ${width}: ${slots.length} brand slots, and the measurement is one`);
      if (pageMarks.length !== 1) problem(`${path} at ${width}: ${pageMarks.length} marks on the page, not one`);
      for (const s of slots) {
        note(`href=${s.href}  classes=${JSON.stringify(s.classes)}  text=${JSON.stringify(s.text)}`);
        note(`  images in the slot: ${s.imgs} of ours: ${s.marks}`);
        if (s.mark) {
          note(`  src=${s.mark.src}  alt=${JSON.stringify(s.mark.alt)}  loaded=${s.mark.naturalWidth > 0 ? 'yes' : 'NO'} (${s.mark.naturalWidth}x${s.mark.naturalHeight})`);
          note(`  rendered ${s.mark.w}x${s.mark.h}  radius=${s.mark.radius}  display=${s.mark.display}`);
          if (s.mark.src !== MARK) problem(`${path} at ${width}: the slot's mark is not the archive's own: ${s.mark.src}`);
          if (!(s.mark.src ?? '').startsWith('/')) problem(`${path} at ${width}: the mark's src is relative: ${s.mark.src}`);
          if (s.mark.alt !== '') problem(`${path} at ${width}: the mark's alt is not the design's empty one: ${JSON.stringify(s.mark.alt)}`);
          if (s.mark.naturalWidth <= 0) problem(`${path} at ${width}: THE MARK DID NOT LOAD (404 or blocked)`);
          if (!(s.mark.w > 30 && s.mark.w < 42)) problem(`${path} at ${width}: the mark is not the design's ~34 px wide: ${s.mark.w}`);
          if (s.mark.w !== s.mark.h) problem(`${path} at ${width}: the mark is not square: ${s.mark.w}x${s.mark.h}`);
          if (!/50%|9999px|1[0-9]px/.test(s.mark.radius)) problem(`${path} at ${width}: the mark is not round: ${s.mark.radius}`);
        } else {
          problem(`${path} at ${width}: the brand slot carries no mark`);
        }
        if (s.marks !== 1) problem(`${path} at ${width}: ${s.marks} marks in the brand slot, not one`);
        if (s.href !== '/') problem(`${path} at ${width}: the brand anchor is not the site root: ${s.href}`);
        if (!/Ozikoro/.test(s.text)) problem(`${path} at ${width}: the brand's name left the header: ${JSON.stringify(s.text)}`);
      }
      await shot(`${SHOTS}/${label}-${width}.png`, width);
    }
  }

  /*
   * ── B. THE DASHBOARD RAIL, WHICH A SIGNED-OUT PROBE CANNOT OPEN ─────────────────────────────────
   *
   * `/dashboard-reader/` answers 307 to a signed-out reader, so the five dashboards and their rail cannot be
   * photographed from here. What CAN be measured is the only thing that was uncertain: whether the design's
   * own `.wordmark img` rule reaches the image the serve puts in `a.sx-dash-brand`. The served markup is
   * injected into a real page carrying the real stylesheets and the cascaded geometry is read.
   */
  console.log(`\n${'═'.repeat(100)}\nTHE DASHBOARD RAIL'S SLOT, IN THE SAME STYLESHEETS\n${'═'.repeat(100)}`);
  await open(`${BASE}/about/`, 1280);
  const dash = await evaluate(`(() => {
    const host = document.createElement('aside');
    host.className = 'sx-dash-side';
    host.style.cssText = 'width:16rem;min-height:120px';
    host.innerHTML = ${JSON.stringify(`<a class="sx-dash-brand wordmark" href="/"><img src="${MARK}" alt="">Ozikoro</a>`)};
    document.body.appendChild(host);
    const img = host.querySelector('img');
    const a = host.querySelector('a');
    return new Promise((done) => {
      const read = () => {
        const cs = getComputedStyle(img);
        const r = img.getBoundingClientRect();
        done({
          loaded: img.naturalWidth, naturalWidth: img.naturalWidth,
          w: +r.width.toFixed(2), h: +r.height.toFixed(2), radius: cs.borderRadius,
          anchorDisplay: getComputedStyle(a).display, anchorColour: getComputedStyle(a).color,
        });
      };
      img.complete ? read() : img.addEventListener('load', read, { once: true });
      setTimeout(read, 4000);
    });
  })()`);
  report.dashboardRail = dash;
  note(JSON.stringify(dash));
  if (!dash || dash.loaded <= 0) problem('the dashboard rail mark did not load');
  if (!dash || !(dash.w > 30 && dash.w < 42)) problem(`the dashboard rail mark is not the design's ~34 px wide: ${dash && dash.w}`);
  if (!dash || dash.w !== dash.h) problem('the dashboard rail mark is not square');
  if (!dash || !/50%/.test(dash.radius)) problem(`the dashboard rail mark is not round: ${dash && dash.radius}`);
  await evaluate(`(() => { const h = document.querySelector('aside.sx-dash-side'); if (h) h.scrollIntoView({ block: 'center' }); })()`);
  await sleep(700);
  const railCap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (railCap?.result?.data) {
    writeFileSync(`${SHOTS}/dashboard-rail-probe-1280.png`, Buffer.from(railCap.result.data, 'base64'));
    note(`shot ${SHOTS}/dashboard-rail-probe-1280.png`);
  } else problem('captureScreenshot returned nothing for the injected dashboard rail');

  console.log(`\n${'═'.repeat(100)}`);
  console.log(report.problems.length === 0 ? 'NO PROBLEMS' : `${report.problems.length} PROBLEM(S)`);
  for (const p of report.problems) console.log(`  · ${p}`);
  writeFileSync(`${SHOTS}/report.json`, JSON.stringify(report, null, 2));
  console.log(`report: ${SHOTS}/report.json`);
  process.exitCode = report.problems.length === 0 ? 0 : 1;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  proc.kill('SIGTERM');
}
