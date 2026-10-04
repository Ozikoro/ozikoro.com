/*
 * verify-round-359.mjs — the related-viewing row, measured in a real browser.
 *
 * WHY A BROWSER AND NOT `curl`
 *
 * Four of the things this round decided cannot be read out of the served markup:
 *
 *   1. **the thumbnail actually renders.** `img-src` in `next.config.ts` names `https://i.ytimg.com`, so the
 *      policy ALLOWS the poster — and a `curl` of the image returns 200 whether or not the browser is
 *      permitted to draw it. `naturalWidth` is the only honest answer, and it is read from the page's own
 *      loaded image.
 *   2. **the thumbnail's own size.** `8rem` at `aspect-ratio: 16/9` is a claim about pixels, and the design's
 *      `.sx-video-thumb` is what produces it. `getBoundingClientRect()` is the measurement.
 *   3. **320 px.** A left-right row with a fixed thumbnail is exactly the shape that scrolls a phone
 *      sideways, and `documentElement.scrollWidth` against `clientWidth` is how the repository measures it
 *      everywhere else (`scripts/sweep-overflow.mjs`).
 *   4. **a thumbnail that fails.** A 404 shows the design's `--night-2` frame and the words `No thumbnail`,
 *      which are painted BEHIND the image. That is a question about paint order, so the probe replaces one
 *      row's `src` with an id that does not exist, waits for the failure, and photographs the frame.
 *
 * WHAT IT MEASURES
 *
 *   A. THE ROWS AS SERVED. Every `.sx-video-row` on `?v=la4vThM0MUo`: its address, its poster, whether the
 *      poster LOADED, and the text of its title and meta slots.
 *   B. EACH ROW'S DESTINATION, FOLLOWED. The address is fetched and its `<h1>` read, so "the row goes to this
 *      film's page" is a destination rather than a claim.
 *   C. EACH ROW'S THUMBNAIL, FETCHED. Status and content-type, so a 404 is named rather than assumed away.
 *   D. THE GEOMETRY, AT THREE WIDTHS. Thumbnail width and height, the title's font size, the row gap, and the
 *      document's own `scrollWidth` against `clientWidth`.
 *   E. A THUMBNAIL THAT FAILS. One row's `src` is replaced with a removed film's id, and the frame is
 *      photographed.
 *   F. THE OTHER ADDRESSES THE BLOCK APPEARS ON. Bare `/watch-video/` must still say why it names no film,
 *      and `/watch/` must not carry the block at all.
 *
 * USAGE
 *   node scripts/verify-round-359.mjs
 *   BASE=http://127.0.0.1:3110 node scripts/verify-round-359.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? `http://127.0.0.1:${process.env.PORT ?? '3110'}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILM = `${BASE}/watch-video/?v=la4vThM0MUo`;
const SHOTS = '/tmp/rv359';

mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = { base: BASE, steps: [], problems: [] };
const problem = (m) => { report.problems.push(m); console.log(`  PROBLEM  ${m}`); };
const note = (m) => console.log(`  ${m}`);

const debugPort = 9700 + Math.floor(Math.random() * 90);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/oz-verify-359-${debugPort}`,
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
    /* `awaitPromise` because one measurement below waits for an image to fail inside the page. */
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r?.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'evaluate failed');
    return r?.result?.result?.value;
  };

  async function open(url, width, height = 1000) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 640 });
    await send('Page.navigate', { url });
    for (let i = 0; i < 80; i += 1) {
      await sleep(150);
      if (await evaluate('document.readyState') === 'complete') break;
    }
    /* The posters are third-party and lazy; give them a moment to arrive or fail. */
    for (let i = 0; i < 40; i += 1) {
      await sleep(150);
      const done = await evaluate(
        `[...document.querySelectorAll('.sx-video-row .sx-video-thumb img')].every((i) => i.complete)`
      );
      if (done) break;
    }
  }

  /*
   * A PHOTOGRAPH OF THE VIEWPORT WITH THE BLOCK IN IT, AND NO CLIP.
   *
   * `Page.captureScreenshot`'s `clip` is in DOCUMENT coordinates and its `captureBeyondViewport` decides
   * whether anything outside the viewport is rendered at all. Measured twice on this page: a document-
   * coordinate clip with the default `captureBeyondViewport` wrote a 2,188-byte blank PNG, and a
   * viewport-coordinate clip wrote the top of the page. **Neither is worth debugging when the honest
   * question is "what does the block look like"** — so the block is scrolled into the middle of the viewport
   * and the viewport is photographed. The block is the only thing of its kind on the page.
   */
  const viewShot = async (selector, out) => {
    const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false; el.scrollIntoView({ block: 'center' }); return true; })()`);
    if (!found) { problem(`nothing matched ${selector} to photograph`); return; }
    await sleep(900);
    const cap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const data = cap?.result?.data;
    if (data) { writeFileSync(out, Buffer.from(data, 'base64')); note(`shot ${out}`); }
    else problem(`captureScreenshot returned nothing for ${selector}`);
  };
  const clipShot = viewShot;

  /* ── A. THE ROWS AS SERVED ─────────────────────────────────────────────────────────────────────── */

  console.log('\nA. THE ROWS ON /watch-video/?v=la4vThM0MUo, as the browser holds them\n');
  await open(FILM, 1440);
  const rows = await evaluate(`[...document.querySelectorAll('.sx-video-row')].map((a) => {
    const img = a.querySelector('img');
    const thumb = a.querySelector('.sx-video-thumb');
    const title = a.querySelector('.sx-video-row-title');
    const meta = a.querySelector('.sx-video-row-meta');
    const cs = getComputedStyle(a);
    return {
      href: a.getAttribute('href'),
      src: img?.getAttribute('src') ?? null,
      naturalWidth: img?.naturalWidth ?? 0,
      imgAlt: img?.getAttribute('alt') ?? null,
      title: (title?.textContent ?? '').trim(),
      meta: (meta?.textContent ?? '').trim(),
      thumb: thumb ? { w: +thumb.getBoundingClientRect().width.toFixed(1), h: +thumb.getBoundingClientRect().height.toFixed(1) } : null,
      titleFont: title ? getComputedStyle(title).font : null,
      metaColor: meta ? getComputedStyle(meta).color : null,
      metaTransform: meta ? getComputedStyle(meta).textTransform : null,
      gap: cs.gap,
      columns: cs.gridTemplateColumns,
    };
  })`);
  report.rows = rows;
  if (!rows.length) problem('the served page carries no .sx-video-row at all');
  for (const r of rows) {
    note(`row  href=${r.href}  thumb=${r.thumb?.w}x${r.thumb?.h}  gap=${r.gap}  columns=${r.columns}`);
    note(`     poster=${r.src}  loaded=${r.naturalWidth > 0 ? 'yes' : 'NO'}  alt=${JSON.stringify(r.imgAlt)}`);
    note(`     title=${JSON.stringify(r.title)}  font=${r.titleFont}`);
    note(`     meta=${JSON.stringify(r.meta)}  colour=${r.metaColor}  transform=${r.metaTransform}`);
    if (!/^\/watch-video\/\?v=[A-Za-z0-9_-]{11}$/.test(r.href ?? '')) problem(`a row does not open this archive's own film page: ${r.href}`);
    const id = (r.href ?? '').split('v=')[1];
    if (r.src !== `https://i.ytimg.com/vi/${id}/hqdefault.jpg`) problem(`a row's poster is not the design's own convention: ${r.src}`);
    if (r.naturalWidth <= 0) problem(`a row's poster did not render in the browser, CSP or 404: ${r.src}`);
    if (r.imgAlt !== '') problem(`a row's poster is not decorative, so a failure renders alt text: ${JSON.stringify(r.imgAlt)}`);
    if (!r.title || !r.meta) problem('a row is missing its title or its meta line');
    if (r.thumb && Math.abs(r.thumb.w - 128) > 0.6) problem(`the thumbnail is not 8rem (128 px) wide at 1440: ${r.thumb.w}`);
    if (r.thumb && Math.abs(r.thumb.h - 72) > 0.6) problem(`the thumbnail is not 16:9 (72 px) tall at 1440: ${r.thumb.h}`);
  }
  await clipShot('#related-video', `${SHOTS}/related-1440.png`);

  /* ── B AND C. EACH DESTINATION AND EACH POSTER, FETCHED ────────────────────────────────────────── */

  console.log('\nB. EACH ROW’S DESTINATION, FOLLOWED\n');
  /*
   * THE DESTINATION IS READ AS TEXT, SO ITS ENTITIES ARE DECODED. `extractArchiveFilms` decodes the title the
   * record wrote, and the served page re-escapes it — so `Ojeh & Arishi` arrives as `Ojeh &amp; Arishi` and a
   * comparison against the raw markup would report a fault that is not there. `&#038;` is the form the
   * WordPress import writes, and it is the same character.
   */
  const plain = (s) => (s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#0*38;/g, '&').replace(/&amp;/g, '&')
    .replace(/&#0*39;/g, '\u2019').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  for (const r of rows) {
    const res = await fetch(`${BASE}${r.href}`);
    const body = await res.text();
    const h1 = plain(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body)?.[1]);
    note(`${r.href}  status=${res.status}  h1=${JSON.stringify(h1)}`);
    if (res.status !== 200) problem(`${r.href} answers ${res.status}`);
    if (h1 !== plain(r.title)) problem(`${r.href} names ${JSON.stringify(h1)}, but the row says ${JSON.stringify(r.title)}`);
  }

  console.log('\nC. EACH ROW’S POSTER, FETCHED FROM YOUTUBE\n');
  for (const r of rows) {
    const res = await fetch(r.src);
    const type = res.headers.get('content-type');
    const bytes = (await res.arrayBuffer()).byteLength;
    note(`${r.src}  status=${res.status}  type=${type}  bytes=${bytes}`);
    if (res.status !== 200 || !/^image\//.test(type ?? '')) problem(`${r.src} is not an image: ${res.status} ${type}`);
  }

  /* ── D. THE GEOMETRY, AT THREE WIDTHS ──────────────────────────────────────────────────────────── */

  console.log('\nD. THE GEOMETRY AND THE PAGE’S OWN WIDTH, AT THREE VIEWPORTS\n');
  report.widths = {};
  for (const width of [1440, 390, 320]) {
    await open(FILM, width);
    const m = await evaluate(`(() => {
      const de = document.documentElement;
      const rows = [...document.querySelectorAll('.sx-video-row')].map((a) => {
        const t = a.querySelector('.sx-video-thumb').getBoundingClientRect();
        const c = a.querySelector('.sx-video-row-copy').getBoundingClientRect();
        const b = a.getBoundingClientRect();
        return { thumb: +t.width.toFixed(1), thumbH: +t.height.toFixed(1), copy: +c.width.toFixed(1),
                 right: +b.right.toFixed(1), wrap: +a.closest('.wrap').getBoundingClientRect().width.toFixed(1) };
      });
      const title = document.querySelector('.sx-video-row-title');
      const thumb = document.querySelector('.sx-video-row .sx-video-thumb');
      return {
        clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
        rows,
        titleFontSize: title ? getComputedStyle(title).fontSize : null,
        columns: getComputedStyle(document.querySelector('.sx-video-row')).gridTemplateColumns,
        gap: getComputedStyle(document.querySelector('.sx-video-row')).gap,
        afterContent: getComputedStyle(thumb, '::after').content,
        afterColor: getComputedStyle(thumb, '::after').color,
        imgZ: getComputedStyle(thumb.querySelector('img')).zIndex,
        imgPosition: getComputedStyle(thumb.querySelector('img')).position,
      };
    })()`);
    report.widths[width] = m;
    note(`@${width}  client=${m.clientWidth} scroll=${m.scrollWidth}  columns=${m.columns}  gap=${m.gap}  title=${m.titleFontSize}`);
    for (const r of m.rows) note(`        thumb=${r.thumb}x${r.thumbH}  copy=${r.copy}  row.right=${r.right}  wrap=${r.wrap}`);
    note(`        ::after content=${m.afterContent} colour=${m.afterColor}  img position=${m.imgPosition} z=${m.imgZ}`);
    if (m.scrollWidth > m.clientWidth + 1) problem(`/watch-video/ scrolls sideways at ${width}px: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}`);
    for (const r of m.rows) {
      if (r.right > m.clientWidth + 1) problem(`a row's right edge is past the viewport at ${width}px: ${r.right} > ${m.clientWidth}`);
      if (r.thumb < 24) problem(`a row's thumbnail is too small to be a target at ${width}px: ${r.thumb}`);
      if (r.copy < 40) problem(`a row's text column has almost no width at ${width}px: ${r.copy}`);
    }
    if (m.afterContent !== '"No thumbnail"') problem(`the missing-thumbnail label is not in the CSS: ${m.afterContent}`);
    if (width === 320) await clipShot('#related-video', `${SHOTS}/related-320.png`);
  }

  /* ── E. A THUMBNAIL THAT FAILS ─────────────────────────────────────────────────────────────────── */

  /*
   * TWO DIFFERENT FAILURES, BECAUSE THE BRIEF NAMED ONE AND THE MEASUREMENT FOUND TWO.
   *
   * The brief's premise is that "a thumbnail for a removed or private video 404s and the card then shows a
   * broken image or an empty dark box". Measured: **`hqdefault.jpg` for an id that does not exist answers 404
   * with a 120x90 grey JPEG body, and Chrome PAINTS it** — so a removed film is neither a broken-image icon
   * nor a hole, it is YouTube's own neutral placeholder. That is reported here rather than assumed.
   *
   * The failure the row must actually survive is the image that cannot be fetched at all — an offline reader,
   * a blocked host, a network that gives up. That is simulated with the protocol's own request blocker rather
   * than by a URL that happens to 404, and it is the case the `--night-2` frame and the `No thumbnail` label
   * exist for.
   */
  console.log('\nE1. WHAT YOUTUBE ANSWERS FOR AN ID THE ARCHIVE DOES NOT HOLD\n');
  const probe = await fetch('https://i.ytimg.com/vi/ZZZZZZZZZZZ/hqdefault.jpg');
  const probeBytes = (await probe.arrayBuffer()).byteLength;
  note(`ZZZZZZZZZZZ  status=${probe.status}  type=${probe.headers.get('content-type')}  bytes=${probeBytes}`);
  await open(FILM, 1440);
  /*
   * THE ELEMENT REMOVES ITSELF, SO THE MEASUREMENT IS MADE FROM A LISTENER ATTACHED AFTER THE MARKUP'S OWN.
   * An inline `onload` occupies its place in the listener list where the markup was parsed, so it runs first
   * and the element is detached before this one runs — `naturalWidth` is still readable on a detached element,
   * and the DOM count afterwards is what proves the handler fired.
   */
  const placeholder = await evaluate(`(async () => {
    const thumb = document.querySelector('.sx-video-row .sx-video-thumb');
    const img = thumb.querySelector('img');
    const seen = await new Promise((resolve) => {
      img.addEventListener('load', () => resolve({ event: 'load', naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }), { once: true });
      img.addEventListener('error', () => resolve({ event: 'error', naturalWidth: 0 }), { once: true });
      img.src = 'https://i.ytimg.com/vi/ZZZZZZZZZZZ/hqdefault.jpg';
      setTimeout(() => resolve({ event: 'timeout', naturalWidth: img.naturalWidth }), 8000);
    });
    await new Promise((r) => setTimeout(r, 400));
    const box = thumb.getBoundingClientRect();
    return { ...seen, imagesLeft: thumb.querySelectorAll('img').length,
             frame: { w: +box.width.toFixed(1), h: +box.height.toFixed(1) },
             label: getComputedStyle(thumb, '::after').content };
  })()`);
  report.placeholder = placeholder;
  note(`the browser fired ${placeholder.event} and painted ${placeholder.naturalWidth}x${placeholder.naturalHeight} — a PLACEHOLDER, not a poster`);
  note(`after the handler: images left in the frame = ${placeholder.imagesLeft}, frame = ${placeholder.frame.w}x${placeholder.frame.h}, label ${placeholder.label}`);
  if (placeholder.event !== 'load' || placeholder.naturalWidth >= 320) {
    problem('YouTube no longer answers an unknown id with a painted placeholder, so the onload guard in the fill has no measured reason');
  }
  if (placeholder.imagesLeft !== 0) problem('the placeholder was drawn as a poster: the onload guard did not remove the image');
  if (Math.abs(placeholder.frame.h - 72) > 0.6) problem(`the frame changed height when the poster went: ${placeholder.frame.h}`);

  console.log('\nE2. AN IMAGE THAT CANNOT BE FETCHED AT ALL — THE CASE THE FRAME IS DRAWN FOR\n');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*://i.ytimg.com/*'] });
  await open(FILM, 1440);
  const broken = await evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 600));
    const thumb = document.querySelector('.sx-video-row .sx-video-thumb');
    const box = thumb.getBoundingClientRect();
    const cs = getComputedStyle(thumb, '::after');
    return {
      imagesLeft: thumb.querySelectorAll('img').length,
      frame: { w: +box.width.toFixed(1), h: +box.height.toFixed(1) },
      label: cs.content, labelColor: cs.color,
      frameBackground: getComputedStyle(thumb).backgroundColor,
      frameBorder: getComputedStyle(thumb).borderTopColor,
    };
  })()`);
  report.brokenThumbnail = broken;
  note(`images left in the frame = ${broken.imagesLeft}  frame=${broken.frame.w}x${broken.frame.h}`);
  note(`label ${broken.label} in ${broken.labelColor} on ${broken.frameBackground}, hairline ${broken.frameBorder}`);
  if (broken.imagesLeft !== 0) problem('a poster that cannot be fetched is still in the frame, so its broken-image icon is painted');
  if (Math.abs(broken.frame.w - 128) > 0.6 || Math.abs(broken.frame.h - 72) > 0.6) problem(`the frame is ${broken.frame.w}x${broken.frame.h}, not the design's 128x72`);
  if (broken.label !== '"No thumbnail"') problem(`the label is not what the frame shows: ${broken.label}`);
  await clipShot('#related-video', `${SHOTS}/related-failed.png`);
  await send('Network.setBlockedURLs', { urls: [] });

  /* ── F. THE OTHER ADDRESSES ────────────────────────────────────────────────────────────────────── */

  console.log('\nF. THE OTHER ADDRESSES THE BLOCK APPEARS ON\n');
  const bare = await (await fetch(`${BASE}/watch-video/`)).text();
  const bareRows = (bare.match(/class="sx-video-row"/g) ?? []).length;
  note(`/watch-video/  rows=${bareRows}  says "No related film can be named"=${/No related film can be named/.test(bare)}`);
  if (bareRows !== 0) problem('the bare film page carries rows, and it has no topic to draw them from');
  if (!/No related film can be named/.test(bare)) problem('the bare film page stopped saying why it names no film');

  const watch = await (await fetch(`${BASE}/watch/`)).text();
  note(`/watch/  carries id="related-video"=${/id="related-video"/.test(watch)}  carries .sx-video-row=${/class="sx-video-row"/.test(watch)}`);
  if (/id="related-video"/.test(watch) || /class="sx-video-row"/.test(watch)) problem('/watch/ carries the film page\'s related block');

  const sheet = await fetch(`${BASE}/watch-video.css`);
  const sheetText = await sheet.text();
  note(`/watch-video.css  status=${sheet.status}  type=${sheet.headers.get('content-type')}  rows-rule=${/\.sx-video-row\s*\{/.test(sheetText)}`);

  const other = await fetch(`${BASE}/about/`);
  const otherText = await other.text();
  const linkedOnOther = /watch-video\.css/.test(otherText);
  note(`/about/ links /watch-video.css = ${linkedOnOther} (must be false: one screen's sheet)`);
  if (linkedOnOther) problem('the row sheet is linked on a screen that has no rows');
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  proc.kill();
}

console.log(`\nPROBLEMS: ${report.problems.length}`);
for (const p of report.problems) console.log(`  - ${p}`);
writeFileSync(`${SHOTS}/report.json`, JSON.stringify(report, null, 1));
console.log(`report ${SHOTS}/report.json`);
process.exit(report.problems.length === 0 ? 0 : 1);
