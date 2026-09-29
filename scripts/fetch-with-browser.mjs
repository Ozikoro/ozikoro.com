/*
 * Fetch a page through real Chrome, so a JavaScript challenge is executed
 * rather than refused.
 *
 *   node chrome-fetch.mjs <url> <out.html> [settleSeconds]
 *
 * The subagent that scraped the name sources could not read Nairaland
 * (Cloudflare JS challenge) or names.org (DataDome), because a plain HTTP client
 * is refused before any script runs. Chrome runs the challenge, so the DOM it
 * ends up with is the page.
 */
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
const out = process.argv[3];
const settle = Number(process.argv[4] ?? '12');
const port = 9700 + Math.floor(Math.random() * 200);
const { spawn } = await import('node:child_process');
const { writeFile, mkdir } = await import('node:fs/promises');
const { dirname } = await import('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/cfetch-${port}`,
    '--window-size=1440,2400',
    url,
  ],
  { stdio: 'ignore' }
);

let target = null;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
}
if (!target) {
  console.error('could not attach to Chrome');
  proc.kill();
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params) =>
  new Promise((res) => {
    const myId = ++id;
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

await send('Page.enable');
// Chrome in automation mode sets navigator.webdriver, which is the first thing
// a bot wall checks. Removing it before any page script runs is the difference
// between reading the page and reading the challenge.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
           Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'] });
           Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });`,
});

// Wait for the title to stop looking like a bot wall, then for the DOM to stop
// growing. A Cloudflare interstitial has a recognisable title and swaps itself
// out once the challenge passes.
const probe = `(() => JSON.stringify({ title: document.title, len: document.documentElement.outerHTML.length }))()`;
let lastLen = 0;
let stable = 0;
for (let i = 0; i < settle * 2; i++) {
  await sleep(500);
  const r = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
  const v = r?.result?.result?.value;
  if (!v) continue;
  const { title, len } = JSON.parse(v);
  const wall = /just a moment|attention required|enable javascript|verifying you are human/i.test(title);
  if (i % 4 === 0) console.error(`  t=${(i + 1) / 2}s title="${title.slice(0, 60)}" len=${len}${wall ? ' [challenge]' : ''}`);
  if (len === lastLen && !wall && len > 0) stable++;
  else stable = 0;
  lastLen = len;
  if (stable >= 4 && i > 6) break;
}

const html = await send('Runtime.evaluate', {
  expression: 'document.documentElement.outerHTML',
  returnByValue: true,
});
const text = html?.result?.result?.value ?? '';
await mkdir(dirname(out), { recursive: true }).catch(() => {});
await writeFile(out, text, 'utf8');
console.error(`wrote ${out} (${text.length} chars)`);
ws.close();
proc.kill();
process.exit(0);
