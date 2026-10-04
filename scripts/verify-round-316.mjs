/*
 * verify-round-316.mjs — what the BROWSER renders, not what curl returns.
 *
 * WHY THIS EXISTS
 *
 * The owner reported that parts of several pages "that is supposed to have images [are] not showing anything".
 * Every one of those images returns `200` to `curl` and to `python -m urllib` — it is served correctly from
 * elsewhere. **What is wrong is the page's `Content-Security-Policy`:** `img-src 'self' data:` forbids an image
 * on another origin, so the browser refuses to load it, the slot stays empty, and the network panel shows a
 * request that never happened. `curl` enforces no policy, so a fetch is not a render.
 *
 * So this drives real Chrome over the DevTools protocol and reads `document.images` — specifically
 * `naturalWidth`, because **an image the CSP blocked has `complete === true` and `naturalWidth === 0`**, which
 * is exactly the silent failure being fixed. It also:
 *
 *   - collects the console's own CSP violation messages, which name the blocked URL and the directive verbatim;
 *   - reads every computed `background-image`, because a CSS background is governed by `img-src` too and fails
 *     exactly as silently as an `<img>`;
 *   - clicks the first video card on a watch screen, so the inline player is exercised rather than assumed
 *     (`watch.js` sets the iframe's `src` from script, so the served markup carries an empty one).
 *
 * USAGE
 *   node scripts/verify-round-316.mjs before          # writes /tmp/oz316-before.json
 *   node scripts/verify-round-316.mjs after           # writes /tmp/oz316-after.json
 *   node scripts/verify-round-316.mjs before /listen/ /watch/
 *
 * NO DATABASE, NO BUILD, NO DEPENDENCY OUTSIDE CHROME. It only sends HTTP to a server that is already up.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const label = process.argv[2] ?? 'run';

/*
 * EVERY DESIGN SCREEN THAT CARRIES A CROSS-ORIGIN IMAGE, IN BOTH SPELLINGS.
 *
 * The owner reported `/about.html`, with the extension, and the middleware serves that, `/about/` and `/about`
 * from the same design file. So a screen is not covered by testing one spelling of it.
 *
 * `towns` IS THE ONE SCREEN WITH NO READER-FACING ADDRESS, AND IT IS TESTED WHERE IT ACTUALLY SERVES.
 *
 * The middleware deliberately does NOT rewrite `/towns`: the application's own `app/towns/page.tsx` is a
 * real route, and `/towns/` was measured at 0 cross-origin images. The design file still carries six, and its
 * only carrier is the raw static file — `/design-screen/towns` is swallowed by the attachment fallback
 * (measured: 404). So the static address is what is tested, and the finding is recorded rather than hidden.
 */
const DEFAULT_PATHS = [
  '/', '/home/', '/home.html',
  '/about/', '/about.html',
  '/listen/', '/listen.html',
  '/watch/', '/watch.html',
  '/watch-video/', '/watch-video.html',
  '/folklore/', '/folklore.html',
  '/folklore-reader/', '/folklore-reader.html',
  '/collections/', '/collections.html',
  '/photographs/', '/photographs.html',
  '/material-culture/', '/material-culture.html',
  '/projects/', '/projects.html',
  '/project/', '/project.html',
  '/town/', '/town.html',
  '/cultural-event/', '/cultural-event.html',
  '/design/screens/towns.html',
  '/towns/',
  // A record page: the article route, a DIFFERENT route serving the same deliverable.
  '/ute-okpu-an-ika-igbo-clan-and-its-nri-roots/',
];

const paths = process.argv.length > 3 ? process.argv.slice(3) : DEFAULT_PATHS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9800 + Math.floor(Math.random() * 150);
const proc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/oz-verify-316-${port}`,
    '--window-size=1280,2400',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
const results = [];
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* Chrome is still starting. */
    }
  }
  if (!target) throw new Error('Chrome did not expose a page target on the debugging port');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let id = 0;
  const pending = new Map();
  /** Console entries seen since the last navigation. Reset per page so a violation is attributed to its page. */
  let console_ = [];
  /**
   * NETWORK RESPONSES, because `naturalWidth > 0` proves an image rendered but not that a FRAME loaded.
   *
   * A CSP-blocked frame never reaches the network at all, so a response for the embed URL is the proof that
   * the policy now permits the player — and its status is the proof the player actually answered. This is the
   * one part of the brief that an image check cannot settle.
   */
  let responses = [];

  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Network.responseReceived' && m.params?.response) {
      const r = m.params.response;
      responses.push({ url: r.url, status: r.status, mimeType: r.mimeType, type: m.params.type ?? null });
    }
    /*
     * THE VIOLATION ARRIVES ON TWO CHANNELS, and which one carries it depends on the directive.
     *
     * `Log.entryAdded` is where Chrome reports a blocked subresource (`source: 'security'`), and
     * `Runtime.consoleAPICalled` is where the same text reaches `console`. Both are collected and deduped,
     * because a check that listens on one channel misses half the faults.
     */
    if (m.method === 'Log.entryAdded' && m.params?.entry) {
      const en = m.params.entry;
      console_.push({ from: 'log', level: en.level, source: en.source, text: en.text, url: en.url ?? null });
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.args) {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (text) console_.push({ from: 'console', level: m.params.type, source: 'console', text, url: null });
    }
  });

  const send = (method, params) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');

  for (const path of paths) {
    const url = `${BASE}${path}`;
    console_ = [];
    responses = [];
    /*
     * EVERY PAGE WAITS FOR THE SERVER, BECAUSE THIS CHECKOUT IS SHARED.
     *
     * Another process restarted the review server in the middle of two earlier runs of this script — once
     * showing Chrome's own error page (two decorative SVGs, which read as `imgs 2 broken 0`, a PASS), and once
     * `net::ERR_CONNECTION_REFUSED` for eleven pages. **A probe that cannot tell a rendered page from a
     * dropped connection is the same fault this task exists to correct**, so the server is now polled before
     * each navigation and the wait is bounded and reported.
     */
    let serving = false;
    for (let i = 0; i < 60; i += 1) {
      try {
        const probe = await fetch(url, { method: 'GET' });
        if (probe.status === 200) {
          serving = true;
          break;
        }
      } catch {
        /* the server is restarting */
      }
      await sleep(1000);
    }
    if (!serving) {
      console.log(`  SERVER DOWN  ${path}`);
      results.push({ path, url, unreachable: true, navError: 'the review server did not answer 200', console: [] });
      continue;
    }
    /*
     * THE NAVIGATION'S OWN ERROR IS READ, BECAUSE A CONTAMINATED RUN LOOKS LIKE A RESULT.
     *
     * This checkout is shared and another process restarted the review server in the middle of one run of
     * this script. Chrome showed its own error page for the pages in that window, `document.images` held two
     * decorative SVGs, and **the table said `imgs 2 broken 0` — which reads exactly like a pass.** A probe
     * that cannot tell a rendered page from a failed navigation is the same class of instrument fault this
     * whole task is about, so the error text is now carried into the row and printed.
     */
    const navigated = await send('Page.navigate', { url });
    const navError = navigated?.result?.errorText ?? null;

    // Wait for the document, then a settle period for deferred scripts and the lazy images.
    for (let i = 0; i < 30; i += 1) {
      await sleep(300);
      const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r?.result?.result?.value === 'complete') break;
    }

    /*
     * SCROLL THE WHOLE DOCUMENT BEFORE PROBING, OR A LAZY IMAGE READS AS A BROKEN ONE.
     *
     * The design marks many images `loading="lazy"`, and **an image below the fold that the browser has not
     * been asked to fetch has `naturalWidth === 0`** — the same reading as an image the policy blocked. This
     * script exists to tell those two apart, so the page is walked to the bottom first and the images are
     * given time to arrive. Measured on `/about/`: 2 of 5 read as broken without this, 0 with it.
     */
    await send('Runtime.evaluate', {
      expression: `(async () => {
        const step = Math.round(window.innerHeight * 0.8);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      })()`,
      awaitPromise: true,
    });
    await sleep(1800);

    /*
     * ONE EXPRESSION, ONE JSON ANSWER.
     *
     * `backgroundImage` is read from `getComputedStyle` on every element rather than from the stylesheets,
     * because the value that matters is the one the browser resolved — including a shorthand or a custom
     * property that no grep of the CSS text would have found.
     */
    const probe = `(() => {
      const offOrigin = (u) => !!u && /^https?:\\/\\//i.test(u) && !u.startsWith(location.origin);
      const images = [...document.images].map((img) => ({
        src: img.getAttribute('src'),
        currentSrc: img.currentSrc || null,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete,
        alt: img.getAttribute('alt'),
        crossOrigin: offOrigin(img.currentSrc || img.getAttribute('src')),
      }));
      const backgrounds = [];
      for (const el of document.querySelectorAll('*')) {
        const bi = getComputedStyle(el).backgroundImage;
        if (!bi || bi === 'none') continue;
        for (const m of bi.matchAll(/url\\((['"]?)([^'")]+)\\1\\)/g)) {
          if (offOrigin(m[2])) backgrounds.push({ tag: el.tagName, cls: el.className, url: m[2] });
        }
      }
      /*
       * EVERY OTHER PLACE A URL IS GOVERNED BY img-src, because an instrument that only reads
       * document.images cannot see the faults this brief is about.
       *
       *   source[src|srcset] and <picture>  a candidate the browser may pick INSTEAD of the img
       *   img[srcset]                       a local/remote candidate set
       *   video[poster]                     a poster frame is an image
       *   link[rel~=icon]                   a favicon is an image (it appeared in the trace below)
       *   object[data] / embed[src]         governed by object-src, not img-src, but still off-origin
       */
      const otherOffOrigin = [];
      const push = (kind, url, tag) => { if (offOrigin(url)) otherOffOrigin.push({ kind, url, tag }); };
      for (const el of document.querySelectorAll('img[srcset], source[srcset]')) {
        for (const part of (el.getAttribute('srcset') || '').split(',')) {
          const u = part.trim().split(/\\s+/)[0];
          push('srcset', u, el.tagName);
        }
      }
      for (const el of document.querySelectorAll('source')) push('source-src', el.getAttribute('src'), 'SOURCE');
      for (const el of document.querySelectorAll('video[poster]')) push('poster', el.getAttribute('poster'), 'VIDEO');
      for (const el of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')) {
        push('icon', el.getAttribute('href'), 'LINK');
      }
      for (const el of document.querySelectorAll('object[data]')) push('object', el.getAttribute('data'), 'OBJECT');
      for (const el of document.querySelectorAll('embed[src]')) push('embed', el.getAttribute('src'), 'EMBED');
      const iframes = [...document.querySelectorAll('iframe')].map((f) => ({
        id: f.id || null, src: f.getAttribute('src'), resolved: f.src || null,
        title: f.getAttribute('title'), width: f.clientWidth, height: f.clientHeight,
      }));
      return {
        title: document.title,
        images,
        backgrounds,
        otherOffOrigin,
        iframes,
        videoCards: document.querySelectorAll('.sx-video-card[data-video-id]').length,
      };
    })()`;

    const r = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
    if (r?.result?.exceptionDetails) {
      results.push({ path, url, error: r.result.exceptionDetails.text, console: console_ });
      console.log(`  FAIL  ${path} — the in-page probe threw: ${r.result.exceptionDetails.text}`);
      continue;
    }
    const d = r.result.result.value;

    /*
     * EXERCISE THE INLINE PLAYER RATHER THAN ASSUMING IT.
     *
     * `watch.js` sets the iframe's `src` when a card is clicked, so the served markup ships `src=""` and a
     * markup check can never see the embed URL. Clicking is the only way to make the browser attempt the
     * frame — and therefore the only way its CSP decision is observable.
     */
    let player = null;
    if (d.videoCards > 0) {
      const click = await send('Runtime.evaluate', {
        expression: `(() => {
          const card = document.querySelector('.sx-video-card[data-video-id]');
          if (!card) return null;
          card.click();
          const f = document.getElementById('inline-player-frame');
          const stage = document.getElementById('inline-player');
          return {
            wanted: card.getAttribute('data-video-id'),
            src: f ? f.getAttribute('src') : null,
            stageHidden: stage ? stage.hidden : null,
          };
        })()`,
        returnByValue: true,
      });
      await sleep(2500);
      const after = await send('Runtime.evaluate', {
        expression: `(() => {
          const f = document.getElementById('inline-player-frame');
          const stage = document.getElementById('inline-player');
          return { src: f ? f.getAttribute('src') : null, stageHidden: stage ? stage.hidden : null };
        })()`,
        returnByValue: true,
      });
      player = { ...(click?.result?.result?.value ?? {}), afterClick: after?.result?.result?.value ?? null };
    }

    /*
     * WHICH OFF-ORIGIN HOSTS THE BROWSER ACTUALLY FETCHED, AND WITH WHAT ANSWER.
     *
     * An empty list on `/watch/` is the fingerprint of a policy that blocked the thumbnails — those requests
     * were never made, so no status exists. A `200` here is the positive proof the allowance works.
     */
    const offOriginHosts = {};
    for (const r of responses) {
      let h = null;
      try {
        h = new URL(r.url).host;
      } catch {
        /* a data: URL has no host */
      }
      if (!h || r.url.startsWith(BASE)) continue;
      (offOriginHosts[h] ??= []).push(`${r.status} ${r.mimeType ?? ''} ${r.type ?? ''}`.trim());
    }

    const row = { path, url, status: navigated?.result?.status ?? null, navError, ...d, player, offOriginHosts, console: console_ };
    results.push(row);

    const broken = d.images.filter((i) => i.complete && i.naturalWidth === 0);
    /*
     * A NAVIGATION THAT FAILED IS NOT A PASS. The transport error is the test; a title check is deliberately
     * NOT used, because the archive's own titles say "Ozi Ikoro" and a substring test for "ozikoro" called the
     * about page unreachable when it had loaded perfectly.
     */
    const unreachable = Boolean(navError) || !d.title;
    if (unreachable) {
      console.log(`  UNREACHABLE  ${path.padEnd(28)} ${navError ?? 'no document title'}`);
      results.push({ path, url, unreachable: true, navError, title: d.title, console: console_ });
      continue;
    }
    const offOriginBg = d.backgrounds.length;
    const hosts = Object.entries(offOriginHosts)
      .map(([h, list]) => `${h}(${list.length})`)
      .join(' ');
    console.log(
      `  ${path.padEnd(28)} imgs ${String(d.images.length).padStart(2)}` +
        ` broken ${String(broken.length).padStart(2)}` +
        ` off-origin-bg ${offOriginBg}` +
        ` other-off-origin ${d.otherOffOrigin.length}` +
        ` iframes ${d.iframes.length}` +
        ` csp ${String(console_.filter((c) => /Content Security Policy/i.test(c.text)).length).padStart(2)}` +
        (hosts ? `  fetched: ${hosts}` : '')
    );
  }

  const out = `/tmp/oz316-${label}.json`;
  writeFileSync(out, JSON.stringify({ label, base: BASE, at: new Date().toISOString(), results }, null, 2));
  console.log(`\n  wrote ${out}`);
} finally {
  try {
    if (ws) ws.close();
  } catch {
    /* nothing to close */
  }
  proc.kill('SIGTERM');
}
