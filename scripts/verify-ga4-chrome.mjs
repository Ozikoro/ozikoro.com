/*
 * ga4-verify.mjs — DOES THE SERVED TAG EXECUTE, AND DOES A GA4 HIT LEAVE THE BROWSER?
 *
 * A CSP refusal and a permitted script produce the SAME 200 and the same HTML, so `curl` cannot answer this.
 * This drives real Chrome over the DevTools Protocol and reports, per page:
 *
 *   1. the tag in the SERVED markup (fetched from the server, not read from the DOM)
 *   2. whether gtag.js was REFUSED (the browser's own words, with the directive named)
 *   3. whether the tag EXECUTED — `window.gtag`, `window.dataLayer` and the queued config
 *   4. every request the browser made to a Google host, and whether a GA4 hit was sent
 *
 * A request to `google-analytics.com` or `*.analytics.google.com` carrying the measurement id IS the hit;
 * if none is sent, the script says which of the two reasons it was.
 */
import { spawn } from 'node:child_process';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MEASUREMENT_ID = 'G-RKRGY9QCSH';
const PAGES = process.argv.slice(2).filter((a) => a.startsWith('/'));
const DEFAULT_PAGES = ['/', '/archive/', '/documents/', '/researchers/', '/clan-towns/', '/about/', '/404/'];
const SLUG = process.env.SLUG ?? '/ichi-mark-the-igbo-scarification/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9200 + Math.floor(Math.random() * 300);
const proc = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/ga4-verify/${debugPort}`,
    '--window-size=1440,2400', 'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let exitCode = 0;
const pages = PAGES.length > 0 ? PAGES : [...DEFAULT_PAGES, SLUG];

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
  let consoleLines = [];
  let requests = [];
  let failures = [];

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleLines.push({ level: m.params.type, text: (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ') });
    }
    if (m.method === 'Log.entryAdded') {
      const en = m.params?.entry ?? {};
      consoleLines.push({ level: en.level, text: en.text ?? '', url: en.url ?? '' });
    }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
    if (m.method === 'Network.loadingFailed') {
      failures.push({ error: m.params?.errorText ?? '', blocked: m.params?.blockedReason ?? '' });
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Network.enable');

  console.log(`\nOzikoro — does the owner's GA4 tag (${MEASUREMENT_ID}) run under the SERVED policy?`);
  console.log('='.repeat(92));
  console.log(`  ${BASE} · headless Chrome\n`);

  for (const page of pages) {
    // 1. THE SERVED MARKUP, read from the server rather than from the DOM.
    const res = await fetch(`${BASE}${page}`);
    const body = await res.text();
    const inHead = body.includes(`googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
    const configCalls = body.split(`gtag('config', '${MEASUREMENT_ID}'`).length - 1;
    const csp = res.headers.get('content-security-policy') ?? '(none)';

    consoleLines = [];
    requests = [];
    failures = [];
    await send('Page.navigate', { url: `${BASE}${page}` });
    await sleep(7000);

    // 3. DID IT EXECUTE — asked of the live document, after the network has settled.
    const probe = await send('Runtime.evaluate', {
      expression: `JSON.stringify({
        gtag: typeof window.gtag,
        dataLayer: Array.isArray(window.dataLayer) ? window.dataLayer.length : null,
        configured: Array.isArray(window.dataLayer) && window.dataLayer.some(function(a){
          return a && a[0] === 'config' && a[1] === ${JSON.stringify(MEASUREMENT_ID)};
        }),
        jsCall: Array.isArray(window.dataLayer) && window.dataLayer.some(function(a){ return a && a[0] === 'js'; }),
        gaCookie: document.cookie.split('; ').filter(function(c){ return c.indexOf('_ga') === 0; }).join(','),
        loaderTag: !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]')
      })`,
      returnByValue: true,
    });
    let state = {};
    try { state = JSON.parse(probe.result?.value ?? '{}'); } catch { /* leave empty */ }

    const refusals = consoleLines.filter((l) => /content security policy|refused to/i.test(l.text));
    const gaRequests = [...new Set(requests.filter((u) => /google-analytics\.com|analytics\.google\.com|googletagmanager\.com/.test(u)))];
    const hit = gaRequests.find((u) => /google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect/.test(u));
    const loaderRequested = gaRequests.some((u) => /googletagmanager\.com\/gtag\/js/.test(u));

    console.log(`  ── ${page} ${'─'.repeat(Math.max(2, 74 - page.length))}`);
    console.log(`     status                ${res.status}`);
    console.log(`     tag IN SERVED MARKUP  ${inHead ? 'yes' : 'NO'}  (config calls: ${configCalls})`);
    console.log(`     gtag.js REQUESTED     ${loaderRequested ? 'yes' : 'NO'}   window.gtag=${state.gtag}  loaderTag=${state.loaderTag}`);
    console.log(`     EXECUTED (dataLayer)  ${state.dataLayer ?? 'null'} entries · js=${state.jsCall} · config=${state.configured}`);
    console.log(`     _ga COOKIE            ${state.gaCookie ? state.gaCookie.replace(/_ga[^=]*=[^,]{0,14}[^,]*/g, (m) => m.slice(0, 20) + '…') : '(none)'}`);
    console.log(`     GA HOST REQUESTS      ${gaRequests.length}`);
    for (const u of gaRequests) console.log(`        ${u.slice(0, 150)}`);
    console.log(`     GA4 HIT SENT          ${hit ? 'YES' : 'no'}`);
    if (refusals.length > 0) {
      console.log(`     CSP REFUSALS (${refusals.length}):`);
      for (const r of refusals) console.log(`        ${r.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    } else {
      console.log('     CSP REFUSALS          none');
    }
    if (failures.length > 0) {
      console.log(`     LOADING FAILURES      ${failures.map((f) => f.blocked || f.error).join(', ')}`);
    }
    const otherErrors = consoleLines.filter((l) => l.level === 'error' && !refusals.includes(l) && !/favicon|404|403/i.test(l.text));
    if (otherErrors.length > 0) {
      console.log('     OTHER CONSOLE ERRORS:');
      for (const r of otherErrors.slice(0, 6)) console.log(`        [${r.level}] ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    console.log(`     SERVED CSP            ${csp.slice(0, 110)}…`);
    console.log('');
  }
} catch (error) {
  console.error('PROBE FAILED:', error);
  exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  proc.kill('SIGTERM');
}
process.exit(exitCode);
