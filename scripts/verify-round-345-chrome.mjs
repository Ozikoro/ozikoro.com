/*
 * verify-round-345-chrome.mjs — the owner's two faults on `/cultural-calendar/`, measured in a real browser.
 *
 * WHY A BROWSER, AGAIN
 *
 * The owner's second report is a CONTROL fault: *"why is the events that is clickable not showing there
 * anymore? … it is supposed to be showing, and when clicked, you see the events."* **A button nothing listens
 * to and a button that works are the same bytes of HTML.** The page answered 200 with 43 `data-*` attributes,
 * 41 day cells and 0 bound handlers, and no instrument short of a browser can tell that from a page that
 * works. So this script CLICKS a date and reads the panel a reader would be looking at — the DOM after the
 * event, not the markup before it.
 *
 * ── WHY THE CONNECTION IS TO THE BROWSER AND NOT TO THE PAGE ─────────────────────────────────────
 *
 * The first version attached to the page target's own `webSocketDebuggerUrl`, fired `Page.navigate`, and then
 * **sat there with no output at all**: no response to the navigation and no response to any `Runtime.evaluate`
 * after it, with no close event either. Measured here on Chrome 154, that connection is dead from the moment a
 * navigation starts, and it does not say so. So the probe attaches to the **browser** endpoint and
 * `Target.attachToTarget({flatten:true})`s the page, which is what a real client does: the browser connection
 * outlives the page, every command carries a `sessionId`, and a navigation is an ordinary answered command.
 * **There is a 20-second deadline on every call**, because a probe that hangs silently is worse than one that
 * fails loudly — that is how the first version wasted a run.
 *
 * WHAT IT MEASURES
 *
 *   A. THE DATE IS A CONTROL. How many `[data-event-date]` dates the served page has, what happens when the
 *      eleventh is clicked (URL, panel heading, badge, meta line, description, `aria-pressed`, the selected
 *      cell's own class, and the market day inside that cell), and whether the console reported an error.
 *   B. THE STORY LINK THE CLICK REWRITES. `cultural-calendar.js` sets a RELATIVE `cultural-event.html?date=…`
 *      on every click; the served page carries `<base href="/">`, and this opens the address the browser
 *      resolved to see where a reader actually lands.
 *   C. EVERY SUBRESOURCE, held to account twice: from the browser's own network log while the page loads, and
 *      from `fetch()` in Node for the three script addresses by name.
 *   D. THE MARKET DAYS STILL WORK on `/igbo-calendar/` and `/market-days/`: the stamp is a real day rather than
 *      the design's placeholder, and the full-year grid still expands to twelve months of dated cells.
 *   E. THE SENTENCE. The sentence the owner quoted is asserted ABSENT from the served page and its replacement
 *      is printed, on this screen and on the two Igbo calendar screens.
 *
 * USAGE
 *   node scripts/verify-round-345-chrome.mjs
 */
import { spawn } from 'node:child_process';

const PORT = process.env.PORT ?? '3110';
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CALL_DEADLINE_MS = Number(process.env.CALL_DEADLINE_MS ?? '20000');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugPort = 9900 + Math.floor(Math.random() * 90);
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${debugPort}`, `--user-data-dir=/tmp/oz-verify-345-${debugPort}`,
  '--window-size=1440,2600', 'about:blank',
], { stdio: 'ignore' });

const problems = [];
const problem = (m) => { problems.push(m); console.log(`  PROBLEM  ${m}`); };
const ok = (m) => console.log(`  ok       ${m}`);

let ws;
try {
  /* ── attach to the BROWSER, then to the page ──────────────────────────────────────────────────── */

  let version = null;
  for (let i = 0; i < 60 && !version; i += 1) {
    await sleep(500);
    try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { /* still starting */ }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('Chrome did not expose a browser endpoint');

  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let id = 0;
  const pending = new Map();
  let logs = [];
  let responses = [];
  let frameNavigations = 0;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.frameNavigated' && !m.params?.frame?.parentId) frameNavigations += 1;
    if (m.method === 'Log.entryAdded' && m.params?.entry) {
      const en = m.params.entry;
      logs.push({ level: en.level, text: en.text, url: en.url ?? '' });
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.args) {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (text) logs.push({ level: m.params.type, text, url: '' });
    }
    if (m.method === 'Runtime.exceptionThrown' && m.params?.exceptionDetails) {
      logs.push({ level: 'exception', text: m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? '', url: '' });
    }
    if (m.method === 'Network.responseReceived' && m.params?.response) {
      responses.push({ status: m.params.response.status, url: m.params.response.url, type: m.params.type });
    }
  });
  const send = (method, params, sessionId) => new Promise((resolve) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); resolve({ timedOut: true, method }); }, CALL_DEADLINE_MS);
    pending.set(i, (m) => { clearTimeout(timer); resolve(m); });
    const message = { id: i, method, params };
    if (sessionId) message.sessionId = sessionId;
    ws.send(JSON.stringify(message));
  });

  const textOf = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.replace(/\\s+/g,' ').trim() ?? null`);
  const countOf = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

  /*
   * ── HOW A PAGE IS OPENED, AND WHAT WAS TRIED FIRST ──────────────────────────────────────────────
   *
   * A NEW TARGET IS CREATED PER ADDRESS, WITH THE URL ALREADY ON IT. Three approaches were measured on
   * Chrome 154 before this one:
   *
   *   1. attach to the page's own `webSocketDebuggerUrl` and `Page.navigate` — **the connection dies at the
   *      first navigation and never comes back**: no reply to the navigation, no reply to any evaluate after
   *      it, no close event. The first version of this probe produced no output at all because of it.
   *   2. attach to the BROWSER and `Target.attachToTarget` the page — every command answers, including
   *      navigation and evaluate; this is the working part and is kept below.
   *   3. that browser-attached page, given its URL by `Page.navigate` — **the navigation happens and its reply
   *      is never sent**, and with `Network.enable` on (which this probe needs to see a 404ing script) even the
   *      `Page.frameNavigated` event arrives only when another command happens to flush Chrome's queue.
   *
   * So the URL is given to `Target.createTarget`, which is itself the navigation: it answers, the document is
   * the one asked for by the time the session is up, and no timing race has to be argued about. **A target per
   * page also means each page's network and console are its own**, which is what makes section C's subresource
   * list trustworthy.
   */
  let sessionId = null;
  let pageTargetId = null;
  const evaluate = async (expression) => {
    if (!sessionId) throw new Error('no page is open');
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (r?.timedOut) throw new Error(`the browser did not answer Runtime.evaluate within ${CALL_DEADLINE_MS}ms: ${expression.slice(0, 90)}`);
    if (r?.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? 'evaluate failed');
    return r?.result?.result?.value;
  };

  async function open(url) {
    logs = [];
    responses = [];
    if (pageTargetId) {
      await send('Target.closeTarget', { targetId: pageTargetId });
      pageTargetId = null;
      sessionId = null;
    }
    const created = await send('Target.createTarget', { url });
    if (!created?.result?.targetId) throw new Error(`the browser refused to open ${url}`);
    pageTargetId = created.result.targetId;
    const attached = await send('Target.attachToTarget', { targetId: pageTargetId, flatten: true });
    sessionId = attached?.result?.sessionId;
    if (!sessionId) throw new Error(`the page target for ${url} refused the session`);
    for (const domain of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) {
      const r = await send(domain, {}, sessionId);
      if (r?.timedOut) throw new Error(`${domain} was never answered for ${url}`);
    }
    /*
     * AND THE NEW TARGET IS NOT THE PAGE UNTIL IT LEAVES `about:blank`. `Target.createTarget` answers as soon as
     * the target exists, and a target that has just been created is an empty document that already reports
     * `readyState === 'complete'` — so the first version of this read the blank page, reported 0 dates on a page
     * that has 31, and looked like the fault coming back. The wait is for an http address, not for readiness.
     */
    let ready = false;
    for (let i = 0; i < 100; i += 1) {
      await sleep(200);
      const href = await evaluate('location.href');
      if (href && href.startsWith('http') && await evaluate('document.readyState') === 'complete') { ready = true; break; }
    }
    if (!ready) throw new Error(`the page at ${url} never left about:blank`);
    await sleep(1000);
  }

  function badSubresources(label) {
    const bad = responses.filter((r) => r.status >= 400 && !r.url.startsWith('chrome'));
    if (bad.length) {
      for (const r of bad) problem(`${label}: ${r.status} ${r.type} ${r.url}`);
    } else {
      ok(`${label}: every subresource the browser asked for answered below 400 (${responses.length} responses, chrome internals excluded)`);
    }
    const badLogs = logs.filter((l) => l.level === 'error' || l.level === 'exception');
    for (const l of badLogs) problem(`${label}: console ${l.level} — ${l.text}`);
    if (!badLogs.length) ok(`${label}: no console error`);
  }

  /* ── A. THE DATE IS A CONTROL ─────────────────────────────────────────────────────────────────── */

  console.log('\nA. /cultural-calendar/ — A DATE, CLICKED\n');
  await open(`${BASE}/cultural-calendar/`);

  const dates = await countOf('[data-event-date]');
  const cells = await countOf('.sx-cultural-day');
  const panelBefore = await textOf('[data-event-title]');
  console.log(`  the served page: ${dates} clickable dates in ${cells} cells`);
  console.log(`  the panel before any click: ${JSON.stringify(panelBefore)}`);
  if (dates !== 31) problem(`the month grid holds ${dates} clickable dates, not 31 — the design's script binds nothing`);
  else ok('every date of the month is a control the design’s script can bind');

  const clicked = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-event-date]')];
    const button = buttons[10];
    if (!button) return null;
    button.scrollIntoView({ block: 'center' });
    button.click();
    return {
      date: button.dataset.eventDate,
      pressed: button.getAttribute('aria-pressed'),
      cellSelected: button.closest('.sx-cultural-day')?.classList.contains('is-selected'),
      marketDay: button.closest('.sx-cultural-day')?.querySelector('.sx-cal-market-day')?.textContent ?? null,
      marketDayInsideButton: Boolean(button.querySelector('.sx-cal-market-day')),
    };
  })()`);
  await sleep(400);
  const after = {
    url: await evaluate('location.href'),
    title: await textOf('[data-event-title]'),
    status: await textOf('[data-event-status]'),
    meta: await textOf('[data-event-meta]'),
    description: await textOf('[data-event-description]'),
    storyHref: await evaluate(`document.querySelector('[data-event-story]')?.href ?? null`),
    selected: await countOf('.sx-cultural-day.is-selected'),
    pressedTrue: await countOf('[data-event-date][aria-pressed="true"]'),
  };
  console.log(`  clicked the date carrying ${JSON.stringify(clicked?.date)} (the 11th control)`);
  console.log(`      its own cell carries the market day ${JSON.stringify(clicked?.marketDay)}, inside the button: ${clicked?.marketDayInsideButton}`);
  console.log(`      aria-pressed=${JSON.stringify(clicked?.pressed)}  cell has is-selected=${clicked?.cellSelected}`);
  console.log(`      URL after the click: ${after.url}`);
  console.log('      the panel now reads:');
  console.log(`        heading     ${JSON.stringify(after.title)}`);
  console.log(`        badge       ${JSON.stringify(after.status)}`);
  console.log(`        meta        ${JSON.stringify(after.meta)}`);
  console.log(`        description ${JSON.stringify(after.description)}`);
  console.log(`      selected cells: ${after.selected}   dates announcing themselves pressed: ${after.pressedTrue}`);
  console.log(`      the story link now points at (resolved by the browser): ${after.storyHref}`);

  if (after.url !== `${BASE}/cultural-calendar/`) problem(`the click navigated away to ${after.url}; selecting a date must not leave the page`);
  else ok('the click selected the date in place and did not navigate');
  if (!after.title || after.title === panelBefore) problem('the panel did not change when the date was clicked');
  else ok('the panel changed on the click');
  if (after.pressedTrue !== 1 || after.selected !== 1) problem(`after the click ${after.pressedTrue} dates were pressed and ${after.selected} cells were selected; exactly one of each is expected`);
  else ok('exactly one date is selected after the click, and the previous one was released');
  if (!after.title || !/No event is recorded for 11 /.test(after.title)) problem(`the panel heading does not name the chosen date: ${JSON.stringify(after.title)}`);
  else ok('the panel names the date that was clicked, and states that no event is recorded for it');
  if (!clicked?.marketDayInsideButton) problem('the market day is not inside the date’s own button');
  else ok('the market day sits inside the control the reader presses, as it does in the design’s own event cell');
  /*
   * AND THE PLAIN DATES DO NOT WEAR AN EVENT'S FACE. The design paints EVERY button in a day cell
   * `--gold-bright` (#e8c766), because in the design the only button a cell held was a day WITH an event —
   * and the page's own legend calls gold the mark of an event. Thirty-one gold cells over a panel reading
   * "no event recorded" is a page contradicting itself, so the served-page rule takes the gold off and leaves
   * it on the selected date. Measured rather than asserted in the source: what a reader sees is the computed
   * colour, and the emerald the design already uses for a chosen day is what the chosen one keeps.
   */
  const colours = await evaluate(`(() => {
    const selected = document.querySelector('.sx-cultural-day.is-selected button');
    const plain = document.querySelector('.sx-cultural-day:not(.is-selected) [data-event-date]');
    return {
      selected: selected ? getComputedStyle(selected).backgroundColor : null,
      plain: plain ? getComputedStyle(plain).backgroundColor : null,
    };
  })()`);
  console.log(`      computed background — a plain date: ${colours?.plain}; the chosen date: ${colours?.selected}`);
  if (colours?.plain === 'rgb(232, 199, 102)') problem('every plain date is painted the event gold (#e8c766), so the grid claims an event on every day');
  else ok('the plain dates are not painted the event gold');
  if (!colours?.selected || colours.selected === colours.plain) problem(`the chosen date is not distinguished from a plain one (${colours?.selected})`);
  else ok(`the chosen date is distinguished from a plain one (${colours?.selected})`);
  badSubresources('/cultural-calendar/');

  /* ── B. THE STORY LINK THE CLICK REWROTE ──────────────────────────────────────────────────────── */

  console.log('\nB. THE STORY LINK, OPENED AT THE ADDRESS THE BROWSER RESOLVED\n');
  if (after.storyHref) {
    await open(after.storyHref);
    const landed = await evaluate('location.href');
    const heading = await textOf('h1');
    console.log(`  ${after.storyHref}\n      -> ${landed}\n      h1: ${JSON.stringify(heading)}`);
    if (landed.includes('cultural-event.html')) problem(`the relative address was not resolved to the page: ${landed}`);
    else if (!heading || !/No event is recorded/i.test(heading)) problem(`the destination does not state that no event is recorded: ${JSON.stringify(heading)}`);
    else ok('the story link follows the chosen date to the event screen, which states that no event is recorded');
    badSubresources('the story link destination');
  } else {
    problem('the clicked date left no story link to follow');
  }

  /* ── C. THE THREE SCRIPT ADDRESSES, FETCHED BY NAME ───────────────────────────────────────────── */

  console.log('\nC. THE SCRIPTS THE CALENDAR LOADS, FETCHED FROM NODE\n');
  for (const src of ['/design-screen-assets/market-days.js', '/design/cultural-calendar.js', '/design/mobile-nav.js']) {
    const res = await fetch(`${BASE}${src}`);
    const body = await res.text();
    console.log(`  ${src.padEnd(42)} ${res.status}  ${body.length} bytes`);
    if (res.status !== 200 || body.length === 0) problem(`${src} answered ${res.status} with ${body.length} bytes`);
  }
  ok('every script the cultural calendar loads is a real, reachable file');

  /* ── D. THE TWO IGBO CALENDAR SCREENS: THE MARKET DAYS STILL WORK ─────────────────────────────── */

  console.log('\nD. THE MARKET DAYS ON /igbo-calendar/ AND /market-days/\n');
  for (const screen of ['/igbo-calendar/', '/market-days/']) {
    await open(`${BASE}${screen}`);
    const stamp = await textOf('[data-market-day]');
    const stampDate = await textOf('[data-modern-date]');
    const scripts = await evaluate(`[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))`);
    console.log(`  ${screen}  today's stamp: ${JSON.stringify(stamp)} · ${JSON.stringify(stampDate)}`);
    console.log(`      scripts: ${scripts.join(', ')}`);
    if (!stamp || stamp === 'Market day') problem(`${screen}: the market-day stamp is still the design's placeholder`);
    else ok(`${screen}: the market-day stamp rendered a real day (${stamp})`);
    if (!stampDate || stampDate === 'Today') problem(`${screen}: the stamp's date is still the design's placeholder`);
    const expanded = await evaluate(`(() => {
      const summary = document.querySelector('.sx-cal-year-card summary');
      if (!summary) return { cards: 0, cells: 0, open: null };
      summary.click();
      return {
        cards: document.querySelectorAll('.sx-cal-year-card').length,
        cells: document.querySelectorAll('.sx-cal-year-card [data-market]').length,
        open: summary.parentElement?.open ?? null,
      };
    })()`);
    await sleep(300);
    /*
     * THE TWO SCREENS ARE NOT THE SAME SCREEN, WHICH THE ROUND RECORD ALREADY STATES: `market-days.html` has no
     * full-year grid, so its absence here is the design and not a regression. `/igbo-calendar/` is the one the
     * owner asked to be expandable, and it is the one held to twelve months.
     */
    if (screen === '/igbo-calendar/') {
      console.log(`      the full year: ${expanded?.cards ?? 0} month cards, ${expanded?.cells ?? 0} dated cells, first card open=${expanded?.open}`);
      if (!expanded || expanded.cards !== 12) problem(`${screen}: the full-year grid did not draw twelve months`);
      else ok(`${screen}: the full-year grid still draws twelve expandable months`);
      if (expanded && expanded.cells < 365) problem(`${screen}: the year grid drew ${expanded.cells} dated cells, not a year's worth`);
    } else {
      const monthCells = await countOf('[data-calendar-grid] > *');
      console.log(`      this screen has no year grid by design; its month view holds ${monthCells} cells`);
      if (expanded?.cards) problem(`${screen}: a full-year grid appeared on the screen that has none in the design`);
      if (monthCells < 28) problem(`${screen}: the month view is empty (${monthCells} cells)`);
      else ok(`${screen}: the month view still draws its month`);
    }
    badSubresources(screen);
  }

  /* ── E. THE SENTENCE ──────────────────────────────────────────────────────────────────────────── */

  console.log('\nE. THE SENTENCE THE OWNER QUOTED, AND ITS REPLACEMENT\n');
  await open(`${BASE}/cultural-calendar/`);
  const body = await evaluate(`document.body.innerText.replace(/\\s+/g,' ')`);
  const quoted = 'A demonstration reckoning from a fixed anchor — 1 January 2026 taken as Orie, repeating the four-day cycle — not a claim that every Igbo community uses the same one. The Igbo calendar states the basis in full.';
  if (body.includes(quoted)) problem('the sentence the owner quoted is still on the served page');
  else ok('the sentence the owner quoted is gone from the served page');
  for (const fragment of ['A demonstration reckoning', 'not a claim that every Igbo community', 'states the basis in full']) {
    if (body.includes(fragment)) problem(`the page still carries the phrase: ${fragment}`);
  }
  const replacement = await evaluate(`(() => {
    const note = document.querySelector('#calendar .sx-source-note.small');
    return note ? note.textContent.replace(/\\s+/g,' ').trim() : null;
  })()`);
  console.log(`  the market-day note now reads:\n      ${JSON.stringify(replacement)}`);
  if (!replacement || !/different anchors in different communities/.test(replacement)) problem('the replacement sentence is not on the page');
  else ok('the fact is stated as a fact about the calendar, in one breath, beside the stamp');

  await open(`${BASE}/igbo-calendar/`);
  const igbo = await evaluate(`document.body.innerText.replace(/\\s+/g,' ')`);
  if (igbo.includes("this archive's demonstration of one reckoning")) problem('/igbo-calendar/ still calls its own reckoning a demonstration');
  else ok('/igbo-calendar/ no longer calls its own reckoning a demonstration');
  if (igbo.includes('It is not a claim that every Igbo community uses the same anchor')) problem('/igbo-calendar/ still carries the design’s duplicated disclaimer after the fill’s sentence');
  else ok('/igbo-calendar/ states the qualification once, not twice');
  const igboBasis = await evaluate(`(() => {
    const all = [...document.querySelectorAll('p, div')].map((el) => el.textContent.replace(/\\s+/g,' ').trim());
    return all.find((t) => t.startsWith('This page reckons the cycle from a fixed anchor')) ?? null;
  })()`);
  console.log(`  /igbo-calendar/'s basis note:\n      ${JSON.stringify(igboBasis)}`);

  const meta = await evaluate(`document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null`);
  console.log(`  /igbo-calendar/'s own meta description: ${JSON.stringify(meta)}`);
  if (meta && /demonstration/i.test(meta)) problem(`the page's own meta description still calls the anchor a demonstration: ${meta}`);
  else ok('the page’s own meta description no longer calls the anchor a demonstration');

  console.log(`\n${problems.length === 0 ? 'ALL CHECKS PASSED' : `${problems.length} PROBLEM(S)`}`);
  for (const p of problems) console.log(`  - ${p}`);
} catch (error) {
  problem(`the probe itself failed: ${error.message}`);
  console.log(`\n${problems.length} PROBLEM(S)`);
  for (const p of problems) console.log(`  - ${p}`);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  proc.kill('SIGTERM');
}
