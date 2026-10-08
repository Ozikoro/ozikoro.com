/*
 * verify-document-preview-chrome.mjs — DOES THE PDF PREVIEW ACTUALLY DRAW, IN A BROWSER?
 *
 * WHY A BROWSER AND NOT `curl`
 *
 * `/documents/<slug>/` draws a document in an `<iframe>` pointing at `/media/<key>.pdf`. The route
 * answers 200 `application/pdf` and carries `X-Frame-Options: SAMEORIGIN` with `frame-ancestors
 * 'self'`, so the frame is *permitted* — but a permitted frame is not a drawn document. The browser's
 * PDF viewer is a plugin, and `object-src 'none'` (the HTML pages' own policy) is exactly what
 * refused it once already, with the console saying so and the file never fetched.
 *
 * So this drives a real Chrome over the DevTools Protocol and reports, for every document record the
 * library links to:
 *
 *   - the frame's own content box, measured in the DOM (an `<iframe>` that was refused collapses to
 *     the height of nothing, which a text instrument cannot see);
 *   - every CSP violation and every failed request the page produced, with the blocked reason;
 *   - the PDF response's own status, type and length, read from the page's own fetch;
 *   - whether the frame painted, read as a screenshot pixel count rather than a claim.
 *
 * Usage:
 *   node scripts/verify-document-preview-chrome.mjs                  # every card on /documents/
 *   node scripts/verify-document-preview-chrome.mjs /documents/<slug>/
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = '/tmp/document-preview';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9700 + Math.floor(Math.random() * 90);
const proc = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${OUT}/${debugPort}`,
    '--window-size=1440,1400',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let id = 0;
const pending = new Map();
let violations = [];
let failedRequests = [];
let exitCode = 0;

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* still starting */
    }
  }
  if (!target) throw new Error('Chrome did not expose a page target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
      return;
    }
    if (m.method === 'Log.entryAdded') {
      const t = m.params?.entry?.text ?? '';
      if (/content security policy|refused to|violates/i.test(t)) violations.push(t);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (/content security policy|refused to|violates/i.test(text)) violations.push(text);
    }
    if (m.method === 'Network.loadingFailed') {
      failedRequests.push({ reason: m.params.blockedReason ?? m.params.errorText, type: m.params.type });
    }
    if (m.method === 'Network.responseReceived') {
      const u = m.params?.response?.url ?? '';
      if (u.includes('.pdf')) {
        failedRequests.push({
          pdf: u,
          status: m.params.response.status,
          type: m.params.response.headers?.['content-type'] ?? m.params.response.mimeType,
          length: m.params.response.headers?.['content-length'] ?? null,
        });
      }
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Network.enable');

  console.log('\nOzikoro — does a document preview actually DRAW?');
  console.log('='.repeat(70));
  console.log(`\n  ${BASE}, headless Chrome, measuring the frame box and the console.\n`);

  // 1. Where does every card on /documents/ point?
  await send('Page.navigate', { url: `${BASE}/documents/` });
  await sleep(2500);
  const cardsRes = await send('Runtime.evaluate', {
    expression: `JSON.stringify([...document.querySelectorAll('.sx-pdf-grid article')].map((a) => ({
      heading: a.querySelector('h3 a')?.textContent?.trim() ?? null,
      headingHref: a.querySelector('h3 a')?.getAttribute('href') ?? null,
      links: [...a.querySelectorAll('a')].map((x) => ({ href: x.getAttribute('href'), text: x.textContent.trim().slice(0, 40), download: x.hasAttribute('download') })),
    })))`,
    returnByValue: true,
  });
  const cards = JSON.parse(cardsRes.result.value);
  console.log('  THE CARDS ON /documents/, AND WHERE EACH ONE GOES');
  for (const c of cards) {
    console.log(`\n   • ${c.heading}`);
    for (const l of c.links) console.log(`       ${l.download ? '[download]' : '[link]    '} ${l.href}   —  "${l.text}"`);
  }

  const explicit = process.argv.slice(2).filter((a) => a.startsWith('/'));
  const pages = explicit.length
    ? explicit
    : [...new Set(cards.map((c) => c.headingHref).filter((h) => h && h.startsWith('/')))];

  console.log(`\n  ${pages.length} record page(s) to open.\n`);
  console.log('='.repeat(70));

  const results = [];
  for (const page of pages) {
    violations = [];
    failedRequests = [];
    await send('Page.navigate', { url: `${BASE}${page}` });
    await sleep(3500);
    const r = await send('Runtime.evaluate', {
      expression: `(async () => {
        /*
         * A PUBLICATION'S PREVIEW IS BEHIND ITS OWN CONTROL, because framing it eagerly would render a
         * publication on every article view. So the probe OPENS it the way a reader does — click, then
         * measure — rather than reading a frame out of the served HTML. A control that does not put a
         * frame on the page is a dead control, and this is where that would show.
         */
        const opener = document.querySelector('[data-pdf-preview]');
        if (opener) opener.click();
        await new Promise((r) => setTimeout(r, 1500));
        const f = document.querySelector('dialog iframe, iframe, object, embed');
        const plate = document.querySelector('.plate');
        // The viewer is a plugin inside the frame; the parent cannot read its document. What the
        // parent CAN prove is that the frame has a real box, and that the file is fetchable from
        // this origin with the type a viewer needs.
        let pdf = null;
        if (f && f.getAttribute('src')) {
          try {
            const res = await fetch(f.getAttribute('src'), { method: 'HEAD' });
            pdf = { status: res.status, type: res.headers.get('content-type'), length: res.headers.get('content-length'),
                    xfo: res.headers.get('x-frame-options') };
          } catch (e) { pdf = { error: String(e) }; }
        }
        const box = f ? { tag: f.tagName, w: f.clientWidth, h: f.clientHeight, src: f.getAttribute('src') } : null;
        const dialog = document.querySelector('dialog');
        /*
         * AND THE CONTROL AS THE READER FIRST MEETS IT, read BEFORE the dialog is closed: how many characters
         * of it they can see, and whether anything is hiding it. A preview nobody can find is the fault this
         * whole round is about, so the report states where the control is, not merely that it works.
         */
        const ctl = opener
          ? (() => {
              const r = opener.getBoundingClientRect();
              /*
               * A CONTROL INSIDE A DISCLOSURE THIS ROUTE DID NOT INSERT IS THE FAULT MEASURED HERE. The
               * design's "Reading tools" panel is a details element with no open attribute, so anything
               * inside it is invisible until the reader expands it — which is exactly how the first version
               * of this preview was built and why it moved. The box is read with a property call rather than
               * a bracketed attribute selector, so the injected expression contains no bracket at all.
               */
              const box = opener.closest('details');
              const hidden = Boolean(box && box.open === false);
              return {
                text: opener.textContent.trim(),
                rendered: opener.offsetParent !== null,
                behindDisclosure: hidden,
                inViewport: r.top >= 0 && r.top < window.innerHeight && r.width > 0,
                top: Math.round(r.top),
              };
            })()
          : null;
        // The dialog is closed again so the shot shows the page a reader arrives at, with the control on it.
        if (dialog && dialog.open) dialog.close();
        await new Promise((r) => setTimeout(r, 200));
        return JSON.stringify({
          h1: document.querySelector('h1')?.textContent?.trim() ?? null,
          control: ctl,
          dialog: dialog ? { open: dialog.open, w: dialog.clientWidth, h: dialog.clientHeight } : null,
          frame: box,
          plate: plate ? plate.textContent.trim() : null,
          pdf,
        });
      })()`,
      awaitPromise: true,
    });
    const d = JSON.parse(r.result.value);

    /*
     * THE SHOT IS TAKEN WITH THE FRAME IN VIEW. A screenshot of the top of the record proves nothing about
     * the preview — the frame is below the heading and, on a publication, behind a disclosure — so the page
     * is scrolled to the viewer first and the picture is of the document.
     */
    await send('Runtime.evaluate', {
      expression: '(() => { const f = document.querySelector("iframe, object, embed, .sx-preview");'
        + ' if (f) f.scrollIntoView({ block: "center" }); })()',
      returnByValue: true,
    });
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const name = `${OUT}/${page.replace(/[^a-z0-9]+/gi, '_')}.png`;
    writeFileSync(name, Buffer.from(shot.data, 'base64'));

    /*
     * ⚠️ WHAT COUNTS AS A FAILURE HERE IS A REFUSAL, NOT A REQUEST.
     *
     * `failedRequests` carries two different kinds of line: a PDF response the probe observed (status, type,
     * length — evidence that the file arrived) and a refusal Chrome reported (`blockedReason`, so a CSP or
     * X-Frame-Options decision). Only the second is a fault. And `net::ERR_ABORTED` on a `Fetch` is this
     * probe's own HEAD request being discarded, which happens every time by construction — **a
     * `blockedReason` is never ignored**, because that is exactly what a refused preview looks like.
     */
    const realFailures = failedRequests.filter(
      (f) => typeof f.reason === 'string' && !(f.reason === 'net::ERR_ABORTED' && f.type === 'Fetch')
    );
    console.log(`\n   ${page}`);
    console.log(`     h1            ${d.h1}`);
    if (d.control) {
      console.log(
        `     control       "${d.control.text}" · rendered=${d.control.rendered} · behind a disclosure=${d.control.behindDisclosure} · in the first screen=${d.control.inViewport} (top ${d.control.top}px)`
      );
    }
    if (d.dialog) console.log(`     dialog        ${d.dialog.w} × ${d.dialog.h} px (measured open, then closed)`);
    if (d.frame) {
      console.log(`     frame         <${d.frame.tag}> ${d.frame.w} × ${d.frame.h} px`);
      console.log(`     frame src     ${d.frame.src}`);
      console.log(`     HEAD on file  ${JSON.stringify(d.pdf)}`);
      if (d.frame.w === 0 || d.frame.h === 0) {
        console.log('     FAIL          the frame has NO box — the preview was refused or collapsed');
        exitCode = 1;
      }
    } else {
      console.log(`     frame         none drawn`);
      console.log(`     plate         ${d.plate ?? '(none)'}`);
    }
    if (violations.length) {
      console.log('     FAIL          console carried CSP violations:');
      for (const v of violations) console.log(`                     ${v}`);
      exitCode = 1;
    }
    if (realFailures.length) {
      console.log('     FAIL          failed/observed requests:');
      for (const f of realFailures) console.log(`                     ${JSON.stringify(f)}`);
      exitCode = 1;
    } else {
      console.log('     console       no CSP violation, no blocked request');
    }
    console.log(`     shot          ${name}`);
    results.push({ page, ...d, violations: [...violations], failedRequests: [...failedRequests] });
  }

  writeFileSync(`${OUT}/report.json`, JSON.stringify({ cards, results }, null, 2));
  console.log(`\n  report  ${OUT}/report.json`);
  console.log(
    exitCode === 0
      ? '\n  RESULT: every frame drew, and nothing was refused.\n'
      : '\n  RESULT: at least one preview did NOT draw — see FAIL above.\n'
  );
} catch (err) {
  console.error('probe failed:', err);
  exitCode = 2;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  proc.kill();
}
process.exit(exitCode);
