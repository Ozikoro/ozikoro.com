/*
 * dsh-shot-authed.mjs — a screenshot of a page that needs a session cookie.
 *
 *   node scripts/dsh-shot-authed.mjs <url> <out.png> <nickname>=<value> [width] [height] [settleSeconds]
 *
 * ── WHY THIS EXISTS AND WHY IT IS NOT A FLAG ON `dsh-shot.mjs` ────────────────────────────────────────
 *
 * `/admin/design/` is behind `manage_design`, so a browser that has no session is redirected to sign-in and
 * a screenshot of it shows a login form — which would be a screenshot of the wrong page that looked like a
 * fault in the editor. Chrome's `--screenshot` flag has no way to send a cookie, and the cookies are
 * `HttpOnly` and server-side so there is nothing to inject from the page's own JavaScript.
 *
 * So this drives Chrome over its own DevTools Protocol: start it headless with a debugging port, navigate
 * once so the origin exists, set the cookie, then navigate to the real address — and it is the PAGE'S OWN
 * TITLE that is checked before the file is written, so a redirect to sign-in fails loudly instead of
 * producing a plausible-looking picture of the wrong thing.
 *
 * ── AND WHY THE COOKIE IS NOT PRINTED ─────────────────────────────────────────────────────────────────
 *
 * The session value is passed on the command line and used, and never echoed. **A session token in a
 * transcript is a session anybody reading that transcript can use**, which is the same rule the repository
 * states for a host's `.env`: read the name, not the value.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out, cookieSpec, widthArg, heightArg, settleArg] = process.argv.slice(2);
if (!url || !out || !cookieSpec) {
  console.error('usage: node scripts/dsh-shot-authed.mjs <url> <out.png> <name>=<value> [width] [height] [settle]');
  process.exit(2);
}
const [cookieName, ...cookieRest] = cookieSpec.split('=');
const cookieValue = cookieRest.join('=');
const width = Number(widthArg ?? '1280');
const height = Number(heightArg ?? '2000');
const settle = Number(settleArg ?? '6');

const profile = mkdtempSync(join(tmpdir(), 'dsh-shot-authed-'));
const port = 9200 + (process.pid % 700);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
chrome.on('error', (error) => {
  console.error('chrome could not start:', String(error).slice(0, 200));
  process.exit(1);
});

/** Wait until the debugging endpoint answers, or give up. */
async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('Chrome never opened its debugging port');
}

let nextId = 1;
function session(ws) {
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  return (method, params = {}) =>
    new Promise((resolveCall) => {
      const id = nextId++;
      pending.set(id, resolveCall);
      ws.send(JSON.stringify({ id, method, params }));
    });
}

try {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((open, fail) => {
    ws.addEventListener('open', open);
    ws.addEventListener('error', fail);
  });
  const send = session(ws);

  await send('Page.enable');
  await send('Network.enable');

  // 1. The origin has to exist before a cookie can be set on it.
  await send('Page.navigate', { url });
  await sleep(1500);
  const parsed = new URL(url);

  // 2. The session cookie, exactly as the server set it.
  const set = await send('Network.setCookie', {
    name: cookieName,
    value: cookieValue,
    domain: parsed.hostname,
    path: '/',
    httpOnly: true,
    secure: false,
  });
  if (set.result?.success === false) {
    throw new Error(`the cookie was refused: ${JSON.stringify(set.result)}`);
  }

  // 3. Now the page, with the cookie in place.
  await send('Page.navigate', { url });
  await sleep(settle * 1000);

  const title = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  const heading = await send('Runtime.evaluate', {
    expression: 'document.querySelector("h1") ? document.querySelector("h1").textContent : ""',
    returnByValue: true,
  });
  const pageTitle = String(title.result?.result?.value ?? '');
  const pageHeading = String(heading.result?.result?.value ?? '');
  if (!/appearance/i.test(pageTitle) && !/appearance/i.test(pageHeading)) {
    throw new Error(
      `the page that loaded is not the design editor — title “${pageTitle}”, h1 “${pageHeading}”. ` +
        'It is almost certainly the sign-in redirect, so no screenshot was written.'
    );
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const data = shot.result?.data;
  if (!data) throw new Error('Chrome returned no screenshot data');
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, Buffer.from(data, 'base64'));
  const size = statSync(out).size;
  console.log(`wrote ${out} (${size} bytes)  title="${pageTitle}" h1="${pageHeading}" ${width}x${height}`);
  ws.close();
} catch (error) {
  console.error('NO SCREENSHOT:', String(error).slice(0, 400));
  process.exitCode = 1;
} finally {
  chrome.kill();
}
