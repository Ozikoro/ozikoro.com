/*
 * verify-round-330.mjs — what a BROWSER does with `/watch/`, its poster frames and its pager.
 *
 * WHY THIS EXISTS, AND WHY A 200 IS NOT A WORKING PAGE
 *
 * Three faults this session returned 200 and were unusable, and all three are invisible to `curl`:
 * a `Secure` cookie a browser discards, `img-src 'self'` blocking every cross-origin poster, and a nav link
 * that answered 200 and landed on a different page's content. The poster frames on this screen are hot-linked
 * from `i.ytimg.com`, and **a blocked image and a 404 both render as nothing** — the page looks the same.
 * So this drives real Chrome over the DevTools protocol and reads `naturalWidth` per card.
 *
 * THE TWO THINGS THIS ROUND MUST PROVE IN A BROWSER
 *
 *   1. **Next changes the grid, and the URL carries the page.** The control is a plain `<a href="?page=2">`;
 *      a click is followed to the new document and the page's own cards are read from it, so "it moved" is
 *      measured rather than assumed — the fault this morning was a control that moved and showed the wrong
 *      thing.
 *   2. **It works with SCRIPT DISABLED.** `watch.js` builds the inline player and is not part of paging;
 *      `Emulation.setScriptExecutionDisabled` proves that by clicking Next with every script off.
 *
 * USAGE
 *   node scripts/verify-round-330.mjs
 *
 * NO DATABASE, NO BUILD, NO DEPENDENCY OUTSIDE CHROME. It only sends HTTP to a server that is already up.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

mkdirSync('/tmp/wr330', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/oz-verify-330-${debugPort}`,
  '--window-size=1440,2600', 'about:blank',
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
  const logs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Log.entryAdded' && m.params?.entry) {
      const en = m.params.entry;
      logs.push({ level: en.level, source: en.source, text: en.text });
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.args) {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (text) logs.push({ level: m.params.type, source: 'console', text });
    }
  });
  const send = (method, params) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  /** Navigate and wait for the document, because a click on a link is a navigation and not a repaint. */
  async function open(url) {
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i += 1) {
      await sleep(250);
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r?.result?.result?.value === 'complete') break;
    }
    // Scroll the whole document: a lazy image that has not been asked for reads exactly like a blocked one.
    await send('Runtime.evaluate', {
      expression: `(async () => {
        const step = Math.round(window.innerHeight * 0.8);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      })()`,
      awaitPromise: true,
    });
    await sleep(2200);
  }

  /** Everything the page says about itself, read from the rendered DOM. */
  async function read() {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const cards = [...document.querySelectorAll('.sx-video-card[data-video-id]')].map((c) => {
          const img = c.querySelector('img');
          return {
            id: c.getAttribute('data-video-id'),
            h3: c.querySelector('h3')?.textContent?.trim() ?? null,
            naturalWidth: img ? img.naturalWidth : null,
            naturalHeight: img ? img.naturalHeight : null,
            complete: img ? img.complete : null,
          };
        });
        const grid = document.querySelector('.sx-video-grid');
        const nav = document.querySelector('nav[aria-label="Pagination"]');
        const series = document.getElementById('series');
        return {
          href: location.href,
          title: document.title,
          cards,
          columns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
          pager: nav ? nav.textContent.replace(/\\s+/g, ' ').trim() : null,
          next: document.querySelector('nav[aria-label="Pagination"] a[rel="next"]')?.getAttribute('href') ?? null,
          prev: document.querySelector('nav[aria-label="Pagination"] a[rel="prev"]')?.getAttribute('href') ?? null,
          seriesCards: series ? series.querySelectorAll('.sx-video-card[data-video-id]').length : null,
          seriesText: series ? series.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : null,
        };
      })()`,
      returnByValue: true,
    });
    return r?.result?.result?.value;
  }

  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    if (s?.result?.data) writeFileSync(`/tmp/wr330/${name}.png`, Buffer.from(s.result.data, 'base64'));
  };

  const problems = [];
  const report = {};

  // ── 1. page 1, read as a browser renders it ────────────────────────────────────────────────────────
  await open(`${BASE}/watch/`);
  const page1 = await read();
  report.page1 = page1;
  await shot('page-1');
  const broken1 = page1.cards.filter((c) => !(c.naturalWidth > 0));
  console.log(`page 1       ${page1.href}`);
  console.log(`cards        ${page1.cards.length}`);
  console.log(`columns      ${page1.columns}`);
  console.log(`pager        ${page1.pager}`);
  console.log(`next href    ${page1.next}`);
  console.log(`broken       ${broken1.length}${broken1.length ? ' -> ' + broken1.map((c) => c.id).join(', ') : ''}`);
  if (page1.cards.length !== 15) problems.push(`page 1 drew ${page1.cards.length} cards, not 15`);
  if (broken1.length) problems.push(`${broken1.length} poster frame(s) did not load on page 1`);
  if ((page1.columns ?? '').split(' ').length !== 3) problems.push(`grid is not 3 columns: ${page1.columns}`);
  if (page1.next !== '?page=2') problems.push(`Next href is ${page1.next}, not ?page=2`);

  // ── 2. click Next, as a reader does, and read the document it lands on ─────────────────────────────
  const clicked = await send('Runtime.evaluate', {
    expression: `(() => {
      const a = document.querySelector('nav[aria-label="Pagination"] a[rel="next"]');
      if (!a) return { found: false };
      const href = a.href;
      a.click();
      return { found: true, href };
    })()`,
    returnByValue: true,
  });
  await sleep(3000);
  const page2 = await read();
  report.page2 = page2;
  await shot('page-2');
  const broken2 = page2.cards.filter((c) => !(c.naturalWidth > 0));
  console.log('');
  console.log(`clicked Next -> ${clicked?.result?.result?.value?.href}`);
  console.log(`page 2       ${page2.href}`);
  console.log(`cards        ${page2.cards.length}`);
  console.log(`columns      ${page2.columns}`);
  console.log(`pager        ${page2.pager}`);
  console.log(`prev href    ${page2.prev}`);
  console.log(`broken       ${broken2.length}${broken2.length ? ' -> ' + broken2.map((c) => c.id).join(', ') : ''}`);
  if (!page2.href.includes('page=2')) problems.push(`the URL after Next does not carry the page: ${page2.href}`);
  if (page2.cards.length !== 9) problems.push(`page 2 drew ${page2.cards.length} cards, not 9`);
  if (broken2.length) problems.push(`${broken2.length} poster frame(s) did not load on page 2`);
  if ((page2.columns ?? '').split(' ').length !== 3) problems.push(`page 2 grid is not 3 columns: ${page2.columns}`);
  const shared = page1.cards.map((c) => c.id).filter((x) => page2.cards.map((c) => c.id).includes(x));
  if (shared.length) problems.push(`a film stands on both pages: ${shared.join(', ')}`);

  // ── 3. and with every script switched off ─────────────────────────────────────────────────────────
  await send('Emulation.setScriptExecutionDisabled', { value: true });
  await open(`${BASE}/watch/`);
  const noJsBefore = await read();
  await send('Runtime.evaluate', {
    expression: `document.querySelector('nav[aria-label="Pagination"] a[rel="next"]').click()`,
    returnByValue: true,
  });
  await sleep(3500);
  const noJsAfter = await read();
  report.noJs = { before: noJsBefore, after: noJsAfter };
  console.log('');
  console.log(`NO SCRIPT: before ${noJsBefore.cards.length} cards at ${noJsBefore.href}`);
  console.log(`NO SCRIPT: after  ${noJsAfter.cards.length} cards at ${noJsAfter.href}`);
  if (noJsBefore.cards.length !== 15) problems.push(`with scripts off, page 1 drew ${noJsBefore.cards.length}`);
  if (!noJsAfter.href.includes('page=2')) problems.push(`with scripts off, Next did not reach ?page=2 (${noJsAfter.href})`);
  if (noJsAfter.cards.length !== 9) problems.push(`with scripts off, page 2 drew ${noJsAfter.cards.length}`);
  await shot('no-script-page-2');
  await send('Emulation.setScriptExecutionDisabled', { value: false });

  const violations = logs.filter((c) => /Content Security Policy|Refused to/i.test(c.text));
  console.log('');
  console.log(`CSP violations: ${violations.length}`);
  for (const v of violations.slice(0, 8)) console.log(`   ${v.text.slice(0, 200)}`);
  console.log(`scrollHeight page 1 ${page1.cards.length} cards, page 2 ${page2.cards.length} cards`);
  console.log('');
  console.log(`PROBLEMS: ${problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);

  report.problems = problems;
  report.logs = logs;
  writeFileSync('/tmp/wr330/verify-330.json', JSON.stringify(report, null, 1));
  if (problems.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  try { proc.kill('SIGTERM'); } catch { /* already gone */ }
}
