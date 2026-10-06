/*
 * measure-masthead.mjs — look at the served masthead in a real browser, rather than reason about it.
 *
 *   node scripts/measure-masthead.mjs <url> [<width> ...]
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A DIFF
 *
 * The owner reported the same fault twice: *"again, you have not fixed the menu to be exactly as it should
 * fixed."* Both attempts were reasoned about in source. **A menu that wraps is visible in a picture and
 * invisible in a diff** — `main.css:101` lets `.nav ul` wrap, so whether the eighth item moves onto a second
 * line depends on text metrics the browser computes and nobody reads.
 *
 * So this reports the things that cannot be argued with:
 *
 *   ulRowCount        how many lines the design's `<ul>` occupies. MUST be 1 at every desktop width.
 *   inList            whether the account control is inside the `<ul>`. MUST be false.
 *   borderBottom      the mobile menu-item border, on the account control. MUST be none.
 *   headerRows        how many rows the masthead `.wrap` occupies.
 *   rendered          whether the account control has a size and an accessible name at all — a control that
 *                     is separate and unclickable-looking is a different fault from one that scatters.
 *
 * SETTING THE SESSION COOKIE OVER CDP IS THE POINT OF THE `--cookie` OPTION. The signed-in masthead is the
 * state the owner was in when he reported it, and Chrome cannot be handed a cookie on the command line.
 *
 * `--headless=old` because the shell helper in this repository records that `--headless=new` starts, loads
 * the page and never writes a screenshot on this machine, with and without `--virtual-time-budget`.
 */
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { spawn } = await import('node:child_process');
const { mkdir, writeFile } = await import('node:fs/promises');
const { resolve, dirname } = await import('node:path');

const argv = process.argv.slice(2);
const url = argv[0];
if (!url) {
  console.error('usage: node scripts/measure-masthead.mjs <url> [width ...] [--cookie name=value] [--out dir] [--label name]');
  process.exit(2);
}

/** The widths the brief names, and the viewport height the design's own screenshots use. */
const widths = argv.slice(1).filter((a) => /^\d+$/.test(a)).map(Number);
if (widths.length === 0) widths.push(1440, 1280, 1024, 390);

const cookieArg = argv.find((a) => a.startsWith('--cookie=')) ?? argv[argv.indexOf('--cookie') + 1];
const outDir = (argv.find((a) => a.startsWith('--out=')) ?? argv[argv.indexOf('--out') + 1] ?? './.shots').replace(/^--out=/, '');
const label = (argv.find((a) => a.startsWith('--label=')) ?? argv[argv.indexOf('--label') + 1] ?? 'shot').replace(/^--label=/, '');

let cookie = null;
if (cookieArg && cookieArg.includes('=')) {
  const [name, ...rest] = cookieArg.replace(/^--cookie=/, '').split('=');
  cookie = { name, value: rest.join('=') };
}

await mkdir(resolve(outDir), { recursive: true });

const port = 9800 + Math.floor(Math.random() * 150);
const proc = spawn(CHROME, [
  '--headless=old', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=/tmp/cdp-masthead-${port}`,
  '--window-size=1600,1200',
  'about:blank',
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 50 && !target; i++) {
  await new Promise((r) => setTimeout(r, 300));
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch { /* not up yet */ }
}
if (!target) { console.error('could not attach to Chrome'); proc.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params) => new Promise((res) => {
  const myId = ++id;
  pending.set(myId, res);
  ws.send(JSON.stringify({ id: myId, method, params }));
});

await send('Page.enable');
await send('Network.enable');
if (cookie) {
  const host = new URL(url).hostname;
  const set = await send('Network.setCookie', { name: cookie.name, value: cookie.value, domain: host, path: '/' });
  if (!set?.result?.success) console.error(`WARNING: the session cookie was not accepted (${JSON.stringify(set?.result)})`);
}

const MEASURE = `(() => {
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const wrap = document.querySelector('.masthead > .wrap, .sx-reader-header > .wrap');
  const nav = wrap?.querySelector('nav');
  const ul = nav?.querySelector('ul');
  const account = document.querySelector('.masthead-account');
  const accountLink = account?.querySelector('.nav-account');
  const menuItems = [...(ul?.children ?? [])];
  const tops = [...new Set(menuItems.map((li) => Math.round(li.getBoundingClientRect().top)))];
  /*
   * ⚠️ ZERO-SIZED CHILDREN ARE EXCLUDED, AND THAT IS NOT A DETAIL. mobile-nav.js injects the hamburger
   * button as a child of the same .wrap, and showcase.css:645 sets it to display:none above 40rem — so it
   * measures as a box at 0,0 and a naive row count reports an extra row that is not on the page. **The
   * number has to describe what a reader sees.**
   */
  const wrapChildren = [...(wrap?.children ?? [])].filter((c) => {
    const b = c.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  });
  const wrapTops = [...new Set(wrapChildren.map((c) => Math.round(c.getBoundingClientRect().top)))];
  const cs = accountLink ? getComputedStyle(accountLink) : null;
  return JSON.stringify({
    viewportW: innerWidth,
    menuItemCount: menuItems.length,
    menuLabels: menuItems.map((li) => li.textContent.trim()),
    ulRowCount: tops.length,
    ulRows: tops,
    headerRows: wrapTops.length,
    accountInsideList: Boolean(accountLink && ul && ul.contains(accountLink)),
    accountInsideNav: Boolean(accountLink && nav && nav.contains(accountLink)),
    accountPresent: Boolean(accountLink),
    accountLabel: accountLink?.textContent.trim() ?? null,
    accountHref: accountLink?.getAttribute('href') ?? null,
    accountBox: box(accountLink),
    accountBorderBottom: cs ? cs.borderBottomWidth + ' ' + cs.borderBottomStyle : null,
    accountBackground: cs ? cs.backgroundColor : null,
    accountColor: cs ? cs.color : null,
    accountVisible: Boolean(accountLink && accountLink.getBoundingClientRect().width > 0 && accountLink.getBoundingClientRect().height > 0),
    navBox: box(nav),
    ulBox: box(ul),
    accountBoxWrap: box(account),
    /*
     * WHERE EACH CHILD OF THE HEADER ACTUALLY LANDED. headerRows says how many rows there are; this says what
     * is on each of them, which is the difference between "the header is three rows" and "the account control
     * was pushed below the menu button".
     */
    layout: wrapChildren.map((c) => ({
      tag: c.tagName.toLowerCase(),
      cls: c.className,
      row: Math.round(c.getBoundingClientRect().top),
      x: Math.round(c.getBoundingClientRect().x),
      w: Math.round(c.getBoundingClientRect().width),
    })),
    menuButtonBox: box(document.querySelector('.mobile-menu-button')),
    signInOffered: /Sign in \\/ Sign up/i.test(document.body.innerText),
    myAccountOffered: /My account/i.test(document.body.innerText),
    docScrollW: document.documentElement.scrollWidth
  });
})()`;

const results = [];
for (const width of widths) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width <= 480 });
  await send('Page.navigate', { url });

  /*
   * ⚠️ SETTLING IS NOT COSMETIC, AND MEASURING TOO EARLY IS THE TRAP THIS SCRIPT FELL INTO FIRST.
   *
   * The design loads Google Fonts from a second origin, and the layout of a wrapping flex row depends on the
   * text metrics those fonts supply. Measured before they arrived, the same page reported **seven rows for a
   * menu the screenshot shows on one line** — the fallback font is wider than Noto Sans, so `main.css:101`'s
   * `flex-wrap: wrap` legitimately wrapped it. **The number was true of a page nobody ever sees.**
   *
   * So the wait is on `document.fonts.ready` and on the measurement agreeing with itself twice in a row, and
   * the settling time is reported so a reader can see the measurement was of a finished page.
   */
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const ready = await send('Runtime.evaluate', {
      expression:
        "document.readyState === 'complete' && document.fonts && document.fonts.status === 'loaded' && Boolean(document.querySelector('.masthead-account, .masthead, .sx-reader-header'))",
      returnByValue: true,
    });
    if (ready?.result?.result?.value) break;
  }
  await new Promise((r) => setTimeout(r, 800));

  let parsed = null;
  let previous = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    const measured = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
    const value = measured?.result?.result?.value ?? '';
    if (value && value === previous) { parsed = JSON.parse(value); break; }
    previous = value;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!parsed) {
    console.error(`WARNING: the layout at ${width} px never settled; reporting the last reading`);
    parsed = previous ? JSON.parse(previous) : { error: 'no measurement' };
  }
  parsed.width = width;

  /*
   * THE PICTURE, CLIPPED TO THE MASTHEAD. A full-page screenshot of a 30,000 px archive page renders the
   * menu at four pixels tall in the report; the masthead is the thing under test, so it is what is framed.
   */
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height: 220, scale: 2 },
    captureBeyondViewport: true,
  });
  const file = resolve(outDir, `${label}-${width}.png`);
  if (shot?.result?.data) await writeFile(file, Buffer.from(shot.result.data, 'base64'));
  parsed.screenshot = file;

  /*
   * ⚠️ AND THE MENU OPENED, WHICH IS THE STATE THE OWNER WAS LOOKING AT WHEN HE SAID "MENU".
   *
   * Below 40rem `showcase.css:658` hides `nav.nav` and turns its `<ul>` into a two-column grid in which
   * EVERY `<li>` is given a bottom border. A closed menu therefore cannot show whether the account control
   * took a menu item's border — it is not on screen at all — so the report measures it with the disclosure
   * open, and counts the borders rather than trusting the rule.
   */
  const opened = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = document.querySelector('.mobile-menu-button');
      if (!b) return JSON.stringify({ open: false, reason: 'no menu button at this width' });
      b.click();
      const nav = document.querySelector('.masthead .nav, .sx-reader-header nav');
      const ul = nav?.querySelector('ul');
      const account = document.querySelector('.masthead-account');
      const link = account?.querySelector('.nav-account');
      const cs = link ? getComputedStyle(link) : null;
      const bordered = [...(ul?.children ?? [])].filter((li) => {
        const s = getComputedStyle(li);
        return s.borderBottomWidth !== '0px' && s.borderBottomStyle !== 'none';
      }).length;
      return JSON.stringify({
        open: document.querySelector('.masthead')?.classList.contains('menu-open') ?? false,
        navDisplay: nav ? getComputedStyle(nav).display : null,
        navVisible: Boolean(nav && nav.getBoundingClientRect().height > 0),
        listItems: ul ? ul.children.length : 0,
        listItemsWithBorder: bordered,
        accountInsideList: Boolean(link && ul && ul.contains(link)),
        accountBorderBottom: cs ? cs.borderBottomWidth + ' ' + cs.borderBottomStyle : null,
        accountVisible: Boolean(link && link.getBoundingClientRect().width > 0 && link.getBoundingClientRect().height > 0)
      });
    })()`,
    returnByValue: true,
  });
  parsed.opened = opened?.result?.result?.value ? JSON.parse(opened.result.result.value) : { error: 'no reading' };
  const openShot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height: 420, scale: 2 },
    captureBeyondViewport: true,
  });
  const openFile = resolve(outDir, `${label}-${width}-menu-open.png`);
  if (openShot?.result?.data) await writeFile(openFile, Buffer.from(openShot.result.data, 'base64'));
  parsed.openScreenshot = openFile;
  await send('Runtime.evaluate', { expression: "document.querySelector('.mobile-menu-button')?.click()" });

  results.push(parsed);
}

console.log(JSON.stringify(results, null, 2));
ws.close();
proc.kill();
process.exit(0);
