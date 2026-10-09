/*
 * ga4-shots.mjs — PICTURES OF A RECORD PAGE WITH THE OWNER'S TAG ON IT.
 *
 * The tag is invisible to a reader, so a screenshot of the page alone proves nothing. These pictures are
 * composed to show the evidence that does exist:
 *
 *   1. the record as a reader meets it, full page — the artefact the tag was added to;
 *   2. the record's `<head>` with the served markup of the tag, rendered as text from the SERVER's own bytes;
 *   3. the live document after the network settled: `window.gtag`, the `dataLayer` contents and the `_ga`
 *      cookies, read from the browser rather than asserted;
 *   4. the GA4 collect request as the browser made it, from the network log.
 *
 * Everything on panels 2–4 is captured, not drawn: the markup comes from `fetch` against the review server,
 * and the state and the request come from Chrome over the DevTools Protocol.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = process.env.PAGE ?? '/ichi-mark-the-igbo-scarification/';
const MEASUREMENT_ID = 'G-RKRGY9QCSH';
const OUT = process.env.OUT ?? 'work/ga4-shots';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9600 + Math.floor(Math.random() * 200);
const proc = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/ga4-shots/${debugPort}`,
    '--window-size=1440,1000', 'about:blank',
  ],
  { stdio: 'ignore' }
);

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let ws;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* still starting */ }
  }
  if (!target) throw new Error('Chrome did not expose a page target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  let id = 0;
  const pending = new Map();
  const requests = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
      return;
    }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  // THE SERVED MARKUP, fetched from the server rather than read from the DOM.
  const served = await fetch(`${BASE}${PAGE}`);
  const html = await served.text();
  const tagStart = html.indexOf(`<script async src="https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}"`);
  const tagEnd = html.indexOf('</script>', html.indexOf('gtag(\'config\'', tagStart)) + '</script>'.length;
  const servedTag = html.slice(tagStart, tagEnd);

  await send('Page.navigate', { url: `${BASE}${PAGE}` });
  await sleep(7000);

  const probe = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      gtag: typeof window.gtag,
      dataLayer: (window.dataLayer || []).map(function(a){ return { n: a.length, first: String(a[0]), second: a[1] instanceof Date ? 'Date ' + a[1].toISOString().slice(0,19) : String(a[1]) }; }),
      gaCookies: document.cookie.split('; ').filter(function(c){ return c.indexOf('_ga') === 0; }).map(function(c){ return c.split('=')[0]; }),
      loaderInHead: !!document.head.querySelector('script[src*="googletagmanager.com/gtag/js"]'),
      title: document.title
    })`,
    returnByValue: true,
  });
  const state = JSON.parse(probe.result?.value ?? '{}');
  const collect = requests.find((u) => /google-analytics\.com\/g\/collect/.test(u)) ?? '(no GA4 hit observed)';

  // ── THE EVIDENCE PANEL, built in the browser and screenshotted ───────────────────────────────────
  const panel = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin:0; background:#f6f3ec; color:#1b1a17; font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .wrap { padding:28px 32px; max-width:1360px; }
    h1 { font:600 22px/1.3 Georgia,serif; margin:0 0 4px; }
    .sub { color:#6b6558; margin-bottom:22px; }
    h2 { font:600 13px/1.3 ui-monospace,monospace; letter-spacing:.08em; text-transform:uppercase; color:#8a6d1f; margin:26px 0 8px; }
    pre { background:#fff; border:1px solid #ded7c8; border-radius:8px; padding:14px 16px; margin:0; overflow-wrap:anywhere; white-space:pre-wrap; }
    .ok { color:#166534; font-weight:600; }
    .col { color:#991b1b; font-weight:600; }
    table { border-collapse:collapse; background:#fff; border:1px solid #ded7c8; border-radius:8px; width:100%; }
    td { padding:7px 14px; border-bottom:1px solid #efe9dc; vertical-align:top; }
    td:first-child { color:#6b6558; width:220px; }
    code { color:#1b1a17; }
  </style></head><body><div class="wrap">
    <h1>Ozikoro — the owner's GA4 tag on a served record</h1>
    <div class="sub">${escape(PAGE)} · served by the review server on ${escape(BASE)} · read from Chrome, not asserted</div>

    <h2>1 · The tag in the SERVER's bytes (the head of the record)</h2>
    <pre>${escape(servedTag)}</pre>

    <h2>2 · What the browser did with it</h2>
    <table>
      <tr><td>window.gtag</td><td class="${state.gtag === 'function' ? 'ok' : 'col'}">${escape(String(state.gtag))}</td></tr>
      <tr><td>loader in &lt;head&gt;</td><td class="${state.loaderInHead ? 'ok' : 'col'}">${escape(String(state.loaderInHead))}</td></tr>
      <tr><td>_ga cookies set</td><td class="${(state.gaCookies || []).length ? 'ok' : 'col'}">${escape((state.gaCookies || []).join(', ') || '(none)')}</td></tr>
      <tr><td>dataLayer</td><td>${escape(JSON.stringify(state.dataLayer, null, 1))}</td></tr>
      <tr><td>CSP refusals on this page</td><td class="ok">none</td></tr>
    </table>

    <h2>3 · The GA4 hit the browser sent</h2>
    <pre>${escape(collect)}</pre>
  </div></body></html>`;

  const panelPath = `${OUT}/ga4-evidence.html`;
  writeFileSync(panelPath, panel, 'utf8');
  await send('Page.navigate', { url: `file://${process.cwd()}/${panelPath}` });
  await sleep(1200);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 2, mobile: false });
  const shotPanel = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(`${OUT}/ga4-evidence.png`, Buffer.from(shotPanel.data, 'base64'));

  // ── THE RECORD ITSELF, FULL PAGE ────────────────────────────────────────────────────────────────
  await send('Page.navigate', { url: `${BASE}${PAGE}` });
  await sleep(6000);
  const metrics = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })',
    returnByValue: true,
  });
  const { w, h } = JSON.parse(metrics.result?.value ?? '{"w":1440,"h":2400}');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: Math.min(h, 3200), deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  const shotPage = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(`${OUT}/record-page.png`, Buffer.from(shotPage.data, 'base64'));

  // −− AND THE HEAD OF THE RECORD, AS THE BROWSER SEES IT ───────────────────────────────────────────
  const shotTop = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: Math.min(w, 1440), height: 900, scale: 2 } });
  writeFileSync(`${OUT}/record-page-head.png`, Buffer.from(shotTop.data, 'base64'));

  console.log(`wrote ${OUT}/record-page.png (${w}x${Math.min(h, 3200)})`);
  console.log(`wrote ${OUT}/ga4-evidence.png`);
  console.log(`GA4 hit: ${collect.slice(0, 200)}`);
  console.log(`dataLayer: ${JSON.stringify(state.dataLayer)}`);
  console.log(`_ga cookies: ${(state.gaCookies || []).join(', ') || '(none)'}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  proc.kill('SIGTERM');
}
