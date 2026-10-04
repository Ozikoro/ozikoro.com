/*
 * verify-round-331.mjs — what a BROWSER does with `/listen/`, its featured control and its rows.
 *
 * WHY THIS EXISTS, AND WHY A 200 IS NOT A WORKING PAGE
 *
 * The owner's report was made by LOOKING: *"the 'Featured episode' is not clickable, and is there just like
 * that, and does not function"*, and *"any content without audio records on it must not appear there."* Both
 * faults returned `200` with a page that looked deliberate — the featured card was the design's own invented
 * episode with a `<button>` that had no handler and a `href="article.html"` that answered 404, and twelve of
 * the thirteen images on the page belonged to records with no recording at all.
 *
 * So three things are measured here, and none of them is a status code:
 *
 *   1. WHAT THE PAGE SHOWS. Every row of the library, its title, its `data-playable` and its
 *      `data-narrator-kind`, and the featured card's own words. The count is the claim.
 *   2. THE FEATURED CONTROL, CLICKED. A real trusted click (`Input.dispatchMouseEvent`, not `element.click()`)
 *      on the design's own button, then `audio.currentTime` is read before and after. **A player with a `src`
 *      and a player with nothing look identical until the button is pressed** — this is the measurement that
 *      tells them apart. The URL, `paused`, `readyState`, `duration` and `error.code` are read too, because
 *      "the clock did not advance" has several different causes with the same appearance.
 *   3. THE FILE ITSELF, OVER HTTP. Status, content type and byte size of the address the page points at.
 *
 * USAGE
 *   node scripts/verify-round-331.mjs
 *
 * NO DATABASE, NO BUILD, NO DEPENDENCY OUTSIDE CHROME. It only sends HTTP to a server that is already up.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

mkdirSync('/tmp/wr331', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9800 + Math.floor(Math.random() * 90);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/oz-verify-331-${debugPort}`, '--window-size=1440,2400', 'about:blank',
], { stdio: 'ignore' });

/** What `curl` can say about the media address: status, type, bytes. */
async function head(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const buf = await res.arrayBuffer();
    return {
      url, status: res.status, type: res.headers.get('content-type'), bytes: buf.byteLength,
      range: res.headers.get('accept-ranges'),
    };
  } catch (error) {
    return { url, error: String(error) };
  }
}

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
  await send('Network.enable');

  async function open(url) {
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i += 1) {
      await sleep(250);
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r?.result?.result?.value === 'complete') break;
    }
    await sleep(1500);
  }

  /** Everything the page says about itself, read from the rendered DOM. */
  async function read() {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const rows = [...document.querySelectorAll('.sx-tracklist .sx-track')].map((a) => ({
          title: a.querySelector('strong')?.textContent?.trim() ?? null,
          second: a.querySelector('small')?.textContent?.trim() ?? null,
          length: a.querySelector('.sx-track-len')?.textContent?.trim() ?? null,
          href: a.getAttribute('href'),
          playable: a.getAttribute('data-playable'),
          narratorKind: a.getAttribute('data-narrator-kind'),
          img: (() => { const i = a.querySelector('img'); return i ? { src: i.getAttribute('src'), naturalWidth: i.naturalWidth } : null; })(),
        }));
        const feature = document.querySelector('.sx-listen-feature');
        const button = feature?.querySelector('[data-listen-toggle]') ?? null;
        const external = feature?.querySelector('[data-listen-external]') ?? null;
        const audio = document.querySelector('[data-listen-audio]');
        const dead = [...document.querySelectorAll('a')].filter((a) => /article\\.html$/.test(a.getAttribute('href') ?? ''));
        return {
          href: location.href,
          title: document.title,
          rows,
          rowCount: rows.length,
          playableRows: rows.filter((r) => r.playable === 'yes').length,
          distinctNarratorKinds: [...new Set(rows.map((r) => r.narratorKind).filter(Boolean))],
          feature: feature ? {
            present: true,
            title: feature.querySelector('#feature-title')?.textContent?.trim() ?? null,
            series: feature.querySelector('.sx-listen-series')?.textContent?.trim() ?? null,
            copy: [...feature.querySelectorAll('.sx-listen-feature-copy > p')].map((p) => p.textContent.trim()),
            buttonText: button?.textContent?.trim() ?? null,
            externalHref: external?.getAttribute('href') ?? null,
            actionsHtml: feature.querySelector('.sx-listen-feature-actions')?.innerHTML?.trim().slice(0, 400) ?? null,
          } : { present: false },
          audio: audio ? {
            src: audio.getAttribute('src'), paused: audio.paused, currentTime: audio.currentTime,
            readyState: audio.readyState, duration: audio.duration, error: audio.error ? audio.error.code : null,
          } : null,
          audioElements: document.querySelectorAll('audio').length,
          listenScripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).filter((s) => /audio-listen\\.js$/.test(s ?? '')),
          deadArticleLinks: dead.map((a) => a.getAttribute('href')),
          sourceNote: document.querySelector('.sx-source-note')?.textContent?.trim() ?? null,
        };
      })()`,
      returnByValue: true,
    });
    return r?.result?.result?.value;
  }

  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    if (s?.result?.data) writeFileSync(`/tmp/wr331/${name}.png`, Buffer.from(s.result.data, 'base64'));
  };

  const problems = [];
  const report = {};

  // ── 1. the page, read as a browser renders it ─────────────────────────────────────────────────────
  await open(`${BASE}/listen/`);
  const page = await read();
  report.page = page;
  await shot('listen');
  console.log(`/listen/     ${page.href}`);
  console.log(`rows         ${page.rowCount} (playable ${page.playableRows})`);
  for (const r of page.rows) {
    console.log(`   [${r.playable}] ${r.narratorKind ?? '(none)'} · ${r.length ?? '(no length)'} · ${r.title}`);
    console.log(`        ${r.second}`);
    if (r.img) console.log(`        img ${r.img.src} naturalWidth=${r.img.naturalWidth}`);
  }
  console.log(`feature      ${page.feature.present ? JSON.stringify(page.feature.title) : '(absent)'}`);
  console.log(`   series    ${page.feature.series}`);
  console.log(`   button    ${page.feature.buttonText}`);
  console.log(`   external  ${page.feature.externalHref}`);
  console.log(`   actions   ${page.feature.actionsHtml}`);
  console.log(`audio el     ${page.audioElements}; src=${page.audio?.src}`);
  console.log(`script       ${page.listenScripts.join(', ') || '(none)'}`);
  console.log(`dead links   ${page.deadArticleLinks.length}`);
  console.log(`source note  ${page.sourceNote}`);
  if (page.rowCount === 0) problems.push('the library drew no rows at all');
  if (page.playableRows !== page.rowCount) problems.push(`${page.rowCount - page.playableRows} row(s) are not playable but are listed`);
  if (page.deadArticleLinks.length) problems.push(`${page.deadArticleLinks.length} link(s) still point at the design's article.html`);
  for (const r of page.rows) {
    if (!r.narratorKind) problems.push(`row "${r.title}" states no narrator_kind`);
    if (!/read by|synthetic/i.test(r.second ?? '')) problems.push(`row "${r.title}" does not say whose voice it is: ${r.second}`);
    if (r.img && !(r.img.naturalWidth > 0)) problems.push(`row "${r.title}" has an image that did not load: ${r.img.src}`);
  }
  if (page.feature.present && page.feature.title === 'The Ikoro: the drum that spoke for a town') {
    problems.push('the featured card is still the design\'s invented episode');
  }

  // ── 2. the featured control, clicked for real ─────────────────────────────────────────────────────
  const audioCheck = { before: page.audio, after: null, played: false };
  if (page.feature.present && page.audio?.src) {
    await send('Runtime.evaluate', {
      // Make sure the element is on screen before a coordinate click can land on it.
      expression: `document.querySelector('.sx-listen-feature').scrollIntoView({block:'center'})`,
      returnByValue: true,
    });
    await sleep(400);
    const box = await send('Runtime.evaluate', {
      expression: `(() => {
        const b = document.querySelector('[data-listen-toggle]').getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
      })()`,
      returnByValue: true,
    });
    const p = box?.result?.result?.value;
    report.clickPoint = p;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(2500);
    const after = await read();
    audioCheck.after = after.audio;
    audioCheck.buttonText = after.feature?.buttonText;
    audioCheck.played = Boolean(after.audio && after.audio.currentTime > 0 && after.audio.paused === false);
    report.audioCheck = audioCheck;
    await shot('listen-playing');
    console.log('');
    console.log(`clicked      ${JSON.stringify(p)}`);
    console.log(`button now   ${audioCheck.buttonText}`);
    console.log(`audio after  ${JSON.stringify(after.audio)}`);
    if (!audioCheck.played) problems.push(`the featured control did not play: ${JSON.stringify(after.audio)}`);
  } else if (page.feature.present) {
    // An external page rather than a file: the control must be an anchor with a destination, not a button.
    if (!page.feature.externalHref) problems.push('the featured card offers neither an audio element nor an external anchor');
    console.log('');
    console.log(`no audio element; the control is an anchor -> ${page.feature.externalHref}`);
  } else {
    console.log('');
    console.log('no featured episode: the block is absent, which is the honest state');
  }

  // ── 3. the file the page points at ────────────────────────────────────────────────────────────────
  const media = page.audio?.src ? await head(`${BASE}${page.audio.src}`) : null;
  report.media = media;
  if (media) {
    console.log('');
    console.log(`media        ${media.status} ${media.type} ${media.bytes} bytes ${media.url}`);
    if (media.status !== 200) problems.push(`the media address answered ${media.status}`);
    if (!String(media.type ?? '').startsWith('audio/')) problems.push(`the media address is not audio: ${media.type}`);
    if (!(media.bytes > 0)) problems.push('the media address served no bytes');
  }
  for (const r of page.rows) {
    if (r.img?.src) {
      const im = await head(`${BASE}${r.img.src}`);
      if (im.status !== 200) problems.push(`row "${r.title}" image answered ${im.status}: ${r.img.src}`);
    }
  }

  const violations = logs.filter((c) => /Content Security Policy|Refused to|Failed to load resource/i.test(c.text));
  console.log('');
  console.log(`CSP/refusals: ${violations.length}`);
  for (const v of violations.slice(0, 10)) console.log(`   ${v.text.slice(0, 200)}`);
  console.log('');
  console.log(`PROBLEMS: ${problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);

  report.problems = problems;
  report.logs = logs;
  writeFileSync('/tmp/wr331/verify-331.json', JSON.stringify(report, null, 1));
  if (problems.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  try { proc.kill('SIGTERM'); } catch { /* already gone */ }
}
