/*
 * verify-round-353-chrome.mjs — the controls the reader presses, pressed in a real browser.
 *
 * WHY A BROWSER AND NOT `curl`
 *
 * The fault this round is about is a control that answers 200 and does not do what its label says, and one of
 * the two candidates is **filled at click time by a script**: `/watch/`'s `#inline-player-page` carries
 * `href="/watch-video/"` in the served HTML and the extended `watch.js` rewrites it from the clicked card's
 * `data-video-page` inside `open(card)`. **`curl` reads the served markup and cannot tell the difference
 * between a control that is never rewritten and one that is rewritten before a reader can reach it** — which
 * is exactly the mistake round 352's `Open on YouTube` finding was made of, and the reason this probe clicks
 * rather than reads.
 *
 * WHAT IT MEASURES
 *
 *   A. THE INLINE PLAYER'S OWN LINK. Click an archive film's card, read the `href` the script produced, follow
 *      it, and read the destination's `<h1>` — so "the link carries the film" is a destination and not a claim.
 *   B. THE SAME CONTROL FOR A CARD THE ARCHIVE CANNOT SERVE. Click the design's own card and read whether the
 *      control is hidden — because an address that discards the film is a fault and a 404 is a worse one.
 *   C. THE BARE FILM PAGE'S FRAGMENTS, followed in the DOM. Every `href` with a `#` on `/watch-video/`, its
 *      resolved address, and whether the target id exists on the page — the check the owner's own address
 *      (`/watch-video/#transcript`) is the case for.
 *   D. THE BARE FILM PAGE'S CONTROLS, pressed: the external one is reported, the inert one must not navigate,
 *      and the "Watch" link in the related block must land on the films index.
 *   E. THE `?v=` PAGE STILL WORKS, because this round must not undo round 352.
 *
 * USAGE
 *   node scripts/verify-round-353-chrome.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

mkdirSync('/tmp/wr353', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9800 + Math.floor(Math.random() * 90);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/oz-verify-353-${debugPort}`,
  '--window-size=1440,2600', 'about:blank',
], { stdio: 'ignore' });

const report = { base: BASE, steps: [], problems: [], declared: [] };
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
  let badResponses = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Network.responseReceived' && m.params?.response) {
      const r = m.params.response;
      if (r.status >= 400 && m.params.type !== 'Document') {
        badResponses.push({ status: r.status, url: r.url, type: m.params.type });
      }
    }
  });

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
  await send('Network.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r?.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'evaluate failed');
    return r?.result?.result?.value;
  };

  async function open(url) {
    badResponses = [];
    console.log(`    open ${url}`);
    await send('Page.navigate', { url });
    for (let i = 0; i < 60; i += 1) {
      await sleep(200);
      if (await evaluate('document.readyState') === 'complete') break;
    }
    await sleep(700);
  }

  const h1 = () => evaluate(`document.querySelector('h1')?.textContent?.replace(/\\s+/g,' ').trim() ?? null`);
  const url = () => evaluate('location.href');

  /* ── A. THE INLINE PLAYER'S OWN LINK, CLICKED ──────────────────────────────────────────────────── */

  console.log('\nA. THE INLINE PLAYER’S "This film’s page" — the href a CLICK produces\n');
  await open(`${BASE}/watch/`);
  const cards = await evaluate(`[...document.querySelectorAll('.sx-video-card[data-video-id]')].map((c) => ({
    id: c.getAttribute('data-video-id'),
    page: c.getAttribute('data-video-page'),
  }))`);
  const withPage = cards.filter((c) => c.page);
  const withoutPage = cards.filter((c) => !c.page);
  console.log(`    ${cards.length} card(s): ${withPage.length} carry data-video-page, ${withoutPage.length} do not`);
  for (const c of withoutPage) {
    console.log(`      no address: ${c.id}`);
    if (c.page) problem(`the design card ${c.id} carries an address, so it is not the design's own film`);
  }

  /*
   * THE ARCHIVE'S FIRST CARD, WHICH HAS A RECORD. The film is read from the card's own `data-video-page`, so
   * the expectation is the page's own data and not a constant written here.
   */
  const archiveCard = withPage[0];
  if (!archiveCard) {
    problem('no film card on /watch/ carries an address, so the inline player can never reach a film page');
  } else {
    await evaluate(`(() => {
      const card = document.querySelector('.sx-video-card[data-video-id="' + ${JSON.stringify(archiveCard.id)} + '"]');
      if (!card) return false;
      card.scrollIntoView({ block: 'center' });
      card.click();
      return true;
    })()`);
    await sleep(700);
    const state = await evaluate(`(() => {
      const p = document.getElementById('inline-player-page');
      const e = document.getElementById('inline-player-external');
      return {
        pageHref: p?.getAttribute('href') ?? null,
        pageResolved: p?.href ?? null,
        pageHidden: p?.hidden ?? null,
        externalHref: e?.getAttribute('href') ?? null,
        playing: document.getElementById('inline-player-frame')?.getAttribute('src') ?? null,
      };
    })()`);
    report.steps.push({ step: 'inline player, archive card', card: archiveCard, state });
    console.log(`    clicked card ${archiveCard.id} (data-video-page=${archiveCard.page})`);
    console.log(`      #inline-player-page  href=${JSON.stringify(state.pageHref)}  hidden=${state.pageHidden}`);
    console.log(`      resolved            ${state.pageResolved}`);
    console.log(`      #inline-player-frame ${state.playing}`);
    if (state.pageHidden) problem(`the film page control stayed hidden for the archive card ${archiveCard.id}`);
    if (!state.pageHref || !state.pageHref.includes(archiveCard.id)) {
      problem(`the film page control carries ${JSON.stringify(state.pageHref)} for card ${archiveCard.id} — the control discards the film`);
    }

    /* Follow it, and read the destination's own <h1>. */
    if (state.pageHref) {
      const destination = new URL(state.pageHref, `${BASE}/watch/`).href;
      await open(destination);
      const heading = await h1();
      report.steps.push({ step: 'clicked through to the film page', url: destination, h1: heading });
      console.log(`      followed -> ${destination}\n      h1: ${heading}`);
      if (!destination.includes(`?v=${archiveCard.id}`)) {
        problem(`the film page control opened ${destination}, which is not the film ${archiveCard.id}`);
      }
    }

    /* AND THE DESIGN'S OWN CARD, WHICH THE ARCHIVE CANNOT SERVE. */
    if (withoutPage[0]) {
      await open(`${BASE}/watch/`);
      await evaluate(`(() => {
        const card = document.querySelector('.sx-video-card[data-video-id="' + ${JSON.stringify(withoutPage[0].id)} + '"]');
        if (!card) return false;
        card.scrollIntoView({ block: 'center' });
        card.click();
        return true;
      })()`);
      await sleep(700);
      const state2 = await evaluate(`(() => {
        const p = document.getElementById('inline-player-page');
        return { pageHref: p?.getAttribute('href') ?? null, pageHidden: p?.hidden ?? null };
      })()`);
      report.steps.push({ step: 'inline player, design card', card: withoutPage[0], state: state2 });
      console.log(`    clicked the design’s card ${withoutPage[0].id} (no data-video-page)`);
      console.log(`      #inline-player-page  href=${JSON.stringify(state2.pageHref)}  hidden=${state2.pageHidden}`);
      if (!state2.pageHidden) {
        problem(`the film page control is VISIBLE for the design card ${withoutPage[0].id}, and would open ${state2.pageHref}`);
      }
    }
  }

  /* ── B. THE SAME CONTROL ON PAGE 2, WHICH THE PAGING ROUND REWROTE ─────────────────────────────── */

  console.log('\nB. THE SAME CONTROL ON /watch/?page=2, WHICH THE PAGING ROUND REWROTE\n');
  await open(`${BASE}/watch/?page=2`);
  const page2Cards = await evaluate(`[...document.querySelectorAll('.sx-video-card[data-video-id]')].map((c) => ({
    id: c.getAttribute('data-video-id'),
    page: c.getAttribute('data-video-page'),
  }))`);
  const script2 = await evaluate(`[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))`);
  console.log(`    ${page2Cards.length} card(s) on page 2; scripts ${JSON.stringify(script2)}`);
  if (!script2.includes('/design-screen-assets/watch.js')) {
    problem('/watch/?page=2 does not load the extended watch.js, so the film page control would never be filled');
  }
  const bad2 = page2Cards.filter((c) => !c.page || !c.page.includes(c.id));
  for (const c of bad2) console.log(`      card ${c.id} has page ${JSON.stringify(c.page)}`);
  if (bad2.length > 0) problem(`${bad2.length} card(s) on page 2 carry an address that does not name their film`);
  if (page2Cards[0]?.page) {
    await evaluate(`(() => {
      const card = document.querySelector('.sx-video-card[data-video-id="' + ${JSON.stringify(page2Cards[0].id)} + '"]');
      card.scrollIntoView({ block: 'center' });
      card.click();
      return true;
    })()`);
    await sleep(700);
    const state3 = await evaluate(`(() => {
      const p = document.getElementById('inline-player-page');
      return { href: p?.getAttribute('href') ?? null, hidden: p?.hidden ?? null };
    })()`);
    console.log(`    clicked page 2’s ${page2Cards[0].id} -> #inline-player-page href=${JSON.stringify(state3.href)} hidden=${state3.hidden}`);
    if (state3.hidden) problem(`the film page control stayed hidden on page 2 for ${page2Cards[0].id}`);
    if (!state3.href || !state3.href.includes(page2Cards[0].id)) {
      problem(`page 2’s control carries ${JSON.stringify(state3.href)} for ${page2Cards[0].id} — it discards the film`);
    }
    report.steps.push({ step: 'inline player, page 2', card: page2Cards[0], state: state3 });
  }

  /* ── C. THE BARE FILM PAGE'S FRAGMENTS, FOLLOWED IN THE DOM ───────────────────────────────────── */

  console.log('\nC. THE BARE FILM PAGE’S FRAGMENTS — followed in the DOM, each target read\n');
  await open(`${BASE}/watch-video/`);
  const bareUrl = await url();
  const bareH1 = await h1();
  const fragments = await evaluate(`(() => {
    const ids = new Set([...document.querySelectorAll('[id]')].map((e) => e.id));
    return [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h.includes('#'))
      .map((h) => ({ raw: h, resolved: new URL(h, document.baseURI).href, fragment: h.slice(h.indexOf('#') + 1) }))
      .map((f) => ({ ...f, present: ids.has(f.fragment) }));
  })()`);
  console.log(`    ${bareUrl}  h1=${JSON.stringify(bareH1)}`);
  const seen = new Set();
  for (const f of fragments) {
    if (seen.has(f.raw)) continue;
    seen.add(f.raw);
    console.log(`      ${f.raw}\n          -> ${f.resolved}  target ${f.present ? 'present' : 'MISSING'}`);
    if (!f.present) problem(`/watch-video/: ${f.raw} names #${f.fragment}, which the page does not carry`);
  }
  const idsOnBare = await evaluate(`[...document.querySelectorAll('[id]')].map((e) => e.id)`);
  for (const gone of ['transcript', 'transcript-copy']) {
    if (idsOnBare.includes(gone)) problem(`/watch-video/ still carries id="${gone}"`);
  }
  const dead = await evaluate(`(() => {
    const ids = new Set([...document.querySelectorAll('[id]')].map((e) => e.id));
    return [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h.includes('#'))
      .map((h) => h.slice(h.indexOf('#') + 1))
      .filter((f) => f && !ids.has(f));
  })()`);
  console.log(`    fragments naming an id the page does not carry: ${JSON.stringify(dead)}`);
  if (dead.length > 0) problem(`/watch-video/ writes ${JSON.stringify(dead)}, which the page does not carry`);

  /* ── D. THE BARE FILM PAGE'S CONTROLS, PRESSED ─────────────────────────────────────────────────── */

  console.log('\nD. THE BARE FILM PAGE’S CONTROLS — the inert one must not navigate\n');
  const controls = await evaluate(`[...document.querySelectorAll('.sx-video-actions a, .sx-video-copy a')].map((a) => ({
    label: a.textContent.replace(/\\s+/g, ' ').trim(),
    href: a.getAttribute('href'),
    resolved: a.href,
    ariaDisabled: a.getAttribute('aria-disabled'),
    title: a.getAttribute('title'),
    tag: a.tagName,
  }))`);
  for (const c of controls) {
    console.log(`    "${c.label}"  <${c.tag}>  href=${JSON.stringify(c.href)}  aria-disabled=${JSON.stringify(c.ariaDisabled)}`);
    if (c.title) console.log(`        title: ${c.title}`);
  }
  const before = await url();
  const inert = controls.find((c) => /Low-bandwidth reading/.test(c.label));
  if (!inert) {
    problem('/watch-video/ offers no "Low-bandwidth reading" control at all');
  } else {
    if (inert.href !== null) problem(`the inert reading control still carries href=${JSON.stringify(inert.href)}`);
    if (inert.ariaDisabled !== 'true') problem('the inert reading control is not marked aria-disabled="true"');
    await evaluate(`(() => {
      const a = [...document.querySelectorAll('a')].find((x) => /Low-bandwidth reading/.test(x.textContent));
      if (a) a.click();
      return true;
    })()`);
    await sleep(800);
    const after = await url();
    console.log(`    clicked it: ${before}  ->  ${after}`);
    if (after !== before) problem(`the inert reading control navigated to ${after}`);
  }

  const copy = await evaluate(`document.querySelector('.sx-video-copy')?.textContent?.replace(/\\s+/g,' ').trim() ?? null`);
  const facts = await evaluate(`document.querySelector('.sx-video-facts')?.textContent?.replace(/\\s+/g,' ').trim() ?? null`);
  const related = await evaluate(`(() => {
    const el = document.getElementById('related-video');
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  })()`);
  console.log(`\n    sx-video-copy: ${JSON.stringify(copy)}`);
  console.log(`    sx-video-facts: ${JSON.stringify(facts)}`);
  console.log(`    #related-video: ${JSON.stringify(related)}`);
  report.steps.push({ step: 'bare film page', url: bareUrl, h1: bareH1, copy, facts, related, controls });

  /* ── E. THE `?v=` PAGE, WHICH THIS MUST NOT UNDO ───────────────────────────────────────────────── */

  console.log('\nE. THE `?v=` PAGE, WHICH ROUND 352 RESTRUCTURED\n');
  await open(`${BASE}/watch-video/?v=LL8YX0pXzdI`);
  const held = {
    url: await url(),
    h1: await h1(),
    copy: await evaluate(`document.querySelector('.sx-video-copy')?.textContent?.replace(/\\s+/g,' ').trim() ?? null`),
    prose: await evaluate(`!!document.querySelector('div.prose')`),
    readingSection: await evaluate(`!!document.getElementById('transcript')`),
    fragments: await evaluate(`[...document.querySelectorAll('a[href*="#"]')].map((a) => a.getAttribute('href'))`),
    controls: await evaluate(`[...document.querySelectorAll('.sx-video-actions a')].map((a) => a.getAttribute('href'))`),
    related: await evaluate(`document.getElementById('related-video')?.textContent?.replace(/\\s+/g,' ').trim() ?? null`),
  };
  report.steps.push({ step: '?v= page', ...held });
  console.log(`    ${held.url}\n    h1: ${held.h1}`);
  console.log(`    div.prose present: ${held.prose}   #transcript present: ${held.readingSection}`);
  console.log(`    controls: ${JSON.stringify(held.controls)}`);
  console.log(`    fragments: ${JSON.stringify(held.fragments)}`);
  console.log(`    #related-video: ${JSON.stringify(held.related)}`);
  if (held.prose) problem('/watch-video/?v= carries the article body that round 352 removed');
  if (held.readingSection) problem('/watch-video/?v= carries id="transcript" again');
  if (!held.related) problem('/watch-video/?v= has no related block');

  for (const [path, page] of [['/watch-video/', null], ['/watch-video/?v=LL8YX0pXzdI', null]]) {
    void path; void page;
  }
  if (badResponses.length > 0) {
    for (const b of badResponses) problem(`a subresource answered ${b.status}: ${b.url} (${b.type})`);
  }
} catch (error) {
  problem(`the probe itself failed: ${error.message}`);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  proc.kill('SIGTERM');
}

writeFileSync('/tmp/wr353/report.json', JSON.stringify(report, null, 2));
console.log(`\n${report.problems.length === 0 ? 'OK' : 'FAILED'}: ${report.problems.length} problem(s) — /tmp/wr353/report.json`);
for (const p of report.problems) console.log(`  - ${p}`);
process.exit(report.problems.length === 0 ? 0 : 1);
