/*
 * verify-round-323.mjs — what the BROWSER renders on /watch/, and which film each new card opens.
 *
 * WHY THIS EXISTS, AND WHY A 200 IS NOT A WORKING PAGE
 *
 * The card's poster frame is hot-linked from `i.ytimg.com`, and a **blocked** image and a **404** both render
 * as nothing: `curl` sees a 200 for the page either way. So this drives real Chrome over the DevTools protocol
 * and reads `naturalWidth` for every card's image — an image the policy refused, or one that 404s, has
 * `complete === true` and `naturalWidth === 0`, which is the silent failure this whole screen is exposed to.
 *
 * It also **clicks every card this round added**, because the design's card is a button whose player is built
 * by `watch.js` from `data-video-id`: the served markup carries an EMPTY iframe `src`, so reading the HTML can
 * never show whether the click opens the right film. The proof is threefold — the player's title after the
 * click, the frame's `src` after the click, and a `Network.responseReceived` for that exact embed with its
 * status. A card that opened the wrong film, or opened nothing, fails here.
 *
 * USAGE
 *   node scripts/verify-round-323.mjs                 # /watch/, then clicks every card in NEW_IDS
 *   node scripts/verify-round-323.mjs /watch.html     # another spelling of the same screen
 *
 * NO DATABASE, NO BUILD, NO DEPENDENCY OUTSIDE CHROME. It only sends HTTP to a server that is already up.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const path = process.argv[2] ?? '/watch/';

/*
 * THE SIX FILMS THIS ROUND ADDS, which are exactly the films the first-match-only SQL dropped: the second and
 * third embeds of the four articles that carry more than one. Named here so the click-through is asserted
 * against a list rather than against "however many cards the page happened to have".
 */
const NEW_IDS = [
  'E-bbdBIH4Wg', 'lAtHAK-5WZw', '0g2hAF8NdOA', 'c9hMdWsZDJY', 'jVNIwrESgQ4', '_w9v21ndnm4',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/oz-verify-323-${port}`,
    '--window-size=1440,2600', 'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
  let console_ = [];
  let responses = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Network.responseReceived' && m.params?.response) {
      const r = m.params.response;
      responses.push({ url: r.url, status: r.status, type: m.params.type ?? null });
    }
    if (m.method === 'Log.entryAdded' && m.params?.entry) {
      const en = m.params.entry;
      console_.push({ from: 'log', level: en.level, source: en.source, text: en.text, url: en.url ?? null });
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.args) {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (text) console_.push({ from: 'console', level: m.params.type, source: 'console', text, url: null });
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
  await send('Network.enable');

  const url = `${BASE}${path}`;
  let serving = false;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url)).status === 200) { serving = true; break; } } catch { /* restarting */ }
    await sleep(1000);
  }
  if (!serving) { console.log(`SERVER DOWN  ${url}`); process.exitCode = 1; }
  else {
    const navigated = await send('Page.navigate', { url });
    const navError = navigated?.result?.errorText ?? null;
    for (let i = 0; i < 40; i += 1) {
      await sleep(300);
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r?.result?.result?.value === 'complete') break;
    }
    // Walk the document: the poster frames are below the fold on a 27-card grid and a lazy image that has not
    // been asked for reads exactly like a blocked one.
    await send('Runtime.evaluate', {
      expression: `(async () => {
        const step = Math.round(window.innerHeight * 0.8);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 140));
        }
        window.scrollTo(0, 0);
      })()`,
      awaitPromise: true,
    });
    await sleep(2500);

    const collected = await send('Runtime.evaluate', {
      expression: `(() => {
        const cards = [...document.querySelectorAll('.sx-video-card[data-video-id]')].map((c) => {
          const img = c.querySelector('img');
          const r = c.getBoundingClientRect();
          return {
            id: c.getAttribute('data-video-id'),
            dataTitle: c.getAttribute('data-video-title'),
            dataMeta: c.getAttribute('data-video-meta'),
            h3: c.querySelector('h3')?.textContent?.trim() ?? null,
            p: c.querySelector('p')?.textContent?.trim() ?? null,
            metaLine: c.querySelector('.sx-video-meta')?.textContent?.trim() ?? null,
            imgSrc: img?.getAttribute('src') ?? null,
            imgCurrent: img?.currentSrc ?? null,
            naturalWidth: img ? img.naturalWidth : null,
            naturalHeight: img ? img.naturalHeight : null,
            complete: img ? img.complete : null,
            alt: img?.getAttribute('alt') ?? null,
            width: Math.round(r.width), height: Math.round(r.height),
          };
        });
        const grid = document.querySelector('.sx-video-grid');
        const columns = grid ? getComputedStyle(grid).gridTemplateColumns : null;
        return {
          title: document.title,
          cards,
          columns,
          sections: [...document.querySelectorAll('.sx-watch-section h2')].map((h) => h.textContent.trim()),
          playerHidden: document.getElementById('inline-player')?.hidden ?? null,
        };
      })()`,
      returnByValue: true,
    });
    const page = collected?.result?.result?.value;

    // ── the click-through, one new card at a time ────────────────────────────────────────────────────
    /*
     * EACH CLICK GETS A FRESH DOCUMENT, AND THE RECORD OF WHY IS THE FIRST RUN OF THIS PROBE.
     *
     * `watch.js` sets ONE iframe's `src` and reuses it. On the first click the frame is created, so the
     * embed's navigation is initiated by the page and `Network.responseReceived` carries its status. On every
     * later click the SAME frame navigates again, and Chrome reports that navigation on the frame's own
     * target rather than the page's — measured: five of the six clicks produced a correct frame `src` and a
     * correct player title with **no response event on the page target**, which reads as "the embed never
     * loaded" when it means "the instrument was listening to the wrong target". Reloading first puts each
     * click back in the case where the evidence is collectable.
     */
    const clicks = [];
    for (const wanted of NEW_IDS) {
      await send('Page.navigate', { url });
      for (let i = 0; i < 40; i += 1) {
        await sleep(250);
        const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        if (r?.result?.result?.value === 'complete') break;
      }
      await sleep(1200);
      const before = responses.length;
      const clicked = await send('Runtime.evaluate', {
        expression: `(() => {
          const c = document.querySelector('.sx-video-card[data-video-id="${wanted}"]');
          if (!c) return { found: false };
          c.scrollIntoView({ block: 'center' });
          c.click();
          return { found: true, cardTitle: c.querySelector('h3')?.textContent?.trim() ?? null };
        })()`,
        returnByValue: true,
      });
      await sleep(4500);
      const state = await send('Runtime.evaluate', {
        expression: `(() => {
          const f = document.getElementById('inline-player-frame');
          const stage = document.getElementById('inline-player');
          let frameId = null;
          try { frameId = new URL(f.src).pathname.split('/').pop() || null; } catch {}
          return {
            hidden: stage.hidden,
            frameSrc: f.getAttribute('src'),
            frameId,
            frameTitle: f.getAttribute('title'),
            playerTitle: document.getElementById('inline-player-title')?.textContent?.trim() ?? null,
            playerMeta: document.getElementById('inline-player-meta')?.textContent?.trim() ?? null,
            external: document.getElementById('inline-player-external')?.getAttribute('href') ?? null,
            pressed: document.querySelector('.sx-video-card[aria-pressed="true"]')?.getAttribute('data-video-id') ?? null,
          };
        })()`,
        returnByValue: true,
      });
      const embedResponses = responses
        .slice(before)
        .filter((r) => /youtube(-nocookie)?\.com\/embed\//.test(r.url))
        .map((r) => ({ url: r.url.slice(0, 90), status: r.status, type: r.type }));
      clicks.push({ wanted, ...(clicked?.result?.result?.value ?? {}), ...(state?.result?.result?.value ?? {}), embedResponses });
    }

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const shotPath = `/tmp/wr323/watch-${path.replace(/[^a-z0-9]/gi, '_')}.png`;
    if (shot?.result?.data) writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));

    const out = { url, navError, page, clicks, console: console_, screenshot: shotPath };
    writeFileSync('/tmp/wr323/verify-323.json', JSON.stringify(out, null, 1));

    // ── the report, printed where a person reads it ──────────────────────────────────────────────────
    console.log(`URL          ${url}`);
    console.log(`nav error    ${navError ?? '(none)'}`);
    console.log(`title        ${page?.title}`);
    console.log(`grid columns ${page?.columns}`);
    console.log(`sections     ${JSON.stringify(page?.sections)}`);
    console.log(`cards        ${page?.cards.length}`);
    console.log('');
    console.log('  #  id            naturalW×H  complete  h3 / provenance');
    for (const [i, c] of (page?.cards ?? []).entries()) {
      const mark = c.naturalWidth > 0 ? ' ' : '!';
      console.log(
        `${mark}${String(i + 1).padStart(2)} ${c.id.padEnd(13)} ${String(c.naturalWidth).padStart(4)}×${String(c.naturalHeight).padEnd(4)} ` +
        `${String(c.complete).padEnd(5)} ${(c.h3 ?? '').slice(0, 54)}`
      );
      console.log(`      ${c.imgSrc}`);
      console.log(`      meta: ${c.metaLine}`);
      console.log(`      prov: ${c.p}`);
    }
    const broken = (page?.cards ?? []).filter((c) => !(c.naturalWidth > 0));
    console.log('');
    console.log(`BROKEN POSTER FRAMES: ${broken.length}${broken.length ? ' -> ' + broken.map((c) => c.id).join(', ') : ''}`);
    console.log('');
    console.log('CLICK-THROUGH (does the film the card promised open?)');
    for (const c of clicks) {
      const ok = c.found && c.frameId === c.wanted && c.pressed === c.wanted && c.hidden === false;
      const net = c.embedResponses.map((r) => r.status).join(',') || 'no embed request seen';
      console.log(`  ${ok ? 'OK ' : 'BAD'}  card ${c.wanted}  ->  frame ${c.frameId ?? '(none)'}  pressed ${c.pressed ?? '(none)'}  embed ${net}`);
      console.log(`        player title: ${c.playerTitle ?? '(none)'}`);
      console.log(`        player meta:  ${c.playerMeta ?? '(none)'}`);
    }
    const badClicks = clicks.filter((c) => !(c.found && c.frameId === c.wanted && c.hidden === false));
    console.log('');
    console.log(`CLICKS THAT DID NOT OPEN THEIR OWN FILM: ${badClicks.length}`);
    console.log(`screenshot   ${shotPath}`);
    const violations = console_.filter((c) => /Content Security Policy|Refused to/i.test(c.text));
    console.log(`CSP violations: ${violations.length}`);
    for (const v of violations.slice(0, 10)) console.log(`   ${v.text.slice(0, 200)}`);
    if (navError || broken.length || badClicks.length) process.exitCode = 1;
  }
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  try { proc.kill('SIGTERM'); } catch { /* already gone */ }
}
