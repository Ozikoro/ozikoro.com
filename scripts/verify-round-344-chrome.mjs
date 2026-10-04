/*
 * verify-round-344-chrome.mjs — the controls, clicked in a real browser.
 *
 * WHY A BROWSER AND NOT `curl`
 *
 * `curl` cannot resolve a relative URL, cannot follow an in-page fragment, and cannot tell a link that
 * navigates from one that is intercepted by a script. The `Next` button on `/watch/` answered 200 to
 * `curl` at the address it *would* have asked for and landed on the front page in a browser, because the
 * served head carries `<base href="/">` and the href was relative. **The instrument has to be a browser.**
 *
 * WHAT IT MEASURES
 *
 *   A. THE `<base>` AND THE FRAGMENT. `designScreenLinks` adds `<base href="/">` to every served screen.
 *      A fragment-only address is resolved against the base, so if the base is `/` then `#series` on
 *      `/watch/` resolves to `/#series` — a different document. The probe reads each anchor's resolved
 *      `.href` from the DOM (which is the browser's own answer, not a string join) and then CLICKS one,
 *      reporting the URL it lands on.
 *   B. THE MENUS. For a sample of screens, every link in the primary nav is opened and its `<h1>` read,
 *      so "the menu works" is a list of destinations rather than a claim.
 *   C. THE PAGER, THE FILM PAGE, THE SEARCH FORM — the controls that today returned 200 and did the wrong
 *      thing.
 *   D. THE CONSOLE. An unprompted 404 (`/favicon.ico`) is the only console fault the browser reports by
 *      itself, so the log is collected on every page.
 *
 * USAGE
 *   node scripts/verify-round-344-chrome.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

mkdirSync('/tmp/wr344', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9700 + Math.floor(Math.random() * 90);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/oz-verify-338-${debugPort}`,
  '--window-size=1440,2600', 'about:blank',
], { stdio: 'ignore' });

const report = { base: BASE, steps: [], problems: [] };
const problem = (m) => { report.problems.push(m); console.log(`  PROBLEM  ${m}`); };

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
  let logs = [];
  let badResponses = [];
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
    /*
     * EVERY SUBRESOURCE, NOT JUST THE DOCUMENT. A script tag that 404s is invisible in the page: it renders,
     * the stylesheets load, the `h1` is right, and the only thing missing is the behaviour the script was for.
     * `/design-screen-assets/mobile-nav.js` answered 404 on three screens that way, and the cost was the whole
     * phone menu. **The document's own status cannot see it**, so the network is watched here.
     */
    if (m.method === 'Network.responseReceived' && m.params?.response) {
      const r = m.params.response;
      /*
       * THE DOCUMENT ITSELF IS NOT A SUBRESOURCE, AND A GATED PAGE'S OWN 403 IS NOT A BROKEN ASSET. The eleven
       * role dashboards answer 403 to a signed-out fetch BY DESIGN, and the sweep navigates to them — so
       * counting the document's own status here reported eleven "broken resources" that are the auth gate
       * working. What this list is for is the thing that is invisible in the page: a script or a stylesheet
       * the markup asks for that does not answer.
       */
      if (r.status >= 400 && m.params.type !== 'Document') {
        badResponses.push({ status: r.status, url: r.url, type: m.params.type });
      }
    }
    if (m.method === 'Network.loadingFailed' && !m.params?.canceled) {
      badResponses.push({ status: 'failed', url: m.params?.requestId ?? '', type: m.params?.errorText ?? '' });
    }
  });
  /*
   * EVERY CALL IS BOUNDED. A DevTools call that never answers leaves the promise pending for ever and the
   * whole probe hangs with no output — which is exactly what happened twice: the report stopped after the
   * first heading, and a run that hangs says nothing about the site. **A probe that cannot finish must still
   * be able to say where it stopped**, so a call that has not answered in fifteen seconds resolves with a
   * marker the caller can report rather than waiting indefinitely.
   */
  const send = (method, params) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pending.has(i)) { pending.delete(i); resolve({ timedOut: true, method }); }
    }, 15000);
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');

  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r?.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'evaluate failed');
    return r?.result?.result?.value;
  };

  async function open(url) {
    logs = [];
    badResponses = [];
    process.stdout.write(`    open ${url}\n`);
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i += 1) {
      await sleep(200);
      if (await evaluate('document.readyState') === 'complete') break;
    }
    await sleep(600);
  }

  const h1 = () => evaluate(`document.querySelector('h1')?.textContent?.replace(/\\s+/g,' ').trim() ?? null`);

  /** Click a control by a CSS selector, then report where the browser ended up. */
  async function click(selector, label) {
    const found = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    })()`);
    if (!found) { problem(`${label}: no element matched ${selector}`); return null; }
    for (let i = 0; i < 40; i += 1) {
      await sleep(200);
      if (await evaluate('document.readyState') === 'complete') break;
    }
    await sleep(500);
    const url = await evaluate('location.href');
    const heading = await h1();
    const step = { label, selector, url, h1: heading };
    report.steps.push(step);
    console.log(`  ${label}\n      -> ${url}\n      h1: ${heading}`);
    return step;
  }

  /* ── A. THE BASE, AND WHAT A FRAGMENT RESOLVES TO ─────────────────────────────────────────────── */

  console.log('\nA. THE SERVED <base> AND THE IN-PAGE ANCHORS\n');
  for (const page of ['/watch/', '/about/', '/listen/', '/documents/']) {
    await open(`${BASE}${page}`);
    const info = await evaluate(`(() => {
      const bases = [...document.querySelectorAll('base')].map((b) => b.getAttribute('href'));
      const frag = [...document.querySelectorAll('a[href^="#"]')].slice(0, 6)
        .map((a) => ({ raw: a.getAttribute('href'), resolved: a.href }));
      const rel = [...document.querySelectorAll('a[href]')]
        .filter((a) => !/^([a-z]+:|\\/\\/|\\/|#)/i.test(a.getAttribute('href')))
        .map((a) => a.getAttribute('href'));
      return { bases, frag, rel, h1: document.querySelector('h1')?.textContent?.replace(/\\s+/g,' ').trim() ?? null };
    })()`);
    console.log(`  ${page}  base=${JSON.stringify(info.bases)}  h1=${JSON.stringify(info.h1)}`);
    for (const f of info.frag) {
      console.log(`      ${f.raw}  resolves to  ${f.resolved}`);
      const expected = new URL(f.raw, `${BASE}${page}`).href;
      if (f.resolved !== expected) problem(`${page}: ${f.raw} resolves to ${f.resolved}, not ${expected}`);
      if (info.bases.length === 1 && f.resolved !== `${BASE}${page}${f.raw}`) {
        problem(`${page}: ${f.raw} is resolved against the <base>, so it leaves the page (${f.resolved})`);
      }
    }
    /*
     * A RELATIVE ANCHOR IN THE DOM IS NOT AUTOMATICALLY A FAULT — IT IS A QUESTION ABOUT WHERE IT RESOLVES.
     *
     * The served markup carries none (the crawl asserts that), and the one that appears here is injected at run
     * time by the design's own `mobile-nav.js`: `<a href="igbo-calendar.html">` in the market-day date bar.
     * **No rewrite can reach it, which is precisely why the `<base href="/">` is kept** — the base resolves it
     * to `/igbo-calendar.html`, which the middleware 301s to `/igbo-calendar/`.
     *
     * So it is followed rather than condemned: the browser is asked for the address that anchor actually
     * means, and the check is whether it lands on a page. A relative anchor that resolves to a 404 is the
     * fault; a relative anchor that resolves correctly is the mechanism working.
     */
    if (info.rel.length) {
      const followed = await evaluate(`(async () => {
        const a = [...document.querySelectorAll('a[href]')]
          .find((x) => !/^([a-z]+:|\\/\\/|\\/|#)/i.test(x.getAttribute('href')));
        if (!a) return null;
        const r = await fetch(a.href, { redirect: 'follow' });
        return { raw: a.getAttribute('href'), href: a.href, status: r.status, finalUrl: r.url };
      })()`, true);
      if (!followed) problem(`${page}: a relative anchor in the DOM could not be followed`);
      else {
        console.log(`      script-injected relative anchor ${followed.raw} resolves to ${followed.href} -> ${followed.status} ${followed.finalUrl}`);
        if (followed.status !== 200) problem(`${page}: the script-injected relative anchor ${followed.raw} resolves to ${followed.href}, which answers ${followed.status}`);
      }
    }
    report.steps.push({ label: `base+anchors ${page}`, ...info });
  }

  /* ── B. A MENU, CLICKED ───────────────────────────────────────────────────────────────────────── */

  console.log('\nB. THE MENU, CLICKED ON FOUR SCREENS\n');
  for (const page of ['/about/', '/documents/', '/listen/', '/photographs/']) {
    await open(`${BASE}${page}`);
    const menu = await evaluate(`[...document.querySelectorAll('nav a[href]')]
      .map((a) => ({ text: a.textContent.replace(/\\s+/g,' ').trim(), href: a.href }))
      .filter((x) => x.text && new URL(x.href).origin === location.origin)`);
    console.log(`  ${page}: ${menu.length} same-origin menu link(s)`);
    for (const item of menu.slice(0, 8)) {
      await open(`${BASE}${page}`);
      const step = await click(`nav a[href="${new URL(item.href).pathname}${new URL(item.href).search}"]`, `${page} nav "${item.text}"`);
      if (step && new URL(step.url).pathname !== new URL(item.href).pathname) {
        problem(`${page} nav "${item.text}" was promised ${item.href} and landed on ${step.url}`);
      }
    }
  }

  /* ── C. THE CONTROLS THAT WERE BROKEN TODAY ──────────────────────────────────────────────────── */

  console.log('\nC. THE PAGER, THE FILM PAGE, THE SEARCH FORM\n');
  await open(`${BASE}/watch/`);
  const pager = await evaluate(`(() => {
    const a = document.querySelector('nav[aria-label="Pagination"] a');
    return a ? { text: a.textContent.trim(), href: a.href } : null;
  })()`);
  if (!pager) problem('/watch/: no pager link in the documented nav');
  else {
    const step = await click('nav[aria-label="Pagination"] a', `/watch/ pager "${pager.text}"`);
    if (step && !/page=2/.test(step.url)) problem(`/watch/ pager landed on ${step.url}, which carries no page=2`);
  }

  await open(`${BASE}/watch/`);
  const search = await evaluate(`(() => {
    const f = document.querySelector('form[role="search"]');
    return f ? { action: f.getAttribute('action'), resolved: f.action, method: f.method } : null;
  })()`);
  console.log(`  /watch/ search form -> ${JSON.stringify(search)}`);
  if (!search) problem('/watch/: no search form');
  else if (new URL(search.resolved).pathname !== '/watch/') problem(`/watch/ search form posts to ${search.resolved}`);

  /*
   * THE WAY FROM A PLAYING FILM TO THAT FILM'S OWN PAGE.
   *
   * `/watch/`'s cards are `<button>`s by the design's own intent, so the film-page link lives in the inline
   * player — and the extended `watch.js` is what points it at the film that was just opened. This clicks a
   * card and follows the link, so the whole chain is measured rather than the two halves separately.
   */
  await open(`${BASE}/watch/`);
  /*
   * A CARD WHOSE FILM THE ARCHIVE HOLDS, WHICH IS THE ONE THAT HAS A PAGE. The design's own six cards are
   * films the archive does not hold — `/watch-video/?v=<their id>` is a 404 — and the extended script hides the
   * control for them. So the card that must have a page is the one carrying `data-video-page`.
   */
  const cardId = await evaluate(`(() => {
    const c = document.querySelector('.sx-video-card[data-video-page]')
      || document.querySelector('.sx-video-card[data-video-id]');
    return c ? c.getAttribute('data-video-id') : null;
  })()`);
  const cardHasPage = await evaluate(`(() => {
    const c = document.querySelector('.sx-video-card[data-video-id]');
    return c ? c.hasAttribute('data-video-page') : null;
  })()`);
  if (!cardId) problem('/watch/: no film card carries a data-video-id');
  else {
    const pageHref = await click(`.sx-video-card[data-video-id="${cardId}"]`, `/watch/ card ${cardId} → its own page`);
    const linkEl = await evaluate(`(() => {
      const a = document.getElementById('inline-player-page');
      return a ? { href: a.href, hidden: a.hidden } : null;
    })()`);
    console.log(`  after clicking ${cardId}, the film-page link is ${JSON.stringify(linkEl)} (card carries a page: ${cardHasPage})`);
    if (!linkEl) problem('/watch/: the inline player carries no film-page link');
    else if (cardHasPage && linkEl.hidden) problem(`/watch/: the film page for ${cardId} is hidden although the archive holds it`);
    else if (cardHasPage && !linkEl.href.endsWith(`/watch-video/?v=${cardId}`)) {
      problem(`/watch/: the film-page link is ${linkEl.href}, not /watch-video/?v=${cardId}`);
    } else if (cardHasPage) {
      /* And the address it names answers, rather than being a 404 the page dressed up as a control. */
      const reached = await evaluate(`(async () => { const r = await fetch(${JSON.stringify(linkEl.href)}); return { status: r.status, url: r.url }; })()`, true);
      console.log(`      ${linkEl.href} -> ${reached.status}`);
      if (reached.status !== 200) problem(`/watch/: ${cardId}'s own page answers ${reached.status}`);
    }
    if (pageHref === null) problem(`/watch/: the card ${cardId} could not be clicked`);
  }

  await open(`${BASE}/watch-video/`);
  const defaultFilm = await evaluate(`({ url: location.href, h1: document.querySelector('h1')?.textContent.trim(),
     src: document.querySelector('.sx-player iframe')?.getAttribute('src') ?? null })`);
  console.log(`  /watch-video/ (no ?v=) -> ${JSON.stringify(defaultFilm)}`);
  report.steps.push({ label: '/watch-video/ default', ...defaultFilm });
  {
    const ids = await evaluate(`[...document.querySelectorAll('[data-video-id]')].map((e) => e.getAttribute('data-video-id'))`);
    report.watchVideoIds = ids;
    if (ids && ids.length) {
      const first = ids[0];
      await open(`${BASE}/watch-video/?v=${first}`);
      const film = await evaluate(`({ url: location.href, h1: document.querySelector('h1')?.textContent.trim(),
         src: document.querySelector('.sx-player iframe')?.getAttribute('src') ?? null })`);
      console.log(`  /watch-video/?v=${first} -> ${JSON.stringify(film)}`);
      report.steps.push({ label: `/watch-video/?v=${first}`, ...film });
      if (film.src === defaultFilm.src) problem(`/watch-video/?v=${first} shows the same film as the default page`);
      if (film.src && !film.src.includes(first)) problem(`/watch-video/?v=${first} plays ${film.src}`);
      if (/\[Re:\]Entanglements/.test(await evaluate(`document.body.innerText`))) {
        problem(`/watch-video/?v=${first} still carries the design's publisher`);
      }
    }
  }

  await open(`${BASE}/signin`);
  const signin = await evaluate(`(() => {
    const hashes = [...document.querySelectorAll('a[href="#"]')].map((a) => a.textContent.replace(/\\s+/g,' ').trim());
    const bases = [...document.querySelectorAll('base')].map((b) => b.getAttribute('href'));
    return { hashes, bases, h1: document.querySelector('h1')?.textContent.replace(/\\s+/g,' ').trim() ?? null };
  })()`);
  console.log(`  /signin: ${signin.hashes.length} href="#" anchor(s), base=${JSON.stringify(signin.bases)}`);
  for (const t of signin.hashes) console.log(`      "${t}"`);
  report.steps.push({ label: '/signin placeholders', ...signin });

  /* ── D. EVERY PAGE: THE ASSETS IT ACTUALLY ASKS FOR ─────────────────────────────────────────── */

  console.log('\nD. EVERY PAGE VISITED: ANY RESOURCE THAT ANSWERED 4xx OR FAILED\n');
  const { readdirSync } = await import('node:fs');
  const screens = readdirSync('apps/ozikoro/public/design/screens')
    .filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
  const sweep = screens.filter((s) => s !== '404').map((s) => (s === 'home' ? '/' : `/${s}/`));
  /* The React routes a signed-out reader can fetch, added to the design screens. */
  sweep.push('/towns/', '/researchers/', '/archive/', '/search/', '/claims/', '/reviews/',
    '/publications/', '/projects/', '/clans/', '/entities/', '/submit/', '/author/nze/', '/researchers/199/');
  let swept = 0;
  for (const path of sweep) {
    await open(`${BASE}${path}`);
    const bad = badResponses.filter((b) => !/\/favicon\.ico$/.test(b.url));
    for (const b of bad) {
      console.log(`  BAD  ${path}  ${b.status}  ${b.url}`);
      problem(`${path} asks for ${b.url} and it answered ${b.status}`);
    }
    swept += 1;
  }
  console.log(`  ${swept} page(s) swept`);

  /* ── E. THE CONSOLE ──────────────────────────────────────────────────────────────────────────── */

  console.log('\nE. THE CONSOLE, ON EVERY PAGE VISITED\n');
  const bad = logs.filter((l) => l.level === 'error' || l.level === 'warning');
  console.log(`  ${bad.length} error/warning entry/entries on the last page (${await evaluate('location.pathname')})`);
  for (const l of bad.slice(0, 10)) console.log(`      ${l.level}  ${l.text.slice(0, 180)}`);
  report.logs = logs;

  console.log(`\nPROBLEMS: ${report.problems.length}`);
  for (const p of report.problems) console.log(`  - ${p}`);
  writeFileSync('/tmp/wr344/chrome.json', JSON.stringify(report, null, 1));
  if (report.problems.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  try { proc.kill('SIGTERM'); } catch { /* already gone */ }
}
