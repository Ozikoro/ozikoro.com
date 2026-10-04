/*
 * verify-round-347-chrome.mjs — do the images actually PAINT? Measured in a real browser, in pixels.
 *
 * ── WHY A BROWSER, AGAIN, AND WHY `naturalWidth` IS THE INSTRUMENT ───────────────────────────────
 *
 * The fault this round exists to close was measured in a browser and could not have been measured in
 * `curl`: **an image refused by `img-src 'self'` returns its bytes to a fetcher and paints nothing**, and
 * an image whose file is absent is identical to it in the HTML. Both appeared in a served page's markup as
 * an `<img>` with a `src`. The only difference a reader can see is whether the element ends up with a
 * bitmap, and `naturalWidth` is that fact: **0 means nothing was painted**, whatever the reason.
 *
 * So this probe opens each page in headless Chrome, waits for the images to settle, and reads every
 * image's `naturalWidth` and `complete` out of the DOM — then reports the console, which is where a CSP
 * refusal announces itself verbatim.
 *
 * WHAT IT MEASURES
 *
 *   A. `/towns/` — every `<img>` on the register, painted or not, with the count, and every zero-width one
 *      named by its `src`. 75 tags across 66 distinct sources.
 *   B. `/ichi-mark-the-igbo-scarification/` — the article that carried the two refused addresses. Every
 *      image painted, and no CSP violation in the console.
 *   C. `/nze/` — the page served at its own address renders as its own document: its own `<h1>` text and
 *      its own control, read from the DOM rather than from the HTML.
 *
 * USAGE
 *   node scripts/verify-round-347-chrome.mjs
 */
import { spawn } from 'node:child_process';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CALL_DEADLINE_MS = Number(process.env.CALL_DEADLINE_MS ?? '20000');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9800 + Math.floor(Math.random() * 90);

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/oz-verify-347-${debugPort}`,
  '--window-size=1440,2600', 'about:blank',
], { stdio: 'ignore' });

const problems = [];
const problem = (m) => { problems.push(m); console.log(`  PROBLEM  ${m}`); };
const ok = (m) => console.log(`  ok       ${m}`);

let ws;
try {
  let version = null;
  for (let i = 0; i < 60 && !version; i += 1) {
    await sleep(500);
    try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { /* still starting */ }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('Chrome did not expose a browser endpoint');

  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let id = 0;
  const pending = new Map();
  let logs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Log.entryAdded' && m.params?.entry) {
      const en = m.params.entry;
      logs.push({ level: en.level, text: en.text, url: en.url ?? '' });
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.args) {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (text) logs.push({ level: m.params.type, text, url: '' });
    }
    if (m.method === 'Runtime.exceptionThrown' && m.params?.exceptionDetails) {
      logs.push({ level: 'exception', text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? '', url: '' });
    }
  });
  const send = (method, params, sessionId) => new Promise((resolve) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); resolve({ timedOut: true, method }); }, CALL_DEADLINE_MS);
    pending.set(i, (m) => { clearTimeout(timer); resolve(m); });
    const message = { id: i, method, params };
    if (sessionId) message.sessionId = sessionId;
    ws.send(JSON.stringify(message));
  });

  let sessionId = null;
  let pageTargetId = null;
  const evaluate = async (expression) => {
    if (!sessionId) throw new Error('no page is open');
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (r?.timedOut) throw new Error(`the browser did not answer Runtime.evaluate within ${CALL_DEADLINE_MS}ms`);
    if (r?.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'evaluate failed');
    return r?.result?.result?.value;
  };

  async function open(url) {
    logs = [];
    if (pageTargetId) {
      await send('Target.closeTarget', { targetId: pageTargetId });
      pageTargetId = null;
      sessionId = null;
    }
    const created = await send('Target.createTarget', { url });
    if (!created?.result?.targetId) throw new Error(`the browser refused to open ${url}`);
    pageTargetId = created.result.targetId;
    const attached = await send('Target.attachToTarget', { targetId: pageTargetId, flatten: true });
    sessionId = attached?.result?.sessionId;
    if (!sessionId) throw new Error(`the page target for ${url} refused the session`);
    for (const domain of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) {
      const r = await send(domain, {}, sessionId);
      if (r?.timedOut) throw new Error(`${domain} was never answered for ${url}`);
    }
    /*
     * ── A TARGET CREATED WITH A URL DOES NOT ALWAYS LOAD IT, AND THE FIRST VERSION OF THIS PROBE BLAMED
     *    THE SANDBOX FOR THAT. ────────────────────────────────────────────────────────────────────────
     *
     * Measured twice on Chrome 154 in this checkout: `Target.createTarget({url})` answers with a target id,
     * `Target.attachToTarget` answers with a session, and `location.href` then stays `about:blank` for as
     * long as it is asked — the probe's own 20-second deadline produced *"the page never left about:blank"*,
     * which reads like a refused profile directory and is not one. **`Page.navigate` on that same session
     * is answered and the document arrives.** So the URL is given twice, and the second is the one that
     * counts; whether the reply to `Page.navigate` comes back is not depended on, because the poll below is
     * the actual evidence.
     */
    let navigated = false;
    for (let i = 0; i < 40; i += 1) {
      await sleep(250);
      const href = await evaluate('location.href');
      if (href && href.startsWith('http')) { navigated = true; break; }
      if (i === 4) await send('Page.navigate', { url }, sessionId);
    }
    if (!navigated) throw new Error(`the page at ${url} never left about:blank`);
    for (let i = 0; i < 100; i += 1) {
      await sleep(200);
      if (await evaluate('document.readyState') === 'complete') break;
    }

    /*
     * AND THE LAZY IMAGES ARE THE WHOLE POINT OF MEASURING IN A BROWSER. `/towns/` carries 75 `<img>`, every
     * one `loading="lazy"`, and Chrome requests only the ones near the viewport: **measured without
     * scrolling, 67 of the 75 had `naturalWidth` 0 on a page where every image is reachable** — a false
     * alarm produced by the instrument rather than by the page. So the document is walked to its foot in
     * viewport-sized steps, and then the probe waits until no image changes state for five rounds.
     */
    const height = await evaluate('document.body.scrollHeight');
    for (let y = 0; y < height + 1200; y += 800) {
      await evaluate(`window.scrollTo(0, ${y}); true`);
      await sleep(150);
    }
    let previous = -1;
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      const done = await evaluate(`[...document.images].filter((i) => i.complete).length`);
      if (done === previous) break;
      previous = done;
    }
    await evaluate('window.scrollTo(0, 0)');
    await sleep(500);
  }

  const imageReport = () => evaluate(`(() => {
    const all = [...document.images];
    const zero = all.filter((i) => i.naturalWidth === 0);
    return {
      tags: all.length,
      distinct: new Set(all.map((i) => i.currentSrc || i.src)).size,
      painted: all.filter((i) => i.naturalWidth > 0).length,
      zero: zero.map((i) => ({ src: i.currentSrc || i.src, complete: i.complete, w: i.naturalWidth, h: i.naturalHeight })),
      lazyNever: all.filter((i) => i.loading === 'lazy' && !i.complete).length,
    };
  })()`);

  const cspLogs = () => logs.filter((l) => /Content Security Policy|refused to load|ERR_BLOCKED/i.test(l.text));

  /* ── A. THE REGISTER ───────────────────────────────────────────────────────────────────────────── */
  /*
   * EVERY PAGE OF IT, BECAUSE THE REGISTER IS PAGINATED AND ONE PAGE IS NOT THE REGISTER.
   *
   * Measured while `/towns/` served all 190 rows at once: 75 `<img>` across 66 distinct `src`, 75 painted,
   * 0 with `naturalWidth` 0. A sibling round then renamed the register to `/clan-towns/` and paginated it 18
   * to a page, so the same 75 images are spread over eleven pages — and page 1 alone holds 11. **A probe
   * that read only page 1 would report 11 of 75 painted and call it every image.** So the address is asked
   * for once to learn where it lives, and then each page is opened and measured.
   */
  console.log('\nA. THE REGISTER — EVERY CARD IMAGE, PAINTED OR NOT\n');
  await open(`${BASE}/towns/`);
  const registerPath = await evaluate('location.pathname');
  console.log(`  the register is served at ${registerPath} (asked for /towns/)`);
  const totals = { tags: 0, painted: 0, pages: 0, zeros: [], distinct: new Set() };
  for (let n = 1; n <= 15; n += 1) {
    await open(`${BASE}${registerPath}?page=${n}`);
    const r = await imageReport();
    const cards = await evaluate(`document.querySelectorAll('a strong').length`);
    if (cards === 0 && r.tags === 0) break;
    totals.pages += 1;
    totals.tags += r.tags;
    totals.painted += r.painted;
    for (const z of r.zero) totals.zeros.push({ ...z, page: n });
    const srcs = await evaluate(`[...document.images].map((i) => i.currentSrc || i.src)`);
    for (const s of srcs) totals.distinct.add(s);
    for (const l of cspLogs()) problem(`register page ${n} console: ${l.text.slice(0, 200)}`);
  }
  console.log(`  ${totals.pages} pages read: ${totals.tags} <img> across ${totals.distinct.size} distinct src; ${totals.painted} painted, ${totals.zeros.length} with naturalWidth 0`);
  if (totals.zeros.length) {
    for (const z of totals.zeros) problem(`register page ${z.page} image painted nothing: ${z.src} (complete=${z.complete}, naturalWidth=${z.w})`);
  } else ok(`every one of the ${totals.distinct.size} distinct images on the register has a bitmap (naturalWidth > 0)`);
  if (!cspLogs().length) ok('the register: no Content-Security-Policy refusal in the console');

  /* ── B. THE ARTICLE THAT CARRIED THE TWO REFUSED IMAGES ─────────────────────────────────────── */
  console.log('\nB. /ichi-mark-the-igbo-scarification/ — THE ARTICLE THE TWO ADDRESSES WERE IN\n');
  await open(`${BASE}/ichi-mark-the-igbo-scarification/`);
  const ichi = await imageReport();
  const oldSite = await evaluate(`document.documentElement.innerHTML.match(/https?:\\/\\/ozikoro\\.com\\/wp-content\\/uploads\\//g)?.length ?? 0`);
  console.log(`  ${ichi.tags} <img>; ${ichi.painted} painted, ${ichi.zero.length} with naturalWidth 0`);
  console.log(`  old-site image addresses still in the DOM: ${oldSite}`);
  if (ichi.zero.length) {
    for (const z of ichi.zero) problem(`article image painted nothing: ${z.src} (complete=${z.complete}, naturalWidth=${z.w})`);
  } else ok('every image in the article body has a bitmap');
  if (oldSite !== 0) problem(`${oldSite} old-site image addresses are still in the served DOM`);
  else ok('no `ozikoro.com/wp-content/uploads/` address remains in the served DOM');
  for (const l of cspLogs()) problem(`article console: ${l.text.slice(0, 200)}`);
  if (!cspLogs().length) ok('article: no Content-Security-Policy refusal in the console');

  /* ── C. /nze/ — THE PAGE SERVED AT ITS OWN ADDRESS ──────────────────────────────────────────── */
  console.log('\nC. /nze/ — THE RECORD\'S OWN DOCUMENT, AS THE BROWSER BUILDS IT\n');
  await open(`${BASE}/nze/`);
  const nze = await evaluate(`(() => ({
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.replace(/\\s+/g, ' ').trim()),
    h1Count: document.querySelectorAll('h1').length,
    controls: document.querySelectorAll('[id^="opt"]').length,
    canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
    bodyBackground: getComputedStyle(document.body).backgroundImage.slice(0, 60),
  }))()`);
  console.log(`  document.title: ${JSON.stringify(nze.title)}`);
  console.log(`  h1: ${JSON.stringify(nze.h1)}   (${nze.h1Count} of them)`);
  console.log(`  the page's own option controls in the DOM: ${nze.controls}`);
  console.log(`  canonical: ${nze.canonical}`);
  console.log(`  body background-image: ${JSON.stringify(nze.bodyBackground)}`);
  if (nze.h1Count !== 1) problem(`/nze/ has ${nze.h1Count} <h1> elements; the archive's rule is exactly one per page`);
  else ok('the record\'s own document supplies exactly one <h1>, and no second one was added');
  if (nze.controls < 2) problem(`/nze/: the record's own option controls are not in the DOM (${nze.controls} found)`);
  else ok(`the record's own controls are in the DOM (${nze.controls}) — the page was served, not summarised`);
  if (nze.canonical !== `${BASE}/nze/` && nze.canonical !== 'https://ozikoro.com/nze/') problem(`/nze/ canonical is ${nze.canonical}`);
  else ok('the canonical is the address the record was published at');
  for (const l of cspLogs()) problem(`/nze/ console: ${l.text.slice(0, 200)}`);
} catch (error) {
  problem(`the browser probe failed: ${String(error).slice(0, 300)}`);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  try { proc.kill('SIGTERM'); } catch { /* already gone */ }
}

console.log(`\nPROBLEMS: ${problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
